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
  mssgAllowedIds,
  mssgApplyAllThemeFor,
  mssgPresetChoosable,
  mssgPresetTiles,
  mssgThemeIssue
} from '../../app/utils/mssg-look'
import type { MssgPresetsView, MssgSiteProjection } from '../../shared/types/mssg-sites'

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
  it('apply-all copies preset (+pair), font, colour and image', () => {
    expect(mssgApplyAllTheme(site().pages[0]!.theme)).toEqual({ colorId: 'skyTheme', page: { backgroundColor: null, backgroundImage: null, font: { family: 'Lobster', provider: 'google' } } })
    expect(mssgApplyAllTheme({ colorId: 'autoTheme', light: 'bwTheme', dark: 'wbTheme', page: { backgroundColor: '#112233' } }))
      .toEqual({ colorId: 'autoTheme', light: 'bwTheme', dark: 'wbTheme', page: { backgroundColor: '#112233', backgroundImage: null, font: null } })
    expect(mssgApplyAllTheme(null)).toEqual({ page: { backgroundColor: null, backgroundImage: null, font: null } })
  })
})

// ── v1.13 (B14): tiles from the presets route, plan, apply-all skip, draft-ops rule ─────────────────────────────────────
const sw = (background: string, gradient = '') => ({ background, backgroundGradient: gradient, text: '#111111ff', panel: '#eeeeeeff', buttonBackground: '#ff0000ff', buttonTextColor: '#ffffffff' })
function presetsView(role: string | null, proIds: string[] = []): MssgPresetsView {
  const known = role !== null
  return {
    role,
    known,
    items: MSSG_COLOR_IDS.map(id => ({
      id,
      name: id === 'autoTheme' ? 'Auto' : id === 'newCoralTheme' ? 'New Coral' : id.replace('Theme', ''),
      allowed: !known || !(proIds.includes(id) || id === 'autoTheme'),
      swatch: id === 'autoTheme' ? null : id === 'newCoralTheme' ? sw('#ffe9e3ff', 'linear-gradient(180deg, #14b8a6ff, #0e7490ff)') : id === 'darkTheme' ? sw('#1f2024ff') : sw('#ffffffff')
    }))
  }
}
describe('preset tiles (D24 / D25 d)', () => {
  it('names and swatch attributes are the endpoint\'s; a gradient wins over the plain colour; autoTheme is split light / dark', () => {
    const tiles = mssgPresetTiles(presetsView('pro400'))
    expect(tiles).toHaveLength(18)
    const coral = tiles.find(t => t.id === 'newCoralTheme')!
    expect(coral.name).toBe('New Coral')
    expect(coral.bg).toBe('linear-gradient(180deg, #14b8a6ff, #0e7490ff)')
    expect(coral.background).toBe('#ffe9e3ff')
    expect(coral.text).toBe('#111111ff')
    expect(coral.button).toBe('#ff0000ff')
    expect(coral.buttonText).toBe('#ffffffff')
    const light = tiles.find(t => t.id === 'lightTheme')!
    expect(light.bg).toBe('#ffffffff')
    expect(light.gradient).toBe('')
    const auto = tiles.find(t => t.id === 'autoTheme')!
    expect(auto.name).toBe('Auto')
    expect(auto.split).toEqual({ light: '#ffffffff', dark: '#1f2024ff' })
    expect(mssgPresetTiles(presetsView('pro400'), { light: 'newCoralTheme', dark: 'darkTheme' }).find(t => t.id === 'autoTheme')!.split!.light).toBe('linear-gradient(180deg, #14b8a6ff, #0e7490ff)')
  })
  it('no endpoint answer: the 18 ids as names, no colours, all selectable', () => {
    const tiles = mssgPresetTiles(null)
    expect(tiles.map(t => t.id)).toEqual(MSSG_COLOR_IDS)
    expect(tiles.every(t => t.name === t.id && t.bg === null && t.allowed && t.button === null)).toBe(true)
  })
  it('allowed / pro: basic marks the Pro ids, unknown role leaves everything selectable', () => {
    const pro = ['fireTheme', 'lemonTheme']
    const basic = mssgPresetTiles(presetsView('basic', pro))
    expect(basic.filter(t => !t.allowed).map(t => t.id).sort()).toEqual(['autoTheme', 'fireTheme', 'lemonTheme'])
    expect(mssgPresetChoosable(basic.find(t => t.id === 'fireTheme')!)).toBe(false)
    expect(mssgPresetChoosable(basic.find(t => t.id === 'pinkTheme')!)).toBe(true)
    expect(mssgAllowedIds(presetsView('basic', pro))!.has('fireTheme')).toBe(false)
    expect(mssgAllowedIds(presetsView('basic', pro))!.has('pinkTheme')).toBe(true)
    const unknown = presetsView(null, pro)
    expect(mssgPresetTiles(unknown).every(t => t.allowed)).toBe(true)
    expect(mssgAllowedIds(unknown)).toBeNull()
    expect(mssgAllowedIds(null)).toBeNull()
  })
  it('apply-all skips a not-granted preset for pages that differ, keeps the other keys; a page already on it still gets it', () => {
    const allowed = mssgAllowedIds(presetsView('basic', ['fireTheme']))
    const patch = { colorId: 'fireTheme', page: { backgroundImage: null, font: { family: 'Lobster', provider: 'google' as const } } }
    const other = mssgApplyAllThemeFor(patch, { colorId: 'pinkTheme' }, allowed)
    expect(other.skipped).toBe(true)
    expect(other.theme).toEqual({ page: patch.page })
    const same = mssgApplyAllThemeFor(patch, { colorId: 'fireTheme' }, allowed)
    expect(same.skipped).toBe(false)
    expect(same.theme.colorId).toBe('fireTheme')
    expect(mssgApplyAllThemeFor({ colorId: 'pinkTheme' }, null, allowed).skipped).toBe(false)
    expect(mssgApplyAllThemeFor(patch, null, null).skipped).toBe(false)
    // autoTheme: the pair members count too
    const auto = { colorId: 'autoTheme', light: 'fireTheme', dark: 'darkTheme' }
    expect(mssgApplyAllThemeFor(auto, { colorId: 'pinkTheme' }, allowed)).toEqual({ theme: {}, skipped: true })
    // a page already on that autoTheme pair (read back) still gets it
    expect(mssgApplyAllThemeFor(auto, { colorId: 'autoTheme', light: 'fireTheme', dark: 'wbTheme' }, mssgAllowedIds(presetsView('basic', ['fireTheme', 'autoTheme'])))).toMatchObject({ skipped: false })
  })
})
describe('draft ops: last action wins (D23 g)', () => {
  const own = (c: string) => ({ theme: { page: { backgroundColor: c } } })
  it('an own colour typed before the preset is dropped; typed after, it is kept; again a preset drops it', () => {
    let ops = mssgFoldPageUpdate([], 'p1', own('#112233') as never)
    ops = mssgFoldPageUpdate(ops, 'p1', { theme: { colorId: 'pinkTheme' } })
    expect(ops).toEqual([{ op: 'page.update', pageId: 'p1', fields: { theme: { colorId: 'pinkTheme' } } }])
    ops = mssgFoldPageUpdate(ops, 'p1', own('#445566') as never)
    expect(ops).toEqual([{ op: 'page.update', pageId: 'p1', fields: { theme: { colorId: 'pinkTheme', page: { backgroundColor: '#445566' } } } }])
    ops = mssgFoldPageUpdate(ops, 'p1', { theme: { colorId: 'pinkTheme' } })
    expect(ops).toEqual([{ op: 'page.update', pageId: 'p1', fields: { theme: { colorId: 'pinkTheme' } } }])
  })
  it('other page keys stay when the colour is dropped; a colour in the same incoming fields as the preset stays; other pages untouched', () => {
    let ops = mssgFoldPageUpdate([], 'p1', { theme: { page: { backgroundColor: '#112233', font: null } } } as never)
    ops = mssgFoldPageUpdate(ops, 'p2', own('#999999') as never)
    ops = mssgFoldPageUpdate(ops, 'p1', { theme: { colorId: 'taxiTheme' } })
    expect(ops[0]).toEqual({ op: 'page.update', pageId: 'p1', fields: { theme: { page: { font: null }, colorId: 'taxiTheme' } } })
    expect(ops[1]).toEqual({ op: 'page.update', pageId: 'p2', fields: own('#999999') })
    ops = mssgFoldPageUpdate(ops, 'p1', { theme: { colorId: 'pinkTheme', page: { backgroundColor: '#ABCDEF' } } } as never)
    expect((ops[0] as { fields: { theme: { page: { backgroundColor: string } } } }).fields.theme.page.backgroundColor).toBe('#ABCDEF')
  })
  it('the local preview of an own colour clears the gradient', () => {
    const s = site()
    s.pages[0]!.theme = { colorId: 'newCoralTheme', page: { backgroundColor: '#ffe9e3ff', backgroundGradient: 'linear-gradient(red, blue)' } }
    const p = mssgApplyOps(s, mssgFoldPageUpdate([], 'p1', own('#112233') as never)).pages[0]!
    expect(p.theme!.page).toMatchObject({ backgroundColor: '#112233', backgroundGradient: '' })
  })
})
