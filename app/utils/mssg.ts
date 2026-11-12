/**
 * FEAT-100 — Thai texts and small pure helpers of `/mssg-pages` (spec "UI behaviour", api-contract.md v1).
 * The API sends codes (`lastError.code`, 409 `reason`, `job.step`); every sentence the user reads lives here, and
 * every map has a fallback so an unknown code still prints something sensible.
 */
import type { FetchError } from 'ofetch'
import type {
  MssgAccountStatus,
  MssgAccountView,
  MssgConflictReason,
  MssgErrorBody,
  MssgErrorCode,
  MssgJobStatus,
  MssgJobView,
  MssgSiteStatus
} from '#shared/types/mssg-accounts'

/** re-read interval of `GET /mssg-accounts/:id` while a job is open */
export const MSSG_POLL_MS = 2000
/** stop following one job after this long and tell the user to reload */
export const MSSG_POLL_MAX_MS = 15 * 60 * 1000

export const MSSG_SOON = 'เร็ว ๆ นี้'
export const MSSG_POLL_TIMEOUT_TEXT = 'ยังไม่เสร็จ ลองรีเฟรช'
export const MSSG_SYNCING_TEXT = 'กำลังดึงข้อมูลจาก mssg…'
export const MSSG_EMPTY_TEXT = 'ยังไม่ได้เชื่อมบัญชี mssg'
export const MSSG_LOAD_FALLBACK = 'โหลดบัญชี mssg ไม่สำเร็จ'

/** `lastError.code` → Thai (contract "Error codes"); `mssgErrorText()` adds the generic fallback */
export const MSSG_ERROR_TEXT: Record<MssgErrorCode, string> = {
  mssgBadCredentials: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง ลองใหม่อีกครั้ง',
  mssgTwoFactorRequired: 'บัญชีนี้เปิดการยืนยันสองขั้นตอน (2FA) ซึ่งระบบยังไม่รองรับ ให้ปิด 2FA ใน mssg แล้วลองใหม่',
  mssgCaptcha: 'mssg ขอให้ยืนยันตัวตน (captcha) ระบบกดแทนไม่ได้ ลองใหม่ภายหลัง',
  mssgSessionExpired: 'การเข้าสู่ระบบ mssg หมดอายุ ต้องเข้าสู่ระบบใหม่',
  mssgAccountMismatch: 'บัญชีที่ล็อกอินอยู่ใน mssg ไม่ใช่อีเมลนี้ ตรวจอีเมลแล้วเข้าสู่ระบบใหม่',
  mssgPageChanged: 'หน้าเว็บ mssg เปลี่ยนรูปแบบ ระบบอ่านข้อมูลไม่ได้ แจ้งผู้ดูแลระบบ',
  mssgTimeout: 'mssg ใช้เวลานานเกินกำหนด ลองใหม่อีกครั้ง',
  mssgSecretExpired: 'รหัสผ่านที่ส่งไว้หมดอายุก่อนเริ่มงาน กรอกรหัสผ่านใหม่อีกครั้ง',
  profileBusy: 'โปรไฟล์เบราว์เซอร์ไม่ว่างนานเกินไป ลองใหม่ภายหลัง',
  profileProvisionFailed: 'สร้างโปรไฟล์เบราว์เซอร์สำหรับบัญชีนี้ไม่สำเร็จ',
  workerLost: 'ระบบหยุดทำงานกลางคัน ลองใหม่อีกครั้ง',
  claimLost: 'งานหลุดจากคิวกลางคัน ลองใหม่อีกครั้ง',
  browserUnreachable: 'เปิดโปรไฟล์เบราว์เซอร์ไม่ได้ ลองใหม่ภายหลัง'
}

export const MSSG_ERROR_FALLBACK = 'ทำงานกับ mssg ไม่สำเร็จ ลองใหม่อีกครั้ง'

export function mssgErrorText(code: string | null | undefined): string {
  if (!code) return MSSG_ERROR_FALLBACK
  return (MSSG_ERROR_TEXT as Record<string, string>)[code] ?? MSSG_ERROR_FALLBACK
}

/** 409 `reason` → Thai */
export const MSSG_CONFLICT_TEXT: Record<MssgConflictReason, string> = {
  emailAlreadyLinked: 'อีเมลนี้เชื่อมกับระบบอยู่แล้ว',
  jobInProgress: 'บัญชีนี้ยังมีงานกำลังทำอยู่ รอให้งานเสร็จก่อนแล้วลองใหม่',
  notConnected: 'บัญชีนี้ยังไม่ได้เชื่อม ให้เข้าสู่ระบบใหม่ก่อน'
}

export const MSSG_STATUS_TEXT: Record<MssgAccountStatus, string> = {
  connecting: 'กำลังเชื่อม',
  connected: 'เชื่อมแล้ว',
  expired: 'หมดอายุ · ต้องเข้าสู่ระบบใหม่',
  error: 'เชื่อมไม่สำเร็จ',
  disconnecting: 'กำลังออกจากระบบ…'
}

export const MSSG_STATUS_COLOR: Record<MssgAccountStatus, 'info' | 'success' | 'warning' | 'error' | 'neutral'> = {
  connecting: 'info',
  connected: 'success',
  expired: 'warning',
  error: 'error',
  disconnecting: 'neutral'
}

export function mssgStatusText(status: string): string {
  return (MSSG_STATUS_TEXT as Record<string, string>)[status] ?? status
}

