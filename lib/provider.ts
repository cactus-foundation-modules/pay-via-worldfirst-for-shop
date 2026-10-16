// The Pay via WorldFirst payment provider, registered into the shop checkout via
// the `shop.payment-providers` extension point (see the manifest).
//
// The shopper is handed to WorldFirst's hosted cashier page and brought back.
// Nothing is drawn on this site's own checkout, so there is no client-fields
// component and nothing of WorldFirst's is loaded into a page that takes money.
import { getSiteUrl } from '@/lib/config/env'
import type {
  ShpOrderDraft, ShpPaymentIntent, ShpPaymentProvider, ShpPaymentResult,
  ShpRefundRequest, ShpRefundResult,
} from '@/modules/shop/lib/payments/provider'
import { isWorldFirstConfigured } from '@/modules/pay-via-worldfirst-for-shop/lib/env'
import { apiBaseUrlFor, getWorldFirstSettings, MAX_PAYMENT_DESCRIPTION_LENGTH } from '@/modules/pay-via-worldfirst-for-shop/lib/settings'
import * as worldfirst from '@/modules/pay-via-worldfirst-for-shop/lib/worldfirst'
import { worldFirstSettlementOutcome } from '@/modules/pay-via-worldfirst-for-shop/lib/status'
import { isAcceptedCurrency, toMinorUnits, roundToCurrency } from '@/modules/pay-via-worldfirst-for-shop/lib/amount'
import { createWfpPayment, getWfpPaymentByOrderId, updateWfpPayment } from '@/modules/pay-via-worldfirst-for-shop/lib/db'
import { paymentMatchesOrder } from '@/modules/pay-via-worldfirst-for-shop/lib/payment-match'
import { RETURN_PATH, isReachableWebhookUrl, worldFirstWebhookUrl } from '@/modules/pay-via-worldfirst-for-shop/lib/webhook-url'

const METHOD_ID = 'WORLDFIRST'

// How long a cashier page already created for this order is handed back to a
// shopper who double-submits. WorldFirst publishes no cashier-page lifetime a
// partner can read, so this is deliberately short: a stale link is worse than a
// second request.
const REUSE_WINDOW_MS = 10 * 60_000

// A path on this site, or nothing at all. The shop is trustworthy but what is
// built from this is a URL somebody's browser is sent to, so it is checked for
// the shape that matters: one leading slash and no second one ("//evil.example"
// is a protocol-relative URL, another site entirely).
function safeReturnPath(path: string | undefined): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null
  return path
}

// Offered at checkout only when the owner has turned the method on, entered the
// API address for the live environment, and set the credentials that sign for it.
async function isAvailable(): Promise<boolean> {
  const settings = await getWorldFirstSettings()
  if (!settings.enabled) return false
  if (!apiBaseUrlFor(settings, settings.environment)) return false
  return isWorldFirstConfigured(settings.environment)
}

