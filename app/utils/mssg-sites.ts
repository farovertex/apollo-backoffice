/**
 * FEAT-101 — Thai texts and pure helpers of the mssg site editor (`/mssg-pages/sites/[siteId]`, spec "UI behaviour",
 * api-contract.md v1 §2–§3). Steps follow the design's `stepsDef` (D11); the readiness itself comes from the API.
 * Field rules mirror contract §3.3 (mssg's own 400 stays the authority, AC-14).
 */
import * as z from 'zod'
import type {
  MssgApexDomain,
  MssgConflictItem,
  MssgDraftView,
  MssgOp,
  MssgSiteLang,
  MssgSiteProjection,
  MssgSiteView,
  MssgStepNo,
  MssgStoreProduct
} from '#shared/types/mssg-sites'
import { mssgBlockKindLabel, mssgBlockSummary, mssgConflictItemLabel, mssgOpTarget, mssgPageBlockLabel } from './mssg-blocks'
import type { MssgOpTarget } from './mssg-blocks'

/** a draft change by another user younger than this shows "กำลังแก้ร่างนี้อยู่" (spec "UI behaviour") */
export const MSSG_DRAFT_OTHER_MS = 10 * 60 * 1000
/** autosave debounce after the last change (spec: ≤ 1 s) */
export const MSSG_DRAFT_DEBOUNCE_MS = 800

export const MSSG_EDITOR_TEXT = {
  notFound: 'ไม่พบเว็บนี้',
  loadFailed: 'โหลดเว็บนี้ไม่สำเร็จ',
  draftDirty: 'ร่างยังไม่บันทึกไปที่ mssg',
  draftSaving: 'กำลังบันทึกร่าง…',
  draftSaveFailed: 'บันทึกร่างไม่สำเร็จ',
  saved: 'บันทึกแล้ว ส่งการตั้งค่าไปยัง mssg เรียบร้อย',
  applying: 'กำลังบันทึกไปที่ mssg…',
  gone: 'เว็บนี้ไม่มีอยู่บน mssg แล้ว (อาจถูกลบที่ mssg) · ทำได้อย่างเดียวคือทิ้งร่าง',
  placeholder: 'กำลังพัฒนา · ส่วนนี้จะเปิดให้แก้ในรอบถัดไป',
  brandingNote: 'การปิดอาจต้องใช้แพ็กเกจเสียเงิน',
  unpublishNote: 'ปิดแล้วคนทั่วไปจะเปิดเว็บนี้ไม่ได้ · ต้องยืนยันอีกครั้งตอนบันทึก',
  notConnected: 'บัญชี mssg ของเว็บนี้ยังไม่ได้เชื่อม ต้องเข้าสู่ระบบใหม่ก่อนจึงจะแก้หรือบันทึกได้'
} as const

// ── steps (design `stepsDef`, D11) ──────────────────────────────────────────────────────────────────────────────────
export interface MssgEditorStep {
  n: MssgStepNo
  title: string
  sub: string
  sheet: string
}

export const MSSG_EDITOR_STEPS: MssgEditorStep[] = [
  { n: 1, title: 'ตั้งค่าเว็บ', sub: 'สถานะ · ชื่อ · URL · โดเมน · ภาษา', sheet: 'Website Settings · ตั้งค่าเว็บ' },
  { n: 2, title: 'หน้าและ block', sub: 'Pages · 19 block', sheet: 'Pages & Blocks · หน้าและเนื้อหา' },
  { n: 3, title: 'หน้าตา', sub: 'ธีม · พื้นหลัง · ฟอนต์', sheet: 'Page decoration · หน้าตาเว็บ' },
  { n: 4, title: 'SEO และ Tracking', sub: 'SEO · Pixel · Embed code', sheet: 'SEO, Tracking & Embed code' },
  { n: 5, title: 'ร้านค้าและข้อมูลลูกค้า', sub: 'สินค้า · ชำระเงิน · Audience · Requests', sheet: 'ร้านค้า · Audience · Requests' }
]

