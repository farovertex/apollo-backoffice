/**
 * FEAT-101 M2 (spec D4, AC-20..24; api-contract.md v1.3 §3.2 / §3.3) — the pure page / block helpers of the mssg
 * editor (`app/utils/mssg-blocks.ts`): the client "base + ops" preview, op folding, temp-object drops, the zod rules
 * per kind and the error / conflict targets. Imported by relative path (no Nuxt runtime).
 */
import { describe, expect, it } from 'vitest'
import {
  MSSG_BLOCK_KINDS,
  MSSG_BLOCK_SCHEMAS,
  mssgApplyOps,
  mssgBlockDefaults,
  mssgBlockToForm,
  mssgChangedKeys,
  mssgDropTempBlock,
  mssgDropTempPage,
  mssgFoldBlockUpdate,
  mssgFoldPageUpdate,
  mssgFormToBlock,
  mssgHtmlToText,
  mssgIsAudioUrl,
  mssgLocalPreview,
  mssgOpTarget,
  mssgPageBlockLabel,
  mssgSuggestSlug,
  mssgTempId,
  mssgTextToHtml,
  MSSG_TEMP_ID_RE
} from '../../app/utils/mssg-blocks'
import type { MssgOp, MssgSiteProjection } from '../../shared/types/mssg-sites'

const site = (): MssgSiteProjection => ({
  id: 's', name: 'My shop', enabled: true, subdomain: 'myshop', apexDomain: 'mssg.me', domain: null, finalUrl: '', branding: true,
  localization: { lang: 'en' }, seo: { title: '', description: '', indexing: true, faviconUrl: null, ogImageUrl: null },
  tracking: { google: '', facebook: '', tiktok: '' }, embeddedCode: { content: '', inHead: false, onLoad: false },
  homePageId: 'p1', crm: null,
  pages: [
    { id: 'p1', name: 'Homepage', slug: 'home', enabled: true, seo: { title: '', description: '' }, theme: null, blocks: [
      { id: 'b1', kind: 'Hat', enabled: true, fields: { title: 'Hi' } },
      { id: 'b2', kind: 'Link', enabled: true, fields: { title: 'Go', action: { type: 'url', url: 'https://a.b' }, schemaVersion: 2, items: [] } },
      { id: 'b3', kind: 'TextRich', enabled: false, fields: { html: '<p>x</p>' } }
    ] },
    { id: 'p2', name: 'About', slug: 'about', enabled: true, seo: { title: '', description: '' }, theme: null, blocks: [] }
  ]
})

describe('kinds and ids', () => {
  it('has the 19 contract kinds, each with a schema', () => {
    expect(MSSG_BLOCK_KINDS).toHaveLength(19)
    for (const k of MSSG_BLOCK_KINDS) expect(MSSG_BLOCK_SCHEMAS[k.kind]).toBeDefined()
  })
  it('temp ids match the contract pattern', () => {
    for (let i = 0; i < 50; i++) expect(mssgTempId()).toMatch(MSSG_TEMP_ID_RE)
  })
})

describe('mssgApplyOps', () => {
  it('creates, updates, moves, clones, hides and deletes', () => {
    const ops: MssgOp[] = [
      { op: 'page.create', tempId: 'tmp-aaaa1', name: 'Shop', slug: 'shop' },
      { op: 'block.create', pageId: 'tmp-aaaa1', tempId: 'tmp-bbbb1', kind: 'Divider', fields: {}, enabled: true },
      { op: 'page.setHome', pageId: 'tmp-aaaa1' },
      { op: 'block.move', pageId: 'p1', blockId: 'b3', toIndex: 0 },
      { op: 'block.clone', pageId: 'p1', blockId: 'b1', tempId: 'tmp-cccc1' },
      { op: 'block.update', pageId: 'p1', blockId: 'b2', fields: { title: 'Buy' }, enabled: false },
      { op: 'block.delete', pageId: 'p1', blockId: 'b1' },
      { op: 'page.update', pageId: 'p2', fields: { name: 'About us', seo: { title: 'T' } } }
    ]
    const out = mssgApplyOps(site(), ops)
    expect(out.homePageId).toBe('tmp-aaaa1')
    expect(out.pages.map(p => p.id)).toEqual(['p1', 'p2', 'tmp-aaaa1'])
    expect(out.pages[0]!.blocks.map(b => b.id)).toEqual(['b3', 'tmp-cccc1', 'b2'])
    const b2 = out.pages[0]!.blocks[2]!
    expect(b2.fields).toMatchObject({ title: 'Buy', schemaVersion: 2 })
    expect(b2.enabled).toBe(false)
    expect(out.pages[1]).toMatchObject({ name: 'About us', seo: { title: 'T', description: '' } })
    expect(out.pages[2]!.blocks).toHaveLength(1)
  })
  it('clones a page as "<name> Copy" with a free slug and synthetic block ids', () => {
    const out = mssgApplyOps(site(), [{ op: 'page.clone', pageId: 'p1', tempId: 'tmp-dddd1' }])
    expect(out.pages[1]).toMatchObject({ id: 'tmp-dddd1', name: 'Homepage Copy', slug: 'home-copy' })
    expect(out.pages[1]!.blocks.map(b => b.id)).toEqual(['tmp-dddd1:0', 'tmp-dddd1:1', 'tmp-dddd1:2'])
  })
  it('does not mutate its input', () => {
    const s = site()
    mssgApplyOps(s, [{ op: 'page.delete', pageId: 'p2' }])
    expect(s.pages).toHaveLength(2)
  })
})

