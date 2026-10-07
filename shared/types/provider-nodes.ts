/**
 * FEAT-031 — `GET /provider-nodes` (apollo-api). Mirrors
 * mission-control/.ai/features/FEAT-031-worker-scaling-by-pm2-instances-per-instance-id-he/api-contract.md v1
 * (§4.1 "ProviderNodeView", §5 "GET /provider-nodes"). Each pm2 worker instance of a node (`WORKER_INSTANCE`,
 * `<NODE_NAME>#<NODE_APP_INSTANCE>`) heartbeats on its own `instances[]` entry; a node is alive when at least one
 * of its instances is alive (`aliveInstances > 0`). Shown as node chips in the `/browser-profiles` footer
 * (`bp-nodes` / `bp-node`, api-contract §7).
 */

/** api-contract §4.1 instance item — exactly 5 keys. */
export interface ProviderNodeInstanceView {
  /** WORKER_INSTANCE, e.g. `node-a#0` */
  id: string
  pid: number
  startedAt: string
  lastHeartbeatAt: string
  alive: boolean
}

/** api-contract §4.1 "ProviderNodeView" — exactly 15 keys. */
export interface ProviderNodeView {
  id: string
  name: string
  status: 'active' | 'draining' | 'offline'
  /** `aliveInstances > 0`, computed with the server clock */
  alive: boolean
  instanceCount: number
  aliveInstances: number
  /** sorted by `id` */
  instances: ProviderNodeInstanceView[]
  lastHeartbeatAt: string | null
  ratePerSec: number
  maxOpenProfiles: number
  idleCloseMs: number
  lastSyncedAt: string | null
  lastSyncError: string | null
  createdAt: string
  updatedAt: string
}

/** `GET /provider-nodes` 200 body (unpaginated, sorted by `name`). */
export interface ProviderNodesResponse {
  count: number
  nodes: ProviderNodeView[]
}
