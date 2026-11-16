/**
 * FEAT-101 M2 (spec D4, AC-20..26; api-contract.md v1.3 §3.2, §3.3) — pages and blocks of the mssg site editor.
 *
 * Pure helpers only (explicit imports, no Nuxt auto-imports) so `tests/unit/mssg-blocks.test.ts` can run them:
 * - the 19 block kinds with the contract's Thai labels and the design's English names (`MSSG_BLOCK_KINDS`);
 * - temp ids (`tmp-…`) for pages / blocks created in the draft;
 * - `mssgApplyOps()` — a client copy of "preview = base + ops" so the editor and the mobile preview follow an edit
 *   at once (the server's `preview` stays the authority; `mssgLocalPreview()` lays only the not-yet-saved ops over it);
 * - op folding: edits of the same page / block fold into one op, edits of an object created in the draft fold into
 *   its create op, deleting an object created in the draft drops its ops instead of sending a delete;
 * - the zod rules per page / block kind (contract §3.3, Thai messages) and their form adapters;
 * - where a field error / conflict item points to (page, block, field) and its Thai label.
 * v1.6 (B2r): proven shapes (`Hat {title, subtitle, logoUrl, bgUrl}`, `Features.items[].glyph {type:"icon", icon}`,
 * `Messengers.messengers[] {platform, type, value, enabled}`, `ImageGallery.images[] {url, action}`), the actions of §3.4
 * (`mssg-actions.ts`), block style overrides folded key by key (`mssg-style.ts`), page presets / fonts (`mssg-look.ts`).
 * v1.9 (B9, §3.5): a Link block = `items[]` 1–30 of `{ id?, title, action, glyph }` (item `image` read-only: never sent,
 * kept in the local preview by id); legacy top-level `title` / `action` (old drafts, legacy reads) map onto item 0;
 * Link / Features glyphs follow `mssg-glyphs.ts` (an unknown glyph read from mssg round-trips unchanged).
 */
import * as z from 'zod'
import type {
  MssgBlockProjection,
  MssgConflictItem,
  MssgOp,
  MssgOpBlockCreate,
  MssgOpBlockUpdate,
  MssgOpPageCreate,
  MssgOpPageUpdate,
  MssgPageProjection,
  MssgSiteProjection
} from '../../shared/types/mssg-sites'
import type { MssgActionContext } from './mssg-actions'
import { mssgActionIssues, mssgActionOut, mssgMessengerEditable, mssgMessengerIssue } from './mssg-actions'
import { MSSG_GLYPH_FEATURES, MSSG_GLYPH_LINK, mssgGlyphIssue, mssgGlyphOut } from './mssg-glyphs'
import { mssgMergeBlockTheme } from './mssg-style'

// ── kinds ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MssgBlockKindDef {
  kind: string
  /** contract §3.3 Thai label */
  th: string
  /** the design's English name ("Choose block") */
  en: string
  /** short glyph of the design's grid */
  glyph: string
}

/** contract §3.3, in the design's grid order */
export const MSSG_BLOCK_KINDS: MssgBlockKindDef[] = [
  { kind: 'Hat', th: 'ภาพปก/โปรไฟล์', en: 'Profile', glyph: 'Pf' },
  { kind: 'TextRich', th: 'ข้อความ', en: 'Text', glyph: 'T' },
  { kind: 'Link', th: 'ลิงก์', en: 'Links', glyph: 'Lk' },
  { kind: 'SubscriptionForm', th: 'ฟอร์ม', en: 'Form', glyph: 'Fm' },
  { kind: 'Messengers', th: 'ปุ่มแชท', en: 'Messengers', glyph: 'Ms' },
  { kind: 'Socials', th: 'โซเชียล', en: 'Socials', glyph: 'So' },
  { kind: 'Divider', th: 'เส้นคั่น', en: 'Divider', glyph: '—' },
  { kind: 'Products', th: 'สินค้า', en: 'Products Catalog', glyph: 'Pd' },
  { kind: 'Image', th: 'รูปภาพ', en: 'Image', glyph: 'Im' },
  { kind: 'ImageGallery', th: 'แกลเลอรี', en: 'Image Gallery', glyph: 'IG' },
  { kind: 'Features', th: 'จุดเด่น', en: 'Features', glyph: 'Ft' },
  { kind: 'Accordion', th: 'คำถามพบบ่อย', en: 'FAQ', glyph: '?' },
  { kind: 'Timer', th: 'นับถอยหลัง', en: 'Timer', glyph: 'Tm' },
  { kind: 'Giphy', th: 'Giphy', en: 'Giphy', glyph: 'Gf' },
  { kind: 'Video', th: 'วิดีโอ', en: 'Video', glyph: 'Vd' },
  { kind: 'VideoGallery', th: 'คลังวิดีโอ', en: 'Video Gallery', glyph: 'VG' },
  { kind: 'Map', th: 'แผนที่', en: 'Map', glyph: 'Mp' },
  { kind: 'AudioEmbed', th: 'เพลง', en: 'Music', glyph: 'Mu' },
  { kind: 'CustomCode', th: 'โค้ด HTML', en: 'Custom HTML code', glyph: '</>' }
]

export const MSSG_BLOCK_KIND_LABEL: Record<string, string> = Object.fromEntries(MSSG_BLOCK_KINDS.map(k => [k.kind, k.th]))

export function mssgBlockKindLabel(kind: string): string {
  return MSSG_BLOCK_KIND_LABEL[kind] ?? kind
}

/** one of the 19 kinds (an unknown kind read from mssg is shown read-only: no edit form, move / hide / delete only) */
export function mssgIsKnownKind(kind: string): boolean {
  return kind in MSSG_BLOCK_KIND_LABEL
}

// ── ids ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** contract §3.2: `^tmp-[a-z0-9]{4,32}$` */
export const MSSG_TEMP_ID_RE = /^tmp-[a-z0-9]{4,32}$/

export function mssgTempId(): string {
  let s = ''
  while (s.length < 12) s += Math.random().toString(36).slice(2)
  return `tmp-${s.slice(0, 12)}`
}

export function mssgIsTempId(id: string | null | undefined): boolean {
  return !!id && MSSG_TEMP_ID_RE.test(id)
}

// ── small object helpers ────────────────────────────────────────────────────────────────────────────────────────────
function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v)) as T
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k] as Record<string, unknown>, v) : clone(v)
  }
  return out
}

