/**
 * FEAT-009 — `/admins` (apollo-api, functions 0.2 / 0.3 / 0.4 / 0.5 + soft delete). Mirrors
 * mission-control/.ai/features/FEAT-009-admin-management/api-contract.md v1
 * (`toAdminView()`, `GET /admins[?includeDeleted]`, `GET /admins/:id/workspaces`, `POST /admins`,
 * `PATCH /admins/:id`, `POST /admins/:id/reset-password`, `DELETE /admins/:id`,
 * `POST /workspaces/:id/share`, `DELETE /workspaces/:id/share/:adminId`).
 *
 * A plaintext password only ever travels inside `CreateAdminBody.password` / `ResetPasswordBody.newPassword`
 * — it is never stored, logged, toasted or put in a URL.
 */

import type { AdminRole } from './auth'

/** Derived on the API: `deletedAt ? 'deleted' : isActive ? 'active' : 'banned'`. */
export type AdminStatus = 'active' | 'banned' | 'deleted'

/** `toAdminView()` — what `POST /admins` and `PATCH /admins/:id` answer with. */
export interface AdminView {
  id: string
  username: string
  displayName: string
  roles: AdminRole[]
  homeWorkspaceId: string | null
  isActive: boolean
  /** ISO string once the admin was soft-deleted, `null` otherwise */
  deletedAt: string | null
  status: AdminStatus
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

/** `{ id, name }` of the admin's own workspace; `null` when the workspace document is missing. */
export interface AdminHomeWorkspace {
  id: string
  name: string
}

/** One row of `GET /admins` (and of `GET /admins/:id`) — the view plus the two enriched keys. */
export interface AdminListItem extends AdminView {
  homeWorkspace: AdminHomeWorkspace | null
  /** number of PERMISSIONS rows with level `member` for this admin */
  sharedWorkspaceCount: number
}

/** `GET /admins` → 200 */
export interface AdminsResponse {
  count: number
  admins: AdminListItem[]
}

/** The target admin's PERMISSIONS level for a workspace; `null` = no grant. */
export type WorkspaceAccessLevel = 'owner' | 'member'

export type WorkspaceStatus = 'active' | 'archived'

export interface AdminWorkspaceOwner {
  id: string
  username: string
  displayName: string
}

/** One row of `GET /admins/:id/workspaces` (every workspace in the system, GOD scope). */
export interface AdminWorkspaceRow {
  id: string
  name: string
  status: WorkspaceStatus
  /** `null` only if the owner document is missing (defensive) */
  owner: AdminWorkspaceOwner | null
  level: WorkspaceAccessLevel | null
}

/** `GET /admins/:id/workspaces` → 200 */
export interface AdminWorkspacesResponse {
  count: number
  workspaces: AdminWorkspaceRow[]
}

/** `DELETE /admins/:id` → 200 (idempotent soft delete) */
export interface DeleteAdminResponse {
  ok: boolean
  deletedAt: string
  revokedWorkspaceIds: string[]
  revokedSessions: number
}

/** `POST /admins` body — no `passwordConfirm`, the confirm field never leaves the browser. */
export interface CreateAdminBody {
  username: string
  password: string
  displayName: string
  roles: AdminRole[]
}

/** `PATCH /admins/:id` body — only the changed keys are sent; `reason` only next to another key. */
export interface UpdateAdminBody {
  displayName?: string
  roles?: AdminRole[]
  isActive?: boolean
  reason?: string
}

/** `POST /admins/:id/reset-password` body → 204 */
export interface ResetPasswordBody {
  newPassword: string
}

/** `POST /workspaces/:id/share` body */
export interface ShareWorkspaceBody {
  adminId: string
}
