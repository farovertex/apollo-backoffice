/**
 * FEAT-101 B9 (spec D18, AC-59, AC-60; api-contract.md v1.9 §3.5) — Link items and glyphs: the icon list, glyph
 * round-trip (incl. unknown glyphs), the Link item ↔ op mapping (ids kept, `image` / row keys never sent, legacy
 * `title` / `action` → item 0), max 30 / last-row rule, and where a per-link error / conflict path lands.
 * Imported by relative path (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import {
  MSSG_GLYPH_FEATURES,
  MSSG_GLYPH_ICONS,
  MSSG_GLYPH_ICONS_GENERAL,
  MSSG_GLYPH_ICONS_SOCIAL,
  MSSG_GLYPH_ICON_UI,
  MSSG_GLYPH_LINK,
  mssgGlyphInfo,
  mssgGlyphIssue,
  mssgGlyphOut
} from '../../app/utils/mssg-glyphs'
import {
  MSSG_LINK_ITEMS_MAX,
  mssgApplyOps,
  mssgBlockDefaults,
  mssgBlockSchema,
  mssgBlockSummary,
  mssgBlockToForm,
  mssgChangedKeys,
  mssgCreateFields,
  mssgFoldBlockUpdate,
  mssgFormToBlock,
  mssgLinkCanAdd,
  mssgLinkItems,
  mssgOpTarget,
  mssgPageBlockLabel,
  mssgRowsMove,
  mssgRowsRemove
} from '../../app/utils/mssg-blocks'
import type { MssgOp, MssgSiteProjection } from '../../shared/types/mssg-sites'

const IMG = { type: 'icon', url: 'https://cdn.example/card.png' }

/** a Link with 3 links read from mssg: icon + card image, emoji, uploaded image; plus one unknown glyph */
function linkFields() {
  return {
    items: [
      { id: 'i1', title: 'Shop', action: { type: 'url', url: 'https://shop.example' }, glyph: { type: 'icon', icon: 'shopping_cart' }, image: IMG },
      { id: 'i2', title: 'Chat', action: { type: 'tel', url: '+66 81 234 5678' }, glyph: { type: 'emoticon', text: '💬' } },
      { id: 'i3', title: 'Logo', action: { type: 'page', page: 'p1' }, glyph: { type: 'image', url: 'https://cdn.example/g.png' } },
      { id: 'i4', title: 'Old', action: { type: 'url', url: 'https://old.example' }, glyph: { type: 'icon', icon: 'twitter' } }
    ],
    theme: { blocks: { link: { gap: 4 } } }
  }
}

function site(): MssgSiteProjection {
  return {
    name: 'S', subdomain: 's', apexDomain: 'mssg.me', enabled: true, branding: true, homePageId: 'p1',
    localization: { lang: 'th' }, seo: { title: '', description: '', indexing: true, faviconUrl: null, ogImageUrl: null },
    tracking: { google: '', facebook: '', tiktok: '' }, embeddedCode: { content: '', inHead: false, onLoad: false },
    pages: [{ id: 'p1', name: 'Home', slug: 'home', enabled: true, seo: { title: '', description: '' }, theme: null, blocks: [{ id: 'b2', kind: 'Link', enabled: true, fields: linkFields() }] }]
  } as unknown as MssgSiteProjection
}

describe('icon list (contract §3.5)', () => {
  // the contract's prose says "67 names" / "social 55", but its list (copied verbatim) holds 54 social names → 66
  it('12 general + 54 social names exactly as listed in the contract, unique, each with a local glyph, no aliases', () => {
    expect(MSSG_GLYPH_ICONS_GENERAL).toHaveLength(12)
    expect(MSSG_GLYPH_ICONS_SOCIAL).toHaveLength(54)
    expect(new Set(MSSG_GLYPH_ICONS).size).toBe(66)
    for (const n of MSSG_GLYPH_ICONS) expect(MSSG_GLYPH_ICON_UI[n]).toMatch(/^i-(lucide|simple-icons)-/)
    for (const alias of ['play', 'twitter', 'wa', 'youtu', 't']) expect(MSSG_GLYPH_ICONS).not.toContain(alias)
  })
})

