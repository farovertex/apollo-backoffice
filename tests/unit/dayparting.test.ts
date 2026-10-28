/**
 * TASK-adgroup-dayparting — `app/utils/dayparting.ts` (ranges ↔ cells of the week grid). `pnpm test:unit`.
 */
import { describe, expect, it } from 'vitest'
import {
  cellsPerDay, cellsToRanges, countRanges, emptyCells, formatRanges, rangesToCells, timeToMinutes
} from '../../app/utils/dayparting'

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

describe('dayparting cells', () => {
  it('has 48 cells at 30 minutes and 24 at 60', () => {
    expect(cellsPerDay(30)).toBe(48)
    expect(cellsPerDay(60)).toBe(24)
  })

  it('round-trips ranges on the boundary, including 24:00', () => {
    const schedule = Object.fromEntries(DAYS.map(d => [d, []])) as Record<string, { from: string, to: string }[]>
    schedule.mon = [{ from: '09:00', to: '12:00' }, { from: '18:00', to: '22:30' }]
    schedule.sat = [{ from: '10:00', to: '24:00' }]
    const cells = rangesToCells(schedule, DAYS, 30)
    expect(cells.mon!.filter(Boolean)).toHaveLength(6 + 9)
    expect(cells.sat![47]).toBe(true)
    expect(cellsToRanges(cells, DAYS, 30)).toEqual(schedule)
  })

  it('merges adjacent cells and keeps ranges sorted', () => {
    const cells = emptyCells(DAYS, 30)
    for (const i of [20, 18, 19, 4]) cells.tue![i] = true
    expect(cellsToRanges(cells, DAYS, 30).tue).toEqual([
      { from: '02:00', to: '02:30' },
      { from: '09:00', to: '10:30' }
    ])
  })

  it('merges overlapping / touching input ranges', () => {
    const cells = rangesToCells({ mon: [{ from: '09:00', to: '11:00' }, { from: '10:00', to: '12:00' }] }, DAYS, 30)
    expect(cellsToRanges(cells, DAYS, 30).mon).toEqual([{ from: '09:00', to: '12:00' }])
  })

  it('works at 60 minutes', () => {
    const cells = rangesToCells({ fri: [{ from: '09:00', to: '12:00' }] }, DAYS, 60)
    expect(cells.fri!.filter(Boolean)).toHaveLength(3)
    expect(cellsToRanges(cells, DAYS, 60).fri).toEqual([{ from: '09:00', to: '12:00' }])
  })

  it('reads null / missing days as empty and ignores garbage times', () => {
    expect(cellsToRanges(rangesToCells(null, DAYS, 30), DAYS, 30).mon).toEqual([])
    expect(timeToMinutes('25:00')).toBeNull()
    expect(timeToMinutes('nope')).toBeNull()
    expect(countRanges({ mon: [{ from: '01:00', to: '02:00' }], tue: [] })).toBe(1)
  })

  it('formats a day', () => {
    expect(formatRanges([{ from: '09:00', to: '12:00' }, { from: '18:00', to: '22:30' }])).toBe('09:00–12:00, 18:00–22:30')
  })
})
