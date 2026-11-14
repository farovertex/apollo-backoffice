import { describe, expect, it } from 'vitest'
import {
  MSSG_ANALYTICS_RANGES, mssgAnalyticsActionLabel, mssgAnalyticsButtons, mssgAnalyticsDatesText, mssgAnalyticsGroups,
  mssgAnalyticsPeriodText, mssgAnalyticsPreviousLabel, mssgAnalyticsRunning, mssgAnalyticsSummary, mssgDelta, mssgPercentText
} from '../../app/utils/mssg-analytics'
import type { MssgAnalyticsData } from '../../shared/types/mssg-sites'

const data: MssgAnalyticsData = {
  from: '2026-11-08', to: '2026-11-14', readAt: '2026-11-13T09:00:00.000Z',
  current: {
    visits: 120, clicks: 30, clickRate: 0.25,
    byAction: [{ action: 'page.view', value: 120 }],
    items: [
      { action: 'page.view', key: 'p1', label: 'Homepage', value: 120 },
      { action: 'link.click', key: 'l1', label: 'Shop now', value: 25 },
      { action: 'menu.click', key: 'm1', label: 'About', value: 5 }
    ]
  },
  previous: { from: '2026-11-01', to: '2026-11-07', visits: 150, clicks: 20, clickRate: 0.1333 }
}

/** render time injected (13 Nov 2026 16:00 Bangkok) */
const NOW = new Date('2026-11-13T09:00:00.000Z')

