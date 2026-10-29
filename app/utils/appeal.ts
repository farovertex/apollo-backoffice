/**
 * FEAT-082 — presentation helpers for the ad review detail + appeal (api-contract.md v1 §0/§2/§6, spec
 * "UI behaviour (BO)"). Everything here is page chrome: the API decides `appeal` / `appealable.reason` and
 * the BO only maps those codes to the Thai badge texts and tooltips, exactly like `monitorStatusLabel()`
 * does for the status keys (`app/utils/reports.ts`). Auto-imported by Nuxt, so components use the functions
 * without an import.
 */
import type { AppealableReason, AppealState, MonitorReviewSummary } from '#shared/types/ads-monitor'

/**
 * The badge state of a row / drawer. It is the API's `AppealState` plus the two states the *job* adds:
 * `pending` (a queued/running `adAppeal` job) and `error` (the last job failed). `none` renders nothing.
 */
export type AppealBadgeState = AppealState | 'pending' | 'error'

/** Thai badge texts (spec "UI behaviour" → ad tab). `none` has no text: the badge is not rendered at all. */
export const APPEAL_BADGE_TEXT: Record<AppealBadgeState, string> = {
  none: '',
  pending: 'กำลังยื่นอุทธรณ์…',
  appealing: 'กำลังอุทธรณ์',
  approved: 'อุทธรณ์ผ่าน',
  rejected: 'อุทธรณ์ไม่ผ่าน',
  error: 'ยื่นอุทธรณ์ไม่สำเร็จ',
  unknown: 'สถานะอุทธรณ์ไม่ทราบ'
}

type BadgeColor = 'primary' | 'success' | 'error' | 'warning' | 'info' | 'neutral'

/** Badge colour per state (spec: info / success / error / neutral). */
export const APPEAL_BADGE_COLOR: Record<AppealBadgeState, BadgeColor> = {
  none: 'neutral',
  pending: 'info',
  appealing: 'info',
  approved: 'success',
  rejected: 'error',
  error: 'error',
  unknown: 'neutral'
}

/** Icon per state; the pending one is the only animated element of the badge. */
export const APPEAL_BADGE_ICON: Record<AppealBadgeState, string> = {
  none: '',
  pending: 'i-lucide-loader-circle',
  appealing: 'i-lucide-gavel',
  approved: 'i-lucide-circle-check',
  rejected: 'i-lucide-circle-x',
  error: 'i-lucide-triangle-alert',
  unknown: 'i-lucide-circle-help'
}

/**
 * Contract §6 — the one rule for `am-appeal-badge[data-state]` and `am-appeal-state[data-state]`:
 * `pending` when a job is queued/running · `error` when the last job failed and nothing is pending ·
 * otherwise the API's `appeal`. A missing/`null` review is `none` (no badge).
 */
export function appealBadgeState(
  review: Pick<MonitorReviewSummary, 'appeal' | 'appealPending' | 'appealError'> | null | undefined
): AppealBadgeState {
  if (!review) return 'none'
  if (review.appealPending) return 'pending'
  if (review.appealError) return 'error'
  return review.appeal ?? 'none'
}

/**
 * Contract §6 — the status label of an ad row becomes a button (`am-review-open`) only when a review exists
 * **and** the row is either rejected or already in an appeal flow. The BO never widens this rule.
 */
export function isReviewOpenable(
  statusKey: string,
  review: Pick<MonitorReviewSummary, 'appeal'> | null | undefined
): boolean {
  if (!review) return false
  return statusKey === 'rejected' || review.appeal !== 'none'
}

/** Contract §2 — Thai tooltip of a disabled "อุทธรณ์" button, one sentence per `appealable.reason`. */
export const APPEALABLE_REASON_TEXT: Record<AppealableReason, string> = {
  noReview: 'ยังไม่มีรายละเอียด',
  appealPending: 'กำลังยื่นอุทธรณ์อยู่',
  notAppealable: 'โฆษณานี้อุทธรณ์ไม่ได้',
  advertiserBanned: 'บัญชีโฆษณาถูกระงับ',
  accountUnavailable: 'บัญชี TikTok ใช้งานไม่ได้',
  adGone: 'โฆษณานี้ไม่อยู่บน TikTok แล้ว'
}

/**
 * The tooltip text for `am-appeal-open` when `appealable.ok === false`. `notAppealable` names the state
 * TikTok reported, like the API's own 409 sentence does ("โฆษณานี้อุทธรณ์ไม่ได้ (สถานะ: อุทธรณ์ผ่าน)").
 * An unknown/absent code falls back to the generic sentence rather than showing a raw code.
 */
export function appealableReasonText(reason: AppealableReason | null | undefined, appeal?: AppealState | null): string {
  if (!reason) return ''
  const base = APPEALABLE_REASON_TEXT[reason] ?? 'ยื่นอุทธรณ์ไม่ได้'
  if (reason !== 'notAppealable') return base
  const state = appeal && appeal !== 'none' ? APPEAL_BADGE_TEXT[appeal] : ''
  return state ? `${base} (สถานะ: ${state})` : base
}

/** `29/10 14:05` — `dd/MM HH:mm` in the browser's timezone (spec: the `lastAppeal` line). `—` for null. */
export function formatSlashDayClock(iso: string | null | undefined): string {
  if (!iso) return REPORT_DASH
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return REPORT_DASH
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `18–24, 25–34` — TikTok's `forbidden_ages` pairs as one line (en dash, like the rest of the BO). */
export function ageBandsText(bands: number[][] | null | undefined): string {
  const parts = (bands ?? [])
    .map(pair => (Array.isArray(pair) && pair.length >= 2 ? `${pair[0]}–${pair[1]}` : null))
    .filter((text): text is string => text !== null)
  return parts.join(', ')
}

/** ISO-3166 alpha-2 of the regions TikTok flagged → the Thai country name when we know it, else the code. */
const COUNTRY_TH: Record<string, string> = {
  TH: 'ไทย',
  VN: 'เวียดนาม',
  ID: 'อินโดนีเซีย',
  MY: 'มาเลเซีย',
  PH: 'ฟิลิปปินส์',
  SG: 'สิงคโปร์',
  LA: 'ลาว',
  KH: 'กัมพูชา',
  MM: 'เมียนมา',
  TW: 'ไต้หวัน',
  US: 'สหรัฐอเมริกา'
}

/** `ไทย (TH)` for a known code, the bare code otherwise; a list joins with `, `. */
export function countriesText(codes: string[] | null | undefined): string {
  const parts = (codes ?? [])
    .filter((code): code is string => typeof code === 'string' && code !== '')
    .map(code => (COUNTRY_TH[code.toUpperCase()] ? `${COUNTRY_TH[code.toUpperCase()]} (${code.toUpperCase()})` : code))
  return parts.join(', ')
}
