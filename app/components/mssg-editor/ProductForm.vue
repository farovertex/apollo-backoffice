<script setup lang="ts">
/**
 * FEAT-101 M4 — the product form of step 5 (AC-31, AC-32; contract §3.2 `product.*`, §3.3 "Products"; design "สินค้าใหม่ (New
 * Product)": photos, title n/100, price, currency, discount, description, notes, Active).
 *
 * `mode="new"`: the values stay here until "เพิ่มสินค้า" — a fully valid form is emitted once (`submit` → `product.create`).
 * `mode="edit"`: every key that passes its rule is emitted on its own (`change` → one `product.update` field, folded by
 * the parent); an invalid value stays in the field with its message and is **never sent**, and it survives edits of the
 * other fields (the form re-reads the draft only when it opens or when the draft is replaced from the server).
 * Currency = the store currency (contract §3.3) and is shown read-only. Photos use the upload control
 * (`POST /mssg-sites/:id/uploads`, `upload:<id>`), 1–10.
 *
 * Test ids: `me-product-form` (`data-mode`, `data-product-id`), `me-product-field-<name|amount|discount|description|notes>`
 * + `me-product-field-error-<…>` (+ `me-product-field-counter-name`), `me-product-currency`, `me-product-active`,
 * `me-upload-product.photos.<i>` / `me-upload-product.photos.add`, `me-product-photos-error`, `me-product-ok`,
 * `me-product-cancel`, `me-product-form-close`.
 */
import type { Form } from '@nuxt/ui'
import type { MssgProductFields } from '#shared/types/mssg-sites'
import type { MssgProductForm } from '~/utils/mssg-store'

const props = withDefaults(defineProps<{
  siteId: string
  mode: 'new' | 'edit'
  /** the product's id (edit) or a counter (new) — the form re-reads `initial` when it changes */
  formKey: string
  initial: MssgProductForm
  currency: string
  readOnly: boolean
  /** server messages per form key (`name`, `amount`, `photos` …) */
  errors?: Partial<Record<keyof MssgProductForm, string>>
  /** bumped when the draft was replaced from the server (edit mode re-reads) */
  resetToken?: number
}>(), { errors: () => ({}), resetToken: 0 })

const emit = defineEmits<{
  change: [fields: MssgProductFields]
  submit: [form: MssgProductForm]
  cancel: []
}>()

const state = reactive<MssgProductForm>(mssgProductDefaults())
const form = useTemplateRef<Form<MssgProductForm>>('form')
/** new mode: show the photo rule only after the first try / photo change */
const touchedPhotos = ref(false)
const addSlot = ref<string | null>(null)

function fromInitial() {
  Object.assign(state, { ...props.initial, photos: [...props.initial.photos] })
  touchedPhotos.value = false
  form.value?.clear()
}
// the form's own opening (key) and a draft replaced from the server (edit only) — never an unrelated edit of the draft
watch([() => props.formKey, () => (props.mode === 'edit' ? props.resetToken : 0)], fromInitial, { immediate: true })

function key<K extends keyof MssgProductForm>(k: K, v: MssgProductForm[K]) {
  state[k] = v
  if (props.mode !== 'edit') return
  const fields = mssgProductKeyToFields(k, state, props.currency)
  if (fields) emit('change', fields)
}

const photosError = computed<string | null>(() => {
  if (props.errors.photos) return props.errors.photos
  if (props.mode === 'new' && !touchedPhotos.value) return null
  const r = mssgProductSchema.shape.photos.safeParse(state.photos)
  return r.success ? null : (r.error.issues[0]?.message ?? null)
})

function onPhoto(i: number, v: string | null) {
  touchedPhotos.value = true
  const next = [...state.photos]
  if (v) next[i] = v
  else next.splice(i, 1)
  key('photos', next)
}
function onAddPhoto(v: string | null) {
  if (!v) return
  touchedPhotos.value = true
  key('photos', [...state.photos, v])
  addSlot.value = null
}

function onSubmit() {
  touchedPhotos.value = true
  if (props.readOnly) return
  if (!mssgProductSchema.safeParse(state).success) return
  emit('submit', { ...state, photos: [...state.photos] })
}
</script>

