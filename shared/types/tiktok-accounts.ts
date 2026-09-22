/**
 * FEAT-003 — `/tiktok-accounts` (apollo-api, functions 3.1 + 3.3 + delete from 3.2). Mirrors
 * mission-control/.ai/features/FEAT-003-tiktok-accounts/api-contract.md v1 ("Account view").
 * `password` is plaintext by human decision (2026-09-22): the BO masks it and never logs / screenshots it.
 * FEAT-004 (login flow, api-contract.md v1): the view gains `loginFailures`, `lastLoginError`, `openHumanTask`,
 * `runningJob`; `POST /tiktok-accounts/:id/login` answers 202 `LoginJobResponse` (named so it does not shadow auth.ts `LoginResponse`) or 409 `LoginConflictBody`.
 * FEAT-005 (discover advertisers, api-contract.md v1 §5): the view gains `bcOrgId`, `advertiserCount`,
 * `lastDiscoverAt`, `lastDiscoverError`; `runningJob.type` is `login | discover`, `trigger` may be `afterLogin`,
 * `step` may be a discover step; `POST /tiktok-accounts/:id/discover` answers 202 `DiscoverJobResponse`
 * (shared/types/advertisers.ts) or 409 `LoginConflictBody` (+ `jobType`).
 */

export type SessionStatus = 'unknown' | 'loggedIn' | 'loggedOut' | 'needsHuman' | 'disabled'

/** Reason the last login job stopped (`tiktokAccounts.lastLoginError`); null after a success or a manual Login. */
export type LoginError
  = 'badCredentials' | 'captchaFailed' | 'otpExpired' | 'otpRejected' | 'deviceVerify' | 'blocked' | 'timeout' | 'unknown'

/** Reason the last discover job stopped (`tiktokAccounts.lastDiscoverError`); null after a success. */
export type DiscoverError = 'notLoggedIn' | 'noOrgId' | 'listApiFailed' | 'timeout' | 'unknown'

/**
 * Live step of a job (`jobs.step`). Login steps are shown by the LoginModal while running; the discover steps
 * (`openingOverview` … `saving`) only appear on `runningJob.type === 'discover'`.
 */
export type JobStep
  = 'starting' | 'checking' | 'fillingForm' | 'solvingCaptcha' | 'waitingHuman' | 'enteringOtp' | 'finishing'
    | 'openingOverview' | 'openingAccounts' | 'fetchingPages' | 'saving'

/** `afterLogin` = discover job enqueued automatically by a login success (FEAT-005). */
export type JobTrigger = 'manual' | 'retry' | 'human' | 'afterLogin'

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
  type: 'login' | 'discover'
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
  /** Business Center `org_id` read by the discover job; null until the first successful discover */
  bcOrgId: string | null
  /** advertisers of this account with `missingSince === null`; recomputed by every successful discover */
  advertiserCount: number
  /** ISO | null — time of the last discover attempt (success or failure) */
  lastDiscoverAt: string | null
  lastDiscoverError: DiscoverError | null
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

/**
 * `POST /tiktok-accounts/:id/login` and `…/discover` 409 body: a job is already waiting/active (`jobId`, and since
 * FEAT-005 its `jobType`) or a human task is open (`humanTaskId`).
 */
export interface LoginConflictBody {
  error: string
  jobId?: string
  jobType?: 'login' | 'discover'
  humanTaskId?: string
}
