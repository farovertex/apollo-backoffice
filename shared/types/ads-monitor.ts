/**
 * FEAT-056 — Ads monitor (`/ads-monitor`). Mirrors
 * `mission-control/.ai/features/FEAT-056-…/api-contract.md` **v1.3** §2 (status keys), §3 (the three list
 * envelopes `GET /ads-monitor/campaigns | ad-groups | ads`), §4 (`POST /ads-monitor/toggle`) and §8 (campaign
 * `cover` + the "all ad images" modal endpoint, T11).
 *
 * The three tabs share one envelope and one row type: every key that only one level carries is optional
 * (`campaign` on the ad-group row, `media`/`source`/`adGroup` on the ad row, `budget`/`bid`/`schedule`,
 * `adGroupCount`/`adCount`), so a single table component can render all three (spec "UI behaviour").
 *
 * TikTok's switch value is inverted on purpose: `opt === 0` is **on**, `opt === 1` is **off**, `null` =
 * not read yet (the switch is disabled until the next kpi round, spec A3). The toggle body talks `'on'|'off'`.
 */
import type { BannedAd } from './report-banned'
import type { KpiMetrics } from './reports'

/** API level enum (contract §1 — `ad` is TikTok's `creative`). */
export type MonitorLevel = 'campaign' | 'adGroup' | 'ad'

/**
 * Classification of one level (contract §2); the Thai labels live in `app/utils/reports.ts`.
 * TASK-campaign-delete-ui — `deleted` is the API's **top-priority** key (above `rejected`): every row whose
 * `deletedAt` is set reads `deleted`, because deleting a campaign deletes its groups and ads too.
 */
export type MonitorStatusKey = 'deleted' | 'delivering' | 'notDelivering' | 'paused' | 'rejected' | 'other'

/** `status` query value — the six keys plus `all` (default). */
export type MonitorStatusFilter = 'all' | MonitorStatusKey

/** `linked` query value — `true` (default: only ads our system launched), `false`, `all`. */
export type MonitorLinkedFilter = 'true' | 'false' | 'all'

/** Ranges the monitor endpoints accept (contract §3.0 — no `custom` here, spec A12). */
export type MonitorRange = 'today' | '7d' | 'all'

/** Toggle direction as the API spells it; `on` ⇒ stored `opt` 0, `off` ⇒ 1. */
export type ToggleTarget = 'on' | 'off'

/** `opt` of one level: 0 = on · 1 = off · null = unknown. */
export type OptValue = 0 | 1 | null

export interface MonitorStatus {
  key: MonitorStatusKey
  /** raw `<prefix>_primary_status` — shown in the tooltip only */
  primary: string
  /** raw `<prefix>_status` */
  detail: string
  /** raw `<prefix>_status_list`, translated by the BO's one reason map */
  reasons: string[]
}

/** View of `ads.optPending` (contract §3.1 — `target` exposed as `on`/`off`). */
export interface OptPendingView {
  level: MonitorLevel
  target: ToggleTarget
  jobId: string
  requestedAt: string
}

/** View of `ads.optError`. `reason` is a Thai sentence that is safe to show. */
export interface OptErrorView {
  level: MonitorLevel
  target: ToggleTarget
  jobId: string | null
  at: string
  reason: string
}

/** Why the switch may not be pressed — computed by the API so the BO never re-derives the rule. */
export interface MonitorSwitchable {
  ok: boolean
  reason: string | null
}

/**
 * TASK-campaign-delete-ui — view of `ads.deletePending` (mirrors `optPending`, without a target: a delete has
 * only one direction). Set by the API and, between the accepted 202 and the next load, by the page's own
 * optimistic override.
 */
export interface DeletePendingView {
  jobId: string
  requestedAt: string
}

/** View of `ads.deleteError` (mirrors `optError`). `reason` is a Thai sentence that is safe to show. */
export interface DeleteErrorView {
  jobId: string | null
  at: string
  reason: string
}

/**
 * Why the campaign may not be deleted — same spirit as `switchable`: the first failing rule, computed by the
 * API. `ok: false` with `reason: 'ลบแล้ว'` once the campaign is deleted.
 */
export interface MonitorDeletable {
  ok: boolean
  reason: string | null
}

export interface MonitorAdvertiserRef {
  id: string
  name: string | null
  tiktokAdvertiserId: string
  suspendedReason: string | null
}

export interface MonitorAccountRef {
  id: string
  label: string | null
  /** v1.2 — full, unmasked, the fallback text when `label` is null */
  loginEmail: string | null
  sessionStatus: string
}

export interface MonitorWorkspaceRef {
  id: string
  name: string | null
}

/** `campaign` / `adGroup` back-reference of a child row. */
export interface MonitorNamedRef {
  id: string
  name: string | null
}

export interface MonitorBudget {
  amount: number | null
  mode: string | null
}

export interface MonitorBid {
  strategy: string | null
  pricing: string | null
  optimizeGoal: string | null
}