describe('glyph info and rules', () => {
  it('classifies icon / emoticon / image / none / unknown', () => {
    expect(mssgGlyphInfo({ type: 'icon', icon: 'star' })).toEqual({ type: 'icon', value: 'star', ui: 'i-lucide-star' })
    expect(mssgGlyphInfo({ type: 'emoticon', text: '🔥' })).toEqual({ type: 'emoticon', value: '🔥' })
    expect(mssgGlyphInfo({ type: 'image', url: 'upload:0123456789abcdef01234567' })).toMatchObject({ type: 'image' })
    expect(mssgGlyphInfo(null)).toEqual({ type: 'none', value: '' })
    expect(mssgGlyphInfo(undefined)).toEqual({ type: 'none', value: '' })
    expect(mssgGlyphInfo({ type: 'icon', icon: 'twitter' })).toEqual({ type: 'unknown', value: 'twitter' })
    expect(mssgGlyphInfo({ type: 'emoji', value: '⭐' })).toEqual({ type: 'unknown', value: 'emoji' })
    expect(mssgGlyphInfo({ type: 'icon' })).toEqual({ type: 'unknown', value: 'icon' })
  })
  it('Link: none / icon / emoji 1–16 / image; Features: no none, no image', () => {
    expect(mssgGlyphIssue(null, undefined, MSSG_GLYPH_LINK)).toBeNull()
    expect(mssgGlyphIssue(null, undefined, MSSG_GLYPH_FEATURES)).not.toBeNull()
    expect(mssgGlyphIssue({ type: 'icon', icon: 'tiktok' }, null, MSSG_GLYPH_LINK)).toBeNull()
    expect(mssgGlyphIssue({ type: 'icon', icon: 'heart' }, null, MSSG_GLYPH_LINK)).not.toBeNull()
    expect(mssgGlyphIssue({ type: 'emoticon', text: ' 🙂 ' }, null, MSSG_GLYPH_LINK)).toBeNull()
    expect(mssgGlyphIssue({ type: 'emoticon', text: '   ' }, null, MSSG_GLYPH_LINK)).not.toBeNull()
    expect(mssgGlyphIssue({ type: 'emoticon', text: 'x'.repeat(17) }, null, MSSG_GLYPH_LINK)).not.toBeNull()
    expect(mssgGlyphIssue({ type: 'image', url: 'upload:0123456789abcdef01234567' }, null, MSSG_GLYPH_LINK)).toBeNull()
    expect(mssgGlyphIssue({ type: 'image', url: 'ftp://x' }, null, MSSG_GLYPH_LINK)).not.toBeNull()
    expect(mssgGlyphIssue({ type: 'image', url: 'upload:0123456789abcdef01234567' }, null, MSSG_GLYPH_FEATURES)).not.toBeNull()
    expect(mssgGlyphIssue({ type: 'svg', icon: 'x' }, null, MSSG_GLYPH_LINK)).not.toBeNull()
  })
  it('an unknown glyph read from mssg is valid and sent back unchanged; another pick replaces it', () => {
    const read = { type: 'icon', icon: 'twitter', extra: 1 }
    expect(mssgGlyphIssue({ ...read }, read, MSSG_GLYPH_LINK)).toBeNull()
    expect(mssgGlyphIssue({ ...read }, read, MSSG_GLYPH_FEATURES)).toBeNull()
    expect(mssgGlyphOut({ ...read }, read)).toEqual(read)
    expect(mssgGlyphOut({ type: 'icon', icon: 'x' }, read)).toEqual({ type: 'icon', icon: 'x' })
    expect(mssgGlyphOut({ type: 'emoticon', text: ' 🙂 ' }, null)).toEqual({ type: 'emoticon', text: '🙂' })
    expect(mssgGlyphOut(undefined, null)).toBeNull()
  })
})

