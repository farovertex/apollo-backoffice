/**
 * FEAT-043 — Report Banned accounts (api-contract.md v1 §3 "BO surfaces"). `GET /reports/banned` is a third,
 * read-only view of the same ad metrics as FEAT-020/FEAT-035: one row per advertiser TikTok has currently
 * banned (`advertisers.suspendedReason === 'banned'`) that still owns at least one `ads` row.
 *
 * `ReportRangeInfo.from`/`to` are typed `string` in `./reports.ts` while `range=all` delivers `null` for both —
 * widened here to `string | null` rather than editing the shared file (contract §3 note).
 */
import type { KpiMetrics, ReportRangeInfo } from './reports'

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
  range: Omit<ReportRangeInfo, 'from' | 'to'> & { from: string | null, to: string | null }
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