export function mssgDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => mssgDeepEqual(x, bb[i]))
  }
  const ka = Object.keys(a as object).filter(k => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b as object).filter(k => (b as Record<string, unknown>)[k] !== undefined)
  return ka.length === kb.length && ka.every(k => mssgDeepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * Block `fields` + a patch: whole keys replace (the API's merge), except `theme` (v1.6 style override) which merges key by
 * key; `dropNull` removes the override keys set to `null` (preview / create) instead of keeping them for the API.
 */
function mergeBlockFields(prev: Record<string, unknown>, patch: Record<string, unknown>, dropNull: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = { ...prev }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue
    out[k] = k === 'theme' ? mssgMergeBlockTheme(prev.theme, v, dropNull) : clone(v)
  }
  // v1.9: a Link item's card `image` is never sent — the preview keeps it by item id (the API's merge does the same)
  if (dropNull && Array.isArray(patch.items) && Array.isArray(prev.items)) out.items = mssgKeepItemImages(prev.items, out.items as unknown[])
  // v1.9: `items` replaces a legacy top-level `title` / `action` of a Link (never both in one op)
  if (patch.items !== undefined && (patch.title === undefined && patch.action === undefined)) {
    delete out.title
    delete out.action
  }
  return out
}

// ── Link items (v1.9 §3.5) ──────────────────────────────────────────────────────────────────────────────────────────
/** max links in one Link block (assumption A8) */
export const MSSG_LINK_ITEMS_MAX = 30

/**
 * The links of a Link block's `fields`: `items` as read, or — legacy (an old draft's op, a legacy read) — one item from the
 * top-level `title` / `action` (no id, no glyph). Top-level `title` / `action` next to `items` set item 0 (legacy op on top).
 */
export function mssgLinkItems(fields: Record<string, unknown> | null | undefined): Record<string, unknown>[] {
  const f = fields ?? {}
  const items = Array.isArray(f.items) ? (f.items as unknown[]).filter(isPlain).map(it => clone(it)) : []
  const legacy = f.title !== undefined || f.action !== undefined
  if (!items.length && legacy) return [{ title: typeof f.title === 'string' ? f.title : '', action: clone(f.action) ?? { type: 'url', url: '' }, glyph: null }]
  if (items.length && legacy) {
    const first = { ...items[0]! }
    if (f.title !== undefined) first.title = f.title
    if (f.action !== undefined) first.action = clone(f.action)
    items[0] = first
  }
  return items
}

/** `next` items with the card `image` of the `prev` item of the same id (when `next` has none) */
export function mssgKeepItemImages(prev: unknown[], next: unknown[]): unknown[] {
  const byId = new Map<string, Record<string, unknown>>()
  for (const it of prev) if (isPlain(it) && typeof it.id === 'string') byId.set(it.id, it)
  return next.map((it) => {
    if (!isPlain(it) || typeof it.id !== 'string' || it.image !== undefined) return it
    const old = byId.get(it.id)
    return old?.image !== undefined ? { ...it, image: clone(old.image) } : it
  })
}

/** a legacy Link patch (`title` / `action`, no `items`) → `items` with item 0 changed (preview of an old draft's op) */
function linkLegacyPatch(prevFields: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  if (patch.items !== undefined || (patch.title === undefined && patch.action === undefined)) return patch
  const { title, action, ...rest } = patch
  const items = mssgLinkItems(prevFields)
  const first: Record<string, unknown> = { ...(items[0] ?? { title: '', action: { type: 'url', url: '' }, glyph: null }) }
  if (title !== undefined) first.title = title
  if (action !== undefined) first.action = clone(action)
  return { ...rest, items: [first, ...items.slice(1)] }
}

/** row `j` moved one place up (`-1`) / down (`1`); unchanged at the ends */
export function mssgRowsMove<T>(rows: T[], j: number, dir: -1 | 1): T[] {
  const to = j + dir
  if (j < 0 || j >= rows.length || to < 0 || to >= rows.length) return rows
  const next = rows.slice()
  const [row] = next.splice(j, 1)
  next.splice(to, 0, row!)
  return next
}

/** row `j` removed — never the last one (a Link block keeps at least one link) */
export function mssgRowsRemove<T>(rows: T[], j: number): T[] {
  if (rows.length <= 1 || j < 0 || j >= rows.length) return rows
  return rows.filter((_, k) => k !== j)
}

/** a link can be added while the block holds fewer than 30 (A8) */
export function mssgLinkCanAdd(count: number): boolean {
  return count < MSSG_LINK_ITEMS_MAX
}

let rowSeq = 0
/** a local key of a form row (v-for only; never sent) */
export function mssgRowKey(): string {
  rowSeq += 1
  return `r${rowSeq}`
}

// ── preview = base + ops (client copy of the API's rule) ────────────────────────────────────────────────────────────
function findPage(site: MssgSiteProjection, id: string): MssgPageProjection | undefined {
  return site.pages.find(p => p.id === id)
}

function uniqueSlug(site: MssgSiteProjection, wanted: string): string {
  const taken = new Set(site.pages.map(p => p.slug))
  if (!taken.has(wanted)) return wanted
  for (let i = 2; ; i++) {
    if (!taken.has(`${wanted}-${i}`)) return `${wanted}-${i}`
  }
}

function applyOne(site: MssgSiteProjection, op: MssgOp): void {
  switch (op.op) {
    case 'site.update': {
      Object.assign(site, deepMerge(site as unknown as Record<string, unknown>, op.fields as Record<string, unknown>))
      return
    }
    case 'page.create': {
      site.pages.push({ id: op.tempId, name: op.name, slug: op.slug, enabled: op.enabled ?? true, seo: { title: '', description: '' }, theme: null, blocks: [] })
      return
    }
    case 'page.update': {
      const page = findPage(site, op.pageId)
      if (!page) return
      const f = op.fields
      if (f.name !== undefined) page.name = f.name
      if (f.slug !== undefined) page.slug = f.slug
      if (f.enabled !== undefined) page.enabled = f.enabled
      if (f.seo) page.seo = { ...page.seo, ...f.seo }
      if (f.theme) {
        const theme = deepMerge((page.theme ?? {}) as Record<string, unknown>, f.theme as Record<string, unknown>) as NonNullable<MssgPageProjection['theme']>
        // v1.6 §3.4: a preset is `colorId` only (the expanded `colors` are dropped); `light` / `dark` belong to `autoTheme`
        if (f.theme.colorId !== undefined) {
          delete theme.colors
          if (f.theme.colorId !== 'autoTheme') {
            delete theme.light
            delete theme.dark
          }
        }
        // v1.13 D23 c: an own background colour clears the gradient (the API writes `""`), so the preview never covers it
        if (typeof f.theme.page?.backgroundColor === 'string' && theme.page) theme.page.backgroundGradient = ''
        // `font: null` = mssg's default font: the key is removed
        if (f.theme.page && 'font' in f.theme.page && f.theme.page.font === null && theme.page) delete theme.page.font
        page.theme = theme
      }
      return
    }
    case 'page.clone': {
      const i = site.pages.findIndex(p => p.id === op.pageId)
      if (i < 0) return
      const src = site.pages[i]!
      const copy = clone(src)
      copy.id = op.tempId
      copy.name = `${src.name} Copy`
      copy.slug = uniqueSlug(site, `${src.slug}-copy`)
      // mssg gives the copied blocks new ids only when the clone is applied: synthetic, never used in an op
      copy.blocks = copy.blocks.map((b, k) => ({ ...b, id: `${op.tempId}:${k}` }))
      site.pages.splice(i + 1, 0, copy)
      return
    }
    case 'page.delete': {
      site.pages = site.pages.filter(p => p.id !== op.pageId)
      if (site.homePageId === op.pageId) site.homePageId = site.pages[0]?.id ?? null
      return
    }
    case 'page.setHome': {
      if (findPage(site, op.pageId)) site.homePageId = op.pageId
      return
    }
    case 'block.create': {
      const page = findPage(site, op.pageId)
      if (!page) return
      const fields = op.kind === 'Link' ? linkLegacyPatch({}, clone(op.fields)) : clone(op.fields)
      const block: MssgBlockProjection = { id: op.tempId, kind: op.kind, enabled: op.enabled, fields }
      const at = op.index === undefined ? page.blocks.length : Math.max(0, Math.min(page.blocks.length, op.index))
      page.blocks.splice(at, 0, block)
      return
    }
    case 'block.update': {
      const block = findPage(site, op.pageId)?.blocks.find(b => b.id === op.blockId)
      if (!block) return
      if (op.fields) block.fields = mergeBlockFields(block.fields, block.kind === 'Link' ? linkLegacyPatch(block.fields, op.fields) : op.fields, true)
      if (op.enabled !== undefined) block.enabled = op.enabled
      return
    }
    case 'block.move': {
      const page = findPage(site, op.pageId)
      const i = page?.blocks.findIndex(b => b.id === op.blockId) ?? -1
      if (!page || i < 0) return
      const [block] = page.blocks.splice(i, 1)
      page.blocks.splice(Math.max(0, Math.min(page.blocks.length, op.toIndex)), 0, block!)
      return
    }
    case 'block.clone': {
      const page = findPage(site, op.pageId)
      const i = page?.blocks.findIndex(b => b.id === op.blockId) ?? -1
      if (!page || i < 0) return
      page.blocks.splice(i + 1, 0, { ...clone(page.blocks[i]!), id: op.tempId })
      return
    }
    case 'block.delete': {
      const page = findPage(site, op.pageId)
      if (page) page.blocks = page.blocks.filter(b => b.id !== op.blockId)
      return
    }
    default:
      // product ops (M4) do not change the site projection
      return
  }
}

export function mssgApplyOps(site: MssgSiteProjection, ops: MssgOp[]): MssgSiteProjection {
  const out = clone(site)
  out.pages = out.pages ?? []
  for (const op of ops) applyOne(out, op)
  return out
}

type UpdateOp = Extract<MssgOp, { op: 'site.update' | 'page.update' | 'block.update' | 'product.update' }>

function isUpdate(op: MssgOp): op is UpdateOp {
  return op.op === 'site.update' || op.op === 'page.update' || op.op === 'block.update' || op.op === 'product.update'
}

function sameTarget(a: UpdateOp, b: MssgOp): boolean {
  if (a.op !== b.op) return false
  if (a.op === 'site.update') return true
  if (a.op === 'page.update') return (b as MssgOpPageUpdate).pageId === a.pageId
  // M4: a product edit folded further locally — the site projection does not hold products, so it never changes the preview
  if (a.op === 'product.update') return (b as { productId?: string }).productId === a.productId
  return (b as MssgOpBlockUpdate).blockId === a.blockId && (b as MssgOpBlockUpdate).pageId === a.pageId
}

/**
 * What the editor shows: the server's `preview` (= base + the saved ops) with the local ops that the server has not
 * seen yet laid over it. A saved update op that was folded further locally is laid over again (updates are
 * idempotent overlays). Anything else that differs (an op removed / replaced) → `live` + every local op, until the
 * next draft answer brings an exact `preview` again (≤ 1 s).
 */
export function mssgLocalPreview(
  server: MssgSiteProjection | null | undefined,
  serverOps: MssgOp[],
  live: MssgSiteProjection | null | undefined,
  ops: MssgOp[]
): MssgSiteProjection | null {
  if (!server) return null
  const fallback = () => mssgApplyOps(live ?? server, ops)
  if (ops.length < serverOps.length) return fallback()
  const tail: MssgOp[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    const saved = serverOps[i]
    if (!saved) {
      tail.push(op)
    } else if (!mssgDeepEqual(op, saved)) {
      if (isUpdate(op) && sameTarget(op, saved)) tail.push(op)
      else return fallback()
    }
  }
  return tail.length ? mssgApplyOps(server, tail) : server
}

// ── op building / folding ───────────────────────────────────────────────────────────────────────────────────────────
function lastIndex(ops: MssgOp[], pred: (op: MssgOp) => boolean): number {
  for (let i = ops.length - 1; i >= 0; i--) {
    if (pred(ops[i]!)) return i
  }
  return -1
}

/**
 * Add a page edit: name / slug / enabled of a page created in this draft go into its `page.create`; the rest folds
 * into the latest `page.update` of that page, else a new one is appended.
 */
export function mssgFoldPageUpdate(ops: MssgOp[], pageId: string, fields: MssgOpPageUpdate['fields']): MssgOp[] {
  const next = ops.slice()
  const rest: MssgOpPageUpdate['fields'] = { ...fields }
  const ci = next.findIndex(o => o.op === 'page.create' && o.tempId === pageId)
  if (ci >= 0) {
    const create = { ...(next[ci] as MssgOpPageCreate) }
    if (rest.name !== undefined) create.name = rest.name
    if (rest.slug !== undefined) create.slug = rest.slug
    if (rest.enabled !== undefined) create.enabled = rest.enabled
    delete rest.name
    delete rest.slug
    delete rest.enabled
    next[ci] = create
    if (!Object.keys(rest).length) return next
  }
  const ui = lastIndex(next, o => o.op === 'page.update' && o.pageId === pageId)
  if (ui >= 0) {
    const prev = next[ui] as MssgOpPageUpdate
    // v1.13 (D23 g): last action wins — a preset pick drops the page's own colour set earlier in the draft; one in the
    // same incoming fields stays (the API lays an own colour after the preset within one op)
    const base = rest.theme?.colorId !== undefined ? withoutOwnBackground(prev.fields) : prev.fields
    next[ui] = { ...prev, fields: fixPresetPair(deepMerge(base as Record<string, unknown>, rest as Record<string, unknown>) as MssgOpPageUpdate['fields']) }
  } else {
    next.push({ op: 'page.update', pageId, fields: fixPresetPair(clone(rest)) })
  }
  return next
}

/** `fields` without `theme.page.backgroundColor` (a colour or `null`); an emptied `theme.page` is removed too */
function withoutOwnBackground(fields: MssgOpPageUpdate['fields']): MssgOpPageUpdate['fields'] {
  const page = fields.theme?.page
  if (!page || !('backgroundColor' in page)) return fields
  const out = clone(fields)
  delete out.theme!.page!.backgroundColor
  if (!Object.keys(out.theme!.page!).length) delete out.theme!.page
  return out
}

/** v1.6 §3.4: `light` / `dark` only go with `colorId: "autoTheme"` (a folded switch to another preset drops them) */
function fixPresetPair(fields: MssgOpPageUpdate['fields']): MssgOpPageUpdate['fields'] {
  const t = fields.theme
  if (t && t.colorId !== undefined && t.colorId !== 'autoTheme') {
    delete t.light
    delete t.dark
  }
  return fields
}

/**
 * Add a block edit (`fields` replace whole keys, as the API's merge does; `enabled` = hide / show). A block created
 * in this draft takes the edit into its `block.create`; otherwise it folds into the latest `block.update` of it.
 */
export function mssgFoldBlockUpdate(ops: MssgOp[], pageId: string, blockId: string, patch: { fields?: Record<string, unknown>, enabled?: boolean }): MssgOp[] {
  const next = ops.slice()
  const ci = next.findIndex(o => o.op === 'block.create' && o.tempId === blockId)
  if (ci >= 0) {
    const create = next[ci] as MssgOpBlockCreate
    next[ci] = {
      ...create,
      fields: patch.fields ? mergeBlockFields(create.fields, patch.fields, true) : create.fields,
      enabled: patch.enabled ?? create.enabled
    }
    return next
  }
  const ui = lastIndex(next, o => o.op === 'block.update' && o.blockId === blockId && o.pageId === pageId)
  if (ui >= 0) {
    const prev = next[ui] as MssgOpBlockUpdate
    const merged: MssgOpBlockUpdate = { ...prev }
    if (patch.fields) merged.fields = mergeBlockFields(prev.fields ?? {}, patch.fields, false)
    if (patch.enabled !== undefined) merged.enabled = patch.enabled
    next[ui] = merged
  } else {
    const op: MssgOpBlockUpdate = { op: 'block.update', pageId, blockId }
    if (patch.fields) op.fields = clone(patch.fields)
    if (patch.enabled !== undefined) op.enabled = patch.enabled
    next.push(op)
  }
  return next
}

function opRefs(op: MssgOp, id: string): boolean {
  const o = op as unknown as Record<string, unknown>
  return o.pageId === id || o.blockId === id || o.tempId === id
}

/**
 * Deleting a block created in this draft: drop every op of it instead of sending a delete — unless it is the source
 * of a clone, or a later move on its page counted it (then `null`: the caller appends `block.delete`).
 */
export function mssgDropTempBlock(ops: MssgOp[], pageId: string, blockId: string): MssgOp[] | null {
  if (!mssgIsTempId(blockId)) return null
  const ci = ops.findIndex(o => o.op === 'block.create' && o.tempId === blockId)
  if (ci < 0) return null
  if (ops.some(o => o.op === 'block.clone' && o.blockId === blockId)) return null
  if (ops.some((o, i) => i > ci && o.op === 'block.move' && o.pageId === pageId && o.blockId !== blockId)) return null
  return ops.filter(o => !(o.op.startsWith('block.') && opRefs(o, blockId)))
}

/** Deleting a page created / cloned in this draft: drop every op of it (unless it is the source of a page clone). */
export function mssgDropTempPage(ops: MssgOp[], pageId: string): MssgOp[] | null {
  if (!mssgIsTempId(pageId)) return null
  if (!ops.some(o => (o.op === 'page.create' || o.op === 'page.clone') && o.tempId === pageId)) return null
  if (ops.some(o => o.op === 'page.clone' && o.pageId === pageId)) return null
  return ops.filter(o => !opRefs(o, pageId))
}

/** blocks of a page cloned in this draft get their ids from mssg only on apply — they cannot be edited yet */
export function mssgIsClonedPage(ops: MssgOp[], pageId: string): boolean {
  return ops.some(o => o.op === 'page.clone' && o.tempId === pageId)
}

// ── rules (contract §3.3) ───────────────────────────────────────────────────────────────────────────────────────────
export const MSSG_PAGE_SLUG_RE = /^[a-z0-9_.-]+$/

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** contract §3.3 AudioEmbed: YouTube, Spotify, Apple Music, SoundCloud, Mixcloud */
const AUDIO_HOSTS = ['youtube.com', 'youtu.be', 'spotify.com', 'music.apple.com', 'soundcloud.com', 'mixcloud.com']

export function mssgIsAudioUrl(v: string): boolean {
  if (!isHttpUrl(v)) return false
  const host = new URL(v).hostname.toLowerCase()
  return AUDIO_HOSTS.some(h => host === h || host.endsWith(`.${h}`))
}

/** an image field value: an http(s) URL or a staged upload of this site (`upload:<24-hex>`) */
export function mssgIsImageValue(v: string): boolean {
  return /^upload:[a-f0-9]{24}$/i.test(v) || isHttpUrl(v)
}

const len = (min: number, max: number, what: string) => z.string()
  .trim()
  .min(min, min <= 1 ? `กรอก${what}` : `${what}ต้องยาว ${min}–${max} ตัวอักษร`)
  .max(max, min <= 1 ? `${what}ยาวได้ไม่เกิน ${max} ตัวอักษร` : `${what}ต้องยาว ${min}–${max} ตัวอักษร`)
const maxLen = (max: number, what: string) => z.string().max(max, `${what}ยาวได้ไม่เกิน ${max} ตัวอักษร`)
const httpUrl = (what: string) => z.string().trim().min(1, `กรอก${what}`).refine(isHttpUrl, `${what}ต้องเป็นลิงก์ที่ขึ้นต้นด้วย http:// หรือ https://`)
const image = (what: string) => z.string().min(1, `อัปโหลด${what}`).refine(mssgIsImageValue, `${what}ต้องเป็นรูปที่อัปโหลด หรือลิงก์ http(s)`)
const autoplay = z.number({ error: 'ใส่เป็นตัวเลข' }).int('ใส่เป็นจำนวนเต็ม').min(0, 'ต้องไม่ติดลบ')
const list = <T extends z.ZodType>(item: T, min: number, max: number, what: string) => z.array(item)
  .min(min, `ต้องมี${what}อย่างน้อย ${min} รายการ`)
  .max(max, `${what}ได้ไม่เกิน ${max} รายการ`)

export const mssgPageSchema = z.object({
  name: len(3, 250, 'ชื่อหน้า'),
  slug: z.string()
    .min(1, 'กรอกลิงก์ของหน้า')
    .max(100, 'ลิงก์ของหน้ายาวได้ไม่เกิน 100 ตัวอักษร')
    .regex(MSSG_PAGE_SLUG_RE, 'ลิงก์ของหน้าใช้ได้เฉพาะ a-z ตัวเล็ก ตัวเลข และ _ . -'),
  enabled: z.boolean(),
  seo: z.object({
    title: maxLen(80, 'SEO title ของหน้า'),
    description: maxLen(200, 'SEO description ของหน้า')
  })
})
export type MssgPageForm = z.output<typeof mssgPageSchema>

export const mssgNewPageSchema = mssgPageSchema.pick({ name: true, slug: true })
export type MssgNewPageForm = z.output<typeof mssgNewPageSchema>

/** a slug suggestion from a page name (latin letters / digits only), unique within the site */
export function mssgSuggestSlug(name: string, taken: string[]): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'page'
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let i = 2; ; i++) {
    if (!set.has(`${base}-${i}`)) return `${base}-${i}`
  }
}

