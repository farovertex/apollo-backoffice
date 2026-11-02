/**
 * FEAT-097 — Auto-gen Sub BC and advertisers (api-contract.md v1 §1 / §5 / §6).
 * One run (`bc_autogen_runs`) is a plan the admin submitted plus the live state of every child job of the chain
 * `sub` → `discover` → `adv × N` → `discoverOrg`, one row per sub BC. These types mirror the exact-key view
 * shapes of the contract (`RunView` 13 keys, `RunSummary` 9 keys, `Step` 7 keys, item 10 keys, `adv` 3 keys,
 * `counts` 6 keys, `current` 5 keys) so the page and the two components never reach into a raw doc.
 */
import type { BcSubCurrency } from './tiktok-accounts'

export type BcAutogenStepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped'
export type BcAutogenSkipReason
  = 'subFailed' | 'orgNotFound' | 'limitReached' | 'suspendedAdvertiser' | 'superseded'
export type BcAutogenStepKind = 'sub' | 'discover' | 'adv' | 'discoverOrg'
export type BcAutogenRunStatus = 'running' | 'stopping' | 'stopped' | 'completed'
export type BcAutogenStopReason = 'human' | 'notLoggedIn' | 'cancelled'

/** one child job of the chain; `error`/`lastLog` are the finished job's error + last log line (already redacted) */
export interface BcAutogenStep {
  status: BcAutogenStepStatus
  jobId: string | null
  error: string | null
  lastLog: string | null
  reason: BcAutogenSkipReason | null
  startedAt: string | null
  finishedAt: string | null
}

/** one advertiser of a row: a step plus its 1-based `seq`, resolved `name` and (once created) `advertiserId` */
export interface BcAutogenAdvItem extends BcAutogenStep {
  seq: number
  name: string
  advertiserId: string | null
}

/** the advertiser plan of a row (`null` when the admin did not ask for advertisers under that sub BC) */
export interface BcAutogenAdvPlan {
  prefix: string
  count: number
  items: BcAutogenAdvItem[]
}

/** one sub BC of the plan (`idx` 0-based, shown 1-based); `orgId` resolved after `sub`/`discover` */
export interface BcAutogenRow {
  idx: number
  name: string
  currency: BcSubCurrency
  status: BcAutogenStepStatus
  orgId: string | null
  sub: BcAutogenStep
  discover: BcAutogenStep
  adv: BcAutogenAdvPlan | null
  discoverOrg: BcAutogenStep | null
}

/** step tallies over every step of every row; always add up to `total` (fixed at creation) */
export interface BcAutogenCounts {
  total: number
  pending: number
  active: number
  done: number
  failed: number
  skipped: number
}

/** the one child job in flight; `null` when nothing is running (stopped / completed / between steps) */
export interface BcAutogenCurrent {
  rowIdx: number
  kind: BcAutogenStepKind
  seq: number | null
  jobId: string
  since: string
}

/** `RunView` — the full run (contract §5.1, 13 top-level keys), returned by create / latest / by-id / actions */
export interface BcAutogenRunView {
  id: string
  accountId: string
  status: BcAutogenRunStatus
  stopReason: BcAutogenStopReason | null
  requestedBy: string | null
  headless: boolean
  rootOrgId: string
  counts: BcAutogenCounts
  current: BcAutogenCurrent | null
  rows: BcAutogenRow[]
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

/** `RunSummary` — the light shape (contract §5.2, 9 keys) of `GET /bc-autogen/active` and `suggest.run` */
export interface BcAutogenRunSummary {
  id: string
  accountId: string
  status: BcAutogenRunStatus
  stopReason: BcAutogenStopReason | null
  counts: BcAutogenCounts
  current: BcAutogenCurrent | null
  rowsTotal: number
  createdAt: string
  updatedAt: string
}

/** why the modal cannot start a run (first match `noOrgId → noProfile → inactive → runOpen`, else `null`) */
export type BcAutogenSuggestReason = 'noOrgId' | 'noProfile' | 'inactive' | 'runOpen'

/** `GET …/bc-autogen/suggest` 200 body (7 keys, contract §2.1) */
export interface BcAutogenSuggest {
  bcOrgName: string | null
  currency: BcSubCurrency
  currencyLocked: boolean
  used: string[]
  canStart: boolean
  reason: BcAutogenSuggestReason | null
  run: BcAutogenRunSummary | null
}

/** one plan row as the POST body carries it (`currency` omitted when locked, `adv: null` for unchecked rows) */
export interface BcAutogenCreateRow {
  name: string
  currency?: BcSubCurrency
  adv?: { prefix: string, count: number } | null
}

/** `POST …/bc-autogen` body (contract §2.2); `?headless` is never sent by the BO (A13) */
export interface BcAutogenCreateBody {
  rows: BcAutogenCreateRow[]
}

/** every 409 `reason` the module can answer (contract §3.5) */
export type BcAutogenConflictReason
  = 'noOrgId' | 'noProfile' | 'inactive' | 'runOpen' | 'nameTaken'
    | 'profileProvisioning' | 'invalidState' | 'nothingToRetry'

/** 409 body everywhere: the BO shows `error` verbatim and switches on `reason` */
export interface BcAutogenConflictBody {
  error: string
  reason: BcAutogenConflictReason
  runId?: string
  status?: BcAutogenRunStatus
  rowIdx?: number
  name?: string
}

/** 202 of create and 200 of stop / resume / resume / retry / by-id all carry `{ run }` */
export interface BcAutogenRunResponse {
  run: BcAutogenRunView
}

/** `GET …/bc-autogen/latest` 200 body; `run: null` = this account never ran one */
export interface BcAutogenLatestResponse {
  run: BcAutogenRunView | null
}

/** `GET /bc-autogen/active` 200 body: open runs (`running|stopping|stopped`) of the caller's accounts */
export interface BcAutogenActiveResponse {
  runs: BcAutogenRunSummary[]
}
