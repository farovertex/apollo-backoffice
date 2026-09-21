/**
 * FEAT-002 — `GET /browser-profiles/available` (apollo-api, functions 2.1 + 2.2 automatic). Mirrors
 * mission-control/.ai/features/FEAT-002-browser-profiles-menu/api-contract.md v2 (listing syncs into
 * BROWSER_PROFILES; visibility per workspace is applied server-side).
 */

export interface AvailableProfileProxy {
  type: string | null
  host: string
  port: string | null
  country: string | null
}

/** `free` = `boundAccountId` null, `bound` otherwise (computed by the API, not stored). */
export type AvailableProfileStatus = 'free' | 'bound'

export interface AvailableProfile {
  /** BROWSER_PROFILES._id — every listed profile is in the DB after the sync */
  id: string
  provider: 'adspower'
  providerProfileId: string
  name: string
  groupName: string | null
  proxy: AvailableProfileProxy | null
  /** `null` = system-synced, shared with every admin; a string = claimed by that workspace */
  workspaceId: string | null
  status: AvailableProfileStatus
  boundAccountId: string | null
  /** ISO — last time this profile was seen in the provider list */
  syncedAt: string
}

/**
 * 200 body. `total` = visible rows before `q`/`group`/`status`, `groups` = sorted distinct non-empty groupName of the
 * visible rows, `syncedAt` = timestamp of this sync.
 */
export interface AvailableResponse {
  count: number
  total: number
  groups: string[]
  syncedAt: string
  profiles: AvailableProfile[]
}

/** 429 / 503 / 502 body (`providerErrors()` in apollo-api). */
export interface ProviderErrorBody {
  error: string
  kind: 'busy' | 'unreachable' | 'permanent'
}
