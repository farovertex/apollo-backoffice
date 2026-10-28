/**
 * FEAT-077 — the Telegram rules of one top-up round (`app/utils/topup.ts`): the gate that hides the pay buttons,
 * the `<prefix>-telegram` line, the badge override and the `แจ้งจาก Telegram` prefix of the check info. A row without
 * the block (or with `telegram: null`) must behave exactly as before.
 */
import { describe, expect, it } from 'vitest'
import {
  topupBadgeColor,
  topupBadgeLabel,
  topupCheckInfo,
  topupInTelegram,
  topupRowActions,
  topupTelegramLine,
  topupTelegramState
} from '../../app/utils/topup'
import type { TopupStatus, TopupTelegram, TopupView } from '../../shared/types/topups'

const PAYMENT = { id: 'pay-1', roles: ['Payment' as const] }

function row(status: TopupStatus, telegram?: Partial<TopupTelegram> | null): TopupView {
  return {
    id: 't1',
    workspaceId: 'w1',
    level: 'account',
    tiktokAccountId: 'a1',
    advertiserId: null,
    advertiser: null,
    account: { id: 'a1', label: 'acc', loginEmail: null, bcOrgName: 'BC' },
    bcOrgId: 'bc',
    amount: 1000,
    currency: 'THB',
    status,
    active: true,
    qrSavedAt: null,
    qrExpiresAt: null,
    payingBy: null,
    payingAt: null,
    payingExpiresAt: null,
    confirmedBy: null,
    confirmedAt: null,
    verifyDeadlineAt: null,
    nextCheckAt: null,
    lastCheckAt: null,
    checkCount: 2,
    paidAt: null,
    balanceAmount: null,
    balanceCurrency: null,
    error: null,
    trigger: 'manual',
    requestedBy: null,
    requestedAt: '2026-10-28T10:00:00.000Z',
    createdAt: '2026-10-28T10:00:00.000Z',
    updatedAt: '2026-10-28T10:00:00.000Z',
    ...(telegram === undefined
      ? {}
      : {
          telegram: telegram === null
            ? null
            : { status: 'pending', chatTitle: 'ทีมจ่าย A', sentAt: null, badge: 'none', paidPressedBy: null, lastError: null, ...telegram }
        })
  }
}

describe('topupTelegramState / topupInTelegram', () => {
  it('missing or null block = none, never in Telegram', () => {
    expect(topupTelegramState(row('readyToPay'))).toBe('none')
    expect(topupTelegramState(row('readyToPay', null))).toBe('none')
    expect(topupInTelegram(row('readyToPay'))).toBe(false)
  })
  it('pending / sent during the QR phase are in Telegram; failed is not', () => {
    expect(topupInTelegram(row('waitingQr', { status: 'pending' }))).toBe(true)
    expect(topupInTelegram(row('readyToPay', { status: 'sent' }))).toBe(true)
    expect(topupInTelegram(row('readyToPay', { status: 'failed' }))).toBe(false)
  })
  it('a finished round is an ordinary row again even though the block still says sent', () => {
    expect(topupInTelegram(row('paid', { status: 'sent', badge: 'paid' }))).toBe(false)
    expect(topupInTelegram(row('notFound', { status: 'sent', badge: 'notFound' }))).toBe(false)
  })
})

describe('topupRowActions', () => {
  it('no buttons at all for a round paid in Telegram', () => {
    const a = topupRowActions(row('readyToPay', { status: 'sent' }), PAYMENT)
    expect(Object.values(a).some(Boolean)).toBe(false)
    expect(Object.values(topupRowActions(row('waitingQr', { status: 'pending' }), PAYMENT)).some(Boolean)).toBe(false)
  })
  it('failed / null / missing → the FEAT-021 buttons', () => {
    expect(topupRowActions(row('readyToPay', { status: 'failed' }), PAYMENT).open).toBe(true)
    expect(topupRowActions(row('readyToPay', null), PAYMENT).open).toBe(true)
    expect(topupRowActions(row('readyToPay'), PAYMENT).open).toBe(true)
  })
  it('"ตรวจอีกครั้ง" stays on a notFound round that was sent to the group', () => {
    const a = topupRowActions(row('notFound', { status: 'sent', badge: 'notFound' }), PAYMENT)
    expect(a.recheck).toBe(true)
    expect(a.pay).toBe(true)
  })
})

describe('topupTelegramLine', () => {
  it('pending', () => {
    expect(topupTelegramLine(row('waitingQr', { status: 'pending' }))).toEqual({
      status: 'pending', title: 'Telegram · ทีมจ่าย A', text: 'รอ QR แล้วจะส่งเข้ากลุ่ม', hint: null
    })
  })
  it('sent carries the local HH:mm of sentAt', () => {
    const sentAt = new Date(2026, 9, 28, 14, 5).toISOString()
    expect(topupTelegramLine(row('readyToPay', { status: 'sent', sentAt }))?.text).toBe('ส่งแล้ว 14:05 · รอจ่ายในกลุ่ม')
  })
  it('failed is the muted line with lastError as hint', () => {
    expect(topupTelegramLine(row('readyToPay', { status: 'failed', lastError: 'permanent 403 bot was kicked' }))).toEqual({
      status: 'failed', title: null, text: 'ส่ง Telegram ไม่สำเร็จ — จ่ายที่นี่', hint: 'permanent 403 bot was kicked'
    })
  })
  it('none without a block, none after the QR phase', () => {
    expect(topupTelegramLine(row('readyToPay'))).toBeNull()
    expect(topupTelegramLine(row('readyToPay', null))).toBeNull()
    expect(topupTelegramLine(row('verifying', { status: 'sent' }))).toBeNull()
  })
  it('unknown chat title reads as a dash', () => {
    expect(topupTelegramLine(row('waitingQr', { status: 'pending', chatTitle: null }))?.title).toBe('Telegram · —')
  })
})

describe('badge + check info', () => {
  it('readyToPay + sent reads รอจ่ายใน Telegram (info); everything else unchanged', () => {
    expect(topupBadgeLabel(row('readyToPay', { status: 'sent' }))).toBe('รอจ่ายใน Telegram')
    expect(topupBadgeColor(row('readyToPay', { status: 'sent' }))).toBe('info')
    expect(topupBadgeLabel(row('readyToPay'))).toBe('Ready to pay')
    expect(topupBadgeLabel(row('readyToPay', { status: 'failed' }))).toBe('Ready to pay')
    expect(topupBadgeLabel(row('waitingQr', { status: 'pending' }))).toBe('กำลังรอ QR code')
  })
  it('verifying with paidPressedBy is prefixed by แจ้งจาก Telegram (<name>)', () => {
    const r = row('verifying', { status: 'sent', paidPressedBy: { name: '@somchai', at: '2026-10-28T10:00:00.000Z' } })
    expect(topupCheckInfo(r)).toBe('แจ้งจาก Telegram (@somchai) · ตรวจแล้ว 2 ครั้ง')
    expect(topupCheckInfo(row('verifying'))).toBe('ตรวจแล้ว 2 ครั้ง')
    expect(topupCheckInfo(row('verifying', { status: 'sent' }))).toBe('ตรวจแล้ว 2 ครั้ง')
  })
})
