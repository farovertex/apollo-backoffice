<script setup lang="ts">
/**
 * FEAT-021 (AC-16, L-1) — the "จ่ายเงิน" / "ลองใหม่" button and its amount popover.
 *
 * The new flow never opens a modal to ask for the amount: the button opens a small popover with one integer
 * field, and `POST /topups` turns the row into `waitingQr` immediately (api-contract v1.1 §C). The popover
 * closes as soon as the API answered 201; a 400 from the API is shown **with the API's own text** in
 * `ta-adv-topup-amount-error`, so the minimum can change on the API side without touching the BO.
 *
 * The inner ids are the same on both surfaces (slide-over and `/topups`); only the trigger differs
 * (`ta-adv-topup-pay` vs `tp-row-retry`), because the contract names them that way.
 */
import type { FetchError } from 'ofetch'
import type { PopoverProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { TopupView } from '#shared/types/topups'

const props = withDefaults(defineProps<{
  tiktokAccountId: string
  advertiserId: string
  /** the amount of the failed round, prefilled on a retry (L-2) */
  defaultAmount?: number
  /** `qrFailed` → the button reads "ลองใหม่" and carries `data-retry="true"` */
  retry?: boolean
  /** `ta-adv-topup-pay` in the slide-over, `tp-row-retry` in the `/topups` table */
  triggerTestid?: string
  size?: 'xs' | 'sm' | 'md'
  disabled?: boolean
}>(), {
  defaultAmount: undefined,
  retry: false,
  triggerTestid: 'ta-adv-topup-pay',
  size: 'xs',
  disabled: false
})

const emit = defineEmits<{
  created: [topup: TopupView]
}>()

const api = useApi()
const toast = useToast()

const open = ref(false)
const amount = ref<number | undefined>(props.defaultAmount)
const submitting = ref(false)
const serverError = ref<string | null>(null)
const touched = ref(false)

const popoverContent = { 'data-testid': 'ta-adv-topup-popover' } as PopoverProps['content']

const localError = computed(() => topupAmountError(amount.value))
const errorText = computed(() => serverError.value ?? (touched.value ? localError.value : null))
const canSubmit = computed(() => !submitting.value && !props.disabled && localError.value === null)

watch(open, (isOpen) => {
  if (!isOpen) return
  amount.value = props.defaultAmount
  serverError.value = null
  touched.value = false
})

async function submit() {
  touched.value = true
  serverError.value = null
  if (!canSubmit.value) return
  submitting.value = true
  try {
    // retry: 0 — exactly one round per click
    const res = await api<{ topup: TopupView, jobId: string }>('/topups', {
      method: 'POST',
      retry: 0,
      body: {
        tiktokAccountId: props.tiktokAccountId,
        advertiserId: props.advertiserId,
        amount: amount.value
      }
    })
    open.value = false
    emit('created', res.topup)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    const message = err.data?.error ?? err.message ?? 'ทำรายการไม่สำเร็จ'
    if (status === 400) {
      serverError.value = message
    } else {
      open.value = false
      toast.add({
        'title': 'ขอ QR ไม่สำเร็จ',
        'description': message,
        'color': status === 409 ? 'warning' : 'error',
        'data-testid': 'ta-toast'
      } as Parameters<typeof toast.add>[0])
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UPopover v-model:open="open" :content="popoverContent">
    <UButton
      :label="retry ? 'ลองใหม่' : 'จ่ายเงิน'"
      :size="size"
      color="primary"
      icon="i-lucide-qr-code"
      :disabled="disabled"
      :data-testid="triggerTestid"
      :data-retry="retry ? 'true' : 'false'"
    />

    <template #content>
      <form class="flex w-56 flex-col gap-2 p-3" @submit.prevent="submit">
        <label class="text-xs text-muted" for="ta-adv-topup-amount-input">จำนวนเงิน (บาท)</label>
        <UInput
          id="ta-adv-topup-amount-input"
          v-model.number="amount"
          type="number"
          inputmode="numeric"
          :min="TOPUP_MIN_AMOUNT"
          step="1"
          :placeholder="String(TOPUP_MIN_AMOUNT)"
          autofocus
          data-testid="ta-adv-topup-amount"
          @blur="touched = true"
        />
        <p v-if="errorText" class="text-xs text-error" data-testid="ta-adv-topup-amount-error">
          {{ errorText }}
        </p>
        <UButton
          type="submit"
          label="ยืนยัน"
          color="primary"
          size="sm"
          block
          :loading="submitting"
          data-testid="ta-adv-topup-submit"
        />
      </form>
    </template>
  </UPopover>
</template>
