/**
 * FEAT-101 M6 (AC-39, contract §4.7, design "Analytics · <site>") — pure helpers of the per-site Analytics panel:
 * range labels, Thai action labels, the change against the previous period and the summary sentence.
 */
import type { MssgAnalyticsData, MssgAnalyticsItem, MssgAnalyticsRange } from '#shared/types/mssg-sites'

export const MSSG_ANALYTICS_RANGES: { value: MssgAnalyticsRange, label: string, period: string, previous: string }[] = [
  { value: 'day', label: 'วันนี้', period: 'วันนี้', previous: 'เมื่อวาน' },
  { value: 'week', label: '7 วัน', period: '7 วันที่ผ่านมา', previous: 'สัปดาห์ก่อน' },
  { value: 'month', label: '30 วัน', period: '30 วันที่ผ่านมา', previous: 'เดือนก่อน' }
]

export const MSSG_ANALYTICS_TEXT = {
  empty: 'ยังไม่มีตัวเลข · กดดึงสถิติล่าสุด',
  refresh: 'ดึงสถิติล่าสุด',
  detail: 'ดูตัวเลขละเอียด',
  visits: 'คนเข้าเว็บ',
  clicks: 'คนกดลิงก์หรือปุ่ม',
  rate: 'อัตราการกด',
  buttons: 'ปุ่มที่ถูกกด',
  noButtons: 'ยังไม่มีใครกดลิงก์หรือปุ่มในช่วงนี้',
  neverRead: 'ยังไม่เคยดึง',
  loadFailed: 'โหลดตัวเลขสถิติไม่สำเร็จ ลองใหม่อีกครั้ง',
  requestFailed: 'ดึงสถิติไม่สำเร็จ ลองใหม่อีกครั้ง'
} as const

export function mssgAnalyticsRange(r: MssgAnalyticsRange) {
  return MSSG_ANALYTICS_RANGES.find(x => x.value === r) ?? MSSG_ANALYTICS_RANGES[1]!
}

/** an action that counts as a click ("คนกดลิงก์หรือปุ่ม" — every action ending in `.click`) */
export function mssgIsClickAction(action: string): boolean {
  return action.endsWith('.click')
}

/** the five actions of the real app, in display order (contract §4.7); unknown actions follow */
export const MSSG_ANALYTICS_ACTIONS = ['page.view', 'link.click', 'messenger.click', 'internal.click', 'menu.click'] as const

/** Thai label of an action as a group heading ("คนเข้าเว็บ" for page views); unknown actions keep the raw name */
export function mssgAnalyticsGroupLabel(action: string): string {
  switch (action) {
    case 'page.view': return 'คนเข้าเว็บ'
    case 'link.click': return 'คลิกลิงก์'
    case 'messenger.click': return 'คลิกปุ่มแชท'
    case 'internal.click': return 'คลิกลิงก์ภายในเว็บ'
    case 'menu.click': return 'คลิกเมนู'
    default: return `${mssgIsClickAction(action) ? 'คลิก' : 'การกระทำ'} ${action}`
  }
}

/** Thai label of one detail row; unknown actions get a generic label that still shows the raw action name */
export function mssgAnalyticsActionLabel(item: Pick<MssgAnalyticsItem, 'action' | 'label'>): string {
  if (item.action === 'page.view') return `เข้าหน้า ${item.label}`.trim()
  return mssgAnalyticsGroupLabel(item.action)
}

export interface MssgAnalyticsGroup {
  action: string
  label: string
  /** from `current.byAction`, else the sum of the rows */
  total: number
  rows: MssgAnalyticsItem[]
}

/** the detail rows grouped by action: the five known ones in a fixed order, then unknown ones; empty groups omitted */
export function mssgAnalyticsGroups(data: MssgAnalyticsData): MssgAnalyticsGroup[] {
  const actions: string[] = [...MSSG_ANALYTICS_ACTIONS]
  for (const i of data.current.items) if (!actions.includes(i.action)) actions.push(i.action)
  return actions.flatMap((action) => {
    const rows = data.current.items.filter(i => i.action === action).sort((a, b) => b.value - a.value)
    if (!rows.length) return []
    const total = data.current.byAction.find(x => x.action === action)?.value ?? rows.reduce((n, r) => n + r.value, 0)
    return [{ action, label: mssgAnalyticsGroupLabel(action), total, rows }]
  })
}

/** the rows of "ปุ่มที่ถูกกด": click items, largest first */
export function mssgAnalyticsButtons(data: MssgAnalyticsData): MssgAnalyticsItem[] {
  return data.current.items.filter(i => mssgIsClickAction(i.action)).sort((a, b) => b.value - a.value)
}

export type MssgTrend = 'up' | 'down' | 'flat'

export interface MssgDelta {
  trend: MssgTrend
  /** absolute change, in the unit of the card (people, people, percentage points) */
  diff: number
  text: string
}

/**
 * "▲ มากกว่าสัปดาห์ก่อน 20 ครั้ง (15%)" · "▼ น้อยกว่า…" · "เท่ากับ…". The share of the previous value is added when the
 * previous period had a non-zero value (`withPct`); the rate card compares percentage points and has none.
 */
export function mssgDelta(current: number, previous: number, previousLabel: string, unit: string, opts: { digits?: number, withPct?: boolean } = {}): MssgDelta {
  const digits = opts.digits ?? 0
  const k = 10 ** digits
  const diff = Math.round((current - previous) * k) / k
  if (diff === 0) return { trend: 'flat', diff: 0, text: `เท่ากับ${previousLabel}` }
  const n = Math.abs(diff).toLocaleString('th-TH', { maximumFractionDigits: digits })
  const pct = opts.withPct && previous > 0 ? ` (${Math.round(Math.abs(current - previous) / previous * 100).toLocaleString('th-TH')}%)` : ''
  return diff > 0
    ? { trend: 'up', diff, text: `▲ มากกว่า${previousLabel} ${n} ${unit}${pct}` }
    : { trend: 'down', diff, text: `▼ น้อยกว่า${previousLabel} ${n} ${unit}${pct}` }
}

/** 0.25 → 25 · 0.3077 → 30.8 (one decimal, trailing .0 dropped) */
export function mssgPercent(rate: number): number {
  return Math.round(rate * 1000) / 10
}

export function mssgPercentText(rate: number): string {
  return `${mssgPercent(rate).toLocaleString('th-TH', { maximumFractionDigits: 1 })}%`
}

/** "7 วันที่ผ่านมา มีคนเข้าเว็บ 120 ครั้ง และกดลิงก์หรือปุ่ม 30 ครั้ง (25%)" */
export function mssgAnalyticsSummary(range: MssgAnalyticsRange, data: MssgAnalyticsData): string {
  const { visits, clicks, clickRate } = data.current
  const period = mssgAnalyticsRange(range).period
  if (!visits && !clicks) return `${period} ยังไม่มีคนเข้าเว็บ`
  return `${period} มีคนเข้าเว็บ ${visits.toLocaleString('th-TH')} ครั้ง และกดลิงก์หรือปุ่ม ${clicks.toLocaleString('th-TH')} ครั้ง (${mssgPercentText(clickRate)})`
}

/** `2026-11-06` → `6 พ.ย.` for the range line */
export function mssgAnalyticsDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ymd
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
