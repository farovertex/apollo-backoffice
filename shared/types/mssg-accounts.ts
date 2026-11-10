/**
 * FEAT-099 — mssg Pages (`/mssg-pages`). Mirrors api-contract.md v1 + v2 of the feature: `MssgAccountView`, the list,
 * the GOD-only overview, the request bodies and the 409 reasons. The view never carries a password, cookie or token,
 * and none of the bodies below is ever kept after its request (the password lives only in the modal's form field).
 */

/** v2: `disconnecting` = unlink requested, the `mssgLogout` job has not finished (ends with the account deleted → 404) */
export type MssgAccountStatus = 'connecting' | 'connected' | 'expired' | 'error' | 'disconnecting'

export type MssgSiteStatus = 'published' | 'unpublished' | 'unknown'

/** v2: `mssgLogout` is created by `DELETE /mssg-accounts/:id` only */
export type MssgJobType = 'mssgConnect' | 'mssgSync' | 'mssgLogout'

export type MssgJobStatus = 'pending' | 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled'

/** `lastError.code` values of the contract; the BO maps them to Thai and falls back for anything else */
export type MssgErrorCode
  = | 'mssgBadCredentials'
    | 'mssgTwoFactorRequired'
    | 'mssgCaptcha'
    | 'mssgSessionExpired'
    | 'mssgAccountMismatch'
    | 'mssgPageChanged'
    | 'mssgTimeout'
    | 'mssgSecretExpired'
    | 'profileBusy'
    | 'profileProvisionFailed'
    | 'workerLost'
    | 'claimLost'
    | 'browserUnreachable'

export interface MssgSite {
  name: string
  url: string
  status: MssgSiteStatus
}

export interface MssgJobView {
  id: string
  type: MssgJobType
  status: MssgJobStatus
  /** free short display string: `queued` · `openingProfile` · `loggingIn` · `readingPlan` · `readingSites` · `loggingOut` (v2) · `done` */
  step: string | null
  queuedAt: string
  /** null until terminal */
  finishedAt: string | null
}

export interface MssgLastError {
  /** an `MssgErrorCode`, typed as string so an unknown code still reads */
  code: string
  /** short English detail, no secrets */
  message: string
  at: string
}

export interface MssgBrowserProfileRef {
  id: string
  name: string
  runState: string
}

export interface MssgAccountView {
  id: string
  workspaceId: string
  ownerAdminId: string
  ownerName: string
  email: string
  nickname: string | null
  status: MssgAccountStatus
  browserProfile: MssgBrowserProfileRef | null
  plan: { name: string } | null
  /** `limit: null` = unlimited or not shown by mssg */
  quota: { used: number, limit: number | null } | null
  sites: MssgSite[]
  lastSyncAt: string | null
  job: MssgJobView | null
  lastError: MssgLastError | null
  createdAt: string
  updatedAt: string
}

export interface MssgWorkspaceRef {
  id: string
  name: string
  isOwn: boolean
}

/** `GET /mssg-accounts` 200 */
export interface MssgAccountsResponse {
  count: number
  workspace: MssgWorkspaceRef
  accounts: MssgAccountView[]
}

export interface MssgOverviewWorkspace extends MssgWorkspaceRef {
  accountCount: number
  siteCount: number
  accounts: MssgAccountView[]
}

/** `GET /mssg-accounts/overview` 200 (GOD only) — own workspace first, then by name */
export interface MssgOverviewResponse {
  totals: { workspaces: number, accounts: number, sites: number }
  workspaces: MssgOverviewWorkspace[]
}

/** `POST /mssg-accounts` */
export interface MssgConnectBody {
  email: string
  password: string
  /** GOD acting in another area only; omitted = the caller's own area */
  workspaceId?: string
}

/** `POST /mssg-accounts/:id/relogin` — the password only (spec A4: the email never changes) */
export interface MssgReloginBody {
  password: string
}

/** v2 — `DELETE /mssg-accounts/:id` 200, only when the account had no bound profile (deleted at once) */
export interface MssgUnlinkedBody {
  ok: true
}

/** `PATCH /mssg-accounts/:id` — strict: no other key */
export interface MssgRenameBody {
  nickname: string | null
}

export type MssgConflictReason = 'emailAlreadyLinked' | 'jobInProgress' | 'notConnected'

/** 409 `{ error: 'conflict', reason }`, 400 `{ error: 'validation', issues }`, 502 `{ error: 'profileProvisionFailed' }` */
export interface MssgErrorBody {
  error: string
  reason?: MssgConflictReason | string
  issues?: { path: string, message: string }[]
}
