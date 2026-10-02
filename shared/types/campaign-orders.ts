/**
 * FEAT-016 — Launch ads + Orders (functions 6.2–6.6). Mirrors
 * mission-control/.ai/features/FEAT-016-launch-ads-and-orders-report/api-contract.md **v1**
 * (§4 readiness, §5 `GET /launch/targets`, `POST /campaign-orders`, `GET /campaign-orders[/:id]`,
 * `POST /campaign-orders/:id/cancel`, `POST /builds/:id/cancel`, `POST /builds/:id/stop-before-publish`,
 * §6 OrderView / BuildView).
 *
 * Unit of launch = one **advertiser**; the picker is account-first (1 advertiser per TikTok account per
 * order this round, `limits.maxAdvertisersPerAccount`). The BO invents no enum label for a template field:
 * everything human-readable about a template config comes from the templates' own `/options`
 * (`#shared/types/ad-group-templates`, `#shared/types/ad-templates`). The reason texts of
 * `unavailableReasons` are fixed English page chrome and live in `app/utils/launch-reasons.ts`.
 */
import type { AdvertiserStatus } from './advertisers'
import type { SessionStatus } from './tiktok-accounts'
import type { AdGroupBudget, AdGroupConfig } from './ad-group-templates'
import type { AdConfig } from './ad-templates'

/** Why a TikTok account cannot be launched right now (api-contract §4, evaluated in this order). */
export type UnavailableReason
  = 'inactive' | 'notLoggedIn' | 'needsHuman' | 'jobRunning' | 'buildInProgress' | 'noActiveAdvertiser'

/** `POST /campaign-orders` 409 reasons = the readiness reasons plus the per-advertiser check. */
export type RejectedReason = UnavailableReason | 'advertiserNotSelectable'

/** One advertiser of an account as served by `GET /launch/targets` — **all** rows, in BC order (§1). */
export interface LaunchAdvertiser {
  id: string
  tiktokAdvertiserId: string
  name: string
  status: AdvertiserStatus
  /** ISO | null — non-null means a discover round no longer listed it (never `selectable`) */
  missingSince: string | null
  /** 0-based position in the Business Center list; null until a discover round wrote it */
  bcOrder: number | null
  /** `status === 'active' && missingSince === null` — only these can be picked */
  selectable: boolean
  /**
   * FEAT-026 (api-contract v1 §1) — the stored, app-credited balance (`ADVERTISERS.balanceAmount/Currency/At`,
   * written only by `TopupService.applyCheck` on a `paid` round, FEAT-021). **Not** TikTok's live balance.
   */
  balanceAmount: string | null
  balanceCurrency: string | null
  /** ISO | null — time of the last credit */
  balanceAt: string | null
  /** `Number(balanceAmount.replace(/,/g, '')) > 0` — computed by the API */
  hasBalance: boolean
}

/** One TikTok account of `GET /launch/targets` (available accounts first, then label/loginEmail). */
export interface LaunchAccount {
  id: string
  label: string | null
  loginEmail: string
  /** `name` is null when the workspace row is gone */
  workspace: { id: string, name: string | null }
  bcOrgName: string | null
  sessionStatus: SessionStatus
  isActive: boolean
  /** true ⇔ `unavailableReasons` is empty */
  available: boolean
  unavailableReasons: UnavailableReason[]
  /** first `selectable` advertiser in BC order; null when the account has none */
  defaultAdvertiserId: string | null
  advertisers: LaunchAdvertiser[]
}

/** `limits` of `GET /launch/targets` — the API's own numbers (env), never hard-coded by the BO. */
export interface LaunchLimits {
  maxAdvertisersPerAccount: number
  maxAdGroupCopies: number
}

/** `GET /launch/targets` 200 body. */
export interface LaunchTargetsResponse {
  accounts: LaunchAccount[]
  limits: LaunchLimits
}

export type PublishMode = 'draft' | 'publish'
export type OrderStatus = 'queued' | 'running' | 'done' | 'partialFailed' | 'failed' | 'cancelled'
export type BuildStatus = 'queued' | 'running' | 'ready' | 'published' | 'failed' | 'cancelled'
export type BuildStepStatus = 'running' | 'done' | 'failed'

/** Fixed campaign preset of this round (no campaign templates yet, function 6.1). */
export interface CampaignPreset {
  objective: 'salesCashback'
  destination: 'websiteConversions'
}

/** One `targets[]` entry of the create body. */
export interface CreateOrderTarget {
  tiktokAccountId: string
  advertiserId: string
}

