/**
 * FEAT-102 — BC pixel: pixel, button-click event, link accounts, activate (api-contract.md v1 §2–§6).
 * Exact-key mirrors of the API's views (`PixelJobView` 10 keys, `PixelSummary` 17, `PixelView` 26, `RunView` 15,
 * `RunSummary` 7), every request body / answer of §3 and §5.1, and the code unions of §6. The page and the
 * components never reach into a raw document.
 */

// ── §6 codes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** §6.1 — `reason` of a 409 `{ error, reason, …extra }` (`error` is the Thai sentence the BO shows verbatim) */
export type BcPixelConflictReason
  = | 'siteGone'
    | 'siteUnpublished'
    | 'workspaceMismatch'
    | 'noOrg'
    | 'orgMissing'
    | 'noProfile'
    | 'inactive'
    | 'duplicate'
    | 'pixelExists'
    | 'nameTaken'
    | 'noAccounts'
    | 'createOpen'
    | 'superseded'
    | 'alreadyInstalled'
    | 'siteDraftPending'
    | 'notInstalled'
    | 'eventExists'
    | 'buttonNotFound'
    | 'unknownAdvertiser'
    | 'alreadyLinked'
    | 'notLinked'
    | 'linkBusy'
    | 'noEvent'
    | 'runOpen'
    | 'invalidState'
    | 'nothingToRetry'
    | 'profileProvisioning'

/** the two reasons `GET /bc-pixels/options?siteId=` may answer in `reason` (first match: siteGone → … → createOpen) */
export type BcPixelOptionsReason = 'siteGone' | 'siteUnpublished' | 'noAccounts' | 'createOpen'

/**
 * 409 body. `reason` may also be one of the mssg apply path's own codes (install passes them through:
 * `conflictPending`, `jobInProgress`, `notConnected`, …), hence the `string` widening.
 */
export interface BcPixelConflictBody {
  error: string
  reason: BcPixelConflictReason | string
  /** `duplicate`, `linkBusy` */
  jobId?: string
  /** `pixelExists` */
  pixelId?: string
  /** `unknownAdvertiser` */
  advertiserId?: string
  /** `runOpen` */
  runId?: string
  /** `runOpen`, `invalidState` */
  status?: string
}

/** §6.2 — fixed job error codes (`jobs.error`); an install job carries the mssg job's own code instead */
export type BcPixelJobErrorCode
  // common
  = | 'gate'
    | 'notLoggedIn'
    | 'profileBusy'
    | 'account or profile missing'
    | 'accountDeleted'
    | 'workerLost'
    | 'unknown'
    // bcPixelCreate
    | 'addButtonMissing'
    | 'wizardMissing'
    | 'noCreatePermission'
    | 'quotaExhausted'
    | 'nameTaken'
    | 'nameInvalid'
    | 'createRejected'
    | 'createNotProven'
    | 'identityVerifyMailbox'
    | 'identityVerifyTimeout'
    | 'identityVerifyRejected'
    // bcPixelEventCreate
    | 'pixelMissing'
    | 'guideMissing'
    | 'siteUnreachable'
    | 'builderNotLoaded'
    | 'buttonNotFound'
    | 'buttonMismatch'
    | 'eventTypeMissing'
    // bcPixelLink / bcPixelUnlink
    | 'drawerMissing'
    | 'accountNotListed'
    | 'linkRejected'
    | 'linkNotProven'
    | 'unlinkRejected'
    | 'unlinkNotProven'
    // pixelActivate
    | 'testCookieStuck'
    | 'ruleNotEffective'
    // pixelEventVerify
    | 'statsUnreadable'
    // run-level (step `error` only)
    | 'verifyTimeout'

// ── §1.3 jobs / §2.1 PixelJobView ────────────────────────────────────────────────────────────────────────────────────

export type BcPixelJobType
  = | 'bcPixelCreate'
    | 'bcPixelEventCreate'
    | 'bcPixelLink'
    | 'bcPixelUnlink'
    | 'pixelActivate'
    | 'pixelEventVerify'
    | 'mssgApply'

export type BcPixelJobStatus = 'pending' | 'waiting' | 'active' | 'completed' | 'failed' | 'cancelled'

