/**
 * Auto-appeal button — which ad rows qualify: `monitorRowAutoAppealEligible()` of `app/utils/reports.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { MonitorRow, MonitorStatus } from '../../shared/types/ads-monitor'
import { monitorRowAutoAppealEligible } from '../../app/utils/reports'
import { isReviewOpenable } from '../../app/utils/appeal'

function row(primary: string, detail: string, key: MonitorStatus['key']): Pick<MonitorRow, 'status'> {
  return { status: { key, primary, detail, reasons: [] } }
}

describe('monitorRowAutoAppealEligible', () => {
  it('accepts not_delivery + creative_offline_audit', () => {
    expect(monitorRowAutoAppealEligible(row('not_delivery', 'creative_offline_audit', 'rejected'))).toBe(true)
  })

  it('accepts a rejected ad whose campaign switch is off (real data: disable / campaign_disable)', () => {
    expect(monitorRowAutoAppealEligible(row('disable', 'campaign_disable', 'rejected'))).toBe(true)
  })

  it('refuses every non-rejected key', () => {
    expect(monitorRowAutoAppealEligible(row('not_delivery', 'creative_disable', 'notDelivering'))).toBe(false)
    expect(monitorRowAutoAppealEligible(row('delivery_ok', 'creative_enable', 'delivering'))).toBe(false)
    expect(monitorRowAutoAppealEligible(row('disable', 'campaign_disable', 'paused'))).toBe(false)
    expect(monitorRowAutoAppealEligible(row('not_delivery', 'creative_offline_audit', 'deleted'))).toBe(false)
    expect(monitorRowAutoAppealEligible(row('not_delivery', 'creative_offline_audit', 'banned'))).toBe(false)
  })
})

describe('partially approved ads (2026-11-16 · "เผยแพร่บางส่วน")', () => {
  const partial = (key: MonitorStatus['key']): Pick<MonitorRow, 'status'> => ({
    status: { key, primary: 'delivery_ok', detail: 'creative_delivery_ok', reasons: ['creative_review_partially_approved'], partial: true }
  })
  it('delivering / paused partial ads qualify', () => {
    expect(monitorRowAutoAppealEligible(partial('delivering'))).toBe(true)
    expect(monitorRowAutoAppealEligible(partial('paused'))).toBe(true)
  })
  it('deleted / banned / missing partial ads do not', () => {
    expect(monitorRowAutoAppealEligible(partial('deleted'))).toBe(false)
    expect(monitorRowAutoAppealEligible(partial('banned'))).toBe(false)
    expect(monitorRowAutoAppealEligible(partial('missing'))).toBe(false)
  })
  it('review button opens for a partial ad once a review exists', () => {
    expect(isReviewOpenable(partial('delivering').status, { appeal: 'unknown' })).toBe(true)
    expect(isReviewOpenable(partial('delivering').status, { appeal: 'none' })).toBe(true)
    expect(isReviewOpenable(partial('delivering').status, null)).toBe(false)
    expect(isReviewOpenable({ key: 'delivering' }, { appeal: 'none' })).toBe(false)
  })
})
