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
      if (f.theme) page.theme = deepMerge((page.theme ?? {}) as Record<string, unknown>, f.theme as Record<string, unknown>) as MssgPageProjection['theme']
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
      const block: MssgBlockProjection = { id: op.tempId, kind: op.kind, enabled: op.enabled, fields: clone(op.fields) }
      const at = op.index === undefined ? page.blocks.length : Math.max(0, Math.min(page.blocks.length, op.index))
      page.blocks.splice(at, 0, block)
      return
    }
    case 'block.update': {
      const block = findPage(site, op.pageId)?.blocks.find(b => b.id === op.blockId)
      if (!block) return
      if (op.fields) block.fields = { ...block.fields, ...clone(op.fields) }
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

type UpdateOp = Extract<MssgOp, { op: 'site.update' | 'page.update' | 'block.update' }>

function isUpdate(op: MssgOp): op is UpdateOp {
  return op.op === 'site.update' || op.op === 'page.update' || op.op === 'block.update'
}

function sameTarget(a: UpdateOp, b: MssgOp): boolean {
  if (a.op !== b.op) return false
  if (a.op === 'site.update') return true
  if (a.op === 'page.update') return (b as MssgOpPageUpdate).pageId === a.pageId
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
    next[ui] = { ...prev, fields: deepMerge(prev.fields as Record<string, unknown>, rest as Record<string, unknown>) as MssgOpPageUpdate['fields'] }
  } else {
    next.push({ op: 'page.update', pageId, fields: clone(rest) })
  }
  return next
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
      fields: patch.fields ? { ...create.fields, ...clone(patch.fields) } : create.fields,
      enabled: patch.enabled ?? create.enabled
    }
    return next
  }
  const ui = lastIndex(next, o => o.op === 'block.update' && o.blockId === blockId && o.pageId === pageId)
  if (ui >= 0) {
    const prev = next[ui] as MssgOpBlockUpdate
    const merged: MssgOpBlockUpdate = { ...prev }
    if (patch.fields) merged.fields = { ...(prev.fields ?? {}), ...clone(patch.fields) }
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
/** contract §3.3 Messengers platforms (⚠K7); values read from mssg that are not listed stay selectable */
export const MSSG_MESSENGER_PLATFORMS = ['whatsapp', 'telegram', 'viber', 'messenger', 'line']
/** contract §3.3 SubscriptionForm item types (⚠K11) */
export const MSSG_FORM_ITEM_TYPES = [
  { value: 'text', label: 'ข้อความ (Text)' },
  { value: 'email', label: 'อีเมล (Email)' },
  { value: 'phone', label: 'เบอร์โทร (Phone)' }
]

const linkAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('url'), url: httpUrl('ปลายทาง') }),
  z.object({ type: z.literal('page'), page: z.string().min(1, 'เลือกหน้าปลายทาง') }),
  // actions read from mssg that the BO cannot set yet ("เร็ว ๆ นี้") stay as they are
  z.looseObject({ type: z.enum(['call', 'email', 'sms', 'anchor']) })
], { error: 'เลือกว่ากดแล้วทำอะไร' })

const imageAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('url'), url: httpUrl('ปลายทาง') }),
  z.looseObject({ type: z.enum(['page', 'call', 'email', 'sms', 'image', 'anchor']) })
], { error: 'เลือกว่ากดแล้วทำอะไร' })

/** Link actions the BO can set; the others are shown disabled "เร็ว ๆ นี้" (spec scope/out) */
export const MSSG_LINK_ACTIONS = [
  { value: 'url', label: 'เปิดลิงก์ (Open link)', soon: false },
  { value: 'page', label: 'เปิดหน้าภายใน (Internal page)', soon: false },
  { value: 'call', label: 'โทรออก (Call)', soon: true },
  { value: 'email', label: 'ส่งอีเมล (Send email)', soon: true },
  { value: 'sms', label: 'ส่ง SMS (Send SMS)', soon: true },
  { value: 'anchor', label: 'ไปที่ block (Anchor)', soon: true }
]