export interface MonitorSchedule {
  text: string | null
  startAt: string | null
  endAt: string | null
}

export interface MonitorMedia {
  coverUrl: string | null
  isVideo: boolean
}

/** Campaign row's first-creative cover (contract v1.3 §8.1) — never null, a campaign row always has ≥ 1 ad. */
export interface MonitorCover {
  adId: string
  coverUrl: string | null
  isVideo: boolean
}

/** One row of any tab (contract §3.1 / §3.2 / §3.3). */
export interface MonitorRow {
  level: MonitorLevel
  /** the TikTok id of this level — the `tiktokId` of a toggle */
  id: string
  name: string | null
  /** ad tab only — our `ads._id` */
  adId?: string
  advertiser: MonitorAdvertiserRef
  account: MonitorAccountRef
  workspace: MonitorWorkspaceRef
  orderIds: string[]
  /** ad tab only — `orderId` of that single creative */
  orderId?: string | null
  adGroupCount?: number
  adCount?: number
  opt: OptValue
  optPending: OptPendingView | null
  optError: OptErrorView | null
  switchable: MonitorSwitchable
  status: MonitorStatus
  /**
   * TASK-campaign-delete-ui — when our `campaignDelete` job removed this campaign on TikTok (the `ads` rows
   * are kept). On every row of the three tabs; group/ad rows inherit the campaign's value.
   */
  deletedAt: string | null
  /** campaign tab only — a `campaignDelete` job is queued/running for this campaign */
  deletePending?: DeletePendingView | null
  /** campaign tab only — the last `campaignDelete` job failed */
  deleteError?: DeleteErrorView | null
  /** campaign tab only — whether the trash button may be pressed, and why not */
  deletable?: MonitorDeletable
  budget?: MonitorBudget
  bid?: MonitorBid
  schedule?: MonitorSchedule
  campaign?: MonitorNamedRef
  adGroup?: MonitorNamedRef
  media?: MonitorMedia
  /** campaign tab only (contract v1.3 §8.1) — first creative's cover, drives the รูปโฆษณา column */
  cover?: MonitorCover
  source?: string | null
  createdAt: string | null
  metrics: KpiMetrics
}

/** Shared 200 envelope of the three list endpoints. */
export interface AdsMonitorResponse {
  rows: MonitorRow[]
  page: number
  limit: number
  /** groups after `status`/`q` filtering — drives the pagination and `am-count` */
  total: number
  /** groups in scope **before** `status`/`q`/`linked` — tells `am-empty` from `am-nomatch` */
  unfilteredTotal: number
  /** sum over every page of the filtered set; the Total row never sums the visible rows */
  totals: KpiMetrics
  range: { key: MonitorRange, from: string | null, to: string | null }
  intervalMs: number
  refreshedAt: string | null
}

/** `POST /ads-monitor/toggle` body (strict on the API side). */
export interface ToggleBody {
  advertiserId: string
  level: MonitorLevel
  tiktokId: string
  target: ToggleTarget
}

/** `POST /ads-monitor/toggle` 202 body. */
export interface ToggleAccepted {
  jobId: string
  level: MonitorLevel
  tiktokId: string
  target: ToggleTarget
  adCount: number
  optPending: OptPendingView
}

/** `POST /ads-monitor/delete-campaign` body (strict on the API side). */
export interface DeleteCampaignBody {
  advertiserId: string
  tiktokCampaignId: string
}

/** `POST /ads-monitor/delete-campaign` 202 body. */
export interface DeleteAccepted {
  jobId: string
  tiktokCampaignId: string
  campaignName: string | null
  adCount: number
  deletePending: DeletePendingView
}

/** Why a delete was refused, in the API's own order. */
export type DeleteConflictReason = 'deletePending' | 'optPending' | 'banned' | 'notLoggedIn' | 'buildInProgress'

/** `POST /ads-monitor/delete-campaign` 409 body — `error` is the Thai sentence shown in the toast. */
export interface DeleteConflict {
  error: string
  reason: DeleteConflictReason
}

/** Why a toggle was refused (contract §4 step 3). */
export type ToggleConflictReason = 'pending' | 'banned' | 'notLoggedIn' | 'buildInProgress'

/** `POST /ads-monitor/toggle` 409 body — `error` is the Thai sentence shown in the toast. */
export interface ToggleConflict {
  error: string
  reason: ToggleConflictReason
}

/**
 * `GET /ads-monitor/campaigns/:advertiserId/:tiktokCampaignId/ads` (contract v1.3 §8.2) — every creative of
 * one campaign, behind the campaign tab's eye button. Ad shape is identical to `GET /reports/banned/:id/ads`
 * on purpose (contract note) so `BannedAd` / `ReportsCoversGrid` are reused rather than duplicated.
 */
export interface MonitorCampaignAdsResponse {
  campaign: { id: string, name: string | null }
  advertiser: { id: string, name: string | null, tiktokAdvertiserId: string }
  total: number
  ads: BannedAd[]
}
