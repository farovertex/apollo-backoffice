/**
 * FEAT-102 — Thai texts and pure helpers of the Pixel page (api-contract.md v1 §6, §7.3; spec "UI behaviour").
 * Side-effect free: the page and the components only render what these functions return.
 * `BC_PIXEL_CONFLICT_TEXT` is copied verbatim from the API's `BC_PIXEL_CONFLICT` (§6.1). A 409 always shows the
 * API's own `error`; the map is used where the BO has only a code (the options `reason`) and as a fallback.
 */
import type { FetchError } from 'ofetch'
import { mssgErrorText } from './mssg'
import type {
  BcPixelConflictBody,
  BcPixelConflictReason,
  BcPixelJobStatus,
  PixelEventStatus,
  PixelJobView,
  PixelStepKey,
  PixelStepState,
  PixelSummary,
  PixelView,
  RunOutcome,
  RunStatus,
  RunStopReason,
  RunSummary,
  RunView
} from '#shared/types/bc-pixels'

export const BC_PIXEL_NAME_MAX = 40
export const BC_PIXEL_LIST_LIMIT = 20
export const BC_PIXEL_POLL_MS = 2000

// ── §6.1 409 texts ───────────────────────────────────────────────────────────────────────────────────────────────────

export const BC_PIXEL_CONFLICT_TEXT: Record<BcPixelConflictReason, string> = {
  siteGone: 'เว็บนี้ไม่อยู่บน mssg แล้ว',
  siteUnpublished: 'เว็บนี้ยังไม่เผยแพร่ — เผยแพร่เว็บก่อน',
  workspaceMismatch: 'เว็บและบัญชี TikTok ต้องอยู่ workspace เดียวกัน',
  noOrg: 'ไม่พบ Business Center นี้ในบัญชี — กด Sync ก่อน',
  orgMissing: 'Business Center นี้ไม่อยู่ในบัญชีแล้ว',
  noProfile: 'บัญชีนี้ยังไม่มีโปรไฟล์ที่พร้อมใช้',
  inactive: 'account ถูกปิดใช้งาน',
  duplicate: 'มีงานนี้ของ pixel/เว็บนี้ทำอยู่แล้ว',
  pixelExists: 'เว็บนี้มี pixel อยู่แล้ว — เลือก “สร้าง pixel ใหม่แทนตัวเดิม” ถ้าต้องการเปลี่ยน',
  nameTaken: 'มี pixel ชื่อนี้ใน Business Center นี้แล้ว',
  noAccounts: 'workspace ของเว็บนี้ยังไม่มีบัญชี TikTok ที่มี Business Center',
  createOpen: 'กำลังสร้าง pixel ของเว็บนี้อยู่',
  superseded: 'pixel นี้ถูกแทนด้วย pixel ใหม่แล้ว',
  alreadyInstalled: 'เว็บนี้ใส่โค้ด pixel นี้แล้ว',
  siteDraftPending: 'เว็บนี้มีร่างที่ยังไม่บันทึก — บันทึกหรือทิ้งร่างในตัวแก้ไขเว็บก่อน',
  notInstalled: 'ยังไม่ได้ใส่โค้ด pixel ลงเว็บ',
  eventExists: 'pixel นี้มี event กดปุ่มแล้ว',
  buttonNotFound: 'ไม่พบปุ่มนี้บนเว็บ — โหลดรายการปุ่มใหม่',
  unknownAdvertiser: 'บัญชีโฆษณานี้ไม่ได้อยู่ใน Business Center ของ pixel',
  alreadyLinked: 'บัญชีที่เลือกผูกกับ pixel นี้อยู่แล้ว',
  notLinked: 'บัญชีที่เลือกไม่ได้ผูกกับ pixel นี้',
  linkBusy: 'กำลังทำงานผูกบัญชีของ pixel นี้อยู่',
  noEvent: 'pixel นี้ยังไม่มี event กดปุ่ม',
  runOpen: 'กำลังทำให้ pixel นี้เขียวอยู่แล้ว',
  invalidState: 'งานนี้อยู่ในสถานะที่ทำคำสั่งนี้ไม่ได้',
  nothingToRetry: 'event นี้เขียวแล้ว ไม่มีอะไรให้ลองใหม่',
  // dynamic on the API (the JobsService message) — fallback only
  profileProvisioning: 'โปรไฟล์ยังสร้างไม่เสร็จ'
}

