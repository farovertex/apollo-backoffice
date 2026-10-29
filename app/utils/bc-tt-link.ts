/**
 * TASK-bc-tt-link (round 2, brief `.ai/features/_queue/bc-tt-link-ui.prompt.md`) — Thai texts of the
 * **เพิ่มบัญชี TikTok** flow (issue an invitation QR under one Business Center org, let a human scan it, then
 * prove it with the per-org Sync). Sibling of `bc-adv-create.ts`: the sentences are copied **verbatim** from
 * `BC_TT_LINK_CONFLICT` of `apollo-api` (`src/bc-tt-link/bc-tt-link.dto.ts`, read on 2026-10-21) so the tooltip of
 * a disabled button, the inline notice and the toast of a 409 read exactly the same as what the API sends.
 * The `roles` / `relationStatus` dictionaries name what the chip's popover shows per linked account; both are
 * TikTok's own numeric codes and only the ones the brief pinned down are translated — anything else is printed as
 * its code instead of being guessed at.
 */
import type { BcTikTokAccount, BcTtLinkConflictReason } from '#shared/types/tiktok-accounts'

export const BC_TT_LINK_REASON_TEXT: Record<BcTtLinkConflictReason, string> = {
  noOrg: 'ไม่พบ org',
  orgMissing: 'org นี้ไม่อยู่ใน Business Center แล้ว',
  noProfile: 'บัญชีนี้ยังไม่มีโปรไฟล์ที่พร้อมใช้',
  inactive: 'account ถูกปิดใช้งาน',
  // FEAT-085 — a bcTtLink job of this org is already pending/waiting/active (busy codes `running`/`needsHuman` are gone)
  duplicate: 'มีงานนี้รออยู่แล้ว'
}

/** Thai sentence of a reason; an unknown code falls back to itself, `null` to a generic sentence. */
export function bcTtLinkReasonText(reason: BcTtLinkConflictReason | string | null | undefined): string {
  if (!reason) return 'ขอ QR เพิ่มบัญชี TikTok ไม่ได้ตอนนี้'
  return (BC_TT_LINK_REASON_TEXT as Record<string, string>)[reason] ?? reason
}

/** TikTok's permission codes on a linked account (`roles`); the brief pinned 5011 down, the rest stay codes. */
export const BC_TT_ROLE_TEXT: Record<number, string> = {
  5011: 'แสดงเป็นโฆษณาเท่านั้น'
}

/**
 * `roles` → one readable line. Only the codes we have a sentence for are rendered — a row carries the whole
 * TikTok permission bitmap (`5000`, `5010`, …) and printing those numbers next to a name is noise, not
 * information. Nothing known (or an empty array) → `'—'`; the raw codes stay available through `bcTtRolesTitle`.
 */
export function bcTtRolesText(roles: readonly number[] | null | undefined): string {
  const known = (roles ?? []).map(role => BC_TT_ROLE_TEXT[role]).filter(Boolean)
  return known.length ? known.join(' · ') : REPORT_DASH
}

/** every code of `roles`, for the `title` of the line that renders `bcTtRolesText` (traceability, no guessing). */
export function bcTtRolesTitle(roles: readonly number[] | null | undefined): string | undefined {
  return roles?.length ? `roles: ${roles.join(', ')}` : undefined
}

/** `relationStatus` → Thai; the brief pinned `1` down, anything else (and `null`) has no sentence. */
export function bcTtRelationText(status: number | null | undefined): string | null {
  if (status === 1) return 'เชื่อมโยงอยู่'
  return null
}

/** What to call a linked account: its name, else its @username, else the tail of its asset id (never the full id). */
export function bcTtAccountName(account: BcTikTokAccount): string {
  return account.name || account.username || `…${account.assetId.slice(-4)}`
}

/** `@username` for display, `'—'` when the row has none (the API may deliver one without the other). */
export function bcTtAccountHandle(account: BcTikTokAccount): string {
  return account.username ? `@${account.username}` : REPORT_DASH
}

/**
 * File name of the "ดาวน์โหลด QR" link. Only the last 4 characters of the org id travel into it — an org id is
 * not a secret, but a downloaded file lands in screenshots and chat, so the page keeps its own rule of never
 * printing a full TikTok id (AGENTS.md §5 habit).
 */
export function bcTtLinkQrFileName(orgId: string): string {
  return `bc-tt-link-qr-${orgId.slice(-4)}.png`
}