export function mssgStatusColor(status: string): 'info' | 'success' | 'warning' | 'error' | 'neutral' {
  return (MSSG_STATUS_COLOR as Record<string, 'info' | 'success' | 'warning' | 'error' | 'neutral'>)[status] ?? 'neutral'
}

export const MSSG_SITE_STATUS_TEXT: Record<MssgSiteStatus, string> = {
  published: 'เผยแพร่อยู่',
  unpublished: 'ยังไม่เผยแพร่',
  unknown: 'ไม่ทราบสถานะ'
}

export function mssgSiteStatusText(status: string): string {
  return (MSSG_SITE_STATUS_TEXT as Record<string, string>)[status] ?? status
}

/** `job.step` → Thai; an unknown step prints itself */
export const MSSG_STEP_TEXT: Record<string, string> = {
  queued: 'รอคิว',
  openingProfile: 'กำลังเปิดโปรไฟล์เบราว์เซอร์',
  loggingIn: 'กำลังเข้าสู่ระบบ mssg',
  readingPlan: 'กำลังอ่านแพ็กเกจและโควตา',
  readingSites: 'กำลังอ่านรายการเว็บ',
  loggingOut: 'กำลังออกจากระบบ mssg ในโปรไฟล์',
  done: 'เสร็จแล้ว'
}

export function mssgJobIsOpen(job: Pick<MssgJobView, 'status'> | null | undefined): boolean {
  const s: MssgJobStatus | undefined = job?.status
  return s === 'pending' || s === 'waiting' || s === 'active'
}

/**
 * v2 — does the page still follow this account? While its job is open, and while it is `disconnecting` even if the
 * logout job already reads terminal: the unlink is complete only when `GET /mssg-accounts/:id` answers 404.
 */
export function mssgNeedsPoll(account: Pick<MssgAccountView, 'job' | 'status'>): boolean {
  return mssgJobIsOpen(account.job) || account.status === 'disconnecting'
}

/** v2 — unlink 409 `jobInProgress`: a job of the account is running (or it is already logging out) */
export const MSSG_UNLINK_BUSY_TEXT = 'ยกเลิกการเชื่อมตอนนี้ไม่ได้ เพราะยังมีงานของบัญชีนี้ทำอยู่ รอให้งานเสร็จก่อนแล้วลองใหม่'

/** v2 — `DELETE /browser-profiles/:id` 409 `mssgBound` on the Browser profiles page */
export const MSSG_PROFILE_BOUND_TEXT = 'profile นี้ผูกกับบัญชี mssg อยู่ ให้ยกเลิกการเชื่อมก่อน'

/** one line of progress for an open job: queue state first, then the worker's step */
export function mssgJobProgressText(job: MssgJobView | null | undefined): string {
  if (!job) return MSSG_STEP_TEXT.queued!
  if (job.type === 'mssgLogout' && job.status !== 'active') return job.status === 'pending' ? 'รอคิวออกจากระบบ' : 'กำลังออกจากระบบ…'
  if (job.status === 'pending') return 'รอคิว'
  if (job.status === 'waiting') return 'กำลังจะเริ่ม'
  if (job.step && MSSG_STEP_TEXT[job.step]) return MSSG_STEP_TEXT[job.step]!
  return job.step || 'กำลังทำงาน'
}

/** "เว็บ 2/3" — `∞` when mssg shows no limit, `—` when the quota was never read */
export function mssgQuotaText(quota: MssgAccountView['quota']): string {
  if (!quota) return '—'
  return `${quota.used}/${quota.limit ?? '∞'}`
}

/** 0..100 for the quota bar; 0 when there is no limit */
export function mssgQuotaPct(quota: MssgAccountView['quota']): number {
  if (!quota || !quota.limit) return 0
  return Math.max(0, Math.min(100, Math.round((quota.used / quota.limit) * 100)))
}

export function mssgQuotaFull(quota: MssgAccountView['quota']): boolean {
  return !!quota && quota.limit !== null && quota.used >= quota.limit
}

/** "อัปเกรดเป็น Pro" is offered on every plan except one that already reads "Pro" */
export function mssgIsPro(plan: MssgAccountView['plan']): boolean {
  return !!plan && plan.name.trim().toLowerCase() === 'pro'
}

/** nickname, else the email — the name of an account in toasts and dialogs */
export function mssgAccountName(account: Pick<MssgAccountView, 'nickname' | 'email'>): string {
  return account.nickname || account.email
}

export interface MssgFailure {
  status: number | undefined
  body: Partial<MssgErrorBody> | undefined
  /** Thai sentence for a toast or an alert */
  message: string
}

/** status + body + one Thai sentence for a failed request (409 reason, 502 provision, 404, else the API's text) */
export function mssgFailure(e: unknown, fallback: string): MssgFailure {
  const err = e as FetchError<Partial<MssgErrorBody>>
  const status = err.response?.status ?? err.statusCode
  const body = err.data ?? undefined
  let message: string | undefined
  if (status === 409 && body?.reason) message = (MSSG_CONFLICT_TEXT as Record<string, string>)[body.reason]
  if (!message && status === 502 && body?.error === 'profileProvisionFailed') message = MSSG_ERROR_TEXT.profileProvisionFailed
  if (!message && status === 404) message = 'ไม่พบบัญชีหรือพื้นที่นี้'
  if (!message && status === 403) message = 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้'
  if (!message && status === 400) message = body?.issues?.[0]?.message
  return { status, body, message: message ?? fallback }
}
