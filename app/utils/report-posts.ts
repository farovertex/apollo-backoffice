/**
 * FEAT-089 — presentation helpers of `/reports/posts` (`rp-table` et al) and `/reports/posts/:key` (api-contract.md
 * v1 §1–§3, spec "UI behaviour", "Formatting"). The API sends every number already computed (medians, rates,
 * gate decisions) — the BO only formats and labels; the two pages never recompute a ratio the API did not send.
 *
 * Decimals pinned by the spec: percentages 0 decimals, hours/days 1 decimal, THB through `app/utils/money.ts`.
 */
import type {
  PostReportEndOutcome,
  PostReportEnoughWhy,
  PostReportGate,
  PostReportLens,
  PostReportReviewOutcome
} from '#shared/types/report-posts'

const PCT0 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
const DEC1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** `87%` — ratios of this feature are 0..1 fractions from the API (`approvedRate`, `within24h`, `d7Rate`, …) */
export function formatPostPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${PCT0.format(value * 100)}%` : REPORT_DASH
}

/** `2.1` — 1 decimal, no unit (the caller adds "ชม." / "วัน") */
export function formatPostDecimal1(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? DEC1.format(value) : REPORT_DASH
}

/** `2.1 ชม.` */
export function formatPostHours(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${DEC1.format(value)} ชม.` : REPORT_DASH
}

