// Money, in the one unit WorldFirst actually uses.
//
// WorldFirst's Amount.value is "in the smallest currency unit" - pence, cents -
// and arrives back as a STRING even though it is sent as an integer. The shop
// hands over major units (ShpOrderDraft.amount, "19.99"), so the conversion
// lives here and nowhere else.
//
// Comparison is always done in minor units. Two decimals compared as floats is
// how 19.99 fails to equal 19.99, and on the settlement path that means money
// taken and an order not fulfilled.

// ISO 4217 currencies that do not have two decimal places. Anything not listed
// is treated as two, which is the overwhelming majority.
const ZERO_DECIMAL = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'])
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'])

export function currencyExponent(currency: string): number {
  const code = currency.trim().toUpperCase()
  if (ZERO_DECIMAL.has(code)) return 0
  if (THREE_DECIMAL.has(code)) return 3
  return 2
}

/** Major units to whole minor units. The toFixed step collapses binary
 *  representation error before the half-up decision: a bare Math.round(1.005 *
 *  100) gives 100 where anybody who wrote 1.005 down means 101. */
export function toMinorUnits(amount: number, currency: string): number {
  const factor = 10 ** currencyExponent(currency)
  return Math.round(Number((amount * factor).toFixed(6)))
}

/** WorldFirst's value (string or number of minor units) to a whole number, or
 *  null when it is not one. Never NaN, never a guess. */
export function parseMinorUnits(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null
  if (typeof value === 'string' && /^\d{1,16}$/.test(value.trim())) return Number(value.trim())
  return null
}

/** The shop's major-unit figure, rounded the way WorldFirst will hold it. */
export function roundToCurrency(amount: number, currency: string): number {
  return toMinorUnits(amount, currency) / 10 ** currencyExponent(currency)
}

/** "GBP, eur ,GBP" -> ['GBP', 'EUR']. Anything that is not three letters is
 *  dropped, and an empty result falls back to GBP so a blank box can never
 *  switch the method off by accident. */
export function parseAcceptedCurrencies(stored: unknown): string[] {
  const raw = typeof stored === 'string' ? stored : ''
  const codes = raw
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => /^[A-Z]{3}$/.test(code))
  const unique = [...new Set(codes)]
  return unique.length > 0 ? unique : ['GBP']
}

export function isAcceptedCurrency(currency: string, accepted: readonly string[]): boolean {
  return accepted.includes(currency.trim().toUpperCase())
}
