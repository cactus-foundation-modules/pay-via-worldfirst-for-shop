// WorldFirst's payment statuses (payToSummaries[].orderResult.status), and what
// each one means for a shop order.
//
// Every status named in WorldFirst's documentation is named here and nothing
// falls through. An unrecognised status throws, because an unhandled status on
// a payment route is how money goes quiet: a "least-worst" default either ships
// goods against a payment that never happened or tells a shopper who has paid
// that they have not.

export type WorldFirstPaymentStatus =
  // WorldFirst is processing the payment. The documentation uses this for the
  // whole interval before a result, which includes a cashier page nobody has
  // paid on yet - so it cannot be told apart from "in flight" and is read as
  // "nothing has happened". Safe: only PAY_SUCCESS ever creates an order.
  | 'WAIT_PAY'
  | 'PAY_SUCCESS'
  | 'PAY_FAILED'
  | 'PAY_CANCELLED'

const KNOWN: readonly WorldFirstPaymentStatus[] = ['WAIT_PAY', 'PAY_SUCCESS', 'PAY_FAILED', 'PAY_CANCELLED']

/** Thrown rather than defaulted. See the note at the top of this file. */
export class UnknownWorldFirstStatusError extends Error {
  constructor(readonly raw: unknown) {
    super(`WorldFirst returned a payment status this module does not recognise: ${JSON.stringify(raw)}`)
    this.name = 'UnknownWorldFirstStatusError'
  }
}

export function parseWorldFirstPaymentStatus(raw: unknown): WorldFirstPaymentStatus {
  if (typeof raw === 'string') {
    const found = KNOWN.find((status) => status === raw)
    if (found) return found
  }
  throw new UnknownWorldFirstStatusError(raw)
}

/**
 *  'not-started' - nothing has happened (or nothing visible yet). Leave the
 *                  order alone. NOT a failure.
 *  'paid'        - the money is in. Fulfil.
 *  'failed'      - it is not coming (failed or cancelled).
 */
export type WorldFirstSettlementOutcome = 'not-started' | 'paid' | 'failed'

export function worldFirstSettlementOutcome(status: WorldFirstPaymentStatus): WorldFirstSettlementOutcome {
  switch (status) {
    case 'WAIT_PAY':
      return 'not-started'
    case 'PAY_SUCCESS':
      return 'paid'
    case 'PAY_FAILED':
    case 'PAY_CANCELLED':
      return 'failed'
  }
}
