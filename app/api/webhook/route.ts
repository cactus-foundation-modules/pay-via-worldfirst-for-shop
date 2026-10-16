// POST /api/m/pay-via-worldfirst-for-shop/webhook
// WorldFirst calls this (notifyPayment) when a payment order concludes. No
// session: WorldFirst is the caller.
//
// The body is a nudge, never evidence: whatever it says, the payment's state is
// read back from WorldFirst's own inquiry call before anything is settled, so a
// forged delivery can do nothing but cause one harmless lookup. That is also why
// a signature that will not verify is logged rather than turned away: the
// notification's signing headers are not published in full, and refusing a
// genuine delivery would leave a shopper who paid and closed the tab with no
// order - the one failure here that costs real money. The signature is checked
// whenever WorldFirst's public key is set, and a mismatch is loud in the log.
import { NextRequest, NextResponse } from 'next/server'
import { inquirePayment, requestTimestamp } from '@/modules/pay-via-worldfirst-for-shop/lib/worldfirst'
import { getWorldFirstCredentials } from '@/modules/pay-via-worldfirst-for-shop/lib/env'
import { getWorldFirstSettings } from '@/modules/pay-via-worldfirst-for-shop/lib/settings'
import { getWfpPaymentById } from '@/modules/pay-via-worldfirst-for-shop/lib/db'
import { settleFromPayment } from '@/modules/pay-via-worldfirst-for-shop/lib/settle'
import { buildSignatureHeader, buildSigningContent, signContent, verifyMessage } from '@/modules/pay-via-worldfirst-for-shop/lib/signature'
import { ACKNOWLEDGEMENT_BODY, readNotification } from '@/modules/pay-via-worldfirst-for-shop/lib/webhook-payload'
import { WEBHOOK_PATH } from '@/modules/pay-via-worldfirst-for-shop/lib/webhook-url'

const LOG = '[pay-via-worldfirst]'

// WorldFirst expects the acknowledgement signed the way a request is signed,
// with the same four headers. Without a private key to sign with there is
// nothing sensible to send, which is a 503 and a retry later.
function acknowledgement(clientId: string, privateKey: string): NextResponse {
  const time = requestTimestamp()
  const content = buildSigningContent({ method: 'POST', path: WEBHOOK_PATH, clientId, time, body: ACKNOWLEDGEMENT_BODY })
  return new NextResponse(ACKNOWLEDGEMENT_BODY, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Client-Id': clientId,
      'Response-Time': time,
      Signature: buildSignatureHeader(signContent(content, privateKey)),
    },
  })
}

export async function POST(request: NextRequest) {
  const { environment } = await getWorldFirstSettings()
  const creds = getWorldFirstCredentials(environment)
  if (!creds.clientId || !creds.privateKey) return new NextResponse('Not configured', { status: 503 })

  // Read RAW, before anything parses it: a body that has been through JSON.parse
  // and back is not the bytes WorldFirst signed.
  const rawBody = await request.text()

  if (creds.publicKey) {
    const time = request.headers.get('request-time')
    const valid = !!time && verifyMessage({
      method: 'POST',
      path: WEBHOOK_PATH,
      clientId: request.headers.get('client-id') ?? creds.clientId,
      time,
      body: rawBody,
      signatureHeader: request.headers.get('signature'),
      publicKey: creds.publicKey,
    })
    if (!valid) console.warn(`${LOG} webhook signature did not verify - settling from WorldFirst's own inquiry regardless`)
  }

  const notification = readNotification(rawBody)
  if (!notification) return new NextResponse('Invalid payload', { status: 400 })

  // Not ours (somebody else's payment on a shared account): acknowledged, not
  // failed, so WorldFirst does not retry it for 24 hours.
  const row = await getWfpPaymentById(notification.payToRequestId)
  if (!row) return acknowledgement(creds.clientId, creds.privateKey)

  try {
    await settleFromPayment(row, await inquirePayment(environment, row.id))
  } catch (err) {
    // A 500 makes WorldFirst retry (2m, 10m, 10m, 1h, 2h, 6h, 15h), which is the
    // only second chance there is for a delivery that failed while settling.
    console.error(`${LOG} webhook settlement failed`, err)
    return new NextResponse('Settlement failed', { status: 500 })
  }
  return acknowledgement(creds.clientId, creds.privateKey)
}
