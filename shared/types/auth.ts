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
