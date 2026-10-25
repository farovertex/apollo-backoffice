/**
 * TASK-utm-ratios — `depPerBudgetPct` / `ftdConversionPct` of `app/utils/reports.ts`, the two browser-derived
 * columns of `/reports/utm` (DEP/BUD, FTD CONVERSION). Same formulas as to-the-mars `web/lib/utm-report.ts`
 * (`utmMetrics`: `depPerBudget = deposit_amount / spend`, `depRegPct = depositors / registers × 100`), both
 * expressed as percent points here. Imported by relative path like `utm.test.ts` (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import { depPerBudgetPct, formatPercent, ftdConversionPct } from '../../app/utils/reports'

describe('depPerBudgetPct (DEP/BUD)', () => {
  it('deposit / spend × 100 — the to-the-mars test row 13577 / 7400 as a percent', () => {
    expect(depPerBudgetPct(13577, 7400)).toBeCloseTo((13577 / 7400) * 100, 10)
    expect(formatPercent(depPerBudgetPct(13577, 7400))).toBe('183.47%')
  })

  it('null when the key has no ads (spend null)', () => {
    expect(depPerBudgetPct(500, null)).toBeNull()
  })

  it('null when spend is 0 — never Infinity', () => {
    expect(depPerBudgetPct(700, 0)).toBeNull()
    expect(depPerBudgetPct(0, 0)).toBeNull()
  })

  it('0% when nobody deposited but ads did spend', () => {
    expect(depPerBudgetPct(0, 150)).toBe(0)
    expect(formatPercent(depPerBudgetPct(0, 150))).toBe('0.00%')
  })
})

describe('ftdConversionPct (FTD CONVERSION)', () => {
  it('depositors / registers × 100 — 186 of 225', () => {
    expect(ftdConversionPct(186, 225)).toBeCloseTo((186 / 225) * 100, 10)
    expect(formatPercent(ftdConversionPct(186, 225))).toBe('82.67%')
  })

  it('null when nobody registered', () => {
    expect(ftdConversionPct(0, 0)).toBeNull()
  })

  it('0% when people registered but nobody deposited (a real zero, not —)', () => {
    expect(ftdConversionPct(0, 40)).toBe(0)
    expect(formatPercent(ftdConversionPct(0, 40))).toBe('0.00%')
  })

  it('100% when every register deposited', () => {
    expect(ftdConversionPct(7, 7)).toBe(100)
  })
})
