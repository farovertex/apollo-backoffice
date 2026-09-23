/**
 * FEAT-006 — `/proxies` (apollo-api, function 2.9). Mirrors
 * mission-control/.ai/features/FEAT-006-browser-profile-create-per-admin-defaults-and-prox/api-contract.md v1
 * ("Proxy view", `GET/POST/PATCH/DELETE /proxies`).
 * `password` is plaintext by human decision (same as TIKTOK_ACCOUNTS.password): the BO masks it, offers show/copy,
 * and never logs / screenshots it.
 */

export type ProxyType = 'http' | 'https' | 'socks5'

/** counts of rows pointing at this proxy — shown in the delete confirmation */
export interface ProxyUsage {
  /** browserProfileDefaults rows (admins using it as their default) */
  defaults: number
  /** browserProfiles rows created with it */
  profiles: number
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