describe('Link items ↔ op (§3.5)', () => {
  it('form rows keep ids, the glyph read and the card image; the op sends items only, never image / row keys', () => {
    const original = linkFields()
    const form = mssgBlockToForm('Link', original) as { items: Record<string, unknown>[] }
    expect(form.items).toHaveLength(4)
    expect(form.items[0]).toMatchObject({ id: 'i1', title: 'Shop', image: IMG, _glyph0: { type: 'icon', icon: 'shopping_cart' } })
    expect(typeof form.items[0]!._key).toBe('string')
    expect(mssgBlockSchema('Link')!.safeParse(form).success).toBe(true)
    const out = mssgFormToBlock('Link', form, original)
    expect(Object.keys(out)).toEqual(['items'])
    expect(out.items).toEqual([
      { id: 'i1', title: 'Shop', action: { type: 'url', url: 'https://shop.example' }, glyph: { type: 'icon', icon: 'shopping_cart' } },
      { id: 'i2', title: 'Chat', action: { type: 'tel', url: '+66 81 234 5678' }, glyph: { type: 'emoticon', text: '💬' } },
      { id: 'i3', title: 'Logo', action: { type: 'page', page: 'p1' }, glyph: { type: 'image', url: 'https://cdn.example/g.png' } },
      { id: 'i4', title: 'Old', action: { type: 'url', url: 'https://old.example' }, glyph: { type: 'icon', icon: 'twitter' } }
    ])
    expect(JSON.stringify(out)).not.toMatch(/"image":|_key|_glyph0/)
    // unchanged → nothing to send
    const baseline = mssgFormToBlock('Link', mssgBlockToForm('Link', original), original)
    expect(mssgChangedKeys(out, baseline)).toEqual({})
  })
  it('a new row has no id; reorder / remove / glyph change send the whole list in the new order', () => {
    const original = linkFields()
    const form = mssgBlockToForm('Link', original) as { items: Record<string, unknown>[] }
    form.items = mssgRowsMove(form.items, 2, -1)
    form.items = mssgRowsRemove(form.items, 3)
    form.items.push({ _key: 'rX', title: ' New ', action: { type: 'url', url: 'https://n.example' }, glyph: { type: 'icon', icon: 'star' }, _glyph0: null })
    form.items[0]!.glyph = null
    const out = mssgFormToBlock('Link', form, original).items as Record<string, unknown>[]
    expect(out.map(i => i.id)).toEqual(['i1', 'i3', 'i2', undefined])
    expect(out[3]).toEqual({ title: 'New', action: { type: 'url', url: 'https://n.example' }, glyph: { type: 'icon', icon: 'star' } })
    expect(out[0]!.glyph).toBeNull()
  })
  it('max 30 links, at least 1; the last row is never removed; moves stop at the ends', () => {
    const s = mssgBlockSchema('Link')!
    const item = { title: 'A', action: { type: 'url', url: 'https://a.b' }, glyph: null }
    expect(s.safeParse({ items: Array.from({ length: MSSG_LINK_ITEMS_MAX }, () => item) }).success).toBe(true)
    expect(s.safeParse({ items: Array.from({ length: MSSG_LINK_ITEMS_MAX + 1 }, () => item) }).success).toBe(false)
    const empty = s.safeParse({ items: [] })
    expect(empty.error!.issues[0]!.path).toEqual(['items'])
    expect(mssgLinkCanAdd(29)).toBe(true)
    expect(mssgLinkCanAdd(30)).toBe(false)
    expect(mssgRowsRemove(['a'], 0)).toEqual(['a'])
    expect(mssgRowsRemove(['a', 'b'], 0)).toEqual(['b'])
    expect(mssgRowsMove(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(mssgRowsMove(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
    expect(mssgRowsMove(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
  })
  it('a glyph error lands on the row (zod path items.<j>.glyph)', () => {
    const form = mssgBlockToForm('Link', linkFields()) as { items: Record<string, unknown>[] }
    form.items[1]!.glyph = { type: 'emoticon', text: '' }
    const r = mssgBlockSchema('Link')!.safeParse(form)
    expect(r.error!.issues[0]!.path).toEqual(['items', 1, 'glyph'])
  })
  it('new block: one empty link, created with items only', () => {
    expect(mssgBlockDefaults('Link')).toEqual({ items: [{ title: '', action: { type: 'url', url: '' }, glyph: null }] })
    const form = mssgBlockToForm('Link', mssgBlockDefaults('Link')) as { items: Record<string, unknown>[] }
    form.items[0]!.title = 'Go'
    form.items[0]!.action = { type: 'url', url: 'https://go.example' }
    expect(mssgCreateFields('Link', mssgFormToBlock('Link', form, {}))).toEqual({ items: [{ title: 'Go', action: { type: 'url', url: 'https://go.example' }, glyph: null }] })
  })
  it('legacy: top-level title / action → item 0 (read and old draft ops)', () => {
    expect(mssgLinkItems({ title: 'Go', action: { type: 'url', url: 'https://a.b' } })).toEqual([{ title: 'Go', action: { type: 'url', url: 'https://a.b' }, glyph: null }])
    const form = mssgBlockToForm('Link', { title: 'Go', action: { type: 'url', url: 'https://a.b' } }) as { items: unknown[] }
    expect(form.items).toHaveLength(1)
    expect(mssgLinkItems({ ...linkFields(), title: 'Shop!' })[0]).toMatchObject({ id: 'i1', title: 'Shop!' })
    // an old draft's legacy op folded with a new items edit: title / action are dropped (never both in one op)
    let ops: MssgOp[] = [{ op: 'block.update', pageId: 'p1', blockId: 'b2', fields: { title: 'Old', action: { type: 'url', url: 'https://o.b' } } }]
    ops = mssgFoldBlockUpdate(ops, 'p1', 'b2', { fields: { items: [{ id: 'i1', title: 'A', action: { type: 'url', url: 'https://a.b' }, glyph: null }] } })
    expect((ops[0] as { fields: Record<string, unknown> }).fields).toEqual({ items: [{ id: 'i1', title: 'A', action: { type: 'url', url: 'https://a.b' }, glyph: null }] })
  })
  it('the preview keeps an item card image by id after an items edit, and shows every link', () => {
    const items = [
      { id: 'i2', title: 'Chat', action: { type: 'tel', url: '+66 81 234 5678' }, glyph: null },
      { id: 'i1', title: 'Shop 2', action: { type: 'url', url: 'https://shop.example' }, glyph: { type: 'icon', icon: 'star' } }
    ]
    const out = mssgApplyOps(site(), [{ op: 'block.update', pageId: 'p1', blockId: 'b2', fields: { items } }])
    const f = out.pages[0]!.blocks[0]!.fields
    expect(f.items).toEqual([items[0], { ...items[1], image: IMG }])
    expect(f.theme).toEqual({ blocks: { link: { gap: 4 } } })
    expect(mssgBlockSummary({ kind: 'Link', fields: f })).toBe('Chat และอีก 1 ลิงก์')
  })
})

describe('per-link errors and conflicts (paths)', () => {
  it('apply / conflict path pages.<p>.blocks.<b>.fields.items.<j>.<leaf> → block field items.<j>.<leaf>', () => {
    expect(mssgOpTarget(null, 'pages.p1.blocks.b2.fields.items.1.title')).toEqual({ pageId: 'p1', blockId: 'b2', field: 'items.1.title' })
    expect(mssgOpTarget(null, 'pages.p1.blocks.b2.fields.items.2.glyph.type')).toEqual({ pageId: 'p1', blockId: 'b2', field: 'items.2.glyph.type' })
    expect(mssgOpTarget(null, 'pages.p1.blocks.b2.fields.items')).toEqual({ pageId: 'p1', blockId: 'b2', field: 'items' })
  })
  it('draft 400 ops.<n>.fields.items.<j>.<leaf> → the op\'s block, row j', () => {
    const op: MssgOp = { op: 'block.update', pageId: 'p1', blockId: 'b2', fields: { items: [] } }
    expect(mssgOpTarget(op, 'fields.items.1.glyph')).toEqual({ pageId: 'p1', blockId: 'b2', field: 'items.1.glyph' })
  })
  it('labels name the link', () => {
    expect(mssgPageBlockLabel(null, 'pages.p1.blocks.b2.fields.items.1.title', [site()])).toBe('block ลิงก์ ในหน้า "Home" · ลิงก์ ที่ 2 · ชื่อ')
    expect(mssgPageBlockLabel(null, 'pages.p1.blocks.b2.fields.items.0.glyph.icon', [site()])).toBe('block ลิงก์ ในหน้า "Home" · ลิงก์ ที่ 1 · ไอคอน')
  })
})
