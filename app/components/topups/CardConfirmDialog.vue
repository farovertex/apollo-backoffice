<script setup lang="ts">
/**
 * FEAT-051 (AC-33, spec "UI behaviour", requirements delta of proposal §10) — **the** confirm dialog of every
 * card payment. A human pressing the button in here *is* the approval of that round, so it is the one component
 * both paths go through:
 *
 *   `TopupsCardPayModal` → `POST /topups` / `POST /topups/accounts` with `channel: 'card'`
 *   `TopupsRowActions`   → `POST /topups/:id/approve` of a round that was left in `pendingApproval`
 *
 * It shows what the money does — amount, **currency**, the account/BC it lands on and the last 4 digits of the
 * card — and nothing else: no number, no CVV, no token (AC-24). The accept checkbox gates the confirm button and
 * is reset on every open, so a second payment has to be accepted again. The dialog itself **never calls the API**:
 * it emits `confirm` and the caller runs the single request while `busy` keeps the button loading.
 *
 * Cancel / Esc / backdrop close it without emitting anything — "ยกเลิกแล้วไม่มี request ออกไปเลย" (AC-33).
 */
import type { ModalProps } from '@nuxt/ui'

const props = withDefaults(defineProps<{
  /** integer, in `currency` */
  amount: number | null
  /** the account's `balanceCurrency`; '' when the surface does not know it (the API's text decides) */
  currency: string | null
  /** advertiser name, BC name or account label — what the money lands on */
  accountName: string
  /** 4 digits of the card that will be charged; '' when it is not known yet */
  last4: string
  /** `brand ****last4 · holder (MM/YY)` when known — purely informative */
  cardSummaryText?: string
  /** the request of the caller is in flight */
  busy?: boolean
  /** "ค้างไว้ให้คนอื่นอนุมัติ" is ticked: this confirm only *creates* the round, it does not pay */
  deferred?: boolean
}>(), {
  cardSummaryText: '',
  busy: false,
  deferred: false
})

const emit = defineEmits<{ confirm: [] }>()

const open = defineModel<boolean>('open', { default: false })

// UModal's root is renderless — `content` is v-bound onto the rendered dialog element
const modalContent = { 'data-testid': 'tp-card-confirm' } as ModalProps['content']

const accepted = ref(false)

watch(open, (isOpen) => {
  if (isOpen) accepted.value = false
})

const title = computed(() => props.deferred ? 'ค้างรอบนี้ไว้ให้อนุมัติ?' : 'ยืนยันจ่ายเงินด้วยบัตร?')
const description = computed(() => props.deferred
  ? 'รอบนี้จะถูกสร้างไว้โดยยังไม่จ่าย — ต้องมีคนกด "จ่ายเงิน" ภายใน 24 ชั่วโมง'
  : 'เงินจะถูกตัดจากบัตรใบนี้ทันทีที่ระบบกดจ่ายให้')
const acceptLabel = computed(() => props.deferred
  ? 'ฉันยืนยันยอดและบัญชีปลายทางของรอบนี้'
  : 'ฉันยืนยันให้ตัดเงินจากบัตรใบนี้ตามยอดข้างบน')
const confirmLabel = computed(() => props.deferred ? 'สร้างรอบรออนุมัติ' : 'จ่ายเงิน')

const amountText = computed(() => {
  const value = formatInt(props.amount)
  return props.currency ? `${value} ${props.currency}` : value
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
    :dismissible="!busy"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-muted">
            ยอด
          </dt>
          <dd
            class="text-right text-base font-semibold tabular-nums text-highlighted"
            data-testid="tp-card-confirm-amount"
            :data-currency="currency ?? ''"
          >
            {{ amountText }}
          </dd>
          <dt class="text-muted">
            บัญชี
          </dt>
          <dd class="min-w-0 text-right font-medium break-words text-highlighted" data-testid="tp-card-confirm-account">
            {{ accountName || '—' }}
          </dd>
          <dt class="text-muted">
            บัตร
          </dt>
          <dd class="min-w-0 text-right font-medium break-words text-highlighted" data-testid="tp-card-confirm-card" :data-last4="last4">
            {{ cardSummaryText || (last4 ? cardMask(last4) : '—') }}
          </dd>
        </dl>

        <UCheckbox
          v-model="accepted"
          :label="acceptLabel"
          :disabled="busy"
          data-testid="tp-card-accept"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="busy"
            data-testid="tp-card-confirm-cancel"
            @click="open = false"
          />
          <UButton
            :label="confirmLabel"
            icon="i-lucide-credit-card"
            color="primary"
            :disabled="!accepted"
            :loading="busy"
            data-testid="tp-card-confirm-submit"
            @click="emit('confirm')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
