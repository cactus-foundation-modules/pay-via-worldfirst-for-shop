// Thin WorldFirst Pay Solution client (Cashier Payment). No SDK dependency - the
// two calls this module needs are plain signed REST.
//
//   createCashierPayment  POST /amsin/api/v1/business/create
//   inquirePayment        POST /amsin/api/v1/business/inquiryPayOrder
//
// Every request carries Client-Id, Request-Time and a Signature over the exact
// body (lib/signature.ts). Every response is narrowed with Zod to a declared
// shape before it leaves this file: nothing downstream sees `unknown`, and
// nothing here guesses. A field that is not the shape it should be throws,
// because a payment client that quietly invents a value it could not read is
// how a shop ends up fulfilling an order against money nobody sent.
//
// Reference: developers.worldfirst.com, Pay Solution -> Cashier Payment. The
// documentation is partner-gated in places (host, keys and the exact response
// of some calls come with onboarding), so the parts that were not published are
// said so where they are used rather than papered over.
import { z } from 'zod'
import {
  buildSignatureHeader,
  buildSigningContent,
  signContent,
  verifyMessage,
} from '@/modules/pay-via-worldfirst-for-shop/lib/signature'
import { getWorldFirstCredentials, type WorldFirstEnvironment } from '@/modules/pay-via-worldfirst-for-shop/lib/env'
import { apiBaseUrlFor, getWorldFirstSettings, keyVersionFor } from '@/modules/pay-via-worldfirst-for-shop/lib/settings'
import { parseMinorUnits, toMinorUnits } from '@/modules/pay-via-worldfirst-for-shop/lib/amount'
import { parseWorldFirstPaymentStatus, type WorldFirstPaymentStatus } from '@/modules/pay-via-worldfirst-for-shop/lib/status'

const REQUEST_TIMEOUT_MS = 20_000

export const CREATE_PATH = '/amsin/api/v1/business/create'
export const INQUIRY_PATH = '/amsin/api/v1/business/inquiryPayOrder'

// --- Transport --------------------------------------------------------------

/** ISO 8601 to the second, which is what Request-Time must be. UTC written as
 *  +00:00 so the offset is always explicit. */
export function requestTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/\.\d{3}Z$/, '+00:00')
}

const ResultSchema = z.object({
  resultStatus: z.string(),
  resultCode: z.string(),
  resultMessage: z.string().optional(),
})

const AmountSchema = z.object({
  currency: z.string().min(3).max(3),
  value: z.union([z.string(), z.number()]),
})

async function signedPost(environment: WorldFirstEnvironment, path: string, body: unknown): Promise<unknown> {
  const creds = getWorldFirstCredentials(environment)
  if (!creds.clientId || !creds.privateKey) throw new Error('WorldFirst is not configured')
  const settings = await getWorldFirstSettings()
  const baseUrl = apiBaseUrlFor(settings, environment)
  if (!baseUrl) throw new Error(`Enter the ${environment} API address WorldFirst gave you first.`)

  const rawBody = JSON.stringify(body)
  const time = requestTimestamp()
  const content = buildSigningContent({ method: 'POST', path, clientId: creds.clientId, time, body: rawBody })
  let signatureValue: string
  try {
    signatureValue = signContent(content, creds.privateKey)
  } catch {
    // OpenSSL's own message ("DECODER routines::unsupported") tells an owner
    // nothing. The key is the thing to fix, so say so.
    throw new Error('Your private key could not be read. Paste the whole key again, BEGIN and END lines included, and redeploy.')
  }
  const signature = buildSignatureHeader(signatureValue, keyVersionFor(settings, environment))

  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Client-Id': creds.clientId,
      'Request-Time': time,
      Signature: signature,
    },
    body: rawBody,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  // Read RAW: the response signature is over the bytes WorldFirst sent.
  const rawResponse = await res.text()
  if (!res.ok) throw new Error(`WorldFirst API error ${res.status}`)

  if (creds.publicKey) {
    const responseTime = res.headers.get('response-time')
    const valid = !!responseTime && verifyMessage({
      method: 'POST',
      path,
      clientId: creds.clientId,
      time: responseTime,
      body: rawResponse,
      signatureHeader: res.headers.get('signature'),
      publicKey: creds.publicKey,
    })
    if (!valid) throw new Error('WorldFirst\'s reply did not carry a valid signature, so it was not trusted.')
  }

  try {
    return JSON.parse(rawResponse)
  } catch {
    throw new Error('WorldFirst replied with something that was not JSON')
  }
}

function describeFailure(result: z.infer<typeof ResultSchema>): string {
  // Both, because the message alone ("key not found") often does not say which
  // thing to fix and the code is what WorldFirst's support will ask for.
  const message = result.resultMessage?.trim()
  return message ? `${message} (${result.resultCode})` : result.resultCode
}

// --- createCashierPayment ---------------------------------------------------

const CreateResponseSchema = z.object({
  result: ResultSchema,
  // A JSON STRING holding an ActionForm, not an object: parsed separately.
  actionForm: z.string().optional(),
  payToSummaries: z.array(z.object({ payToId: z.string().optional(), payToRequestId: z.string().optional() })).optional(),
})

const ActionFormSchema = z.object({ redirectUrl: z.string().url() })

export type CreateCashierPaymentInput = {
  // Our wfp_payments id, sent as payToRequestId: WorldFirst's idempotency key.
  paymentId: string
  orderId: string
  // Major units, converted here.
  amount: number
  currency: string
  buyerReference: string
  description: string
  returnUrl: string
  notifyUrl: string
}

export type CreatedCashierPayment = { payToId: string | null; checkoutUrl: string }

