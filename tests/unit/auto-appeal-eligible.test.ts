/**
 * Auto-appeal button — which ad rows qualify: `monitorRowAutoAppealEligible()` of `app/utils/reports.ts`.
 */
import { describe, expect, it } from 'vitest'
import type { MonitorRow, MonitorStatus } from '../../shared/types/ads-monitor'
import { monitorRowAutoAppealEligible } from '../../app/utils/reports'

function row(primary: string, detail: string, key: MonitorStatus['key'] = 'rejected'): Pick<MonitorRow, 'status'> {
  return { status: { key, primary, detail, reasons: [] } }
}

describe('monitorRowAutoAppealEligible', () => {
  it('accepts not_delivery + creative_offline_audit', () => {
    expect(monitorRowAutoAppealEligible(row('not_delivery', 'creative_offline_audit'))).toBe(true)
  })

  it('refuses not_delivery with any other detail', () => {
    expect(monitorRowAutoAppealEligible(row('not_delivery', 'creative_disable', 'notDelivering'))).toBe(false)
    expect(monitorRowAutoAppealEligible(row('not_delivery', 'ad_offline_audit'))).toBe(false)
  })

  it('refuses creative_offline_audit under another primary', () => {
    expect(monitorRowAutoAppealEligible(row('delivery_ok', 'creative_offline_audit', 'delivering'))).toBe(false)
  })
})
