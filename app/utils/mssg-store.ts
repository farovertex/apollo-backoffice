/**
 * FEAT-101 M4 (spec D5, D8, AC-30..32; api-contract.md v1.5 §3.2 `product.*`, §3.3 products, §4.4 store) — step 5
 * "ร้านค้า · Audience · Requests".
 *
 * Pure helpers only (relative imports, no Nuxt auto-imports) so `tests/unit/mssg-store.test.ts` can run them:
 * - the product rules (zod, Thai messages) and the form ↔ op-field adapters;
 * - `mssgApplyProductOps()` — the client copy of "last store read + product ops" (the preview of the site does not hold
 *   products; the editor shows `store.products` with the draft's product ops laid over it);
 * - op folding: an edit of a product folds into its `product.update`, an edit of a product created in this draft goes
 *   into its `product.create`, deleting a product created in this draft drops its ops instead of sending a delete;
 * - read-only store settings text (D5): switches shown as on / off, payment methods by name;
 * - display helpers for customer data: a defensive mask (the API masks before it stores, D8 — anything that still
 *   looks like an e-mail or phone is masked again here), request tabs.
 */
import * as z from 'zod'
import type {
  MssgOp,
  MssgOpProductCreate,
  MssgOpProductUpdate,
  MssgProductFields,
  MssgRequestStatus,
  MssgStore,
  MssgStoreProduct,
  MssgStoreSettings
} from '../../shared/types/mssg-sites'
import { mssgIsImageValue, mssgIsTempId } from './mssg-blocks'

// ── rules (contract §3.3 "Products") ────────────────────────────────────────────────────────────────────────────────
export const MSSG_PRODUCT_NAME_MAX = 100
export const MSSG_PRODUCT_DESC_MAX = 5000
export const MSSG_PRODUCT_NOTES_MAX = 1000
export const MSSG_PRODUCT_PHOTOS_MAX = 10

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v)) as T
}

