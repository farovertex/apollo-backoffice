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
  MssgStepNo
} from '#shared/types/mssg-sites'

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
  'embeddedCode.onLoad': 'Run code after page content load'
}

/** `site.seo.title` / `fields.seo.title` / `seo.title` → `seo.title` */
export function mssgNormalizePath(path: string): string {
  return path.replace(/^site\./, '').replace(/^fields\./, '')
}

export function mssgFieldLabel(path: string): string {
  const p = mssgNormalizePath(path)
  if (MSSG_FIELD_LABEL[p]) return MSSG_FIELD_LABEL[p]!
  if (/^pages\.[^.]+\.order$/.test(p)) return 'ลำดับ block ในหน้า'
  if (p.startsWith('pages.')) return 'หน้าเว็บ'
  if (p.startsWith('products.')) return 'สินค้า'
  return p
}

const STEP4_PREFIXES = ['seo.', 'tracking.', 'embeddedCode.']

/** which editor step a field of an op belongs to (step badges for errors and conflicts) */
export function mssgStepOf(op: Pick<MssgOp, 'op'> | null | undefined, path: string): MssgStepNo {
  const p = mssgNormalizePath(path)
  const type = op?.op ?? ''
  if (type.startsWith('product.') || p.startsWith('products.')) return 5
  if (type === 'page.update' && p.startsWith('theme.')) return 3
  if (type.startsWith('page.') || type.startsWith('block.') || p.startsWith('pages.')) return 2
  if (STEP4_PREFIXES.some(x => p.startsWith(x))) return 4
  return 1
}

/** a key of the step-1 form for a site field path (`localization.lang` → `lang`), or `null` */
export function mssgStep1Key(path: string): keyof MssgSiteSettingsForm | null {
  const p = mssgNormalizePath(path)
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
}

export function mssgIssuesToFieldErrors(issues: { path: string, message: string }[] | undefined, ops: MssgOp[]): MssgFieldError[] {
  return (issues ?? []).map((issue) => {
    const m = /^ops\.(\d+)\.(.*)$/.exec(issue.path ?? '')
    const opIndex = m ? Number(m[1]) : null
    const path = mssgNormalizePath(m ? m[2]! : (issue.path ?? ''))
    const op = opIndex !== null ? ops[opIndex] : undefined
    return { opIndex, path, message: issue.message, step: mssgStepOf(op, path) }
  })
}

export function mssgApplyErrorsToFieldErrors(fields: { opIndex: number, path: string, message: string }[] | undefined, ops: MssgOp[]): MssgFieldError[] {
  return (fields ?? []).map((f) => {
    const path = mssgNormalizePath(f.path)
    return { opIndex: f.opIndex, path, message: f.message, step: mssgStepOf(ops[f.opIndex], path) }
  })
}

export function mssgConflictStep(item: MssgConflictItem, ops: MssgOp[]): MssgStepNo {
  return mssgStepOf(ops[item.opIndex], item.path)
}

// ── ops ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface MssgDestructiveOp {
  index: number
  type: MssgOp['op']
  /** Thai sentence for the confirm dialog */
  label: string
}

/** contract §3.1: `page.delete`, `block.delete`, `product.delete`, `site.update` with `enabled: false` while live is on */
export function mssgDestructiveOps(ops: MssgOp[], live: Pick<MssgSiteProjection, 'enabled' | 'pages'> | null | undefined): MssgDestructiveOp[] {
  const out: MssgDestructiveOp[] = []
  ops.forEach((op, index) => {
    if (op.op === 'site.update' && op.fields.enabled === false && live?.enabled === true) {
      out.push({ index, type: op.op, label: 'ปิดการเผยแพร่เว็บ (Unpublish)' })
    } else if (op.op === 'page.delete') {
      const page = live?.pages.find(p => p.id === op.pageId)
      out.push({ index, type: op.op, label: `ลบหน้า "${page?.name ?? op.pageId}"` })
    } else if (op.op === 'block.delete') {
      out.push({ index, type: op.op, label: `ลบ block ${op.blockId}` })
    } else if (op.op === 'product.delete') {
      out.push({ index, type: op.op, label: `ลบสินค้า ${op.productId}` })
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

// ── blocks (labels for the preview; B2 adds the editors) ────────────────────────────────────────────────────────────
export const MSSG_BLOCK_KIND_LABEL: Record<string, string> = {
  Hat: 'ภาพปก/โปรไฟล์',
  Link: 'ลิงก์',
  TextRich: 'ข้อความ',
  Image: 'รูปภาพ',
  ImageGallery: 'แกลเลอรี',
  Video: 'วิดีโอ',
  VideoGallery: 'คลังวิดีโอ',
  AudioEmbed: 'เพลง',
  Giphy: 'Giphy',
  Map: 'แผนที่',
  Timer: 'นับถอยหลัง',
  Divider: 'เส้นคั่น',
  Accordion: 'คำถามพบบ่อย',
  Features: 'จุดเด่น',
  Messengers: 'ปุ่มแชท',
  Socials: 'โซเชียล',
  Products: 'สินค้า',
  SubscriptionForm: 'ฟอร์ม',
  CustomCode: 'โค้ด HTML'
}

export function mssgBlockKindLabel(kind: string): string {
  return MSSG_BLOCK_KIND_LABEL[kind] ?? kind
}

/** one short line of text of a block for the simple preview (B2 renders each kind properly) */
export function mssgBlockPreviewText(fields: Record<string, unknown> | null | undefined): string {
  if (!fields) return ''
  for (const key of ['title', 'header', 'label', 'address', 'url', 'content']) {
    const v = fields[key]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 80)
  }
  const html = fields.html
  if (typeof html === 'string') return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
  return ''
}

/** the home page of a projection (by `homePageId`, else the first page) */
export function mssgHomePage(site: Pick<MssgSiteProjection, 'pages' | 'homePageId'> | null | undefined) {
  if (!site?.pages?.length) return null
  return site.pages.find(p => p.id === site.homePageId) ?? site.pages[0]!
}
