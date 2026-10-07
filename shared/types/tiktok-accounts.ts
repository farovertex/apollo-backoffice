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
 * FEAT-023 (batch upload + first login via mailbox, api-contract.md v1 §2–§5): the view gains `emailPassword`,
 * `pendingFirstLogin`, `firstLoginFail`, `firstLoginTries`; `POST /tiktok-accounts` takes `emailPassword` +
 * `pendingFirstLogin`; `POST /tiktok-accounts/batch` takes `BatchAccountsBody` and answers 201 `BatchAccountsResponse`.
 * `password` is the TikTok password, `emailPassword` the mailbox one — both plaintext in the account view only
 * (never logged, never screenshotted, never in a batch result row).
 * FEAT-028 (api-contract.md v1 §6/§7): a batch row may carry an optional `proxy` (the CSV's 4th column) and the
 * result gains the row status `stopped` + the top-level `stopped` count (the pool of free proxies ran dry).
 * FEAT-029 (api-contract.md v1 §4/§5): the view gains `launchingAds` + `launchingSince` (true while at least one
 * advertiser of the account is launching ads, system-written), and `GET /tiktok-accounts` takes the optional
 * query `launchingAds=1|true|0|false`.
 */

import type { TopupView } from './topups'

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

/**
 * `afterLogin` = discover job enqueued automatically by a login success (FEAT-005).
 * `scheduler` = login job enqueued by the first-login scan (FEAT-023 §6), never by a click.
 */
export type JobTrigger = 'manual' | 'retry' | 'human' | 'afterLogin' | 'scheduler'

/**
 * FEAT-023 — why the automatic first login gave up (`tiktokAccounts.firstLoginFail`); null while it may still run
 * or after a success. Shown in the "First login" column; the flag itself is never a label on the UI.
 */
export type FirstLoginFail = 'email_fail' | 'captcha_fail' | 'otp_fail' | 'other_fail'

/** FEAT-023 — attempts per failure kind (`tiktokAccounts.firstLoginTries`); zeros on rows created before the feature. */
export interface FirstLoginTries {
  email: number
  captcha: number
  otp: number
  other: number
}

/** Populated browser profile (subset of BROWSER_PROFILES); `null` on the account view if the profile row is gone. */
export interface AccountBrowserProfile {
  id: string
  name: string
  /** FEAT-024 — `null` while the profile row is only reserved (create job still running) or the create failed */
  providerProfileId: string | null
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
  type: 'login' | 'discover' | 'topup'
  status: 'waiting' | 'active'
  step: JobStep | null
  trigger: JobTrigger
  startedAt: string | null
  /** FEAT-031 — WORKER_INSTANCE of the process running this job; `null` while `waiting` */
  workerInstance: string | null
}

export interface TikTokAccount {
  id: string
  workspaceId: string
  browserProfileId: string
  browserProfile: AccountBrowserProfile | null
  label: string | null
  loginEmail: string
  /** TikTok Ads password */
  password: string
  /** mailbox password of `loginEmail`, used by the automatic first login; null on rows created before FEAT-023 */
  emailPassword: string | null
  /** the scheduler signs this account in once (mailbox then TikTok); the API turns it off on success or on a final failure */
  pendingFirstLogin: boolean
  firstLoginFail: FirstLoginFail | null
  firstLoginTries: FirstLoginTries
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
  /** Business Center name from the organizations API; null when unknown */
  bcOrgName: string | null
  /** BC cash balance (`query_payment_summary` `sum_cash_balance.total_amount`, a string as TikTok sends it); null until read */
  balanceAmount: string | null
  balanceCurrency: string | null
  /** ISO | null — when `balanceAmount` was read (or credited by a paid account-level round) */
  balanceAt: string | null
  /** why the last balance read failed (Thai, shown as-is); null after a success */
  balanceError: string | null
  /** the account-level top-up round of this row (active, or the latest `notFound`); null when none */
  topup: TopupView | null
  /**
   * FEAT-029 — true while at least one advertiser of this account has `launchingAds: true`; recomputed by the
   * publish write and by every kpi round that turns an advertiser off. Optional for an older API.
   */
  launchingAds?: boolean
  /** ISO | null — when the account flag went false → true (cleared when it goes off) */
  launchingSince?: string | null
  /**
   * FEAT-030 §4 — `true` = the kpi job never opens an auto top-up round for any advertiser of this account.
   * **Read-only**: no endpoint body accepts it (a human sets it directly in Mongo) and the BO shows no control
   * for it. Optional for an API that predates the feature (missing ⇒ `false`).
   */
  autoTopupDisabled?: boolean
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

/**
 * FEAT-029 §5 — `launchingAds` query of `GET /tiktok-accounts`: `1` → only accounts that are launching ads,
 * `0` → only the others, omitted → every account (today's behaviour).
 */
export type AccountsLaunchingFilter = '1' | '0'

/** `GET /tiktok-accounts` 200 body (sorted `createdAt` desc, no pagination). */
export interface AccountsResponse {
  count: number
  accounts: TikTokAccount[]
}

/** `POST /tiktok-accounts` body (`createTikTokAccountSchema`). `label` omitted or empty → null. */
export interface CreateAccountBody {
  loginEmail: string
  /** TikTok Ads password */
  password: string
  /** FEAT-023 — mailbox password, required */
  emailPassword: string
  browserProfileId: string
  label?: string
  /** FEAT-023 — omitted = true on the API side; the BO always sends it so the checkbox is the only source */
  pendingFirstLogin?: boolean
}

/** FEAT-023 — one CSV line of `POST /tiktok-accounts/batch`; `label` is always null for imported rows. */
export interface BatchAccountRow {
  loginEmail: string
  emailPassword: string
  password: string
  /**
   * FEAT-028 §6/§7 — present **only** when the CSV had the 4th `proxy` column: `''` (empty cell) = auto-select a
   * free proxy for that row, a `type://[user:pass@]host:port` URL = create-or-reuse that proxy. The key is absent
   * for a 3-column file, which means "use the caller's Default settings mode" (AS-3). No client-side URL check.
   */
  proxy?: string
}

/** FEAT-023 — `POST /tiktok-accounts/batch` body (§5): 1..1000 rows, one flag for the whole file. */
export interface BatchAccountsBody {
  pendingFirstLogin: boolean
  rows: BatchAccountRow[]
}

/**
 * FEAT-023 — result of one batch row. `skip` = the email already exists in the file or in the workspace
 * (`error: 'duplicate'`), `fail` = profile create / bind failed. Never carries a password.
 * FEAT-028 §6 — `stopped` = the row was never processed because an earlier row exhausted the free-proxy pool
 * (`error: 'stopped: no proxy available'`); nothing was created for it, re-uploading the file continues there.
 */
export interface BatchRowResult {
  loginEmail: string
  status: 'ok' | 'skip' | 'fail' | 'stopped'
  id?: string
  error?: string
}

/** FEAT-023 — `POST /tiktok-accounts/batch` 201 body (§5). No login is enqueued by this call. */
export interface BatchAccountsResponse {
  ok: number
  skip: number
  fail: number
  /** FEAT-028 §6 — rows left unprocessed after the free-proxy pool ran dry; always present, `0` when none */
  stopped: number
  rows: BatchRowResult[]
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