describe('mssgLocalPreview', () => {
  const live = site()
  it('lays the unsaved tail over the server preview', () => {
    const saved: MssgOp[] = [{ op: 'block.update', pageId: 'p1', blockId: 'b1', fields: { header: 'A' } }]
    const server = mssgApplyOps(live, saved)
    const local: MssgOp[] = [{ op: 'block.update', pageId: 'p1', blockId: 'b1', fields: { header: 'AB' } }, { op: 'page.delete', pageId: 'p2' }]
    const out = mssgLocalPreview(server, saved, live, local)!
    expect(out.pages[0]!.blocks[0]!.fields.header).toBe('AB')
    expect(out.pages).toHaveLength(1)
  })
  it('returns the server preview when nothing is pending', () => {
    const server = mssgApplyOps(live, [])
    expect(mssgLocalPreview(server, [], live, [])).toBe(server)
  })
  it('falls back to live + all ops when a saved op was removed', () => {
    const saved: MssgOp[] = [{ op: 'page.delete', pageId: 'p2' }]
    const server = mssgApplyOps(live, saved)
    expect(mssgLocalPreview(server, saved, live, [])!.pages).toHaveLength(2)
  })
})

describe('folding', () => {
  it('folds page edits into one page.update, and into page.create for a temp page', () => {
    let ops: MssgOp[] = []
    ops = mssgFoldPageUpdate(ops, 'p2', { name: 'A' })
    ops = mssgFoldPageUpdate(ops, 'p2', { seo: { title: 'x' } })
    ops = mssgFoldPageUpdate(ops, 'p2', { name: 'Ab' })
    expect(ops).toEqual([{ op: 'page.update', pageId: 'p2', fields: { name: 'Ab', seo: { title: 'x' } } }])
    ops = [{ op: 'page.create', tempId: 'tmp-aaaa1', name: 'New', slug: 'new' }]
    ops = mssgFoldPageUpdate(ops, 'tmp-aaaa1', { name: 'Newer', seo: { description: 'd' } })
    expect(ops[0]).toMatchObject({ op: 'page.create', name: 'Newer' })
    expect(ops[1]).toEqual({ op: 'page.update', pageId: 'tmp-aaaa1', fields: { seo: { description: 'd' } } })
  })
  it('folds block edits; a temp block takes them into its create', () => {
    let ops: MssgOp[] = [{ op: 'block.create', pageId: 'p1', tempId: 'tmp-bbbb1', kind: 'Link', fields: { title: 'a' }, enabled: true }]
    ops = mssgFoldBlockUpdate(ops, 'p1', 'tmp-bbbb1', { fields: { title: 'b' }, enabled: false })
    expect(ops).toEqual([{ op: 'block.create', pageId: 'p1', tempId: 'tmp-bbbb1', kind: 'Link', fields: { title: 'b' }, enabled: false }])
    ops = mssgFoldBlockUpdate(ops, 'p1', 'b1', { enabled: false })
    ops = mssgFoldBlockUpdate(ops, 'p1', 'b1', { fields: { header: 'z' } })
    expect(ops[1]).toEqual({ op: 'block.update', pageId: 'p1', blockId: 'b1', enabled: false, fields: { header: 'z' } })
  })
})

