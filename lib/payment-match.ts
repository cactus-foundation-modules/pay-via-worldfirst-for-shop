// Kept apart from lib/settle.ts on purpose. settle.ts imports the shop's order
// fulfilment, which imports the shop's payment registry, which imports this
// module's provider - so a provider that imports settle.ts closes a circle, and
// the production build dies with "Cannot access 'c' before initialization" on
// whichever route first loads the registry. This file is pure (no shop, no
// database), so both sides can import it safely.
import type { WorldFirstPaymentState } from '@/modules/pay-via-worldfirst-for-shop/lib/worldfirst'
import { toMinorUnits } from '@/modules/pay-via-worldfirst-for-shop/lib/amount'

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
