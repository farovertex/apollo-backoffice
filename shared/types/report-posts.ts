/**
 * FEAT-089 — `GET /reports/posts` + `GET /reports/posts/:key` (api-contract.md v1 §1–§3). 1:1 with the
 * response; every block the two pages render is typed here. `SpendFxRow` (FEAT-084, `./fx`) is reused for the
 * money block exactly as `PerfResults` does.
 */
import type { MoneyUnconverted, SpendFxRow } from './fx'
import type { ReportRangeInfo } from './reports'
import type { PerfScopeWorkspace } from './report-performance'

/** `by` of both endpoints (contract §1 "Definitions → lens key") */
export type PostReportLens = 'post' | 'adTemplate' | 'adGroupTemplate' | 'account'

/** contract §1.1 */
export interface PostReportSubject {
  kind: PostReportLens
  title: string
  subtitle: string
  coverUrl: string | null
  isVideo: boolean | null
  durationSec: number | null
  templates: Array<{ id: string, name: string }>
  templatesMore: number
  exists: boolean | null
  unknownPost: boolean
}

export interface PostReportBuildCounts {
  total: number
  approved: number
  rejected: number
  pending: number
  unknown: number
  accounts: number
  advertisers: number
  /** v1.1 — ad-level (per-creative) counts over every `ads` row of the group's builds */
  ads: number
  adsApproved: number
  adsRejected: number
}

export interface PostReportTopReason {
  label: string
  count: number
}

export interface PostReportReview {
  approvedRate: number | null
  hoursMedian: number | null
  hoursP90: number | null
  within24h: number | null
  topReason: PostReportTopReason | null
  appeals: { submitted: number, approved: number }
  /** v1.1 — adsApproved / (adsApproved + adsRejected), null when 0 */
  adApprovedRate: number | null
}

export interface PostReportDecided {
  survived: number
  decided: number
}

export interface PostReportSurvival {
  aliveDaysMedian: number | null
  alive: number
  banned: number
  missing: number
  deleted: number
  paused: number
  d3: PostReportDecided
  d7: PostReportDecided
}

export interface PostReportUtmTotals {
  registers: number
  depositors: number
  depositAmount: number
  withdrawAmount: number
}

export interface PostReportSharedUtm {
  keys: number
  withOthers: number
}

/** contract §1.2 "money" — `SpendFxRow` (`spendByCurrency`/`spendUnconverted`/`converted`) + the rate metrics */
export interface PostReportMoney extends SpendFxRow {
  spend: number
  impressions: number
  clicks: number
  conversions: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  conversionCost: number | null
  utm: PostReportUtmTotals | null
  sharedUtm: PostReportSharedUtm | null
  depPerBudget: number | null
  costPerDep: number | null
  costPerReg: number | null
  spendPerBuild: number | null
  depositPerBuild: number | null
}

export type PostReportEnoughWhy = 'ok' | 'builds' | 'spend' | 'both'

/** contract §1.2 */
export interface PostReportRow {
  key: string
  subject: PostReportSubject
  builds: PostReportBuildCounts
  review: PostReportReview
  survival: PostReportSurvival
  money: PostReportMoney
  enough: boolean
  enoughWhy: PostReportEnoughWhy
}

export type PostReportReviewOutcome = 'approved' | 'rejected' | 'pending' | 'unknown'
export type PostReportEndOutcome = 'alive' | 'banned' | 'missing' | 'deleted' | 'paused' | null

export interface PostReportOutcome {
  review: PostReportReviewOutcome
  end: PostReportEndOutcome
  endAt: string | null
  endDay: number | null
}

/** contract §1.3 (detail only) */
export interface PostReportBuild {
  id: string
  orderId: string
  orderName: string | null
  account: { id: string, label: string | null }
  advertiser: { id: string, name: string | null, currency: string | null }
  tiktokCampaignId: string | null
  publishedAt: string
  approvedAt: string | null
  reviewHours: number | null
  outcome: PostReportOutcome
  aliveDays: number | null
  spend: number
  spendUnconverted?: MoneyUnconverted
  currency: string | null
  deposit: number
  depPerBudget: number | null
  reason: string | null
  adTemplateName: string | null
  adGroupTemplateName: string | null
  ads: number
}

export interface PostReportGate {
  minBuilds: number
  minSpend: number
}

export interface PostReportScope {
  workspaceId: string | null
  workspaces: PerfScopeWorkspace[]
}

/** contract §2 "summary" */
export interface PostReportSummary extends SpendFxRow {
  builds: number
  posts: number
  accounts: number
  advertisers: number
  approved: number
  rejected: number
  pending: number
  unknown: number
  approvedRate: number | null
  hoursMedian: number | null
  hoursP90: number | null
  within24h: number | null
  alive: number
  banned: number
  missing: number
  deleted: number
  paused: number
  d7: PostReportDecided
  spend: number
  utm: PostReportUtmTotals
  depPerBudget: number | null
  costPerDep: number | null
  /** v1.1 — same ad-level counts/rate as `PostReportBuildCounts`/`PostReportReview`, cohort-wide */
  ads: number
  adsApproved: number
  adsRejected: number
  adApprovedRate: number | null
}

/** `GET /reports/posts` 200 (contract §2) */
export interface PostsListResponse {
  range: ReportRangeInfo
  scope: PostReportScope
  by: PostReportLens
  prefixes: string[]
  gate: PostReportGate
  summary: PostReportSummary
  rows: PostReportRow[]
  rowsTruncated: boolean
  truncated: boolean
  refreshedAt: string | null
}

export interface PostReportFunnel {
  published: number
  approved: number
  spent: number
  deposited: number
  survivedD7: number
  alive: number
}

export interface PostReportDayAfterApproval {
  day: number
  buildsAlive: number
  spendAvg: number | null
  depositAvg: number | null
}

export interface PostReportReason {
  label: string
  count: number
  templates: string[]
}

export interface PostReportSetup {
  key: string
  name: string | null
  builds: number
  d7Rate: number | null
  depPerBudget: number | null
  costPerDep: number | null
  spend: number
  enough: boolean
}

/** `GET /reports/posts/:key` 200 (contract §3) */
export interface PostsDetailResponse {
  range: ReportRangeInfo
  by: PostReportLens
  gate: PostReportGate
  head: PostReportRow
  prefixes: string[]
  monitorCampaignId: string | null
  funnel: PostReportFunnel
  byDayAfterApproval: PostReportDayAfterApproval[]
  rejectReasons: PostReportReason[]
  setups: PostReportSetup[]
  builds: PostReportBuild[]
  buildsTruncated: boolean
  refreshedAt: string | null
}
