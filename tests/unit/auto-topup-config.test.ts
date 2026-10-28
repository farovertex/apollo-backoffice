/**
 * FEAT-075 (api-contract v1 §1.1/§3, spec "UI behaviour" → accounts list) — the per-account auto top-up rule as
 * the BO reads it: `accountAutoTopupConfig()` (mirror of the API's `effectiveAutoTopupConfig()`),
 * `accountAutoTopupChannel()`, the chip text `accountAutoTopupLabel()` and the two card helpers of the Edit
 * modal's select. Pure helpers of `app/utils/topup.ts`, imported by relative path like `topup-min.test.ts`
 * (no Nuxt runtime, so `formatInt` is imported explicitly inside that module).
 */
import { describe, expect, it } from 'vitest'
import {
  accountAutoTopupChannel,
  accountAutoTopupConfig,
  accountAutoTopupLabel,
  autoTopupCardLabel,
  isAutoTopupCard
} from '../../app/utils/topup'
import type { PaymentCardView } from '../../shared/types/payment-cards'
import type { AccountAutoTopupConfig } from '../../shared/types/tiktok-accounts'

const CARD: AccountAutoTopupConfig['card'] = { cardId: 'card_1', brand: 'visa', last4: '1234', expiry: '10/29' }

function config(over: Partial<AccountAutoTopupConfig> = {}): AccountAutoTopupConfig {
  return {
    enabled: false,
    channel: 'qr',
    cardId: null,
    minBalance: null,
    amount: null,
    card: null,
    updatedBy: null,
    updatedAt: null,
    ...over
  }
}

describe('accountAutoTopupConfig', () => {
  it('a row without the block is off, with the legacy autoTopupChannel as its channel', () => {
    expect(accountAutoTopupConfig(null)).toEqual({
      enabled: false, channel: 'qr', cardId: null, minBalance: null, amount: null, card: null
    })
    expect(accountAutoTopupConfig({}).channel).toBe('qr')
    expect(accountAutoTopupConfig({ autoTopupChannel: 'card' }).channel).toBe('card')
    expect(accountAutoTopupConfig({ autoTopupChannel: 'card' }).enabled).toBe(false)
  })

  it('the block wins over the legacy key', () => {
    const state = accountAutoTopupConfig({
      autoTopupChannel: 'card',
      autoTopupConfig: config({ enabled: true, channel: 'qr', minBalance: 500, amount: 2000 })
    })
    expect(state).toEqual({ enabled: true, channel: 'qr', cardId: null, minBalance: 500, amount: 2000, card: null })
  })

  it('numbers that are not finite (hand-written Mongo) read as null, like the API reader', () => {
    const state = accountAutoTopupConfig({
      autoTopupConfig: config({ enabled: true, minBalance: Number.NaN, amount: Number.POSITIVE_INFINITY })
    })
    expect(state.minBalance).toBeNull()
    expect(state.amount).toBeNull()
  })

  it('accountAutoTopupChannel reads through the block', () => {
    expect(accountAutoTopupChannel(undefined)).toBe('qr')
    expect(accountAutoTopupChannel({ autoTopupConfig: config({ channel: 'card' }) })).toBe('card')
    // the block is the authority even when the legacy key still says something else
    expect(accountAutoTopupChannel({ autoTopupChannel: 'card', autoTopupConfig: config() })).toBe('qr')
  })
})

describe('accountAutoTopupLabel (chip ta-auto-config)', () => {
  it('off → Auto: ปิด, whatever else the block holds', () => {
    expect(accountAutoTopupLabel(null)).toBe('Auto: ปิด')
    expect(accountAutoTopupLabel({ autoTopupChannel: 'card', balanceCurrency: 'USD' })).toBe('Auto: ปิด')
    expect(accountAutoTopupLabel({
      balanceCurrency: 'THB',
      autoTopupConfig: config({ minBalance: 500, amount: 2000 })
    })).toBe('Auto: ปิด')
  })

  it('QR on a THB account', () => {
    expect(accountAutoTopupLabel({
      balanceCurrency: 'THB',
      autoTopupConfig: config({ enabled: true, channel: 'qr', minBalance: 500, amount: 2000 })
    })).toBe('Auto: QR 500/2,000 THB')
  })

  it('card on a USD account carries the mask of the card the API resolved', () => {
    expect(accountAutoTopupLabel({
      balanceCurrency: 'USD',
      autoTopupConfig: config({ enabled: true, channel: 'card', cardId: 'card_1', minBalance: 500, amount: 2000, card: CARD })
    })).toBe('Auto: บัตร ****1234 500/2,000 USD')
  })

  it('a null number reads `?`, an unknown currency is simply omitted', () => {
    expect(accountAutoTopupLabel({
      balanceCurrency: null,
      autoTopupConfig: config({ enabled: true, channel: 'qr', minBalance: 500, amount: null })
    })).toBe('Auto: QR 500/?')
    expect(accountAutoTopupLabel({
      balanceCurrency: 'THB',
      autoTopupConfig: config({ enabled: true, channel: 'card', minBalance: null, amount: null })
    })).toBe('Auto: บัตร ?/? THB')
  })
})

describe('isAutoTopupCard / autoTopupCardLabel', () => {
  const now = new Date('2026-10-28T00:00:00.000Z')

  function card(over: Partial<PaymentCardView> = {}): PaymentCardView {
    return {
      cardId: 'card_1',
      brand: 'visa',
      last4: '4242',
      expiryMonth: 10,
      expiryYear: 2029,
      expiry: '10/29',
      holderName: 'A B',
      isDefault: false,
      requireCvv: null,
      status: 'bound',
      createdAt: '2026-01-01T00:00:00.000Z',
      boundAt: null,
      lastUsedAt: null,
      lastError: null,
      ...over
    }
  }

  it('pending and bound are usable, expired and removed are not', () => {
    expect(isAutoTopupCard(card({ status: 'pending' }), now)).toBe(true)
    expect(isAutoTopupCard(card({ status: 'bound' }), now)).toBe(true)
    expect(isAutoTopupCard(card({ status: 'expired' }), now)).toBe(false)
    expect(isAutoTopupCard(card({ status: 'removed' }), now)).toBe(false)
  })

  it('a past MM/YY is not usable, the current month still is', () => {
    expect(isAutoTopupCard(card({ expiryMonth: 9, expiryYear: 2026, expiry: '09/26' }), now)).toBe(false)
    expect(isAutoTopupCard(card({ expiryMonth: 10, expiryYear: 2026, expiry: '10/26' }), now)).toBe(true)
  })

  it('without usable MM/YY numbers the `MM/YY` string decides', () => {
    expect(isAutoTopupCard(card({ expiryMonth: 0, expiryYear: 0, expiry: '10/29' }), now)).toBe(true)
    expect(isAutoTopupCard(card({ expiryMonth: 0, expiryYear: 0, expiry: '01/20' }), now)).toBe(false)
    expect(isAutoTopupCard(card({ expiryMonth: 0, expiryYear: 0, expiry: '' }), now)).toBe(false)
  })

  it('label', () => {
    expect(autoTopupCardLabel(CARD)).toBe('Visa ****1234 (10/29)')
    expect(autoTopupCardLabel({ brand: 'mastercard', last4: '9706', expiry: '' })).toBe('Mastercard ****9706')
    expect(autoTopupCardLabel(null)).toBe('บัตร ****????')
  })
})
