/**
 * FEAT-020 — presentation helpers shared by `/reports`, the ad slideover, the order Report tab and the
 * advertisers slideover (api-contract.md **v1** §6). Everything here is page chrome: the API serves codes and
 * numbers, the BO never invents a metric.
 *
 * Formatting rules of §6 intro: `tabular-nums`, 2 decimals for money and rates, thousands separators, `—` for
 * null. The grouping is pinned to `en-US` so the number a spec reads never depends on the browser locale.
 * Currency is unknown system-wide (spec A8) — numbers are printed bare and the spend tile carries the caption
 * "สกุลเงินของบัญชี".
 */
import type { AdState, AdvertiserReportState, KpiMetrics, ReportError, ReportRange } from '#shared/types/reports'

export const REPORT_DASH = '—'

const INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const DEC = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `15,880` — thousands separated integer; `—` for null/NaN. */
export function formatInt(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? INT.format(value) : REPORT_DASH
}

/** `612.40` — money and every non-percent rate (CPC, CPM, CPA); `—` for null/NaN. */
export function formatDecimal(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? DEC.format(value) : REPORT_DASH
}

/** `2.81%` — the API already sends percent points; `—` for null/NaN. */
export function formatPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${DEC.format(value)}%` : REPORT_DASH
}

/** `HH:mm` of the browser's timezone; `—` for null / an unparsable date. */
export function formatClock(iso: string | null | undefined): string {
  if (!iso) return REPORT_DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return REPORT_DASH
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** `2026-09-30 12:35`; `—` for null / an unparsable date. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return REPORT_DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return REPORT_DASH
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Thai relative time, deterministic (no locale lookup): "3 นาทีที่แล้ว". `—` for null. */
export function timeAgoTh(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return REPORT_DASH
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return REPORT_DASH
  const diff = Math.max(0, nowMs - t)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'เมื่อสักครู่'
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`
  return `${Math.floor(hours / 24)} วันที่แล้ว`
}

/** `ในอีก 3 นาที` for a future instant, "เร็ว ๆ นี้" when it is due; `—` for null. */
export function timeUntilTh(iso: string | null | undefined, nowMs: number): string {
  if (!iso) return REPORT_DASH
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return REPORT_DASH
  const minutes = Math.round((t - nowMs) / 60_000)
  if (minutes <= 0) return 'เร็ว ๆ นี้'
  if (minutes < 60) return `ในอีก ${minutes} นาที`
  return `ในอีก ${Math.round(minutes / 60)} ชั่วโมง`
}

/** `KPI_POLL_INTERVAL_MS` as whole minutes (at least 1) for "อัปเดตทุก N นาที". */
export function intervalMinutes(intervalMs: number | null | undefined): number {
  const ms = typeof intervalMs === 'number' && intervalMs > 0 ? intervalMs : 0
  return Math.max(1, Math.round(ms / 60_000))
}

/** Thai text of every `lastError` / `fetchError` code (api-contract §6.2 "Error texts"). */
export const REPORT_ERROR_TEXT: Record<ReportError, string> = {
  notLoggedIn: 'บัญชียังไม่ได้ login',
  listApiFailed: 'TikTok ไม่ตอบรายการโฆษณา',
  partial: 'ได้ข้อมูลไม่ครบทุกหน้า',
  timeout: 'ใช้เวลานานเกินไป',
  profileLocked: 'โปรไฟล์กำลังถูกใช้งาน',
  unknown: 'เกิดข้อผิดพลาด'
}

export function reportErrorText(code: ReportError | null | undefined): string | null {
  if (!code) return null
  return REPORT_ERROR_TEXT[code] ?? REPORT_ERROR_TEXT.unknown
}

export type ReportColor = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error'

/** Badge of the derived ad state (contract §2.2). */
export const AD_STATE_BADGE: Record<AdState, { label: string, color: ReportColor }> = {
  delivering: { label: 'กำลังส่ง', color: 'success' },
  pending: { label: 'รอตรวจ', color: 'warning' },
  rejected: { label: 'ไม่ผ่าน', color: 'error' },
  ended: { label: 'จบแล้ว', color: 'neutral' },
  unknown: { label: 'ไม่ทราบ', color: 'neutral' }
}

export function adStateBadge(state: AdState | string): { label: string, color: ReportColor } {
  return (AD_STATE_BADGE as Record<string, { label: string, color: ReportColor }>)[state]
    ?? { label: state, color: 'neutral' }
}

const REJECT_WORDS = ['reject', 'deny', 'punish', 'violat']
const ENDED_WORDS = [
  'delete', 'disable', 'done', 'finish', 'closed', 'frozen',
  'not_deliver', 'no_schedule', 'budget_exceed', 'balance_exceed'
]
const PENDING_WORDS = ['pending', 'audit', 'review', 'not_start']

/**
 * Colour of one C / G / A pill from that level's raw TikTok status string — the same keyword order the API
 * uses to derive `state` (contract §2.2), applied to a single level.
 */