/** `POST /campaign-orders` body (zod **strict** on the API side — no extra key). */
export interface CreateOrderBody {
  name: string
  adGroupTemplateId: string
  adTemplateId: string
  adGroupCopies: number
  publishMode: PublishMode
  targets: CreateOrderTarget[]
}

/** Builds of an order grouped by status (aggregate, served with every OrderView). */
export interface BuildCounts {
  queued: number
  running: number
  ready: number
  published: number
  failed: number
  cancelled: number
}

/** api-contract §6 "OrderView" — list rows and the detail header. */
export interface OrderView {
  id: string
  name: string
  status: OrderStatus
  publishMode: PublishMode
  adGroupCopies: number
  campaignPreset: CampaignPreset
  /** snapshot of the template name at creation (survives a deleted template) */
  adGroupTemplate: { id: string, name: string }
  adTemplate: { id: string, name: string }
  targetCount: number
  buildCounts: BuildCounts
  /** from the order's `adGroupConfig.budget` snapshot; null when the snapshot has none */
  budget: AdGroupBudget | null
  workspace: { id: string, name: string | null }
  createdBy: { id: string, username: string | null }
  createdAt: string
  updatedAt: string
}

/**
 * The stored `adGroupConfig` / `adConfig` snapshots: written by an earlier catalog version, so every key is
 * optional for the reader. The detail page renders only what it recognises and never an invented label.
 */
export type AdGroupConfigSnapshot = Partial<AdGroupConfig> & Record<string, unknown>
export type AdConfigSnapshot = Partial<AdConfig> & Record<string, unknown>

/** `GET /campaign-orders/:id` → `order`: the OrderView plus both config snapshots. */
export interface OrderDetail extends OrderView {
  adGroupConfig: AdGroupConfigSnapshot
  adConfig: AdConfigSnapshot
}

/**
 * One entry of `builds[].steps` — written by the build worker (FEAT-017).
 * `screenshotUrl` is **API-relative** (`/builds/<buildId>/screenshots/<no>`), so the BO passes it to
 * `useApi()` unchanged and the proxy prefix `/backend` is added by the client.
 */
export interface BuildStep {
  no: number
  name: string
  status: BuildStepStatus
  message: string | null
  screenshotUrl: string | null
  at: string
}

/**
 * `GET /builds/:id/screenshots/:no` 200 body (FEAT-017 api-contract §6) — the PNG inline, base64 without a
 * data-URI prefix. 404 `{ error: 'ไม่พบ screenshot' }` when the step has none or the file is gone.
 */
export interface BuildScreenshotResponse {
  mimeType: string
  base64: string
}

/** api-contract §6 "BuildView" — one build = one advertiser of the order. */
export interface BuildView {
  id: string
  orderId: string
  status: BuildStatus
  /** null when the account row is gone; never a `password` */
  account: { id: string, label: string | null, loginEmail: string } | null
  advertiser: { id: string, name: string, tiktokAdvertiserId: string } | null
  /** name of the last `steps[]` entry, null while empty */
  step: string | null
  stepCount: number
  steps: BuildStep[]
  lastError: string | null
  stopBeforePublish: boolean
  stoppedBeforePublish: boolean
  tiktokCampaignId: string | null
  publishedAt: string | null
  startedAt: string | null
  finishedAt: string | null
  createdAt: string
}

/** `POST /campaign-orders` 201 body. */
export interface CreateOrderResponse {
  order: OrderView
  builds: BuildView[]
}

/** `GET /campaign-orders/:id` and the three action routes return this same body. */
export interface OrderDetailResponse {
  order: OrderDetail
  builds: BuildView[]
}

/** Sort values accepted by `GET /campaign-orders` (default `-createdAt`). */
export type OrderSort = 'createdAt' | '-createdAt' | 'name' | '-name'

/** `GET /campaign-orders` 200 body — paginated envelope plus `runningCount` (scope-wide, filters ignored). */
export interface CampaignOrdersResponse {
  orders: OrderView[]
  page: number
  limit: number
  total: number
  runningCount: number
}

/** One entry of the 409 `rejected` array of `POST /campaign-orders`. */
export interface RejectedTarget {
  tiktokAccountId: string
  advertiserId: string
  reasons: RejectedReason[]
}

/** `POST /campaign-orders` 409 body (`บาง account ไม่พร้อมยิง`). */
export interface CreateOrderRejectedBody {
  error: string
  rejected: RejectedTarget[]
}

/** 409 body of `POST /builds/:id/cancel` and `/stop-before-publish` (carries the current build status). */
export interface BuildConflictBody {
  error: string
  status: BuildStatus
}
