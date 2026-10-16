// This module's own settings: the on/off toggle, the description shown on the
// WorldFirst cashier page, which of the two environments the shop takes
// payments in, the API host WorldFirst assigned for each, and which currencies
// the method is offered for.
//
// The environment lives here rather than in an environment variable because an
// environment variable on a hosted project does not reach the running server
// until the next deployment. A stored setting takes effect on the next request.
//
// The credentials themselves stay in environment variables, because they are
// secrets and the database is included in backups.
import { prisma } from '@/lib/db/prisma'
import { parseAcceptedCurrencies } from '@/modules/pay-via-worldfirst-for-shop/lib/amount'

export type WorldFirstEnvironment = 'production' | 'sandbox'

// Sandbox is the fallback because getting this wrong is real money moving.
const FALLBACK_ENVIRONMENT: WorldFirstEnvironment = 'sandbox'

// WorldFirst's orderGroupDescription limit.
export const MAX_PAYMENT_DESCRIPTION_LENGTH = 64

export type WorldFirstSettings = {
  enabled: boolean
  paymentDescription: string
  environment: WorldFirstEnvironment
  apiBaseUrlSandbox: string
  apiBaseUrlProduction: string
  acceptedCurrencies: string[]
}

const FALLBACK: WorldFirstSettings = {
  enabled: false,
  paymentDescription: '',
  environment: FALLBACK_ENVIRONMENT,
  apiBaseUrlSandbox: '',
  apiBaseUrlProduction: '',
  acceptedCurrencies: ['GBP'],
}

function toEnvironment(stored: unknown): WorldFirstEnvironment {
  return stored === 'production' || stored === 'sandbox' ? stored : FALLBACK_ENVIRONMENT
}

export function clampPaymentDescription(stored: unknown): string {
  return typeof stored === 'string' ? stored.trim().slice(0, MAX_PAYMENT_DESCRIPTION_LENGTH) : ''
}

/**
 * The origin of a WorldFirst API host, or '' when what was typed is not one.
 *
 * https only, and only the origin: every request is signed over the path that
 * follows it, so a stray path or query on the host would corrupt the signature
 * and fail every call with an error nobody could read. Credentials and a
 * private key travel to this host, so plain http is never acceptable.
 */
export function normaliseApiBaseUrl(stored: unknown): string {
  if (typeof stored !== 'string' || stored.trim() === '') return ''
  const candidate = stored.trim().includes('://') ? stored.trim() : `https://${stored.trim()}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) return ''
    if (url.username || url.password) return ''
    return url.origin
  } catch {
    return ''
  }
}

export function apiBaseUrlFor(settings: Pick<WorldFirstSettings, 'apiBaseUrlSandbox' | 'apiBaseUrlProduction'>, environment: WorldFirstEnvironment): string {
  return environment === 'sandbox' ? settings.apiBaseUrlSandbox : settings.apiBaseUrlProduction
}

export async function getWorldFirstSettings(): Promise<WorldFirstSettings> {
  const rows = await prisma.$queryRaw<Record<string, unknown>[]>`
    SELECT * FROM "wfp_settings" WHERE "id" = 'singleton' LIMIT 1
  `
  const r = rows[0]
  if (!r) return FALLBACK
  return {
    enabled: r.enabled === true,
    paymentDescription: clampPaymentDescription(r.payment_description),
    environment: toEnvironment(r.environment),
    apiBaseUrlSandbox: normaliseApiBaseUrl(r.api_base_url_sandbox),
    apiBaseUrlProduction: normaliseApiBaseUrl(r.api_base_url_production),
    acceptedCurrencies: parseAcceptedCurrencies(r.accepted_currencies),
  }
}

export async function updateWorldFirstSettings(input: Partial<WorldFirstSettings>): Promise<WorldFirstSettings> {
  const current = await getWorldFirstSettings()
  const merged: WorldFirstSettings = {
    ...current,
    ...input,
    paymentDescription: clampPaymentDescription(input.paymentDescription ?? current.paymentDescription),
    apiBaseUrlSandbox: input.apiBaseUrlSandbox !== undefined ? normaliseApiBaseUrl(input.apiBaseUrlSandbox) : current.apiBaseUrlSandbox,
    apiBaseUrlProduction: input.apiBaseUrlProduction !== undefined ? normaliseApiBaseUrl(input.apiBaseUrlProduction) : current.apiBaseUrlProduction,
    acceptedCurrencies: input.acceptedCurrencies ? parseAcceptedCurrencies(input.acceptedCurrencies.join(',')) : current.acceptedCurrencies,
  }
  const currencies = merged.acceptedCurrencies.join(',')
  await prisma.$executeRaw`
    INSERT INTO "wfp_settings" ("id", "enabled", "payment_description", "environment", "api_base_url_sandbox", "api_base_url_production", "accepted_currencies", "updated_at")
    VALUES ('singleton', ${merged.enabled}, ${merged.paymentDescription}, ${merged.environment}, ${merged.apiBaseUrlSandbox}, ${merged.apiBaseUrlProduction}, ${currencies}, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "enabled" = ${merged.enabled},
      "payment_description" = ${merged.paymentDescription},
      "environment" = ${merged.environment},
      "api_base_url_sandbox" = ${merged.apiBaseUrlSandbox},
      "api_base_url_production" = ${merged.apiBaseUrlProduction},
      "accepted_currencies" = ${currencies},
      "updated_at" = CURRENT_TIMESTAMP
  `
  return getWorldFirstSettings()
}
