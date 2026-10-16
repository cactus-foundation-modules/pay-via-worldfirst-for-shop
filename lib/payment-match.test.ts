import { describe, expect, it } from 'vitest'
import { paymentMatchesOrder } from '@/modules/pay-via-worldfirst-for-shop/lib/payment-match'

// A payment can only fulfil an order if it is for that order's money.

describe('paymentMatchesOrder', () => {
  it('accepts the right money in the right currency', () => {
    expect(paymentMatchesOrder({ receivedMinor: 48400, currency: 'GBP' }, { total: '484.00', currency: 'GBP' })).toBe(true)
  })

  it('takes the decimal strings and numbers the order layer hands it', () => {
    expect(paymentMatchesOrder({ receivedMinor: 160000, currency: 'GBP' }, { total: '1600.00', currency: 'GBP' })).toBe(true)
    expect(paymentMatchesOrder({ receivedMinor: 400, currency: 'GBP' }, { total: 4, currency: 'GBP' })).toBe(true)
  })

  it('refuses an underpayment, an overpayment and a penny out', () => {
    expect(paymentMatchesOrder({ receivedMinor: 100, currency: 'GBP' }, { total: '484.00', currency: 'GBP' })).toBe(false)
    expect(paymentMatchesOrder({ receivedMinor: 99999, currency: 'GBP' }, { total: '484.00', currency: 'GBP' })).toBe(false)
    expect(paymentMatchesOrder({ receivedMinor: 48399, currency: 'GBP' }, { total: '484.00', currency: 'GBP' })).toBe(false)
  })

  it('refuses the right number in the wrong currency', () => {
    expect(paymentMatchesOrder({ receivedMinor: 48400, currency: 'EUR' }, { total: '484.00', currency: 'GBP' })).toBe(false)
  })

  it('is not fussy about the case of a currency code', () => {
    expect(paymentMatchesOrder({ receivedMinor: 48400, currency: 'gbp' }, { total: '484.00', currency: 'GBP' })).toBe(true)
  })

  it('refuses an order whose total cannot be read as money', () => {
    expect(paymentMatchesOrder({ receivedMinor: 48400, currency: 'GBP' }, { total: null, currency: 'GBP' })).toBe(false)
    expect(paymentMatchesOrder({ receivedMinor: 48400, currency: 'GBP' }, { total: 'nonsense', currency: 'GBP' })).toBe(false)
  })

  // "We could not see what was paid" must never read as "the right amount was paid".
  it('refuses a payment that reports no amount at all', () => {
    expect(paymentMatchesOrder({ receivedMinor: null, currency: 'GBP' }, { total: '484.00', currency: 'GBP' })).toBe(false)
  })

  it('compares in minor units rather than in floats', () => {
    expect(paymentMatchesOrder({ receivedMinor: 1999, currency: 'GBP' }, { total: '19.99', currency: 'GBP' })).toBe(true)
    expect(paymentMatchesOrder({ receivedMinor: 7, currency: 'GBP' }, { total: '0.07', currency: 'GBP' })).toBe(true)
  })

  it('handles a currency with no decimals', () => {
    expect(paymentMatchesOrder({ receivedMinor: 1500, currency: 'JPY' }, { total: '1500', currency: 'JPY' })).toBe(true)
  })
})
