/**
 * TASK-bc-adv-create (round 2, brief `.ai/features/_queue/bc-adv-create-ui.prompt.md`) — Thai texts of the
 * reasons an advertiser (ad account) cannot be created under a Business Center org, shared by the org row's
 * button tooltip, the modal's inline notice (`suggest.reason`) and the 409 toast of the POST. Sibling of
 * `bc-sub-create.ts`: the API sends its own sentence in the 409 body's `error`, so these texts are the fallback
 * there and the only source for `suggest.reason`, which carries no text.
 */
import type { BcAdvConflictReason } from '#shared/types/tiktok-accounts'

export const BC_ADV_CREATE_REASON_TEXT: Record<BcAdvConflictReason, string> = {
  noOrg: 'ไม่พบ org นี้ในบัญชีนี้ — กด Sync ก่อน',
  orgMissing: 'org นี้หายไปจาก Business Center แล้ว',
  noOrgName: 'org นี้ยังไม่มีชื่อ — กด Sync ก่อน',
  noProfile: 'บัญชีนี้ยังไม่ได้ผูกโปรไฟล์เบราว์เซอร์',
  inactive: 'บัญชีถูกปิดใช้งาน',
  running: 'บัญชีมี job กำลังรัน',
  needsHuman: 'มีงานที่รอคนทำอยู่ (เช่น OTP) — ทำให้เสร็จก่อน',
  exhausted: 'เลขลำดับ 001–999 ถูกใช้ครบแล้ว',
  nameTaken: 'มีชื่อนี้แล้ว'
}

/** Thai sentence of a reason; an unknown code falls back to itself, `null` to a generic sentence. */
export function bcAdvCreateReasonText(reason: BcAdvConflictReason | string | null | undefined): string {
  if (!reason) return 'สร้างบัญชีโฆษณาไม่ได้ตอนนี้'
  return (BC_ADV_CREATE_REASON_TEXT as Record<string, string>)[reason] ?? reason
}

/** `trim` + collapse whitespace — the same normalisation the API applies before it compares a name. */
export function normalizeBcAdvName(name: string): string {
  return name.trim().replace(/\s+/g, ' ')
}

/** true when the typed name is already used (compared trimmed + case-insensitive, like the API does). */
export function isBcAdvNameTaken(name: string, taken: readonly string[]): boolean {
  const needle = normalizeBcAdvName(name).toLowerCase()
  if (!needle) return false
  return taken.some(t => normalizeBcAdvName(t).toLowerCase() === needle)
}
