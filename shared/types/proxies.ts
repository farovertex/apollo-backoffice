/**
 * FEAT-006 — `/proxies` (apollo-api, function 2.9). Mirrors
 * mission-control/.ai/features/FEAT-006-browser-profile-create-per-admin-defaults-and-prox/api-contract.md v1
 * ("Proxy view", `GET/POST/PATCH/DELETE /proxies`).
 * `password` is plaintext by human decision (same as TIKTOK_ACCOUNTS.password): the BO masks it, offers show/copy,
 * and never logs / screenshots it.
 *
 * FEAT-027 — 1:1 binding, connectivity check and batch CSV upload. Mirrors
 * mission-control/.ai/features/FEAT-027-proxy-1-1-binding-connectivity-check-and-batch-csv/api-contract.md v1
 * (§3 "Proxy view", §4 "GET /proxies", §9 "POST /proxies/:id/check", §10 "POST /proxies/batch").
 */

export type ProxyType = 'http' | 'https' | 'socks5'

/** counts of rows pointing at this proxy — shown in the delete confirmation */
export interface ProxyUsage {
  /** browserProfileDefaults rows (admins using it as their default) */
  defaults: number
  /** browserProfiles rows created with it */
  profiles: number
}

/** FEAT-027 §3 — the one browser profile holding this proxy, or null when free. */
export interface ProxyBoundProfile {
  id: string
  /** `browserProfiles.name`; null if the row vanished without releasing the claim (should not happen) */
  name: string | null
}

/** FEAT-027 §3 — result of the last `POST /proxies/:id/check`, or null when never checked. */
export interface ProxyLastCheck {
  at: string
  ok: boolean
  /** set on success, null on failure */
  ip: string | null
  /** set on failure, null on success — sanitized, never contains credentials */
  error: string | null
}

/** Exact key set of the API's proxy view. */
export interface Proxy {
  id: string
  workspaceId: string
  /** `workspaces.name`; null when the workspace row is gone */
  workspaceName: string | null
  label: string
  type: ProxyType
  host: string
  /** number (not a string) on the view */
  port: number
  username: string | null
  password: string | null
  /** 2 letters, upper-case */
  country: string | null
  note: string | null
  usage: ProxyUsage
  createdBy: string
  createdAt: string
  updatedAt: string
  /** FEAT-027 §3 — null when free */
  boundProfile: ProxyBoundProfile | null
  /** FEAT-027 §3 — null when never checked */
  lastCheck: ProxyLastCheck | null
}

/** `GET /proxies` 200 body — paginated envelope (FEAT-005 convention). */
export interface ProxiesResponse {
  proxies: Proxy[]
  page: number
  limit: number
  total: number
}

/** `POST /proxies` body (`createProxySchema`). Optional keys: omitted or `null` = not set. */
export interface CreateProxyBody {
  label: string
  type: ProxyType
  host: string
  port: number
  username?: string | null
  password?: string | null
  country?: string | null
  note?: string | null
}

/** `PATCH /proxies/:id` body — **only the changed keys**; `null` clears an optional field. */
export type PatchProxyBody = Partial<CreateProxyBody>

/** `DELETE /proxies/:id` 200 body (cascade counts). */
export interface DeleteProxyResponse {
  ok: boolean
  defaultsCleared: number
  profilesCleared: number
}

/**
 * FEAT-027 §4/§7/§8 — 409 shape shared by every "proxy already bound" case: `POST /browser-profiles/create` and
 * `PATCH /browser-profile-defaults` with an explicit bound `proxyId`, `DELETE /proxies/:id` while bound, and
 * `PATCH /proxies/:id` while bound with any connection-field key in the body (`lockedFields` only on that last one).
 */
export interface ProxyBoundConflictBody {
  error: string
  boundProfileId: string
  boundProfileName: string | null
  /** present only on the `PATCH /proxies/:id` 409 — the connection-field keys the body tried to change */
  lockedFields?: ('type' | 'host' | 'port' | 'username' | 'password')[]
}

/** FEAT-027 §9 — `POST /proxies/:id/check` 200 body. Always 200: the result is data, not an HTTP error. */
export interface CheckProxyResponse {
  ok: boolean
  /** set on success, null on failure */
  ip: string | null
  /** set on failure, null on success */
  error: string | null
  checkedAt: string
  durationMs: number
}

/** FEAT-027 §10/§11 — one row of the `POST /proxies/batch` body; `line` = the 1-based line in the CSV file. */
export interface BatchProxyRow {
  line: number
  label?: string
  country?: string
  proxy: string
}

/** FEAT-027 §10 — `POST /proxies/batch` body: 1..1000 rows. */
export interface BatchProxiesBody {
  rows: BatchProxyRow[]
}

/** FEAT-027 §10 — result of one batch row. Never carries a password (`hostPort` only, `host:port`). */
export interface BatchProxyRowResult {
  line: number
  label: string | null
  hostPort: string | null
  status: 'ok' | 'skip' | 'fail'
  id?: string
  error?: string
}

/** FEAT-027 §10 — `POST /proxies/batch` 201 body. */
export interface BatchProxiesResponse {
  ok: number
  skip: number
  fail: number
  rows: BatchProxyRowResult[]
}