export function bcPixelConflictText(reason: string | null | undefined): string {
  if (!reason) return 'ทำรายการนี้ไม่ได้ตอนนี้'
  return (BC_PIXEL_CONFLICT_TEXT as Record<string, string>)[reason] ?? reason
}

// ── §7.3 job error codes ─────────────────────────────────────────────────────────────────────────────────────────────

export const BC_PIXEL_ERROR_TEXT: Record<string, string> = {
  gate: 'เข้าหน้า Business Center ไม่ได้ (ติดด่านยืนยันตัวตน)',
  notLoggedIn: 'บัญชีหลุด login — กด Login ที่หน้า TikTok accounts',
  profileBusy: 'โปรไฟล์ไม่ว่าง ลองใหม่อีกครั้ง',
  noCreatePermission: 'login นี้ไม่มีสิทธิ์สร้าง pixel ใน BC นี้',
  quotaExhausted: 'BC นี้สร้าง pixel ครบโควตาแล้ว',
  nameTaken: 'มี pixel ชื่อนี้ใน BC แล้ว — เปลี่ยนชื่อแล้วสร้างใหม่',
  nameInvalid: 'TikTok ไม่รับชื่อ pixel นี้',
  createRejected: 'TikTok ปฏิเสธการสร้าง',
  createNotProven: 'กดสร้างแล้วแต่ยืนยันผลไม่ได้ — ตรวจใน BC ก่อนลองใหม่',
  identityVerifyMailbox: 'ต้องยืนยันตัวตนทางอีเมล แต่ระบบอ่านกล่องเมลของบัญชีนี้ไม่ได้',
  identityVerifyTimeout: 'รอรหัสยืนยันทางอีเมลไม่ทัน',
  identityVerifyRejected: 'TikTok ไม่รับรหัสยืนยัน',
  pixelMissing: 'ไม่พบ pixel นี้ใน BC',
  siteUnreachable: 'เปิดเว็บไม่ได้ (เว็บตอบ error)',
  builderNotLoaded: 'Event Builder ไม่ขึ้นบนเว็บ — ตรวจว่าโค้ด pixel อยู่บนเว็บที่เผยแพร่แล้ว',
  buttonNotFound: 'ไม่พบปุ่มข้อความนี้บนเว็บ',
  buttonMismatch: 'Event Builder จับปุ่มได้ไม่ตรงกับที่เลือก',
  accountNotListed: 'ไม่พบบัญชีที่เลือกในรายการของ BC',
  linkRejected: 'TikTok ปฏิเสธคำสั่ง',
  unlinkRejected: 'TikTok ปฏิเสธคำสั่ง',
  linkNotProven: 'ทำแล้วแต่ยืนยันผลไม่ได้ — รายการที่แสดงคือสถานะล่าสุดจาก BC',
  unlinkNotProven: 'ทำแล้วแต่ยืนยันผลไม่ได้ — รายการที่แสดงคือสถานะล่าสุดจาก BC',
  testCookieStuck: 'โปรไฟล์ยังอยู่ในโหมดทดสอบของ TikTok — ปิดแล้วเปิดโปรไฟล์ใหม่',
  ruleNotEffective: 'กดปุ่มแล้ว TikTok ยังไม่ส่ง event (กฎอาจยังไม่มีผล รอได้ถึง 30 นาที)',
  statsUnreadable: 'อ่านสถานะ event ไม่ได้',
  verifyTimeout: 'ครบเวลารอแล้วยังไม่เขียว'
}

