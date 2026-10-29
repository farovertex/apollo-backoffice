/**
 * FEAT-085 — job dispatcher round A (api-contract v1 §1, §3; spec "UI behaviour"). Every button that starts browser
 * work now inserts a job as `pending`; the dispatcher releases it per browser profile. These helpers turn the
 * queue fields of a job view (`status`, `queuePosition`, `waitingFor`) and the 409 `duplicate` body into the Thai
 * texts every page shows, so the account badge, the login modal and the row toasts all read the same.
 */
import type { JobWaitingFor, OpenJobStatus } from '#shared/types/tiktok-accounts'

/** `waitingFor` → Thai sub-text of a pending badge (spec "UI behaviour"). */
export const WAITING_FOR_TEXT: Record<JobWaitingFor, string> = {
  profile: 'รอโปรไฟล์ว่าง',
  exclusive: 'รอ login ให้เสร็จก่อน',
  seat: 'รอที่นั่งบนเครื่อง',
  otherNode: 'โปรไฟล์อยู่เครื่องอื่น'
}

/** Thai reason of a pending job; unknown codes fall back to themselves, `null` → `null`. */
export function waitingForText(reason: JobWaitingFor | string | null | undefined): string | null {
  if (!reason) return null
  return (WAITING_FOR_TEXT as Record<string, string>)[reason] ?? reason
}

/** "รอคิว ลำดับที่ n" (n = `queuePosition + 1`); just "รอคิว" when the position is unknown. */
export function queueLabel(queuePosition: number | null | undefined): string {
  return typeof queuePosition === 'number' && queuePosition >= 0 ? `รอคิว ลำดับที่ ${queuePosition + 1}` : 'รอคิว'
}

/** Label "กำลังจะเริ่ม" of a `waiting` (released, not yet claimed) job. */
export const JOB_WAITING_LABEL = 'กำลังจะเริ่ม'

/**
 * One-line queue state of an open job, or `null` for `active` (the caller keeps its own running label):
 * pending → "รอคิว ลำดับที่ n · <reason>", waiting → "กำลังจะเริ่ม".
 */
export function jobQueueText(job: { status: OpenJobStatus | string, queuePosition?: number | null, waitingFor?: string | null }): string | null {
  if (job.status === 'pending') {
    const reason = waitingForText(job.waitingFor)
    return reason ? `${queueLabel(job.queuePosition)} · ${reason}` : queueLabel(job.queuePosition)
  }
  if (job.status === 'waiting') return JOB_WAITING_LABEL
  return null
}

/** 409 `duplicate` toast title: "มีงานนี้รออยู่แล้ว (ลำดับที่ n)" — the position only when the job is pending. */
export function duplicateText(queuePosition: number | null | undefined): string {
  return typeof queuePosition === 'number' && queuePosition >= 0
    ? `มีงานนี้รออยู่แล้ว (ลำดับที่ ${queuePosition + 1})`
    : 'มีงานนี้รออยู่แล้ว'
}

/** Minimal shape of a 409 body that may be a `duplicate` (every FEAT-085 conflict body is compatible). */
export interface MaybeDuplicateBody {
  error?: string
  reason?: string
  jobId?: string
  queuePosition?: number | null
}

/** true when a 409 body is the FEAT-085 `duplicate` answer. */
export function isDuplicate(body: MaybeDuplicateBody | null | undefined): boolean {
  return body?.reason === 'duplicate'
}
