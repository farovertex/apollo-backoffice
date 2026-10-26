/**
 * FEAT-069 — `GET /reports/dashboard` (api-contract.md v1 §3) and `GET /reports/dashboard/now` (§4). 1:1 with
 * the responses. Shared identity blocks come from `report-performance.ts` (same API views).
 */
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

export interface DashboardFunnel {
  metrics: KpiMetrics
  utm: PerfUtmTotals
  winLose: number
  sharedUtms: number
  sharedWith: PerfWorkspaceRef[]
}

export interface DashboardDailyPoint {
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

export interface DashboardWorkspaceRow {
  workspace: PerfWorkspaceRef
  admin: PerfAdminRef | null
  metrics: KpiMetrics
  utm: PerfUtmTotals
  winLose: number
  now: { accounts: number, advertisers: number, launching: number, banned: number, balance: DashboardBalance[] }
}

export interface DashboardAccountRow {
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