describe('dropping temp objects', () => {
  it('drops a temp block and its edits', () => {
    const ops: MssgOp[] = [
      { op: 'block.create', pageId: 'p1', tempId: 'tmp-bbbb1', kind: 'Divider', fields: {}, enabled: true },
      { op: 'block.update', pageId: 'p1', blockId: 'tmp-bbbb1', enabled: false },
      { op: 'page.update', pageId: 'p1', fields: { name: 'X' } }
    ]
    expect(mssgDropTempBlock(ops, 'p1', 'tmp-bbbb1')).toEqual([ops[2]])
  })
  it('keeps the ops (null → send a delete) for a real id, a clone source or a later move', () => {
    expect(mssgDropTempBlock([], 'p1', 'b1')).toBeNull()
    expect(mssgDropTempBlock([
      { op: 'block.create', pageId: 'p1', tempId: 'tmp-bbbb1', kind: 'Divider', fields: {}, enabled: true },
      { op: 'block.clone', pageId: 'p1', blockId: 'tmp-bbbb1', tempId: 'tmp-cccc1' }
    ], 'p1', 'tmp-bbbb1')).toBeNull()
    expect(mssgDropTempBlock([
      { op: 'block.create', pageId: 'p1', tempId: 'tmp-bbbb1', kind: 'Divider', fields: {}, enabled: true },
      { op: 'block.move', pageId: 'p1', blockId: 'b1', toIndex: 2 }
    ], 'p1', 'tmp-bbbb1')).toBeNull()
  })
  it('drops a temp page with everything on it', () => {
    const ops: MssgOp[] = [
      { op: 'page.create', tempId: 'tmp-aaaa1', name: 'Shop', slug: 'shop' },
      { op: 'block.create', pageId: 'tmp-aaaa1', tempId: 'tmp-bbbb1', kind: 'Divider', fields: {}, enabled: true },
      { op: 'site.update', fields: { name: 'n' } }
    ]
    expect(mssgDropTempPage(ops, 'tmp-aaaa1')).toEqual([ops[2]])
    expect(mssgDropTempPage(ops, 'p1')).toBeNull()
  })
})

describe('rules', () => {
  const ok = (kind: string, form: unknown) => MSSG_BLOCK_SCHEMAS[kind]!.safeParse(form).success
  it('Link: title 1–250 and an http(s) url or an internal page', () => {
    expect(ok('Link', { title: 'Go', action: { type: 'url', url: 'https://x.y' } })).toBe(true)
    expect(ok('Link', { title: 'Go', action: { type: 'url', url: 'ftp://x.y' } })).toBe(false)
    expect(ok('Link', { title: '', action: { type: 'page', page: 'p1' } })).toBe(false)
    expect(ok('Link', { title: 'Go', action: { type: 'page', page: 'p1' } })).toBe(true)
    // v1.6: tel / email / sms / anchor are editable (a type mssg holds that Apollo does not know stays as read)
    expect(ok('Link', { title: 'Go', action: { type: 'tel', url: '+66 81 234 5678' } })).toBe(true)
    expect(ok('Link', { title: 'Go', action: { type: 'tel', url: 'tel:0812' } })).toBe(false)
    expect(ok('Link', { title: 'Go', action: { type: 'whatsappChat', phone: '1' } })).toBe(true)
  })
  it('Map 10–300, Accordion items 3+, AudioEmbed hosts, Image needs an upload or url', () => {
    expect(ok('Map', { address: 'short' })).toBe(false)
    expect(ok('Accordion', { items: [{ title: 'ab', content: 'abc' }] })).toBe(false)
    expect(ok('Accordion', { items: [] })).toBe(false)
    expect(mssgIsAudioUrl('https://open.spotify.com/track/1')).toBe(true)
    expect(mssgIsAudioUrl('https://vimeo.com/1')).toBe(false)
    expect(ok('Image', { url: 'upload:0123456789abcdef01234567', action: { type: 'nothing' } })).toBe(true)
    expect(ok('Image', { url: '', action: { type: 'nothing' } })).toBe(false)
  })
  it('default fields of every kind are invalid only where the contract requires input', () => {
    const optional = ['Hat', 'Divider', 'Products', 'SubscriptionForm']
    for (const { kind } of MSSG_BLOCK_KINDS) {
      const form = mssgBlockToForm(kind, mssgBlockDefaults(kind))
      expect(ok(kind, form), kind).toBe(optional.includes(kind))
    }
  })
  it('slug suggestion is latin, unique', () => {
    expect(mssgSuggestSlug('About Us!', ['about-us'])).toBe('about-us-2')
    expect(mssgSuggestSlug('หน้าใหม่', [])).toBe('page')
  })
})

