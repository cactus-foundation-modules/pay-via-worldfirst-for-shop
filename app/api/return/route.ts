// GET /api/m/pay-via-worldfirst-for-shop/return
// The paymentRedirectUrl WorldFirst sends the shopper back to once they have
// been through its cashier page. Confirms server-side, then hands off to the
// shop confirmation page. The notification remains the source of truth for a
// shopper who never comes back - this is simply the first of the two to arrive
// most of the time.
//
// This method does not create its order until the money is confirmed (see
// shop's lib/checkout-draft), so there may be no order here at all - and where
// the shopper backed out, there should not be. That case goes back to the
// checkout with the basket still in it, rather than to a confirmation page for
// something nobody paid for.
import { NextRequest, NextResponse } from 'next/server'
import { getSiteUrl } from '@/lib/config/env'
import { signOrderReceiptToken } from '@/modules/shop/lib/order-receipt-token'
import { getOrderById } from '@/modules/shop/lib/db/orders'
import { inquirePayment } from '@/modules/pay-via-worldfirst-for-shop/lib/worldfirst'
import { getWfpPaymentByOrderId } from '@/modules/pay-via-worldfirst-for-shop/lib/db'
import { getWorldFirstSettings } from '@/modules/pay-via-worldfirst-for-shop/lib/settings'
import { settleFromPayment } from '@/modules/pay-via-worldfirst-for-shop/lib/settle'

const LOG = '[pay-via-worldfirst]'

export async function GET(request: NextRequest) {
  const siteUrl = getSiteUrl()
  const checkoutUrl = `${siteUrl}/shop/checkout`

  const orderId = request.nextUrl.searchParams.get('order')
  if (!orderId) return NextResponse.redirect(checkoutUrl)

  const row = await getWfpPaymentByOrderId(orderId)
  if (!row) return NextResponse.redirect(checkoutUrl)
  const abandonedUrl = row.returnPath ? `${siteUrl}${row.returnPath}` : checkoutUrl

  try {
    const settings = await getWorldFirstSettings()
    // Asked of WorldFirst, never read out of the query string: anything a
    // browser can carry is something a browser can be made to carry.
    await settleFromPayment(row, await inquirePayment(settings.environment, row.id))
  } catch (err) {
    // If WorldFirst is unreachable on return, leave things as they are; the
    // notification settles it. Nothing here is the last word.
    console.error(`${LOG} return confirmation failed`, err)
  }

  // Read after settling, never before: on this method the order is very often
  // brought into being by the line above.
  const order = await getOrderById(orderId)
  if (!order) return NextResponse.redirect(abandonedUrl)

  // A payment started somewhere other than the checkout goes back where it came
  // from. The path was stored when the payment was created, never read out of
  // this URL.
  if (row.returnPath) return NextResponse.redirect(`${siteUrl}${row.returnPath}`)

  // The signed receipt token, never the customer's email address: a redirect URL
  // lands in access logs, browser history and Referer headers.
  const confirmationUrl =
    `${siteUrl}/shop/checkout/confirmation` +
    `?orderNumber=${encodeURIComponent(order.orderNumber)}&t=${encodeURIComponent(signOrderReceiptToken(order.orderNumber))}`
  return NextResponse.redirect(confirmationUrl)
}
