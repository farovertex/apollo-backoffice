/**
 * FEAT-002 — `GET /browser-profiles/available` (apollo-api, functions 2.1). Mirrors
 * mission-control/.ai/features/FEAT-002-browser-profiles-menu/api-contract.md v1.
 */

export interface AvailableProfileProxy {
  type: string | null
  host: string
  port: string | null
  country: string | null
}

/** `null` = not registered in our system; `visible: false` = registered in a workspace the caller cannot access. */
export interface AvailableProfileRegistered {
  id: string
  workspaceId: string | null
  visible: boolean
}

export interface AvailableProfile {
  provider: 'adspower'
  providerProfileId: string
  name: string
  groupName: string | null
  proxy: AvailableProfileProxy | null
  registered: AvailableProfileRegistered | null
}

/** 200 body. `total` = provider count before `q`/`group`, `groups` = distinct non-empty groupName of the unfiltered list. */
export interface AvailableResponse {
  count: number
  total: number
  groups: string[]
  profiles: AvailableProfile[]
}

/** 429 / 503 / 502 body (`providerErrors()` in apollo-api). */
export interface ProviderErrorBody {
  error: string
  kind: 'busy' | 'unreachable' | 'permanent'
}
