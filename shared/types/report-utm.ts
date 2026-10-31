/**
 * FEAT-040 — Reports → UTM (`/reports/utm`, api-contract.md v1 §2.2 / §3, spec U5).
 *
 * The page never computes a metric: `winLose`, `costPerDeposit`, `spend`, `spendCurrency`, `adCount` and the
 * whole `totals` block come from `GET /reports/utm` exactly as the API sends them (the footer is the API's
 * `totals`, never a sum of the visible rows). Money and counts are plain numbers; `null` means "nothing to
 * show" and is printed as `—` by `app/utils/reports.ts` (`formatDecimal`/`formatInt`).
 *
 * Days are `YYYY-MM-DD` strings on Thai time (`timezone` of the envelope is the constant `Asia/Bangkok`);
 * `fetchedAt` / `sourceUpdatedAt` / `refreshedAt` are ISO instants.
 */
import type { FxReportBlock, SpendFx, SpendFxRow } from './fx'
import type { UtmOwnerRef } from './utm-keys'

/** One row of `GET /reports/utm` — exactly these 19 keys (contract §2.2; `detail` is never served). */
/** FEAT-084 — `spend` / `costPerDeposit` are THB; + 3 keys (22) */
/** FEAT-090 — + `owner` **last** (23): the admin who owns the row's UTM key (api-contract v1 §5.1) */
export interface UtmReportRow extends SpendFxRow {
  /** `YYYY-MM-DD`, Thai day */
  day: string
  prefix: string
  source: string
  medium: string
  campaign: string
  sourceId: string
  mediumId: string
  campaignId: string
  registers: number
  depositors: number
  depositAmount: number
  withdrawAmount: number
  /** `depositAmount − withdrawAmount`, 2 dp — negative is shown in red */
  winLose: number
  /** `null` = the key has no ad from the system at all (printed `—`) */
  spend: number | null
  /** sorted, space-joined currencies of the contributing ad accounts (`'THB USD'`, `'?'`); `null` with `spend: null` */
  spendCurrency: string | null
  /** `spend / depositors`, `null` when `spend` is null or `depositors === 0` */
  costPerDeposit: number | null
  /** ads holding this UTM key, independent of the day */
  adCount: number
  /** ISO | null — `last_update_on` of the 3rd party */
  sourceUpdatedAt: string | null
  /** ISO — when the job wrote the fact */
  fetchedAt: string
  /**
   * FEAT-090 — the owner of this UTM key (`utmKeys.ownerAdminId` → `admins.displayName`), `null` only for a key
   * that has no `utmKeys` row (GOD-only sight). An Admin only ever receives rows of keys they own.
   */
  owner: UtmOwnerRef | null
}

/** `totals` of the envelope — exactly these 8 keys, over every matching row **before** `limit` (contract §2.2). */
/** FEAT-084 — + `spendByCurrency` / `spendUnconverted` (10) */
export interface UtmReportTotals extends SpendFx {
  /** = `total` of the envelope */
  rows: number
  registers: number
  depositors: number
  depositAmount: number
  withdrawAmount: number
  winLose: number
  /** sum of the non-null row spends; `null` when every row is null */
  spend: number | null
  /** `totals.spend / totals.depositors`, same null rules as the row */
  costPerDeposit: number | null
}

/** `GET /reports/utm` 200 body — exactly these 9 keys (contract §2.2). */
export interface UtmReportResponse {
  rows: UtmReportRow[]
  /** rows matching the filters before `limit` */
  total: number
  limit: number
  /** FEAT-065 (api-contract.md §5.3) — `null` only for `range=all`; the CSV name is then `utm-all.csv`. */
  from: string | null
  to: string | null
  /** the constant `'Asia/Bangkok'` */
  timezone: string
  totals: UtmReportTotals
  /** max `fetchedAt` of the returned rows (ISO) or `null` */
  refreshedAt: string | null
  /** `UTM_POLL_INTERVAL_MS` of the API */
  intervalMs: number
  /** FEAT-084 §2.3 */
  fx?: FxReportBlock
}

/** `POST /utm/fetch` **202** body (contract §3). Today the API answers 501 `{ error }` until Feature B lands. */
export interface UtmFetchResponse {
  jobId: string
}
