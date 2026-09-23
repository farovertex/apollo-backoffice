/**
 * FEAT-009 — the client-side list layer of `/admins` as a pure function, plus the password generator.
 *
 * The admin list is small (< 200 rows, human decision), so search / role / status / sort run in the browser on
 * the rows `GET /admins` returned. Keeping them here (instead of inside the page) makes the rules unit-testable
 * and lets a later server-side version replace the call site only.
 */

import type { AdminRole } from '#shared/types/auth'
import type { AdminListItem, AdminStatus } from '#shared/types/admins'

export const ADMIN_ROLES: AdminRole[] = ['GOD', 'Admin', 'Payment']
export const ADMIN_STATUSES: AdminStatus[] = ['active', 'banned', 'deleted']

/** sentinel of the "All" option of the role / status selects */
export const ALL = 'all'

export type AdminRoleFilter = typeof ALL | AdminRole
export type AdminStatusFilter = typeof ALL | AdminStatus

export type AdminSortKey
  = 'username' | 'displayName' | 'status' | 'homeWorkspace' | 'sharedWorkspaceCount' | 'lastLoginAt' | 'createdAt'

export type SortDirection = 'asc' | 'desc'

export interface AdminSort {
  key: AdminSortKey
  direction: SortDirection
}

export interface AdminListQuery {
  /** free text, matched case-insensitively against username and display name */
  search: string
  role: AdminRoleFilter
  status: AdminStatusFilter
  sort: AdminSort
}

/** newest first — the human's default */
export const ADMIN_DEFAULT_SORT: AdminSort = { key: 'createdAt', direction: 'desc' }

/** direction a column starts with when it becomes the sort key (dates newest first, everything else A→Z / 0→9) */
export function defaultSortDirection(key: AdminSortKey): SortDirection {
  return key === 'createdAt' || key === 'lastLoginAt' ? 'desc' : 'asc'
}

/** clicking a header: a new column starts at its default direction, the active one flips */
export function nextAdminSort(current: AdminSort, key: AdminSortKey): AdminSort {
  if (current.key !== key) return { key, direction: defaultSortDirection(key) }
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
}

/** the `aria-sort` value of a header */
export function ariaSortOf(sort: AdminSort, key: AdminSortKey): 'ascending' | 'descending' | 'none' {
  if (sort.key !== key) return 'none'
  return sort.direction === 'asc' ? 'ascending' : 'descending'
}

/** true while at least one client-side filter narrows the list (the Show deleted switch is a request, not a filter) */
export function hasAdminFilter(query: Pick<AdminListQuery, 'search' | 'role' | 'status'>): boolean {
  return query.search.trim() !== '' || query.role !== ALL || query.status !== ALL
}

function timeOf(iso: string | null): number {
  if (!iso) return 0
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? 0 : ms
}

/** deterministic, locale-independent comparison of two sort values (`localeCompare` would depend on the runtime) */
function compare(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  const sa = String(a)
  const sb = String(b)
  if (sa < sb) return -1
  if (sa > sb) return 1
  return 0
}

function sortValue(admin: AdminListItem, key: AdminSortKey): string | number {
  switch (key) {
    case 'username': return admin.username.toLowerCase()
    case 'displayName': return admin.displayName.toLowerCase()
    // 'active' < 'banned' < 'deleted' alphabetically — which is also the order a GOD expects
    case 'status': return admin.status
    case 'homeWorkspace': return (admin.homeWorkspace?.name ?? '').toLowerCase()
    case 'sharedWorkspaceCount': return admin.sharedWorkspaceCount
    case 'lastLoginAt': return timeOf(admin.lastLoginAt)
    case 'createdAt': return timeOf(admin.createdAt)
  }
}

/**
 * `(rows, query) → rows`: search (username OR display name, case-insensitive), role (the role is in `roles`),
 * status (the derived status), then the sort. `id` breaks ties so the order never depends on `Array.sort` stability.
 */
export function filterSortAdmins(rows: AdminListItem[], query: AdminListQuery): AdminListItem[] {
  const needle = query.search.trim().toLowerCase()

  const filtered = rows.filter((admin) => {
    if (needle
      && !admin.username.toLowerCase().includes(needle)
      && !admin.displayName.toLowerCase().includes(needle)) {
      return false
    }
    if (query.role !== ALL && !admin.roles.includes(query.role)) return false
    if (query.status !== ALL && admin.status !== query.status) return false
    return true
  })

  const factor = query.sort.direction === 'asc' ? 1 : -1
  return filtered.sort((a, b) => {
    const diff = compare(sortValue(a, query.sort.key), sortValue(b, query.sort.key))
    return diff !== 0 ? diff * factor : compare(a.id, b.id)
  })
}

/** `4 admins` / `1 of 4 admins` — the count line of the page header */
export function adminCountLabel(shown: number, total: number, filtered: boolean): string {
  const noun = total === 1 ? 'admin' : 'admins'
  return filtered ? `${shown} of ${total} ${noun}` : `${total} ${noun}`
}

const PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
/** largest multiple of 62 below 256 — bytes above it are rejected so every character stays equally likely */
const REJECT_FROM = 248

/**
 * A 16-character `[A-Za-z0-9]` password from `crypto.getRandomValues` (no `Math.random`), generated in the
 * browser and sent once in the create / reset body. Never logged, never put in a toast or a URL.
 */
export function generatePassword(length = 16): string {
  const out: string[] = []
  const buffer = new Uint8Array(length * 2)
  while (out.length < length) {
    crypto.getRandomValues(buffer)
    for (const byte of buffer) {
      if (out.length >= length) break
      if (byte >= REJECT_FROM) continue
      out.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]!)
    }
  }
  return out.join('')
}
