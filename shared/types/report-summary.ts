/**
 * FEAT-035 — Report summary (`/reports/summary`, api-contract.md §3, contract v1.2 "table 2 removed"). The
 * page's one table groups the per-ad sums of `GET /reports/grouped` by advertiser and TikTok account;
 * `KpiMetrics` / `ReportRangeInfo` are reused from `./reports` unchanged (G-4 — `shared/types/reports.ts` is
 * owned by FEAT-034 in this round, not edited here). Types that only the removed ads table used (it reused
 * `AdReportRow`/`AdsReportResponse` directly from `./reports`, nothing table-2-specific lived in this file)
 * never existed here, so there is nothing to drop from this module besides this note.
 */
import type { KpiMetrics, ReportRangeInfo } from './reports'

/** One advertiser row of table 1, nested under its account (contract §3 `rs-adv-row`). */
export interface GroupedAdvertiser {
  advertiser: { id: string, name: string, tiktokAdvertiserId: string }
  adCount: number
  metrics: KpiMetrics
}

/** One account row of table 1 with its advertisers nested inside (contract §3 `rs-acc-row`). */
export interface GroupedAccount {
  account: { id: string, label: string | null }
  workspace: { id: string, name: string | null }
  adCount: number
  advertiserCount: number
  metrics: KpiMetrics
  advertisers: GroupedAdvertiser[]
}

/** `GET /reports/grouped` 200 body (api-contract.md §1). */
export interface GroupedReportResponse {
  range: ReportRangeInfo
  intervalMs: number
  refreshedAt: string | null
  adCount: number
  advertiserCount: number
  accountCount: number
  totals: KpiMetrics
  accounts: GroupedAccount[]
}

/** Sortable fields of table 1 (`rs-gsort-<field>`); client-side only, a leading `-` = descending. */
export type GroupSortField
  = 'adCount' | 'spend' | 'impressions' | 'clicks' | 'ctr' | 'cpc' | 'conversions' | 'conversionCost'
