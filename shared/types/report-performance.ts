/**
 * FEAT-069 — `GET /reports/performance` (api-contract.md v1 §2). 1:1 with the response; every block the page
 * renders is typed here, nothing is computed by the API that the BO re-derives (the five ratios are BO-side,
 * contract §6, `app/utils/report-performance.ts`).
 */
import type { ReportRangeInfo } from './reports'

/** `{ id, name }` of a workspace as it appears inside rows and lists */
export interface PerfWorkspaceRef {
  id: string
  name: string | null
}

/** account identity of a row (`label` may be null → the page falls back to `loginEmail`) */
export interface PerfAccountRef {
  id: string
  label: string | null
  loginEmail: string | null
}

export interface PerfAdminRef {
  id: string
  displayName: string | null
}

/** `scope.workspaces[]` — every workspace the caller may pick (GOD) or owns/shares (Admin) */
export interface PerfScopeWorkspace extends PerfWorkspaceRef {
  admin: PerfAdminRef | null
}

export interface PerfScope {
  workspaceId: string | null
  workspaces: PerfScopeWorkspace[]
}

/** facts summed over the range (Thai days) */
export interface PerfUtmTotals {
  registers: number
  depositors: number
  depositAmount: number
  withdrawAmount: number
}

/** builds created in the window, by current status */
export interface PerfBuilds {
  total: number
  done: number
  failed: number
  stopped: number
  running: number
}

export interface PerfSpendDay {
  day: string
  spend: number
}

/** PerfResults (contract §2) — `spendByDay` only on `results`, not on `previousResults` / workspace rows */
export interface PerfResults {
  spend: number
  spendByDay?: PerfSpendDay[]
  usedAdvertisers: number
  usedAccounts: number
  utm: PerfUtmTotals
  sharedUtms: number
  sharedWith: PerfWorkspaceRef[]
  bans: number
  lifted: number
  builds: PerfBuilds
}

export interface PerfBannedItem {
  advertiserId: string
  name: string | null
  tiktokAdvertiserId: string | null
  account: PerfAccountRef | null
  workspace: PerfWorkspaceRef | null
  bannedAt: string | null
}

export interface PerfSessionItem {
  accountId: string
  label: string | null
  loginEmail: string | null
  workspace: PerfWorkspaceRef | null
  sessionStatus: string
  lastLoginError: string | null
}

export interface PerfNotDeliveringItem {
  advertiserId: string
  name: string | null
  account: PerfAccountRef | null
  workspace: PerfWorkspaceRef | null
  reasons: string[]
  since: string | null
}

export interface PerfList<T> {
  count: number
  list: T[]
}

/** `now` — range-independent state */
export interface PerfNow {
  accounts: number
  advertisers: number
  launching: number
  builds: { queued: number, running: number }
  banned: PerfList<PerfBannedItem>
  needsHuman: PerfList<PerfSessionItem>
  loggedOut: PerfList<PerfSessionItem>
  notDelivering: PerfList<PerfNotDeliveringItem>
}

export interface PerfDayRow {
  day: string
  spend: number
  used: number
  bans: number
  lifted: number
  builds: PerfBuilds
}

export interface PerfWorkspaceRow extends Omit<PerfResults, 'spendByDay'> {
  workspace: PerfWorkspaceRef
  admin: PerfAdminRef | null
  now: { accounts: number, advertisers: number, banned: number, launching: number }
}

export interface PerfUtmRow {
  prefix: string
  source: string
  medium: string
  campaign: string
  sourceId: string
  mediumId: string
  campaignId: string
  advertisers: number
  workspaces: PerfWorkspaceRef[]
  /** null when no ad carries the key (FEAT-040 rule) */
  spend: number | null
  spendCurrency: string | null
  registers: number
  depositors: number
  depositAmount: number
  withdrawAmount: number
}

export type PerfAccountState = 'banned' | 'needsHuman' | 'loggedOut' | 'notDelivering' | 'launching' | 'idle'

export interface PerfAdvertiserRef {
  id: string
  name: string | null
  tiktokAdvertiserId: string | null
}

export interface PerfAccountRow {
  account: PerfAccountRef | null
  workspace: PerfWorkspaceRef | null
  advertiser: PerfAdvertiserRef
  utmCampaigns: string[]
  spend: number
  state: PerfAccountState
}

export interface PerformanceResponse {
  range: ReportRangeInfo
  previous: { from: string | null, to: string | null } | null
  scope: PerfScope
  refreshedAt: string | null
  utmFetchedAt: string | null
  results: PerfResults
  previousResults: Omit<PerfResults, 'spendByDay'> | null
  trend: PerfSpendDay[]
  now: PerfNow
  byDay: PerfDayRow[]
  byWorkspace: PerfWorkspaceRow[]
  byUtm: PerfUtmRow[]
  byAccount: PerfAccountRow[]
}

/** `?tab=` of `/reports/performance` (default `day`, omitted from the URL) */
export type PerfTab = 'day' | 'workspace' | 'utm' | 'account'
