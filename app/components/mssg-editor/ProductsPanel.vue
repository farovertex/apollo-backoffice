<script setup lang="ts">
/**
 * FEAT-101 M4 — products list of step 5 (AC-31, AC-32; contract §3.2 `product.create|update|delete`; design "สินค้า (Products)
 * · n", "+ เพิ่มสินค้า", rows with price / discount / delete, "สินค้าใหม่" form).
 *
 * `products` = the last store read with the draft's product ops laid over it (the parent computes it). Add → form →
 * `product.create`; edit (inline form, live) → one folded `product.update`; delete (confirm) → `product.delete`, a product
 * created in this draft just drops its ops. Everything goes out as ops (→ `useMssgDraft`: autosave, rev); nothing here calls
 * the API except the photo uploads. Server messages (draft 400 / apply `mssgValidation`, v1.4 `products.<id>.<key>`) arrive
 * as `errors` with their `target.productId`.
 *
 * Test ids: `me-products` (`data-count`, `data-total`), `me-products-empty`, `me-product-add` (`data-reason`),
 * `me-product-<id>` (`data-active`, `data-draft` new|edited|"", `data-errors`), `me-product-edit-<id>`,
 * `me-product-delete-<id>`, `me-product-draft-<id>`, `me-confirm-product-delete(-ok|-cancel|-item)`; the form: `ProductForm.vue`.
 */
import type { MssgOp, MssgProductFields, MssgStoreProduct } from '#shared/types/mssg-sites'
import type { MssgFieldError } from '~/utils/mssg-sites'
import type { MssgProductForm } from '~/utils/mssg-store'

const props = defineProps<{
  siteId: string
  products: MssgStoreProduct[]
  /** products mssg holds in total (the list shows ≤ 200) */
  total: number
  /** how many of them the last store read stored (the draft's creates / deletes move `products.length` away from it) */
  stored: number
  collections: number
  currency: string
  ops: MssgOp[]
  readOnly: boolean
  /** why a product cannot be added now (store never read, …), else `null` */
  addBlockedReason: string | null
  /** step-5 field errors that belong to a product */
  errors: MssgFieldError[]
  resetToken: number
}>()

const emit = defineEmits<{
  ops: [next: MssgOp[], clear?: (e: MssgFieldError) => boolean]
}>()

const editingId = ref<string | null>(null)
const adding = ref(false)
const newSeq = ref(0)

function errorsOf(id: string) {
  return props.errors.filter(e => e.target.productId === id)
}
function fieldErrors(id: string): Partial<Record<keyof MssgProductForm, string>> {
  const out: Partial<Record<keyof MssgProductForm, string>> = {}
  for (const e of errorsOf(id)) {
    const k = mssgProductFieldKey(e.target.field)
    if (k && !out[k]) out[k] = e.message
  }
  return out
}

function draftState(id: string): 'new' | 'edited' | '' {
  if (props.ops.some(o => o.op === 'product.create' && o.tempId === id)) return 'new'
  return props.ops.some(o => o.op === 'product.update' && o.productId === id) ? 'edited' : ''
}

function toggleEdit(id: string) {
  editingId.value = editingId.value === id ? null : id
  adding.value = false
}
watch(() => props.products.map(p => p.id).join(','), () => {
  if (editingId.value && !props.products.some(p => p.id === editingId.value)) editingId.value = null
})

// new errors on a product (draft 400 / apply): open its form (fewer errors never moves the view)
const errKey = (e: MssgFieldError) => `${e.target.productId}|${e.path}`
watch(() => props.errors.map(errKey), (keys, prev) => {
  const seen = new Set(prev ?? [])
  const first = props.errors.find(e => !seen.has(errKey(e)) && e.target.productId && props.products.some(p => p.id === e.target.productId))
  if (first) {
    adding.value = false
    editingId.value = first.target.productId!
  }
})

function openAdd() {
  if (props.readOnly || props.addBlockedReason) return
  editingId.value = null
  newSeq.value++
  adding.value = true
}

function create(form: MssgProductForm) {
  const tempId = mssgTempId()
  emit('ops', [...props.ops, { op: 'product.create', tempId, fields: mssgProductFormToCreate(form, props.currency) }])
  adding.value = false
}

function change(id: string, fields: MssgProductFields) {
  const touched = Object.keys(fields).map(k => (k === 'price' ? 'price' : k))
  emit('ops', mssgFoldProductUpdate(props.ops, id, fields), e => e.target.productId === id && touched.some(t => mssgProductFieldKey(e.target.field) === mssgProductFieldKey(t)))
}

const deleteId = ref<string | null>(null)
const deleteOpen = computed({
  get: () => deleteId.value !== null,
  set: (v) => {
    if (!v) deleteId.value = null
  }
})
const deleteLabel = computed(() => props.products.find(p => p.id === deleteId.value)?.name ?? '')
function remove() {
  const id = deleteId.value
  deleteId.value = null
  if (!id) return
  emit('ops', mssgDeleteProductOps(props.ops, id), e => e.target.productId === id)
  if (editingId.value === id) editingId.value = null
}