export function mssgStepTitle(n: number): string {
  return MSSG_EDITOR_STEPS.find(s => s.n === n)?.title ?? `ขั้นที่ ${n}`
}

// ── site settings (contract §3.3) ───────────────────────────────────────────────────────────────────────────────────
export const MSSG_APEX_DOMAINS: MssgApexDomain[] = ['mssg.me', 'stick.ws', 'linksbio.site', 'lnkbio.site', 'shopbio.site']

export const MSSG_LANG_OPTIONS: { value: MssgSiteLang, label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'uk', label: 'Українська' },
  { value: 'ru', label: 'Русский' },
  { value: 'pt', label: 'Português' },
  { value: 'th', label: 'ไทย' },
  { value: 'es', label: 'Español' },
  { value: 'ru-kz', label: 'Русский (Казахстан)' }
]

/** step-1 client rules, Thai messages (contract §3.3 "Site") */
export const mssgSiteSettingsSchema = z.object({
  name: z.string()
    .trim()
    .min(3, 'ชื่อเว็บต้องยาว 3–250 ตัวอักษร')
    .max(250, 'ชื่อเว็บต้องยาว 3–250 ตัวอักษร'),
  subdomain: z.string()
    .min(4, 'ชื่อลิงก์ต้องยาว 4–50 ตัวอักษร')
    .max(50, 'ชื่อลิงก์ต้องยาว 4–50 ตัวอักษร')
    .regex(/^[a-z0-9-]+$/, 'ชื่อลิงก์ใช้ได้เฉพาะ a-z ตัวเล็ก ตัวเลข และขีด (-)'),
  apexDomain: z.enum(MSSG_APEX_DOMAINS as [MssgApexDomain, ...MssgApexDomain[]], { error: 'เลือกโดเมนหลักจากรายการ' }),
  lang: z.enum(MSSG_LANG_OPTIONS.map(o => o.value) as [MssgSiteLang, ...MssgSiteLang[]], { error: 'เลือกภาษาจากรายการ' }),
  enabled: z.boolean(),
  branding: z.boolean()
})
export type MssgSiteSettingsForm = z.output<typeof mssgSiteSettingsSchema>

// ── step 3 / 4 (contract §3.3: page look, SEO, tracking, embed code) ──────────────────────────────────────────────────
export const MSSG_SEO_TITLE_MAX = 80
export const MSSG_SEO_DESC_MAX = 200
export const MSSG_TRACKING_MAX = 100
export const MSSG_EMBED_MAX = 30_000
export const MSSG_HEX_RE = /^#[0-9A-Fa-f]{6}$/
/** v1.11: the preview carries a preset's colours as `#rrggbbaa` too — the field shows / accepts both */
export const MSSG_HEX_DISPLAY_RE = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/

/**
 * The value the API accepts (`^#[0-9A-Fa-f]{6}$`, contract §3.3) for a hex shown in the field: a 6-digit colour as is,
 * an opaque 8-digit one (`…FF`) without its alpha, anything else (translucent, invalid) `null` = not sent.
 */
