/**
 * FEAT-083 (spec AC-17) — the order/confirm budget text prints the stored currency and `?` when a budget has none
 * (no guessed `THB` any more). Pure helper of `app/utils/campaign-orders.ts`, imported by relative path.
 */
import { describe, expect, it } from 'vitest'
import { formatBudgetAmount } from '../../app/utils/campaign-orders'

describe('formatBudgetAmount', () => {
  it('prints the stored currency', () => {
    expect(formatBudgetAmount(1, { type: 'daily', amount: 1, currency: 'USD' })).toBe('1.00 USD / day')
    expect(formatBudgetAmount(1500, { type: 'lifetime', amount: 1500, currency: 'THB' })).toBe('1,500.00 THB')
  })

  it('prints ? without a currency', () => {
    expect(formatBudgetAmount(300, null)).toBe('300.00 ?')
    expect(formatBudgetAmount(300, undefined)).toBe('300.00 ?')
    expect(formatBudgetAmount(300, { type: 'daily', currency: null })).toBe('300.00 ? / day')
  })
})