<template>
  <UForm
    ref="form"
    :schema="mssgProductSchema"
    :state="state"
    :validate-on="['input']"
    :disabled="readOnly"
    class="flex min-w-0 flex-col gap-3.5 rounded-lg border border-default bg-elevated/60 p-3.5"
    data-testid="me-product-form"
    :data-mode="mode"
    :data-product-id="mode === 'edit' ? formKey : ''"
    @submit="onSubmit"
    @error="touchedPhotos = true"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm font-medium text-highlighted">{{ mode === 'new' ? 'สินค้าใหม่ (New Product)' : 'แก้สินค้า' }}</span>
      <span class="inline-flex items-center gap-2 text-sm text-default">
        Active
        <USwitch
          :model-value="state.active"
          :disabled="readOnly"
          aria-label="Active"
          data-testid="me-product-active"
          @update:model-value="key('active', !!$event)"
        />
      </span>
    </div>

    <div class="flex min-w-0 flex-col gap-2">
      <span class="text-sm font-medium text-default">รูปสินค้า (Photos) <span class="text-error">*</span> <span class="text-xs font-normal text-muted">· {{ state.photos.length }}/{{ MSSG_PRODUCT_PHOTOS_MAX }}</span></span>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MssgEditorUploadField
          v-for="(ph, i) in state.photos"
          :key="`${i}-${ph}`"
          :model-value="ph"
          :site-id="siteId"
          :field="`product.photos.${i}`"
          :label="`รูปที่ ${i + 1}`"
          :disabled="readOnly"
          @update:model-value="onPhoto(i, $event)"
        />
        <MssgEditorUploadField
          v-if="state.photos.length < MSSG_PRODUCT_PHOTOS_MAX"
          :model-value="addSlot"
          :site-id="siteId"
          field="product.photos.add"
          label="+ รูปสินค้า"
          :disabled="readOnly"
          @update:model-value="onAddPhoto"
        />
      </div>
      <span v-if="photosError" class="text-xs break-words text-error" data-testid="me-product-photos-error">{{ photosError }}</span>
    </div>

    <MssgEditorFormText
      :model-value="state.name"
      name="name"
      label="ชื่อสินค้า (Title)"
      testid="me-product-field"
      placeholder="Enter product name"
      required
      counter
      :limit="MSSG_PRODUCT_NAME_MAX"
      :error="errors.name || null"
      @update:model-value="key('name', String($event ?? ''))"
    />

    <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
      <MssgEditorFormText
        :model-value="state.amount"
        name="amount"
        label="ราคา (Price)"
        testid="me-product-field"
        inputmode="decimal"
        placeholder="0"
        required
        :error="errors.amount || null"
        @update:model-value="key('amount', String($event ?? ''))"
      />
      <UFormField
        label="สกุลเงิน"
        name="currency"
        description="ใช้สกุลเงินของร้าน · เปลี่ยนที่ mssg"
        :ui="{ label: 'break-words', description: 'break-words' }"
      >
        <UInput
          :model-value="currency || '—'"
          disabled
          class="w-full"
          data-testid="me-product-currency"
        />
      </UFormField>
      <MssgEditorFormText
        :model-value="state.discount"
        name="discount"
        label="ส่วนลด (Discount)"
        testid="me-product-field"
        inputmode="decimal"
        placeholder="เช่น 10"
        description="ตัวเลข 0 ขึ้นไป · เว้นว่างถ้าไม่มี"
        :error="errors.discount || null"
        @update:model-value="key('discount', String($event ?? ''))"
      />
    </div>

    <MssgEditorFormText
      :model-value="state.description"
      name="description"
      label="รายละเอียด (Description)"
      testid="me-product-field"
      textarea
      :rows="3"
      placeholder="Enter product description"
      counter
      :limit="MSSG_PRODUCT_DESC_MAX"
      :error="errors.description || null"
      @update:model-value="key('description', String($event ?? ''))"
    />
    <MssgEditorFormText
      :model-value="state.notes"
      name="notes"
      label="หมายเหตุภายใน (Notes)"
      testid="me-product-field"
      textarea
      :rows="2"
      counter
      :limit="MSSG_PRODUCT_NOTES_MAX"
      :error="errors.notes || null"
      @update:model-value="key('notes', String($event ?? ''))"
    />
    <span v-if="errors.active" class="text-xs text-error" data-testid="me-product-field-error-active">{{ errors.active }}</span>

    <div v-if="mode === 'new'" class="flex flex-wrap items-center justify-end gap-2">
      <span class="min-w-0 flex-1 basis-56 text-xs text-muted">สินค้าจะถูกส่งไปที่ mssg เมื่อกด "บันทึก" ของเว็บ</span>
      <UButton
        label="ยกเลิก"
        color="neutral"
        variant="outline"
        data-testid="me-product-cancel"
        @click="emit('cancel')"
      />
      <UButton
        label="เพิ่มสินค้า"
        type="submit"
        :disabled="readOnly"
        data-testid="me-product-ok"
      />
    </div>
    <div v-else class="flex justify-end">
      <UButton
        label="ปิด"
        color="neutral"
        variant="outline"
        size="sm"
        data-testid="me-product-form-close"
        @click="emit('cancel')"
      />
    </div>
  </UForm>
</template>
