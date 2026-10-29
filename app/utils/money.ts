/**
 * FEAT-084 (api-contract v1 §6, spec "UI behaviour" B5 / A12) — the money vocabulary of the BO.
 *
 * - **main amount / sub amount**: every money cell is a pair (`MoneyCell`); the main currency of a table is one
 *   currency, chosen per page by `useMoneyMode(pageKey)` (`thb` | `account`).
 * - `฿` marks a **converted or total** THB amount (0 decimals): `฿ 1,665`. A raw amount keeps its ISO code and
 *   2 decimals: `20.10 USD`, `665.00 THB` — so a THB-native row and a converted one look different on purpose.
 * - The BO never converts: every THB figure comes from the API (`spendThb`, `thb` blocks, `fx.thbAmount`,
 *   aggregates). The only arithmetic here is `costThb()` (a division of two API numbers) and summing amounts
 *   that are already THB (the accounts footer, spec A11).
 */
import type { MoneyByCurrency, MoneyUnconverted, MoneyUnconvertedItem, FxReportBlock, ThbBlock } from '#shared/types/fx'

export type MoneyMode = 'thb' | 'account'

export const MONEY_DASH = '—'
export const UNCONVERTED_HINT = 'ยอดที่ยังไม่รู้สกุล/ไม่มีอัตรา ไม่ได้รวม'
export const SORT_BY_THB_HINT = 'เรียงด้วยค่า THB'

const fmtCache = new Map<number, Intl.NumberFormat>()
function fmt(decimals: number): Intl.NumberFormat {
  let f = fmtCache.get(decimals)
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    fmtCache.set(decimals, f)
  }
  return f
}

/** up to 2 decimals, none when whole (`50`, `5.5`) — used for the compact `+50 ?` marker */
const COMPACT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** `1,665` with `decimals` (default 0); `—` for null/NaN */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  return isNum(value) ? fmt(decimals).format(value) : MONEY_DASH
}

/** `฿ 1,665` — converted / total THB, 0 decimals by default (cost metrics pass 2); `—` for null/NaN */
export function formatThb(value: number | null | undefined, decimals = 0): string {
  return isNum(value) ? `฿ ${fmt(decimals).format(value)}` : MONEY_DASH
}

/** `20.10 USD` — a raw amount with its ISO code, 2 decimals; the code is omitted when unknown; `—` for null */
export function formatNative(value: number | null | undefined, currency: string | null | undefined, decimals = 2): string {
  if (!isNum(value)) return MONEY_DASH
  const n = fmt(decimals).format(value)
  return currency ? `${n} ${currency}` : n
}

/** THB-based cost metric of a single-account row: `spendThb ÷ count × per`; `null` when either side is missing or 0 */
export function costThb(spendThb: number | null | undefined, count: number | null | undefined, per = 1): number | null {
  if (!isNum(spendThb) || !isNum(count) || count === 0) return null
  return (spendThb / count) * per
}

/** THB first, then the other codes alphabetically */
function currencyOrder(a: string, b: string): number {
  if (a === b) return 0
  if (a === 'THB') return -1
  if (b === 'THB') return 1
  return a.localeCompare(b)
}

/**
 * `THB 1,000 + USD 20.10` — the sub line of a row that aggregates several accounts. THB without decimals (it is
 * summed THB already), the others with 2. `''` when there is nothing to list.
 */
export function byCurrencyText(byCurrency: MoneyByCurrency | null | undefined, separator = ' + '): string {
  if (!byCurrency) return ''
  return Object.keys(byCurrency)
    .filter(k => isNum(byCurrency[k]))
    .sort(currencyOrder)
    .map(k => `${k} ${fmt(k === 'THB' ? 0 : 2).format(byCurrency[k]!)}`)
    .join(separator)
}

/** true when the map holds a currency other than THB with a non-zero amount (→ a sub line is worth showing) */
export function hasForeign(byCurrency: MoneyByCurrency | null | undefined): boolean {
  if (!byCurrency) return false
  return Object.keys(byCurrency).some(k => k !== 'THB' && isNum(byCurrency[k]) && byCurrency[k] !== 0)
}

/** `[{ currency: null, amount: 50 }]` (dashboard / top-ups shape) → `{ "?": 50 }`; `null` when empty */
export function unconvertedFromList(list: MoneyUnconvertedItem[] | null | undefined): MoneyUnconverted {
  if (!list || list.length === 0) return null
  const out: Record<string, number> = {}
  for (const item of list) {
    if (!isNum(item.amount)) continue
    const key = item.currency ?? '?'
    out[key] = (out[key] ?? 0) + item.amount
  }
  return Object.keys(out).length > 0 ? out : null
}

/** Σ of the unconverted amounts (mixed currencies — only a "how much is missing" marker); 0 when none */
export function unconvertedTotal(unconverted: MoneyUnconverted | undefined): number {
  if (!unconverted) return 0
  return Object.values(unconverted).reduce((acc, v) => acc + (isNum(v) ? v : 0), 0)
}

/** `+50 ?` — the yellow marker text; `''` when nothing is unconverted */
export function unconvertedMarker(unconverted: MoneyUnconverted | undefined): string {
  const total = unconvertedTotal(unconverted)
  return total > 0 ? `+${COMPACT.format(total)} ?` : ''
}

