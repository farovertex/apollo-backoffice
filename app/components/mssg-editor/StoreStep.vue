<script setup lang="ts">
/**
 * FEAT-101 M4 — editor step 5 "ร้านค้า · Audience · Requests" (AC-30..32; contract §4.4 store, §3.2 `product.*`; D5, D8).
 *
 * `store` is what the last `mssgStoreRead` job saved (`null` = never read → the step invites the read). "ดึงข้อมูลร้านค้าใหม่"
 * asks the parent to `POST …/store/read` and follow the job (the parent owns the request; the draft is read-only while the job
 * runs). With a store: settings + payment methods read-only (`StoreSettings`), the products list and form with `product.*` ops in
 * the draft (`ProductsPanel`), Audience and Requests read-only with masked contacts (`CustomerData`).
 * The products shown = `store.products` with the draft's product ops laid over it (client copy, `mssgApplyProductOps`).
 *
 * Test ids: `me-sheet-5`, `me-store-head`, `me-store-read-at`, `me-store-never`, `me-store-read` (`data-reason`),
 * `me-store-reading` (`data-step`), `me-store-error` (`data-code`), `me-store-stale`; children: see `StoreSettings`,
 * `ProductsPanel`, `ProductForm`, `CustomerData`.
 */
import type { MssgOp, MssgStore } from '#shared/types/mssg-sites'
import type { MssgFieldError } from '~/utils/mssg-sites'

const props = defineProps<{
  siteId: string
  store: MssgStore | null
  ops: MssgOp[]
  readOnly: boolean
  /** step-5 field errors (products) */
  errors: MssgFieldError[]
  resetToken: number
  /** why "ดึงข้อมูลร้านค้าใหม่" cannot run now, else `null` */
  readBlockedReason: string | null
  /** the site's own `mssgStoreRead` job is open */
  reading: boolean
  readProgress: string
  /** the last store read failed: Thai text + code */
  readError: { code: string, text: string } | null
  /** a save went through after the last read: the list may differ from mssg */
  stale: boolean
  /** "+ เพิ่ม block Form" cannot jump (no page / read-only) */
  addFormDisabled: boolean
}>()

const emit = defineEmits<{
  ops: [next: MssgOp[], clear?: (e: MssgFieldError) => boolean]
  readStore: []
  addForm: []
}>()

const currency = computed(() => mssgStoreCurrency(props.store))
const products = computed(() => mssgApplyProductOps(props.store?.products ?? [], props.ops, currency.value))
const productErrors = computed(() => props.errors.filter(e => e.target.productId))
const addBlockedReason = computed(() => {
  if (!props.store) return 'ดึงข้อมูลร้านค้าก่อน จึงจะเพิ่มสินค้าได้'
  if (!currency.value) return 'ยังไม่รู้สกุลเงินของร้าน · กด "ดึงข้อมูลร้านค้าใหม่"'
  return null
})
</script>

<template>
  <div class="flex min-w-0 flex-col gap-5" data-testid="me-sheet-5">
    <p class="text-sm text-muted">
      สินค้า การชำระเงิน และข้อมูลลูกค้าของเว็บนี้ · สินค้าแก้เป็นร่างแล้วกด "บันทึก" ได้ · ตั้งค่าร้านค้า ช่องทางชำระเงิน Audience และ Requests ดูได้อย่างเดียว
    </p>

    <section
      class="flex min-w-0 flex-col gap-2.5 rounded-lg border border-default bg-elevated/40 p-3.5"
      aria-label="ข้อมูลร้านค้า"
      data-testid="me-store-head"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="min-w-0 flex-[1_1_220px] text-sm break-words text-default">
          <template v-if="store">
            <span data-testid="me-store-read-at">ข้อมูลร้านค้าดึงจาก mssg เมื่อ {{ formatDateTime(store.readAt) }}</span>
          </template>
          <span
            v-else
            class="text-muted"
            data-testid="me-store-never"
          >ยังไม่เคยดึงข้อมูลร้านค้าของเว็บนี้ · กดปุ่มเพื่อดึงสินค้า การตั้งค่า Audience และ Requests จาก mssg</span>
        </span>
        <UButton
          :label="store ? 'ดึงข้อมูลร้านค้าใหม่' : 'ดึงข้อมูลร้านค้า'"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="reading"
          :disabled="!!readBlockedReason || reading"
          :title="readBlockedReason ?? 'ดึงข้อมูลร้านค้าจาก mssg (อ่านอย่างเดียว ไม่แก้อะไรบน mssg)'"
          :data-reason="readBlockedReason ?? ''"
          data-testid="me-store-read"
          @click="emit('readStore')"
        />
      </div>
      <p
        v-if="reading"
        class="text-xs text-warning"
        role="status"
        data-testid="me-store-reading"
      >
        กำลังดึงข้อมูลร้านค้า · {{ readProgress }}
      </p>
      <UAlert
        v-if="readError && !reading"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="ดึงข้อมูลร้านค้าไม่สำเร็จ"
        :description="readError.text"
        :data-code="readError.code"
        data-testid="me-store-error"
      />
      <p v-if="store && stale && !reading" class="text-xs text-muted" data-testid="me-store-stale">
        เพิ่งบันทึกไปที่ mssg หลังดึงข้อมูลครั้งล่าสุด · กด "ดึงข้อมูลร้านค้าใหม่" ให้รายการด้านล่างตรงกับ mssg
      </p>
    </section>

    <template v-if="store">
      <MssgEditorStoreSettings :settings="store.settings" />
      <MssgEditorProductsPanel
        :site-id="siteId"
        :products="products"
        :total="store.productsTotal ?? store.products.length"
        :stored="store.products.length"
        :collections="store.collectionsCount ?? 0"
        :currency="currency"
        :ops="ops"
        :read-only="readOnly"
        :add-blocked-reason="addBlockedReason"
        :errors="productErrors"
        :reset-token="resetToken"
        @ops="(next, clear) => emit('ops', next, clear)"
      />
      <MssgEditorCustomerData
        :store="store"
        :add-form-disabled="addFormDisabled"
        @add-form="emit('addForm')"
      />
    </template>
  </div>
</template>