export interface BcPixelCreateResult {
  /** Apollo id of the new pixel */
  pixelId: string
  pixelCodeLast4: string
  quotaFree: number | null
  identityGate: boolean
}
export interface BcPixelEventResult {
  ruleIdLast4: string
  buttonText: string
}
/** same shape for link and unlink */
export interface BcPixelLinkResult {
  done: string[]
  linkedTotal: number
}
export interface BcPixelActivateResult {
  sent: number
  pressedAt: string[]
}
export interface BcPixelVerifyResult {
  statusRaw: number | null
  active: boolean
  totalEvents: number | null
  lastReceivedAt: string | null
}
export type BcPixelJobResult
  = | BcPixelCreateResult
    | BcPixelEventResult
    | BcPixelLinkResult
    | BcPixelActivateResult
    | BcPixelVerifyResult

/** §2.1 — one shape for the six job types and the install `mssgApply` (10 keys) */
export interface PixelJobView {
  id: string
  type: BcPixelJobType
  status: BcPixelJobStatus
  step: string | null
  /** the fixed code of §6.2 (or the mssg job's own code) */
  error: BcPixelJobErrorCode | string | null
  /** last `error` log line when failed, else the last line */
  lastLog: string | null
  /** `payload.bcPixel.result` (null for `mssgApply`) */
  result: BcPixelJobResult | null
  queuePosition: number | null
  createdAt: string
  finishedAt: string | null
}

// ── §2.2 PixelSummary ────────────────────────────────────────────────────────────────────────────────────────────────

export type PixelStepKey = 'create' | 'install' | 'event' | 'link' | 'activate'
export type PixelStepState = 'done' | 'current' | 'todo' | 'running' | 'failed'
export type PixelSteps = Record<PixelStepKey, PixelStepState>
export type PixelEventStatus = 'none' | 'created' | 'active'

export interface PixelSiteRef {
  id: string
  name: string
  url: string
  domain: string
}
export interface PixelAccountRef {
  id: string
  label: string
}
export interface PixelOrgRef {
  orgId: string
  name: string
  isRoot: boolean
}
export interface PixelAdminRef {
  id: string
  displayName: string
}

/** list row (17 keys) */
export interface PixelSummary {
  id: string
  name: string
  pixelCode: string
  site: PixelSiteRef
  account: PixelAccountRef
  org: PixelOrgRef
  installed: boolean
  eventStatus: PixelEventStatus
  linkedCount: number
  advertiserCount: number
  steps: PixelSteps
  /** any open job of the pixel (the six types or the install apply) or a run in `running|stopping` */
  busy: boolean
  /** open runs only */
  run: RunSummary | null
  superseded: boolean
  createdAt: string
  createdBy: PixelAdminRef | null
  updatedAt: string
}

// ── §2.3 PixelView ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface PixelEventView {
  eventCode: 'ClickButton'
  buttonText: string
  pageUrl: string
  pageId: string
  blockId: string
  itemIndex: number
  ruleIdLast4: string
  status: 'created' | 'active'
  createdAt: string
  activeAt: string | null
  lastCheckedAt: string | null
  /** 1 = No recent activity, 2 = Active */
  lastStatusRaw: number | null
  /** the live page still has an enabled Link item with exactly this text (`true` when the site has no live read yet) */
  targetOnSite: boolean
}

export interface PixelJobs {
  install: PixelJobView | null
  event: PixelJobView | null
  link: PixelJobView | null
}

/** `PixelSummary` + 9 keys (26) */
export interface PixelView extends PixelSummary {
  assetIdLast4: string
  siteGone: boolean
  /** the mssg site's status (`published` is the only one install / event accept) */
  siteStatus: string
  /** the live projection's `tracking.tiktok` (`""` when empty) — what install will overwrite */
  siteTrackingTiktok: string
  event: PixelEventView | null
  linkedSyncedAt: string | null
  jobs: PixelJobs
  latestRun: RunView | null
  supersededAt: string | null
}

// ── §2.4 RunView / RunSummary ────────────────────────────────────────────────────────────────────────────────────────

export type RunStatus = 'running' | 'stopping' | 'stopped' | 'completed'
export type RunStopReason = 'human' | 'notLoggedIn' | 'cancelled'
export type RunOutcome = 'active' | 'notActive' | 'failed'
/** `waiting` = verify between two reads */
export type RunStepStatus = 'pending' | 'active' | 'waiting' | 'done' | 'failed' | 'skipped'
export type RunMode = 'full' | 'verifyOnly'

export interface RunCurrent {
  kind: 'activate' | 'verify'
  jobId: string
  since: string
}

export interface RunStep {
  status: RunStepStatus
  jobId: string | null
  error: BcPixelJobErrorCode | string | null
  lastLog: string | null
  startedAt: string | null
  finishedAt: string | null
}
export interface RunActivateStep extends RunStep {
  attempts: number
  sent: number
  pressedAt: string[]
}
export interface RunVerifyStep extends RunStep {
  checks: number
  nextCheckAt: string | null
  deadlineAt: string | null
  lastStatusRaw: number | null
}

