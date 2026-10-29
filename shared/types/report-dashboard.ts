/**
 * FEAT-069 — `GET /reports/dashboard` (api-contract.md v1 §3) and `GET /reports/dashboard/now` (§4). 1:1 with
 * the responses. Shared identity blocks come from `report-performance.ts` (same API views).
 */
import type { BalanceThb, FxReportBlock, SpendFx, SpendFxRow } from './fx'
import type { KpiMetrics, ReportRangeInfo } from './reports'
import type {
  PerfAccountRef,
  PerfAccountState,
  PerfAdminRef,
  PerfAdvertiserRef,
  PerfBannedItem,
  PerfNotDeliveringItem,
  PerfScope,
  PerfUtmTotals,
  PerfWorkspaceRef
} from './report-performance'

/** FEAT-084 — `metrics.spend` and the cost metrics are THB; `spendByCurrency` / `spendUnconverted` / `converted` added */
export interface DashboardFunnel extends SpendFxRow {
  metrics: KpiMetrics
  utm: PerfUtmTotals
  winLose: number
  sharedUtms: number
  sharedWith: PerfWorkspaceRef[]
}

/** FEAT-084 — `spend` is THB */
export interface DashboardDailyPoint extends SpendFx {
  day: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
  registers: number
  depositors: number
  depositAmount: number
}

/** cumulative within today, one entry per hour 0..currentHour */
export interface DashboardHourlyPoint {
  h: number
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

export interface DashboardBalance {
  currency: string | null
  amount: number
  accounts: number
}

export interface DashboardWorkspaceRow extends SpendFxRow {
  workspace: PerfWorkspaceRef
  admin: PerfAdminRef | null
  metrics: KpiMetrics
  utm: PerfUtmTotals
  winLose: number
  now: { accounts: number, advertisers: number, launching: number, banned: number, balance: DashboardBalance[], balanceThb?: BalanceThb }
}

export interface DashboardAccountRow extends SpendFxRow {
  /** FEAT-084 — `currencyOfAdvertiser()` */
  currency?: string | null
  account: PerfAccountRef | null
  workspace: PerfWorkspaceRef | null
  advertiser: PerfAdvertiserRef
  metrics: KpiMetrics
  utm: PerfUtmTotals
  utmShared: boolean
  state: PerfAccountState
}

export interface DashboardResponse {
  range: ReportRangeInfo
  previous: { from: string | null, to: string | null } | null
  scope: PerfScope
  refreshedAt: string | null
  utmFetchedAt: string | null
  funnel: DashboardFunnel
  previousFunnel: DashboardFunnel | null
  daily: DashboardDailyPoint[]
  /** null unless the range includes today */
  hourly: DashboardHourlyPoint[] | null
  byWorkspace: DashboardWorkspaceRow[]
  byAccount: DashboardAccountRow[]
  /** FEAT-084 §2.1 — scope-wide balances (absent on an older API) */
  now?: { balance: DashboardBalance[], balanceThb: BalanceThb }
  fx?: FxReportBlock
}

export interface DashboardRejectedAd {
  adId: string
  creativeName: string | null
  adGroupName: string | null
  campaignName: string | null
  advertiser: { id: string, name: string | null } | null
  account: PerfAccountRef | null
  reasons: string[]
  coverUrl: string | null
  isVideo: boolean
  lastSeenAt: string | null
}

export interface DashboardNowResponse {
  scope: { workspaceId: string | null }
  refreshedAt: string | null
  launching: { total: number, delivering: number, notDelivering: number, unknown: number }
  reasons: { reason: string, count: number }[]
  ads: { total: number, delivering: number, pending: number, rejected: number, ended: number, unknown: number }
  pending: { optPending: number, optError: number, deletePending: number, deleteError: number }
  banned: { now: number, list: PerfBannedItem[] }
  notDelivering: PerfNotDeliveringItem[]
  rejected: DashboardRejectedAd[]
  accounts: { total: number, loggedIn: number, loggedOut: number, needsHuman: number, disabled: number, unknown: number }
}

/** `?chart=` of `/reports/dashboard` (default `daily`, omitted from the URL) */
export type DashboardChart = 'daily' | 'hourly'
