// Shared confirmation logic used by both the redirect-return route and the
// notification webhook: given our payment row and the payment as WorldFirst
// reports it now, move the shop order to its final state exactly once.
//
// Either path may arrive first and both routinely arrive within a second of
// each other, so everything here is idempotent.
import { getOrderById, markOrderPaid, markOrderPaymentFailed, setOrderPaymentReference } from '@/modules/shop/lib/db/orders'
import { getCheckoutDraft, materialiseDraftOrder } from '@/modules/shop/lib/checkout-draft'
import { fulfillPaidOrder } from '@/modules/shop/lib/order-fulfillment'
import type { WorldFirstPaymentState } from '@/modules/pay-via-worldfirst-for-shop/lib/worldfirst'
import { worldFirstSettlementOutcome } from '@/modules/pay-via-worldfirst-for-shop/lib/status'
import { toMinorUnits } from '@/modules/pay-via-worldfirst-for-shop/lib/amount'
import { updateWfpPayment, type WfpPayment } from '@/modules/pay-via-worldfirst-for-shop/lib/db'

const LOG = '[pay-via-worldfirst]'

/** Whether a settled payment is genuinely for this order: same money, same
 *  currency. Exported for the tests, and checked on EVERY settlement path - a
 *  guard that lives on only one of the two is on the one least likely to be
 *  taken.
 *
 *  Compared in whole minor units. No amount at all is not a match: "we could
 *  not see what was paid" must never read as "the right amount was paid". */
export function paymentMatchesOrder(
  payment: Pick<WorldFirstPaymentState, 'receivedMinor' | 'currency'>,
  order: { total: unknown; currency: string },
): boolean {
  if (payment.receivedMinor === null) return false
  const total = Number(order.total)
  if (!Number.isFinite(total)) return false
  if (payment.currency.toUpperCase() !== order.currency.toUpperCase()) return false
  return toMinorUnits(total, order.currency) === payment.receivedMinor
}

export async function settleFromPayment(row: WfpPayment, payment: WorldFirstPaymentState): Promise<void> {
  await updateWfpPayment(row.id, { status: payment.status, ...(payment.payToId ? { payToId: payment.payToId } : {}) })

  const outcome = worldFirstSettlementOutcome(payment.status)

  if (outcome === 'not-started') {
    // Every shopper who reached the cashier page and has not paid (yet). Nothing
    // has happened, so nothing happens here. Emphatically NOT a failure.
    return
  }

  if (outcome === 'failed') {
    // No order at all means the shopper never got far enough to have one, which
    // is the point of drafting them: a payment that fell over leaves nothing
    // behind to mark.
    const order = await getOrderById(row.orderId)
    if (!order) return
    if (order.paymentStatus === 'PAID') {
      // A late failure against an order that is already paid is a contradiction,
      // and downgrading a paid order on the strength of it would tell a shopper
      // who has paid that they have not. Logged loudly for a human instead.
      console.error(`${LOG} payment ${row.id} reports ${payment.status} against order ${order.orderNumber}, which is already PAID - left alone`)
      return
    }
    await markOrderPaymentFailed(row.orderId, 'FAILED')
    return
  }

  // Never fulfil - or create - on status alone. A payment whose amount or
  // currency does not match is not this order's payment. Checked against the
  // order where there is one and against the draft where there is not yet,
  // because it has to happen BEFORE the order is brought into being.
  const target = (await getOrderById(row.orderId)) ?? (await getCheckoutDraft(row.orderId))
  if (!target) {
    console.error(`${LOG} payment ${row.id} settled against a missing order ${row.orderId}`)
    return
  }
  if (!paymentMatchesOrder(payment, target)) {
    // Left unfulfilled and loudly logged so a human looks at it - deliberately
    // not failed either, because on a successful payment the money HAS been
    // taken and telling the shopper their payment failed would be its own kind
    // of wrong.
    console.error(
      `${LOG} payment ${row.id} does not match order ${target.orderNumber}: ` +
      `received ${payment.receivedMinor ?? 'no amount'} minor units ${payment.currency}, order expects ${target.total} ${target.currency}`,
    )
    return
  }

  // The money is in, so the order earns its existence. Idempotent, so the
  // redirect back and the notification racing each other create exactly one.
  const order = await materialiseDraftOrder(row.orderId)
  if (!order) {
    console.error(`${LOG} payment ${row.id} could not be given an order (${row.orderId})`)
    return
  }

  await setOrderPaymentReference(order.id, payment.payToId ?? row.id)
  // markOrderPaid is idempotent (no-op once already PAID), so a replayed
  // notification can't fulfil the order twice.
  const justPaid = await markOrderPaid(order.id, payment.payToId ?? row.id)
  if (justPaid) await fulfillPaidOrder(order.id)
}