// ── block forms ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** contract §3.3 SubscriptionForm item types (⚠K11) */
export const MSSG_FORM_ITEM_TYPES = [
  { value: 'text', label: 'ข้อความ (Text)' },
  { value: 'email', label: 'อีเมล (Email)' },
  { value: 'phone', label: 'เบอร์โทร (Phone)' }
]

/** zod: an action of contract §3.4 (`image` = Image / gallery) checked by `mssgActionIssues` against the draft's pages */
function actionSchema(image: boolean, ctx: MssgActionContext | null) {
  return z.looseObject({ type: z.string({ error: 'เลือกว่ากดแล้วทำอะไร' }) }).superRefine((a, c) => {
    for (const i of mssgActionIssues(a, ctx, image)) c.addIssue({ code: 'custom', path: i.path.split('.'), message: i.message })
  })
}

const imageField = (what: string) => z.string().nullable().refine(v => !v || mssgIsImageValue(v), `${what}ต้องเป็นรูปที่อัปโหลด หรือลิงก์ http(s)`)

/**
 * The form schema of a kind (contract §3.3 / §3.4). `ctx` = the draft's pages + blocks, so an internal page / anchor
 * must exist in the preview; without it (the static `MSSG_BLOCK_SCHEMAS`) targets are only checked for presence.
 * Most kinds edit their `fields` keys directly; TextRich edits plain `text` (→ `html`) and Timer a local
 * `datetime-local` value (→ ISO `expireDate`). Item objects keep the keys read from mssg (loose objects).
 */