export function mssgSendableColor(v: string): string | null {
  if (MSSG_HEX_RE.test(v)) return v.toUpperCase()
  if (/^#[0-9A-Fa-f]{6}[Ff]{2}$/.test(v)) return v.slice(0, 7).toUpperCase()
  return null
}

/** "" is allowed (cleared); otherwise `min`–`max` characters, as mssg */
function optionalText(label: string, min: number, max: number) {
  return z.string().refine(v => v.trim() === '' || (v.trim().length >= min && v.trim().length <= max), `${label}ต้องยาว ${min}–${max} ตัวอักษร หรือเว้นว่าง`)
}

/** step-4 client rules, Thai messages — the form state is nested like the site projection */
export const mssgSeoStepSchema = z.object({
  seo: z.object({
    title: optionalText('ชื่อที่แสดงบน Google', 3, MSSG_SEO_TITLE_MAX),
    description: optionalText('คำอธิบาย', 3, MSSG_SEO_DESC_MAX)
  }),
  tracking: z.object({
    tiktok: z.string().trim().max(MSSG_TRACKING_MAX, `ไอดี Pixel ยาวได้ไม่เกิน ${MSSG_TRACKING_MAX} ตัวอักษร`),
    facebook: z.string().trim().max(MSSG_TRACKING_MAX, `ไอดี Pixel ยาวได้ไม่เกิน ${MSSG_TRACKING_MAX} ตัวอักษร`),
    google: z.string().trim().max(MSSG_TRACKING_MAX, `ไอดี Google Analytics ยาวได้ไม่เกิน ${MSSG_TRACKING_MAX} ตัวอักษร`)
  }),
  embeddedCode: z.object({
    content: z.string().max(MSSG_EMBED_MAX, `โค้ดยาวได้ไม่เกิน ${MSSG_EMBED_MAX.toLocaleString('en-US')} ตัวอักษร`)
  })
})
export type MssgSeoStepForm = z.output<typeof mssgSeoStepSchema>

/** step-3 hex field: a `#RRGGBB` (or the preview's `#RRGGBBAA`) colour, or empty = "ใช้ตามธีม" (null) */
export const mssgBgColorSchema = z.string().refine(v => v === '' || MSSG_HEX_DISPLAY_RE.test(v), 'ใส่สีเป็นรหัส hex เช่น #1A2B3C (6 หลัก)')

export const MSSG_STEP3_TEXT = {
  themes: 'ธีม (Theme presets)',
  fonts: 'ฟอนต์ (Fonts)',
  useTheme: 'ใช้ตามธีม',
  applyAll: 'ใช้กับทุกหน้า',
  applyAllDone: (n: number) => `ใช้หน้าตานี้กับ ${n} หน้าแล้ว`,
  themeRule: 'เลือกธีมแล้ว สีของหน้า (พื้นหลัง ปุ่ม ตัวอักษร) จะเปลี่ยนเป็นสีของธีม · สีหรือรูปพื้นหลังที่ตั้งเองในร่างนี้ยังใช้ต่อ',
  applyAllHint: 'ใช้ธีม ฟอนต์ สีและรูปพื้นหลังของหน้านี้กับทุกหน้าของเว็บ (ร่างเปลี่ยนทีละหน้า)'
} as const

/** `https://<subdomain>.<apex>/`, or the connected own domain (AC-10) */
export function mssgSiteUrl(subdomain: string, apex: string, ownDomain?: string | null): string {
  if (ownDomain) return `https://${ownDomain}/`
  return `https://${subdomain || '…'}.${apex || 'mssg.me'}/`
}

// ── field paths, labels and steps ───────────────────────────────────────────────────────────────────────────────────
/** Thai label per Apollo field path (site paths without the `site.` prefix) */
export const MSSG_FIELD_LABEL: Record<string, string> = {
  'name': 'ชื่อเว็บ',
  'subdomain': 'ชื่อลิงก์',
  'apexDomain': 'โดเมนหลัก',
  'enabled': 'สถานะเว็บ (เผยแพร่)',
  'branding': 'Mssg.me Branding',
  'localization.lang': 'ภาษาของหน้าเว็บ',
  'domain.name': 'โดเมนของคุณเอง',
  'seo.title': 'SEO title',
  'seo.description': 'SEO description',
  'seo.indexing': 'ให้ search engine เก็บข้อมูล',
  'seo.faviconUrl': 'Favicon',
  'seo.ogImageUrl': 'รูปตอนแชร์ (OG image)',
  'tracking.google': 'Google Analytics',
  'tracking.facebook': 'Facebook Pixel',
  'tracking.tiktok': 'TikTok Pixel',
  'embeddedCode.content': 'Embed code',
  'embeddedCode.inHead': 'Insert into HEAD tag',
  'embeddedCode.onLoad': 'Run code after page content load',
  'menu': 'เมนู',
  'menu.enabled': 'เมนู · แสดง / ซ่อน',
  'menu.items': 'เมนู · ลำดับและชื่อ'
}

/** v1.4 site path (`site.seo.title`) → the field (`seo.title`); other paths (`pages.<id>…`, `products.<id>…`) unchanged */
export function mssgSitePath(path: string): string {
  return path.replace(/^site\./, '')
}

/** a zod issue path of a draft PUT, after `ops.<n>.`: `fields.seo.title` / `seo.title` → `seo.title` */
export function mssgNormalizePath(path: string): string {
  return mssgSitePath(path).replace(/^fields\./, '')
}

/** M4: Thai label per product field (the part after `products.<id>.` / a draft-400 field of a product op) */
export const MSSG_PRODUCT_FIELD_LABEL: Record<string, string> = {
  'name': 'ชื่อสินค้า',
  'photos': 'รูปสินค้า',
  'price': 'ราคา',
  'price.amount': 'ราคา',
  'price.currency': 'สกุลเงิน',
  'discount': 'ส่วนลด',
  'description': 'รายละเอียด',
  'notes': 'หมายเหตุ',
  'active': 'สถานะสินค้า (Active)'
}

/** "สินค้า "<name>" · ราคา" — the name comes from `products` (first that knows the id), else only the field */
export function mssgProductLabel(productId: string, field: string, products: (MssgStoreProduct | null | undefined)[] = []): string {
  const name = products.find(p => p?.id === productId)?.name
  const f = field ? (MSSG_PRODUCT_FIELD_LABEL[field] ?? field.replace(/^photos\.\d+.*/, 'รูปสินค้า')) : ''
  return `สินค้า${name ? ` "${name}"` : ''}${f ? ` · ${f}` : ''}`
}

export function mssgFieldLabel(path: string): string {
  const p = mssgSitePath(path)
  if (MSSG_FIELD_LABEL[p]) return MSSG_FIELD_LABEL[p]!
  if (/^pages\.[^.]+\.order$/.test(p)) return 'ลำดับ block ในหน้า'
  if (/^menu\.items\.\d+/.test(p)) return `เมนู · รายการที่ ${Number(p.split('.')[2]) + 1}`
  if (p.startsWith('pages.')) return 'หน้าเว็บ'
  if (p.startsWith('products.')) {
    const m = /^products\.([^.]+)(?:\.(.*))?$/.exec(p)
    return m ? mssgProductLabel(m[1]!, m[2] ?? '') : 'สินค้า'
  }
  return p
}

const STEP4_PREFIXES = ['seo.', 'tracking.', 'embeddedCode.']

/** which editor step a field of an op belongs to (step badges for errors and conflicts) */
export function mssgStepOf(op: Pick<MssgOp, 'op'> | null | undefined, path: string): MssgStepNo {
  const p = mssgSitePath(path)
  const type = op?.op ?? ''
  if (type.startsWith('product.') || p.startsWith('products.')) return 5
  const t = mssgOpTarget(op as MssgOp | null | undefined, p)
  // page look (theme.*) is step 3; everything else of a page / block is step 2
  if (t.pageId && !t.blockId && t.field.startsWith('theme.')) return 3
  if (t.pageId || type.startsWith('page.') || type.startsWith('block.')) return 2
  // v1.6: the menu is edited in step 2
  if (/^menu(\.|$)/.test(p)) return 2
  if (STEP4_PREFIXES.some(x => p.startsWith(x))) return 4
  return 1
}

/** a key of the step-1 form for a site field path (`localization.lang` → `lang`), or `null` */
export function mssgStep1Key(path: string): keyof MssgSiteSettingsForm | null {
  const p = mssgSitePath(path)
  if (p === 'localization.lang' || p === 'localization') return 'lang'
  if (p === 'name' || p === 'subdomain' || p === 'apexDomain' || p === 'enabled' || p === 'branding') return p
  return null
}

/**
 * Field errors keyed by `<opIndex>:<normalized path>` from a 400 of `PUT …/draft` (`ops.<n>.fields.<path>`, or
 * `ops.<n>.<key>`) — the editor maps them to the step and the form field of that op.
 */
export interface MssgFieldError {
  opIndex: number | null
  path: string
  message: string
  step: MssgStepNo
  /** B2: page / block the error belongs to (`null` for site fields) and the field inside it */
  target: MssgOpTarget
}

export function mssgIssuesToFieldErrors(issues: { path: string, message: string }[] | undefined, ops: MssgOp[]): MssgFieldError[] {
  return (issues ?? []).map((issue) => {
    const m = /^ops\.(\d+)\.(.*)$/.exec(issue.path ?? '')
    const opIndex = m ? Number(m[1]) : null
    const path = mssgNormalizePath(m ? m[2]! : (issue.path ?? ''))
    const op = opIndex !== null ? ops[opIndex] : undefined
    return { opIndex, path, message: issue.message, step: mssgStepOf(op, path), target: mssgOpTarget(op, m ? m[2]! : (issue.path ?? '')) }
  })
}

export function mssgApplyErrorsToFieldErrors(fields: { opIndex: number, path: string, message: string }[] | undefined, ops: MssgOp[]): MssgFieldError[] {
  return (fields ?? []).map((f) => {
    // v1.4: the path is already in its final form (`site.…`, `pages.<id>.…`) — no guessing
    const path = mssgSitePath(f.path)
    return { opIndex: f.opIndex, path, message: f.message, step: mssgStepOf(ops[f.opIndex], path), target: mssgOpTarget(ops[f.opIndex], f.path) }
  })
}

export function mssgConflictStep(item: MssgConflictItem, ops: MssgOp[]): MssgStepNo {
  return mssgStepOf(ops[item.opIndex], item.path)
}

/** Thai label of a conflict item: page / block / order items name the page and block (B2), else the site field */
export function mssgConflictLabel(item: MssgConflictItem, ops: MssgOp[], sites: (MssgSiteProjection | null | undefined)[], products: (MssgStoreProduct | null | undefined)[] = []): string {
  const t = mssgOpTarget(ops[item.opIndex], item.path)
  if (t.productId) return mssgProductLabel(t.productId, t.field, products)
  return mssgConflictItemLabel(item, ops, sites) ?? mssgFieldLabel(item.path)
}

/** Thai label of a field error (site field, or page / block field with its names) */
export function mssgFieldErrorLabel(e: MssgFieldError, ops: MssgOp[], sites: (MssgSiteProjection | null | undefined)[], products: (MssgStoreProduct | null | undefined)[] = []): string {
  if (e.target.productId) return mssgProductLabel(e.target.productId, e.target.field, products)
  return (e.opIndex !== null ? mssgPageBlockLabel(ops[e.opIndex], e.path, sites) : mssgPageBlockLabel(null, e.path, sites)) ?? mssgFieldLabel(e.path)
}

// ── ops ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MssgDestructiveOp {
  index: number
  type: MssgOp['op']
  /** Thai sentence for the confirm dialog */
  label: string
}