/** codes of §6.2 that have no sentence of their own → "หน้าของ TikTok เปลี่ยนหรือเกิดข้อผิดพลาด (<code>)" */
export const BC_PIXEL_GENERIC_ERROR_CODES: readonly string[] = [
  'addButtonMissing',
  'wizardMissing',
  'guideMissing',
  'drawerMissing',
  'eventTypeMissing',
  'account or profile missing',
  'accountDeleted',
  'workerLost',
  'unknown'
]

/** Thai text of a job error code; an unknown code is shown as itself (§7.3) */
export function bcPixelErrorText(code: string | null | undefined): string {
  if (!code) return 'งานไม่สำเร็จ'
  const text = BC_PIXEL_ERROR_TEXT[code]
  if (text) return text
  if (BC_PIXEL_GENERIC_ERROR_CODES.includes(code)) return `หน้าของ TikTok เปลี่ยนหรือเกิดข้อผิดพลาด (${code})`
  return code
}

/**
 * Error text of the install job: it is an `mssgApply`, whose codes are the mssg ones (FEAT-101). Our own map first
 * (shared codes such as `profileBusy`), then the mssg sentence, then the code itself.
 */
export function bcPixelInstallErrorText(code: string | null | undefined): string {
  if (!code) return 'งานไม่สำเร็จ'
  if (BC_PIXEL_ERROR_TEXT[code] || BC_PIXEL_GENERIC_ERROR_CODES.includes(code)) return bcPixelErrorText(code)
  return mssgErrorText(code)
}

// ── run texts (§7.3) ─────────────────────────────────────────────────────────────────────────────────────────────────

export const BC_PIXEL_RUN_STATUS_TEXT: Record<Exclude<RunStatus, 'completed'>, string> = {
  running: 'กำลังทำ',
  stopping: 'กำลังหยุด',
  stopped: 'หยุดแล้ว'
}
export const BC_PIXEL_RUN_STOP_TEXT: Record<RunStopReason, string> = {
  human: 'หยุดโดยผู้ใช้',
  notLoggedIn: 'บัญชีหลุด login — กด Login แล้วกดทำต่อ',
  cancelled: 'งานย่อยถูกยกเลิก'
}
export const BC_PIXEL_RUN_OUTCOME_TEXT: Record<RunOutcome, string> = {
  active: 'เขียวแล้ว (Active)',
  notActive: 'ยังไม่เขียว',
  failed: 'ไม่สำเร็จ'
}

/** the status badge text of a run: status, or the outcome once `completed` */
export function bcPixelRunStatusText(run: Pick<RunSummary, 'status' | 'outcome'>): string {
  if (run.status === 'completed') return run.outcome ? BC_PIXEL_RUN_OUTCOME_TEXT[run.outcome] : 'เสร็จแล้ว'
  return BC_PIXEL_RUN_STATUS_TEXT[run.status]
}

export function bcPixelRunStopText(reason: RunStopReason | string | null | undefined): string {
  if (!reason) return ''
  return (BC_PIXEL_RUN_STOP_TEXT as Record<string, string>)[reason] ?? reason
}

export function bcPixelRunColor(run: Pick<RunSummary, 'status' | 'outcome'>): 'primary' | 'warning' | 'success' | 'error' | 'neutral' {
  if (run.status === 'running') return 'primary'
  if (run.status === 'stopping' || run.status === 'stopped') return 'warning'
  if (run.outcome === 'active') return 'success'
  if (run.outcome === 'failed') return 'error'
  return 'warning'
}

/** `bpx-run-note` */
export function bcPixelRunNote(presses: number): string {
  return `ระบบจะกดปุ่มบนเว็บจริง ${presses} ครั้ง แล้วรอ TikTok ยืนยัน (ปกติ ~11 นาที สูงสุด 30 นาที)`
}

// ── toasts (§7.3 titles) ─────────────────────────────────────────────────────────────────────────────────────────────