export function mssgBlockSchema(kind: string, ctx: MssgActionContext | null = null): z.ZodType | null {
  switch (kind) {
    case 'Hat': return z.object({ title: maxLen(250, 'ชื่อ'), subtitle: maxLen(500, 'คำอธิบายสั้น'), logoUrl: imageField('รูปโปรไฟล์'), bgUrl: imageField('ภาพปก') })
    case 'Link': return z.object({
      items: list(z.looseObject({ title: len(1, 250, 'ชื่อลิงก์'), action: actionSchema(false, ctx) }).superRefine((it, c) => {
        const m = mssgGlyphIssue(it.glyph, it._glyph0, MSSG_GLYPH_LINK)
        if (m) c.addIssue({ code: 'custom', path: ['glyph'], message: m })
      }), 1, MSSG_LINK_ITEMS_MAX, 'ลิงก์')
    })
    case 'TextRich': return z.object({ text: z.string().trim().min(1, 'กรอกข้อความ').max(20_000, 'ข้อความยาวได้ไม่เกิน 20,000 ตัวอักษร') })
    case 'Image': return z.object({ url: image('รูปภาพ'), action: actionSchema(true, ctx) })
    case 'ImageGallery': return z.object({ images: list(z.looseObject({ url: image('รูป'), action: actionSchema(true, ctx) }), 1, 20, 'รูป'), autoplay })
    case 'Video': return z.object({ url: httpUrl('ลิงก์วิดีโอ') })
    case 'VideoGallery': return z.object({ videos: list(z.looseObject({ url: httpUrl('ลิงก์วิดีโอ') }), 1, 20, 'วิดีโอ'), autoplay })
    case 'AudioEmbed': return z.object({ url: httpUrl('ลิงก์เพลง').refine(mssgIsAudioUrl, 'รองรับเฉพาะลิงก์ YouTube, Spotify, Apple Music, SoundCloud หรือ Mixcloud') })
    case 'Giphy': return z.object({ giphyId: len(1, 100, 'รหัส GIF (Giphy ID)') })
    case 'Map': return z.object({ address: len(10, 300, 'ที่อยู่') })
    case 'Timer': return z.object({ local: z.string().min(1, 'เลือกวันเวลาสิ้นสุด').refine(v => !Number.isNaN(new Date(v).getTime()), 'วันเวลาไม่ถูกต้อง') })
    case 'Divider': return z.object({})
    case 'Accordion': return z.object({ items: list(z.looseObject({ title: len(3, 250, 'คำถาม'), content: len(3, 20_000, 'คำตอบ') }), 1, 50, 'คำถาม') })
    case 'Features': return z.object({
      items: list(z.looseObject({ title: len(1, 250, 'หัวข้อ'), content: maxLen(1000, 'คำอธิบาย') }).superRefine((it, c) => {
        const m = mssgGlyphIssue(it.glyph, it._glyph0, MSSG_GLYPH_FEATURES)
        if (m) c.addIssue({ code: 'custom', path: ['glyph'], message: m })
      }), 1, 20, 'จุดเด่น')
    })
    case 'Messengers': return z.object({
      messengers: list(z.looseObject({}).superRefine((row, c) => {
        // a platform read from mssg that Apollo does not know is kept exactly as read (no check)
        if (row.platform && !mssgMessengerEditable(row.platform)) return
        const pair = mssgMessengerIssue(row)
        if (pair) c.addIssue({ code: 'custom', path: [pair.path], message: pair.message })
        const value = typeof row.value === 'string' ? row.value.trim() : ''
        if (!value) c.addIssue({ code: 'custom', path: ['value'], message: 'กรอกช่องทางติดต่อ' })
        else if (value.length > 250) c.addIssue({ code: 'custom', path: ['value'], message: 'ช่องทางติดต่อยาวได้ไม่เกิน 250 ตัวอักษร' })
        if (typeof row.enabled !== 'boolean') c.addIssue({ code: 'custom', path: ['enabled'], message: 'เลือกแสดงหรือซ่อน' })
      }), 1, 10, 'ปุ่มแชท')
    })
    case 'Socials': return z.object({ items: list(z.looseObject({ url: httpUrl('ลิงก์โซเชียล') }), 1, 30, 'ลิงก์โซเชียล') })
    case 'Products': return z.object({})
    case 'SubscriptionForm': return z.object({
      items: list(z.looseObject({
        type: z.enum(['text', 'email', 'phone'], { error: 'เลือกชนิดช่อง' }),
        label: len(1, 100, 'ชื่อช่อง'),
        required: z.boolean()
      }), 1, 10, 'ช่องในฟอร์ม'),
      sendLabel: len(1, 50, 'ข้อความบนปุ่มส่ง'),
      sentText: len(1, 500, 'ข้อความหลังส่งสำเร็จ')
    })
    case 'CustomCode': return z.object({ content: z.string().min(1, 'กรอกโค้ด HTML').max(30_000, 'โค้ดยาวได้ไม่เกิน 30,000 ตัวอักษร') })
    default: return null
  }
}

