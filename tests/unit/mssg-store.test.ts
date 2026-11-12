/**
 * FEAT-101 M4 (spec D5, D8, AC-30..32; api-contract.md v1.5 §3.2 `product.*`, §3.3 products, §4.4 store) — the pure helpers of
 * step 5 (`app/utils/mssg-store.ts`): product rules, form ↔ op fields, "last store read + product ops", op folding, deletes,
 * read-only settings text, the defensive contact mask, request tabs, and the product error / destructive labels.
 */
import { describe, expect, it } from 'vitest'
import {
  mssgApplyProductOps,
  mssgDeleteProductOps,
  mssgDropTempProduct,
  mssgFoldProductUpdate,
  mssgMaskContact,
  mssgMoneyText,
  mssgOptionText,
  mssgParseAmount,
  mssgPaymentEnabled,
  mssgPaymentSummary,
  mssgProductDefaults,
  mssgProductFieldKey,
  mssgProductFormToCreate,
  mssgProductKeyToFields,
  mssgProductSchema,
  mssgProductToForm,
  mssgRequestCount,
  mssgRequestRows,
  mssgStoreCurrency
} from '../../app/utils/mssg-store'
import { mssgOpTarget } from '../../app/utils/mssg-blocks'
import { mssgConflictLabel, mssgDestructiveOps, mssgFieldLabel, mssgIssuesToFieldErrors, mssgApplyErrorsToFieldErrors, mssgStepOf } from '../../app/utils/mssg-sites'
import type { MssgOp, MssgStore, MssgStoreProduct } from '../../shared/types/mssg-sites'

const PH = 'upload:0123456789abcdef01234567'
const P1: MssgStoreProduct = { id: 'pr1', name: 'ดอกกุหลาบ', photos: ['https://media.example/a.png'], price: { amount: 100, currency: 'THB' }, discount: null, description: '', notes: '', active: true }
const P2: MssgStoreProduct = { id: 'pr2', name: 'ช่อทานตะวัน', photos: [PH], price: { amount: 250.5, currency: 'THB' }, discount: 10, description: 'สด', notes: 'n', active: false }

const store = (over: Partial<MssgStore> = {}): MssgStore => ({
  readAt: '2026-11-12T09:00:00.000Z',
  settings: { currency: 'THB', shopcart: { enabled: true, successMessage: 'ok', successUrl: '' }, productOptions: ['Size', { name: 'Color' }], messengers: { whatsapp: true }, payments: { cod: { enabled: true }, stripe: { enabled: false } } },
  products: [P1, P2],
  productsTotal: 2,
  collectionsCount: 0,
  audience: { total: 0, rows: [] },
  requests: { counts: { new: 1, inProgress: 0, done: 0, canceled: 0 }, rows: { new: [{ id: 'r1', createdAt: '2026-11-12T09:00:00.000Z', title: 'x', email: 'so***@gmail.com', phone: '08******12', total: { amount: 100, currency: 'THB' } }], inProgress: [], done: [], canceled: [] } },
  ...over
})

const validForm = () => ({ ...mssgProductDefaults(), name: 'สินค้าใหม่', photos: [PH], amount: '99.5' })

describe('product rules (contract §3.3: name 3–100, photos 1–10, price ≥ 0, discount ≥ 0 | null, description ≤ 5000, notes ≤ 1000)', () => {
  it('accepts a minimal product', () => {
    expect(mssgProductSchema.safeParse(validForm()).success).toBe(true)
  })

  it.each([
    ['name too short', { name: 'ab' }, 'name'],
    ['name too long', { name: 'x'.repeat(101) }, 'name'],
    ['no photo', { photos: [] }, 'photos'],
    ['11 photos', { photos: Array.from({ length: 11 }, () => PH) }, 'photos'],
    ['photo not an upload / url', { photos: ['not a url'] }, 'photos'],
    ['price empty', { amount: '' }, 'amount'],
    ['price negative', { amount: '-1' }, 'amount'],
    ['price text', { amount: 'abc' }, 'amount'],
    ['discount text', { discount: 'ten' }, 'discount'],
    ['description 5001', { description: 'x'.repeat(5001) }, 'description'],
    ['notes 1001', { notes: 'x'.repeat(1001) }, 'notes']
  ])('rejects %s', (_label, patch, key) => {
    const r = mssgProductSchema.safeParse({ ...validForm(), ...patch })
    expect(r.success).toBe(false)
    expect(r.error!.issues.some(i => i.path[0] === key)).toBe(true)
  })

  it('discount may be empty (none) or 0', () => {
    expect(mssgProductSchema.safeParse({ ...validForm(), discount: '' }).success).toBe(true)
    expect(mssgProductSchema.safeParse({ ...validForm(), discount: '0' }).success).toBe(true)
  })

  it('parses amounts', () => {
    expect(mssgParseAmount('0')).toBe(0)
    expect(mssgParseAmount(' 12.5 ')).toBe(12.5)
    expect(mssgParseAmount('1e3')).toBeNull()
    expect(mssgParseAmount('')).toBeNull()
    expect(mssgParseAmount(null)).toBeNull()
  })
})

