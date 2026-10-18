/**
 * FEAT-043 — Report Banned accounts (api-contract.md v1 §3 "BO surfaces"). `GET /reports/banned` is a third,
 * read-only view of the same ad metrics as FEAT-020/FEAT-035: one row per advertiser TikTok has currently
 * banned (`advertisers.suspendedReason === 'banned'`) that still owns at least one `ads` row.
 *
 * `ReportRangeInfo.from`/`to` are typed `string` in `./reports.ts` while `range=all` delivers `null` for both —
 * widened here (`BannedRangeInfo`) to `string | null` rather than editing the shared file (contract §3 note).
 *
 * FEAT-056 adds the `custom` range key and `GET /reports/banned/:advertiserId/campaigns` (contract §6).
 */
import type { KpiMetrics, ReportRange } from './reports'

/**
 * FEAT-056 — `/reports/banned` (and only it, spec A12) also accepts `range=custom` with `from`/`to`
 * (`YYYY-MM-DD`, `from ≤ to`, ≤ 366 days). The monitor endpoints keep `today | 7d | all`.
 */
export type BannedRange = ReportRange | 'custom'

/** `range` echo of `/reports/banned` and `/reports/banned/:id/campaigns` (`all` sends `from`/`to` null). */
export interface BannedRangeInfo {
  key: BannedRange
  from: string | null
  to: string | null
}

export interface BannedRow {
  account: { id: string, label: string | null, loginEmail: string | null }
  workspace: { id: string, name: string | null }
  advertiser: { id: string, name: string, tiktokAdvertiserId: string }
  bannedAt: string | null
  /** FEAT-047 — newest `publishedAt` (else newest `createdAt`) over the advertiser's `builds`; `null` with no build at all. */
  launchedAt: string | null
  adCount: number
  metrics: KpiMetrics
}

export interface BannedReportResponse {
  range: BannedRangeInfo
  intervalMs: number
  refreshedAt: string | null
  page: number
  limit: number
  total: number
  adCount: number
  advertiserCount: number
  accountCount: number
  totals: KpiMetrics
  rows: BannedRow[]
}

// ── FEAT-056 · `GET /reports/banned/:advertiserId/campaigns` (api-contract.md v1 §6.2) ────────────────────────────────

/** One campaign of a banned advertiser; `id: ''` + name "(ไม่มีแคมเปญ)" is the bucket of ads with no campaign id. */
export interface BannedCampaignRow {
  id: string
  name: string
  orderIds: string[]
  adCount: number
  adGroupCount: number
  createdAt: string | null
  metrics: KpiMetrics
}

/** 200 body; `totals` equals the advertiser's row of `GET /reports/banned` for the same range (AC-17). */
export interface BannedCampaignsResponse {
  advertiser: {
    id: string
    name: string
    tiktokAdvertiserId: string
    suspendedReason: string | null
    bannedAt: string | null
  }
  range: BannedRangeInfo
  intervalMs: number
  refreshedAt: string | null
  rows: BannedCampaignRow[]
  campaignCount: number
  adCount: number
  totals: KpiMetrics
}

/** Per-row state of the expandable campaign table (one entry per expanded advertiser, reset on a range change). */
export interface BannedCampaignsState {
  pending: boolean
  error: string | null
  data: BannedCampaignsResponse | null
}