/** the static schemas (targets checked for presence only) — the forms use `mssgBlockSchema(kind, ctx)` */
export const MSSG_BLOCK_SCHEMAS: Record<string, z.ZodType> = Object.fromEntries(MSSG_BLOCK_KINDS.map(k => [k.kind, mssgBlockSchema(k.kind)!]))

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }
const UNESC: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': '\'', '&nbsp;': ' ' }

/** TextRich html → plain text for the form and the preview (paragraphs / line breaks → new lines) */
export function mssgHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, m => UNESC[m] ?? m)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** plain text → `<p>` per paragraph, `<br>` per line, everything escaped */
export function mssgTextToHtml(text: string): string {
  return text.trim().split(/\n{2,}/).map(par => `<p>${par.replace(/[&<>"']/g, c => ESC[c]!).replace(/\n/g, '<br>')}</p>`).join('')
}

/** html with more than paragraphs / line breaks (bold, links, lists …) loses that formatting when edited here */
export function mssgHtmlHasFormatting(html: string): boolean {
  return /<(?!\/?(p|br)\b)[a-z]/i.test(html)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** ISO → `YYYY-MM-DDTHH:mm` in the browser's time zone (datetime-local) */
export function mssgIsoToLocalInput(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** default fields of a new block of `kind` (required lists start with one row) */
export function mssgBlockDefaults(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'Hat': return { title: '', subtitle: '', logoUrl: null, bgUrl: null }
    case 'Link': return { items: [{ title: '', action: { type: 'url', url: '' }, glyph: null }] }
    case 'TextRich': return { html: '', editorState: null }
    case 'Image': return { url: '', action: { type: 'nothing' } }
    case 'ImageGallery': return { images: [{ url: '', action: { type: 'nothing' } }], autoplay: 0 }
    case 'Video': return { url: '' }
    case 'VideoGallery': return { videos: [{ url: '' }], autoplay: 0 }
    case 'AudioEmbed': return { url: '' }
    case 'Giphy': return { giphyId: '' }
    case 'Map': return { address: '' }
    case 'Timer': return { expireDate: '' }
    case 'Accordion': return { items: [{ title: '', content: '' }] }
    case 'Features': return { items: [{ title: '', content: '', glyph: { type: 'emoticon', text: '⭐' } }] }
    case 'Messengers': return { messengers: [{ platform: 'whatsapp', type: 'auto', value: '', enabled: true }] }
    case 'Socials': return { items: [{ url: '' }] }
    case 'SubscriptionForm': return { items: [{ type: 'email', label: 'Email', required: true }], sendLabel: 'Send', sentText: 'ขอบคุณ เราได้รับข้อมูลแล้ว' }
    case 'CustomCode': return { content: '' }
    default: return {}
  }
}

/** the `fields` keys the form of a kind edits (only these are compared / sent) */
export const MSSG_BLOCK_KEYS: Record<string, string[]> = {
  Hat: ['title', 'subtitle', 'logoUrl', 'bgUrl'],
  Link: ['items'],
  TextRich: ['html', 'editorState'],
  Image: ['url', 'action'],
  ImageGallery: ['images', 'autoplay'],
  Video: ['url'],
  VideoGallery: ['videos', 'autoplay'],
  AudioEmbed: ['url'],
  Giphy: ['giphyId'],
  Map: ['address'],
  Timer: ['expireDate'],
  Divider: [],
  Accordion: ['items'],
  Features: ['items'],
  Messengers: ['messengers'],
  Socials: ['items'],
  Products: [],
  SubscriptionForm: ['items', 'sendLabel', 'sentText'],
  CustomCode: ['content']
}

/** an action read from mssg → form state (a value input is always a string); missing → `fallback` type */
function actionToForm(action: unknown, fallback: string): Record<string, unknown> {
  const a = isPlain(action) ? clone(action) : {}
  if (typeof a.type !== 'string' || !a.type) return { type: fallback, ...(fallback === 'url' ? { url: '' } : {}) }
  if (['url', 'tel', 'email', 'sms'].includes(a.type)) a.url = typeof a.url === 'string' ? a.url : ''
  if (a.type === 'page') a.page = typeof a.page === 'string' ? a.page : ''
  if (a.type === 'anchor') {
    const an = isPlain(a.anchor) ? a.anchor : {}
    a.anchor = { ...an, page: typeof an.page === 'string' ? an.page : '', block: typeof an.block === 'string' ? an.block : '' }
  }
  return a
}

/** block `fields` → form state of its kind */
export function mssgBlockToForm(kind: string, fields: Record<string, unknown>): Record<string, unknown> {
  const f = { ...mssgBlockDefaults(kind), ...clone(fields) }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  switch (kind) {
    case 'Hat': {
      const img = (v: unknown) => (typeof v === 'string' && v ? v : null)
      return { title: str(f.title), subtitle: str(f.subtitle), logoUrl: img(f.logoUrl), bgUrl: img(f.bgUrl) }
    }
    case 'TextRich': return { text: mssgHtmlToText(str(f.html)) }
    case 'Timer': return { local: mssgIsoToLocalInput(f.expireDate) }
    case 'Link': return {
      // `fields` as given (not the defaults): a legacy block holds `title` / `action` and no `items`
      items: (mssgLinkItems(fields).length ? mssgLinkItems(fields) : mssgLinkItems(mssgBlockDefaults('Link'))).map((it) => {
        const glyph = it.glyph === undefined ? null : clone(it.glyph)
        const row: Record<string, unknown> = { _key: mssgRowKey(), title: str(it.title), action: actionToForm(it.action, 'url'), glyph, _glyph0: clone(glyph) }
        if (typeof it.id === 'string' && it.id) row.id = it.id
        if (it.image !== undefined) row.image = clone(it.image)
        return row
      })
    }
    case 'Image': return { url: str(f.url), action: actionToForm(f.action, 'nothing') }
    case 'ImageGallery': return {
      ...f,
      images: (Array.isArray(f.images) ? f.images : []).map(it => (isPlain(it) ? { ...it, url: str(it.url), action: actionToForm(it.action, 'nothing') } : it)),
      autoplay: typeof f.autoplay === 'number' ? f.autoplay : 0
    }
    case 'VideoGallery': return { ...f, autoplay: typeof f.autoplay === 'number' ? f.autoplay : 0 }
    case 'Features': return {
      ...f,
      items: (Array.isArray(f.items) ? f.items : []).map(it => (isPlain(it)
        ? { ...it, _key: mssgRowKey(), title: str(it.title), content: str(it.content), glyph: clone(it.glyph ?? null), _glyph0: clone(it.glyph ?? null) }
        : it))
    }
    default: return f
  }
}

/** form state → the `fields` keys of the kind (TextRich: changed text → new html and `editorState: null`, ⚠K9) */
export function mssgFormToBlock(kind: string, form: Record<string, unknown>, original: Record<string, unknown>): Record<string, unknown> {
  const keys = MSSG_BLOCK_KEYS[kind] ?? []
  if (kind === 'TextRich') {
    const text = String(form.text ?? '')
    const orig = typeof original.html === 'string' ? original.html : ''
    if (orig && mssgHtmlToText(orig) === text.trim()) return { html: orig, editorState: original.editorState ?? null }
    return { html: mssgTextToHtml(text), editorState: null }
  }
  if (kind === 'Timer') {
    const d = new Date(String(form.local ?? ''))
    return { expireDate: Number.isNaN(d.getTime()) ? '' : d.toISOString() }
  }
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    let v = clone(form[k])
    if (typeof v === 'string' && k !== 'content') v = v.trim()
    out[k] = v
  }
  if (kind === 'Hat') {
    if (!out.logoUrl) out.logoUrl = null
    if (!out.bgUrl) out.bgUrl = null
  }
  if (kind === 'Image') out.action = mssgActionOut(out.action)
  if (kind === 'Link') out.items = mssgLinkItemsOut(out.items)
  if (kind === 'Features' && Array.isArray(out.items)) {
    out.items = (out.items as unknown[]).map((it) => {
      if (!isPlain(it)) return it
      const { _key, _glyph0, ...rest } = it
      return { ...rest, glyph: mssgGlyphOut(it.glyph, _glyph0) }
    })
  }
  if (kind === 'ImageGallery' && Array.isArray(out.images)) {
    out.images = (out.images as unknown[]).map(it => (isPlain(it) ? { ...it, action: mssgActionOut(it.action) } : it))
  }
  if (kind === 'Messengers' && Array.isArray(out.messengers)) {
    out.messengers = (out.messengers as unknown[]).map(it => (isPlain(it) && mssgMessengerEditable(it.platform) && typeof it.value === 'string' ? { ...it, value: it.value.trim() } : it))
  }
  return out
}