/**
 * Form state per kind. Most kinds edit their `fields` keys directly; TextRich edits plain `text` (→ `html`) and Timer
 * a local `datetime-local` value (→ ISO `expireDate`). Item objects keep the keys read from mssg (loose objects).
 */
export const MSSG_BLOCK_SCHEMAS: Record<string, z.ZodType> = {
  Hat: z.object({
    header: maxLen(250, 'ชื่อ'),
    subheader: maxLen(500, 'คำอธิบายสั้น'),
    image: z.string().nullable().refine(v => !v || mssgIsImageValue(v), 'รูปต้องเป็นรูปที่อัปโหลด หรือลิงก์ http(s)')
  }),
  Link: z.object({ title: len(1, 250, 'ชื่อปุ่ม'), action: linkAction }),
  TextRich: z.object({ text: z.string().trim().min(1, 'กรอกข้อความ').max(20_000, 'ข้อความยาวได้ไม่เกิน 20,000 ตัวอักษร') }),
  Image: z.object({ url: image('รูปภาพ'), action: imageAction }),
  ImageGallery: z.object({ images: list(z.looseObject({ url: image('รูป') }), 1, 20, 'รูป'), autoplay }),
  Video: z.object({ url: httpUrl('ลิงก์วิดีโอ') }),
  VideoGallery: z.object({ videos: list(z.looseObject({ url: httpUrl('ลิงก์วิดีโอ') }), 1, 20, 'วิดีโอ'), autoplay }),
  AudioEmbed: z.object({ url: httpUrl('ลิงก์เพลง').refine(mssgIsAudioUrl, 'รองรับเฉพาะลิงก์ YouTube, Spotify, Apple Music, SoundCloud หรือ Mixcloud') }),
  Giphy: z.object({ giphyId: len(1, 100, 'รหัส GIF (Giphy ID)') }),
  Map: z.object({ address: len(10, 300, 'ที่อยู่') }),
  Timer: z.object({ local: z.string().min(1, 'เลือกวันเวลาสิ้นสุด').refine(v => !Number.isNaN(new Date(v).getTime()), 'วันเวลาไม่ถูกต้อง') }),
  Divider: z.object({}),
  Accordion: z.object({ items: list(z.looseObject({ title: len(3, 250, 'คำถาม'), content: len(3, 20_000, 'คำตอบ') }), 1, 50, 'คำถาม') }),
  Features: z.object({ items: list(z.looseObject({ title: len(1, 250, 'หัวข้อ'), text: maxLen(1000, 'คำอธิบาย') }), 1, 20, 'จุดเด่น') }),
  Messengers: z.object({
    messengers: list(z.looseObject({ platform: z.string().min(1, 'เลือกแอปแชท'), value: len(1, 250, 'ช่องทางติดต่อ'), enabled: z.boolean() }), 1, 10, 'ปุ่มแชท')
  }),
  Socials: z.object({ items: list(z.looseObject({ url: httpUrl('ลิงก์โซเชียล') }), 1, 30, 'ลิงก์โซเชียล') }),
  Products: z.object({}),
  SubscriptionForm: z.object({
    items: list(z.looseObject({
      type: z.enum(['text', 'email', 'phone'], { error: 'เลือกชนิดช่อง' }),
      label: len(1, 100, 'ชื่อช่อง'),
      required: z.boolean()
    }), 1, 10, 'ช่องในฟอร์ม'),
    sendLabel: len(1, 50, 'ข้อความบนปุ่มส่ง'),
    sentText: len(1, 500, 'ข้อความหลังส่งสำเร็จ')
  }),
  CustomCode: z.object({ content: z.string().min(1, 'กรอกโค้ด HTML').max(30_000, 'โค้ดยาวได้ไม่เกิน 30,000 ตัวอักษร') })
}

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
    case 'Hat': return { header: '', subheader: '', image: null }
    case 'Link': return { title: '', action: { type: 'url', url: '' } }
    case 'TextRich': return { html: '', editorState: null }
    case 'Image': return { url: '', action: { type: 'none' } }
    case 'ImageGallery': return { images: [{ url: '' }], autoplay: 0 }
    case 'Video': return { url: '' }
    case 'VideoGallery': return { videos: [{ url: '' }], autoplay: 0 }
    case 'AudioEmbed': return { url: '' }
    case 'Giphy': return { giphyId: '' }
    case 'Map': return { address: '' }
    case 'Timer': return { expireDate: '' }
    case 'Accordion': return { items: [{ title: '', content: '' }] }
    case 'Features': return { items: [{ title: '', text: '', glyph: { type: 'emoji', value: '⭐' } }] }
    case 'Messengers': return { messengers: [{ platform: 'line', type: 'link', value: '', enabled: true }] }
    case 'Socials': return { items: [{ url: '' }] }
    case 'SubscriptionForm': return { items: [{ type: 'email', label: 'Email', required: true }], sendLabel: 'Send', sentText: 'ขอบคุณ เราได้รับข้อมูลแล้ว' }
    case 'CustomCode': return { content: '' }
    default: return {}
  }
}

