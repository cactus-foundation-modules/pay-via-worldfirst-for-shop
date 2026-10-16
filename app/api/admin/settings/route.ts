// GET/PATCH /api/m/pay-via-worldfirst-for-shop/admin/settings
// Non-secret module settings: the on/off toggle, the description shown on
// WorldFirst's cashier page, which environment the shop takes payments in, the
// API address WorldFirst assigned for each, and the currencies offered. The
// credentials themselves are environment variables and go nowhere near here.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireShopUser } from '@/modules/shop/lib/access'
import {
  getWorldFirstSettings,
  MAX_PAYMENT_DESCRIPTION_LENGTH,
  normaliseApiBaseUrl,
  updateWorldFirstSettings,
} from '@/modules/pay-via-worldfirst-for-shop/lib/settings'

export async function GET() {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error
  return NextResponse.json(await getWorldFirstSettings())
}

// An address is refused outright rather than silently blanked when it is not a
// usable https origin: a save that came back empty reads as a bug.
const ApiAddress = z.string().max(300).refine((value) => value.trim() === '' || normaliseApiBaseUrl(value) !== '', {
  message: 'That is not a usable address. It needs to be a secure (https) web address.',
})

const PatchBody = z.object({
  enabled: z.boolean().optional(),
  paymentDescription: z.string().max(MAX_PAYMENT_DESCRIPTION_LENGTH).optional(),
  // Stored rather than an env var, so switching between test and real money
  // takes effect on the next request instead of the next deployment.
  environment: z.enum(['sandbox', 'production']).optional(),
  apiBaseUrlSandbox: ApiAddress.optional(),
  apiBaseUrlProduction: ApiAddress.optional(),
  acceptedCurrencies: z.array(z.string().regex(/^[A-Za-z]{3}$/, 'Currencies are three-letter codes, like GBP')).min(1).max(20).optional(),
})

export async function PATCH(request: NextRequest) {
  const gate = await requireShopUser('shop.manage')
  if (gate.error) return gate.error

  const parsed = PatchBody.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 })

  return NextResponse.json(await updateWorldFirstSettings(parsed.data))
}
