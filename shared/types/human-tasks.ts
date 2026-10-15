/**
 * FEAT-004 — human tasks (function 3.7, api-contract.md v1). `GET /human-tasks/:id` returns the task with the
 * screenshot inline as base64 PNG; `POST /human-tasks/:id/resolve` takes the code the human typed (202 → a new
 * login job). The API never returns `otpInput`; the BO never logs it, never puts it in the DOM outside the input.
 *
 * FEAT-051 (api-contract.md v1 §8) — kind `paymentOtp`: the code the **bank** (3DS/ACS page) asks for while a
 * card top-up is being paid. Same `resolve` body, but the 202 carries **no job** (`jobId: null`) because the
 * worker that asked for the code is still holding the profile and picks the value up itself, and a `paymentOtp`
 * task **never has a screenshot** (a picture of the OTP page would be a secret — AC-25).
 */

export type HumanTaskStatus = 'open' | 'resolved' | 'expired'

/** `otp` = TikTok/mailbox login code (FEAT-004) · `paymentOtp` = the bank's 3DS code of a card top-up (FEAT-051) */
export type HumanTaskKind = 'otp' | 'paymentOtp'

/** `GET /human-tasks/:id` 200 body. */
export interface HumanTask {
  id: string
  tiktokAccountId: string
  /** FEAT-051: `null` on a `paymentOtp` task that the API reports without a job id */
  jobId: string | null
  kind: HumanTaskKind
  status: HumanTaskStatus
  instructions: string
  /** PNG base64 (no `data:` prefix) | null when the worker could not take a screenshot — **always null for `paymentOtp`** */
  screenshotBase64: string | null
  /** FEAT-051 — the round this `paymentOtp` task belongs to; null/missing for a login task */
  topupId?: string | null
  createdAt: string
  expiresAt: string
  resolvedAt: string | null
}

/** `POST /human-tasks/:id/resolve` body — digits only, 4..8 (400 otherwise). */
export interface ResolveHumanTaskBody {
  otpInput: string
}

/**
 * `POST /human-tasks/:id/resolve` 202 body — the follow-up login job.
 * FEAT-051: `null` for kind `paymentOtp` (no new job; the worker holding the profile uses the code itself).
 */
export interface ResolveHumanTaskResponse {
  jobId: string | null
}
