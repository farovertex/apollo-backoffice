/**
 * TASK-adgroup-dayparting — `app/utils/dayparting.ts` (ranges ↔ cells of the week grid). `pnpm test:unit`.
 * FEAT-074 — added the exact AC-8 fixture (Mon 18…23 + 36…44, Sat 20…39) so the grid's own submit case is covered
 * here, not only through the component.
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

  // FEAT-074 AC-8: Mon cells 18…23 + 36…44 painted, Sat cells 20…39 painted → the exact submit body shape,
  // a run that reaches cell 47 ends with `to: '24:00'`, and the round-trip back to cells is 35 painted cells.
  it('AC-8: Mon 18…23 + 36…44 and Sat 20…39 → the exact schedule shape', () => {
    const cells = emptyCells(DAYS, 30)
    for (let i = 18; i <= 23; i++) cells.mon![i] = true
    for (let i = 36; i <= 44; i++) cells.mon![i] = true
    for (let i = 20; i <= 39; i++) cells.sat![i] = true
    const schedule = cellsToRanges(cells, DAYS, 30)
    expect(schedule.mon).toEqual([{ from: '09:00', to: '12:00' }, { from: '18:00', to: '22:30' }])
    expect(schedule.sat).toEqual([{ from: '10:00', to: '20:00' }])
    expect(schedule.tue).toEqual([])
    expect(countRanges(schedule)).toBe(3)

    const painted = DAYS.reduce((sum, day) => sum + cells[day]!.filter(Boolean).length, 0)
    expect(painted).toBe(35)

    // round-trip: ranges → cells reproduces the exact same 35 painted cells
    expect(rangesToCells(schedule, DAYS, 30)).toEqual(cells)
  })

  it('AC-8: a run that reaches the last cell (index 47) ends with to: 24:00', () => {
    const cells = emptyCells(DAYS, 30)
    for (let i = 44; i <= 47; i++) cells.sun![i] = true
    expect(cellsToRanges(cells, DAYS, 30).sun).toEqual([{ from: '22:00', to: '24:00' }])
  })
})
