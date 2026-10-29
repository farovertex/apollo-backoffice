/**
 * `GET /workspaces` (`{ count, workspaces }`) / `GET /workspaces/:id` / `PATCH /workspaces/:id/ad-group-guard` view
 * (apollo-api `toWorkspaceView`). FEAT-086 (api-contract v1 §3.1) appends `adGroupGuard`, the per-currency rule map
 * of the ad group guard (`{}` when none).
 */
import type { WorkspaceAdGroupGuardMap } from './ad-group-guard'

export interface WorkspaceView {
  id: string
  name: string
  ownerAdminId: string
  country: string | null
  contact: string | null
  status: 'active' | 'archived'
  /** the caller's level in this workspace; `null` for a GOD without a permission row */
  level?: 'owner' | 'member' | null
  createdAt: string
  updatedAt: string
  /** FEAT-086 — always present on the new view; readers still default a missing key to `{}` */
  adGroupGuard: WorkspaceAdGroupGuardMap
}

export interface WorkspacesResponse {
  count: number
  workspaces: WorkspaceView[]
}