/**
 * v1.9 §3.5: Link form rows → `fields.items` as sent — `{ id?, title, action, glyph }` in the rows' order; the local row key,
 * the glyph read and the card `image` (read-only, ⚠K29) are never sent; a new row has no `id`.
 */
export function mssgLinkItemsOut(rows: unknown): Record<string, unknown>[] {
  return (Array.isArray(rows) ? rows : []).filter(isPlain).map((row) => {
    const out: Record<string, unknown> = {}
    if (typeof row.id === 'string' && row.id) out.id = row.id
    out.title = typeof row.title === 'string' ? row.title.trim() : ''
    out.action = mssgActionOut(row.action)
    out.glyph = mssgGlyphOut(row.glyph, row._glyph0)
    return out
  })
}

/**
 * The `fields` of a **new** block: keys mssg adds itself (`redirectUrl`, contract §3.3 Messengers) are never sent on
 * create, and empty optional images are left out (v1.6, B2 rule "unknown keys out of fields on create").
 */
export function mssgCreateFields(kind: string, fields: Record<string, unknown>): Record<string, unknown> {
  const out = clone(fields)
  delete out.redirectUrl
  if (kind === 'Messengers' && Array.isArray(out.messengers)) {
    out.messengers = (out.messengers as unknown[]).map((it) => {
      if (!isPlain(it)) return it
      const { redirectUrl: _drop, ...rest } = it
      return rest
    })
  }
  if (kind === 'Hat') {
    if (!out.logoUrl) delete out.logoUrl
    if (!out.bgUrl) delete out.bgUrl
  }
  return out
}