describe('form adapters', () => {
  it('TextRich keeps html + editorState when the text is unchanged, rebuilds them otherwise', () => {
    const orig = { html: '<p>Hello <b>w</b></p>', editorState: { x: 1 } }
    const form = mssgBlockToForm('TextRich', orig)
    expect(form.text).toBe('Hello w')
    expect(mssgFormToBlock('TextRich', form, orig)).toEqual(orig)
    expect(mssgFormToBlock('TextRich', { text: 'a < b\n\nc' }, orig)).toEqual({ html: '<p>a &lt; b</p><p>c</p>', editorState: null })
    expect(mssgHtmlToText(mssgTextToHtml('x\ny'))).toBe('x\ny')
  })
  it('changed keys only', () => {
    expect(mssgChangedKeys({ title: 'a', action: { type: 'url', url: 'u' } }, { title: 'a', action: { type: 'url', url: 'v' } })).toEqual({ action: { type: 'url', url: 'u' } })
  })
})

describe('error targets and labels', () => {
  const ops: MssgOp[] = [
    { op: 'page.update', pageId: 'p2', fields: { name: 'x' } },
    { op: 'block.create', pageId: 'p1', tempId: 'tmp-bbbb1', kind: 'Link', fields: {}, enabled: true },
    { op: 'block.move', pageId: 'p1', blockId: 'b2', toIndex: 0 }
  ]
  it('takes page / block from the op, strips fields.', () => {
    expect(mssgOpTarget(ops[0], 'fields.name')).toEqual({ pageId: 'p2', blockId: null, field: 'name' })
    expect(mssgOpTarget(ops[1], 'fields.title')).toEqual({ pageId: 'p1', blockId: 'tmp-bbbb1', field: 'title' })
    expect(mssgOpTarget(null, 'pages.p1.blocks.b2.fields.title')).toEqual({ pageId: 'p1', blockId: 'b2', field: 'title' })
  })
  it('v1.4 id paths carry the ids themselves (page look, order, gone objects)', () => {
    expect(mssgOpTarget(null, 'pages.p1.theme.page.backgroundColor')).toEqual({ pageId: 'p1', blockId: null, field: 'theme.page.backgroundColor' })
    expect(mssgOpTarget(ops[0], 'pages.p1.order')).toEqual({ pageId: 'p1', blockId: null, field: 'order' })
    expect(mssgOpTarget(null, 'pages.p1.blocks.b2.enabled')).toEqual({ pageId: 'p1', blockId: 'b2', field: 'enabled' })
    expect(mssgOpTarget(null, 'pages.p1.blocks.b2')).toEqual({ pageId: 'p1', blockId: 'b2', field: '' })
    expect(mssgOpTarget(null, 'pages.p1')).toEqual({ pageId: 'p1', blockId: null, field: '' })
    expect(mssgOpTarget(null, 'site.seo.title')).toEqual({ pageId: null, blockId: null, field: 'site.seo.title' })
  })
  it('labels the page background fields', () => {
    expect(mssgPageBlockLabel(null, 'pages.p1.theme.page.backgroundColor', [site()])).toBe('หน้า "Homepage" · สีพื้นหลังของหน้า')
    expect(mssgPageBlockLabel(null, 'pages.p1.theme.page.backgroundImage', [site()])).toBe('หน้า "Homepage" · รูปพื้นหลังของหน้า')
  })
  it('names pages, blocks and the block order', () => {
    const s = site()
    expect(mssgPageBlockLabel(ops[0], 'name', [s])).toBe('หน้า "About" · ชื่อหน้า')
    expect(mssgPageBlockLabel(null, 'pages.p1.blocks.b2.fields.title', [s])).toBe('block ลิงก์ ในหน้า "Homepage" · ชื่อ')
    expect(mssgPageBlockLabel(ops[2], 'pages.p1.order', [s])).toBe('ลำดับ block ในหน้า "Homepage"')
    expect(mssgPageBlockLabel({ op: 'site.update', fields: {} }, 'site.name', [s])).toBeNull()
  })
})
