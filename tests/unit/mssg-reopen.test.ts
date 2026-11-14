/**
 * FEAT-101 reopen (B2r / B3r; api-contract.md v1.6 §3.4, AC-43..48) — the pure logic of the reopened editor controls:
 * action rules (`mssg-actions.ts`), Messengers pairs and Features icons, the proven block shapes (`mssg-blocks.ts`),
 * block style key derivation and folding (`mssg-style.ts`), menu rows / ordering / folding (`mssg-menu.ts`). Presets and
 * fonts: `mssg-look.test.ts`. Imported by relative path (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import {
  MSSG_IMAGE_ACTION_TYPES,
  MSSG_LINK_ACTION_TYPES,
  mssgActionIssues,
  mssgActionOut,
  mssgAnchorBlocks,
  mssgDefaultAction,
  mssgMessengerIssue,
  mssgMessengerTypeFor
} from '../../app/utils/mssg-actions'
import {
  mssgApplyOps,
  mssgBlockDefaults,
  mssgBlockSchema,
  mssgBlockToForm,
  mssgCreateFields,
  mssgFoldBlockUpdate,
  mssgFormToBlock
} from '../../app/utils/mssg-blocks'
import {
  mssgMergeBlockTheme,
  mssgPreviewStyle,
  mssgStyleDefaults,
  mssgStyleKeys,
  mssgStyleKindKey,
  mssgStyleOverride,
  mssgStylePatch,
  mssgStyleValueIssue
} from '../../app/utils/mssg-style'
import { mssgMenuItems, mssgMenuLabelSchema, mssgMenuMove, mssgMenuNewPages, mssgMenuRows, mssgMenuSet } from '../../app/utils/mssg-menu'
import { mssgMergeFields, mssgStepOf } from '../../app/utils/mssg-sites'
import type { MssgOp, MssgSiteProjection } from '../../shared/types/mssg-sites'

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
const ctx = () => ({ pages: site().pages })

describe('actions (§3.4)', () => {
  it('offers the 6 link types and 8 image types', () => {
    expect([...MSSG_LINK_ACTION_TYPES]).toEqual(['url', 'page', 'tel', 'email', 'sms', 'anchor'])
    expect([...MSSG_IMAGE_ACTION_TYPES]).toEqual(['nothing', 'fullImage', 'url', 'page', 'tel', 'email', 'sms', 'anchor'])
  })
  it('url: http(s) ≤ 2000', () => {
    expect(mssgActionIssues({ type: 'url', url: 'https://a.b' }, ctx(), false)).toEqual([])
    expect(mssgActionIssues({ type: 'url', url: 'ftp://a.b' }, ctx(), false)[0]!.path).toBe('url')
    expect(mssgActionIssues({ type: 'url', url: `https://a.b/${'x'.repeat(2000)}` }, ctx(), false)[0]!.path).toBe('url')
  })
  it('tel / sms: raw phone, no scheme; email: raw address ≤ 254', () => {
    for (const type of ['tel', 'sms']) {
      expect(mssgActionIssues({ type, url: '+66 (81) 234-5678' }, ctx(), false)).toEqual([])
      expect(mssgActionIssues({ type, url: 'tel:0812345678' }, ctx(), false)).toHaveLength(1)
      expect(mssgActionIssues({ type, url: '12' }, ctx(), false)).toHaveLength(1)
      expect(mssgActionIssues({ type, url: '' }, ctx(), false)[0]!.path).toBe('url')
    }
    expect(mssgActionIssues({ type: 'email', url: 'a@b.co' }, ctx(), false)).toEqual([])
    expect(mssgActionIssues({ type: 'email', url: 'mailto:a@b.co' }, ctx(), false)).toHaveLength(1)
    expect(mssgActionIssues({ type: 'email', url: `${'a'.repeat(250)}@b.co` }, ctx(), false)).toHaveLength(1)
  })
  it('page: a page of the preview (temp ids allowed); without ctx only presence', () => {
    expect(mssgActionIssues({ type: 'page', page: 'tmp-newpage1' }, ctx(), false)).toEqual([])
    expect(mssgActionIssues({ type: 'page', page: 'nope' }, ctx(), false)[0]!.path).toBe('page')
    expect(mssgActionIssues({ type: 'page', page: 'nope' }, null, false)).toEqual([])
    expect(mssgActionIssues({ type: 'page', page: '' }, null, false)[0]!.path).toBe('page')
  })
  it('anchor: a block on that page; synthetic ids of a cloned page are not targets', () => {
    expect(mssgActionIssues({ type: 'anchor', anchor: { page: 'p1', block: 'b2' } }, ctx(), false)).toEqual([])
    expect(mssgActionIssues({ type: 'anchor', anchor: { page: 'tmp-newpage1', block: 'tmp-newblock1' } }, ctx(), false)).toEqual([])
    expect(mssgActionIssues({ type: 'anchor', anchor: { page: 'p2', block: 'b2' } }, ctx(), false)[0]!.path).toBe('anchor.block')
    expect(mssgActionIssues({ type: 'anchor', anchor: { page: 'x', block: 'b2' } }, ctx(), false)[0]!.path).toBe('anchor.page')
    expect(mssgActionIssues({ type: 'anchor', anchor: { page: 'p1', block: '' } }, ctx(), false)[0]!.path).toBe('anchor.block')
    expect(mssgAnchorBlocks(ctx(), 'tmp-clone001')).toEqual([])
    expect(mssgAnchorBlocks(ctx(), 'p1').map(b => b.id)).toEqual(['b1', 'b2'])
  })
  it('nothing / fullImage only for images; unknown types read from mssg are kept', () => {
    expect(mssgActionIssues({ type: 'nothing' }, ctx(), true)).toEqual([])
    expect(mssgActionIssues({ type: 'fullImage' }, ctx(), true)).toEqual([])
    expect(mssgActionIssues({ type: 'nothing' }, ctx(), false)[0]!.path).toBe('type')
    expect(mssgActionIssues({ type: 'whatsappChat', x: 1 }, ctx(), false)).toEqual([])
    expect(mssgActionIssues({}, ctx(), true)[0]!.path).toBe('type')
  })
  it('defaults and the sent shape', () => {
    expect(mssgDefaultAction('tel', ctx())).toEqual({ type: 'tel', url: '' })
    expect(mssgDefaultAction('page', ctx())).toEqual({ type: 'page', page: 'p1' })
    expect(mssgDefaultAction('anchor', ctx())).toEqual({ type: 'anchor', anchor: { page: 'p1', block: 'b1' } })
    expect(mssgDefaultAction('fullImage', ctx())).toEqual({ type: 'fullImage' })
    expect(mssgActionOut({ type: 'email', url: '  a@b.co ' })).toEqual({ type: 'email', url: 'a@b.co' })
  })
  it('block schemas use the actions with the draft context', () => {
    const link = mssgBlockSchema('Link', ctx())!
    expect(link.safeParse({ items: [{ title: 'Go', action: { type: 'anchor', anchor: { page: 'p1', block: 'b1' } }, glyph: null }] }).success).toBe(true)
    const bad = link.safeParse({ items: [{ title: 'Go', action: { type: 'anchor', anchor: { page: 'p2', block: 'b1' } }, glyph: null }] })
    expect(bad.success).toBe(false)
    expect(bad.error!.issues[0]!.path).toEqual(['items', 0, 'action', 'anchor', 'block'])
    const gal = mssgBlockSchema('ImageGallery', ctx())!.safeParse({ images: [{ url: 'upload:0123456789abcdef01234567', action: { type: 'sms', url: 'x' } }], autoplay: 0 })
    expect(gal.error!.issues[0]!.path).toEqual(['images', 0, 'action', 'url'])
  })
})

describe('proven shapes (§3.3 v1.6)', () => {
  it('Hat: title / subtitle / logoUrl / bgUrl, empty images left out on create', () => {
    const form = mssgBlockToForm('Hat', mssgBlockDefaults('Hat'))
    expect(form).toEqual({ title: '', subtitle: '', logoUrl: null, bgUrl: null })
    form.title = ' Shop '
    form.logoUrl = 'upload:0123456789abcdef01234567'
    const fields = mssgFormToBlock('Hat', form, {})
    expect(fields).toEqual({ title: 'Shop', subtitle: '', logoUrl: 'upload:0123456789abcdef01234567', bgUrl: null })
    expect(mssgCreateFields('Hat', fields)).toEqual({ title: 'Shop', subtitle: '', logoUrl: 'upload:0123456789abcdef01234567' })
    expect(mssgBlockSchema('Hat')!.safeParse({ ...form, bgUrl: 'nope' }).success).toBe(false)
  })
  it('Features (v1.9): emoji or one of the 67 icons, required; an unknown glyph read from mssg is kept', () => {
    const s = mssgBlockSchema('Features')!
    expect(s.safeParse({ items: [{ title: 'A', content: 'x', glyph: { type: 'icon', icon: 'star' } }] }).success).toBe(true)
    expect(s.safeParse({ items: [{ title: 'A', content: 'x', glyph: { type: 'emoticon', text: '⭐' } }] }).success).toBe(true)
    const bad = s.safeParse({ items: [{ title: 'A', content: 'x', glyph: { type: 'icon', icon: 'heart' } }] })
    expect(bad.error!.issues[0]!.path).toEqual(['items', 0, 'glyph'])
    expect(s.safeParse({ items: [{ title: 'A', content: 'x', glyph: null }] }).success).toBe(false)
    expect(s.safeParse({ items: [{ title: 'A', content: 'x', glyph: { type: 'image', url: 'https://x.y/a.png' } }] }).success).toBe(false)
    // read from mssg (form rows carry the glyph read as `_glyph0`): unknown type / name round-trip
    const form = mssgBlockToForm('Features', { items: [{ title: 'B', content: '', glyph: { type: 'emoji', value: '⭐' } }, { title: 'C', content: '', glyph: { type: 'icon', icon: 'heart' } }] })
    expect(s.safeParse(form).success).toBe(true)
    expect(mssgFormToBlock('Features', form, {}).items).toEqual([
      { title: 'B', content: '', glyph: { type: 'emoji', value: '⭐' } },
      { title: 'C', content: '', glyph: { type: 'icon', icon: 'heart' } }
    ])
    expect(mssgBlockDefaults('Features')).toEqual({ items: [{ title: '', content: '', glyph: { type: 'emoticon', text: '⭐' } }] })
  })
  it('Messengers: platform → type pairs; unknown platforms read-only; redirectUrl never on create', () => {
    expect(mssgMessengerIssue({ platform: 'telegram', type: 'secret' })).toBeNull()
    expect(mssgMessengerIssue({ platform: 'instagram', type: 'private' })!.path).toBe('type')
    expect(mssgMessengerTypeFor('instagram', 'private')).toBe('auto')
    expect(mssgMessengerTypeFor('viber', 'public')).toBe('public')
    const s = mssgBlockSchema('Messengers')!
    expect(s.safeParse({ messengers: [{ platform: 'whatsapp', type: 'public', value: '+66', enabled: true }] }).success).toBe(true)
    expect(s.safeParse({ messengers: [{ platform: 'whatsapp', type: 'secret', value: '+66', enabled: true }] }).success).toBe(false)
    expect(s.safeParse({ messengers: [{ platform: 'line', type: 'whatever', value: '', enabled: 'x' }] }).success).toBe(true)
    expect(mssgCreateFields('Messengers', { messengers: [{ platform: 'telegram', type: 'auto', value: 'x', enabled: true, redirectUrl: 'r' }], redirectUrl: 'r' }))
      .toEqual({ messengers: [{ platform: 'telegram', type: 'auto', value: 'x', enabled: true }] })
  })
  it('Image / gallery action defaults to nothing; old images without action get it in the form', () => {
    expect(mssgBlockDefaults('Image')).toEqual({ url: '', action: { type: 'nothing' } })
    const form = mssgBlockToForm('ImageGallery', { images: [{ url: 'https://a.b/x.png' }], autoplay: 0 })
    expect((form.images as { action: unknown }[])[0]!.action).toEqual({ type: 'nothing' })
  })
})

describe('block style (§3.4)', () => {
  it('kind key, defaults from the live page (temp page → home), minus units', () => {
    expect(mssgStyleKindKey('ImageGallery')).toBe('imageGallery')
    const d = mssgStyleDefaults(site(), 'p1', 'Link')!
    expect(Object.keys(d)).toEqual(['borderRadius', 'backgroundColor', 'color', 'width', 'borderWidth', 'gap', 'linkMode'])
    expect(mssgStyleDefaults(site(), 'tmp-newpage1', 'Link')).toEqual(d)
    expect(mssgStyleDefaults(site(), 'p2', 'Link')).toBeNull()
    expect(mssgStyleDefaults(site(), 'p1', 'Messengers')).toBeNull()
  })
  it('controls and value rules', () => {
    const keys = mssgStyleKeys(mssgStyleDefaults(site(), 'p1', 'Link'))
    expect(keys.map(k => `${k.key}:${k.control}`)).toEqual(['borderRadius:number', 'backgroundColor:color', 'color:color', 'width:number', 'borderWidth:number', 'gap:number', 'linkMode:mode'])
    const by = (k: string) => keys.find(x => x.key === k)!
    expect(mssgStyleValueIssue(by('color'), '#AABBCC')).toBeNull()
    expect(mssgStyleValueIssue(by('color'), '#AABBCC80')).toBeNull()
    expect(mssgStyleValueIssue(by('color'), 'red')).not.toBeNull()
    expect(mssgStyleValueIssue(by('width'), 1001)).not.toBeNull()
    expect(mssgStyleValueIssue(by('width'), 0)).toBeNull()
    expect(mssgStyleValueIssue(by('linkMode'), 'tall')).toBeNull()
    expect(mssgStyleValueIssue(by('linkMode'), 'beefy')).not.toBeNull()
    expect(mssgStyleValueIssue(by('linkMode'), null)).toBeNull()
  })
  it('colour-named keys need a string/null default; booleans stay switches (BUG-100)', () => {
    const keys = mssgStyleKeys({ backgroundColor: '#FFFFFF', contrastedColor: false, themeColors: true, accentColor: null, linkMode: 'classic' })
    expect(keys.map(k => `${k.key}:${k.control}`)).toEqual(['backgroundColor:color', 'themeColors:boolean', 'accentColor:color', 'linkMode:mode'])
    expect(mssgStyleKeys({ contrastedColor: false })).toEqual([])
    // a stored contrastedColor is not a preview colour
    expect(mssgPreviewStyle({ theme: { blocks: { link: { contrastedColor: true } } } }, 'Link')).toEqual({ style: {}, mode: null })
  })
  it('override, patch (create drops null) and key-by-key folding', () => {
    expect(mssgStyleOverride(site().pages[0]!.blocks[0]!.fields, 'Link')).toEqual({ color: '#FF0000' })
    expect(mssgStylePatch('Link', { color: null, width: 50 })).toEqual({ blocks: { link: { color: null, width: 50 } } })
    expect(mssgStylePatch('Link', { color: null }, true)).toBeNull()
    let ops: MssgOp[] = mssgFoldBlockUpdate([], 'p1', 'b1', { fields: { theme: { blocks: { link: { width: 50 } } } } })
    ops = mssgFoldBlockUpdate(ops, 'p1', 'b1', { fields: { theme: { blocks: { link: { color: null } } } } })
    expect(ops).toEqual([{ op: 'block.update', pageId: 'p1', blockId: 'b1', fields: { theme: { blocks: { link: { width: 50, color: null } } } } }])
    // the preview removes the reset key, keeps units and the earlier key
    const out = mssgApplyOps(site(), ops)
    expect(out.pages[0]!.blocks[0]!.fields.theme).toEqual({ blocks: { link: { units: { width: '%' }, width: 50 } } })
    // a block created in the draft: nulls are dropped in its create op
    let c: MssgOp[] = [{ op: 'block.create', pageId: 'p1', tempId: 'tmp-abcd1234', kind: 'Link', fields: { title: 'x', theme: { blocks: { link: { gap: 4 } } } }, enabled: true }]
    c = mssgFoldBlockUpdate(c, 'p1', 'tmp-abcd1234', { fields: { theme: { blocks: { link: { gap: null, color: '#000000' } } } } })
    expect((c[0] as { fields: Record<string, unknown> }).fields.theme).toEqual({ blocks: { link: { color: '#000000' } } })
    expect(mssgMergeBlockTheme({ blocks: { link: { a: 1 } } }, { blocks: { link: { a: null } } }, false)).toEqual({ blocks: { link: { a: null } } })
  })
  it('preview style follows the override only', () => {
    expect(mssgPreviewStyle(site().pages[0]!.blocks[0]!.fields, 'Link')).toEqual({ style: { color: '#FF0000' }, mode: null })
    expect(mssgPreviewStyle({ theme: { blocks: { link: { linkMode: 'card', borderRadius: 12 } } } }, 'Link')).toEqual({ style: { 'border-radius': '12px' }, mode: 'card' })
  })
})

describe('menu (§3.4)', () => {
  it('rows: menu order, unlisted live pages appended hidden, gone / temp pages left out', () => {
    const rows = mssgMenuRows(site())
    expect(rows.map(r => `${r.page}:${r.label}:${r.enabled}`)).toEqual(['p2:About us:true', 'p1:Home:true'])
    const s = site()
    s.menu!.items = [{ page: 'p1', label: 'Home', enabled: true }]
    expect(mssgMenuRows(s).map(r => `${r.page}:${r.label}:${r.enabled}`)).toEqual(['p1:Home:true', 'p2:About:false'])
    expect(mssgMenuNewPages(site()).map(p => p.name)).toEqual(['Promo', 'Home Copy'])
    expect(mssgMenuRows({ ...site(), menu: null }).map(r => r.page)).toEqual(['p1', 'p2'])
  })
  it('move / set / items (whole ordered list, labels trimmed)', () => {
    const rows = mssgMenuRows(site())
    expect(mssgMenuMove(rows, 'p1', -1).map(r => r.page)).toEqual(['p1', 'p2'])
    expect(mssgMenuMove(rows, 'p2', -1)).toBe(rows)
    expect(mssgMenuItems(mssgMenuSet(rows, 'p2', { label: ' Team ', enabled: false })))
      .toEqual([{ page: 'p2', label: 'Team', enabled: false }, { page: 'p1', label: 'Home', enabled: true }])
    expect(mssgMenuLabelSchema.safeParse('  ').success).toBe(false)
    expect(mssgMenuLabelSchema.safeParse('x'.repeat(101)).success).toBe(false)
  })
  it('folds into the site.update: items replace, enabled merges', () => {
    let f: Record<string, unknown> = { name: 'Shop', menu: { enabled: false } }
    f = mssgMergeFields(f, { menu: { items: [{ page: 'p1', label: 'A', enabled: true }] } })
    f = mssgMergeFields(f, { menu: { items: [{ page: 'p2', label: 'B', enabled: true }, { page: 'p1', label: 'A', enabled: true }] } })
    expect(f).toEqual({ name: 'Shop', menu: { enabled: false, items: [{ page: 'p2', label: 'B', enabled: true }, { page: 'p1', label: 'A', enabled: true }] } })
    expect(mssgStepOf({ op: 'site.update' }, 'site.menu.items')).toBe(2)
    expect(mssgStepOf({ op: 'site.update' }, 'menu.items.0.label')).toBe(2)
  })
})
