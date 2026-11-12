<script setup lang="ts">
/**
 * FEAT-101 M4 — "Products Settings" of step 5, **read-only** (decision D5, AC-32): shopcart, success message / URL, product
 * options, currency (+ the design's warning), products messengers, payment methods (enabled yes / no only — no key is ever
 * read into Node), notifications. Values come from `store.settings`; nothing here is an input and nothing sends a request.
 * Every block says "แก้ที่ mssg" (the BO has no mssg host to link to, so it is plain text).
 *
 * Test ids: `me-store-settings` (`data-readonly="true"`), `me-store-note`, `me-store-shopcart` (`data-enabled`),
 * `me-store-success-message`, `me-store-success-url`, `me-store-options`, `me-store-currency`, `me-store-currency-warning`,
 * `me-store-messenger-<key>` (`data-enabled`), `me-store-payments-summary`, `me-store-payment-<key>` (`data-enabled`),
 * `me-store-notifications`.
 */
import type { MssgStoreSettings } from '#shared/types/mssg-sites'

const props = defineProps<{ settings: MssgStoreSettings | null }>()

const s = computed(() => props.settings ?? {})
const options = computed(() => (s.value.productOptions ?? []).map(mssgOptionText).filter(Boolean))
</script>

<template>
  <section
    class="flex min-w-0 flex-col gap-4 rounded-lg border border-default bg-elevated/40 p-3.5"
    aria-label="ตั้งค่าสินค้า"
    data-testid="me-store-settings"
    data-readonly="true"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <span class="text-sm font-semibold text-highlighted">Products Settings</span>
      <UBadge
        label="อ่านอย่างเดียว · แก้ที่ mssg"
        color="neutral"
        variant="subtle"
        data-testid="me-store-note"
      />
    </div>
    <p class="text-xs text-muted">
      ตะกร้าสินค้า สกุลเงิน และช่องทางชำระเงินแก้ได้ที่ mssg เท่านั้น (Online store &amp; Payments) · ที่นี่แสดงให้ดูเฉย ๆ และไม่เก็บคีย์ของผู้ให้บริการชำระเงิน
    </p>

    <div class="flex flex-col gap-3">
      <div class="flex items-center justify-between gap-4">
        <span class="flex min-w-0 flex-col gap-0.5">
          <span class="text-sm text-highlighted">ตะกร้าสินค้า (Shopcart)</span>
          <span class="text-xs text-muted">ให้ลูกค้าหยิบสินค้าใส่ตะกร้าแล้วส่งคำสั่งซื้อ</span>
        </span>
        <UBadge
          :label="s.shopcart?.enabled ? 'เปิด' : 'ปิด'"
          :color="s.shopcart?.enabled ? 'success' : 'neutral'"
          variant="subtle"
          :data-enabled="s.shopcart?.enabled ? 'true' : 'false'"
          data-testid="me-store-shopcart"
        />
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted">ข้อความหลังสั่งซื้อสำเร็จ (Success message)</span>
        <span class="text-sm break-words text-default" data-testid="me-store-success-message">{{ s.shopcart?.successMessage || '(ว่าง)' }}</span>
      </div>
      <div class="flex flex-col gap-0.5">
        <span class="text-xs text-muted">พาไปหน้าอื่นหลังสั่งซื้อ (Success URL)</span>
        <span class="text-sm break-all text-default" data-testid="me-store-success-url">{{ s.shopcart?.successUrl || 'ปิดอยู่' }}</span>
      </div>
    </div>

    <div class="flex flex-col gap-1.5">
      <span class="text-sm text-highlighted">ตัวเลือกสินค้า (Product options)</span>
      <div class="flex flex-wrap gap-1.5" data-testid="me-store-options" :data-count="options.length">
        <UBadge
          v-for="(o, i) in options"
          :key="`${i}-${o}`"
          :label="o"
          color="neutral"
          variant="outline"
          class="max-w-full break-all"
        />
        <span v-if="!options.length" class="text-sm text-muted">ยังไม่มีตัวเลือก</span>
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <div class="flex items-center justify-between gap-4">
        <span class="text-sm text-highlighted">สกุลเงินสินค้า (Currency)</span>
        <span class="text-sm font-medium text-default" data-testid="me-store-currency">{{ s.currency || '—' }}</span>
      </div>
      <span class="text-xs text-warning" data-testid="me-store-currency-warning">คำเตือน: ถ้าเปลี่ยนสกุลเงินที่ mssg สกุลเงินของสินค้าที่มีอยู่จะเปลี่ยนตามด้วย</span>
    </div>

    <div class="flex flex-col gap-2">
      <span class="text-sm text-highlighted">ช่องทางรับคำสั่งซื้อ (Products messengers)</span>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div
          v-for="m in MSSG_PRODUCT_MESSENGERS"
          :key="m.key"
          class="flex items-center justify-between gap-3 rounded-md border border-default px-3 py-2"
        >
          <span class="text-sm text-default">{{ m.label }}</span>
          <UBadge
            :label="s.messengers?.[m.key] ? 'เปิด' : 'ปิด'"
            :color="s.messengers?.[m.key] ? 'success' : 'neutral'"
            variant="subtle"
            :data-enabled="s.messengers?.[m.key] ? 'true' : 'false'"
            :data-testid="`me-store-messenger-${m.key}`"
          />
        </div>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3">
        <span class="text-sm text-highlighted">ช่องทางชำระเงิน (Payment methods)</span>
        <span class="text-xs text-muted" data-testid="me-store-payments-summary">{{ mssgPaymentSummary(settings) }}</span>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div
          v-for="m in MSSG_PAYMENT_METHODS"
          :key="m.key"
          class="flex min-w-0 items-center justify-between gap-3 rounded-md border border-default px-3 py-2"
        >
          <span class="flex min-w-0 flex-col">
            <span class="text-sm break-words text-default">{{ m.label }}</span>
            <span class="text-xs break-words text-muted">{{ m.th }}</span>
          </span>
          <UBadge
            :label="mssgPaymentEnabled(settings, m.key) ? 'เปิด' : 'ปิด'"
            :color="mssgPaymentEnabled(settings, m.key) ? 'success' : 'neutral'"
            variant="subtle"
            :data-enabled="mssgPaymentEnabled(settings, m.key) ? 'true' : 'false'"
            :data-testid="`me-store-payment-${m.key}`"
          />
        </div>
      </div>
      <span class="text-xs text-muted">คีย์และบัญชีของผู้ให้บริการชำระเงินตั้งค่าที่หน้าของแต่ละช่องทางใน mssg</span>
    </div>

    <div class="flex flex-col gap-0.5" data-testid="me-store-notifications">
      <span class="text-sm text-highlighted">แจ้งเตือนคำสั่งซื้อใหม่ (Notifications)</span>
      <span class="text-xs text-muted">ต้องตั้งค่าการแจ้งเตือนในบัญชี mssg ก่อน จึงจะเปิดการแจ้งเตือนคำสั่งซื้อได้ · แก้ที่ mssg</span>
    </div>
  </section>
</template>
