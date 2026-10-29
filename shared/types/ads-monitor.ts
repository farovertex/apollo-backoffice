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
 *
 * FEAT-067 §1/§4 — `row.utm`: the first UTM set (names only, from `builds.utm`) of the row's ads in
 * `compareFirstAd` order, plus the group's other distinct sets (`others`); `null` when no ad has a usable
 * one. Rendered by `AdsMonitorUtmCell` as a collapsible column right after `name` (campaign tab: after
 * `cover`), linking to `/reports/utm` pre-filtered to that set + the monitor's current range.
 */
import type { BannedAd } from './report-banned'
import type { KpiMetrics, ReportRange, ReportRangeInfo } from './reports'

/** API level enum (contract §1 — `ad` is TikTok's `creative`). */
export type MonitorLevel = 'campaign' | 'adGroup' | 'ad'

/**
 * Classification of one level (contract §2); the Thai labels live in `app/utils/reports.ts`.
 * TASK-campaign-delete-ui — `deleted` is the API's **top-priority** key (above `rejected`): every row whose
 * `deletedAt` is set reads `deleted`, because deleting a campaign deletes its groups and ads too.
 * FEAT-064 — `banned` ranks right after `deleted` (an advertiser whose `suspendedReason === 'banned'`): a row
 * is listed whenever it has kpi snapshot data in the selected range (FEAT-068 §1), rendered as a red badge.
 * FEAT-068 — `missing` ranks right after `banned` (the row's `missingSince` is set, i.e. it is gone from
 * TikTok): a row is listed whenever it has kpi snapshot data in the selected range, like every other row.
 */
export type MonitorStatusKey = 'deleted' | 'banned' | 'missing' | 'delivering' | 'notDelivering' | 'paused' | 'rejected' | 'other'

/** `status` query value — the six keys plus `all` (default). */
export type MonitorStatusFilter = 'all' | MonitorStatusKey

/** `linked` query value — `true` (default: only ads our system launched), `false`, `all`. */
export type MonitorLinkedFilter = 'true' | 'false' | 'all'

/**
 * Ranges the monitor endpoints accept. FEAT-065 (api-contract.md §4.1) — the monitor endpoints joined the
 * shared vocabulary (`today | yesterday | 7d | all | custom`), so this is an alias of `ReportRange`.
 */
export type MonitorRange = ReportRange

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

/**
 * FEAT-064 v1.2 (contract §7.1) — the TikTok account's BC wallet balance (`tiktokAccounts.balance*`, the only
 * balance since FEAT-034; the advertiser has no balance of its own). Always an object: every key is null when
 * the wallet was never read or the account row is gone. Rendered by `AdsMonitorBudgetCell` as the
 * `am-budget-balance` line, deliberately **not** part of `advertiserBudget` (spec A14).
 */
export interface MonitorAccountBalance {
  amount: number | null
  currency: string | null
  /** ISO of the last wallet read */
  at: string | null
  /** last read error — a sentence safe to show */
  error: string | null
}