/** a decimal number ≥ 0 typed in a text / number input ("" is not a number) */
export function mssgParseAmount(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** the form state of one product: inputs as strings, photos as a list of upload refs / URLs */
export interface MssgProductForm {
  name: string
  photos: string[]
  amount: string
  discount: string
  description: string
  notes: string
  active: boolean
}

export const MSSG_PRODUCT_TEXT = {
  name: 'ชื่อสินค้าต้องยาว 3–100 ตัวอักษร',
  photosMin: 'ต้องมีรูปสินค้าอย่างน้อย 1 รูป',
  photosMax: `รูปสินค้าได้ไม่เกิน ${MSSG_PRODUCT_PHOTOS_MAX} รูป`,
  photoBad: 'รูปต้องเป็นรูปที่อัปโหลด หรือลิงก์ http(s)',
  amount: 'ราคาต้องเป็นตัวเลข 0 ขึ้นไป',
  discount: 'ส่วนลดต้องเป็นตัวเลข 0 ขึ้นไป หรือเว้นว่าง',
  description: `รายละเอียดยาวได้ไม่เกิน ${MSSG_PRODUCT_DESC_MAX.toLocaleString('en-US')} ตัวอักษร`,
  notes: `หมายเหตุยาวได้ไม่เกิน ${MSSG_PRODUCT_NOTES_MAX.toLocaleString('en-US')} ตัวอักษร`
} as const

export const mssgProductSchema = z.object({
  name: z.string().trim().min(3, MSSG_PRODUCT_TEXT.name).max(MSSG_PRODUCT_NAME_MAX, MSSG_PRODUCT_TEXT.name),
  photos: z.array(z.string().refine(mssgIsImageValue, MSSG_PRODUCT_TEXT.photoBad))
    .min(1, MSSG_PRODUCT_TEXT.photosMin)
    .max(MSSG_PRODUCT_PHOTOS_MAX, MSSG_PRODUCT_TEXT.photosMax),
  amount: z.string().refine(v => mssgParseAmount(v) !== null, MSSG_PRODUCT_TEXT.amount),
  discount: z.string().refine(v => v.trim() === '' || mssgParseAmount(v) !== null, MSSG_PRODUCT_TEXT.discount),
  description: z.string().max(MSSG_PRODUCT_DESC_MAX, MSSG_PRODUCT_TEXT.description),
  notes: z.string().max(MSSG_PRODUCT_NOTES_MAX, MSSG_PRODUCT_TEXT.notes),
  active: z.boolean()
})

export function mssgProductDefaults(): MssgProductForm {
  return { name: '', photos: [], amount: '', discount: '', description: '', notes: '', active: true }
}

function numText(n: number | null | undefined): string {
  return n === null || n === undefined ? '' : String(n)
}

export function mssgProductToForm(p: MssgStoreProduct): MssgProductForm {
  return {
    name: p.name ?? '',
    photos: [...(p.photos ?? [])],
    amount: numText(p.price?.amount),
    discount: numText(p.discount),
    description: p.description ?? '',
    notes: p.notes ?? '',
    active: p.active !== false
  }
}

/** a whole valid form → the `fields` of `product.create` (empty optional strings are left out) */
export function mssgProductFormToCreate(form: MssgProductForm, currency: string): MssgProductFields {
  const fields: MssgProductFields = {
    name: form.name.trim(),
    photos: [...form.photos],
    price: { amount: mssgParseAmount(form.amount) ?? 0, currency },
    active: form.active
  }
  const discount = mssgParseAmount(form.discount)
  if (discount !== null) fields.discount = discount
  if (form.description) fields.description = form.description
  if (form.notes) fields.notes = form.notes
  return fields
}

/** one edited form key → the op field(s) it changes (`amount` carries the store currency); `null` when invalid */
export function mssgProductKeyToFields(key: keyof MssgProductForm, form: MssgProductForm, currency: string): MssgProductFields | null {
  const r = mssgProductSchema.shape[key].safeParse(form[key])
  if (!r.success) return null
  switch (key) {
    case 'name': return { name: form.name.trim() }
    case 'photos': return { photos: [...form.photos] }
    case 'amount': return { price: { amount: mssgParseAmount(form.amount) ?? 0, currency } }
    case 'discount': return { discount: mssgParseAmount(form.discount) }
    case 'description': return { description: form.description }
    case 'notes': return { notes: form.notes }
    case 'active': return { active: form.active }
  }
}

/** the form key a server field path of a product points at (`price.amount` → `amount`, `photos.0` → `photos`), or `null` */
export function mssgProductFieldKey(field: string): keyof MssgProductForm | null {
  const head = field.split('.')[0]
  if (head === 'price') return 'amount'
  if (head === 'name' || head === 'photos' || head === 'discount' || head === 'description' || head === 'notes' || head === 'active') return head
  return null
}

// ── products = last store read + the draft's product ops ────────────────────────────────────────────────────────────
function applyFields(p: MssgStoreProduct, f: MssgProductFields): void {
  if (f.name !== undefined) p.name = f.name
  if (f.photos !== undefined) p.photos = [...f.photos]
  if (f.price !== undefined) p.price = { ...p.price, ...f.price }
  if (f.discount !== undefined) p.discount = f.discount
  if (f.description !== undefined) p.description = f.description
  if (f.notes !== undefined) p.notes = f.notes
  if (f.active !== undefined) p.active = f.active
}

export function mssgApplyProductOps(products: MssgStoreProduct[], ops: MssgOp[], currency = ''): MssgStoreProduct[] {
  const out = clone(products ?? [])
  for (const op of ops) {
    if (op.op === 'product.create') {
      const p: MssgStoreProduct = {
        id: op.tempId,
        name: '',
        photos: [],
        price: { amount: 0, currency },
        discount: null,
        description: '',
        notes: '',
        active: true
      }
      applyFields(p, op.fields)
      out.push(p)
    } else if (op.op === 'product.update') {
      const p = out.find(x => x.id === op.productId)
      if (p) applyFields(p, op.fields)
    } else if (op.op === 'product.delete') {
      const i = out.findIndex(x => x.id === op.productId)
      if (i >= 0) out.splice(i, 1)
    }
  }
  return out
}

export function mssgHasProductOps(ops: MssgOp[]): boolean {
  return ops.some(o => o.op.startsWith('product.'))
}

// ── op folding ──────────────────────────────────────────────────────────────────────────────────────────────────────
function mergeFields(a: MssgProductFields, b: MssgProductFields): MssgProductFields {
  const out: MssgProductFields = { ...a }
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue
    const key = k as keyof MssgProductFields
    ;(out as Record<string, unknown>)[key] = key === 'price' && v && typeof v === 'object' ? { ...(a.price ?? {}), ...(v as object) } : clone(v)
  }
  return out
}

/**
 * Add a product edit: a product created in this draft takes it into its `product.create`; otherwise it folds into the
 * latest `product.update` of that product, else a new one is appended.
 */
export function mssgFoldProductUpdate(ops: MssgOp[], productId: string, fields: MssgProductFields): MssgOp[] {
  const next = ops.slice()
  const ci = next.findIndex(o => o.op === 'product.create' && o.tempId === productId)
  if (ci >= 0) {
    const create = next[ci] as MssgOpProductCreate
    next[ci] = { ...create, fields: mergeFields(create.fields, fields) }
    return next
  }
  let ui = -1
  for (let i = next.length - 1; i >= 0; i--) {
    const o = next[i]!
    if (o.op === 'product.update' && o.productId === productId) {
      ui = i
      break
    }
  }
  if (ui >= 0) {
    const prev = next[ui] as MssgOpProductUpdate
    next[ui] = { ...prev, fields: mergeFields(prev.fields, fields) }
  } else {
    next.push({ op: 'product.update', productId, fields: clone(fields) })
  }
  return next
}

/** deleting a product created in this draft: drop every op of it (no delete is sent); `null` for a stored product */
export function mssgDropTempProduct(ops: MssgOp[], productId: string): MssgOp[] | null {
  if (!mssgIsTempId(productId)) return null
  if (!ops.some(o => o.op === 'product.create' && o.tempId === productId)) return null
  return ops.filter(o => !((o.op === 'product.create' && o.tempId === productId) || (o.op === 'product.update' && o.productId === productId)))
}

