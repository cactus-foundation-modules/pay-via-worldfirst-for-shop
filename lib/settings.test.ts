import { describe, expect, it } from 'vitest'
import {
  apiBaseUrlFor,
  clampPaymentDescription,
  MAX_PAYMENT_DESCRIPTION_LENGTH,
  keyVersionFor,
  normaliseApiBaseUrl,
  normaliseKeyVersion,
} from '@/modules/pay-via-worldfirst-for-shop/lib/settings'

describe('normaliseApiBaseUrl', () => {
  it('keeps just the https origin', () => {
    expect(normaliseApiBaseUrl('https://api.example.com')).toBe('https://api.example.com')
    expect(normaliseApiBaseUrl('https://api.example.com/amsin/api/v1?x=1')).toBe('https://api.example.com')
    expect(normaliseApiBaseUrl('  https://api.example.com/  ')).toBe('https://api.example.com')
  })

  it('assumes https for a bare host', () => {
    expect(normaliseApiBaseUrl('api.example.com')).toBe('https://api.example.com')
  })

  it('refuses plain http - a signing key travels to this host', () => {
    expect(normaliseApiBaseUrl('http://api.example.com')).toBe('')
  })

  it('refuses credentials in the address, junk and blanks', () => {
    expect(normaliseApiBaseUrl('https://user:pass@api.example.com')).toBe('')
    expect(normaliseApiBaseUrl('https://localhost')).toBe('')
    expect(normaliseApiBaseUrl('not a url')).toBe('')
    expect(normaliseApiBaseUrl('')).toBe('')
    expect(normaliseApiBaseUrl(null)).toBe('')
  })
})

describe('apiBaseUrlFor', () => {
  const settings = { apiBaseUrlSandbox: 'https://sandbox.example.com', apiBaseUrlProduction: 'https://live.example.com' }
  it('picks the address for the environment', () => {
    expect(apiBaseUrlFor(settings, 'sandbox')).toBe('https://sandbox.example.com')
    expect(apiBaseUrlFor(settings, 'production')).toBe('https://live.example.com')
  })
})

describe('clampPaymentDescription', () => {
  it('trims and caps at WorldFirst\'s limit', () => {
    expect(clampPaymentDescription('  Shop  ')).toBe('Shop')
    expect(clampPaymentDescription('x'.repeat(100))).toHaveLength(MAX_PAYMENT_DESCRIPTION_LENGTH)
    expect(clampPaymentDescription(undefined)).toBe('')
  })
})

describe('key version', () => {
  it('keeps a short whole number and falls back to 1 for anything else', () => {
    expect(normaliseKeyVersion('2')).toBe('2')
    expect(normaliseKeyVersion(' 12 ')).toBe('12')
    expect(normaliseKeyVersion(3)).toBe('3')
    for (const bad of ['', 'abc', '1.5', '-1', '1234', null, undefined]) expect(normaliseKeyVersion(bad)).toBe('1')
  })

  it('picks the version for the environment', () => {
    const settings = { keyVersionSandbox: '2', keyVersionProduction: '5' }
    expect(keyVersionFor(settings, 'sandbox')).toBe('2')
    expect(keyVersionFor(settings, 'production')).toBe('5')
  })
})