async function createIntent(order: ShpOrderDraft): Promise<ShpPaymentIntent> {
  const settings = await getWorldFirstSettings()

  // Refused here rather than sent and hoped for: the message is what the
  // shopper reads.
  if (!isAcceptedCurrency(order.currency, settings.acceptedCurrencies)) {
    throw new Error(`Pay via WorldFirst is not available for orders priced in ${order.currency.toUpperCase()}.`)
  }
  const amount = roundToCurrency(order.amount, order.currency)
  if (toMinorUnits(amount, order.currency) <= 0) {
    throw new Error('Pay via WorldFirst cannot be used for an order with nothing to pay.')
  }

  const notifyUrl = worldFirstWebhookUrl(getSiteUrl())
  if (!isReachableWebhookUrl(notifyUrl)) {
    // WorldFirst would be told to call an address it cannot reach, and a
    // shopper who paid and closed the tab would never be confirmed.
    throw new Error('Pay via WorldFirst only works on a live https site.')
  }

  // A repeated submit hands back the cashier page that already exists, only
  // while it is untouched, recent and for the same money.
  const existing = await getWfpPaymentByOrderId(order.orderId)
  if (
    existing?.checkoutUrl &&
    existing.status === 'WAIT_PAY' &&
    existing.currency.toUpperCase() === order.currency.toUpperCase() &&
    toMinorUnits(Number(existing.amount), existing.currency) === toMinorUnits(amount, order.currency) &&
    Date.now() - existing.createdAt.getTime() < REUSE_WINDOW_MS
  ) {
    return { approvalUrl: existing.checkoutUrl, providerOrderId: existing.id }
  }

  // The row goes in BEFORE the call: its id is the payToRequestId, WorldFirst's
  // idempotency key.
  const row = await createWfpPayment({
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    amount,
    currency: order.currency.toUpperCase(),
    returnPath: safeReturnPath(order.returnPath),
  })

  const description = (settings.paymentDescription.trim() || `Order ${order.orderNumber}`).slice(0, MAX_PAYMENT_DESCRIPTION_LENGTH)
  const created = await worldfirst.createCashierPayment(settings.environment, {
    paymentId: row.id,
    orderId: order.orderId,
    amount,
    currency: order.currency,
    buyerReference: order.customerEmail.trim() || order.orderId,
    description,
    returnUrl: `${getSiteUrl()}${RETURN_PATH}?order=${encodeURIComponent(order.orderId)}`,
    notifyUrl,
  })

  await updateWfpPayment(row.id, {
    checkoutUrl: created.checkoutUrl,
    ...(created.payToId ? { payToId: created.payToId } : {}),
  })
  return { approvalUrl: created.checkoutUrl, providerOrderId: row.id }
}

// What the confirm route calls. Reports where the payment has got to,
// re-validating amount and currency and never trusting the client payload -
// which is why the payload is not read at all.
async function confirmPayment(order: ShpOrderDraft): Promise<ShpPaymentResult> {
  const settings = await getWorldFirstSettings()
  const row = await getWfpPaymentByOrderId(order.orderId)
  if (!row) return { success: false, error: 'No WorldFirst payment was found for this order.' }

  const payment = await worldfirst.inquirePayment(settings.environment, row.id)
  await updateWfpPayment(row.id, { status: payment.status })

  const outcome = worldFirstSettlementOutcome(payment.status)
  if (outcome === 'not-started') return { success: false, error: 'This payment has not been completed with WorldFirst yet.' }
  if (outcome === 'failed') return { success: false, error: 'The WorldFirst payment did not go through.' }

  if (!paymentMatchesOrder(payment, { total: order.amount, currency: order.currency })) {
    return { success: false, error: 'This payment could not be confirmed. Please contact us before trying again.' }
  }
  return { success: true, providerReference: payment.payToId ?? row.id }
}

// Records the refund; it does not move the money.
//
// WorldFirst's refund call needs refund-to details that only come with partner
// onboarding, so this ships as a MANUAL refund method, the same as bank transfer
// and cash: pressing Refund takes the items off the order, credits the books and
// sends the customer their credit note, and whoever pressed it still sends the
// money back from the WorldFirst account. Returning a refusal instead would
// leave a sale in the books with no stock returned and no credit note. See
// `refundMode` on ShpPaymentProvider.
async function refundOrder(_refund: ShpRefundRequest): Promise<ShpRefundResult> {
  return { success: true }
}

export const worldFirstProvider: ShpPaymentProvider = {
  id: METHOD_ID,
  label: 'Pay via WorldFirst',
  description: 'Pay securely on WorldFirst’s own page, then come straight back.',
  confirmMode: 'auto',
  // The shopper pays on a page this site never sees, and most who go there do
  // not come back. An order written before they left would be an order nobody
  // had paid for, so the checkout drafts it and settle.ts creates it the moment
  // the money is confirmed.
  orderCreation: 'on-payment',
  // createIntent works off an order id and an amount, and every settlement path
  // goes through materialiseDraftOrder, which hands back an order that already
  // exists just as happily as it creates one.
  settlesExistingOrder: true,
  refundMode: 'manual',
  isAvailable,
  createIntent,
  confirmPayment,
  refundOrder,
}
