/**
 * FEAT-004 — human tasks (function 3.7, api-contract.md v1). `GET /human-tasks/:id` returns the task with the
 * screenshot inline as base64 PNG; `POST /human-tasks/:id/resolve` takes the code the human typed (202 → a new
 * login job). The API never returns `otpInput`; the BO never logs it, never puts it in the DOM outside the input.
 */

export type HumanTaskStatus = 'open' | 'resolved' | 'expired'

/** `GET /human-tasks/:id` 200 body. */
export interface HumanTask {
  id: string
  tiktokAccountId: string
  jobId: string
  kind: 'otp'
  status: HumanTaskStatus
  instructions: string
  /** PNG base64 (no `data:` prefix) | null when the worker could not take a screenshot */
  screenshotBase64: string | null
  createdAt: string
  expiresAt: string
  resolvedAt: string | null
}

/** `POST /human-tasks/:id/resolve` body — digits only, 4..8 (400 otherwise). */
export interface ResolveHumanTaskBody {
  otpInput: string
}

/** `POST /human-tasks/:id/resolve` 202 body — the follow-up login job. */
export interface ResolveHumanTaskResponse {
  jobId: string
}
