import { describe, expect, it } from 'vitest'
import { readInquiryResponse, requestTimestamp } from '@/modules/pay-via-worldfirst-for-shop/lib/worldfirst'
import { UnknownWorldFirstStatusError } from '@/modules/pay-via-worldfirst-for-shop/lib/status'

const ok = { resultStatus: 'S', resultCode: 'SUCCESS', resultMessage: 'success.' }

function summary(overrides: Record<string, unknown> = {}) {
  return {
    orderResult: { status: 'PAY_SUCCESS' },
    payToAmount: { currency: 'GBP', value: '48400' },
    payToCreateTime: '2026-10-16T00:00:00+00:00',
    payToId: 'wf-1',
    payToRequestId: 'pay-1',
    ...overrides,
  }
}

describe('readInquiryResponse', () => {
  it('reads a paid payment, amounts arriving as strings', () => {
    expect(readInquiryResponse({ result: ok, payToSummaries: [summary()] }, 'pay-1')).toEqual({
      status: 'PAY_SUCCESS',
      payToId: 'wf-1',
      receivedMinor: 48400,
      currency: 'GBP',
    })
  })

  it('accepts a number as well as a string amount', () => {
    const state = readInquiryResponse({ result: ok, payToSummaries: [summary({ payToAmount: { currency: 'gbp', value: 100 } })] }, 'pay-1')
    expect(state.receivedMinor).toBe(100)
    expect(state.currency).toBe('GBP')
  })

  it('reads an unpaid payment as WAIT_PAY', () => {
    const state = readInquiryResponse({ result: ok, payToSummaries: [summary({ orderResult: { status: 'WAIT_PAY' } })] }, 'pay-1')
    expect(state.status).toBe('WAIT_PAY')
  })

  it('only ever reads the summary for OUR payment id', () => {
    expect(() => readInquiryResponse({ result: ok, payToSummaries: [summary({ payToRequestId: 'someone-else' })] }, 'pay-1')).toThrow()
  })

  it('treats PROCESSING with nothing to report as WAIT_PAY', () => {
    const state = readInquiryResponse({ result: { ...ok, resultCode: 'PROCESSING' }, payToSummaries: [] }, 'pay-1')
    expect(state.status).toBe('WAIT_PAY')
    expect(state.receivedMinor).toBeNull()
  })

  it('reports no amount rather than inventing one', () => {
    const state = readInquiryResponse({ result: ok, payToSummaries: [summary({ payToAmount: undefined })] }, 'pay-1')
    expect(state.receivedMinor).toBeNull()
  })

  it('throws on a failed or unknown call', () => {
    expect(() => readInquiryResponse({ result: { resultStatus: 'F', resultCode: 'PARAM_ILLEGAL', resultMessage: 'bad' } }, 'pay-1')).toThrow(/bad/)
    expect(() => readInquiryResponse({ result: { resultStatus: 'U', resultCode: 'UNKNOWN_EXCEPTION' } }, 'pay-1')).toThrow()
  })

  it('throws on an unrecognised payment status', () => {
    expect(() => readInquiryResponse({ result: ok, payToSummaries: [summary({ orderResult: { status: 'MAYBE' } })] }, 'pay-1')).toThrow(UnknownWorldFirstStatusError)
  })

  it('throws on a response that is not the expected shape', () => {
    expect(() => readInquiryResponse({ nope: true }, 'pay-1')).toThrow()
    expect(() => readInquiryResponse(null, 'pay-1')).toThrow()
  })
})

describe('requestTimestamp', () => {
  it('is ISO 8601 to the second with an explicit offset', () => {
    expect(requestTimestamp(new Date('2026-10-16T09:30:00.123Z'))).toBe('2026-10-16T09:30:00+00:00')
  })
})
