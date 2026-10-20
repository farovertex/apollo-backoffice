<script setup lang="ts">
/**
 * FEAT-060 — `am-budget-modal`: set the advertiser's spending cap (ไม่จำกัด / กำหนดเอง). Presentational only
 * (same trick as `DeleteModal.vue`): the request, the per-advertiser optimistic override, the 409 toast +
 * re-read and the "other error keeps the modal open" rule all live in `pages/ads-monitor.vue` next to
 * `confirmDelete()` / `toggle()`; this component only asks and emits `confirm` with the exact POST body
 * (`api-contract.md v1 §2`).
 *
 * `UModal`'s root is renderless, so `data-testid`/`data-mode` are v-bound onto the rendered DialogContent
 * element through `content` (same trick as `DeleteModal.vue` / `ad-templates/DeleteModal.vue`).
 */
import type { ModalProps } from '@nuxt/ui'
import type { AdvertiserBudgetEdits, MonitorRow, SetBudgetBody } from '#shared/types/ads-monitor'

const AMOUNT_MIN = 0.01
const AMOUNT_MAX = 1_000_000_000

const props = defineProps<{
  /** the row the wallet/retry button was pressed on; null while the modal is closed */
  row: MonitorRow | null
  /** a POST for this row's advertiser is in flight */
  saving?: boolean
}>()

const emit = defineEmits<{ confirm: [row: MonitorRow, body: SetBudgetBody] }>()

const open = defineModel<boolean>('open', { default: false })

type BudgetMode = 'custom' | 'unlimited'

const MODE_ITEMS: { label: string, value: BudgetMode }[] = [
  { label: 'ไม่จำกัด', value: 'unlimited' },
  { label: 'กำหนดเอง', value: 'custom' }
]

const mode = ref<BudgetMode>('custom')
const amount = ref<number | null>(null)
const unlimitedConfirm = ref(false)

const budget = computed(() => props.row?.advertiserBudget ?? null)
const advertiser = computed(() => props.row?.advertiser ?? null)
const currency = computed(() => budget.value?.currency ?? null)
const edits = computed<AdvertiserBudgetEdits | null>(() => budget.value?.edits ?? null)

const modalContent = computed(() => ({
  'data-testid': 'am-budget-modal',
  'data-mode': mode.value
} as ModalProps['content']))

/** reset the form to the row's current value every time the modal opens (possibly on a different row) */
watch(open, (value) => {
  if (!value) return
  const b = budget.value
  mode.value = b?.mode === 'unlimited' ? 'unlimited' : 'custom'
  amount.value = b?.mode === 'custom' ? b.amount : null
  unlimitedConfirm.value = false
})

const title = computed(() => {
  const adv = advertiser.value
  if (!adv) return 'ตั้งงบ advertiser'
  const label = adv.name || adv.tiktokAdvertiserId
  return `ตั้งงบ advertiser ${label} (…${last4(adv.tiktokAdvertiserId)})`
})

function amountText(value: number | null): string {
  const text = formatDecimal(value)
  if (text === REPORT_DASH) return text
  return currency.value ? `${text} ${currency.value}/วัน` : `${text}/วัน`
}

const currentLine = computed(() => {
  const b = budget.value
  if (!b || b.mode === null) return 'ปัจจุบัน: ยังไม่เคยอ่าน'
  if (b.mode === 'unlimited') return 'ปัจจุบัน: ไม่จำกัด'
  return `ปัจจุบัน: ${amountText(b.amount)} · ตั้งล่าสุด ${formatDateTime(b.setAt ?? b.readAt)}`
})

const editsLine = computed(() => {
  const e = edits.value
  if (!e) return ''
  return `เหลือแก้ได้ ${e.left}/${e.total} ครั้ง (วันที่ ${e.forDate ?? REPORT_DASH})`
})

/** mirrors the API's `isValidBudgetAmount` (contract §2): > 0, ≤ 1e9, ≤ 2 decimals */
function isValidAmount(value: number | null): boolean {
  if (value === null || !Number.isFinite(value)) return false
  if (value < AMOUNT_MIN || value > AMOUNT_MAX) return false
  const rounded = Math.round(value * 100) / 100
  return Math.abs(rounded - value) < 1e-9
}

const amountError = computed(() => {
  if (mode.value !== 'custom') return null
  return isValidAmount(amount.value) ? null : 'ยอดต้องมากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง'
})

/** decision 5 — the stored value, re-selected, disables Save (defensive; the API also answers 200 unchanged) */
const unchanged = computed(() => {
  const b = budget.value
  if (!b || b.mode === null) return false
  if (mode.value === 'unlimited') return b.mode === 'unlimited'
  return b.mode === 'custom' && b.amount === amount.value
})

const invalid = computed(() => (mode.value === 'custom' ? amountError.value !== null : !unlimitedConfirm.value))
const saveDisabled = computed(() => invalid.value || unchanged.value)

function confirm() {
  if (!props.row || props.saving || saveDisabled.value) return
  const body: SetBudgetBody = mode.value === 'unlimited'
    ? { mode: 'unlimited' }
    : { mode: 'custom', amount: amount.value as number }
  emit('confirm', props.row, body)
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :dismissible="!saving"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-default" data-testid="am-budget-current">
          {{ currentLine }}
        </p>
        <p v-if="edits" class="text-xs text-muted" data-testid="am-budget-edits">
          {{ editsLine }}
        </p>

        <URadioGroup
          v-model="mode"
          :items="MODE_ITEMS"
          value-key="value"
          orientation="horizontal"
          :disabled="saving"
          data-testid="am-budget-mode"
        />

        <template v-if="mode === 'custom'">
          <UFormField label="ยอดงบประมาณ" :error="amountError ?? undefined">
            <div class="flex items-center gap-2">
              <UInputNumber
                v-model="amount"
                :min="AMOUNT_MIN"
                :step="0.01"
                :format-options="{ minimumFractionDigits: 2, maximumFractionDigits: 2 }"
                class="w-full"
                :disabled="saving"
                data-testid="am-budget-amount"
              />
              <span v-if="currency" class="text-sm whitespace-nowrap text-muted">{{ currency }}</span>
            </div>
          </UFormField>
          <p v-if="amountError" class="text-xs text-error" data-testid="am-budget-amount-error">
            {{ amountError }}
          </p>
          <p class="text-xs text-warning" data-testid="am-budget-warning">
            งบต่ำกว่าที่ใช้ไปแล้ววันนี้จะทำให้โฆษณาหยุด
          </p>
        </template>

        <template v-else>
          <p class="text-xs text-warning" data-testid="am-budget-unlimited-note">
            ไม่จำกัด = บัญชีนี้ไม่มีเพดานการใช้จ่าย โปรดยืนยันว่าต้องการปลดเพดาน
          </p>
          <UCheckbox
            v-model="unlimitedConfirm"
            label="ยืนยันปลดเพดาน"
            :disabled="saving"
            data-testid="am-budget-unlimited-confirm"
          />
        </template>

        <p v-if="!invalid && unchanged" class="text-xs text-muted" data-testid="am-budget-unchanged">
          ค่าเดิม
        </p>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="saving"
            data-testid="am-budget-cancel"
            @click="open = false"
          />
          <UButton
            label="บันทึก"
            color="primary"
            variant="solid"
            :loading="saving"
            :disabled="saveDisabled"
            data-testid="am-budget-save"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