describe('mssg analytics helpers', () => {
  it('labels known actions in Thai and unknown ones generically', () => {
    expect(mssgAnalyticsActionLabel({ action: 'page.view', label: 'Homepage' })).toBe('เข้าหน้า Homepage')
    expect(mssgAnalyticsActionLabel({ action: 'link.click', label: 'x' })).toBe('คลิกลิงก์')
    expect(mssgAnalyticsActionLabel({ action: 'menu.click', label: 'x' })).toBe('คลิกเมนู')
    expect(mssgAnalyticsActionLabel({ action: 'messenger.click', label: 'x' })).toBe('คลิกปุ่มแชท')
    expect(mssgAnalyticsActionLabel({ action: 'internal.click', label: 'x' })).toBe('คลิกลิงก์ภายในเว็บ')
    expect(mssgAnalyticsActionLabel({ action: 'form.submit', label: 'x' })).toBe('การกระทำ form.submit')
    expect(mssgAnalyticsActionLabel({ action: 'cart.click', label: '' })).toBe('คลิก cart.click')
  })
  it('groups rows by the five actions in fixed order, unknown last, empty omitted', () => {
    const g = mssgAnalyticsGroups({ ...data, current: { ...data.current,
      byAction: [{ action: 'page.view', value: 120 }, { action: 'menu.click', value: 5 }],
      items: [
        { action: 'x.y', key: 'z', label: 'z', value: 1 },
        { action: 'menu.click', key: 'm1', label: 'About', value: 5 },
        { action: 'internal.click', key: 'i1', label: 'Go', value: 2 },
        { action: 'page.view', key: 'p1', label: 'Homepage', value: 120 }
      ] } })
    expect(g.map(x => x.action)).toEqual(['page.view', 'internal.click', 'menu.click', 'x.y'])
    expect(g[0]).toMatchObject({ label: 'คนเข้าเว็บ', total: 120 })
    expect(g[1]!.total).toBe(2)
    expect(g[3]!.label).toBe('การกระทำ x.y')
  })
  it('delta: direction, size and share of the previous period', () => {
    const down = mssgDelta(120, 150, 'สัปดาห์ก่อน', 'ครั้ง', { withPct: true })
    expect(down.trend).toBe('down')
    expect(down.text).toBe('▼ น้อยกว่าสัปดาห์ก่อน 30 ครั้ง (20%)')
    expect(mssgDelta(30, 20, 'สัปดาห์ก่อน', 'ครั้ง', { withPct: true }).trend).toBe('up')
    expect(mssgDelta(9, 9, 'เมื่อวาน', 'ครั้ง').trend).toBe('flat')
    expect(mssgDelta(5, 0, 'เมื่อวาน', 'ครั้ง', { withPct: true }).text).toBe('▲ มากกว่าเมื่อวาน 5 ครั้ง')
  })
  it('percent and summary', () => {
    expect(mssgPercentText(0.25)).toBe('25%')
    expect(mssgPercentText(0.3077)).toBe('30.8%')
    expect(mssgPercentText(0)).toBe('0%')
    expect(mssgAnalyticsSummary('week', data, NOW)).toBe('สัปดาห์นี้ถึงตอนนี้ มีคนเข้าเว็บ 120 ครั้ง และกดลิงก์หรือปุ่ม 30 ครั้ง (25%)')
    expect(mssgAnalyticsSummary('week', { ...data, to: '2026-11-12' }, NOW)).toBe('สัปดาห์นี้ มีคนเข้าเว็บ 120 ครั้ง และกดลิงก์หรือปุ่ม 30 ครั้ง (25%)')
    expect(mssgAnalyticsSummary('day', { ...data, current: { ...data.current, visits: 0, clicks: 0 } }, NOW)).toBe('วันนี้ถึงตอนนี้ ยังไม่มีคนเข้าเว็บ')
    expect(mssgAnalyticsSummary('week', { ...data, current: { ...data.current, visits: 0, clicks: 0 } }, NOW)).toContain('ยังไม่มีคนเข้าเว็บ')
  })
  it('buttons are the click items, largest first, never page views', () => {
    const b = mssgAnalyticsButtons(data)
    expect(b.map(i => i.key)).toEqual(['l1', 'm1'])
  })
  it('calendar labels, no rolling wording', () => {
    expect(MSSG_ANALYTICS_RANGES.map(r => r.label)).toEqual(['วันนี้', 'สัปดาห์นี้', 'เดือนนี้'])
    expect(MSSG_ANALYTICS_RANGES.map(r => r.previous)).toEqual(['เมื่อวาน', 'สัปดาห์ก่อน', 'เดือนก่อน'])
    expect(JSON.stringify(MSSG_ANALYTICS_RANGES)).not.toMatch(/7 วัน|30 วัน|ที่ผ่านมา/)
  })
  it('date range text from the stored dates', () => {
    expect(mssgAnalyticsPeriodText('2026-11-13', '2026-11-13')).toBe('13 พ.ย. 2569')
    expect(mssgAnalyticsPeriodText('2026-11-08', '2026-11-14')).toBe('8–14 พ.ย. 2569')
    expect(mssgAnalyticsPeriodText('2026-11-01', '2026-11-30')).toBe('1–30 พ.ย. 2569')
    expect(mssgAnalyticsPeriodText('2026-11-29', '2026-12-05')).toBe('29 พ.ย. – 5 ธ.ค. 2569')
    expect(mssgAnalyticsPeriodText('2026-12-27', '2027-01-02')).toBe('27 ธ.ค. 2569 – 2 ม.ค. 2570')
    expect(mssgAnalyticsDatesText('week', data)).toEqual({ current: 'สัปดาห์นี้ 8–14 พ.ย. 2569', previous: 'สัปดาห์ก่อน 1–7 พ.ย. 2569' })
    expect(mssgAnalyticsDatesText('week', { ...data, from: '2026-12-27', to: '2027-01-02', previous: { ...data.previous, from: '2026-12-20', to: '2026-12-26' } }))
      .toEqual({ current: 'สัปดาห์นี้ 27 ธ.ค. 2569 – 2 ม.ค. 2570', previous: 'สัปดาห์ก่อน 20–26 ธ.ค. 2569' })
  })
  it('AC-62: running only while the stored end is today or later in Bangkok at render time (not readAt)', () => {
    // running week (8–14 Nov), now = 13 Nov Bangkok
    expect(mssgAnalyticsRunning(data, NOW)).toBe(true)
    // the same read rendered after the week ended (15 Nov 00:00 Bangkok = 14 Nov 17:00Z): ended, though readAt was inside it
    expect(mssgAnalyticsRunning(data, new Date('2026-11-14T16:59:00.000Z'))).toBe(true)
    expect(mssgAnalyticsRunning(data, new Date('2026-11-14T17:00:00.000Z'))).toBe(false)
    // stored earlier week / month / day, read fresh today (readAt = now): ended — the old rule said "running"
    const freshRead = { readAt: NOW.toISOString() }
    expect(mssgAnalyticsRunning({ ...freshRead, to: '2026-11-07' }, NOW)).toBe(false)
    expect(mssgAnalyticsRunning({ ...freshRead, to: '2026-10-31' }, NOW)).toBe(false)
    expect(mssgAnalyticsRunning({ ...freshRead, to: '2026-11-12' }, NOW)).toBe(false)
    // an old read of last week stays ended, also when it was read while that week ran
    expect(mssgAnalyticsRunning({ to: '2026-11-07', readAt: '2026-11-05T03:00:00.000Z' }, NOW)).toBe(false)
    // today's day / this month running
    expect(mssgAnalyticsRunning({ to: '2026-11-13' }, NOW)).toBe(true)
    expect(mssgAnalyticsRunning({ to: '2026-11-30' }, NOW)).toBe(true)
    // Bangkok day boundary: 13 Nov 16:59Z = 23:59 Bangkok (running), 17:00Z = 14 Nov (a stored day of 13 Nov has ended)
    expect(mssgAnalyticsRunning({ to: '2026-11-13' }, new Date('2026-11-13T16:59:00.000Z'))).toBe(true)
    expect(mssgAnalyticsRunning({ to: '2026-11-13' }, new Date('2026-11-13T17:00:00.000Z'))).toBe(false)
    expect(mssgAnalyticsRunning({ to: '' }, NOW)).toBe(false)
    expect(mssgAnalyticsPreviousLabel('week', data, NOW)).toBe('สัปดาห์ก่อนทั้งสัปดาห์')
    expect(mssgAnalyticsPreviousLabel('week', { to: '2026-11-07' }, NOW)).toBe('สัปดาห์ก่อน')
    expect(mssgAnalyticsPreviousLabel('month', { to: '2026-10-31' }, NOW)).toBe('เดือนก่อน')
    expect(mssgAnalyticsPreviousLabel('day', { to: '2026-11-12' }, NOW)).toBe('เมื่อวาน')
    expect(mssgAnalyticsSummary('month', { ...data, to: '2026-10-31' }, NOW)).toMatch(/^เดือนนี้ มีคนเข้าเว็บ/)
    expect(mssgDelta(120, 150, mssgAnalyticsPreviousLabel('week', data, NOW), 'ครั้ง', { withPct: true }).text).toBe('▼ น้อยกว่าสัปดาห์ก่อนทั้งสัปดาห์ 30 ครั้ง (20%)')
    expect(mssgDelta(5, 5, 'เมื่อวานทั้งวัน', 'ครั้ง').text).toBe('เท่ากับเมื่อวานทั้งวัน')
  })
})