/** `6.5 วัน` */
export function formatPostDays(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${DEC1.format(value)} วัน` : REPORT_DASH
}

/** `1 ชม. 42 น.` — the builds table's "ผ่านตรวจใน" column (spec "Formatting"); `—` when there is no value */
export function formatHoursMinutes(hours: number | null | undefined): string {
  if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < 0) return REPORT_DASH
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return `${h} ชม. ${m} น.`
}

/** `a / b`, `null` when `b` is 0/null/not finite — the BO-side ratio of a `{ survived, decided }` pair */
export function ratioOrNull(a: number | null | undefined, b: number | null | undefined): number | null {
  if (typeof a !== 'number' || !Number.isFinite(a)) return null
  if (typeof b !== 'number' || !Number.isFinite(b) || b === 0) return null
  return a / b
}

/** `ad 54/62 (90%)` — v1.1 per-ad review line (AC-23); `—` for the rate when null */
export function formatAdApprovedLine(adsApproved: number, ads: number, rate: number | null): string {
  return `ad ${formatInt(adsApproved)}/${formatInt(ads)} (${formatPostPercent(rate)})`
}

/**
 * `12 ผ่าน · 3 ปฏิเสธ · 1 แบนก่อนตรวจ · 2 ยังรอ · 1 ไม่รู้` — the review-outcome breakdown line shared by
 * `rp-sum-approved` (`SummaryTiles.vue`) and `rp-card-review` (`LayerCards.vue`), v1.2 (TASK-post-report-drift):
 * zero-count items are hidden (a build cohort rarely hits all five outcomes at once).
 */
export interface ReviewBreakdownCounts {
  approved: number
  rejected: number
  banned: number
  pending: number
  unknown: number
}

export function reviewBreakdownLine(c: ReviewBreakdownCounts): string {
  const parts = [
    c.approved > 0 ? `${formatInt(c.approved)} ผ่าน` : null,
    c.rejected > 0 ? `${formatInt(c.rejected)} ปฏิเสธ` : null,
    c.banned > 0 ? `${formatInt(c.banned)} แบนก่อนตรวจ` : null,
    c.pending > 0 ? `${formatInt(c.pending)} ยังรอ` : null,
    c.unknown > 0 ? `${formatInt(c.unknown)} ไม่รู้` : null
  ].filter((p): p is string => p !== null)
  return parts.length > 0 ? parts.join(' · ') : REPORT_DASH
}

/**
 * `rp-shared-utm` tooltip (TASK-post-report-drift, finding E) — a UTM key is shared by `withOthers` other
 * rows/builds in the same cohort, so the Deposit/Dep-Budget/Cost-Dep number shown is the whole key's number,
 * not this row's alone.
 */
export function sharedUtmTooltip(withOthers: number): string {
  return `ยอดฝากเป็นของ UTM key ทั้ง key ซึ่งอีก ${formatInt(withOthers)} รายการในช่วงนี้ใช้ร่วมกัน — ไม่ใช่ของรายการนี้อย่างเดียว`
}

export const POST_LENS_LABEL: Record<PostReportLens, string> = {
  post: 'โพสต์',
  adTemplate: 'Ad template',
  adGroupTemplate: 'Ad group template',
  account: 'บัญชี'
}

export const POST_LENS_ORDER: PostReportLens[] = ['post', 'adTemplate', 'adGroupTemplate', 'account']

/** `rp-enough` badge text + tooltip (spec "UI behaviour" → table column "ข้อมูล") */
export function enoughBadgeText(enough: boolean, why: PostReportEnoughWhy, gate: PostReportGate, approved: number): string {
  if (enough) return 'พอ'
  if (why === 'spend') return 'รอ (spend)'
  return `รอ (${approved}/${gate.minBuilds} build)`
}

export function enoughBadgeTitle(why: PostReportEnoughWhy, gate: PostReportGate): string {
  if (why === 'ok') return `ผ่านเกณฑ์: ≥ ${gate.minBuilds} build ที่ผ่านตรวจ และ ≥ ${formatThb(gate.minSpend)} spend`
  const parts: string[] = []
  if (why === 'builds' || why === 'both') parts.push(`ต้องการ ≥ ${gate.minBuilds} build ที่ผ่านตรวจ`)
  if (why === 'spend' || why === 'both') parts.push(`ต้องการ ≥ ${formatThb(gate.minSpend)} spend`)
  return parts.join(' · ')
}

export const REVIEW_OUTCOME_LABEL: Record<PostReportReviewOutcome, string> = {
  approved: 'ผ่านตรวจ',
  rejected: 'ปฏิเสธ',
  banned: 'แบนก่อนตรวจ',
  pending: 'รอตรวจ',
  unknown: 'ไม่ทราบ'
}

export interface BuildEndChip {
  key: string
  label: string
  color: ReportColor
  /** v1.2 (TASK-post-report-drift) — "แบนหลัง n ชม." note when the advertiser was banned after publish but the
   *  chip's own label already says something else (rejected/pending/unknown/alive/…); never set on the
   *  `bannedBeforeReview` chip itself (the label already says it). */
  title?: string
}

/** v1.2 (TASK-post-report-drift) — "แบนหลัง n ชม." from `publishedAt` to `bannedAt`, or `undefined` when never banned */
function bannedSuffix(bannedAt: string | null, publishedAt: string): string | undefined {
  if (!bannedAt) return undefined
  const hours = (Date.parse(bannedAt) - Date.parse(publishedAt)) / 3_600_000
  return `แบนหลัง ${formatPostDecimal1(hours)} ชม.`
}

/**
 * `rp-build-end` chip of one row of `rp-builds` (spec "UI behaviour → /reports/posts/:key", the builds table).
 * `review !== 'approved'` never reached survival, so the chip reflects the review outcome instead.
 *
 * v1.2 (TASK-post-report-drift, finding B): `review === 'banned'` (advertiser banned before any approval
 * signal) gets its own chip; every other outcome that was *also* banned after publish (`bannedAt` set) keeps
 * its own label but gains the "แบนหลัง n ชม." note in the tooltip, not the label.
 */
export function buildEndChip(
  review: PostReportReviewOutcome,
  end: PostReportEndOutcome,
  endDay: number | null,
  reviewHours: number | null,
  reason: string | null,
  bannedAt: string | null,
  publishedAt: string
): BuildEndChip {
  const title = review === 'banned' ? undefined : bannedSuffix(bannedAt, publishedAt)
  if (review === 'pending') return { key: 'pending', label: `รอตรวจ ${formatPostDecimal1(reviewHours)} ชม.`, color: 'warning', title }
  if (review === 'rejected') return { key: 'rejected', label: `ปฏิเสธ · ${reason ?? 'ไม่ระบุ'}`, color: 'error', title }
  if (review === 'banned') return { key: 'bannedBeforeReview', label: 'แบนก่อนผ่านตรวจ', color: 'error' }
  if (review === 'unknown' || end === null) return { key: 'unknown', label: 'ไม่ทราบ', color: 'neutral', title }
  const day = endDay ?? '?'
  switch (end) {
    case 'alive': return { key: 'alive', label: 'ยังส่งอยู่', color: 'success', title }
    case 'banned': return { key: 'banned', label: `แบน D${day}`, color: 'error', title }
    case 'missing': return { key: 'missing', label: `หายจากลิสต์ D${day}`, color: 'neutral', title }
    case 'deleted': return { key: 'deleted', label: 'ลบแล้ว', color: 'neutral', title }
    case 'paused': return { key: 'paused', label: 'ปิดเอง', color: 'neutral', title }
    default: return { key: 'unknown', label: 'ไม่ทราบ', color: 'neutral', title }
  }
}

/** funnel step of `rp-funnel` (6 bars, spec "UI behaviour → /reports/posts/:key") */
export interface PostFunnelStep {
  key: string
  label: string
  value: number
}

export function postFunnelSteps(funnel: { published: number, approved: number, spent: number, deposited: number, survivedD7: number, alive: number }): PostFunnelStep[] {
  return [
    { key: 'published', label: 'เผยแพร่', value: funnel.published },
    { key: 'approved', label: 'ผ่านตรวจ', value: funnel.approved },
    { key: 'spent', label: 'มี spend', value: funnel.spent },
    { key: 'deposited', label: 'มี deposit', value: funnel.deposited },
    { key: 'survivedD7', label: 'รอดถึง D7', value: funnel.survivedD7 },
    { key: 'alive', label: 'ยังส่งอยู่', value: funnel.alive }
  ]
}
