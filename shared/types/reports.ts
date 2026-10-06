/**
 * FEAT-020 — Ads report (kpiFetch job + Reports page). Mirrors
 * mission-control/.ai/features/FEAT-020-ads-report-kpifetch-job-and-reports-page/api-contract.md **v1**
 * (§2 data model, §5 `GET /reports/ads`, `GET /reports/summary`, `GET /reports/ads/:id`,
 * `GET /reports/ads/:id/series`, `GET /campaign-orders/:id/report`, `PATCH /advertisers/:id/report`,
 * `POST /advertisers/:id/report/fetch-now`).
 *
 * TikTok naming trap kept from the contract: `campaign_id` = campaign, `ad_id` = **ad group**,
 * `creative_id` = **ad**. Every metric that can have a zero denominator is `number | null` and is rendered
 * as `—`; the BO never recomputes a rate the API already summed (spec A7).
 *
 * FEAT-029 (api-contract.md v1 §4): `AdReportRow.advertiser` also carries the advertiser's balance as the kpi
 * job last read it (`balanceAmount`, `balanceCurrency`, `balanceAt`, `balanceError`) — rendered under the
 * advertiser name of every row (`rp-row-balance`).
 */
import type { OrderStatus, PublishMode } from './campaign-orders'

/** The one metric block of the whole feature (contract §2.3). Rates are null when their denominator is 0. */
export interface KpiMetrics {
  spend: number
  impressions: number
  clicks: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  conversions: number
  conversionCost: number | null
  conversionRate: number | null
  effectCount: number | null
  effectCost: number | null
  effectRate: number | null
  skanConversions: number | null
}

/** Derived delivery state of an ad (contract §2.2 table); unknown raw strings land on `unknown`. */
export type AdState = 'delivering' | 'pending' | 'rejected' | 'ended' | 'unknown'

/** Shared `range` query of every report endpoint. */
export type ReportRange = 'today' | '7d' | 'all'

/** `advertisers.report.lastError` / `AdReportRow.fetchError`. */
export type ReportError = 'notLoggedIn' | 'listApiFailed' | 'partial' | 'timeout' | 'profileLocked' | 'unknown'

/** `AdvertiserReport.state` — the four states the UI shows (contract §5 "AdvertiserReport"). */
export type AdvertiserReportState = 'never' | 'on' | 'off' | 'error'

/** Raw TikTok status strings of the three levels (always shown on hover, never translated). */
export interface AdStatusBlock {
  campaign: string
  adGroup: string
  creative: string
  creativeDetail: string
  auditStatus: number | null
  reasons: string[]
}

/** Range echoed by every endpoint: the key plus the resolved `YYYY-MM-DD` boundaries. */
export interface ReportRangeInfo {
  key: ReportRange
  from: string
  to: string
}

/** View of `advertisers.report` (contract §5). Also carried by the advertiser list view (AC-21). */
export interface AdvertiserReport {
  state: AdvertiserReportState
  enabled: boolean | null
  trackedSince: string | null
  nextFetchAt: string | null
  fetching: boolean
  lastFetchAt: string | null
  lastError: ReportError | null
  adCount: number
  today: { periodDate: string, metrics: KpiMetrics } | null
}

/**
 * FEAT-029 §4 — the advertiser block of one ad row: the three FEAT-020 keys plus the balance the kpi job read
 * last. The balance keys are optional for readers of an API that predates the feature (then the row shows `—`).
 */
export interface AdRowAdvertiser {
  id: string
  name: string
  tiktokAdvertiserId: string
  /** ยอดคงเหลือ as the kpi job last read it (string, exactly as TikTok sends it) */
  balanceAmount?: string | null
  balanceCurrency?: string | null
  /** ISO | null — when the balance above was read */
  balanceAt?: string | null
  /** Thai text of the last failed read (`อ่านยอดคงเหลือไม่ได้`); null after a success */
  balanceError?: string | null
}

/** One row of `GET /reports/ads` — also the row of the order Report tab and the header of the slideover. */
export interface AdReportRow {
  id: string
  workspace: { id: string, name: string | null }
  account: { id: string, label: string | null }
  advertiser: AdRowAdvertiser
  tiktokCampaignId: string | null
  tiktokAdGroupId: string | null
  tiktokCreativeId: string | null
  campaignName: string | null
  adGroupName: string | null
  creativeName: string | null
  linked: boolean
  order: { id: string, name: string } | null
  buildId: string | null
  state: AdState
  status: AdStatusBlock
  media: { isVideo: boolean, coverUrl: string | null, videoId: string | null }
  /** sum of the ad's snapshot rows in the range; `null` when it has none (→ "รอรอบดึงข้อมูลแรก") */
  metrics: KpiMetrics | null
  /** today's per-hour spend deltas, one value per stored hour, `[]` when none — always today, whatever the range */
  sparkline: number[]
  lastFetchAt: string | null
  fetchError: ReportError | null
  fetching: boolean
  missingSince: string | null
  tiktokCreatedAt: string | null
}

/** Sortable fields of `GET /reports/ads` (a leading `-` = descending). */
export type ReportSortField
  = 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'conversions' | 'conversionCost' | 'creativeName' | 'lastSeenAt'