/** the keys of `next` whose value differs from `original` (what a `block.update` sends) */
export function mssgChangedKeys(next: Record<string, unknown>, original: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(next)) {
    if (!mssgDeepEqual(v, original[k])) out[k] = v
  }
  return out
}

// ── preview text ────────────────────────────────────────────────────────────────────────────────────────────────────
/** one short line describing a block (block list, conflict / confirm labels) */
export function mssgBlockSummary(block: Pick<MssgBlockProjection, 'kind' | 'fields'>): string {
  const text = blockSummaryText(block.kind, block.fields ?? {})
  return text.length > 80 ? `${text.slice(0, 80)}…` : text
}

function blockSummaryText(kind: string, f: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const count = (v: unknown, unit: string) => (Array.isArray(v) && v.length ? `${v.length} ${unit}` : '')
  switch (kind) {
    case 'TextRich':
      return mssgHtmlToText(s(f.html)).replace(/\s+/g, ' ')
    case 'Hat':
      return s(f.title) || s(f.subtitle)
    case 'Link': {
      const items = mssgLinkItems(f)
      const first = s(items[0]?.title)
      return items.length > 1 ? `${first} และอีก ${items.length - 1} ลิงก์` : first
    }
    case 'Accordion':
    case 'Features':
    case 'Socials':
    case 'SubscriptionForm':
      return count(f.items, 'รายการ')
    case 'ImageGallery':
      return count(f.images, 'รูป')
    case 'VideoGallery':
      return count(f.videos, 'วิดีโอ')
    case 'Messengers':
      return Array.isArray(f.messengers) ? (f.messengers as { platform?: string }[]).map(m => m.platform).filter(Boolean).join(', ') : ''
    case 'Timer':
      return s(f.expireDate) ? new Date(s(f.expireDate)).toLocaleString('th-TH') : ''
    case 'Image':
      return s(f.url).startsWith('upload:') ? 'รูปที่อัปโหลด' : ''
    case 'CustomCode':
      return s(f.content)
    default:
      return s(f.title) || s(f.address) || s(f.url) || s(f.giphyId)
  }
}

// ── errors and conflicts → page / block / field ─────────────────────────────────────────────────────────────────────
export interface MssgOpTarget {
  pageId: string | null
  blockId: string | null
  /** the field inside the page / block (`name`, `seo.title`, `title`, `items.0.title` …), `''` for the object */
  field: string
  /** M4: the product a product op / `products.<id>.…` path belongs to (only set for products) */
  productId?: string
}

/**
 * Where an error / conflict lands. Contract v1.4 id paths (`pages.<id>.<field>`, `pages.<id>.order`,
 * `pages.<id>.blocks.<id>.fields.<field>` / `….enabled`) carry the ids themselves and are read exactly; a zod issue of a
 * draft PUT (`ops.<n>.` already cut: `fields.title`, `fields.theme.page.backgroundColor`) takes page / block from the op
 * at that index. Block fields drop their `fields.` segment.
 */
