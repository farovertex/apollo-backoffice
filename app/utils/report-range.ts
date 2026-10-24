/**
 * FEAT-065 — the **one** implementation of the report range: URL parsing, validation, request query, URL
 * patch and the labels (api-contract.md §6.2). Imported (auto-imported) by `ReportsDateRange.vue`,
 * `AdSlideover.vue` and the five report pages — `/reports`, `/reports/summary`, `/reports/banned`,
 * `/reports/utm`, `/ads-monitor`. No page keeps a second copy of any rule or text (spec "UI behaviour").
 *
 * The vocabulary and the validation mirror the API (`src/kpi/range-query.ts`, contract §1/§2): the four
 * shortcuts are resolved **by the API** in `KPI_TIMEZONE` (the BO never computes "today" for a shortcut,
 * spec A5), and a `custom` pair is checked here exactly as the API's `superRefine` does, so an invalid pair
 * never leaves the browser (the page returns early instead of collecting a 400).
 *
 * Every text is pinned: the four Thai validation reasons are the ones `/reports/banned` has shown since
 * FEAT-056, and `formatRangeDay` uses hard-coded Thai short months with the Gregorian year (spec A7) so a
 * spec never depends on the browser locale.
 */
import type { ReportRange, ReportRangeKey, ReportRangeState } from '#shared/types/reports'

/** Shortcut order of the picker (= `RANGE_KEYS` of the API, contract §1). */
export const RANGE_KEYS: ReportRangeKey[] = ['today', 'yesterday', '7d', 'all']

/** Labels of the five keys — the only place they are written (contract §6.2). */
export const RANGE_LABEL: Record<ReportRange, string> = {
  'today': 'วันนี้',
  'yesterday': 'เมื่อวาน',
  '7d': '7 วัน',
  'all': 'ทั้งหมด',
  'custom': 'กำหนดเอง'
}

const DAY_MS = 86_400_000
const MAX_RANGE_DAYS = 366
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Pinned Thai short months — no `Intl` lookup, so the trigger label is deterministic (spec A7). */
const MONTHS_TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

function isRange(value: string): value is ReportRange {
  return value === 'custom' || (RANGE_KEYS as string[]).includes(value)
}

function queryString(query: Record<string, unknown>, key: string): string {
  const value = query[key]
  return typeof value === 'string' ? value.trim() : ''
}

function dayMs(value: string): number {
  return Date.parse(`${value}T00:00:00Z`)
}

/**
 * The range state of a URL query. An unknown (or missing) `range` falls back to the page's `defaultKey`;
 * `from`/`to` are kept **only** for `custom`, so a leftover pair on a shortcut key is ignored here and
 * dropped from the URL by the next `rangeUrlPatch()` write (contract §6.2, spec AC-10).
 */
export function parseReportRange(query: Record<string, unknown>, defaultKey: ReportRange): ReportRangeState {
  const raw = queryString(query, 'range')
  const range = isRange(raw) ? raw : defaultKey
  const custom = range === 'custom'
  return {
    range,
    from: custom ? queryString(query, 'from') : '',
    to: custom ? queryString(query, 'to') : ''
  }
}

/**
 * Thai reason why the custom pair cannot be sent, `null` when it is fine — the four texts
 * `/reports/banned` has used since FEAT-056, in that order (contract §6.2). Mirrors the API's `superRefine`
 * (both required, `from ≤ to`, at most 366 days apart) so no page ever fires a 400.
 */
export function reportRangeInvalid(state: ReportRangeState): string | null {
  if (state.range !== 'custom') return null
  if (!ISO_DAY_RE.test(state.from) || !ISO_DAY_RE.test(state.to)) return 'เลือกวันที่เริ่มต้นและวันสิ้นสุด'
  const fromMs = dayMs(state.from)
  const toMs = dayMs(state.to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 'รูปแบบวันที่ไม่ถูกต้อง'
  if (toMs < fromMs) return 'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น'
  if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) return `ช่วงเวลาต้องไม่เกิน ${MAX_RANGE_DAYS} วัน`
  return null
}

/**
 * The range part of every request: `range` is **always** explicit (even the page default, so a stub can
 * assert the exact query) and `from`/`to` travel only with `custom` (contract §6.4). The caller sends it
 * only when `reportRangeInvalid()` is `null`.
 */
export function reportRangeQuery(state: ReportRangeState): { range: ReportRange, from?: string, to?: string } {
  return state.range === 'custom'
    ? { range: 'custom', from: state.from, to: state.to }
    : { range: state.range }
}

/**
 * The patch each page feeds its own `setQuery`: the page default key disappears from the URL and `from`/`to`
 * exist only with `custom` (contract §6.2). `undefined` is what every page's `setQuery` reads as "drop it".
 */
export function rangeUrlPatch(state: ReportRangeState, defaultKey: ReportRange): Record<string, string | undefined> {
  const custom = state.range === 'custom'
  return {
    range: state.range === defaultKey ? undefined : state.range,
    from: custom ? state.from || undefined : undefined,
    to: custom ? state.to || undefined : undefined
  }
}

/** `'2026-10-01'` → `'1 ต.ค. 2026'`; an unparsable day is returned unchanged (spec A7). */
export function formatRangeDay(day: string): string {
  if (!ISO_DAY_RE.test(day)) return day
  const [year, month, dayOfMonth] = day.split('-')
  const name = MONTHS_TH_SHORT[Number(month) - 1]
  if (!name) return day
  return `${Number(dayOfMonth)} ${name} ${Number(year)}`
}

/**
 * Label of the picker's trigger: the shortcut's own label, `1 ต.ค. 2026 – 24 ต.ค. 2026` for a valid custom
 * pair (one date when `from === to`) and `กำหนดเอง` while the pair is incomplete or impossible.
 */
export function rangeTriggerLabel(state: ReportRangeState): string {
  if (state.range !== 'custom') return RANGE_LABEL[state.range]
  if (reportRangeInvalid(state)) return RANGE_LABEL.custom
  return state.from === state.to
    ? formatRangeDay(state.from)
    : `${formatRangeDay(state.from)} – ${formatRangeDay(state.to)}`
}
