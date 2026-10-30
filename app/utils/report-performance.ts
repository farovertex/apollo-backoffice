/**
 * FEAT-069 — helpers shared by `/reports/performance` and `/reports/dashboard` (api-contract.md v1 §6).
 *
 * - `perfStateBadge()` — the one badge map of `PerfAccountState` (both pages' account tables).
 * - The five value ratios, computed **in the BO** from the API's own sums (to-the-mars `utmMetrics`):
 *   Cost/Reg, Cost/Dep, Avg deposit, Dep/Reg % (`ftdConversionPct`) and Dep/Budget % (`depPerBudgetPct`, the
 *   same ×100 percent as `/reports/utm` — TASK-dep-budget-pct 2026-10-30, before that a plain ratio printed
 *   with 2 decimals). Every divisor that is 0 / null / not finite → `null` → `—`.
 * - Funnel step % (dashboard): `next / prev × 100`, `null` when `prev` is 0.
 * - Small shared pieces of the two pages: URL parsing of `workspaceId`, Thai date of a row, the account name.
 */
import type { PerfAccountRef, PerfAccountState } from '#shared/types/report-performance'

export const PERF_STATE_BADGE: Record<PerfAccountState, { label: string, color: ReportColor }> = {
  banned: { label: 'ถูกระงับ', color: 'error' },
  needsHuman: { label: 'ต้องมีคน', color: 'warning' },
  loggedOut: { label: 'หลุด login', color: 'warning' },
  notDelivering: { label: 'ไม่ส่ง', color: 'warning' },
  launching: { label: 'กำลังยิง', color: 'success' },
  idle: { label: 'ปกติ', color: 'neutral' }
}

export function perfStateBadge(state: PerfAccountState | string): { label: string, color: ReportColor } {
  return (PERF_STATE_BADGE as Record<string, { label: string, color: ReportColor }>)[state]
    ?? { label: state, color: 'neutral' }
}

function ratio(numerator: number | null | undefined, divisor: number | null | undefined): number | null {
  if (typeof numerator !== 'number' || !Number.isFinite(numerator)) return null
  if (typeof divisor !== 'number' || !Number.isFinite(divisor) || divisor === 0) return null
  return numerator / divisor
}

/** the inputs of the five ratios — `spend` may be null (a UTM key no ad carries) */
export interface PerfRatioInput {
  spend: number | null
  registers: number
  depositors: number
  depositAmount: number
}

export interface PerfRatios {
  costPerRegister: number | null
  costPerDeposit: number | null
  averageDeposit: number | null
  /** percent points */
  depRegPct: number | null
  /** percent points (`depositAmount / spend × 100`), printed with `formatPercent` */
  depPerBudget: number | null
}

export function perfRatios(input: PerfRatioInput | null | undefined): PerfRatios {
  if (!input) {
    return { costPerRegister: null, costPerDeposit: null, averageDeposit: null, depRegPct: null, depPerBudget: null }
  }
  return {
    costPerRegister: ratio(input.spend, input.registers),
    costPerDeposit: ratio(input.spend, input.depositors),
    averageDeposit: ratio(input.depositAmount, input.depositors),
    depRegPct: ftdConversionPct(input.depositors, input.registers),
    depPerBudget: depPerBudgetPct(input.depositAmount, input.spend)
  }
}

/** one funnel step's share of the previous step, in percent points; `null` when the previous is 0 */
export function funnelStepPct(next: number | null | undefined, prev: number | null | undefined): number | null {
  const r = ratio(next, prev)
  return r === null ? null : r * 100
}

/**
 * `?workspaceId=` — a plain id token is kept and sent; the API is the authority on its shape (a non-ObjectId
 * answers 400 `issues[0].path = 'workspaceId'`, an unknown one 404, both shown as `<p>-error`).
 */
export function parseWorkspaceId(query: Record<string, unknown>): string {
  const value = typeof query.workspaceId === 'string' ? query.workspaceId.trim() : ''
  return /^[\w-]{1,64}$/.test(value) ? value : ''
}

/** label → loginEmail → id → `—` */
export function perfAccountName(account: PerfAccountRef | { label?: string | null, loginEmail?: string | null, id?: string } | null | undefined): string {
  if (!account) return REPORT_DASH
  return account.label || account.loginEmail || account.id || REPORT_DASH
}

/** "อัปเดต HH:MM · รีเฟรชเองทุก 5 นาที" */
export function perfUpdatedText(lastLoadedAt: number | null): string {
  const clock = lastLoadedAt === null ? REPORT_DASH : formatClock(new Date(lastLoadedAt).toISOString())
  return `อัปเดต ${clock} · รีเฟรชเองทุก 5 นาที`
}

/** client-side sort of a table column: numbers / strings, nulls always last */
export function perfCompare(a: number | string | null | undefined, b: number | string | null | undefined, dir: 1 | -1): number {
  const aNull = a === null || a === undefined || (typeof a === 'number' && !Number.isFinite(a))
  const bNull = b === null || b === undefined || (typeof b === 'number' && !Number.isFinite(b))
  if (aNull && bNull) return 0
  if (aNull) return 1
  if (bNull) return -1
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir
  return String(a).localeCompare(String(b)) * dir
}

/** `aria-sort` of a header */
export function perfAriaSort(active: boolean, dir: 1 | -1): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none'
  return dir === 1 ? 'ascending' : 'descending'
}