/** contract §3.1: `page.delete`, `block.delete`, `product.delete`, `site.update` with `enabled: false` while live is on */
export function mssgDestructiveOps(ops: MssgOp[], live: Pick<MssgSiteProjection, 'enabled' | 'pages'> | null | undefined, products: (MssgStoreProduct | null | undefined)[] = []): MssgDestructiveOp[] {
  const out: MssgDestructiveOp[] = []
  const pageName = (id: string) => live?.pages?.find(p => p.id === id)?.name ?? id
  ops.forEach((op, index) => {
    if (op.op === 'site.update' && op.fields.enabled === false && live?.enabled === true) {
      out.push({ index, type: op.op, label: 'ปิดการเผยแพร่เว็บ (Unpublish)' })
    } else if (op.op === 'page.delete') {
      out.push({ index, type: op.op, label: `ลบหน้า "${pageName(op.pageId)}"` })
    } else if (op.op === 'block.delete') {
      const block = live?.pages?.find(p => p.id === op.pageId)?.blocks.find(b => b.id === op.blockId)
      const what = block ? `${mssgBlockKindLabel(block.kind)}${mssgBlockSummary(block) ? ` · ${mssgBlockSummary(block)}` : ''}` : op.blockId
      out.push({ index, type: op.op, label: `ลบ block "${what}" ในหน้า "${pageName(op.pageId)}"` })
    } else if (op.op === 'product.delete') {
      const name = products.find(p => p?.id === op.productId)?.name
      out.push({ index, type: op.op, label: `ลบสินค้า "${name ?? op.productId}"` })
    }
  })
  return out
}

