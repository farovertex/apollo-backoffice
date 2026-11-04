/**
 * FEAT-098 — Thai texts of **ยกเลิกการเชื่อมโยงบัญชี TikTok**, copied verbatim from api-contract.md v1 §3. The API's
 * own `error` of a 404/409 is what gets shown; `BC_TT_UNLINK_REASON_TEXT` is only its fallback. A job's `error` is a
 * code, so the sentence shown for it lives here. Codes the table has no sentence for print `lastLog`, then the code.
 */
import type { BcTtUnlinkConflictReason, BcTtUnlinkJob } from '#shared/types/tiktok-accounts'

export const BC_TT_UNLINK_REASON_TEXT: Record<BcTtUnlinkConflictReason, string> = {
  noOrg: 'ไม่พบ org',
  noAsset: 'ไม่พบบัญชี TikTok นี้ใน org',
  orgMissing: 'org นี้ไม่อยู่ใน Business Center แล้ว',
  assetMissing: 'บัญชี TikTok นี้ไม่อยู่ใน org แล้ว กด Sync เพื่อตรวจอีกครั้ง',
  notOwned: 'บัญชีนี้แชร์มาจาก BC อื่น ยกเลิกการเชื่อมโยงจากที่นี่ไม่ได้',
  noProfile: 'บัญชีนี้ยังไม่มีโปรไฟล์ที่พร้อมใช้',
  inactive: 'account ถูกปิดใช้งาน',
  duplicate: 'มีคำสั่งยกเลิกการเชื่อมโยงบัญชีนี้รออยู่แล้ว'
}

export const BC_TT_UNLINK_ERROR_TEXT: Record<string, string> = {
  gate: 'Business Center ขอการยืนยันเพิ่ม ให้เข้าไปตรวจที่โปรไฟล์',
  notLoggedIn: 'บัญชีนี้ไม่ได้ล็อกอิน ให้ล็อกอินใหม่ก่อน',
  pageLanguage: 'หน้า Business Center เป็นภาษาที่ระบบอ่านไม่ได้',
  tabMissing: 'ไม่พบแท็บบัญชี TikTok',
  listUnreadable: 'อ่านรายการบัญชีจาก Business Center ไม่ได้',
  rowNotFound: 'ไม่พบแถวของบัญชีนี้บนหน้า',
  rowAmbiguous: 'พบแถวที่ไม่ตรงกับบัญชีนี้ ระบบจึงไม่กดอะไร',
  menuMissing: 'ไม่พบเมนูยกเลิกการเชื่อมโยงบนหน้า',
  confirmMissing: 'ไม่พบกล่องยืนยันของบัญชีนี้ ระบบจึงไม่กดยืนยัน',
  cancelFailed: 'ปิดกล่องยืนยันไม่ได้ ให้เข้าไปตรวจที่โปรไฟล์',
  notProven: 'กดยืนยันบนหน้า Business Center แล้ว แต่ยังยืนยันผลไม่ได้'
}

/** spec UI §5 — the extra line of `notProven`: Confirm was clicked, and a retry can't click it twice on a gone account */
export const BC_TT_UNLINK_NOT_PROVEN_HINT = 'ลองใหม่ได้ ระบบจะตรวจรายการก่อนกดเสมอ ถ้าบัญชีหายไปแล้วจะจบงานโดยไม่กดซ้ำ'

export function bcTtUnlinkIsOpen(job: Pick<BcTtUnlinkJob, 'status'>): boolean {
  return job.status === 'pending' || job.status === 'waiting' || job.status === 'active'
}

/** The only success: `completed` **and** a known good outcome. A `dryRun` or unknown outcome changed nothing we can prove. */
export function bcTtUnlinkSucceeded(job: BcTtUnlinkJob): boolean {
  const outcome = job.result?.outcome
  return job.status === 'completed' && (outcome === 'unlinked' || outcome === 'alreadyGone')
}

/** `notProven` and `unknown` may have clicked Confirm, and a `completed` without a good outcome proves nothing: "not failed", just unconfirmed. */
export function bcTtUnlinkFailureTitle(job: BcTtUnlinkJob | null): string {
  if (job && (job.status === 'completed' || job.error === 'notProven' || job.error === 'unknown')) return 'ยืนยันผลไม่ได้'
  return 'ยกเลิกการเชื่อมโยงไม่สำเร็จ'
}

/** Sentence of a job that ended without success: the contract's per code, else `lastLog`, else the code. */
export function bcTtUnlinkFailureText(job: BcTtUnlinkJob): string {
  const known = job.error ? BC_TT_UNLINK_ERROR_TEXT[job.error] : undefined
  if (known) return known
  // `lastLog` of a completed job may well read like a success, so it is not printed under a failure title
  if (job.status === 'completed') return 'งานจบแล้วแต่ระบบยืนยันผลไม่ได้ ให้เข้าไปตรวจที่ Business Center'
  if (job.lastLog) return job.lastLog
  if (job.error) return job.error
  return job.status === 'cancelled' ? 'job ถูกยกเลิก' : 'ไม่ทราบสาเหตุ'
}
