/**
 * FEAT-042 — presentation helpers for `adTemplates.postInfo` (api-contract.md v1 §1.1/§1.2, spec
 * §Behaviour — BO). Shared by `components/ad-templates/FormModal.vue`, `pages/ad-templates.vue` and
 * `pages/launch-ads.vue` so the chip, the reason and the kind badge read the same everywhere.
 *
 * Every function accepts the **summary** type: the full single-template view is assignable to it, so a list
 * row and a `GET /ad-templates/:id` body can be passed to the same helper. `undefined` (an older API that
 * does not serve the key) and `null` (never checked) mean the same thing here — "ยังไม่ได้ตรวจ".
 *
 * The Spark code itself never appears in any of these strings.
 */
import type { StatusColor, StatusBadge } from '~/utils/campaign-orders'
import type {
  AdTemplatePostInfo,
  AdTemplatePostInfoError,
  AdTemplatePostInfoErrorKind,
  AdTemplatePostInfoStatus,
  AdTemplatePostInfoSummary
} from '#shared/types/ad-templates'

/** either shape of the view key, plus the two "not checked" values */
export type PostInfoLike = AdTemplatePostInfo | AdTemplatePostInfoSummary | null | undefined

/** the chip per status (spec §Behaviour — BO); `BUILD_STATUS_BADGE` is the pattern */
export const POST_INFO_STATUS_BADGE: Record<AdTemplatePostInfoStatus, StatusBadge> = {
  verifying: { label: 'กำลังตรวจ…', color: 'info' },
  verified: { label: 'ตรวจแล้ว', color: 'success' },
  invalid: { label: 'รหัสไม่ถูกต้อง', color: 'error' },
  failed: { label: 'ตรวจไม่ได้', color: 'warning' }
}

/** no `postInfo` at all — the template was never checked (also: an API without the key) */
export const POST_INFO_UNVERIFIED_BADGE: StatusBadge = { label: 'ยังไม่ได้ตรวจ', color: 'neutral' }

/** the chip of a row / card / section, including the absent case; an unknown status keeps its own text */
export function postInfoBadge(postInfo: PostInfoLike): StatusBadge {
  const status = postInfo?.status
  if (!status) return POST_INFO_UNVERIFIED_BADGE
  return POST_INFO_STATUS_BADGE[status]
    ?? ({ label: status, color: 'neutral' as StatusColor } satisfies StatusBadge)
}

/** `data-status` of the chip — the status, or `none` while the template was never checked */
export function postInfoStatusAttr(postInfo: PostInfoLike): string {
  return postInfo?.status ?? 'none'
}

/** the lookup is still running → the chip spins and the caller polls */
export function isPostInfoVerifying(postInfo: PostInfoLike): boolean {
  return postInfo?.status === 'verifying'
}

/** TikTok described the post → the card may be rendered */
export function isPostInfoVerified(postInfo: PostInfoLike): boolean {
  return postInfo?.status === 'verified'
}

/**
 * The template is not known to point at a usable post: never checked, refused by TikTok, or not checkable.
 * `launch-ads` warns about exactly these (non-blocking), `verifying` is not one of them.
 */
export function needsPostInfoWarning(postInfo: PostInfoLike): boolean {
  const status = postInfo?.status
  return !status || status === 'invalid' || status === 'failed'
}

/** a cover row exists ⇔ `GET /ad-templates/:id/cover` answers 200 — the only case the BO may request it */
export function hasPostCover(postInfo: PostInfoLike): boolean {
  return postInfo?.cover?.ok === true
}

/** `checkedAt` is part of the cover cache key (a re-verify replaces the bytes); summaries do not carry it */
export function postInfoCheckedAt(postInfo: PostInfoLike): string | null {
  return postInfo && 'checkedAt' in postInfo ? postInfo.checkedAt : null
}

/** the full single-template view (the post card needs `caption`, `durationSec`, `imageCount`, …) */
export function isFullPostInfo(postInfo: PostInfoLike): postInfo is AdTemplatePostInfo {
  return !!postInfo && 'requestedAt' in postInfo
}

/** why a `failed` lookup failed, by kind (spec §Behaviour — BO) */
const FAILED_REASON: Record<AdTemplatePostInfoErrorKind, string> = {
  noLiveSession: 'ไม่มีโปรไฟล์ TikTok ที่เปิดอยู่',
  timeout: 'หมดเวลารอผล',
  fetch: 'ติดต่อ TikTok ไม่ได้',
  tiktok: 'TikTok ปฏิเสธ'
}

/** `TikTok ตอบ <code>: <msg>` — the raw answer of an `invalid` code, with whatever part the API served */
function tiktokReason(error: AdTemplatePostInfoError): string {
  const code = error.code ?? '—'
  const msg = error.msg?.trim()
  return msg ? `TikTok ตอบ ${code}: ${msg}` : `TikTok ตอบ ${code}`
}

/**
 * The reason line under the chip (`adt-post-reason`, and the table tooltip): the raw TikTok answer for
 * `invalid`, the kind text for `failed`, `null` for every other state (nothing to explain).
 */
export function postInfoReason(postInfo: PostInfoLike): string | null {
  const status = postInfo?.status
  if (status !== 'invalid' && status !== 'failed') return null
  const error = postInfo?.error ?? null
  if (status === 'invalid') return error ? tiktokReason(error) : 'TikTok ไม่รับรหัสนี้'
  if (!error) return 'ตรวจไม่สำเร็จ'
  // a kind the API may add later still reads as a sentence instead of disappearing
  return (FAILED_REASON as Record<string, string | undefined>)[error.kind] ?? 'ตรวจไม่สำเร็จ'
}

/**
 * The kind badge of the post card: `วิดีโอ · 10 วิ` (`durationSec` rounded) or `รูปภาพ · 3 รูป`.
 * A list row knows only `itemType`, so the detail is left off there; an `itemType` TikTok may add later
 * renders as `ประเภท <n>` instead of hiding the post.
 */
export function postInfoKindLabel(postInfo: PostInfoLike): string | null {
  const itemType = postInfo?.itemType
  if (itemType === null || itemType === undefined) return null
  const full = isFullPostInfo(postInfo) ? postInfo : null
  if (itemType === 0) {
    const seconds = full?.durationSec
    return seconds === null || seconds === undefined
      ? 'วิดีโอ'
      : `วิดีโอ · ${Math.round(seconds)} วิ`
  }
  if (itemType === 1) {
    const count = full?.imageCount
    return count === null || count === undefined ? 'รูปภาพ' : `รูปภาพ · ${count} รูป`
  }
  return `ประเภท ${itemType}`
}

/** `authEndAt` as a Thai date-time (`th-TH`), or `null` when the API served no validity window */
export function formatPostInfoDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** `ใช้ได้ถึง <authEndAt>` (`adt-post-until`), `null` while there is no date to show */
export function postInfoUntilLabel(postInfo: PostInfoLike): string | null {
  const formatted = formatPostInfoDate(postInfo?.authEndAt)
  return formatted ? `ใช้ได้ถึง ${formatted}` : null
}