/** deep merge of plain objects (arrays and scalars replace) — used to fold edits into one `site.update` */
export function mssgMergeFields<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    const prev = out[k]
    if (v && typeof v === 'object' && !Array.isArray(v) && prev && typeof prev === 'object' && !Array.isArray(prev)) {
      out[k] = mssgMergeFields(prev as Record<string, unknown>, v as Record<string, unknown>)
    } else {
      out[k] = v
    }
  }
  return out as T
}

export function mssgGetPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

// ── draft / view helpers ────────────────────────────────────────────────────────────────────────────────────────────
/** the name of another admin who changed the draft ≤ 10 min ago, else `null` */
export function mssgDraftOtherEditor(draft: MssgDraftView | null | undefined, meId: string | null | undefined, nowMs: number): string | null {
  if (!draft?.updatedBy || !draft.updatedAt) return null
  if (meId && draft.updatedBy.id === meId) return null
  const t = new Date(draft.updatedAt).getTime()
  if (Number.isNaN(t) || nowMs - t > MSSG_DRAFT_OTHER_MS) return null
  return draft.updatedBy.name || 'ผู้ใช้อื่น'
}

export function mssgSiteJobOpen(view: Pick<MssgSiteView, 'job'> | null | undefined): boolean {
  return mssgJobIsOpen(view?.job)
}

