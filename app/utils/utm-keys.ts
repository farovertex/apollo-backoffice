/**
 * FEAT-099 — day helpers of the UTM key timeline. Days are `YYYY-MM-DD` strings in Asia/Bangkok (the API's
 * `UTM_TIMEZONE`); they are only ever moved with UTC calendar arithmetic on the string's own parts, never through
 * a local-time `Date`, so a day cannot slip by one in the browser's timezone.
 */
import type { UtmKeyReleaseReason, UtmKeyView } from '#shared/types/utm-keys'

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `day` shifted by `delta` calendar days (`YYYY-MM-DD` in, `YYYY-MM-DD` out; anything else is returned as is) */
export function shiftDay(day: string, delta: number): string {
  const m = DAY_RE.exec(day)
  if (!m) return day
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + delta))
  return t.toISOString().slice(0, 10)
}

export interface UtmTimelineRow {
  name: string
  from: string
  /** last day of the window, `null` for the open (newest) entry */
  to: string | null
  deleted: boolean
}

export const DELETED_ADMIN_TEXT = 'แอดมินที่ถูกลบ'

/** the timeline newest first; an entry ends the day before the next entry's `from` */
export function timelineRows(key: Pick<UtmKeyView, 'owners'> | null): UtmTimelineRow[] {
  const owners = key?.owners ?? []
  return owners
    .map((entry, i) => ({
      name: entry.admin?.displayName ?? DELETED_ADMIN_TEXT,
      from: entry.from,
      to: i + 1 < owners.length ? shiftDay(owners[i + 1]!.from, -1) : null,
      deleted: entry.admin === null
    }))
    .reverse()
}

export const RELEASE_REASON_TEXT: Record<UtmKeyReleaseReason, string> = {
  manual: 'ปล่อยด้วยมือ',
  prefixRemoved: 'ถูกถอดจาก prefix',
  adminDeleted: 'แอดมินถูกลบ'
}
