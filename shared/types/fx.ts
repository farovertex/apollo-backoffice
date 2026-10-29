/**
 * FEAT-080 (api-contract v1 §3) — exchange rates (`/settings/fx`) and the shared `thb` blocks the other views grew.
 * A pair is written `USD-THB` in paths (`<foreign>-<base>`) and `USD/THB` in texts; the views say `currency` for the
 * foreign code so the BO never has to think about which side is `base`.
 */

export type FxSource = 'fastforex' | 'manual' | 'carried' | 'backfill'
export type FxClientKind = 'fake' | 'http'

/** §3.4 — read-time conversion of a self-standing amount at the **latest** rate; `null` where it cannot be computed */
export interface ThbBlock {
  amount: number
  rate: number
  day: string
  /** the rate is not today's own fastforex/manual one (older day, carried or backfill) */
  estimated: boolean
}

/** §1.4 / §3.4 — the block stamped on a top-up when it became `paid` (not recomputed) */
export interface TopupFxView {
  rate: number
  day: string
  source: FxSource | 'base'
  thbAmount: number
}

export interface FxSetByView {
  id: string
  displayName: string
}

/** `currencies[].today` — the row of `serverDay` */
export interface FxRateRowView {
  day: string
  rate: number
  source: FxSource
  carriedFrom: string | null
  sourceUpdatedAt: string | null
  fetchedAt: string
  fetchAttempts: number
  lastAttemptAt: string | null
  lastError: string | null
  setBy: FxSetByView | null
}

/** `currencies[].history[]` */
export interface FxHistoryRowView {
  day: string
  rate: number
  source: FxSource
  carriedFrom: string | null
  fetchedAt: string
  setBy: FxSetByView | null
}

/** `currencies[].latest` — newest row with `day ≤ serverDay` */
export interface FxLatestView {
  day: string
  rate: number
  source: FxSource
  estimated: boolean
}

export interface FxCurrencyView {
  currency: string
  pair: string
  today: FxRateRowView | null
  latest: FxLatestView | null
  history: FxHistoryRowView[]
}

/** `GET /settings/fx` (§3.1) */
export interface FxSettingsView {
  base: string
  client: FxClientKind
  enabled: boolean
  currencies: FxCurrencyView[]
  lastError: string | null
  serverDay: string
}

/** `POST /settings/fx/refresh` 200 (§3.2) */
export interface FxRefreshResult {
  day: string
  results: Array<{
    currency: string
    ok: true
    rate: number
    source: FxSource
    sourceUpdatedAt: string | null
    restamped: number
  }>
  failed: Array<{ currency: string, ok: false, error: string }>
}

/** `PUT /settings/fx/:pair/:day` body (§3.3) */
export interface FxManualBody {
  rate: number
}

/** `PUT /settings/fx/:pair/:day` 200 (§3.3) */
export interface FxManualResult {
  currency: string
  pair: string
  day: string
  rate: number
  source: 'manual'
  setBy: FxSetByView
  before: { rate: number, source: FxSource } | null
  restamped: number
}

/*
 * FEAT-084 (api-contract v1 §1.2–§1.4, §5) — reports in THB. Every key the API added in this feature is typed
 * **optional** on the widened views below so a response from an older API (or a test stub without them) still
 * renders the raw figures without a console error (spec AC-18).
 */

/** §1.2 — raw spend per ISO currency (`{ THB: 1000, USD: 25.1 }`), only currencies seen; `{}` when none */
export type MoneyByCurrency = Record<string, number>

/** §1.2 — raw spend that could not be converted, keyed by ISO or `"?"` (unknown currency); `null` when none */
export type MoneyUnconverted = Record<string, number> | null

/** §1.3 — one foreign currency of the response's range */
export interface FxRangeRate {
  pair: string
  currency: string
  from: string | null
  to: string | null
  min: number | null
  max: number | null
  days: number
  estimatedDays: number
  missingDays: number
}

/** §1.3 — response-level `fx` of the three report routes and of `/ads-monitor/*` */
export interface FxReportBlock {
  base: string
  rates: FxRangeRate[]
  convertedRows: number
  unconvertedRows: number
}

/** §1.4 / §5 — one currency that could not be converted (`currency: null` = unknown) */
export interface MoneyUnconvertedItem {
  currency: string | null
  amount: number
}

/** §1.4 — Σ of a set of account balances in THB (THB as is, foreign × latest rate) */
export interface BalanceThb {
  amount: number
  estimated: boolean
  unconverted: MoneyUnconvertedItem[]
}

/** §5 — `GET /topups` `summary` over every row matching the list filters (all pages) */
export interface TopupSummary {
  totalThb: number
  byCurrency: MoneyByCurrency
  unconverted: MoneyUnconvertedItem[]
  estimated: boolean
}

/** §1.1 — the three keys every aggregated `spend` carries next to it */
export interface SpendFx {
  spendByCurrency?: MoneyByCurrency
  spendUnconverted?: MoneyUnconverted
}

/** §1.1 — `SpendFx` + `converted` on rows that aggregate snapshots */
export interface SpendFxRow extends SpendFx {
  converted?: boolean
}

/** §3 / §4 — single-account rows: raw `metrics.spend` + `currency` + `spendThb` */
export interface SpendThbRow {
  currency?: string | null
  spendThb?: number | null
  spendUnconverted?: MoneyUnconverted
}
