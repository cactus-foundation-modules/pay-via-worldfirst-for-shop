// What a notifyPayment delivery says, narrowed to the little this module uses.
//
// The body is a nudge, never evidence. Whatever it claims, the payment's state
// is read back from WorldFirst's own inquiry call - signed by us, answered over
// TLS from the host the owner entered - before anything is settled. So the only
// field that matters here is the payToRequestId, which is OUR payment id.
import { z } from 'zod'

const NotificationSchema = z.object({
  notifyType: z.string().optional(),
  payToRequestId: z.string().min(1).max(64),
  payToId: z.string().optional(),
  paymentId: z.string().optional(),
})

export type WorldFirstNotification = z.infer<typeof NotificationSchema>

/** null when the body is not a notification this module can act on. */
export function readNotification(rawBody: string): WorldFirstNotification | null {
  let json: unknown
  try {
    json = JSON.parse(rawBody)
  } catch {
    return null
  }
  const parsed = NotificationSchema.safeParse(json)
  return parsed.success ? parsed.data : null
}

// The fixed acknowledgement WorldFirst waits for. Anything else and it retries
// at 2m, 10m, 10m, 1h, 2h, 6h and 15h. Held as the exact string because the
// reply is signed over its bytes.
export const ACKNOWLEDGEMENT_BODY = JSON.stringify({
  result: { resultStatus: 'S', resultCode: 'SUCCESS', resultMessage: 'success' },
})
