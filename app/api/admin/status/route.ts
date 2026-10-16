// GET /api/m/pay-via-worldfirst-for-shop/admin/status
// Reports whether the credentials for the LIVE environment are set and whether
// WorldFirst accepts them.
//
// Credentials are reported one at a time rather than as a single "configured"
// flag, so the panel can name what is actually missing.
import { NextResponse } from 'next/server'
import { getSiteUrl } from '@/lib/config/env'
import { requireShopUser } from '@/modules/shop/lib/access'
import { getWorldFirstCredentials, isWorldFirstConfigured } from '@/modules/pay-via-worldfirst-for-shop/lib/env'
import { apiBaseUrlFor, getWorldFirstSettings } from '@/modules/pay-via-worldfirst-for-shop/lib/settings'
import { verifyCredentials } from '@/modules/pay-via-worldfirst-for-shop/lib/worldfirst'
import { isReachableWebhookUrl, worldFirstWebhookUrl } from '@/modules/pay-via-worldfirst-for-shop/lib/webhook-url'

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error

  const settings = await getWorldFirstSettings()
  const { environment } = settings
  const creds = getWorldFirstCredentials(environment)
  const webhookUrl = worldFirstWebhookUrl(getSiteUrl())
  const base = {
    environment,
    clientIdSet: !!creds.clientId,
    privateKeySet: !!creds.privateKey,
    publicKeySet: !!creds.publicKey,
    apiAddressSet: !!apiBaseUrlFor(settings, environment),
    webhookUrl,
    webhookReachable: isReachableWebhookUrl(webhookUrl),
  }

  if (!isWorldFirstConfigured(environment) || !base.apiAddressSet) {
    return NextResponse.json({ ...base, configured: false })
  }

  try {
    await verifyCredentials(environment)
    return NextResponse.json({ ...base, configured: true, connected: true })
  } catch (err) {
    return NextResponse.json({
      ...base,
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    })
  }
}
