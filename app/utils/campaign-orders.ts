/**
 * FEAT-016 — presentation helpers shared by `/launch-ads`, `/orders` and `/orders/[id]`
 * (api-contract.md v1 §6 views, §7 order status, §8 BO surfaces).
 * Status labels and colours are page chrome (the API serves the codes); amounts are always formatted
 * `#,##0.00 <currency>` with a fixed grouping, plus ` / day` for a daily budget, so the number a test
 * reads never depends on the browser locale.
 */
import type { AdGroupBudget } from '#shared/types/ad-group-templates'
import type { BuildCounts, BuildStatus, OrderStatus } from '#shared/types/campaign-orders'

export type StatusColor = 'neutral' | 'primary' | 'info' | 'success' | 'warning' | 'error'

export interface StatusBadge {
  label: string
  color: StatusColor
}

export const ORDER_STATUS_BADGE: Record<OrderStatus, StatusBadge> = {
  queued: { label: 'Queued', color: 'neutral' },
  running: { label: 'Running', color: 'info' },
  done: { label: 'Done', color: 'success' },
  partialFailed: { label: 'Partial', color: 'warning' },
  failed: { label: 'Failed', color: 'error' },
  cancelled: { label: 'Cancelled', color: 'neutral' }
}

export const BUILD_STATUS_BADGE: Record<BuildStatus, StatusBadge> = {
  queued: { label: 'Queued', color: 'neutral' },
  running: { label: 'Running', color: 'info' },
  ready: { label: 'Ready', color: 'primary' },
  published: { label: 'Published', color: 'success' },
  failed: { label: 'Failed', color: 'error' },
  cancelled: { label: 'Cancelled', color: 'neutral' }
}

export function orderStatusBadge(status: OrderStatus | string): StatusBadge {
  return (ORDER_STATUS_BADGE as Record<string, StatusBadge>)[status] ?? { label: status, color: 'neutral' }
}

export function buildStatusBadge(status: BuildStatus | string): StatusBadge {
  return (BUILD_STATUS_BADGE as Record<string, StatusBadge>)[status] ?? { label: status, color: 'neutral' }
}

/** the build statuses in lifecycle order — used by the summary text and the segmented bar */
export const BUILD_STATUS_ORDER: BuildStatus[] = ['queued', 'running', 'ready', 'published', 'failed', 'cancelled']

/** background class per build status (segmented bar) */
export const BUILD_STATUS_BAR: Record<BuildStatus, string> = {
  queued: 'bg-elevated',
  running: 'bg-info',
  ready: 'bg-primary',
  published: 'bg-success',
  failed: 'bg-error',
  cancelled: 'bg-accented'
}

function counts(source: BuildCounts | null | undefined): BuildCounts {
  return {
    queued: source?.queued ?? 0,
    running: source?.running ?? 0,
    ready: source?.ready ?? 0,
    published: source?.published ?? 0,
    failed: source?.failed ?? 0,
    cancelled: source?.cancelled ?? 0
  }
}

/** total number of builds of an order */
export function buildTotal(source: BuildCounts | null | undefined): number {
  const c = counts(source)
  return BUILD_STATUS_ORDER.reduce((sum, status) => sum + c[status], 0)
}

/** `3 published · 1 running · 1 failed` — only the non-zero counts, in lifecycle order; `—` when there is none */
export function buildSummaryText(source: BuildCounts | null | undefined): string {
  const c = counts(source)
  const parts = BUILD_STATUS_ORDER
    .filter(status => c[status] > 0)
    .map(status => `${c[status]} ${buildStatusBadge(status).label.toLowerCase()}`)
  return parts.length > 0 ? parts.join(' · ') : '—'
}

/** the segments of the progress bar: one per non-zero status with its share in percent */
export function buildSegments(
  source: BuildCounts | null | undefined
): { status: BuildStatus, count: number, percent: number, class: string }[] {
  const c = counts(source)
  const total = buildTotal(source)
  if (total === 0) return []
  return BUILD_STATUS_ORDER
    .filter(status => c[status] > 0)
    .map(status => ({
      status,
      count: c[status],
      percent: (c[status] / total) * 100,
      class: BUILD_STATUS_BAR[status]
    }))
}

/** `#,##0.00 THB` (+ ` / day` when the budget is a daily one) */
export function formatBudgetAmount(amount: number, budget: AdGroupBudget | null | undefined): string {
  const text = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0)
  const currency = budget?.currency ?? 'THB'
  return `${text} ${currency}${budget?.type === 'daily' ? ' / day' : ''}`
}

/** budget cap of an order = `budget.amount × copies × accounts` (human decision 8) */
export function budgetCap(budget: AdGroupBudget | null | undefined, copies: number, accounts: number): number {
  return (budget?.amount ?? 0) * copies * accounts
}

/** `#,##0.00 THB / day` for the whole order — the text of `la-confirm-cap` and of the detail summary */
export function formatBudgetCap(budget: AdGroupBudget | null | undefined, copies: number, accounts: number): string {
  return formatBudgetAmount(budgetCap(budget, copies, accounts), budget)
}
