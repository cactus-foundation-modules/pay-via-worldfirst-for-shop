import { describe, expect, it } from 'vitest'
import {
  parseWorldFirstPaymentStatus,
  UnknownWorldFirstStatusError,
  worldFirstSettlementOutcome,
} from '@/modules/pay-via-worldfirst-for-shop/lib/status'

describe('parseWorldFirstPaymentStatus', () => {
  it('accepts the four documented statuses', () => {
    for (const status of ['WAIT_PAY', 'PAY_SUCCESS', 'PAY_FAILED', 'PAY_CANCELLED']) {
      expect(parseWorldFirstPaymentStatus(status)).toBe(status)
    }
  })

  it('throws on anything else instead of guessing', () => {
    for (const bad of ['SUCCESS', 'pay_success', '', null, undefined, 3]) {
      expect(() => parseWorldFirstPaymentStatus(bad)).toThrow(UnknownWorldFirstStatusError)
    }
  })
})

describe('worldFirstSettlementOutcome', () => {
  it('only PAY_SUCCESS is paid', () => {
    expect(worldFirstSettlementOutcome('PAY_SUCCESS')).toBe('paid')
  })

  it('WAIT_PAY is nothing-has-happened, never a failure', () => {
    expect(worldFirstSettlementOutcome('WAIT_PAY')).toBe('not-started')
  })

  it('failed and cancelled are failed', () => {
    expect(worldFirstSettlementOutcome('PAY_FAILED')).toBe('failed')
    expect(worldFirstSettlementOutcome('PAY_CANCELLED')).toBe('failed')
  })
})
