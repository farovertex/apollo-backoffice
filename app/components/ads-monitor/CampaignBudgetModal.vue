<script setup lang="ts">
/**
 * FEAT-091 — `am-cbudget-modal`: edit one campaign's daily budget (api-contract.md v1 §2/§6, spec "UI
 * behaviour (BO)"). Presentational only (same trick as `DeleteModal.vue` / `BudgetModal.vue`): the request,
 * the optimistic override, the 409 toast + re-read and the "other error keeps the modal open" rule all live in
 * `pages/ads-monitor.vue` next to `confirmDelete()` / `confirmBudget()`; this component only asks and emits
 * `confirm` with the exact amount.
 *
 * Mirrors the TikTok modal in spirit (brief screenshots `02-budget-hover.png` / `04-budget-edit-click.png`):
 * one amount field with the currency suffix, ยกเลิก / ยืนยัน — not pixel-for-pixel.
 *
 * `UModal`'s root is renderless, so `data-testid` is v-bound onto the rendered DialogContent element through
 * `content` (same trick as `DeleteModal.vue` / `BudgetModal.vue`).
 *
 * Deviation from contract §6's literal "`step 1`" (flagged to the Lead, bo.md T2): `UInputNumber`'s step/min
 * snap the blurred value onto the grid `min + n*step` — with `min="0.01"` and `step="1"` that grid is
 * `0.01, 1.01, 2.01, …`, so typing a whole number like "650" and blurring silently turned it into "650.01"
 * (confirmed by hand), and any decimal the admin actually meant (e.g. "650.50") would have been rounded away
 * to the nearest whole number first. `step="0.01"` (same value `BudgetModal.vue` already uses for the same
 * kind of currency field) puts every 2-decimal amount exactly on the grid, so nothing gets silently changed.
 */
import type { ModalProps } from '@nuxt/ui'
import type { MonitorRow } from '#shared/types/ads-monitor'

const AMOUNT_MIN = 0.01
const AMOUNT_MAX = 1_000_000_000

const props = defineProps<{
  /** the campaign row the pencil/retry button was pressed on; null while the modal is closed */
  row: MonitorRow | null
  /** the amount to prefill: current for ok/blocked, the failed amount for retry */
  initialAmount?: number | null
  /** a POST of this row is in flight */
  saving?: boolean
}>()

const emit = defineEmits<{ confirm: [row: MonitorRow, amount: number] }>()

const open = defineModel<boolean>('open', { default: false })

const amount = ref<number | null>(null)
/** the amount error is shown only after the field was touched (`BudgetModal` rule, BUG: must not show before
 * the user does anything) and never while the field is empty (clearing it back to empty must only disable
 * Confirm, silently). Reset on every open so re-opening the modal on a different row/amount starts clean. */
const touched = ref(false)

const currency = computed(() => props.row?.budget?.currency ?? props.row?.advertiserBudget?.currency ?? '')
const currentAmount = computed(() => props.row?.budget?.amount ?? null)

const modalContent = { 'data-testid': 'am-cbudget-modal' } as ModalProps['content']

/** `last4()` already supplies its own leading "…" — a literal one here would double it up (the exact bug
 * `BudgetModal.vue` found and fixed; same fix here). */
const title = computed(() => {
  const name = props.row?.name || props.row?.id || ''
  return name ? `${name} (${last4(props.row!.id)})` : ''
})

/** reset the form to the prefilled amount every time the modal opens (possibly on a different row) */
watch(open, (value) => {
  if (!value) return
  amount.value = props.initialAmount ?? currentAmount.value
  touched.value = false
})

function currentLine(): string {
  const text = formatDecimal(currentAmount.value)
  if (text === REPORT_DASH) return `ปัจจุบัน: ${REPORT_DASH}`
  return currency.value ? `ปัจจุบัน: ${text} ${currency.value}/วัน` : `ปัจจุบัน: ${text}/วัน`
}

/** mirrors the API's `isValidBudgetAmount` (contract §2): > 0, ≤ 1e9, ≤ 2 decimals */
function isValidAmount(value: number | null): boolean {
  if (value === null || !Number.isFinite(value)) return false
  if (value < AMOUNT_MIN || value > AMOUNT_MAX) return false
  const rounded = Math.round(value * 100) / 100
  return Math.abs(rounded - value) < 1e-9
}

/** `UInputNumber` emits `undefined` when its native input is cleared and then blurred (confirmed by hand on
 * `BudgetModal`); `== null` catches both `null`/`undefined`, `Number.isNaN` a stray `NaN` — all three count as
 * "empty" for the pristine-error gate (an emptied field must disable Confirm silently, never show the text). */
const amountEmpty = computed(() => amount.value == null || Number.isNaN(amount.value))
const amountError = computed(() => (isValidAmount(amount.value) ? null : 'ยอดต้องมากกว่า 0 และทศนิยมไม่เกิน 2 ตำแหน่ง'))

/** decision — the stored value, re-entered, disables Confirm (defensive; the API also answers 200 unchanged) */
const unchanged = computed(() => currentAmount.value !== null && amount.value === currentAmount.value)

const invalid = computed(() => amountError.value !== null)
const confirmDisabled = computed(() => invalid.value || unchanged.value || !!props.saving)

function confirm() {
  touched.value = true
  if (!props.row || props.saving || confirmDisabled.value) return
  emit('confirm', props.row, amount.value as number)
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="แก้ไขงบประมาณรายวัน"
    :dismissible="!saving"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm font-medium text-default" data-testid="am-cbudget-name">
          {{ title }}
        </p>
        <p class="text-sm text-default" data-testid="am-cbudget-current">
          {{ currentLine() }}
        </p>

        <UFormField label="ยอดงบประมาณ">
          <div class="flex items-center gap-2">
            <UInputNumber
              v-model="amount"
              :min="AMOUNT_MIN"
              :step="0.01"
              :format-options="{ minimumFractionDigits: 2, maximumFractionDigits: 2 }"
              class="w-full"
              :disabled="saving"
              data-testid="am-cbudget-amount"
              @update:model-value="touched = true"
            />
            <span v-if="currency" class="text-sm whitespace-nowrap text-muted">{{ currency }}</span>
          </div>
        </UFormField>
        <p v-if="touched && !amountEmpty && amountError" class="text-xs text-error" data-testid="am-cbudget-amount-error">
          {{ amountError }}
        </p>

        <p class="text-xs text-muted" data-testid="am-cbudget-hint">
          ขั้นต่ำ/เพดานเป็นของ TikTok — ถ้าไม่รับจะขึ้นเป็นข้อผิดพลาดของแถว
        </p>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="saving"
            data-testid="am-cbudget-cancel"
            @click="open = false"
          />
          <UButton
            label="ยืนยัน"
            color="primary"
            variant="solid"
            :loading="saving"
            :disabled="confirmDisabled"
            data-testid="am-cbudget-confirm"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
