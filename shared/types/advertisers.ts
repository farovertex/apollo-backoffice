/**
 * FEAT-005 — advertisers discovered from the Business Center (functions 3.9, action-flow F6). Mirrors
 * mission-control/.ai/features/FEAT-005-discover-advertisers-from-business-center/api-contract.md v1 §5
 * ("AdvertiserView", `GET /tiktok-accounts/:id/advertisers`, `POST /tiktok-accounts/:id/discover`).
 * Raw Business Center ints/strings are stored as-is (`raw` is never returned); discover `status` is
 * its own map: `account_status` 4 → `active`, 8 → `suspended`. Other codes fall through to `rejectReason` /
 * `showPunishLink`. The filter-dropdown words are a different map and are not used here.
 * FEAT-016 (api-contract.md v1 §1): the view gains `bcOrder`, the 0-based position of the advertiser in the
 * Business Center list API, written by every successful discover run.
 */

import type { AdvertiserReport } from './reports'
import type { TopupView } from './topups'

export type AdvertiserStatus = 'active' | 'suspended' | 'unknown'

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
  /** ยอดคงเหลือที่บวกจากรอบฝากที่ตรวจผ่านแล้ว · null = ยังไม่เคยฝากสำเร็จ */
  balanceAmount?: string | null
  balanceCurrency?: string | null
  /** ISO | null */
  balanceAt?: string | null
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