describe('form ↔ op fields', () => {
  it('product.create fields carry the store currency and leave empty optionals out', () => {
    expect(mssgProductFormToCreate(validForm(), 'THB')).toEqual({ name: 'สินค้าใหม่', photos: [PH], price: { amount: 99.5, currency: 'THB' }, active: true })
    expect(mssgProductFormToCreate({ ...validForm(), discount: '5', description: 'd', notes: 'n', active: false }, 'USD')).toEqual({
      name: 'สินค้าใหม่', photos: [PH], price: { amount: 99.5, currency: 'USD' }, active: false, discount: 5, description: 'd', notes: 'n'
    })
  })

  it('one edited key → its op field; an invalid value → null (never sent)', () => {
    const f = { ...validForm(), amount: '12' }
    expect(mssgProductKeyToFields('amount', f, 'THB')).toEqual({ price: { amount: 12, currency: 'THB' } })
    expect(mssgProductKeyToFields('name', { ...f, name: ' ab ' }, 'THB')).toBeNull()
    expect(mssgProductKeyToFields('name', { ...f, name: ' abc ' }, 'THB')).toEqual({ name: 'abc' })
    expect(mssgProductKeyToFields('discount', { ...f, discount: '' }, 'THB')).toEqual({ discount: null })
    expect(mssgProductKeyToFields('discount', { ...f, discount: 'x' }, 'THB')).toBeNull()
    expect(mssgProductKeyToFields('photos', { ...f, photos: [] }, 'THB')).toBeNull()
    expect(mssgProductKeyToFields('active', { ...f, active: false }, 'THB')).toEqual({ active: false })
  })

  it('a stored product → form', () => {
    expect(mssgProductToForm(P2)).toEqual({ name: 'ช่อทานตะวัน', photos: [PH], amount: '250.5', discount: '10', description: 'สด', notes: 'n', active: false })
    expect(mssgProductToForm(P1).discount).toBe('')
  })

  it('a server field path → the form key', () => {
    expect(mssgProductFieldKey('price.amount')).toBe('amount')
    expect(mssgProductFieldKey('price')).toBe('amount')
    expect(mssgProductFieldKey('photos.0')).toBe('photos')
    expect(mssgProductFieldKey('name')).toBe('name')
    expect(mssgProductFieldKey('nope')).toBeNull()
  })
})

describe('products = last store read + product ops', () => {
  it('create / update / delete lay over the stored list and never touch it', () => {
    const base = [P1, P2]
    const ops: MssgOp[] = [
      { op: 'product.create', tempId: 'tmp-aaaa1111', fields: { name: 'ใหม่', photos: [PH], price: { amount: 5, currency: 'THB' } } },
      { op: 'product.update', productId: 'pr1', fields: { name: 'ดอกกุหลาบแดง', price: { amount: 120, currency: 'THB' }, discount: 5 } },
      { op: 'product.delete', productId: 'pr2' }
    ]
    const out = mssgApplyProductOps(base, ops, 'THB')
    expect(out.map(p => p.id)).toEqual(['pr1', 'tmp-aaaa1111'])
    expect(out[0]).toMatchObject({ name: 'ดอกกุหลาบแดง', price: { amount: 120, currency: 'THB' }, discount: 5, active: true })
    expect(out[1]).toMatchObject({ name: 'ใหม่', active: true, discount: null, price: { amount: 5, currency: 'THB' } })
    expect(base[0]!.name).toBe('ดอกกุหลาบ')
    expect(base).toHaveLength(2)
  })

  it('an update of a missing product is ignored; site ops are ignored', () => {
    const out = mssgApplyProductOps([P1], [{ op: 'product.update', productId: 'zz', fields: { name: 'x' } }, { op: 'site.update', fields: { name: 'abc' } }])
    expect(out).toEqual([P1])
  })
})

