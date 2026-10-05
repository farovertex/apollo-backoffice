/**
 * FEAT-002 — `GET /browser-profiles/available` (apollo-api, functions 2.1 + 2.2 automatic). Mirrors
 * mission-control/.ai/features/FEAT-002-browser-profiles-menu/api-contract.md v2 (listing syncs into
 * BROWSER_PROFILES; visibility per workspace is applied server-side) + FEAT-003 v1 (`boundAccount` on each item).
 * FEAT-006 v1 (functions 2.3 + 2.10): every item gains `proxyId` / `proxyRef` / `fingerprint`; this file also holds
 * `GET /browser-profiles/options`, `/browser-profile-defaults/me` and `POST /browser-profiles/create`.
 * FEAT-007 v1: every item + the 201 body gain `tags` (display only, from the AdsPower `remark`); the admin's
 * per-profile "group" (FEAT-006) is replaced by one system-wide `ADSPOWER_GROUP_NAME` + a display-only tag =
 * username (`ProfileDefaultsGroup`).
 * FEAT-024 v1 (api-contract §3.1/§3.2/§3.4, §10): `/available` answers from Mongo and never calls the provider, so
 * every provider round-trip became a job. An item may be a **reserved** row whose provider profile does not exist yet
 * (`providerProfileId: null`, `syncedAt: null`, `runState: 'provisioning'`) or a failed one (`runState: 'error'` +
 * `provisionError`); the response gained a top-level `sync` block (the state of the `syncList` job / node) and
 * `POST /browser-profiles/sync` (`SyncResponse`) replaces the implicit sync that used to happen behind every GET.
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

/**
 * FEAT-024 — `browserProfiles.runState`. `provisioning` = the row is reserved and the provider `create` job has not
 * finished; `error` = the last provider op on this row failed (see `provisionError`). The BO only reacts to those two.
 */
export type ProfileRunState = 'closed' | 'opening' | 'open' | 'closing' | 'provisioning' | 'error'

export interface AvailableProfile {
  /** BROWSER_PROFILES._id — every listed profile is in the DB after the sync */
  id: string
  provider: 'adspower'
  /** FEAT-024 — `null` while the row is only reserved (`runState: 'provisioning'`) or the create job failed */
  providerProfileId: string | null
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
  /** ISO — last time this profile was seen in the provider list; FEAT-024: `null` for a reserved row */
  syncedAt: string | null
  /** FEAT-007 — display only, from the AdsPower `remark`; `[]` = none. Never used for search/filter. */
  tags: string[]
  /** FEAT-024 — provider-side lifecycle of the row (see `ProfileRunState`) */
  runState: ProfileRunState
  /** FEAT-024 — why the last provider op failed (never a secret); `null` unless something failed */
  provisionError: string | null
}

/**
 * FEAT-024 — top-level `sync` of `/available`: the state of the profile list sync (one `provider{syncList}` job per
 * node). `status: 'running'` = such a job is `waiting|active` right now (BO polls until `idle`), `lastSyncedAt` =
 * oldest `lastSyncedAt` of the considered nodes (null = never), `lastError` = first node error text (null = none).
 */
export interface AvailableSyncState {
  status: 'idle' | 'running'
  jobId: string | null
  lastSyncedAt: string | null
  lastError: string | null
}

/**
 * 200 body. `total` = visible rows before `q`/`group`/`status`, `groups` = sorted distinct non-empty groupName of the
 * visible rows. FEAT-024: `syncedAt` = `sync.lastSyncedAt` (`null` when the list was never synced), and the request
 * itself no longer syncs anything.
 */
export interface AvailableResponse {
  count: number
  total: number
  groups: string[]
  syncedAt: string | null
  sync: AvailableSyncState
  profiles: AvailableProfile[]
}

/** FEAT-024 — `POST /browser-profiles/sync` 202 body; `reused: true` = a sync job was already queued/running. */
export interface SyncResponse {
  jobId: string
  node: string
  reused: boolean
}

/** 429 / 503 / 502 body (`providerErrors()` in apollo-api). */
export interface ProviderErrorBody {
  error: string
  kind: 'busy' | 'unreachable' | 'permanent'
}

/** functions 2.11 — `POST /browser-profiles/:id/force-close` (202): AdsPower closes the Chrome window right away, even when a job holds the lock */
export interface ForceCloseResponse {
  /** true = a request was already pending; nothing new was written */
  reused: boolean
  profile: {
    id: string
    runState: ProfileRunState
    /** the pending request (`null` once the node has closed the browser, or the close failed) */
    forceClose: { requestedAt: string, startedAt: string | null } | null
  }
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

/**
 * `POST /browser-profiles/create` body — the BO always sends every key (spec AC-9) **except** `proxyId`.
 * FEAT-027 v1.2 (BUG-030, api-contract.md §5) — `proxyId` is omitted while the Proxy field still holds the
 * caller's default (bound or not), so the API resolves it server-side and applies AS-1 instead of a 409; sent
 * only once the admin picks a different proxy or "No proxy" explicitly.
 */
export interface CreateProfileBody extends Omit<ProfileSettings, 'proxyId'> {
  name: string
  proxyId?: string | null
}

/**
 * `POST /browser-profiles/create` 201 body = the `/available` item + `createdBy` / `createdAt`.
 * FEAT-024: the row is only **reserved** at this point (`providerProfileId: null`, `runState: 'provisioning'`) and
 * `jobId` is the `provider{create}` job that will fill it in.
 * FEAT-027 AS-1: `proxyWarning` is present only when no explicit `proxyId` was sent and the caller's default proxy
 * was bound to another profile — the profile is created **without** a proxy; the BO shows it as a warning toast.
 */
export interface CreatedProfile extends AvailableProfile {
  createdBy: string
  createdAt: string
  jobId: string
  proxyWarning?: string
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
