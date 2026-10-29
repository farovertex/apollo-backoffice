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
