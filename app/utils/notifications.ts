import type { NotificationLevel, NotificationView } from '#shared/types/notifications'

/** FEAT-095 — the level → icon / colour map shared by the row, the bell and the toast (spec "UI behaviour") */
const LEVEL_ICON: Record<NotificationLevel, string> = {
  success: 'i-lucide-circle-check',
  error: 'i-lucide-circle-x',
  warning: 'i-lucide-triangle-alert',
  info: 'i-lucide-info'
}

export function levelIcon(level: NotificationLevel): string {
  return LEVEL_ICON[level] ?? LEVEL_ICON.info
}

/** text colour class for the level icon */
const LEVEL_CLASS: Record<NotificationLevel, string> = {
  success: 'text-success',
  error: 'text-error',
  warning: 'text-warning',
  info: 'text-info'
}

export function levelIconClass(level: NotificationLevel): string {
  return LEVEL_CLASS[level] ?? LEVEL_CLASS.info
}

/** "2 นาที" / "1 ชม." / "เมื่อวาน 18:12" / "3 วัน" — compact Thai relative time for a row (spec "UI behaviour") */
export function notificationTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diffMs = now.getTime() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return 'เมื่อสักครู่'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min} นาที`
  const hr = Math.round(min / 60)
  if (hr < 24 && d.getDate() === now.getDate()) return `${hr} ชม.`
  const dayLabel = dayGroupIndex(d, now)
  if (dayLabel === 1) {
    return `เมื่อวาน ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }
  const days = Math.round(diffMs / 86_400_000)
  if (days < 7) return `${days} วัน`
  return formatDayLabel(d)
}

const THAI_MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

/** `d MMM` in Thai, e.g. `2 พ.ย.` */
export function formatDayLabel(d: Date): string {
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]}`
}

/** 0 = today, 1 = yesterday, 2+ = older (by calendar day, local time) */
function dayGroupIndex(d: Date, now: Date): number {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  return Math.round((b - a) / 86_400_000)
}

/** the day label a row is grouped under: "วันนี้" · "เมื่อวาน" · "d MMM" (spec "UI behaviour") */
export function notificationDayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const idx = dayGroupIndex(d, now)
  if (idx <= 0) return 'วันนี้'
  if (idx === 1) return 'เมื่อวาน'
  return formatDayLabel(d)
}

export interface NotificationDayGroup {
  label: string
  items: NotificationView[]
}

/** group an already-sorted (newest first) list into day buckets, preserving order */
export function groupByDay(list: NotificationView[], now: Date = new Date()): NotificationDayGroup[] {
  const groups: NotificationDayGroup[] = []
  for (const n of list) {
    const label = notificationDayLabel(n.createdAt, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(n)
    else groups.push({ label, items: [n] })
  }
  return groups
}