describe('op folding', () => {
  it('edits of a stored product fold into one product.update (price merges, other keys replace)', () => {
    let ops: MssgOp[] = []
    ops = mssgFoldProductUpdate(ops, 'pr1', { name: 'abc' })
    ops = mssgFoldProductUpdate(ops, 'pr1', { price: { amount: 7, currency: 'THB' } })
    ops = mssgFoldProductUpdate(ops, 'pr1', { name: 'abcd' })
    ops = mssgFoldProductUpdate(ops, 'pr2', { active: true })
    expect(ops).toEqual([
      { op: 'product.update', productId: 'pr1', fields: { name: 'abcd', price: { amount: 7, currency: 'THB' } } },
      { op: 'product.update', productId: 'pr2', fields: { active: true } }
    ])
  })

  it('an edit of a product created in the draft goes into its create', () => {
    const ops = mssgFoldProductUpdate(
      [{ op: 'product.create', tempId: 'tmp-aaaa1111', fields: { name: 'abc', photos: [PH], price: { amount: 1, currency: 'THB' } } }],
      'tmp-aaaa1111',
      { price: { amount: 9, currency: 'THB' }, discount: 2 }
    )
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ op: 'product.create', fields: { price: { amount: 9, currency: 'THB' }, discount: 2, name: 'abc' } })
  })

  it('deleting a product created in the draft drops its ops (nothing sent)', () => {
    const ops: MssgOp[] = [
      { op: 'product.create', tempId: 'tmp-aaaa1111', fields: { name: 'abc' } },
      { op: 'site.update', fields: { name: 'abcd' } },
      { op: 'product.update', productId: 'tmp-aaaa1111', fields: { active: false } }
    ]
    expect(mssgDropTempProduct(ops, 'tmp-aaaa1111')).toEqual([{ op: 'site.update', fields: { name: 'abcd' } }])
    expect(mssgDeleteProductOps(ops, 'tmp-aaaa1111')).toEqual([{ op: 'site.update', fields: { name: 'abcd' } }])
    expect(mssgDropTempProduct(ops, 'pr1')).toBeNull()
  })

  it('deleting a stored product replaces its pending update by one product.delete', () => {
    const ops: MssgOp[] = [{ op: 'product.update', productId: 'pr1', fields: { name: 'abc' } }, { op: 'product.update', productId: 'pr2', fields: { active: true } }]
    expect(mssgDeleteProductOps(ops, 'pr1')).toEqual([{ op: 'product.update', productId: 'pr2', fields: { active: true } }, { op: 'product.delete', productId: 'pr1' }])
  })
})

describe('settings (read-only, D5)', () => {
  it('payment methods are enabled yes / no only', () => {
    const s = store().settings
    expect(mssgPaymentEnabled(s, 'cod')).toBe(true)
    expect(mssgPaymentEnabled(s, 'stripe')).toBe(false)
    expect(mssgPaymentEnabled(s, 'paypal')).toBe(false)
    expect(mssgPaymentSummary(s)).toBe('เปิด 1 ช่องทาง')
    expect(mssgPaymentSummary({})).toBe('Off · ยังไม่เปิด')
    expect(mssgPaymentSummary(null)).toBe('Off · ยังไม่เปิด')
  })

  it('option chips from strings or objects; currency from settings, else from a product', () => {
    expect(['Size', { name: 'Color' }, { x: 1 }, 3].map(mssgOptionText)).toEqual(['Size', 'Color', '', '3'])
    expect(mssgStoreCurrency(store())).toBe('THB')
    expect(mssgStoreCurrency(store({ settings: null }))).toBe('THB')
    expect(mssgStoreCurrency(store({ settings: null, products: [] }))).toBe('')
    expect(mssgStoreCurrency(null)).toBe('')
  })

  it('money text', () => {
    expect(mssgMoneyText({ amount: 1250.5, currency: 'THB' })).toBe('1,250.5 THB')
    expect(mssgMoneyText(null)).toBe('—')
  })
})

