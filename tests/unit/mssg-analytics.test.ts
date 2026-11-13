import { describe, expect, it } from 'vitest'
import {
  mssgAnalyticsActionLabel, mssgAnalyticsButtons, mssgAnalyticsGroups, mssgAnalyticsSummary, mssgDelta, mssgPercentText
} from '../../app/utils/mssg-analytics'
import type { MssgAnalyticsData } from '../../shared/types/mssg-sites'

const data: MssgAnalyticsData = {
  from: '2026-11-06', to: '2026-11-12', readAt: '2026-11-12T09:00:00.000Z',
  current: {
    visits: 120, clicks: 30, clickRate: 0.25,
    byAction: [{ action: 'page.view', value: 120 }],
    items: [
      { action: 'page.view', key: 'p1', label: 'Homepage', value: 120 },
      { action: 'link.click', key: 'l1', label: 'Shop now', value: 25 },
      { action: 'menu.click', key: 'm1', label: 'About', value: 5 }
    ]
  },
  previous: { from: '2026-10-30', to: '2026-11-05', visits: 150, clicks: 20, clickRate: 0.1333 }
}

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
    expect(mssgAnalyticsSummary('week', data)).toContain('120')
    expect(mssgAnalyticsSummary('week', { ...data, current: { ...data.current, visits: 0, clicks: 0 } })).toContain('ยังไม่มีคนเข้าเว็บ')
  })
  it('buttons are the click items, largest first, never page views', () => {
    const b = mssgAnalyticsButtons(data)
    expect(b.map(i => i.key)).toEqual(['l1', 'm1'])
  })
})
