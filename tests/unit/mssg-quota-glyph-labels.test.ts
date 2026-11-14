/**
 * FEAT-101 B11 (spec D20 h / i; AC-75..77) — quota text with an unknown limit, icon label table and search.
 */
import { describe, expect, it } from 'vitest'
import { mssgQuotaFull, mssgQuotaPct, mssgQuotaText, mssgQuotaUnknown } from '../../app/utils/mssg'
import { MSSG_GLYPH_ICONS, MSSG_GLYPH_LABELS, mssgGlyphLabel, mssgGlyphMatches } from '../../app/utils/mssg-glyphs'

describe('mssgQuotaText (D20 h)', () => {
  it('never read → em dash', () => {
    expect(mssgQuotaText(null)).toBe('—')
    expect(mssgQuotaUnknown(null)).toBe(false)
  })
  it('known limits → used/limit', () => {
    expect(mssgQuotaText({ used: 0, limit: 1 })).toBe('0/1')
    expect(mssgQuotaText({ used: 1, limit: 1 })).toBe('1/1')
    expect(mssgQuotaText({ used: 3, limit: 10 })).toBe('3/10')
  })
  it('limit null → unknown, no ∞, no bar, never full', () => {
    const q = { used: 1, limit: null }
    expect(mssgQuotaText(q)).toBe('1 · ไม่ทราบเพดาน')
    expect(mssgQuotaText(q)).not.toContain('∞')
    expect(mssgQuotaUnknown(q)).toBe(true)
    expect(mssgQuotaPct(q)).toBe(0)
    expect(mssgQuotaFull(q)).toBe(false)
  })
  it('full only with a numeric limit', () => {
    expect(mssgQuotaFull({ used: 1, limit: 1 })).toBe(true)
    expect(mssgQuotaFull({ used: 0, limit: 1 })).toBe(false)
    expect(mssgQuotaFull({ used: 3, limit: 10 })).toBe(false)
  })
})

describe('icon labels + search (D20 i)', () => {
  it('66 icons, every one has a label, none left over', () => {
    expect(MSSG_GLYPH_ICONS).toHaveLength(66)
    for (const n of MSSG_GLYPH_ICONS) expect(MSSG_GLYPH_LABELS[n], n).toBeTruthy()
    expect(Object.keys(MSSG_GLYPH_LABELS).sort()).toEqual([...MSSG_GLYPH_ICONS].sort())
  })
  it('label format for the generic icons is "<ไทย> · <English>"', () => {
    expect(mssgGlyphLabel('call')).toBe('โทรศัพท์ · Phone')
    expect(mssgGlyphLabel('email')).toBe('อีเมล · Email')
  })
  it('matches Thai, English and raw name, case-insensitive; empty matches all', () => {
    expect(mssgGlyphMatches('call', 'โทร')).toBe(true)
    expect(mssgGlyphMatches('call', 'PHONE')).toBe(true)
    expect(mssgGlyphMatches('call', 'cal')).toBe(true)
    expect(mssgGlyphMatches('shopping_cart', 'shopping_c')).toBe(true)
    expect(mssgGlyphMatches('call', 'zzz')).toBe(false)
    expect(mssgGlyphMatches('call', '  ')).toBe(true)
    expect(MSSG_GLYPH_ICONS.filter(n => mssgGlyphMatches(n, 'โทร')).length).toBeGreaterThan(0)
  })
})
