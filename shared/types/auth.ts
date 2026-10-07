/** Types shared by the Nitro side (server/) and the app (app/). Mirrors apollo-api src/auth (auth.types.ts, toAdminView()). */

export type AdminRole = 'GOD' | 'Admin' | 'Payment'

/** Admin as exposed to the browser and stored in the sealed session cookie — a subset of the API's toAdminView(). */
export interface AuthAdmin {
  id: string
  username: string
  displayName: string
  roles: AdminRole[]
  homeWorkspaceId: string | null
}

/** GET /auth/me (apollo-api AuthContext) */
export interface AuthContext {
  adminId: string
  roles: AdminRole[]
  homeWorkspaceId: string
  workspaceIds: string[]
}

/**
 * FEAT-033 — `GET`/`PATCH /auth/me/preferences` 200 (api-contract §6).
 * Per-admin personal settings; every key is always present (the API fills the defaults in), so an admin
 * document written before the feature reads as `{ topupQrSound: false }`. Deliberately **not** part of
 * `AuthAdmin` / `AuthContext`: the session cookie is never refreshed after a PATCH (spec F3).
 */
export interface AdminPreferences {
  /** play `/sounds/topup-sound.mp3` on the `/topups` page when a round gets its QR (`readyToPay`) */
  topupQrSound: boolean
}

/** PATCH /auth/me/preferences body — only the keys to change (strict on the API: an unknown key is a 400) */
export interface AdminPreferencesBody {
  topupQrSound?: boolean
}

/** apollo-api error body: `{ error }`, plus `issues` for zod 400s */
export interface ApiErrorBody {
  error: string
  issues?: { path: string, message: string }[]
}

/** GET /api/auth/me → 200 */
export interface MeResponse {
  admin: AuthAdmin | null
  context: AuthContext
}

/** POST /api/auth/login → 200 (the API token never leaves the server) */
export interface LoginResponse {
  admin: AuthAdmin
}
