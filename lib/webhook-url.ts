// Where WorldFirst posts payment notifications. Sent with every payment as
// paymentNotifyUrl rather than registered in a dashboard, so there is nothing
// for the owner to paste anywhere.
export const WEBHOOK_PATH = '/api/m/pay-via-worldfirst-for-shop/webhook'
export const RETURN_PATH = '/api/m/pay-via-worldfirst-for-shop/return'

export function worldFirstWebhookUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}${WEBHOOK_PATH}`
}

/** WorldFirst can only deliver to a public https address. A localhost or plain
 *  http site would be sent as paymentNotifyUrl and simply never called. */
export function isReachableWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return host !== 'localhost' && !host.endsWith('.localhost') && host !== '127.0.0.1' && host !== '[::1]'
  } catch {
    return false
  }
}
