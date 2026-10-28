/**
 * FEAT-076 — prefixes as an entity (mission-control/.ai/features/FEAT-076-…/api-contract.md v1 §1.2, §2, §3, §5.3).
 *
 * A prefix used to be a plain string inside `system_settings.utm.prefixes` (FEAT-038). It is now a row of the
 * `prefixes` collection with a display name, the admins who manage it, a status and a Telegram slot (filled by a
 * later feature). The `code` is immutable (it is part of live UTM hosts) and there is no delete — only archive.
 * The prefix is **routing only**: it never changes who may see or touch an account.
 */

export type PrefixStatus = 'active' | 'archived'

/** `prefix` of the account view (§5.5) — the join, `null` when the account has no prefix */
export interface PrefixRef {
  id: string
  code: string
  name: string | null
  status: PrefixStatus
}

/** one managing admin, in `adminIds` order; ids whose admin row is gone are omitted by the API */
export interface PrefixAdminRef {
  id: string
  displayName: string
}

/** Telegram routing slot — always "not linked" in FEAT-076 */
export interface PrefixTelegramView {
  linked: boolean
  chatTitle: string | null
  /** ISO | null */
  failedAt: string | null
}

/** `PrefixView` — exactly these 11 keys (§1.2) */
export interface PrefixView {
  id: string
  code: string
  name: string | null
  status: PrefixStatus
  adminIds: string[]
  admins: PrefixAdminRef[]
  /** accounts bound to this prefix over **all** workspaces (A4) */
  accountCount: number
  telegram: PrefixTelegramView
  /** `null` = migrated from `system_settings.utm.prefixes` */
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

/** one account of `GET /prefixes/:id` (scoped by the caller's workspaces, A3) */
export interface PrefixDetailAccount {
  id: string
  label: string | null
  loginEmail: string
  workspaceId: string
  workspaceName: string | null
}

/** `GET /prefixes/:id` 200 */
export interface PrefixDetailView extends PrefixView {
  accounts: PrefixDetailAccount[]
}

/** `?status=` of `GET /prefixes` — `active` is the API default (A7) */
export type PrefixesStatusQuery = PrefixStatus | 'all'

/** `GET /prefixes` 200 — sorted `createdAt` asc; GOD = every row, Admin / Payment = the rows they manage */
export interface PrefixesResponse {
  count: number
  prefixes: PrefixView[]
}

/** `POST /prefixes` body (GOD, strict) — `name` omitted when blank, `adminIds` omitted when empty (§7) */
export interface CreatePrefixBody {
  code: string
  name?: string
  adminIds?: string[]
}

/** `PATCH /prefixes/:id` body (GOD, strict, ≥ 1 key) — the BO sends only the changed keys */
export interface PatchPrefixBody {
  /** `null` / `''` clears it */
  name?: string | null
  adminIds?: string[]
  status?: PrefixStatus
}

/** `POST /tiktok-accounts/prefix-bulk` body (GOD) — `prefixId: null` detaches */
export interface PrefixBulkBody {
  /** 1..500 after dedupe */
  accountIds: string[]
  prefixId: string | null
}

export interface PrefixBulkSkipped {
  id: string
  reason: 'notFound' | 'unchanged'
}

/** `POST /tiktok-accounts/prefix-bulk` 200 */
export interface PrefixBulkResult {
  updated: number
  skipped: PrefixBulkSkipped[]
}
