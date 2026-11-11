/**
 * Auto-appeal button — which ad rows qualify: `monitorRowAutoAppealEligible()` of `app/utils/reports.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { MonitorRow, MonitorStatus } from '../../shared/types/ads-monitor'
import { monitorRowAutoAppealEligible } from '../../app/utils/reports'

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