/** tooltip of the marker: `USD 5 · ? 50 — ยอดที่ยังไม่รู้สกุล/ไม่มีอัตรา ไม่ได้รวม` */
export function unconvertedTitle(unconverted: MoneyUnconverted | undefined): string {
  if (!unconverted) return UNCONVERTED_HINT
  const parts = Object.keys(unconverted)
    .sort((a, b) => (a === '?' ? -1 : b === '?' ? 1 : currencyOrder(a, b)))
    .map(k => `${k} ${COMPACT.format(unconverted[k] ?? 0)}`)
  return parts.length > 0 ? `${parts.join(' · ')} — ${UNCONVERTED_HINT}` : UNCONVERTED_HINT
}

/** `32.80–33.78` (or `33.12` when min = max) of one range rate; `''` when the range has no rate row */
function rangeText(min: number | null, max: number | null): string {
  if (!isNum(min) || !isNum(max)) return ''
  return min === max ? fmt(2).format(min) : `${fmt(2).format(min)}–${fmt(2).format(max)}`
}

/**
 * The min–max of the response's `fx.rates[]`: `32.80–33.78`; several currencies → `USD 32.80–33.78 · EUR …`.
 * `''` when there is no rate row at all.
 */
export function fxRangeText(fx: FxReportBlock | null | undefined): string {
  const rates = (fx?.rates ?? []).filter(r => rangeText(r.min, r.max) !== '')
  if (rates.length === 0) return ''
  if (rates.length === 1) return rangeText(rates[0]!.min, rates[0]!.max)
  return rates.map(r => `${r.currency} ${rangeText(r.min, r.max)}`).join(' · ')
}

/** true when the response says at least one row was converted (the report notes' visibility rule, spec A4) */
export function fxHasConverted(fx: FxReportBlock | null | undefined): boolean {
  return (fx?.convertedRows ?? 0) > 0
}

/**
 * The THB caption of the three report pages (replaces the old "สกุลเงินของบัญชี ไม่แปลงค่า" wording):
 * `USD แปลงเป็น THB ด้วยอัตรา mid-market รายวัน (fastforex) · ช่วงนี้ 32.80–33.78`; `ทุกยอดเป็น THB` when the
 * response converted nothing (or comes from an older API without `fx`).
 */
export function fxReportCaption(fx: FxReportBlock | null | undefined): string {
  if (!fxHasConverted(fx)) return 'ทุกยอดเป็น THB'
  const codes = [...new Set((fx?.rates ?? []).map(r => r.currency))].sort(currencyOrder)
  const range = fxRangeText(fx)
  const head = `${codes.length > 0 ? codes.join('/') : 'สกุลอื่น'} แปลงเป็น THB ด้วยอัตรา mid-market รายวัน (fastforex)`
  return range ? `${head} · ช่วงนี้ ${range}` : head
}

/** newest (`day` max) of a list of S blocks — the "อัตราล่าสุด" of an account page's note; `null` when none */
export function latestThbBlock(blocks: Array<ThbBlock | { rate: number, day: string } | null | undefined>): { rate: number, day: string } | null {
  let best: { rate: number, day: string } | null = null
  for (const b of blocks) {
    if (!b || !isNum(b.rate) || typeof b.day !== 'string') continue
    if (!best || b.day > best.day) best = { rate: b.rate, day: b.day }
  }
  return best
}

/** `20.10 USD × 33.12 (2026-10-28)` — hover of an S amount; `''` when the rate is unknown */
export function rateHoverText(amount: number | null | undefined, currency: string | null | undefined, rate: number | null | undefined, day: string | null | undefined): string {
  if (!isNum(rate)) return ''
  const left = isNum(amount) ? `${formatNative(amount, currency)} × ` : ''
  return `${left}${fmt(2).format(rate)}${day ? ` (${day})` : ''}`
}

/** `อัตราเฉลี่ย 33.10` — hover of an R amount of one row (`spendThb ÷ spend`); `''` when it cannot be derived */
export function averageRateText(thb: number | null | undefined, native: number | null | undefined, days?: number | null): string {
  if (!isNum(thb) || !isNum(native) || native === 0) return ''
  const suffix = isNum(days) && days > 0 ? ` (${days} วัน)` : ''
  return `อัตราเฉลี่ย ${fmt(2).format(thb / native)}${suffix}`
}

/**
 * THB value a money column sorts by in **both** modes (B5): the converted amount when there is one, the raw
 * amount when the native currency is THB, `null` (sorted last) otherwise.
 */
export function thbSortValue(native: number | null | undefined, currency: string | null | undefined, thb: number | null | undefined): number | null {
  if (isNum(thb)) return thb
  if (currency === 'THB' && isNum(native)) return native
  return null
}

/**
 * Σ of several raw per-currency maps (same currency only — never a conversion); used where a table footer is the
 * sum of its rows (dashboard account table). `{}` when empty.
 */
export function mergeByCurrency(maps: Array<MoneyByCurrency | null | undefined>): MoneyByCurrency {
  const out: MoneyByCurrency = {}
  for (const m of maps) {
    if (!m) continue
    for (const [k, v] of Object.entries(m)) if (isNum(v)) out[k] = (out[k] ?? 0) + v
  }
  return out
}

/** same as `mergeByCurrency` for the unconverted maps; `null` when nothing is unconverted */
export function mergeUnconverted(maps: Array<MoneyUnconverted | undefined>): MoneyUnconverted {
  const out = mergeByCurrency(maps)
  return Object.keys(out).length > 0 ? out : null
}
