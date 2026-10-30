/**
 * FEAT-031 — `GET /provider-nodes` (apollo-api). Mirrors
 * mission-control/.ai/features/FEAT-031-worker-scaling-by-pm2-instances-per-instance-id-he/api-contract.md v1
 * (§4.1 "ProviderNodeView", §5 "GET /provider-nodes"). Each pm2 worker instance of a node (`WORKER_INSTANCE`,
 * `<NODE_NAME>#<NODE_APP_INSTANCE>`) heartbeats on its own `instances[]` entry; a node is alive when at least one
 * of its instances is alive (`aliveInstances > 0`). Shown as node chips in the `/browser-profiles` footer
 * (`bp-nodes` / `bp-node`, api-contract §7).
 *
 * FEAT-088 (api-contract.md v1 §1/§2/§7) — the view gains `lightSlots` (per-node override, `null` = use env
 * `PROFILE_LIGHT_SLOTS`), `effectiveLightSlots` (the value the dispatcher actually uses) and `humanOpensAllowed`;
 * `maxOpenProfiles` already existed (FEAT-031) and is unchanged. A GOD can write `lightSlots` through
 * `PATCH /provider-nodes/:id` (`UpdateProviderNodeBody` / `UpdateProviderNodeResponse`); the BO sends only
 * `{ lightSlots }` (contract §7) even though the body type also allows `humanOpensAllowed` / `maxOpenProfiles`.
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

/** api-contract §4.1 "ProviderNodeView" — exactly 15 keys (FEAT-031) + 3 (FEAT-088 §1: `lightSlots`,
 * `effectiveLightSlots`, `humanOpensAllowed`; `maxOpenProfiles` already counted below). */
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
  /** FEAT-088 §1 — stored per-node override; `null` = use env `PROFILE_LIGHT_SLOTS` */
  lightSlots: number | null
  /** FEAT-088 §1 — `lightSlots ?? env.PROFILE_LIGHT_SLOTS` of the answering process */
  effectiveLightSlots: number
  /** FEAT-088 §1 — foreign-open close is skipped on this node when true (FEAT-085) */
  humanOpensAllowed: boolean
}

/** `GET /provider-nodes` 200 body (unpaginated, sorted by `name`). */
export interface ProviderNodesResponse {
  count: number
  nodes: ProviderNodeView[]
}

/** FEAT-088 api-contract §2 — `PATCH /provider-nodes/:id` body. All keys optional, at least one required;
 * the BO editor (contract §7) only ever sends `{ lightSlots }`. */
export interface UpdateProviderNodeBody {
  lightSlots?: number | null
  humanOpensAllowed?: boolean
  maxOpenProfiles?: number
}

/** FEAT-088 api-contract §2 — 200 body: the full node view with the new values. */
export interface UpdateProviderNodeResponse {
  node: ProviderNodeView
}

/** FEAT-088 api-contract §2 — error body: 400 is the standard zod envelope (`issues`), 403/404/401 carry a text
 * in `error` only. Only 400 carries `issues`. */
export interface UpdateProviderNodeErrorBody {
  error: string
  /** 400 only — zod issues; the first message is the one the editor shows inline */
  issues?: { path: string, message: string }[]
}
