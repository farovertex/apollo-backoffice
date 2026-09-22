/**
 * FEAT-005 — advertisers discovered from the Business Center (functions 3.9, action-flow F6). Mirrors
 * mission-control/.ai/features/FEAT-005-discover-advertisers-from-business-center/api-contract.md v1 §5
 * ("AdvertiserView", `GET /tiktok-accounts/:id/advertisers`, `POST /tiktok-accounts/:id/discover`).
 * Raw Business Center ints/strings are stored as-is (`raw` is never returned); `status` is the only derived field:
 * `suspended` when `rejectReason` is non-empty or `showPunishLink`, otherwise `unknown` (no confirmed mapping to
 * `active` yet).
 */

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
  /** raw BC `account_status` (4 / 8 in the sample; meaning unconfirmed) */
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
  /** ISO — first discover round that listed it */
  discoveredAt: string
  /** ISO — last discover round that listed it */
  lastSeenAt: string
  /** ISO | null — set when a successful round did not list it; cleared when seen again */
  missingSince: string | null
  createdAt: string
  updatedAt: string
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
