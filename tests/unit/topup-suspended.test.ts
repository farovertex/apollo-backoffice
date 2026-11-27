/**
 * 2026-11-27 — the slide-over flips the advertiser badge to Suspended when its round ends with the worker's
 * "บัญชีโฆษณาถูกระงับ" text (QR or card), without waiting for the next list read.
 */
import { describe, expect, it } from 'vitest'
import { TOPUP_ADVERTISER_SUSPENDED, topupSaysSuspended } from '../../app/utils/topup'

describe('topupSaysSuspended', () => {
  it('qrFailed / cardFailed with the suspended text → true', () => {
    expect(topupSaysSuspended({ status: 'qrFailed', error: TOPUP_ADVERTISER_SUSPENDED })).toBe(true)
    expect(topupSaysSuspended({ status: 'cardFailed', error: TOPUP_ADVERTISER_SUSPENDED })).toBe(true)
  })
  it('other errors / statuses → false', () => {
    expect(topupSaysSuspended({ status: 'qrFailed', error: 'ไม่พบปุ่มเติมเงิน' })).toBe(false)
    expect(topupSaysSuspended({ status: 'qrFailed', error: null })).toBe(false)
    expect(topupSaysSuspended({ status: 'readyToPay', error: TOPUP_ADVERTISER_SUSPENDED })).toBe(false)
  })
})