/** a site / conflict value as one short line ("(ว่าง)" for empty, เปิด/ปิด for booleans) */
export function mssgValueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(ว่าง)'
  if (typeof value === 'boolean') return value ? 'เปิด' : 'ปิด'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  try {
    const s = JSON.stringify(value)
    return s.length > 200 ? `${s.slice(0, 200)}…` : s
  } catch {
    return String(value)
  }
}

/** the home page of a projection (by `homePageId`, else the first page) */
export function mssgHomePage(site: Pick<MssgSiteProjection, 'pages' | 'homePageId'> | null | undefined) {
  if (!site?.pages?.length) return null
  return site.pages.find(p => p.id === site.homePageId) ?? site.pages[0]!
}

// ── account job (contract v1.1 / v1.2: `view.account.job` may be any mssg job type) ─────────────────────────────────
export const MSSG_JOB_TYPE_TEXT: Record<string, string> = {
  mssgConnect: 'กำลังเชื่อมบัญชี mssg…',
  mssgSync: 'กำลังดึงข้อมูลจาก mssg…',
  mssgLogout: 'กำลังออกจากระบบ mssg…',
  mssgApply: 'กำลังบันทึกเว็บไปที่ mssg…',
  mssgSiteCreate: 'กำลังสร้างเว็บ…',
  mssgSiteDuplicate: 'กำลังทำสำเนาเว็บ…',
  mssgSiteDelete: 'กำลังลบเว็บ…',
  mssgDomain: 'กำลังตั้งค่าโดเมน…',
  mssgStoreRead: 'กำลังดึงข้อมูลร้านค้า…',
  mssgAnalytics: 'กำลังดึงสถิติ…'
}

/** what the site's own job is doing: the apply keeps its B1 text, every other type its job-type text (M4: store read) */
export function mssgOwnJobText(job: { type: string } | null | undefined): string {
  return !job || job.type === 'mssgApply' ? MSSG_EDITOR_TEXT.applying : mssgJobTypeText(job.type)
}

/** what a job of the account is doing; an unknown type → "กำลังทำงานกับ mssg…" */
export function mssgJobTypeText(type: string | null | undefined): string {
  return (type && MSSG_JOB_TYPE_TEXT[type]) || 'กำลังทำงานกับ mssg…'
}