/** the count the header shows follows the draft (a product added / deleted in the draft counts at once) */
const shownTotal = computed(() => props.total + props.products.length - props.stored)
const rows = computed(() => props.products.map(p => ({ p, errs: errorsOf(p.id).length, state: draftState(p.id) })))
</script>

<template>
  <section
    class="flex min-w-0 flex-col gap-3 rounded-lg border border-default bg-elevated/40 p-3.5"
    aria-label="สินค้า"
    data-testid="me-products"
    :data-count="products.length"
    :data-total="shownTotal"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span class="text-sm font-semibold text-highlighted">สินค้า (Products) · {{ shownTotal }}</span>
        <span class="text-xs text-muted" data-testid="me-collections-count">Collections · {{ collections }}</span>
      </span>
      <UButton
        label="+ เพิ่มสินค้า (Add product)"
        color="primary"
        variant="soft"
        size="sm"
        :disabled="readOnly || !!addBlockedReason"
        :title="addBlockedReason ?? undefined"
        :data-reason="addBlockedReason ?? ''"
        data-testid="me-product-add"
        @click="openAdd"
      />
    </div>
    <p v-if="total > stored" class="text-xs text-muted" data-testid="me-products-more">
      แสดง {{ stored }} จาก {{ total }} รายการ · ดูทั้งหมดที่ mssg
    </p>

    <p v-if="!products.length && !adding" class="rounded-md border border-dashed border-default px-3 py-4 text-center text-sm text-muted" data-testid="me-products-empty">
      ยังไม่มีสินค้า · กด "เพิ่มสินค้า" เพื่อเพิ่มสินค้าหรือบริการชิ้นแรก
    </p>

    <ul v-if="rows.length" class="flex min-w-0 flex-col gap-2">
      <li
        v-for="r in rows"
        :key="r.p.id"
        class="flex min-w-0 flex-col gap-2"
        :data-testid="`me-product-${r.p.id}`"
        :data-active="r.p.active ? 'true' : 'false'"
        :data-draft="r.state"
        :data-errors="r.errs"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-default bg-default px-3 py-2">
          <MssgEditorImage
            :site-id="siteId"
            :value="r.p.photos[0] ?? null"
            :alt="r.p.name"
            class="size-10 shrink-0 rounded-md border border-default"
          />
          <span class="flex min-w-0 flex-[1_1_160px] flex-col gap-0.5">
            <span class="text-sm font-medium break-words text-highlighted">{{ r.p.name || '—' }}</span>
            <span class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span>{{ r.p.active ? 'Active' : 'Inactive' }}</span>
              <UBadge
                v-if="r.state"
                :label="r.state === 'new' ? 'ใหม่ในร่าง' : 'แก้ในร่าง'"
                color="warning"
                variant="subtle"
                size="sm"
                :data-testid="`me-product-draft-${r.p.id}`"
              />
              <UBadge
                v-if="r.errs"
                :label="`${r.errs} ข้อผิดพลาด`"
                color="error"
                size="sm"
              />
            </span>
          </span>
          <span class="flex flex-wrap items-center gap-x-2 text-sm tabular-nums text-default">
            {{ mssgMoneyText(r.p.price) }}
            <span v-if="r.p.discount" class="text-xs text-success">ลด {{ r.p.discount }}</span>
          </span>
          <span class="flex items-center gap-1">
            <UButton
              icon="i-lucide-pencil"
              color="neutral"
              variant="outline"
              size="sm"
              :aria-label="`แก้สินค้า ${r.p.name}`"
              :aria-pressed="editingId === r.p.id"
              :disabled="readOnly"
              :data-testid="`me-product-edit-${r.p.id}`"
              @click="toggleEdit(r.p.id)"
            />
            <UButton
              icon="i-lucide-trash-2"
              color="error"
              variant="outline"
              size="sm"
              :aria-label="`ลบสินค้า ${r.p.name}`"
              :disabled="readOnly"
              :data-testid="`me-product-delete-${r.p.id}`"
              @click="deleteId = r.p.id"
            />
          </span>
        </div>
        <MssgEditorProductForm
          v-if="editingId === r.p.id"
          mode="edit"
          :site-id="siteId"
          :form-key="r.p.id"
          :initial="mssgProductToForm(r.p)"
          :currency="currency"
          :read-only="readOnly"
          :errors="fieldErrors(r.p.id)"
          :reset-token="resetToken"
          @change="change(r.p.id, $event)"
          @cancel="editingId = null"
        />
      </li>
    </ul>

    <MssgEditorProductForm
      v-if="adding"
      mode="new"
      :site-id="siteId"
      :form-key="`new-${newSeq}`"
      :initial="mssgProductDefaults()"
      :currency="currency"
      :read-only="readOnly"
      @submit="create"
      @cancel="adding = false"
    />

    <MssgEditorConfirmModal
      v-model:open="deleteOpen"
      title="ลบสินค้านี้?"
      description="สินค้าจะถูกลบออกจาก mssg เมื่อกด &quot;บันทึก&quot; ของเว็บ (ยังเปลี่ยนใจได้จนกว่าจะบันทึก)"
      :items="deleteLabel ? [deleteLabel] : []"
      confirm-label="ลบสินค้า"
      color="error"
      testid="me-confirm-product-delete"
      @confirm="remove"
    />
  </section>
</template>