/** delete: drop a draft-only product, else replace its pending update by the delete (one op per stored product) */
export function mssgDeleteProductOps(ops: MssgOp[], productId: string): MssgOp[] {
  const dropped = mssgDropTempProduct(ops, productId)
  if (dropped) return dropped
  return [...ops.filter(o => !(o.op === 'product.update' && o.productId === productId)), { op: 'product.delete', productId }]
}

// ── settings (D5: read-only) ────────────────────────────────────────────────────────────────────────────────────────
export const MSSG_PRODUCT_MESSENGERS: { key: string, label: string }[] = [
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'viber', label: 'Viber' },
  { key: 'messenger', label: 'Messenger' }
]

export const MSSG_PAYMENT_METHODS: { key: string, label: string, th: string }[] = [
  { key: 'cod', label: 'Cash on Delivery', th: 'เก็บเงินปลายทาง' },
  { key: 'stripe', label: 'Stripe', th: 'บัตรเครดิต/เดบิต' },
  { key: 'liqpay', label: 'Liqpay', th: 'ผู้ให้บริการชำระเงิน' },
  { key: 'paypal', label: 'Paypal', th: 'ผู้ให้บริการชำระเงิน' },
  { key: 'wayforpay', label: 'Wayforpay', th: 'ผู้ให้บริการชำระเงิน' },
  { key: 'monobank', label: 'Plata by mono', th: 'ผู้ให้บริการชำระเงิน' }
]

export function mssgPaymentEnabled(settings: MssgStoreSettings | null | undefined, key: string): boolean {
  return settings?.payments?.[key]?.enabled === true
}

/** "เปิด n ช่องทาง" / "Off · ยังไม่เปิด" (design `pmSummary`) */
export function mssgPaymentSummary(settings: MssgStoreSettings | null | undefined): string {
  const n = MSSG_PAYMENT_METHODS.filter(m => mssgPaymentEnabled(settings, m.key)).length
  return n ? `เปิด ${n} ช่องทาง` : 'Off · ยังไม่เปิด'
}

/** a product option read from mssg as one chip of text (a plain string, or an object with a name / title / label) */
export function mssgOptionText(o: unknown): string {
  if (typeof o === 'string' || typeof o === 'number') return String(o)
  if (o && typeof o === 'object') {
    const r = o as Record<string, unknown>
    for (const k of ['name', 'title', 'label', 'value']) {
      if (typeof r[k] === 'string' && r[k]) return r[k] as string
    }
  }
  return ''
}

/** the store currency the product form uses (settings first, else the first product's) */
export function mssgStoreCurrency(store: MssgStore | null | undefined): string {
  return store?.settings?.currency || store?.products?.[0]?.price?.currency || ''
}

/** "100 THB" / "1,250.5 THB" */
export function mssgMoneyText(m: { amount: number, currency: string } | null | undefined): string {
  if (!m || typeof m.amount !== 'number') return '—'
  return `${m.amount.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${m.currency ?? ''}`.trim()
}

// ── customer data (D8) ──────────────────────────────────────────────────────────────────────────────────────────────
export const MSSG_REQUEST_TABS: { key: MssgRequestStatus, label: string }[] = [
  { key: 'new', label: 'New' },
  { key: 'inProgress', label: 'In progress' },
  { key: 'done', label: 'Done' },
  { key: 'canceled', label: 'Canceled' }
]

const EMAIL_RE = /^[^\s@*]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[\d\s().-]{7,20}$/

/**
 * The API stores masked contacts (`so***@gmail.com`, `08******12`, D8). A value that still looks like a whole e-mail
 * address or phone number (no `*`) is masked here too, so the editor never prints a visitor's contact in clear.
 */
export function mssgMaskContact(v: string | null | undefined): string {
  const s = (v ?? '').trim()
  if (!s) return ''
  if (s.includes('*')) return s
  if (EMAIL_RE.test(s)) {
    const [local, domain] = s.split('@') as [string, string]
    return `${local.slice(0, 2)}***@${domain}`
  }
  if (PHONE_RE.test(s)) {
    const digits = s.replace(/\D/g, '')
    if (digits.length < 7) return s
    return `${digits.slice(0, 2)}${'*'.repeat(digits.length - 4)}${digits.slice(-2)}`
  }
  return s
}

export function mssgRequestRows(store: MssgStore | null | undefined, tab: MssgRequestStatus) {
  return store?.requests?.rows?.[tab] ?? []
}

export function mssgRequestCount(store: MssgStore | null | undefined, tab: MssgRequestStatus): number {
  return store?.requests?.counts?.[tab] ?? mssgRequestRows(store, tab).length
}

/** the customer-data lists show ≤ 100 rows per list (D8); the total is what mssg holds */
export const MSSG_CUSTOMER_ROWS_MAX = 100
