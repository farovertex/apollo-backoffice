/**
 * TASK-bc-sub-create (round 2, brief `.ai/features/_queue/bc-sub-create-ui.prompt.md`) — Thai texts of the
 * reasons a sub Business Center cannot be created, shared by the row action's tooltip, the modal's inline
 * notice (`suggest.reason`) and the 409 toast of the POST. The API sends its own sentence in the 409 body's
 * `error`; these texts are the fallback and the only source for `suggest.reason`, which has no text.
 */
import type { BcSubCreateReason } from '#shared/types/tiktok-accounts'

export const BC_SUB_CREATE_REASON_TEXT: Record<BcSubCreateReason, string> = {
  noOrgId: 'กด Sync ก่อน — ยังไม่รู้จัก Business Center ของบัญชีนี้',
  noProfile: 'บัญชีนี้ยังไม่ได้ผูกโปรไฟล์เบราว์เซอร์',
  inactive: 'บัญชีถูกปิดใช้งาน',
  // FEAT-085 — a bcSubCreate job of this account is already pending/waiting/active (`running`/`needsHuman` are gone)
  duplicate: 'มีงานนี้รออยู่แล้ว',
  exhausted: 'เลขลำดับ 001–999 ถูกใช้ครบแล้ว',
  nameTaken: 'มีชื่อนี้แล้ว'
}

/** Thai sentence of a reason; an unknown code falls back to itself, `null` to a generic sentence. */
export function bcSubCreateReasonText(reason: BcSubCreateReason | string | null | undefined): string {
  if (!reason) return 'สร้าง Sub BC ไม่ได้ตอนนี้'
  return (BC_SUB_CREATE_REASON_TEXT as Record<string, string>)[reason] ?? reason
}

/** `trim` + collapse whitespace — the same normalisation the API applies before it compares a name. */
export function normalizeBcSubName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** true when the typed name is already used (compared trimmed + case-insensitive, like the API does). */
export function isBcSubNameTaken(name: string, taken: readonly string[]): boolean {
  const needle = normalizeBcSubName(name).toLowerCase()
  if (!needle) return false
  return taken.some(t => normalizeBcSubName(t).toLowerCase() === needle)
}
