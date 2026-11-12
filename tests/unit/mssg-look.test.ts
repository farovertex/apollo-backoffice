/**
 * FEAT-101 M3 reopen (B3r; api-contract.md v1.6 §3.4 "Theme preset" / "Font", AC-43, AC-44) — presets, the `autoTheme` pair,
 * fonts, their folding into `page.update` and the client preview, "ใช้กับทุกหน้า" (`app/utils/mssg-look.ts`,
 * `mssg-blocks.ts`). Imported by relative path (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import { mssgApplyOps, mssgFoldPageUpdate } from '../../app/utils/mssg-blocks'
import {
  MSSG_AUTO_PAIR_IDS,
  MSSG_COLOR_IDS,
  MSSG_FONTS,
  mssgApplyAllTheme,
  mssgFontByFamily,
  mssgFontCss,
  mssgFontValid,
  mssgPresetPatch,
  mssgThemeIssue,
  mssgThemeSwatch
} from '../../app/utils/mssg-look'
import type { MssgSiteProjection } from '../../shared/types/mssg-sites'

function site(): MssgSiteProjection {
  return {
    id: 's', name: 'Shop', enabled: true, subdomain: 'shop', apexDomain: 'mssg.me', domain: null, finalUrl: '', branding: true,
    localization: { lang: 'en' }, seo: { title: '', description: '', indexing: true, faviconUrl: null, ogImageUrl: null },
    tracking: { google: '', facebook: '', tiktok: '' }, embeddedCode: { content: '', inHead: false, onLoad: false },
    menu: { enabled: true, items: [{ page: 'p2', label: 'About us', enabled: true }, { page: 'p1', label: 'Home', enabled: true }, { page: 'gone', label: 'X', enabled: true }] },
    homePageId: 'p1', crm: null,
    pages: [
      {
        id: 'p1', name: 'Homepage', slug: 'home', enabled: true, seo: { title: '', description: '' },
        theme: { styleId: 'simple', colorId: 'skyTheme', colors: { a: 1 }, page: { backgroundColor: null, font: { family: 'Lobster', provider: 'google' } }, blocks: { link: { borderRadius: 8, backgroundColor: '#FFFFFF', color: '#000000', width: 100, borderWidth: 0, gap: 8, linkMode: 'classic', units: { width: '%' } } } },
        blocks: [
          { id: 'b1', kind: 'Link', enabled: true, fields: { title: 'Go', action: { type: 'url', url: 'https://x.y' }, theme: { blocks: { link: { color: '#FF0000', units: { width: '%' } } } } } },
          { id: 'b2', kind: 'Features', enabled: true, fields: { items: [{ title: 'A', content: '', glyph: { type: 'icon', icon: 'star' } }, { title: 'B', content: '', glyph: { type: 'emoji', value: '⭐' } }] } }
        ]
      },
      { id: 'p2', name: 'About', slug: 'about', enabled: true, seo: { title: '', description: '' }, theme: null, blocks: [{ id: 'b3', kind: 'Features', enabled: true, fields: { items: [{ title: 'C', content: '', glyph: { type: 'icon', icon: 'heart' } }] } }] },
      { id: 'tmp-newpage1', name: 'Promo', slug: 'promo', enabled: true, seo: { title: '', description: '' }, theme: null, blocks: [{ id: 'tmp-newblock1', kind: 'Link', enabled: true, fields: {} }] },
      { id: 'tmp-clone001', name: 'Home Copy', slug: 'home-copy', enabled: true, seo: { title: '', description: '' }, theme: null, blocks: [{ id: 'tmp-clone001:0', kind: 'Link', enabled: true, fields: {} }] }
    ]
  }
}
describe('presets and fonts (§3.4)', () => {
  it('18 presets, 17 pair ids, 38 fonts', () => {
    expect(MSSG_COLOR_IDS).toHaveLength(18)
    expect(new Set(MSSG_COLOR_IDS).size).toBe(18)
    expect(MSSG_AUTO_PAIR_IDS).toHaveLength(17)
    expect(MSSG_FONTS).toHaveLength(38)
    expect(MSSG_FONTS.filter(f => f.provider === 'websafe')).toHaveLength(6)
  })
  it('theme rules: id in the list, autoTheme pair, no pair otherwise', () => {
    expect(mssgThemeIssue({ colorId: 'skyTheme' })).toBeNull()
    expect(mssgThemeIssue({ colorId: 'nopeTheme' })).not.toBeNull()
    expect(mssgThemeIssue({ colorId: 'autoTheme', light: 'lightTheme', dark: 'darkTheme' })).toBeNull()
    expect(mssgThemeIssue({ colorId: 'autoTheme', light: 'autoTheme', dark: 'darkTheme' })).not.toBeNull()
    expect(mssgThemeIssue({ colorId: 'skyTheme', light: 'lightTheme' })).not.toBeNull()
    expect(mssgPresetPatch('autoTheme')).toEqual({ colorId: 'autoTheme', light: 'lightTheme', dark: 'darkTheme' })
    expect(mssgPresetPatch('pinkTheme', { light: 'x' })).toEqual({ colorId: 'pinkTheme' })
  })
  it('folding a switch away from autoTheme drops light / dark; preview drops colors and removes a null font', () => {
    let ops = mssgFoldPageUpdate([], 'p1', { theme: { colorId: 'autoTheme', light: 'bwTheme', dark: 'wbTheme' } })
    ops = mssgFoldPageUpdate(ops, 'p1', { theme: { colorId: 'taxiTheme' } })
    ops = mssgFoldPageUpdate(ops, 'p1', { theme: { page: { font: null } } })
    expect(ops).toEqual([{ op: 'page.update', pageId: 'p1', fields: { theme: { colorId: 'taxiTheme', page: { font: null } } } }])
    const p = mssgApplyOps(site(), ops).pages[0]!
    expect(p.theme!.colorId).toBe('taxiTheme')
    expect(p.theme!.colors).toBeUndefined()
    expect(p.theme!.page).toEqual({ backgroundColor: null })
    expect(p.theme!.styleId).toBe('simple')
  })
  it('fonts: list membership, lookup, css', () => {
    expect(mssgFontValid({ family: 'Lobster', provider: 'google' })).toBe(true)
    expect(mssgFontValid({ family: 'Lobster', provider: 'websafe' })).toBe(false)
    expect(mssgFontByFamily('Georgia')).toEqual({ family: 'Georgia', provider: 'websafe' })
    expect(mssgFontByFamily('')).toBeNull()
    expect(mssgFontCss({ family: 'PT Mono', provider: 'google' })).toBe('"PT Mono", monospace')
  })
  it('apply-all copies preset (+pair), font, colour and image; swatch of autoTheme = its light preset', () => {
    expect(mssgApplyAllTheme(site().pages[0]!.theme)).toEqual({ colorId: 'skyTheme', page: { backgroundColor: null, backgroundImage: null, font: { family: 'Lobster', provider: 'google' } } })
    expect(mssgApplyAllTheme({ colorId: 'autoTheme', light: 'bwTheme', dark: 'wbTheme', page: { backgroundColor: '#112233' } }))
      .toEqual({ colorId: 'autoTheme', light: 'bwTheme', dark: 'wbTheme', page: { backgroundColor: '#112233', backgroundImage: null, font: null } })
    expect(mssgApplyAllTheme(null)).toEqual({ page: { backgroundColor: null, backgroundImage: null, font: null } })
    expect(mssgThemeSwatch({ colorId: 'autoTheme', light: 'taxiTheme' })!.id).toBe('taxiTheme')
    expect(mssgThemeSwatch({})).toBeNull()
  })
})