describe('customer data (D8)', () => {
  it('keeps masked values and masks anything that still looks like a whole contact', () => {
    expect(mssgMaskContact('so***@gmail.com')).toBe('so***@gmail.com')
    expect(mssgMaskContact('08******12')).toBe('08******12')
    expect(mssgMaskContact('somchai@gmail.com')).toBe('so***@gmail.com')
    expect(mssgMaskContact('0812345678')).toBe('08******78')
    expect(mssgMaskContact('+66 81 234 5678')).toBe('66*******78')
    expect(mssgMaskContact('สั่งดอกไม้ 2 ช่อ')).toBe('สั่งดอกไม้ 2 ช่อ')
    expect(mssgMaskContact('')).toBe('')
    expect(mssgMaskContact(null)).toBe('')
  })

  it('request tabs: counts from the totals, rows per status, empty states', () => {
    const s = store()
    expect(mssgRequestCount(s, 'new')).toBe(1)
    expect(mssgRequestCount(s, 'done')).toBe(0)
    expect(mssgRequestRows(s, 'new')).toHaveLength(1)
    expect(mssgRequestRows(s, 'canceled')).toEqual([])
    expect(mssgRequestRows(null, 'new')).toEqual([])
    expect(mssgRequestCount(null, 'new')).toBe(0)
  })
})

describe('product errors, conflicts and the destructive list (contract v1.4 `products.<id>.<key>`)', () => {
  it('v1.4 apply path → product target; draft 400 of a product op → the op\'s product', () => {
    expect(mssgOpTarget(undefined, 'products.pr1.price.amount')).toEqual({ pageId: null, blockId: null, field: 'price.amount', productId: 'pr1' })
    expect(mssgOpTarget(undefined, 'products.pr1')).toEqual({ pageId: null, blockId: null, field: '', productId: 'pr1' })
    const create: MssgOp = { op: 'product.create', tempId: 'tmp-aaaa1111', fields: {} }
    expect(mssgOpTarget(create, 'fields.price.amount')).toEqual({ pageId: null, blockId: null, field: 'price.amount', productId: 'tmp-aaaa1111' })
    const upd: MssgOp = { op: 'product.update', productId: 'pr1', fields: {} }
    expect(mssgOpTarget(upd, 'fields.name')).toMatchObject({ field: 'name', productId: 'pr1' })
  })

  it('field errors of product ops belong to step 5 with the product target', () => {
    const ops: MssgOp[] = [{ op: 'site.update', fields: { name: 'abc' } }, { op: 'product.update', productId: 'pr1', fields: { name: 'x' } }]
    const draft = mssgIssuesToFieldErrors([{ path: 'ops.1.fields.name', message: 'bad' }], ops)
    expect(draft[0]).toMatchObject({ step: 5, path: 'name', opIndex: 1, target: { productId: 'pr1', field: 'name' } })
    const apply = mssgApplyErrorsToFieldErrors([{ opIndex: 1, path: 'products.pr1.name', message: 'bad' }], ops)
    expect(apply[0]).toMatchObject({ step: 5, target: { productId: 'pr1', field: 'name' } })
    expect(mssgStepOf(ops[1], 'products.pr1.name')).toBe(5)
  })

  it('labels name the product when it is known', () => {
    expect(mssgFieldLabel('products.pr1.price.amount')).toBe('สินค้า · ราคา')
    const item = { opIndex: 0, path: 'products.pr1.name', kind: 'changed' as const, live: 'a', mine: 'b' }
    const ops: MssgOp[] = [{ op: 'product.update', productId: 'pr1', fields: { name: 'b' } }]
    expect(mssgConflictLabel(item, ops, [], [P1])).toBe('สินค้า "ดอกกุหลาบ" · ชื่อสินค้า')
    expect(mssgConflictLabel({ ...item, kind: 'gone', path: 'products.pr1' }, ops, [], [P1])).toBe('สินค้า "ดอกกุหลาบ"')
    expect(mssgConflictLabel(item, ops, [], [])).toBe('สินค้า · ชื่อสินค้า')
  })

  it('product.delete is destructive and lists the product by name', () => {
    const d = mssgDestructiveOps([{ op: 'product.delete', productId: 'pr2' }], { enabled: true, pages: [] }, [P1, P2])
    expect(d).toEqual([{ index: 0, type: 'product.delete', label: 'ลบสินค้า "ช่อทานตะวัน"' }])
    expect(mssgDestructiveOps([{ op: 'product.delete', productId: 'zz' }], null)[0]!.label).toBe('ลบสินค้า "zz"')
    expect(mssgDestructiveOps([{ op: 'product.update', productId: 'pr1', fields: { name: 'abc' } }], null)).toEqual([])
  })
})
