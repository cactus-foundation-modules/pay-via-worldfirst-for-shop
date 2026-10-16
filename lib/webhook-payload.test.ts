import { describe, expect, it } from 'vitest'
import { ACKNOWLEDGEMENT_BODY, readNotification } from '@/modules/pay-via-worldfirst-for-shop/lib/webhook-payload'
import { isReachableWebhookUrl, worldFirstWebhookUrl } from '@/modules/pay-via-worldfirst-for-shop/lib/webhook-url'

describe('readNotification', () => {
  it('reads our payment id out of a notifyPayment body', () => {
    const body = JSON.stringify({
      notifyType: 'PAYMENT_RESULT',
      payToRequestId: 'pay-123',
      payToId: 'wf-9',
      paymentId: 'wf-9',
      result: { resultStatus: 'S', resultCode: 'SUCCESS' },
    })
    expect(readNotification(body)).toMatchObject({ payToRequestId: 'pay-123', notifyType: 'PAYMENT_RESULT' })
  })

  it('refuses a body with no payment id, non-JSON, and over-long ids', () => {
    expect(readNotification('{}')).toBeNull()
    expect(readNotification('nope')).toBeNull()
    expect(readNotification(JSON.stringify({ payToRequestId: '' }))).toBeNull()
    expect(readNotification(JSON.stringify({ payToRequestId: 'x'.repeat(65) }))).toBeNull()
  })
})

describe('acknowledgement', () => {
  it('is the exact fixed reply WorldFirst waits for', () => {
    expect(JSON.parse(ACKNOWLEDGEMENT_BODY)).toEqual({
      result: { resultStatus: 'S', resultCode: 'SUCCESS', resultMessage: 'success' },
    })
  })
})

describe('webhook url', () => {
  it('is built from the site url without a doubled slash', () => {
    expect(worldFirstWebhookUrl('https://shop.example.com/')).toBe('https://shop.example.com/api/m/pay-via-worldfirst-for-shop/webhook')
  })

  it('is only reachable on a public https site', () => {
    expect(isReachableWebhookUrl('https://shop.example.com/x')).toBe(true)
    expect(isReachableWebhookUrl('http://shop.example.com/x')).toBe(false)
    expect(isReachableWebhookUrl('https://localhost:3000/x')).toBe(false)
    expect(isReachableWebhookUrl('https://127.0.0.1/x')).toBe(false)
    expect(isReachableWebhookUrl('nonsense')).toBe(false)
  })
})
