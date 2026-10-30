/**
 * FEAT-086 — ad group guard (api-contract.md v1 §1 shared shapes, §2 settings, §3 workspace map, §6.3 build
 * snapshot). One rule shape for every layer: the workspace (per currency), the TikTok account, the order. After a
 * build is published the kpi worker pauses each of its **ad groups** whose lifetime metrics satisfy the rule.
 * FEAT-087 — the rule is an expression tree (metric catalog · operators · and/or · nested groups).
 *
 * Every number is in the account / advertiser currency (no FX).
 */

/** FEAT-087 §1.1 — the metric catalog keys (display order = `AGG_METRICS` in `app/utils/ad-group-guard.ts`) */
export type AdGroupGuardMetricKey
  = | 'spend' | 'cpm' | 'conversions' | 'conversionCost' | 'cpc' | 'ctr' | 'impressions' | 'clicks'

/** FEAT-087 §1.1 — operators; `between` is inclusive `value ≤ v ≤ value2` */
export type AdGroupGuardOp = 'gt' | 'gte' | 'lt' | 'lte' | 'between'

/** FEAT-087 §1.1 — how the items of a group join (required in requests) */
export type AdGroupGuardCombine = 'or' | 'and'

/** FEAT-087 §1.1 — one condition; `value2` present ⇔ `op === 'between'` (and then `value2 > value`) */
export interface AdGroupGuardCondition {
  metric: AdGroupGuardMetricKey
  op: AdGroupGuardOp
  value: number
  value2?: number
}

/** FEAT-087 §1.1 — a group (`items.length ≥ 1`, nested ≤ 4 levels, ≤ 20 conditions in the whole tree) */
export interface AdGroupGuardGroup {
  combine: AdGroupGuardCombine
  items: AdGroupGuardNode[]
}

export type AdGroupGuardNode = AdGroupGuardCondition | AdGroupGuardGroup

/** FEAT-087 §1.1 — the rule is an expression tree whose root is a group */
export type AdGroupGuardRule = AdGroupGuardGroup

/** §1.3 — layer mode of the account and the order */
export type AdGroupGuardMode = 'inherit' | 'custom' | 'off'

/** §1.2 — which layer decided; with `rule: null`, `order` / `account` = switched off there, `none` = nothing applies */
export type AdGroupGuardSource = 'order' | 'account' | 'workspace' | 'none'

/** §1.2 — the resolved rule of one account / advertiser */
export interface AdGroupGuardEffective {
  rule: AdGroupGuardRule | null
  source: AdGroupGuardSource
  /** `null` = the currency is not known yet → never guarded (`source: 'none'`) */
  currency: string | null
}

/** §2 — `GET`/`PATCH /settings/ad-group-guard` 200 body (GOD only) */
export interface AdGroupGuardSettings {
  enabled: boolean
  /** ISO | null — null on a fresh db */
  updatedAt: string | null
}

/** §2 — `PATCH /settings/ad-group-guard` body (strict) */
export interface AdGroupGuardSettingsBody {
  enabled: boolean
}

/** §3.1 — one entry of `workspace.adGroupGuard[CUR]` */
export interface WorkspaceAdGroupGuardEntry {
  /** `false` = kept but inert */
  enabled: boolean
  rule: AdGroupGuardRule
  updatedBy: string | null
  updatedAt: string | null
}

/** §3.1 — keyed by 3 upper-case letters; `{}` when the workspace has no rule */
export type WorkspaceAdGroupGuardMap = Record<string, WorkspaceAdGroupGuardEntry>

/** §3.2 — `PATCH /workspaces/:id/ad-group-guard` body: ≥ 1 key; `null` removes that currency */
export type WorkspaceAdGroupGuardBody = Record<string, { enabled: boolean, rule: AdGroupGuardRule } | null>

/** §4.2 — the account's own layer (view) */
export interface AccountAdGroupGuard {
  mode: AdGroupGuardMode
  rule: AdGroupGuardRule | null
  updatedAt: string | null
}

/** §4.1 / §6.1 — request block of the account PATCH and the order POST; `rule` only with `custom` */
export type AdGroupGuardLayerBody
  = | { mode: 'custom', rule: AdGroupGuardRule }
    | { mode: 'inherit' | 'off' }

/** §6.2 — the order's own layer (view) */
export interface OrderAdGroupGuard {
  mode: AdGroupGuardMode
  rule: AdGroupGuardRule | null
}

/** §6.3 — build-level state: `off` (rule null) · `watching` · `done` (every group paused/failed, or campaign gone) */
export type BuildAdGroupGuardState = 'off' | 'watching' | 'done'

/** §6.3 — per ad group state */
export type BuildAdGroupGuardGroupState = 'watching' | 'queued' | 'paused' | 'failed'

/** FEAT-087 §6.3 — the lifetime numbers the hook decided on (account currency), 9 keys; rates `null` when the divisor is 0 */
export interface AdGroupGuardMetrics {
  spend: number | null
  impressions: number | null
  clicks: number | null
  cpm: number | null
  cpc: number | null
  ctr: number | null
  conversions: number | null
  conversionCost: number | null
  /** ISO — `now` of the kpi round that decided */
  asOf: string
}

/** §6.3 — one `adGroups[]` entry */
export interface BuildAdGroupGuardGroup {
  tiktokAdGroupId: string
  /** may be `''` (fallback `…<last 4 of id>` in the BO) */
  name: string
  state: BuildAdGroupGuardGroupState
  jobId: string | null
  requestedAt: string | null
  finishedAt: string | null
  /** Thai, shown verbatim; set when `failed` */
  reason: string | null
  /** `null` while `watching` */
  metrics: AdGroupGuardMetrics | null
  /** FEAT-087 — paths of the conditions that were true at decision time (`'0'`, `'1.0'`); `null` while `watching` */
  hits: string[] | null
}

/** §6.3 — the **snapshot** taken at order create (never re-resolved, kept by a retry); `null` for older builds */
export interface BuildAdGroupGuard {
  rule: AdGroupGuardRule | null
  source: AdGroupGuardSource
  currency: string | null
  state: BuildAdGroupGuardState
  adGroups: BuildAdGroupGuardGroup[]
}