export async function createCashierPayment(
  environment: WorldFirstEnvironment,
  input: CreateCashierPaymentInput,
): Promise<CreatedCashierPayment> {
  const amount = { currency: input.currency.toUpperCase(), value: toMinorUnits(input.amount, input.currency) }
  const data = await signedPost(environment, CREATE_PATH, {
    orderGroup: {
      orderBuyer: { referenceBuyerId: input.buyerReference.slice(0, 64) },
      orderGroupDescription: input.description,
      orderGroupId: input.paymentId,
      orders: [
        {
          orderTotalAmount: amount,
          orderDescription: input.description,
          referenceOrderId: input.orderId,
          transactionTime: new Date().toISOString(),
        },
      ],
    },
    industryProductCode: 'ONLINE_DIRECT_PAY',
    paymentRedirectUrl: input.returnUrl,
    payToDetails: [
      {
        payToRequestId: input.paymentId,
        payToAmount: amount,
        // The documented fixed values for a cashier payment: the shopper picks
        // how they pay on WorldFirst's page, not in this request.
        payToMethod: { paymentMethodType: 'BALANCE', paymentMethodDataType: 'PAYMENT_ACCOUNT_NO', paymentMethodData: '' },
        paymentNotifyUrl: input.notifyUrl,
        referenceOrderId: input.orderId,
      },
    ],
  })

  const parsed = CreateResponseSchema.safeParse(data)
  if (!parsed.success) throw new Error('WorldFirst\'s create response was not in the shape this module expects')
  const { result, actionForm, payToSummaries } = parsed.data
  if (result.resultStatus !== 'S') throw new Error(`WorldFirst could not start the payment: ${describeFailure(result)}`)
  if (!actionForm) throw new Error('WorldFirst accepted the payment but sent no page to pay on')

  let form: z.infer<typeof ActionFormSchema>
  try {
    form = ActionFormSchema.parse(JSON.parse(actionForm))
  } catch {
    throw new Error('WorldFirst\'s payment page address could not be read')
  }
  // The shopper's browser is about to be sent here, so it is checked rather
  // than trusted: https only.
  if (new URL(form.redirectUrl).protocol !== 'https:') throw new Error('WorldFirst sent a payment page address that is not secure')

  return { payToId: payToSummaries?.[0]?.payToId ?? null, checkoutUrl: form.redirectUrl }
}

// --- inquirePayment ---------------------------------------------------------

const InquiryResponseSchema = z.object({
  result: ResultSchema,
  payToSummaries: z
    .array(
      z.object({
        orderResult: z.object({ status: z.string() }).optional(),
        payToAmount: AmountSchema.optional(),
        payToId: z.string().optional(),
        payToRequestId: z.string().optional(),
      }),
    )
    .optional(),
})

export type WorldFirstPaymentState = {
  status: WorldFirstPaymentStatus
  payToId: string | null
  // What the beneficiary (this shop) receives, in minor units. null until
  // WorldFirst reports one.
  receivedMinor: number | null
  currency: string
}

/** Narrow a raw inquiry response. Exported for the tests. */
export function readInquiryResponse(data: unknown, paymentId: string): WorldFirstPaymentState {
  const parsed = InquiryResponseSchema.safeParse(data)
  if (!parsed.success) throw new Error('WorldFirst\'s inquiry response was not in the shape this module expects')
  const { result, payToSummaries } = parsed.data

  if (result.resultStatus === 'U') throw new Error('WorldFirst could not say yet. Try again shortly.')
  if (result.resultStatus !== 'S') throw new Error(`WorldFirst could not look the payment up: ${describeFailure(result)}`)

  // Looked up by OUR id, so a summary for anybody else's payment can never be
  // read as this one.
  const summary = payToSummaries?.find((s) => s.payToRequestId === paymentId)
  // PROCESSING is a successful call with nothing to report yet.
  if (!summary?.orderResult) {
    if (result.resultCode === 'PROCESSING') return { status: 'WAIT_PAY', payToId: null, receivedMinor: null, currency: '' }
    throw new Error('WorldFirst found no result for this payment')
  }

  return {
    status: parseWorldFirstPaymentStatus(summary.orderResult.status),
    payToId: summary.payToId ?? null,
    receivedMinor: summary.payToAmount ? parseMinorUnits(summary.payToAmount.value) : null,
    currency: summary.payToAmount?.currency.toUpperCase() ?? '',
  }
}

export async function inquirePayment(environment: WorldFirstEnvironment, paymentId: string): Promise<WorldFirstPaymentState> {
  const data = await signedPost(environment, INQUIRY_PATH, { payToRequestIds: [paymentId] })
  return readInquiryResponse(data, paymentId)
}

// --- Connection check -------------------------------------------------------

// A result code that means the credentials were refused, as opposed to "I have
// never heard of that payment" which is what the probe below expects to hear.
const REFUSED_CODE = /SIGN|CLIENT|ACCESS|AUTH|KEY|IP_|FORBIDDEN/i

/**
 * Whether WorldFirst accepts this module's credentials.
 *
 * WorldFirst publishes no "ping" call, so this asks after a payment that cannot
 * exist. A reply that is signed and well formed - whatever it says about that
 * payment - proves the host, the Client-Id and the signing key all work; only an
 * HTTP error, an unverifiable signature or a refusal-looking result code count
 * as not connected.
 */
export async function verifyCredentials(environment: WorldFirstEnvironment): Promise<void> {
  const data = await signedPost(environment, INQUIRY_PATH, { payToRequestIds: ['cactus-connection-check'] })
  const parsed = z.object({ result: ResultSchema }).safeParse(data)
  if (!parsed.success) throw new Error('WorldFirst\'s reply was not in the shape this module expects')
  const { result } = parsed.data
  if (result.resultStatus === 'U' || REFUSED_CODE.test(result.resultCode)) throw new Error(describeFailure(result))
}
