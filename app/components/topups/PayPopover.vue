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
 *
 * `advertiserId: null` = an account-level round (BC payment page): `POST /topups/accounts` with this one account,
 * whose per-account `error` is shown like any other failure.
 *
 * FEAT-051 (AC-31/AC-32, spec "UI behaviour") — under the amount field there is now a **channel** chooser,
 * `[ QR ]` (default) and `[ บัตรเครดิต/เดบิต ]`:
 *   - **QR is untouched**: same single step, same `POST` body (no `channel` key at all), same `ta-adv-topup-submit`
 *     button, same error element, same test ids. A surface that never selects a card behaves exactly as before.
 *   - card → the button becomes "ถัดไป" (`ta-adv-topup-next`) and opens `TopupsCardPayModal` with the amount;
 *     the create request happens in there. The option is disabled with a visible reason when the account's
 *     currency is unknown or has no card limits (`cardChannelBlockedReason`), and the amount hint follows the
 *     per-currency minimum instead of the QR one (AC-6: USD 10 is valid).
 * The channel never reaches `POST /topups` from here, so nothing of the QR path can change by accident.
 */
import type { FetchError } from 'ofetch'
import type { PopoverProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AccountTopupResponse, TopupChannel, TopupView } from '#shared/types/topups'

const props = withDefaults(defineProps<{
  tiktokAccountId: string
  /** null → top up the TikTok account (BC) instead of one advertiser */
  advertiserId: string | null
  /** the amount of the failed round, prefilled on a retry (L-2) */
  defaultAmount?: number
  /** `qrFailed` → the button reads "ลองใหม่" and carries `data-retry="true"` */
  retry?: boolean
  /** `ta-adv-topup-pay` in the slide-over, `tp-row-retry` in the `/topups` table */
  triggerTestid?: string
  size?: 'xs' | 'sm' | 'md'
  disabled?: boolean
  /**
   * FEAT-051 — `balanceCurrency` of the TikTok account: `undefined` = this surface does not know it (the card
   * option stays open and the API's 409/400 text is what the admin reads), `null` = the account has none yet.
   */
  balanceCurrency?: string | null
  /** FEAT-051 — which channel the chooser starts on (a retry of a `cardFailed` round starts on `card`) */
  defaultChannel?: TopupChannel
  /** FEAT-051 — advertiser / BC name for the card modal and the confirm dialog */
  accountName?: string
}>(), {
  defaultAmount: undefined,
  retry: false,
  triggerTestid: 'ta-adv-topup-pay',
  size: 'xs',
  disabled: false,
  balanceCurrency: undefined,
  defaultChannel: 'qr',
  accountName: ''
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

// ── FEAT-051 · channel ───────────────────────────────────────────────────────────────────────────────────────────────
const channel = ref<TopupChannel>(props.defaultChannel)
const cardOpen = ref(false)

/** why the card option cannot be used (unknown currency / a currency without card limits), null = it can */
const cardBlocked = computed(() => cardChannelBlockedReason(props.balanceCurrency))
const isCard = computed(() => channel.value === 'card')

function selectChannel(next: TopupChannel) {
  if (next === 'card' && cardBlocked.value) return
  channel.value = next
  serverError.value = null
}

const localError = computed(() =>
  isCard.value
    ? topupAmountError(amount.value, { channel: 'card', currency: props.balanceCurrency })
    : topupAmountError(amount.value)
)
const errorText = computed(() => serverError.value ?? (touched.value ? localError.value : null))
const canSubmit = computed(() => !submitting.value && !props.disabled && localError.value === null)

/** the amount label says which currency is being typed (QR keeps the words it always had) */
const amountLabel = computed(() =>
  isCard.value && props.balanceCurrency
    ? `จำนวนเงิน (${props.balanceCurrency})`
    : 'จำนวนเงิน (บาท)'
)

/**
 * `min` of the number input is also the browser's own constraint: with the QR minimum left in place a valid card
 * amount (10 USD) would be refused by the browser before the handler ever runs. QR keeps `TOPUP_MIN_AMOUNT`.
 */
const amountMin = computed(() => {
  if (!isCard.value) return TOPUP_MIN_AMOUNT
  const limits = TOPUP_CARD_LIMITS[(props.balanceCurrency ?? '').toUpperCase()]
  return limits?.min ?? 1
})

watch(open, (isOpen) => {
  if (!isOpen) return
  amount.value = props.defaultAmount
  serverError.value = null
  touched.value = false
  channel.value = props.defaultChannel === 'card' && !cardBlocked.value ? 'card' : 'qr'
})

/** card: step two is the modal; the round is created there, not here */
function next() {
  touched.value = true
  serverError.value = null
  if (!canSubmit.value) return
  open.value = false
  cardOpen.value = true
}

function onCardCreated(topup: TopupView) {
  emit('created', topup)
}

/** one handler for the form: QR creates the round right here, card goes to the modal (AC-31 keeps QR identical) */
function onSubmit() {
  if (isCard.value) {
    next()
    return
  }
  void submit()
}

async function submit() {
  touched.value = true
  serverError.value = null
  if (!canSubmit.value) return
  submitting.value = true
  try {
    if (props.advertiserId === null) {
      // retry: 0 — exactly one round per click
      const res = await api<AccountTopupResponse>('/topups/accounts', {
        method: 'POST',
        retry: 0,
        body: { tiktokAccountIds: [props.tiktokAccountId], amount: amount.value }
      })
      const row = res.results?.[0]
      open.value = false
      if (row?.ok && row.topup) emit('created', row.topup)
      else failToast(row?.error ?? 'ทำรายการไม่สำเร็จ', 409)
      return
    }
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
      failToast(message, status)
    }
  } finally {
    submitting.value = false
  }
}

function failToast(message: string, status: number | undefined) {
  toast.add({
    'title': 'ขอ QR ไม่สำเร็จ',
    'description': message,
    'color': status === 409 ? 'warning' : 'error',
    'data-testid': 'ta-toast'
  } as Parameters<typeof toast.add>[0])
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
      <form class="flex w-60 flex-col gap-2 p-3" @submit.prevent="onSubmit">
        <label class="text-xs text-muted" for="ta-adv-topup-amount-input">{{ amountLabel }}</label>
        <UInput
          id="ta-adv-topup-amount-input"
          v-model.number="amount"
          type="number"
          inputmode="numeric"
          :min="amountMin"
          step="1"
          :placeholder="String(amountMin)"
          autofocus
          data-testid="ta-adv-topup-amount"
          @blur="touched = true"
        />
        <p v-if="errorText" class="text-xs text-error" data-testid="ta-adv-topup-amount-error">
          {{ errorText }}
        </p>

        <!-- FEAT-051 — channel: QR is the default and keeps the single-step flow -->
        <div
          class="flex flex-col gap-1"
          role="radiogroup"
          aria-label="ช่องทางการจ่ายเงิน"
          data-testid="ta-adv-topup-channel"
          :data-channel="channel"
        >
          <div class="grid grid-cols-2 gap-1">
            <UButton
              label="QR"
              icon="i-lucide-qr-code"
              size="xs"
              block
              role="radio"
              :aria-checked="!isCard"
              :color="!isCard ? 'primary' : 'neutral'"
              :variant="!isCard ? 'solid' : 'outline'"
              data-testid="ta-adv-topup-channel-qr"
              @click="selectChannel('qr')"
            />
            <UTooltip :text="cardBlocked ?? 'บัตรเครดิต/เดบิตของบัญชีนี้'">
              <UButton
                label="บัตร"
                icon="i-lucide-credit-card"
                size="xs"
                block
                role="radio"
                :aria-checked="isCard"
                :color="isCard ? 'primary' : 'neutral'"
                :variant="isCard ? 'solid' : 'outline'"
                :disabled="!!cardBlocked"
                data-testid="ta-adv-topup-channel-card"
                @click="selectChannel('card')"
              />
            </UTooltip>
          </div>
          <p v-if="cardBlocked" class="text-xs text-warning" data-testid="ta-adv-topup-channel-reason">
            {{ cardBlocked }}
          </p>
        </div>

        <UButton
          v-if="!isCard"
          type="submit"
          label="ยืนยัน"
          color="primary"
          size="sm"
          block
          :loading="submitting"
          data-testid="ta-adv-topup-submit"
        />
        <UButton
          v-else
          type="submit"
          label="ถัดไป"
          icon="i-lucide-arrow-right"
          color="primary"
          size="sm"
          block
          data-testid="ta-adv-topup-next"
        />
      </form>
    </template>
  </UPopover>

  <!-- step two of the card channel: which card + the confirm dialog + the one create request -->
  <TopupsCardPayModal
    v-model:open="cardOpen"
    :tiktok-account-id="tiktokAccountId"
    :advertiser-id="advertiserId"
    :amount="amount ?? null"
    :currency="balanceCurrency ?? null"
    :account-name="accountName"
    @created="onCardCreated"
  />
</template>
