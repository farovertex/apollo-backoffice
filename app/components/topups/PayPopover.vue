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
 *
 * FEAT-053 (AC-22) — the minimum, the per-round maximum and the list of currencies that have a card channel are
 * no longer hardcoded: opening the popover fires **one** `GET /topups/options?tiktokAccountId=…`
 * (`useTopupOptions`) and the numbers of that answer feed the same rules and the same messages as before. When
 * the request does not answer 200 nothing is shown and the fallback table of `app/utils/topup.ts` is used, so
 * the FEAT-051 behaviour is untouched. A currency with a per-day cap also renders one extra read-only line,
 * `<prefix>-remaining-today` ("เหลือวันนี้ X <CUR>"), which does not exist without a cap.
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
  /**
   * FEAT-053 — the surface's own testid prefix, used **only** for the new "เหลือวันนี้" line
   * (`<prefix>-remaining-today`). Every other id inside the popover keeps the single `ta-adv-topup-*` set it has
   * had since FEAT-021 on all three surfaces (AC-23: none of them may change).
   */
  prefix?: 'ta-adv-topup' | 'tp-row' | 'ta-topup'
}>(), {
  defaultAmount: undefined,
  retry: false,
  triggerTestid: 'ta-adv-topup-pay',
  size: 'xs',
  disabled: false,
  balanceCurrency: undefined,
  defaultChannel: 'qr',
  accountName: '',
  prefix: 'ta-adv-topup'
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

// ── FEAT-053 · the server's limits (one request per open, silent fallback) ───────────────────────────────────────────
const { options: topupOptions, load: loadOptions, reset: resetOptions } = useTopupOptions()
/** `min`/`maxPerRound` of this account's currency — the server's row when it answered, else the hint table */
const cardLimit = computed(() => topupCardLimit(props.balanceCurrency, topupOptions.value))
/** how much of the per-day cap is left; null = no cap for this currency, or options unavailable → no line */
const remainingToday = computed(() => topupRemainingToday(topupOptions.value))

// ── FEAT-051 · channel ───────────────────────────────────────────────────────────────────────────────────────────────
const channel = ref<TopupChannel>(props.defaultChannel)
const cardOpen = ref(false)

/** why the card option cannot be used (unknown currency / a currency without card limits), null = it can */
const cardBlocked = computed(() => cardChannelBlockedReason(props.balanceCurrency, topupOptions.value))
/**
 * TASK-topup-qr-usd (2026-10-26) — why the QR option cannot be used (a USD account tops up by card only), null = it
 * can. Known from the currency prop at once (fallback list) and confirmed by `qr.enabled` once the options answer.
 */
const qrBlocked = computed(() => qrChannelBlockedReason(props.balanceCurrency, topupOptions.value))
const isCard = computed(() => channel.value === 'card')

function selectChannel(next: TopupChannel) {
  if (next === 'card' && cardBlocked.value) return
  if (next === 'qr' && qrBlocked.value) return
  channel.value = next
  serverError.value = null
}

/** the channel the popover starts on: card when asked for (or when QR is closed for this currency) and allowed */
function startChannel(): TopupChannel {
  return (props.defaultChannel === 'card' || qrBlocked.value) && !cardBlocked.value ? 'card' : 'qr'
}

// the options answer may close QR after the popover opened (currency unknown to the surface) — move off it
watch(qrBlocked, (blocked) => {
  if (blocked && !isCard.value && !cardBlocked.value) channel.value = 'card'
})

/** TASK-topup-min-currency — the QR minimum of **this account's currency** (USD → 10, same as the card channel) */
const qrMin = computed(() => topupQrMinAmount(topupOptions.value, props.balanceCurrency))

const localError = computed(() =>
  isCard.value
    ? topupAmountError(amount.value, { channel: 'card', currency: props.balanceCurrency, limit: cardLimit.value })
    : topupAmountError(amount.value, { qrMin: qrMin.value, currency: props.balanceCurrency })
)
const errorText = computed(() => serverError.value ?? (touched.value ? localError.value : null))
/** QR selected while closed for this currency (both channels blocked) → nothing can be sent */
const channelBlocked = computed(() => (isCard.value ? cardBlocked.value : qrBlocked.value) !== null)
const canSubmit = computed(() => !submitting.value && !props.disabled && localError.value === null && !channelBlocked.value)

/** the amount label says which currency is being typed — for both channels once the account's currency is known */
const amountLabel = computed(() =>
  props.balanceCurrency && props.balanceCurrency.toUpperCase() !== 'THB'
    ? `จำนวนเงิน (${props.balanceCurrency.toUpperCase()})`
    : 'จำนวนเงิน (บาท)'
)

/**
 * `min` of the number input is also the browser's own constraint: with a THB minimum left in place a valid USD
 * amount (10) would be refused by the browser before the handler ever runs — for QR and card alike.
 */
const amountMin = computed(() => {
  if (!isCard.value) return qrMin.value
  return cardLimit.value?.min ?? 1
})

watch(open, (isOpen) => {
  if (!isOpen) {
    // the next open reads the limits again (the cap moves with every round somebody pays)
    resetOptions()
    return
  }
  amount.value = props.defaultAmount
  serverError.value = null
  touched.value = false
  channel.value = startChannel()
  // FEAT-053 — exactly one `GET /topups/options` per open
  void loadOptions(props.tiktokAccountId)
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
      :icon="qrBlocked ? 'i-lucide-credit-card' : 'i-lucide-qr-code'"
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

        <!--
          FEAT-053 (AC-22) — how much of the account's per-day card cap is left. Rendered **only** when
          `GET /topups/options` answered and that currency has a `maxPerDay`; no cap / no answer = no element.
        -->
        <p
          v-if="remainingToday !== null"
          class="text-xs tabular-nums text-muted"
          :data-testid="`${prefix}-remaining-today`"
          :data-remaining="remainingToday"
          :data-currency="balanceCurrency ?? ''"
        >
          {{ remainingTodayText(remainingToday, balanceCurrency) }}
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
            <!-- TASK-topup-qr-usd — QR is closed for a USD account; the reason is the API's own text -->
            <UTooltip :text="qrBlocked ?? 'QR code ของบัญชีนี้'">
              <UButton
                label="QR"
                icon="i-lucide-qr-code"
                size="xs"
                block
                role="radio"
                :aria-checked="!isCard"
                :color="!isCard ? 'primary' : 'neutral'"
                :variant="!isCard ? 'solid' : 'outline'"
                :disabled="!!qrBlocked"
                data-testid="ta-adv-topup-channel-qr"
                @click="selectChannel('qr')"
              />
            </UTooltip>
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
          <p v-if="qrBlocked" class="text-xs text-warning" data-testid="ta-adv-topup-channel-qr-reason">
            {{ qrBlocked }}
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
          :disabled="!!qrBlocked"
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