export interface MonitorAccountRef {
  id: string
  label: string | null
  /** v1.2 — full, unmasked, the fallback text when `label` is null */
  loginEmail: string | null
  sessionStatus: string
  /** FEAT-064 v1.2 — the account's BC wallet (contract §7.1), always an object */
  balance: MonitorAccountBalance
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

/** FEAT-060 — `advertisers.budget.edits`: the modal's daily edit-quota counter. */
export interface AdvertiserBudgetEdits {
  left: number
  total: number
  forDate: string | null
}

/** FEAT-060 — view of `advertisers.budgetPending` (contract §1.3, `budgetPendingView`). */
export interface BudgetPendingView {
  mode: 'custom' | 'unlimited'
  amount: number | null
  jobId: string
  requestedAt: string
}

/**
 * FEAT-060 — `row.advertiserBudget` (contract §3.1, exactly 9 keys), carried on every row of the three
 * `GET /ads-monitor/*` tabs, but only rendered as a column on the campaign tab (spec "UI behaviour"). The
 * budget is per **advertiser** (spec A1): `pending`/`error` are the same for every row of the same advertiser,
 * and the BO's own optimistic state is a second override map keyed by `advertiser.id` (`ads-monitor.vue` →
 * `advertiserOverrides`), never by this row's id.
 */
export interface MonitorAdvertiserBudget {
  mode: 'custom' | 'unlimited' | null
  amount: number | null
  currency: string | null
  setAt: string | null
  readAt: string | null
  edits: AdvertiserBudgetEdits | null
  pending: BudgetPendingView | null
  /** `budget.lastError` — a Thai sentence, safe to show */
  error: string | null
  /** why the button may not be pressed, computed by the API — the BO never re-derives this rule */
  settable: { ok: boolean, reason: string | null }
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

/**
 * FEAT-067 §1 — one UTM set as the human reads it: the four NAMES of `builds.utm` (never the ids). A name may
 * be `''` (older builds); the BO prints `—` for that line and omits that key from the `/reports/utm` link.
 */
export interface MonitorUtmSet {
  prefix: string
  source: string
  medium: string
  campaign: string
}

/** FEAT-067 §1 — `row.utm`: the row's first UTM set (contract A2) + every other distinct set of the group. */
export interface MonitorUtm extends MonitorUtmSet {
  /** always an array; `[]` on the ad tab and on single-set groups */
  others: MonitorUtmSet[]
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
  /**
   * FEAT-060 — the **advertiser's** spending cap (contract §3.1). Optional so a row from an older API or a
   * test stub without it renders as `blocked` (`AdsMonitorBudgetCell`) rather than crashing.
   */
  advertiserBudget?: MonitorAdvertiserBudget | null
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
  /**
   * FEAT-067 §1 — always present on every row of the three lists (contract §4: "a stub without it is a
   * harness bug, not a BO case"); `null` = no ad of this row has a build with a usable UTM (then no `others`
   * either). `AdsMonitorUtmCell` still renders `—` for a literal `undefined` rather than crashing.
   */
  utm: MonitorUtm | null
  /**
   * FEAT-082 §1 — **ad rows only**: the review/appeal summary of that creative, `null` when no review was ever
   * captured. Campaign / ad-group rows do not carry the key, and an old stub without it reads exactly like
   * `null` (spec "UI behaviour": a missing key never crashes the page).
   */
  review?: MonitorReviewSummary | null
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
  range: ReportRangeInfo
  intervalMs: number
  refreshedAt: string | null
  /**
   * FEAT-064 — echo of the request's `campaignId` (contract §1.3). `null` when the request has none;
   * otherwise `{ id: <query value>, name }` with `name` from the newest matching group, `null` when none.
   */
  campaign: { id: string, name: string | null } | null
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

/**
 * FEAT-060 — `POST /advertisers/:advertiserId/budget` body (contract §2). Discriminated on `mode`; `amount`
 * only exists on the `custom` branch (the API's zod schema is `.strict()` on both branches).
 */
export type SetBudgetBody = { mode: 'custom', amount: number } | { mode: 'unlimited' }

/** View of `advertisers.budget` carried on the 200 `unchanged` body (contract §2 step 3; `toBudgetView`, 7 keys). */
export interface AdvertiserBudgetView {
  mode: 'custom' | 'unlimited' | null
  amount: number | null
  currency: string | null
  readAt: string | null
  setAt: string | null
  lastError: string | null
  edits: AdvertiserBudgetEdits | null
}

/** `POST /advertisers/:advertiserId/budget` 202 body. */
export interface SetBudgetAccepted {
  jobId: string
  advertiserId: string
  mode: 'custom' | 'unlimited'
  amount: number | null
  budgetPending: BudgetPendingView
}

/** `POST /advertisers/:advertiserId/budget` 200 body — the request equalled the stored value, no job created. */
export interface SetBudgetUnchanged {
  unchanged: true
  advertiserId: string
  mode: 'custom' | 'unlimited'
  amount: number | null
  budget: AdvertiserBudgetView
}

/** Why a budget set was refused, in the API's own order (contract §2 step 4). */
export type BudgetConflictReason = 'pending' | 'banned' | 'notLoggedIn' | 'buildInProgress' | 'notDiscovered'

/** `POST /advertisers/:advertiserId/budget` 409 body — `error` is the Thai sentence shown in the toast. */
export interface BudgetConflict {
  error: string
  reason: BudgetConflictReason
}

// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// FEAT-082 — ad review detail (TikTok's "รายละเอียดการตรวจสอบโฆษณา") + appeal (api-contract.md v1 §0–§3)
// ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * §0 — the appeal state the API derives from TikTok's raw `appeal_status`:
 * 1 → `none` · 2 → `appealing` · 3 → `approved` · 4 → `rejected` · anything else / null → `unknown`.
 * The BO never re-derives it from `appealStatus`; it only renders what the API decided.
 */
export type AppealState = 'none' | 'appealing' | 'approved' | 'rejected' | 'unknown'

/** The five TikTok appeal reasons — the value travels to the API, the text is what the form shows. */
export type AppealReason = 1 | 2 | 3 | 4 | 5

/**
 * §0 — the five reason texts **verbatim** from TikTok's dialog (survey `ad-appeal.exploration.md` §2), in
 * TikTok's own order. The form renders them as `am-appeal-reason-1 … -5`.
 */
export const APPEAL_REASONS: Record<AppealReason, string> = {
  1: 'ฉันไม่คิดว่ามีการละเมิด',
  2: 'เหตุผลในการปฏิเสธคลุมเครือเกินไป',
  3: 'ฉันต้องการคำแนะนำสำหรับครั้งถัดไป',
  4: 'โฆษณาที่คล้ายกันผ่านการตรวจสอบ',
  5: 'ไม่ตรงกับข้อใดที่ระบุไว้ข้างต้น'
}

/** `APPEAL_REASONS` as an ordered list — what the radio group iterates (order is binding). */
export const APPEAL_REASON_ITEMS: { value: AppealReason, label: string }[]
  = ([1, 2, 3, 4, 5] as AppealReason[]).map(value => ({ value, label: APPEAL_REASONS[value] }))

/** §0 — an appeal job is queued/running for this ad (mirror of `optPending`). */
export interface AppealPendingView {
  jobId: string
  requestedAt: string
  /** admin id, `null` when the CLI queued it */
  requestedBy: string | null
  reason: AppealReason
}

/** §0 — the last failed appeal; `reason` is a Thai sentence that is safe to show. */
export interface AppealErrorView {
  jobId: string | null
  at: string
  reason: string
}

/** §0 — the row-level summary of the last successful appeal. */
export interface LastAppealSummary {
  jobId: string
  at: string
  /** admin id */
  by: string | null
  reason: AppealReason
}

/** §0 — the detail-level view of the last appeal (`by` resolved, plus what the job captured). */
export interface LastAppealView extends LastAppealSummary {
  byAdmin: { id: string, username: string, displayName: string } | null
  /** as typed by the admin, ≤ 2000 chars */
  description: string
  /** path only, never a query string; `null` until a real run captured it */
  apiPath: string | null
  tiktokCode: number | null
  appealStatusAfter: number | null
  dryRun: boolean
}

/**
 * §1 — `AdRowView.review`: the ad-tab row summary, `null` for a row whose review was never captured.
 * Campaign / ad-group rows do **not** carry the key at all, so it is optional here and a missing key is
 * treated exactly like `null` (old fixtures must not crash the page, spec "UI behaviour").
 */
export interface MonitorReviewSummary {
  appeal: AppealState
  /** raw TikTok value */
  appealStatus: number | null
  /** first issue's `policy_title` */
  policyTitle: string | null
  issueCount: number
  fetchedAt: string
  /** last read error (Thai) — `issues` may still be present */
  error: string | null
  appealPending: AppealPendingView | null
  appealError: AppealErrorView | null
  lastAppeal: LastAppealSummary | null
}

/** §2 — one stored violation frame; `url` is a 15 min presigned GET, `null` when storage is off. */
export interface ReviewFrameView {
  key: string
  url: string | null
  expiresAt: string | null
  capturedAt: string | null
}

/** §2 — one entry of TikTok's "เนื้อหาที่ถูกปฏิเสธ | รายละเอียดการปฏิเสธ" table. */
export interface ReviewIssueView {
  materialId: string
  /** left column, e.g. "โพสต์รูปภาพ TikTok" */
  contentTitle: string
  /** right column heading, e.g. "การพนันและเกม" */
  policyTitle: string
  reasonType: number | null
  reasonCode: number | null
  /** the reviewer's sentence */
  specification: string
  suggestion: string
  reasons: string[]
  forbiddenCountries: string[]
  /** pairs, e.g. `[[18, 24], [25, 34]]` */
  forbiddenAges: number[][]
  frames: ReviewFrameView[]
}

/** §2 — the `review` block of the detail view. */
export interface ReviewBlockView {
  fetchedAt: string
  jobId: string | null
  appeal: AppealState
  appealStatus: number | null
  auditStatus: number | null
  auditResultType: number | null
  /** last read error (Thai) — the previous `issues` are kept */
  error: string | null
  /** ≥ 1 frame could not be stored (Thai) */
  framesError: string | null
  issues: ReviewIssueView[]
}

/**
 * §2 — why the "อุทธรณ์" button may not be pressed, in the API's own order. The BO never re-derives the rule,
 * it only maps the code to a Thai tooltip (`appealableReasonText`).
 */
export type AppealableReason
  = | 'noReview'
    | 'appealPending'
    | 'notAppealable'
    | 'advertiserBanned'
    | 'accountUnavailable'
    | 'adGone'

/** §2 — `GET /ads-monitor/ads/:adId/review` 200 body. `review: null` is a 200 too (never a 404). */
export interface ReviewDetailView {
  adId: string
  name: string | null
  tiktokCreativeId: string | null
  advertiser: { id: string, name: string | null, tiktokAdvertiserId: string }
  /** the same `MonitorStatusView` the list uses for this row */
  status: MonitorStatus
  review: ReviewBlockView | null
  appealPending: AppealPendingView | null
  appealError: AppealErrorView | null
  lastAppeal: LastAppealView | null
  appealable: { ok: boolean, reason: AppealableReason | null }
}

/** §3 — `POST /ads-monitor/appeal` body (strict on the API side; `dryRun` is CLI-only). */
export interface AppealBody {
  adId: string
  reason: AppealReason
  description: string
}

/** §3 — `POST /ads-monitor/appeal` 202 body. */
export interface AppealAccepted {
  jobId: string
  appealPending: AppealPendingView
}

/** §3 — 409 body; `error` is the Thai sentence shown in the toast, `reason` the documented code. */
export interface AppealConflict {
  error: string
  reason: AppealableReason
}