export function levelColor(raw: string | null | undefined): ReportColor {
  const s = (raw ?? '').toLowerCase()
  if (!s) return 'neutral'
  if (REJECT_WORDS.some(w => s.includes(w))) return 'error'
  if (ENDED_WORDS.some(w => s.includes(w))) return 'neutral'
  if (s === 'delivery_ok') return 'success'
  if (PENDING_WORDS.some(w => s.includes(w))) return 'warning'
  return 'neutral'
}

/** `…4129` — the last 4 characters of a TikTok id (advertiser / campaign), the way the contract prints them. */
export function last4(id: string | null | undefined): string {
  if (!id) return REPORT_DASH
  return id.length > 4 ? `…${id.slice(-4)}` : id
}

/** Freshness of a row's last fetch: `ok` · `late` (older than 2 intervals) · `error` (the advertiser has one). */
export function updatedLevel(
  lastFetchAt: string | null | undefined,
  fetchError: ReportError | null | undefined,
  intervalMs: number,
  nowMs: number
): 'ok' | 'late' | 'error' {
  if (fetchError) return 'error'
  if (!lastFetchAt) return 'late'
  const t = new Date(lastFetchAt).getTime()
  if (Number.isNaN(t)) return 'late'
  const limit = (intervalMs > 0 ? intervalMs : 300_000) * 2
  return nowMs - t > limit ? 'late' : 'ok'
}

/** Dot classes per freshness level / tracking state. */
export const REPORT_DOT_CLASS: Record<string, string> = {
  ok: 'bg-success',
  late: 'bg-warning',
  error: 'bg-error',
  on: 'bg-success',
  off: 'bg-muted',
  never: 'bg-muted',
  tracking: 'bg-success'
}

/** Dot class of a freshness level / tracking state, with `never` as the fallback. */
export function reportDot(state: string | null | undefined): string {
  return REPORT_DOT_CLASS[state ?? 'never'] ?? 'bg-muted'
}

/** Label of the advertiser tracking state (contract §5 "AdvertiserReport"). */
export const ADVERTISER_REPORT_LABEL: Record<AdvertiserReportState, string> = {
  on: 'เปิด',
  off: 'ปิด',
  error: 'ผิดพลาด',
  never: 'ยังไม่เริ่ม'
}

export const RANGE_LABEL: Record<ReportRange, string> = {
  'today': 'วันนี้',
  '7d': '7 วัน',
  'all': 'ทั้งหมด'
}

/** The `range` of a URL query, falling back to `today` for anything unknown. */
export function parseRange(value: unknown): ReportRange {
  return value === '7d' || value === 'all' ? value : 'today'
}

/** An empty metric block — used as the fallback of a tile before the first answer. */
export function emptyMetrics(): KpiMetrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    ctr: null,
    cpc: null,
    cpm: null,
    conversions: 0,
    conversionCost: null,
    conversionRate: null,
    effectCount: null,
    effectCost: null,
    effectRate: null,
    skanConversions: null
  }
}

/**
 * Comparison of one tile against the previous equal range.
 * `direction` is the arrow, `good` says whether that direction is a good thing (CPA rises = worse).
 * `null` when there is nothing to compare against (range `all`, or a previous value of 0 on a ratio).
 */
export interface TileDelta {
  direction: 'up' | 'down' | 'flat'
  /** absolute difference, already formatted by the caller's formatter */
  diff: number
  /** percent change; null when the previous value is 0 */
  percent: number | null
  good: boolean
}

export function tileDelta(
  current: number | null,
  previous: number | null,
  lowerIsBetter = false
): TileDelta | null {
  if (typeof current !== 'number' || typeof previous !== 'number') return null
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  const diff = current - previous
  const direction: TileDelta['direction'] = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat'
  const percent = previous === 0 ? null : (diff / Math.abs(previous)) * 100
  const good = direction === 'flat' ? true : lowerIsBetter ? direction === 'down' : direction === 'up'
  return { direction, diff, percent, good }
}

/**
 * Inline sparkline of today's per-hour spend deltas (`AdReportRow.sparkline`).
 * Fixed 96×28 viewBox so every row's svg is the same size; a single point is drawn as a flat line.
 * Returns `null` when there is nothing to draw (the cell then renders no svg at all).
 */
export interface SparklinePath {
  line: string
  area: string
  lastX: number
  lastY: number
}

export function sparklinePath(values: number[] | null | undefined, width = 96, height = 28): SparklinePath | null {
  const points = (values ?? []).filter(v => typeof v === 'number' && Number.isFinite(v))
  if (points.length === 0) return null
  const max = Math.max(...points, 0)
  const top = 3
  const bottom = height - 3
  const step = points.length > 1 ? width / (points.length - 1) : 0
  const coords = points.map((v, i) => {
    const x = points.length > 1 ? i * step : width / 2
    const ratio = max > 0 ? v / max : 0
    const y = bottom - ratio * (bottom - top)
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as const
  })
  const first = coords[0]!
  const last = coords[coords.length - 1]!
  const line = coords.length === 1
    ? `M0,${first[1]} L${width},${first[1]}`
    : coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ')
  const area = coords.length === 1
    ? `M0,${first[1]} L${width},${first[1]} L${width},${height} L0,${height} Z`
    : `${line} L${width},${height} L0,${height} Z`
  return { line, area, lastX: coords.length === 1 ? width : last[0], lastY: last[1] }
}
