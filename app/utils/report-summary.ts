/**
 * FEAT-035 — client-side sorting of table 1 (`rs-groups`, api-contract.md §3 `rs-gsort-<field>`). Table 1 is
 * never paginated (AS-3), so the whole grouped set is already on the client and sorting it is pure JS; table 2
 * (`rs-ads`) is paginated and therefore sorts server-side instead (`sort` query, AS-9).
 *
 * A pure, readable helper on purpose: no test runner lives in the BO (brief T2), so this is meant to be
 * verified by reading plus the Playwright loop, not by a unit test.
 */
import type { GroupedAccount, GroupSortField } from '#shared/types/report-summary'
import type { KpiMetrics } from '#shared/types/reports'

export const GROUP_SORT_FIELDS: GroupSortField[] = [
  'adCount', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'conversions', 'conversionCost'
]

const DEFAULT_GROUP_SORT = '-spend'

/** `-impressions` → `{ field: 'impressions', desc: true }`; an unknown/missing field falls back to `-spend`. */
export function parseGroupSort(value: string | null | undefined): { field: GroupSortField, desc: boolean } {
  const raw = value || DEFAULT_GROUP_SORT
  const desc = raw.startsWith('-')
  const field = (desc ? raw.slice(1) : raw) as GroupSortField
  if (!GROUP_SORT_FIELDS.includes(field)) return { field: 'spend', desc: true }
  return { field, desc }
}

/** First click on a new column = descending (every table-1 field is a metric, there is no name column). */
export function toggleGroupSort(current: string, field: GroupSortField): string {
  const { field: currentField, desc } = parseGroupSort(current)
  if (currentField === field) return desc ? field : `-${field}`
  return `-${field}`
}

function fieldValue(item: { adCount: number, metrics: KpiMetrics }, field: GroupSortField): number | null {
  if (field === 'adCount') return item.adCount
  return item.metrics[field]
}

/** `null` last whichever direction; a string tie-break with `null` sorting after every real string. */
function compareNullableString(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return a < b ? -1 : 1
}

function compareRows<T extends { adCount: number, metrics: KpiMetrics }>(
  a: T,
  b: T,
  field: GroupSortField,
  desc: boolean,
  label: (item: T) => string | null,
  id: (item: T) => string
): number {
  const av = fieldValue(a, field)
  const bv = fieldValue(b, field)
  if (av === null || bv === null) {
    if (av === bv) return compareNullableString(label(a), label(b)) || id(a).localeCompare(id(b))
    return av === null ? 1 : -1 // null always last, both directions
  }
  if (av !== bv) return desc ? bv - av : av - bv
  const byLabel = compareNullableString(label(a), label(b))
  if (byLabel !== 0) return byLabel
  return id(a).localeCompare(id(b))
}

/**
 * Sorts the account rows by `sort` and, inside each account, its advertiser rows by the same key
 * (api-contract.md §3 `rs-gsort-<field>`, spec AC-11). Returns new arrays; never mutates the input.
 */
export function sortGroups(accounts: GroupedAccount[], sort: string): GroupedAccount[] {
  const { field, desc } = parseGroupSort(sort)
  return [...accounts]
    .sort((a, b) => compareRows(a, b, field, desc, item => item.account.label, item => item.account.id))
    .map(account => ({
      ...account,
      advertisers: [...account.advertisers].sort(
        (a, b) => compareRows(a, b, field, desc, item => item.advertiser.name, item => item.advertiser.id)
      )
    }))
}
