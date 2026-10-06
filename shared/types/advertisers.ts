/**
 * FEAT-005 — advertisers discovered from the Business Center (functions 3.9, action-flow F6). Mirrors
 * mission-control/.ai/features/FEAT-005-discover-advertisers-from-business-center/api-contract.md v1 §5
 * ("AdvertiserView", `GET /tiktok-accounts/:id/advertisers`, `POST /tiktok-accounts/:id/discover`).
 * Raw Business Center ints/strings are stored as-is (`raw` is never returned); discover `status` is
 * its own map: `account_status` 4 → `active`, 8 → `suspended`. Other codes fall through to `rejectReason` /
 * `showPunishLink`. The filter-dropdown words are a different map and are not used here.
 * FEAT-016 (api-contract.md v1 §1): the view gains `bcOrder`, the 0-based position of the advertiser in the
 * Business Center list API, written by every successful discover run.
 * FEAT-029 (api-contract.md v1 §4): the view gains `launchingAds`, `launchingSince`, `suspendedReason`,
 * `balanceError` and `autoTopup` — all written by the system only (publish → on, kpi round → off / balance /
 * auto round).
 * FEAT-030 (api-contract.md v1 §4): the auto top-up **configuration** moved to the system settings
 * (`shared/types/settings.ts`, `GET`/`PATCH /settings/auto-topup`, GOD only). `autoTopup` on an advertiser is
 * pure system bookkeeping now — `{ lastTriggeredAt, lastRoundId }` — and nothing in the BO writes it;
 * `PATCH /advertisers/:id/auto-topup` is gone.
 */

import type { AdvertiserReport } from './reports'
import type { TopupView } from './topups'

export type AdvertiserStatus = 'active' | 'suspended' | 'unknown'

/**
 * FEAT-029 — why the kpi job suspended the advertiser. `noDelivery` = a complete kpi round of today saw no
 * delivering ad at all; cleared by a new publish or by a round that sees one again. `null` for every other
 * suspension (the Business Center one).
 */
export type AdvertiserSuspendedReason = 'noDelivery'

/**
 * FEAT-030 §4 — auto top-up **bookkeeping** of one advertiser; always present on the view (old rows read as
 * `{ lastTriggeredAt: null, lastRoundId: null }`). Written by the system only, when it opens an auto round;
 * the configuration (enabled / minBalance / amount / cooldown) lives in the system settings since FEAT-030.
 */
export interface AdvertiserAutoTopup {
  /** ISO | null — only set when a round was really created */
  lastTriggeredAt: string | null
  /** id of the round created last; null until then */
  lastRoundId: string | null
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
  /** FEAT-029 — `noDelivery` when the kpi job suspended the advertiser; null for a Business Center suspension */
  suspendedReason?: AdvertiserSuspendedReason | null
  /** ยอดคงเหลือที่บวกจากรอบฝากที่ตรวจผ่านแล้ว · null = ยังไม่เคยฝากสำเร็จ (FEAT-029: also written by the kpi job) */
  balanceAmount?: string | null
  balanceCurrency?: string | null
  /** ISO | null */
  balanceAt?: string | null
  /** FEAT-029 — Thai text of the last failed balance read (`อ่านยอดคงเหลือไม่ได้`); null after a success */
  balanceError?: string | null
  /** FEAT-030 — auto top-up bookkeeping (`lastTriggeredAt` / `lastRoundId`); the API always sends it */
  autoTopup?: AdvertiserAutoTopup
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