/** 15 keys */
export interface RunView {
  id: string
  pixelId: string
  mode: RunMode
  presses: number
  status: RunStatus
  stopReason: RunStopReason | null
  outcome: RunOutcome | null
  current: RunCurrent | null
  activate: RunActivateStep
  verify: RunVerifyStep
  requestedBy: string | null
  headless: boolean
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

/** 7 keys */
export interface RunSummary {
  id: string
  pixelId: string
  status: RunStatus
  stopReason: RunStopReason | null
  outcome: RunOutcome | null
  current: RunCurrent | null
  updatedAt: string
}

// ── §3.1 options ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PixelCurrentRef {
  id: string
  name: string
  pixelCodeLast4: string
}

/** `GET /bc-pixels/options` (no `siteId`) — one selectable site */
export interface PixelOptionSite {
  id: string
  name: string
  url: string
  status: string
  accountLabel: string
  workspaceId: string
  currentPixel: PixelCurrentRef | null
}
export interface PixelOptionsSitesResponse {
  sites: PixelOptionSite[]
}

export interface PixelOptionOrg {
  orgId: string
  name: string
  isRoot: boolean
  advertiserCount: number
}
export interface PixelOptionAccount {
  id: string
  label: string
  isActive: boolean
  hasProfile: boolean
  orgs: PixelOptionOrg[]
}

/** `GET /bc-pixels/options?siteId=` (7 keys) */
export interface PixelOptionsSiteResponse {
  site: { id: string, name: string, url: string, status: string, workspaceId: string }
  currentPixel: PixelCurrentRef | null
  accounts: PixelOptionAccount[]
  suggestedName: string
  nameMax: number
  canCreate: boolean
  reason: BcPixelOptionsReason | null
}

// ── §3.2 / §3.3 create ───────────────────────────────────────────────────────────────────────────────────────────────

export interface PixelCreateBody {
  siteId: string
  tiktokAccountId: string
  bcOrgId: string
  name: string
  replace?: boolean
}
export interface PixelCreateAccepted {
  jobId: string
  siteId: string
  name: string
}
export interface PixelCreateLatestResponse {
  job: PixelJobView | null
  /** from the job's result when completed for real */
  pixelId: string | null
}

// ── §3.4 / §3.5 list & view ──────────────────────────────────────────────────────────────────────────────────────────

export interface PixelListQuery {
  page?: number
  limit?: number
  search?: string
  siteId?: string
  tiktokAccountId?: string
  bcOrgId?: string
  superseded?: 'false' | 'all'
}
export interface PixelListResponse {
  pixels: PixelSummary[]
  page: number
  limit: number
  total: number
}
/** `GET /bc-pixels/:id`, and the 202 of install / event (`{ pixel }`) */
export interface PixelViewResponse {
  pixel: PixelView
}

// ── §3.7 / §3.8 buttons & event ──────────────────────────────────────────────────────────────────────────────────────

export interface PixelButton {
  pageId: string
  pageName: string
  pageUrl: string
  isHome: boolean
  blockId: string
  itemIndex: number
  text: string
  /** another listed button of the same page has the same text */
  duplicateText: boolean
}
export interface PixelButtonsResponse {
  buttons: PixelButton[]
}
export interface PixelEventBody {
  pageId: string
  blockId: string
  itemIndex: number
}

// ── §3.9 / §3.10 accounts, link / unlink ─────────────────────────────────────────────────────────────────────────────

export interface PixelAccountsQuery {
  page?: number
  limit?: number
  search?: string
  linked?: 'true' | 'false'
}
export interface PixelAccountRow {
  advertiserId: string
  name: string
  status: string
  linked: boolean
  linkedAt: string | null
}
export interface PixelAccountsResponse {
  accounts: PixelAccountRow[]
  page: number
  limit: number
  total: number
  linkedTotal: number
  advertiserTotal: number
  linkedSyncedAt: string | null
}
export interface PixelLinkBody {
  advertiserIds: string[]
}
export interface PixelLinkAccepted {
  pixel: PixelView
  queued: string[]
  skipped: string[]
}

// ── §5.1 runs ────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PixelRunBody {
  presses?: number
  verifyOnly?: boolean
}
/** 202 of `POST …/runs`, 200 of `…/runs/latest` (nullable), `…/runs/:runId` and of stop / resume / retry */
export interface PixelRunResponse {
  run: RunView
}
export interface PixelRunLatestResponse {
  run: RunView | null
}
export interface PixelActiveRunsResponse {
  runs: RunSummary[]
}
