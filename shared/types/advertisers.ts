/**
 * FEAT-005 — advertisers discovered from the Business Center (functions 3.9, action-flow F6). Mirrors
 * mission-control/.ai/features/FEAT-005-discover-advertisers-from-business-center/api-contract.md v1 §5
 * ("AdvertiserView", `GET /tiktok-accounts/:id/advertisers`, `POST /tiktok-accounts/:id/discover`).
 * Raw Business Center ints/strings are stored as-is (`raw` is never returned); discover `status` is
 * its own map: `account_status` 4 → `active`, 8 → `suspended`. Other codes fall through to `rejectReason` /
 * `showPunishLink`. The filter-dropdown words are a different map and are not used here.
 * FEAT-016 (api-contract.md v1 §1): the view gains `bcOrder`, the 0-based position of the advertiser in the
 * Business Center list API, written by every successful discover run.
 * FEAT-029 (api-contract.md v1 §4): the view gains `launchingAds`, `launchingSince` and `suspendedReason` —
 * all written by the system only (publish → on, kpi round → off).
 * FEAT-039 (api-contract.md v1 §3/§5): the kpi OFF rule no longer fires on `not_delivery` (only on an empty
 * today-round or a TikTok ban), so `suspendedReason` drops `'noDelivery'` and keeps `'banned'` only. A new
 * `delivery` block records the raw TikTok reasons the ads stopped (or resumed) so an admin can see why,
 * without touching the launching flag.
 * FEAT-030 (api-contract.md v1 §4): the auto top-up **configuration** moved to the system settings
 * (`shared/types/settings.ts`, `GET`/`PATCH /settings/auto-topup`, GOD only).
 * FEAT-034 (api-contract.md v1 §4) — TikTok keeps one shared cash balance per Business Center: `balanceAmount`,
 * `balanceCurrency`, `balanceAt`, `balanceError` and `autoTopup` move off the advertiser entirely (they never
 * appear in `AdvertiserView` any more) and live only on the TikTok account (`shared/types/tiktok-accounts.ts`,
 * `AccountAutoTopup`). The per-advertiser top-up button stays — it is a different entry point to the same
 * wallet — but the advertiser itself carries no balance or auto-top-up state.
 */

import type { AdvertiserReport } from './reports'
import type { TopupView } from './topups'

export type AdvertiserStatus = 'active' | 'suspended' | 'unknown'

/**
 * FEAT-037 (api-contract.md v1 §2.1) — `banned` = a kpi round read TikTok's permission endpoint
 * (`data.account.status === 8`); cleared only when a later round reads `status === 4` again. `null` for
 * every other suspension (the Business Center one).
 * FEAT-039 — `noDelivery` is removed: a `not_delivery` kpi round no longer suspends the advertiser (it is
 * recorded on `delivery` instead, see below).
 */
export type AdvertiserSuspendedReason = 'banned'

/**
 * FEAT-039 (api-contract.md v1 §3) — whether the kpi job currently sees this advertiser's ads delivering.
 * `notDelivering` = every ad row `not_delivery` (or a complete today-round with zero rows); `delivering` =
 * at least one row not `not_delivery`; `unknown` = never evaluated. Written only by `LaunchingService`.
 */
export type AdvertiserDeliveryState = 'delivering' | 'notDelivering' | 'unknown'

/** FEAT-039 (api-contract.md v1 §3) — `AdvertiserView.delivery`. */
export interface AdvertiserDelivery {
  state: AdvertiserDeliveryState
  /** raw TikTok secondary statuses of the not-delivering rows, lower-case, unique, sorted; `[]` when delivering */
  reasons: string[]
  /** ISO | null — set on the transition into `notDelivering`; untouched on later notDelivering rounds */
  since: string | null
  /** ISO | null — kpi clock time of the last complete today-round that evaluated this advertiser */
  checkedAt: string | null
}

/** `missing` query of `GET /tiktok-accounts/:id/advertisers`: `false` (default) → only current rows, `all` → every row. */
export type AdvertiserMissingFilter = 'false' | 'true' | 'all'

export interface Advertiser {
  id: string
  tiktokAccountId: string
  workspaceId: string
  bcOrgId: string
  /** BC `account_id` (unique per tiktokAccountId) */
  tiktokAdvertiserId: string
  /** BC `account_name` */
  name: string
  status: AdvertiserStatus
  accountType: number | null
  /** raw BC `account_status` (discover: 4 active, 8 suspended) */
  accountStatus: number | null
  relationStatus: number | null
  relationType: number | null
  verificationStatus: number | null
  /** raw BC `ad_account_type` */
  adAccountType: number | null
  advRole: number | null
  roles: number[]
  roleKeys: string[]
  ownerId: string | null
  ownerName: string | null
  region: string | null
  /** full BC `reject_reason` text; non-empty ⇒ `status: 'suspended'` */
  rejectReason: string | null
  showPunishLink: boolean
  isSmb: boolean
  /** `account_relation_infos[account_id]` verbatim (upstream snake_case inside) */
  relationInfo: Record<string, unknown> | null
  /**
   * FEAT-016 — 0-based position in the Business Center list of the last discover round that saw the row
   * ("BC order"); null for rows written before the field existed. Sort rule everywhere: `bcOrder` asc with
   * nulls last, then `discoveredAt` asc, then `name`.
   */
  bcOrder: number | null
  /** ISO — first discover round that listed it */
  discoveredAt: string
  /** ISO — last discover round that listed it */
  lastSeenAt: string
  /** ISO | null — set when a successful round did not list it; cleared when seen again */
  missingSince: string | null
  createdAt: string
  updatedAt: string
  /**
   * FEAT-021 (api-contract v1 §3.2) — the **active** top-up round of this advertiser, else the latest round
   * whose status is `notFound` (so "ตรวจอีกครั้ง" has something to act on), else `null`. Never carries the QR
   * image: it comes back only in the 200 body of `POST /topups/:id/claim`.
   */
  topup: TopupView | null
  /**
   * FEAT-029 — a build of this advertiser reached `published` and the kpi job still sees at least one ad
   * delivering. Written by the system only (publish → true, kpi OFF rule → false); optional for readers of an
   * API that predates the feature.
   */
  launchingAds?: boolean
  /** ISO | null — start of the current launching period (cleared when the flag goes off) */
  launchingSince?: string | null
  /** FEAT-037 — `banned` when a kpi round read a TikTok ban; null for a Business Center suspension */
  suspendedReason?: AdvertiserSuspendedReason | null
  /**
   * FEAT-039 — raw TikTok delivery state of this advertiser's ads, as last seen by the kpi job; optional for
   * readers of an API that predates the feature (rows without it behave as `{ state: 'unknown', ... }`).
   */
  delivery?: AdvertiserDelivery
  /**
   * FEAT-020 (AC-21) — ads-report tracking state of this advertiser, served with the list so the slideover
   * needs no extra request. Optional for readers of an API that predates the feature.
   */
  report?: AdvertiserReport
}

/** `GET /tiktok-accounts/:id/advertisers` 200 body (first paginated envelope of apollo-api). */
export interface AdvertisersResponse {
  advertisers: Advertiser[]
  page: number
  limit: number
  total: number
}

/** `POST /tiktok-accounts/:id/discover` 202 body. */
export interface DiscoverJobResponse {
  jobId: string
}