/** the `fields` keys the form of a kind edits (only these are compared / sent) */
export const MSSG_BLOCK_KEYS: Record<string, string[]> = {
  Hat: ['header', 'subheader', 'image'],
  Link: ['title', 'action'],
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

/** block `fields` → form state of its kind */
export function mssgBlockToForm(kind: string, fields: Record<string, unknown>): Record<string, unknown> {
  const f = { ...mssgBlockDefaults(kind), ...clone(fields) }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  switch (kind) {
    case 'Hat': return { header: str(f.header), subheader: str(f.subheader), image: typeof f.image === 'string' && f.image ? f.image : null }
    case 'TextRich': return { text: mssgHtmlToText(str(f.html)) }
    case 'Timer': return { local: mssgIsoToLocalInput(f.expireDate) }
    case 'Link': {
      const a = isPlain(f.action) ? f.action : {}
      const action = a.type === 'page' ? { ...a, page: str(a.page) } : { ...a, type: a.type === 'url' || !a.type ? 'url' : a.type, url: str(a.url) }
      return { title: str(f.title), action }
    }
    case 'Image': {
      const a = isPlain(f.action) ? f.action : { type: 'none' }
      return { url: str(f.url), action: a.type === 'url' ? { ...a, url: str(a.url) } : { ...a, type: a.type ?? 'none' } }
    }
    case 'ImageGallery':
    case 'VideoGallery': return { ...f, autoplay: typeof f.autoplay === 'number' ? f.autoplay : 0 }
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
  if (kind === 'Hat' && !out.image) out.image = null
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
      return s(f.header) || s(f.subheader)
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
}

/**
 * Where an error / conflict lands: from the op at `opIndex` (v1.3: index in the stored draft) when there is one,
 * else from an id path (`pages.<id>.blocks.<id>.<field>`, `pages.<id>.<field>`). `fields.` / `site.` prefixes drop.
 */
export function mssgOpTarget(op: MssgOp | null | undefined, path: string): MssgOpTarget {
  let p = path.replace(/^site\./, '')
  let pageId: string | null = null
  let blockId: string | null = null
  const m = /^pages\.([^.]+)(?:\.blocks\.([^.]+))?(?:\.(.*))?$/.exec(p)
  if (m) {
    pageId = m[1]!
    blockId = m[2] ?? null
    p = m[3] ?? ''
  }
  if (op) {
    const o = op as unknown as Record<string, string | undefined>
    if (op.op.startsWith('page.')) {
      pageId = o.pageId ?? o.tempId ?? pageId
      blockId = null
    } else if (op.op.startsWith('block.')) {
      pageId = o.pageId ?? pageId
      blockId = op.op === 'block.create' ? o.tempId! : (o.blockId ?? blockId)
    }
  }
  p = p.replace(/^fields\./, '')
  if (p === 'fields') p = ''
  return { pageId, blockId, field: p }
}

const PAGE_FIELD_LABEL: Record<string, string> = {
  'name': 'ชื่อหน้า',
  'slug': 'ลิงก์ของหน้า (slug)',
  'enabled': 'แสดงหน้า',
  'seo.title': 'SEO title ของหน้า',
  'seo.description': 'SEO description ของหน้า',
  'order': 'ลำดับ block',
  'theme.page.backgroundColor': 'สีพื้นหลังของหน้า',
  'theme.page.backgroundImage': 'รูปพื้นหลังของหน้า'
}

const BLOCK_FIELD_LABEL: Record<string, string> = {
  enabled: 'ซ่อน / แสดง',
  title: 'ชื่อ',
  action: 'กดแล้วทำอะไร',
  url: 'ลิงก์',
  html: 'ข้อความ',
  header: 'ชื่อ',
  subheader: 'คำอธิบายสั้น',
  image: 'รูป',
  images: 'รูปภาพ',
  videos: 'วิดีโอ',
  autoplay: 'เล่นอัตโนมัติ',
  giphyId: 'รหัส GIF',
  address: 'ที่อยู่',
  expireDate: 'วันเวลาสิ้นสุด',
  items: 'รายการ',
  messengers: 'ปุ่มแชท',
  sendLabel: 'ข้อความบนปุ่มส่ง',
  sentText: 'ข้อความหลังส่งสำเร็จ',
  content: 'เนื้อหา'
}

export function mssgPageFieldLabel(field: string): string {
  return PAGE_FIELD_LABEL[field] ?? field
}

export function mssgBlockFieldLabel(field: string): string {
  const [head, idx, ...rest] = field.split('.')
  const base = BLOCK_FIELD_LABEL[head!] ?? head ?? ''
  if (idx !== undefined && /^\d+$/.test(idx)) return `${base} ที่ ${Number(idx) + 1}${rest.length ? ` · ${BLOCK_FIELD_LABEL[rest.join('.')] ?? rest.join('.')}` : ''}`
  return field.includes('.') && !BLOCK_FIELD_LABEL[field] ? `${base} · ${field.split('.').slice(1).join('.')}` : base
}

/**
 * Thai label of a page / block field error or conflict item — `null` when the op / path is not about a page or block
 * (the caller falls back to the site field labels). Names come from `sites` (the first that knows the id).
 */
export function mssgPageBlockLabel(op: MssgOp | null | undefined, path: string, sites: (MssgSiteProjection | null | undefined)[]): string | null {
  const isPageOrBlock = (op && (op.op.startsWith('page.') || op.op.startsWith('block.'))) || /^(site\.)?pages\./.test(path)
  if (!isPageOrBlock) return null
  const t = mssgOpTarget(op, path)
  const page = t.pageId ? sites.map(s => s?.pages.find(p => p.id === t.pageId)).find(Boolean) : undefined
  const pageName = page ? `หน้า "${page.name}"` : 'หน้าเว็บ'
  if (/(^|\.)order$/.test(path) || op?.op === 'block.move') return `ลำดับ block ใน${pageName}`
  if (t.blockId) {
    const block = sites.map(s => s?.pages.flatMap(p => p.blocks).find(b => b.id === t.blockId)).find(Boolean)
    const kind = block?.kind ?? (op?.op === 'block.create' ? op.kind : '')
    const name = `block ${kind ? mssgBlockKindLabel(kind) : ''}`.trim()
    return `${name} ใน${pageName}${t.field ? ` · ${mssgBlockFieldLabel(t.field)}` : ''}`
  }
  return `${pageName}${t.field ? ` · ${mssgPageFieldLabel(t.field)}` : ''}`
}

/** conflict item of a page / block / order (null for site fields) */
export function mssgConflictItemLabel(item: MssgConflictItem, ops: MssgOp[], sites: (MssgSiteProjection | null | undefined)[]): string | null {
  return mssgPageBlockLabel(ops[item.opIndex], item.path, sites)
}