export function mssgOpTarget(op: MssgOp | null | undefined, path: string): MssgOpTarget {
  // M4 (v1.4): `products.<id>.<dotted key>`; a draft-400 issue of a product op takes the id from the op at that index
  const pm = /^products\.([^.]+)(?:\.(.*))?$/.exec(path)
  if (pm) return { pageId: null, blockId: null, field: pm[2] ?? '', productId: pm[1]! }
  if (op && op.op.startsWith('product.')) {
    const o = op as unknown as Record<string, string | undefined>
    return { pageId: null, blockId: null, field: path === 'fields' ? '' : path.replace(/^fields\./, ''), productId: (op.op === 'product.create' ? o.tempId : o.productId) ?? '' }
  }
  const m = /^pages\.([^.]+)(?:\.blocks\.([^.]+))?(?:\.(.*))?$/.exec(path)
  if (m) {
    let field = m[3] ?? ''
    if (m[2]) field = field === 'fields' ? '' : field.replace(/^fields\./, '')
    return { pageId: m[1]!, blockId: m[2] ?? null, field }
  }
  let pageId: string | null = null
  let blockId: string | null = null
  if (op) {
    const o = op as unknown as Record<string, string | undefined>
    if (op.op.startsWith('page.')) {
      pageId = o.pageId ?? o.tempId ?? null
    } else if (op.op.startsWith('block.')) {
      pageId = o.pageId ?? null
      blockId = op.op === 'block.create' ? o.tempId! : (o.blockId ?? null)
    }
  }
  const field = path === 'fields' ? '' : path.replace(/^fields\./, '')
  return { pageId, blockId, field }
}

const PAGE_FIELD_LABEL: Record<string, string> = {
  'name': 'ชื่อหน้า',
  'slug': 'ลิงก์ของหน้า (slug)',
  'enabled': 'แสดงหน้า',
  'seo.title': 'SEO title ของหน้า',
  'seo.description': 'SEO description ของหน้า',
  'order': 'ลำดับ block',
  'theme.page.backgroundColor': 'สีพื้นหลังของหน้า',
  'theme.page.backgroundImage': 'รูปพื้นหลังของหน้า',
  'theme.colorId': 'ธีม (preset)',
  'theme.light': 'ธีมตอนสว่าง',
  'theme.dark': 'ธีมตอนมืด',
  'theme.page.font': 'ฟอนต์',
  'theme.page.font.family': 'ฟอนต์',
  'theme.page.font.provider': 'ฟอนต์'
}

const BLOCK_FIELD_LABEL: Record<string, string> = {
  'enabled': 'ซ่อน / แสดง',
  'title': 'ชื่อ',
  'action': 'กดแล้วทำอะไร',
  'url': 'ลิงก์',
  'html': 'ข้อความ',
  'subtitle': 'คำอธิบายสั้น',
  'logoUrl': 'รูปโปรไฟล์',
  'bgUrl': 'ภาพปก',
  'images': 'รูปภาพ',
  'videos': 'วิดีโอ',
  'autoplay': 'เล่นอัตโนมัติ',
  'giphyId': 'รหัส GIF',
  'address': 'ที่อยู่',
  'expireDate': 'วันเวลาสิ้นสุด',
  'items': 'รายการ',
  'messengers': 'ปุ่มแชท',
  'sendLabel': 'ข้อความบนปุ่มส่ง',
  'sentText': 'ข้อความหลังส่งสำเร็จ',
  'content': 'เนื้อหา',
  'platform': 'แอปแชท',
  'type': 'แบบ',
  'value': 'ช่องทางติดต่อ',
  'glyph': 'ไอคอน',
  'glyph.icon': 'ไอคอน',
  'glyph.type': 'ไอคอน',
  'glyph.text': 'ไอคอน',
  'glyph.url': 'ไอคอน',
  'id': 'รหัสรายการ',
  'image': 'รูปการ์ด',
  'action.url': 'ปลายทาง',
  'action.page': 'หน้าปลายทาง',
  'action.anchor': 'block ปลายทาง',
  'action.anchor.page': 'หน้าของ block ปลายทาง',
  'action.anchor.block': 'block ปลายทาง',
  'action.type': 'กดแล้วทำอะไร'
}

export function mssgPageFieldLabel(field: string): string {
  return PAGE_FIELD_LABEL[field] ?? field
}

export function mssgBlockFieldLabel(field: string, kind = ''): string {
  // v1.6 style override: `theme.blocks.<kind>.<key>`
  const st = /^theme\.blocks\.[^.]+\.(.+)$/.exec(field)
  if (st) return `รูปแบบ · ${st[1]}`
  const [head, idx, ...rest] = field.split('.')
  // v1.9: the items of a Link are its links
  const base = kind === 'Link' && head === 'items' ? 'ลิงก์' : (BLOCK_FIELD_LABEL[head!] ?? head ?? '')
  if (idx !== undefined && /^\d+$/.test(idx)) return `${base} ที่ ${Number(idx) + 1}${rest.length ? ` · ${BLOCK_FIELD_LABEL[rest.join('.')] ?? rest.join('.')}` : ''}`
  return field.includes('.') && !BLOCK_FIELD_LABEL[field] ? `${base} · ${field.split('.').slice(1).join('.')}` : base
}

/**
 * Thai label of a page / block field error or conflict item — `null` when the op / path is not about a page or block
 * (the caller falls back to the site field labels). Names come from `sites` (the first that knows the id).
 */
export function mssgPageBlockLabel(op: MssgOp | null | undefined, path: string, sites: (MssgSiteProjection | null | undefined)[]): string | null {
  const isPageOrBlock = (op && (op.op.startsWith('page.') || op.op.startsWith('block.'))) || /^pages\./.test(path)
  if (!isPageOrBlock) return null
  const t = mssgOpTarget(op, path)
  const page = t.pageId ? sites.map(s => s?.pages.find(p => p.id === t.pageId)).find(Boolean) : undefined
  const pageName = page ? `หน้า "${page.name}"` : 'หน้าเว็บ'
  if (/(^|\.)order$/.test(path) || op?.op === 'block.move') return `ลำดับ block ใน${pageName}`
  if (t.blockId) {
    const block = sites.map(s => s?.pages.flatMap(p => p.blocks).find(b => b.id === t.blockId)).find(Boolean)
    const kind = block?.kind ?? (op?.op === 'block.create' ? op.kind : '')
    const name = `block ${kind ? mssgBlockKindLabel(kind) : ''}`.trim()
    return `${name} ใน${pageName}${t.field ? ` · ${mssgBlockFieldLabel(t.field, kind)}` : ''}`
  }
  return `${pageName}${t.field ? ` · ${mssgPageFieldLabel(t.field)}` : ''}`
}

/** conflict item of a page / block / order (null for site fields) */
export function mssgConflictItemLabel(item: MssgConflictItem, ops: MssgOp[], sites: (MssgSiteProjection | null | undefined)[]): string | null {
  return mssgPageBlockLabel(ops[item.opIndex], item.path, sites)
}