export const BC_PIXEL_TOAST = {
  createStarted: 'เริ่มสร้าง pixel แล้ว',
  createDone: 'สร้าง pixel สำเร็จ',
  createFailed: 'สร้าง pixel ไม่สำเร็จ',
  installStarted: 'เริ่มใส่โค้ด pixel ลงเว็บแล้ว',
  eventStarted: 'เริ่มสร้าง event แล้ว',
  linkStarted: 'เริ่มผูกบัญชีแล้ว',
  unlinkStarted: 'เริ่มเลิกผูกบัญชีแล้ว',
  runStarted: 'เริ่มทำให้เขียวแล้ว',
  runActive: 'pixel เขียวแล้ว',
  runNotActive: 'pixel ยังไม่เขียว',
  runFailed: 'ทำให้ pixel เขียวไม่สำเร็จ'
} as const

// ── fixed UI texts (spec "UI behaviour") ─────────────────────────────────────────────────────────────────────────────

export const BC_PIXEL_TEXT = {
  empty: 'ยังไม่มี pixel — กด สร้าง pixel',
  superseded: 'pixel เก่า',
  hasPixel: 'มี pixel แล้ว',
  replace: 'สร้าง pixel ใหม่แทนตัวเดิม (ตัวเดิมยังอยู่ใน BC และลบไม่ได้)',
  createWarning: 'pixel ลบไม่ได้ และใช้โควตาของ BC (800 ตัว)',
  install: 'ใส่โค้ด pixel ลงเว็บ',
  duplicateText: 'ข้อความซ้ำ — TikTok นับรวมกัน',
  eventStale: 'ข้อความปุ่มบนเว็บเปลี่ยนแล้ว — event นี้จะไม่นับ',
  linkBusy: 'กำลังทำงานผูกบัญชีอยู่',
  runStart: 'เริ่มทำให้เขียว',
  runVerify: 'ตรวจสถานะอีกครั้ง',
  nameEmpty: 'ชื่อ pixel ว่างไม่ได้',
  nameTooLong: `ชื่อ pixel ยาวได้ไม่เกิน ${BC_PIXEL_NAME_MAX} ตัวอักษร`
} as const

// ── steps ────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const BC_PIXEL_STEP_KEYS: readonly PixelStepKey[] = ['create', 'install', 'event', 'link', 'activate']

export const BC_PIXEL_STEP_TITLE: Record<PixelStepKey, string> = {
  create: 'สร้าง pixel',
  install: 'ติดตั้งบนเว็บ',
  event: 'สร้าง event กดปุ่ม',
  link: 'ผูกบัญชีโฆษณา',
  activate: 'ทำให้เขียว'
}

export const BC_PIXEL_STEP_STATE_TEXT: Record<PixelStepState, string> = {
  done: 'เสร็จแล้ว',
  current: 'ขั้นถัดไป',
  todo: 'ยังไม่ถึง',
  running: 'กำลังทำ',
  failed: 'ไม่สำเร็จ'
}

export const BC_PIXEL_EVENT_STATUS_TEXT: Record<PixelEventStatus, string> = {
  none: 'ยังไม่มี event',
  created: 'รอเขียว',
  active: 'เขียว (Active)'
}
export const BC_PIXEL_EVENT_STATUS_COLOR: Record<PixelEventStatus, 'neutral' | 'warning' | 'success'> = {
  none: 'neutral',
  created: 'warning',
  active: 'success'
}

// ── jobs ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

const OPEN_JOB: readonly BcPixelJobStatus[] = ['pending', 'waiting', 'active']

export function isPixelJobOpen(job: Pick<PixelJobView, 'status'> | null | undefined): boolean {
  return !!job && OPEN_JOB.includes(job.status)
}

export function isPixelJobFailed(job: Pick<PixelJobView, 'status'> | null | undefined): boolean {
  return !!job && (job.status === 'failed' || job.status === 'cancelled')
}

export const BC_PIXEL_JOB_STATUS_TEXT: Record<BcPixelJobStatus, string> = {
  pending: 'รอคิว',
  waiting: 'รอคิว',
  active: 'กำลังทำ',
  completed: 'เสร็จแล้ว',
  failed: 'ไม่สำเร็จ',
  cancelled: 'ถูกยกเลิก'
}

