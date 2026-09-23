/**
 * FEAT-002 — `GET /browser-profiles/available` (apollo-api, functions 2.1 + 2.2 automatic). Mirrors
 * mission-control/.ai/features/FEAT-002-browser-profiles-menu/api-contract.md v2 (listing syncs into
 * BROWSER_PROFILES; visibility per workspace is applied server-side) + FEAT-003 v1 (`boundAccount` on each item).
 * FEAT-006 v1 (functions 2.3 + 2.10): every item gains `proxyId` / `proxyRef` / `fingerprint`; this file also holds
 * `GET /browser-profiles/options`, `/browser-profile-defaults/me` and `POST /browser-profiles/create`.
 * FEAT-007 v1: every item + the 201 body gain `tags` (display only, from the AdsPower `remark`); the admin's
 * per-profile "group" (FEAT-006) is replaced by one system-wide `ADSPOWER_GROUP_NAME` + a display-only tag =
 * username (`ProfileDefaultsGroup`).
 */

export interface AvailableProfileProxy {
  type: string | null
  host: string
  port: string | null
  country: string | null
}

/** `free` = `boundAccountId` null, `bound` otherwise (computed by the API, not stored). */
export type AvailableProfileStatus = 'free' | 'bound'

/** FEAT-003 (api-contract v1) — the TikTok account bound to a profile, as shown on the Bound badge. */
export interface BoundAccountRef {
  id: string
  label: string | null
  loginEmail: string
}

export interface AvailableProfile {
  /** BROWSER_PROFILES._id — every listed profile is in the DB after the sync */
  id: string
  provider: 'adspower'
  providerProfileId: string
  name: string
  groupName: string | null
  proxy: AvailableProfileProxy | null
  /** FEAT-006 — `proxies._id` chosen when the profile was created from the BO; null when synced or after a delete */
  proxyId: string | null
  /** FEAT-006 — joined from `proxies` by `proxyId` (never username/password); display source of truth */
  proxyRef: ProxyRef | null
  /** FEAT-006 — what was sent to the provider at create time; null for profiles that were only synced */
  fingerprint: ProfileFingerprint | null
  /** `null` = system-synced, shared with every admin; a string = claimed by that workspace */
  workspaceId: string | null
  status: AvailableProfileStatus
  boundAccountId: string | null
  /** FEAT-003 — joined from `tiktokAccounts` by `boundAccountId`; `null` when free (or the account row is gone) */
  boundAccount: BoundAccountRef | null
  /** ISO — last time this profile was seen in the provider list */
  syncedAt: string
  /** FEAT-007 — display only, from the AdsPower `remark`; `[]` = none. Never used for search/filter. */
  tags: string[]
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

// ── FEAT-006 — fingerprint, options, defaults, create ─────────────────────────────────────────────────────────────────

/** desktop only (provider-neutral `ProfileOs`) */
export type ProfileOs = 'Windows' | 'Mac OS X' | 'Linux'
export type ProfileWebrtc = 'disabled' | 'proxy' | 'forward' | 'local'
/** `'default'` | a core count as a string — the exact list comes from `GET /browser-profiles/options` */
export type ProfileCpu = string
/** `'default'` | GB as a string — the exact list comes from `GET /browser-profiles/options` */
export type ProfileRam = string

export interface ProfileBrowser {
  kernel: 'chrome'
  /** `'ua_auto'` or a Chrome major version as a string */
  version: string
}

export interface ProfileHardwareNoise {
  enabled: boolean
  audio: boolean
  cpu: ProfileCpu
  ram: ProfileRam
}

/** What the API sends to the provider and stores on `browserProfiles.fingerprint`. */
export interface ProfileFingerprint {
  browser: ProfileBrowser
  os: ProfileOs
  webrtc: ProfileWebrtc
  hardwareNoise: ProfileHardwareNoise
}

/** `proxies` row as joined onto a profile / defaults view — never username or password. */
export interface ProxyRef {
  id: string
  label: string
  type: string
  host: string
  port: number
  country: string | null
}

/** fingerprint + proxy choice: the body of `PUT /browser-profile-defaults/me` and `options.systemDefault`. */
export interface ProfileSettings extends ProfileFingerprint {
  proxyId: string | null
}

/** `GET /browser-profiles/options` 200 body — the BO hard-codes none of these lists. */
export interface ProfileOptions {
  browserVersions: string[]
  os: ProfileOs[]
  webrtc: ProfileWebrtc[]
  cpu: ProfileCpu[]
  ram: ProfileRam[]
  systemDefault: ProfileSettings
}

/**
 * FEAT-007 — the one AdsPower group the system works with + the display-only tag of the caller.
 * `name` = `ADSPOWER_GROUP_NAME` (trimmed) or `null` when unset (BO shows "Ungrouped"); `tag` = `ADMINS.username`
 * of the caller, never empty for a logged-in admin.
 */
export interface ProfileDefaultsGroup {
  name: string | null
  tag: string
}

/** `GET /browser-profile-defaults/me` 200 body (function 2.10). */
export interface ProfileDefaults extends ProfileSettings {
  /** `system` = no saved row yet (values = system default), `saved` = the admin saved their own set */
  source: 'system' | 'saved'
  /** resolved `proxyId` (no credentials); null when no proxy or it is gone / not accessible */
  proxy: ProxyRef | null
  group: ProfileDefaultsGroup
  /** ISO of the saved row, null for `source: 'system'` */
  updatedAt: string | null
}

/** `PUT /browser-profile-defaults/me` body — full replacement. */
export type PutDefaultsBody = ProfileSettings

/** `POST /browser-profiles/create` body — the BO always sends every key (spec AC-9). */
export interface CreateProfileBody extends ProfileSettings {
  name: string
}

/** `POST /browser-profiles/create` 201 body = the `/available` item + `createdBy` / `createdAt`. */
export interface CreatedProfile extends AvailableProfile {
  createdBy: string
  createdAt: string
}

/**
 * Error body of the create path: 400 (`error: 'validation'` + `issues`), 404, 422 / 429 / 502 (`kind`),
 * 500 (`providerProfileId` — the provider created the profile but the DB write failed).
 */
export interface CreateProfileErrorBody {
  error: string
  kind?: 'busy' | 'unreachable' | 'permanent'
  issues?: { path: string, message: string }[]
  providerProfileId?: string
}