/** `GET /reports/ads` 200 body. */
export interface AdsReportResponse {
  ads: AdReportRow[]
  page: number
  limit: number
  total: number
  /** sum over **all** ads of the filter (not only the page), rates recomputed */
  totals: KpiMetrics
  range: ReportRangeInfo
  intervalMs: number
  /** newest `capturedAt` among the snapshots in scope; null when none */
  refreshedAt: string | null
}

/** Advertiser tracking counters of `GET /reports/summary`. */
export interface ReportTrackingCounts {
  tracking: number
  off: number
  error: number
  fetching: number
}

/** Ad counters per derived state of `GET /reports/summary`. */
export interface ReportAdCounts {
  total: number
  delivering: number
  pending: number
  rejected: number
  ended: number
  unknown: number
}

/** `GET /reports/summary` 200 body. `previous` is null for `range=all`. */
export interface ReportSummaryResponse {
  range: ReportRangeInfo
  totals: KpiMetrics
  previous: { from: string, to: string, totals: KpiMetrics } | null
  tracking: ReportTrackingCounts
  ads: ReportAdCounts
  intervalMs: number
  /** `KPI_ENABLED` — false means the scheduler never scans (manual fetch-now still works) */
  enabled: boolean
  refreshedAt: string | null
}

/** Read-only setup block of one ad (contract §5 `GET /reports/ads/:id`); every field may be null. */
export interface AdSetup {
  budget: number | null
  budgetMode: string | null
  pricing: string | null
  bidStrategy: string | null
  optimizeGoal: string | null
  optimizationLocation: string | null
  pixelName: string | null
  placement: string | null
  location: string | null
  age: string | null
  gender: string | null
  languages: string | null
  schedule: string | null
  startDeliveryAt: string | null
  endDeliveryAt: string | null
  pageName: string | null
  pageId: string | null
  callToAction: string | null
  identityName: string | null
  postName: string | null
  effectNote: string | null
}

/** One daily snapshot row of an ad (`days[]` of the detail, newest first, max 90). */
export interface AdDayRow {
  periodDate: string
  /** `true` = the day is closed and is never written again */
  final: boolean
  capturedAt: string
  fetchCount: number
  state: AdState | null
  status: Pick<AdStatusBlock, 'campaign' | 'adGroup' | 'creative' | 'creativeDetail'> | null
  metrics: KpiMetrics
}

/** `GET /reports/ads/:id` 200 body. */
export interface AdDetailResponse {
  ad: AdReportRow
  setup: AdSetup
  tracking: AdvertiserReport
  days: AdDayRow[]
}

/** One point of `bucket=1d` (`at` is a `YYYY-MM-DD` day). */
export interface AdSeriesDailyPoint {
  at: string
  final: boolean
  metrics: KpiMetrics
}

/** One point of `bucket=1h` (`h` = local hour, `at` = ISO instant of the capture). */
export interface AdSeriesHourlyPoint {
  h: number
  at: string
  spend: number
  impressions: number
  clicks: number
  conversions: number
}

/** `GET /reports/ads/:id/series?bucket=1d`. */
export interface AdSeriesDailyResponse {
  bucket: '1d'
  points: AdSeriesDailyPoint[]
}

/** `GET /reports/ads/:id/series?bucket=1h`. */
export interface AdSeriesHourlyResponse {
  bucket: '1h'
  date: string
  final: boolean
  mode: 'delta' | 'cumulative'
  points: AdSeriesHourlyPoint[]
}

export type AdSeriesResponse = AdSeriesDailyResponse | AdSeriesHourlyResponse

/** The four metrics the slideover chart can draw (one series, one axis). */
export type ChartMetric = 'spend' | 'impressions' | 'clicks' | 'conversions'

/** One build card of `GET /campaign-orders/:id/report`. */
export interface OrderReportBuild {
  build: {
    id: string
    status: string
    tiktokCampaignId: string | null
    publishedAt: string | null
  }
  account: { id: string, label: string | null }
  advertiser: { id: string, name: string, tiktokAdvertiserId: string }
  tracking: AdvertiserReport
  totals: KpiMetrics
  /** ads of this build, `-spend`, no pagination, max 200; `[]` when none or not published */
  ads: AdReportRow[]
}

/** `GET /campaign-orders/:id/report` 200 body. */
export interface OrderReportResponse {
  order: { id: string, name: string, status: OrderStatus, publishMode: PublishMode }
  range: ReportRangeInfo
  intervalMs: number
  refreshedAt: string | null
  totals: KpiMetrics
  adCount: number
  builds: OrderReportBuild[]
}

/** `PATCH /advertisers/:id/report` body (strict on the API side). */
export interface AdvertiserReportToggleBody {
  enabled: boolean
}

/** `POST /advertisers/:id/report/fetch-now` 202 body. */
export interface FetchNowResponse {
  jobId: string
  report: AdvertiserReport
}

/** Why a fetch-now was refused. */
export type FetchNowConflictReason
  = 'fetching' | 'jobRunning' | 'buildInProgress' | 'needsHuman' | 'notLoggedIn' | 'inactive'

/** `POST /advertisers/:id/report/fetch-now` 409 body (`error` is the Thai sentence shown in the toast). */
export interface FetchNowConflictBody {
  error: string
  reason: FetchNowConflictReason
}
