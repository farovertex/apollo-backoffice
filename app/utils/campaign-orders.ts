/**
 * FEAT-016 — presentation helpers shared by `/launch-ads`, `/orders` and `/orders/[id]`
 * (api-contract.md v1 §6 views, §7 order status, §8 BO surfaces).
 * Status labels and colours are page chrome (the API serves the codes); amounts are always formatted
 * `#,##0.00 <currency>` with a fixed grouping, plus ` / day` for a daily budget, so the number a test
 * reads never depends on the browser locale.
 */
import type { AdGroupBudget, BudgetStrategy } from '#shared/types/ad-group-templates'
import type { AdGroupGuardRule, AdGroupGuardSource } from '#shared/types/ad-group-guard'
import type { BuildCounts, BuildPauseState, BuildStatus, OrderAdGroupGuardSummary, OrderStatus } from '#shared/types/campaign-orders'
import { adGroupGuardSourceLabel, formatAdGroupGuardRule } from '~/utils/ad-group-guard'

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

/** FEAT-066 (spec "UI behaviour") — `builds.pause.state` → `od-build-pause` text/color */
export const BUILD_PAUSE_BADGE: Record<BuildPauseState, StatusBadge> = {
  waitingKpi: { label: 'รอปิด campaign', color: 'neutral' },
  queued: { label: 'กำลังปิด campaign…', color: 'warning' },
  done: { label: 'ปิด campaign แล้ว', color: 'success' },
  failed: { label: 'ปิด campaign ไม่สำเร็จ', color: 'error' }
}

export function buildPauseBadge(state: BuildPauseState | string): StatusBadge {
  return (BUILD_PAUSE_BADGE as Record<string, StatusBadge>)[state] ?? { label: state, color: 'neutral' }
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

/**
 * `#,##0.00 THB` (+ ` / day` when the budget is a daily one). FEAT-083 — the currency is printed as stored; a budget
 * without one shows `?` (never a guessed `THB`).
 */
export function formatBudgetAmount(
  amount: number,
  budget: { type?: AdGroupBudget['type'] | string | null, currency?: string | null } | null | undefined
): string {
  const text = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(amount) ? amount : 0)
  const currency = budget?.currency || '?'
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

/**
 * The part of an ad-group config (template `config` or order `adGroupConfig` snapshot) that decides the cap.
 * `campaign` is optional/loose because a v2 snapshot (before FEAT-061) has no campaign section at all.
 */
export interface CapSource {
  budget?: AdGroupBudget | null
  campaign?: { budgetStrategy?: BudgetStrategy | null, budget?: AdGroupBudget | null } | null
}

/**
 * TASK-theme-cbo-cap — which budget the cap is built from and how many times it is counted per account.
 * Under **CBO** the campaign budget is shared by every ad group of the campaign, so the cap is
 * `campaign.budget.amount × accounts` (one campaign per account; the copies do not multiply it). Under the
 * ad-group strategy (and for a v2 snapshot without `campaign`) it stays `budget.amount × copies × accounts`.
 */
export function capBasis(source: CapSource | null | undefined, copies: number): { budget: AdGroupBudget | null, copies: number, cbo: boolean } {
  const campaign = source?.campaign
  if (campaign?.budgetStrategy === 'cbo' && campaign.budget) {
    return { budget: campaign.budget, copies: 1, cbo: true }
  }
  return { budget: source?.budget ?? null, copies, cbo: false }
}

/** `formatBudgetCap` driven by `capBasis` — the one text of `la-confirm-cap` and `od-cap` */
export function formatOrderCap(source: CapSource | null | undefined, copies: number, accounts: number): string {
  const basis = capBasis(source, copies)
  return formatBudgetCap(basis.budget, basis.copies, accounts)
}

/**
 * TASK-orders-post-guard — `app/pages/orders/index.vue` `ord-guard` cell, derived from one order's
 * `adGroupGuardSummary` so the template stays thin and this is unit-testable on its own.
 */
export interface OrderGuardCell {
  /** `ord-guard`'s `data-state` */
  state: 'none' | 'off' | 'watching' | 'done'
  /** `ord-guard-rule` text; `null` only when `state === 'none'` */
  ruleText: string | null
  /** the first `rules[]` entry has `rule: null` (switched off at `order`/`account`) — muted, no badge */
  ruleMuted: boolean
  /** `ord-guard-source` badge text; `null` when `ruleMuted` or `state === 'none'` */
  sourceBadge: string | null
  /** `ord-guard-more` count; `0` hides it */
  moreCount: number
  /** `title` of `ord-guard-more`; `null` when `moreCount === 0` */
  moreTitle: string | null
  /** `ord-guard-counts` text; `null` hides the line */
  countsText: string | null
}

function isNoGuardRule(entry: { rule: AdGroupGuardRule | null, source: AdGroupGuardSource }): boolean {
  return entry.rule === null && entry.source === 'none'
}

/** order of the `adGroups` counts line (api-contract key order, also `BuildAdGroupGuardGroupState`) */
const GUARD_COUNT_LABEL: { key: keyof OrderAdGroupGuardSummary['adGroups'], label: string }[] = [
  { key: 'watching', label: 'เฝ้า' },
  { key: 'queued', label: 'สั่งปิด' },
  { key: 'paused', label: 'ปิดแล้ว' },
  { key: 'failed', label: 'ล้มเหลว' }
]

const GUARD_CELL_NONE: OrderGuardCell = {
  state: 'none',
  ruleText: null,
  ruleMuted: false,
  sourceBadge: null,
  moreCount: 0,
  moreTitle: null,
  countsText: null
}

/** api-contract spec §2 "กฎปิด ad group" cell — `null`/absent summary or an all-`none` `rules[]` renders `—`. */
export function orderGuardCell(summary: OrderAdGroupGuardSummary | null | undefined): OrderGuardCell {
  const rules = summary?.rules ?? []
  if (!summary || rules.length === 0 || rules.every(isNoGuardRule)) return GUARD_CELL_NONE

  const first = rules[0]!
  const ruleBearing = rules.filter(r => r.rule !== null)
  const moreCount = ruleBearing.length > 1 ? ruleBearing.length - 1 : 0
  const moreTitle = moreCount > 0
    ? ruleBearing.slice(1).map(r => formatAdGroupGuardRule(r.rule!, r.currency)).join('\n')
    : null

  const ruleMuted = first.rule === null
  const ruleText = ruleMuted
    ? adGroupGuardSourceLabel(first.source, false)
    : formatAdGroupGuardRule(first.rule!, first.currency)
  const sourceBadge = ruleMuted ? null : adGroupGuardSourceLabel(first.source, true)

  const { states, adGroups } = summary
  const state: OrderGuardCell['state'] = states.watching === 0 && states.done > 0
    ? 'done'
    : states.watching > 0
      ? 'watching'
      : 'off'

  const countsText = GUARD_COUNT_LABEL
    .filter(({ key }) => adGroups[key] > 0)
    .map(({ key, label }) => `${label} ${adGroups[key]}`)
    .join(' · ') || null

  return { state, ruleText, ruleMuted, sourceBadge, moreCount, moreTitle, countsText }
}
