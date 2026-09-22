/**
 * FEAT-003 — `/tiktok-accounts` (apollo-api, functions 3.1 + 3.3 + delete from 3.2). Mirrors
 * mission-control/.ai/features/FEAT-003-tiktok-accounts/api-contract.md v1 ("Account view").
 * `password` is plaintext by human decision (2026-09-22): the BO masks it and never logs / screenshots it.
 * FEAT-004 (login flow, api-contract.md v1): the view gains `loginFailures`, `lastLoginError`, `openHumanTask`,
 * `runningJob`; `POST /tiktok-accounts/:id/login` answers 202 `LoginJobResponse` (named so it does not shadow auth.ts `LoginResponse`) or 409 `LoginConflictBody`.
 */

export type SessionStatus = 'unknown' | 'loggedIn' | 'loggedOut' | 'needsHuman' | 'disabled'

/** Reason the last login job stopped (`tiktokAccounts.lastLoginError`); null after a success or a manual Login. */
export type LoginError
  = 'badCredentials' | 'captchaFailed' | 'otpExpired' | 'otpRejected' | 'deviceVerify' | 'blocked' | 'timeout' | 'unknown'

/** Live step of the login job (`jobs.step`), shown by the LoginModal while running. */
export type JobStep = 'starting' | 'checking' | 'fillingForm' | 'solvingCaptcha' | 'waitingHuman' | 'enteringOtp' | 'finishing'

export type JobTrigger = 'manual' | 'retry' | 'human'

/** Populated browser profile (subset of BROWSER_PROFILES); `null` on the account view if the profile row is gone. */
export interface AccountBrowserProfile {
  id: string
  name: string
  providerProfileId: string
  groupName: string | null
}

/** Open (not expired) human task of the account, as embedded in the account view. */
export interface OpenHumanTask {
  id: string
  kind: 'otp'
  createdAt: string
  expiresAt: string
}

/** Job of the account that is `waiting` or `active`, as embedded in the account view. */
export interface RunningJob {
  id: string
  type: 'login'
  status: 'waiting' | 'active'
  step: JobStep | null
  trigger: JobTrigger
  startedAt: string | null
}

export interface TikTokAccount {
  id: string
  workspaceId: string
  browserProfileId: string
  browserProfile: AccountBrowserProfile | null
  label: string | null
  loginEmail: string
  password: string
  sessionStatus: SessionStatus
  isActive: boolean
  /** ISO | null — set by the login job's "check first" step */
  lastSessionCheckAt: string | null
  /** ISO | null — set by a successful login job */
  lastLoginAt: string | null
  /** consecutive failed login jobs; 2 stops automatic retries until a human presses Login (reset to 0) */
  loginFailures: number
  lastLoginError: LoginError | null
  openHumanTask: OpenHumanTask | null
  runningJob: RunningJob | null
  createdBy: string
  createdAt: string
  updatedAt: string
}

/** `GET /tiktok-accounts` 200 body (sorted `createdAt` desc, no pagination). */
export interface AccountsResponse {
  count: number
  accounts: TikTokAccount[]
}

/** `POST /tiktok-accounts` body (`createTikTokAccountSchema`). `label` omitted or empty → null. */
export interface CreateAccountBody {
  loginEmail: string
  password: string
  browserProfileId: string
  label?: string
}

/** `POST /tiktok-accounts/:id/login` 202 body. */
export interface LoginJobResponse {
  jobId: string
}

/** `POST /tiktok-accounts/:id/login` 409 body: a job is already waiting/active (`jobId`) or a human task is open. */
export interface LoginConflictBody {
  error: string
  jobId?: string
  humanTaskId?: string
}