/** "รอคิว (ลำดับ 2)" / "กำลังทำ · <step>" — the first line of a running job card */
export function bcPixelJobProgressText(job: PixelJobView): string {
  const base = BC_PIXEL_JOB_STATUS_TEXT[job.status] ?? job.status
  if ((job.status === 'pending' || job.status === 'waiting') && job.queuePosition) return `${base} (ลำดับ ${job.queuePosition})`
  if (job.status === 'active' && job.step) return `${base} · ${job.step}`
  return base
}

/** run is open in the sense of the poll rule (§7.2): `running|stopping`, or verify waiting for its next read */
export function isPixelRunLive(run: Pick<RunView, 'status' | 'verify'> | null | undefined): boolean {
  if (!run) return false
  return run.status === 'running' || run.status === 'stopping' || run.verify.status === 'waiting'
}

/** the panel polls `GET /bc-pixels/:id` while this is true (§7.2) */
export function pixelNeedsPoll(view: Pick<PixelView, 'busy' | 'latestRun'> | null | undefined): boolean {
  if (!view) return false
  return view.busy || isPixelRunLive(view.latestRun)
}

/** a row shows the run spinner while its run is `running|stopping|stopped` (the `bc-pixel-runs/active` set) */
export function rowHasOpenRun(row: Pick<PixelSummary, 'run'>): boolean {
  return !!row.run && row.run.status !== 'completed'
}

// ── names, ids, time ─────────────────────────────────────────────────────────────────────────────────────────────────

/** the API's normalisation (§3.2): trim + collapse whitespace */
export function normalizePixelName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

/** inline error of the name field, `undefined` when valid */
export function pixelNameError(raw: string, max = BC_PIXEL_NAME_MAX): string | undefined {
  const name = normalizePixelName(raw)
  if (!name) return BC_PIXEL_TEXT.nameEmpty
  if (name.length > max) return `ชื่อ pixel ยาวได้ไม่เกิน ${max} ตัวอักษร`
  return undefined
}

export function bcPixelTail(id: string | null | undefined): string {
  return id ? id.slice(-4) : ''
}

export function bcPixelOrgText(org: { name: string, orgId: string, isRoot: boolean }): string {
  return `${org.name || '—'} (…${bcPixelTail(org.orgId)})${org.isRoot ? '' : ' · Sub BC'}`
}

/** "ผูกแล้ว n จาก m บัญชี" */
export function bcPixelLinkSummary(linked: number, total: number): string {
  return `ผูกแล้ว ${linked} จาก ${total} บัญชี`
}

/** "17 พ.ย. 14:05" in Bangkok time; '—' for a missing / bad value */
export function bcPixelDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok'
  })
}

/** "HH:mm" in Bangkok time */
export function bcPixelTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
}

/** "m:ss" left until `iso` (0:00 once passed) — the verify countdown */
export function bcPixelCountdown(iso: string | null | undefined, now: Date): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, Math.ceil((t - now.getTime()) / 1000))
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
}

// ── request errors ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface BcPixelFailure {
  status: number | undefined
  reason: string | null
  /** what the BO shows: a 409's `error` verbatim, a 400's issues, else the message */
  message: string
  body: Partial<BcPixelConflictBody> | undefined
}

export function bcPixelFailure(e: unknown, fallback: string): BcPixelFailure {
  const err = e as FetchError<Partial<BcPixelConflictBody> & { issues?: { path?: string, message?: string }[] }>
  const status = err.response?.status ?? err.statusCode
  const body = err.data ?? undefined
  const reason = typeof body?.reason === 'string' ? body.reason : null
  const issues = body?.issues?.map(i => i.message).filter(Boolean)
  let message: string | undefined
  if (status === 400 && issues?.length) message = issues.join(' · ')
  if (!message && typeof body?.error === 'string' && body.error && body.error !== 'validation') message = body.error
  if (!message && reason) message = bcPixelConflictText(reason)
  return { status, reason, message: message || fallback, body }
}
