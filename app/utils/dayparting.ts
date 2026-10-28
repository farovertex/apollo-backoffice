/**
 * TASK-adgroup-dayparting — pure helpers of the ad-group template's week grid.
 *
 * `config.daypartingSchedule` is `{ mon: [{ from: '09:00', to: '12:00' }], … }`; the grid works on one boolean
 * per cell (`cellsPerDay = 24 * 60 / granularity`, 48 for 30 min). The pair `rangesToCells` / `cellsToRanges`
 * converts between them; `cellsToRanges` emits sorted, merged, non-overlapping ranges on the granularity
 * boundary with `'24:00'` as the last end — exactly the shape the API accepts.
 * Nothing here knows a day label or a granularity: both come from `GET /ad-group-templates/options`.
 */
import type { DaypartingRange, DaypartingSchedule } from '#shared/types/ad-group-templates'

/** day key → one boolean per cell */
export type DaypartingCells = Record<string, boolean[]>

export const DEFAULT_GRANULARITY_MINUTES = 30

export function cellsPerDay(granularity: number): number {
  return Math.floor((24 * 60) / granularity)
}

/** minutes since midnight → `HH:MM` (1440 → `24:00`) */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** `HH:MM` → minutes since midnight, `null` when it is not a time */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes > 24 * 60 ? null : minutes
}

export function emptyCells(days: readonly string[], granularity: number): DaypartingCells {
  const size = cellsPerDay(granularity)
  return Object.fromEntries(days.map(day => [day, Array.from({ length: size }, () => false)]))
}

/** ranges → cells; a range that is off the grid is rounded outwards-to-nothing (start up, end down), never throws */
export function rangesToCells(
  schedule: Partial<Record<string, DaypartingRange[]>> | null | undefined,
  days: readonly string[],
  granularity: number
): DaypartingCells {
  const cells = emptyCells(days, granularity)
  const size = cellsPerDay(granularity)
  for (const day of days) {
    for (const range of schedule?.[day] ?? []) {
      const from = timeToMinutes(range.from)
      const to = timeToMinutes(range.to)
      if (from === null || to === null) continue
      const start = Math.ceil(from / granularity)
      const end = Math.min(size, Math.floor(to / granularity))
      for (let i = start; i < end; i++) cells[day]![i] = true
    }
  }
  return cells
}

/** cells → sorted, merged ranges for every day in `days` (an unpainted day → `[]`) */
export function cellsToRanges(
  cells: DaypartingCells,
  days: readonly string[],
  granularity: number
): Record<string, DaypartingRange[]> {
  const out: Record<string, DaypartingRange[]> = {}
  for (const day of days) {
    const row = cells[day] ?? []
    const ranges: DaypartingRange[] = []
    let start = -1
    for (let i = 0; i <= row.length; i++) {
      const on = i < row.length && row[i] === true
      if (on && start === -1) start = i
      if (!on && start !== -1) {
        ranges.push({ from: minutesToTime(start * granularity), to: minutesToTime(i * granularity) })
        start = -1
      }
    }
    out[day] = ranges
  }
  return out
}

/** the schedule the API wants (`null` is the caller's call: it sends `null` while the radio is `allDay`) */
export function cellsToSchedule(cells: DaypartingCells, days: readonly string[], granularity: number): DaypartingSchedule {
  return cellsToRanges(cells, days, granularity) as DaypartingSchedule
}

export function countRanges(schedule: Partial<Record<string, DaypartingRange[]>> | null | undefined): number {
  return Object.values(schedule ?? {}).reduce((sum, ranges) => sum + (ranges?.length ?? 0), 0)
}

/** `09:00–12:00, 18:00–22:30` or `''` for a day without a range */
export function formatRanges(ranges: readonly DaypartingRange[]): string {
  return ranges.map(range => `${range.from}–${range.to}`).join(', ')
}

export function cellsEqual(a: DaypartingCells, b: DaypartingCells, days: readonly string[]): boolean {
  return days.every((day) => {
    const x = a[day] ?? []
    const y = b[day] ?? []
    return x.length === y.length && x.every((value, i) => value === y[i])
  })
}
