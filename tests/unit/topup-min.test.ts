/**
 * TASK-topup-min-currency (2026-10-16) — the QR minimum follows the account's currency, same rule as the card
 * channel (`qrMinAmountFor()` in the API). Pure helpers of `app/utils/topup.ts`, imported by relative path like
 * `utm.test.ts` (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import { TOPUP_MIN_AMOUNT, topupAmountError, topupQrMinAmount, topupQrMinFloor, topupQrUnit } from '../../app/utils/topup'
import type { TopupOptionsResponse } from '../../shared/types/topups'

const serverTable: TopupOptionsResponse = {
  qr: { minAmount: 400 },
  card: {
    enabled: true,
    approvalTtlHours: 24,
    limits: {
      USD: { min: 10, maxPerRound: 500, maxPerDay: null, autoAmount: null },
      THB: { min: 400, maxPerRound: 20_000, maxPerDay: null, autoAmount: null }
    },
    account: null
  }
}

describe('topupQrMinAmount', () => {
  it('no options: the currency picks the row of the fallback table, unknown currency = TOPUP_MIN_AMOUNT', () => {
    expect(topupQrMinAmount(null, 'USD')).toBe(10)
    expect(topupQrMinAmount(null, 'usd')).toBe(10)
    expect(topupQrMinAmount(null, 'THB')).toBe(400)
    expect(topupQrMinAmount(null, null)).toBe(TOPUP_MIN_AMOUNT)
    expect(topupQrMinAmount(null, 'EUR')).toBe(TOPUP_MIN_AMOUNT)
  })

  it('server table without an account: the row of that currency wins over the global qr.minAmount', () => {
    expect(topupQrMinAmount(serverTable, 'USD')).toBe(10)
    expect(topupQrMinAmount(serverTable, 'THB')).toBe(400)
    expect(topupQrMinAmount(serverTable, null)).toBe(400)
  })

  it('server answered for the account: qr.minAmount is already per currency and is taken as is', () => {
    const forAccount: TopupOptionsResponse = {
      ...serverTable,
      qr: { minAmount: 10 },
      card: {
        ...serverTable.card,
        account: {
          tiktokAccountId: 'a1',
          currency: 'USD',
          limit: serverTable.card.limits.USD!,
          usedToday: 0,
          remainingToday: null,
          autoTopupChannel: 'qr',
          hasUsableCard: false
        }
      }
    }
    expect(topupQrMinAmount(forAccount, 'USD')).toBe(10)
    // even a stale/mismatching currency prop does not override the server's per-account answer
    expect(topupQrMinAmount(forAccount, 'THB')).toBe(10)
  })
})

describe('topupQrMinFloor / topupQrUnit', () => {
  it('the floor for mixed currencies is the lowest minimum of any row (10 with the default table)', () => {
    expect(topupQrMinFloor()).toBe(10)
    expect(topupQrMinFloor(serverTable)).toBe(10)
  })

  it('THB and unknown keep the historical word บาท, other currencies show their ISO code', () => {
    expect(topupQrUnit('THB')).toBe('บาท')
    expect(topupQrUnit(null)).toBe('บาท')
    expect(topupQrUnit('usd')).toBe('USD')
  })
})

describe('topupAmountError (QR branch)', () => {
  it('one argument = the historical THB rule, byte for byte', () => {
    expect(topupAmountError(399)).toBe('amount ต้องเป็นจำนวนเต็มตั้งแต่ 400 บาท')
    expect(topupAmountError(400)).toBeNull()
  })

  it('with the USD minimum: 9 is refused with the USD wording, 10 passes', () => {
    expect(topupAmountError(9, { qrMin: 10, currency: 'USD' })).toBe('amount ต้องเป็นจำนวนเต็มตั้งแต่ 10 USD')
    expect(topupAmountError(10, { qrMin: 10, currency: 'USD' })).toBeNull()
  })
})
