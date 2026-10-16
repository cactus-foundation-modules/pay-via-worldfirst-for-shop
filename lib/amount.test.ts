import { describe, expect, it } from 'vitest'
import {
  currencyExponent,
  isAcceptedCurrency,
  parseAcceptedCurrencies,
  parseMinorUnits,
  roundToCurrency,
  toMinorUnits,
} from '@/modules/pay-via-worldfirst-for-shop/lib/amount'

describe('toMinorUnits', () => {
  it('converts pounds to pence', () => {
    expect(toMinorUnits(19.99, 'GBP')).toBe(1999)
    expect(toMinorUnits(484, 'GBP')).toBe(48400)
  })

  it('rounds half-up rather than shaving the penny off float dust', () => {
    expect(toMinorUnits(1.005, 'GBP')).toBe(101)
    expect(toMinorUnits(0.07, 'GBP')).toBe(7)
    expect(toMinorUnits(1234.56, 'GBP')).toBe(123456)
  })

  it('knows the currencies with no decimals and with three', () => {
    expect(currencyExponent('JPY')).toBe(0)
    expect(toMinorUnits(1500, 'JPY')).toBe(1500)
    expect(currencyExponent('KWD')).toBe(3)
    expect(toMinorUnits(1.5, 'KWD')).toBe(1500)
  })

  it('is not fussy about the case of a currency code', () => {
    expect(toMinorUnits(1, 'gbp')).toBe(100)
  })
})

describe('roundToCurrency', () => {
  it('rounds to what the currency can hold', () => {
    expect(roundToCurrency(12.999, 'GBP')).toBe(13)
    expect(roundToCurrency(10.5, 'JPY')).toBe(11)
  })
})

describe('parseMinorUnits', () => {
  it('reads the string WorldFirst returns', () => {
    expect(parseMinorUnits('1000')).toBe(1000)
    expect(parseMinorUnits(' 42 ')).toBe(42)
    expect(parseMinorUnits(0)).toBe(0)
  })

  it('refuses anything that is not a whole non-negative number', () => {
    for (const bad of ['10.50', '-5', '', 'abc', null, undefined, 1.5, -1, Number.NaN, {}]) {
      expect(parseMinorUnits(bad)).toBeNull()
    }
  })
})

describe('accepted currencies', () => {
  it('parses a comma list, upper-cased and de-duplicated', () => {
    expect(parseAcceptedCurrencies('gbp, EUR ,GBP')).toEqual(['GBP', 'EUR'])
  })

  it('drops junk and falls back to GBP when nothing is left', () => {
    expect(parseAcceptedCurrencies('pounds, 12, ,')).toEqual(['GBP'])
    expect(parseAcceptedCurrencies(null)).toEqual(['GBP'])
  })

  it('matches case-insensitively', () => {
    expect(isAcceptedCurrency('gbp', ['GBP'])).toBe(true)
    expect(isAcceptedCurrency('USD', ['GBP'])).toBe(false)
  })
})
