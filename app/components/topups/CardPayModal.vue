<script setup lang="ts">
/**
 * FEAT-051 (AC-32/AC-33, spec "UI behaviour", proposal §4.1) — "จ่ายด้วยบัตร": the second step of the pay
 * popover. The amount was typed in the popover, this modal only decides **which card** and whether the round is
 * paid right away or left for somebody else to approve, and then runs exactly one create request:
 *
 *   advertiser level → `POST /topups`           `{ tiktokAccountId, advertiserId, amount, channel: 'card', … }`
 *   account level    → `POST /topups/accounts`  `{ tiktokAccountIds: [id], amount, channel: 'card', … }`
 *
 * Two faces (api-contract §1/§7):
 *   - the account has a usable card → one line `Mastercard ****9706 · NAME (10/29)` + "ใช้บัตรใบอื่น";
 *     the request carries `cardId` only.
 *   - no card yet (or "ใช้บัตรใบอื่น") → the 4 fields, sent **once** as `card: { number, expiry, cvv, holderName }`.
 *
 * **Secrets (AC-24/AC-25/AC-36).** The four values exist in the inputs and in the body of that one request and
 * nowhere else: `autocomplete="off"` on every field, no `data-*` attribute, no `console`, no `localStorage`, no
 * toast, no query string, and every field is wiped the moment the modal closes (and right after a successful
 * create). The confirm dialog and this modal only ever print the **last 4 digits**.
 *
 * The client-side validation is a hint that saves a round trip; whatever the API answers (400 / 409 / 503) is
 * shown **with the API's own text** in `tp-card-error` and the modal stays open so the admin can fix it.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PaymentCardView, PaymentCardsResponse } from '#shared/types/payment-cards'
import type { AccountTopupBody, AccountTopupResponse, TopupCardInput, TopupCreateBody, TopupCreateResponse, TopupView } from '#shared/types/topups'

const props = withDefaults(defineProps<{
  tiktokAccountId: string
  /** null → an account-level (BC) round */
  advertiserId: string | null
  /** the integer amount typed in the popover */
  amount: number | null
  /** `balanceCurrency` of the account; null/'' = unknown (the API decides, AC-5) */
  currency?: string | null
  /** advertiser name, BC name or account label — shown in the header and in the confirm dialog */
  accountName?: string
}>(), {
  currency: null,
  accountName: ''
})

const emit = defineEmits<{
  /** the round was created (`paying` or `pendingApproval`) — the surfaces refresh / patch their row */
  created: [topup: TopupView]
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()

const modalContent = { 'data-testid': 'tp-card-modal' } as ModalProps['content']

// ── saved cards (one GET per open) ───────────────────────────────────────────────────────────────────────────────────
const cards = ref<PaymentCardView[]>([])
const cardsPending = ref(false)
const cardsError = ref<string | null>(null)
/** "ใช้บัตรใบอื่น" — show the form even though a card is remembered */
const useOther = ref(false)
let cardsSession = 0

const savedCard = computed(() => pickDefaultCard(cards.value))
const showForm = computed(() => useOther.value || savedCard.value === null)

async function loadCards() {
  const session = ++cardsSession
  cardsPending.value = true
  cardsError.value = null
  try {
    // retry: 0 — one read per open
    const res = await api<PaymentCardsResponse>(
      `/tiktok-accounts/${encodeURIComponent(props.tiktokAccountId)}/payment-cards`,
      { retry: 0 }
    )
    if (session !== cardsSession) return
    cards.value = res.cards ?? []
  } catch (e) {
    if (session !== cardsSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    cards.value = []
    // not fatal: the admin can still type a card — the form is what they get
    cardsError.value = err.data?.error ?? err.message ?? 'อ่านบัตรที่จำไว้ไม่สำเร็จ'
  } finally {
    if (session === cardsSession) cardsPending.value = false
  }
}

// ── the form ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** ★ the only place the typed card lives; wiped by `resetForm()` on every close and after a successful create */
const form = reactive({ number: '', expiry: '', cvv: '', holderName: '' })
const touched = ref(false)
const later = ref(false)
const serverError = ref<string | null>(null)
const submitting = ref(false)
const confirmOpen = ref(false)

function resetForm() {
  form.number = ''
  form.expiry = ''
  form.cvv = ''
  form.holderName = ''
  touched.value = false
}

const numberError = computed(() => cardNumberError(form.number))
const expiryError = computed(() => cardExpiryError(form.expiry))
const cvvError = computed(() => cardCvvError(form.cvv))
const holderError = computed(() => cardHolderError(form.holderName))
const formValid = computed(() => !numberError.value && !expiryError.value && !cvvError.value && !holderError.value)

/** brand hint next to the number field — derived in the browser, never sent */
const typedBrand = computed(() => cardBrandFromNumber(form.number))

const last4 = computed(() => showForm.value ? cardLast4FromNumber(form.number) : (savedCard.value?.last4 ?? ''))
const confirmCardText = computed(() => showForm.value
  ? (typedBrand.value ? `${cardBrandLabel(typedBrand.value)} ${cardMask(last4.value)}` : '')
  : cardSummary(savedCard.value))

const amountText = computed(() => {
  const value = formatInt(props.amount)
  return props.currency ? `${value} ${props.currency}` : value
})

/** expiry typed as digits becomes `MM/YY` while typing — the value sent is always `MM/YY` */
function onExpiryInput(value: string | number) {
  const digits = onlyDigits(String(value)).slice(0, 4)
  form.expiry = digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits
}

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
    serverError.value = null
    later.value = false
    useOther.value = false
    confirmOpen.value = false
    cards.value = []
    void loadCards()
  } else {
    // ★ nothing of the card survives a closed modal
    resetForm()
    cardsSession++
    serverError.value = null
    confirmOpen.value = false
  }
})

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** "จ่ายเงิน" validates locally and opens the confirm dialog; **no request leaves here** (AC-33) */
function askConfirm() {
  touched.value = true
  serverError.value = null
  if (showForm.value && !formValid.value) return
  confirmOpen.value = true
}

function channelBody(): TopupCardInput | string {
  if (!showForm.value && savedCard.value) return savedCard.value.cardId
  return {
    number: onlyDigits(form.number),
    expiry: form.expiry.trim(),
    cvv: onlyDigits(form.cvv),
    holderName: form.holderName.trim()
  }
}

/** the one request of this modal — fired by the confirm dialog, `retry: 0`, never twice */
async function submit() {
  if (submitting.value) return
  submitting.value = true
  serverError.value = null
  const payload = channelBody()
  const common = {
    channel: 'card' as const,
    approve: !later.value,
    ...(typeof payload === 'string' ? { cardId: payload } : { card: payload })
  }
  try {
    if (props.advertiserId === null) {
      const body: AccountTopupBody = {
        tiktokAccountIds: [props.tiktokAccountId],
        amount: props.amount as number,
        ...common
      }
      const res = await api<AccountTopupResponse>('/topups/accounts', { method: 'POST', retry: 0, body })
      const row = res.results?.[0]
      if (!row?.ok || !row.topup) {
        serverError.value = row?.error ?? 'ทำรายการไม่สำเร็จ'
        return
      }
      succeed(row.topup)
      return
    }
    const body: TopupCreateBody = {
      tiktokAccountId: props.tiktokAccountId,
      advertiserId: props.advertiserId,
      amount: props.amount as number,
      ...common
    }
    const res = await api<TopupCreateResponse>('/topups', { method: 'POST', retry: 0, body })
    succeed(res.topup)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    // the API's own Thai text, whatever the status (400 / 409 / 503 / anything else) — never rewritten here
    serverError.value = err.data?.error ?? err.message ?? 'ทำรายการไม่สำเร็จ'
  } finally {
    submitting.value = false
  }
}

function succeed(topup: TopupView) {
  // ★ the card values go before anything else happens
  resetForm()
  confirmOpen.value = false
  open.value = false
  toast.add({
    'title': later.value ? 'สร้างรอบรออนุมัติแล้ว' : 'สั่งจ่ายด้วยบัตรแล้ว',
    'description': `${amountText.value} · ${props.accountName}`,
    'color': 'success',
    'data-testid': 'ta-toast'
  } as Parameters<typeof toast.add>[0])
  emit('created', topup)
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="จ่ายด้วยบัตรเครดิต/เดบิต"
    :description="accountName || undefined"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <!-- amount + currency of the account (spec: หัวบอกบัญชี + ยอด + สกุลเงิน) -->
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-elevated/50 px-3 py-2">
          <span class="min-w-0 text-sm break-words text-muted" data-testid="tp-card-account">{{ accountName || '—' }}</span>
          <span
            class="text-base font-semibold tabular-nums whitespace-nowrap text-highlighted"
            data-testid="tp-card-amount"
            :data-currency="currency ?? ''"
          >{{ amountText }}</span>
        </div>

        <USkeleton v-if="cardsPending" class="h-10 w-full" data-testid="tp-card-loading" />

        <UAlert
          v-else-if="cardsError"
          color="warning"
          variant="subtle"
          icon="i-lucide-credit-card"
          title="อ่านบัตรที่จำไว้ไม่สำเร็จ"
          :description="cardsError"
          data-testid="tp-card-cards-error"
        />

        <!-- a remembered card: one line, no form (AC-32) -->
        <div v-if="!cardsPending && !showForm" class="flex flex-wrap items-center justify-between gap-2">
          <span
            class="inline-flex min-w-0 items-center gap-2 text-sm font-medium break-words text-highlighted"
            data-testid="tp-card-saved"
            :data-card-id="savedCard?.cardId ?? ''"
          >
            <UIcon name="i-lucide-credit-card" class="size-4 shrink-0 text-muted" />
            {{ cardSummary(savedCard) }}
          </span>
          <UButton
            label="ใช้บัตรใบอื่น"
            color="neutral"
            variant="link"
            size="xs"
            data-testid="tp-card-use-other"
            @click="useOther = true"
          />
        </div>

        <!-- first payment of this account (or "ใช้บัตรใบอื่น"): the 4 fields, sent once -->
        <form
          v-else-if="!cardsPending"
          class="flex flex-col gap-3"
          autocomplete="off"
          @submit.prevent="askConfirm"
        >
          <UFormField label="หมายเลขบัตร" :error="touched ? numberError ?? undefined : undefined">
            <UInput
              :model-value="form.number"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              maxlength="23"
              placeholder="0000 0000 0000 0000"
              class="w-full"
              :disabled="submitting"
              data-testid="tp-card-number"
              @update:model-value="form.number = String($event)"
              @blur="touched = true"
            >
              <template v-if="typedBrand" #trailing>
                <span class="text-xs whitespace-nowrap text-muted">{{ cardBrandLabel(typedBrand) }}</span>
              </template>
            </UInput>
          </UFormField>

          <div class="flex flex-wrap gap-3">
            <UFormField label="วันหมดอายุ (MM/YY)" class="min-w-32 flex-1" :error="touched ? expiryError ?? undefined : undefined">
              <UInput
                :model-value="form.expiry"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                maxlength="5"
                placeholder="MM/YY"
                class="w-full"
                :disabled="submitting"
                data-testid="tp-card-expiry"
                @update:model-value="onExpiryInput($event)"
                @blur="touched = true"
              />
            </UFormField>
            <UFormField label="CVV/CVC" class="min-w-24 flex-1" :error="touched ? cvvError ?? undefined : undefined">
              <UInput
                :model-value="form.cvv"
                type="password"
                inputmode="numeric"
                autocomplete="off"
                maxlength="4"
                placeholder="•••"
                class="w-full"
                :disabled="submitting"
                data-testid="tp-card-cvv"
                @update:model-value="form.cvv = onlyDigits(String($event))"
                @blur="touched = true"
              />
            </UFormField>
          </div>

          <UFormField label="ชื่อผู้ถือบัตร" :error="touched ? holderError ?? undefined : undefined">
            <UInput
              v-model="form.holderName"
              type="text"
              autocomplete="off"
              maxlength="64"
              placeholder="NARUTCHAI SOMBUN"
              class="w-full"
              :disabled="submitting"
              data-testid="tp-card-holder"
              @blur="touched = true"
            />
          </UFormField>

          <p class="text-xs text-muted">
            ระบบจะจำบัตรใบนี้ให้บัญชีนี้ ครั้งต่อไปเห็นแค่ 4 ตัวท้าย
          </p>
        </form>

        <UCheckbox
          v-model="later"
          label="ค้างไว้ให้คนอื่นอนุมัติ"
          description="ไม่ติ๊ก = จ่ายทันที · ติ๊ก = รอบนี้รอให้คนอื่นกดจ่ายเงินภายใน 24 ชั่วโมง"
          :disabled="submitting"
          data-testid="tp-card-later"
        />

        <UAlert
          v-if="serverError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="serverError"
          role="alert"
          data-testid="tp-card-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="tp-card-cancel"
            @click="open = false"
          />
          <UButton
            :label="later ? 'ถัดไป' : 'จ่ายเงิน'"
            icon="i-lucide-credit-card"
            color="primary"
            :loading="submitting"
            :disabled="cardsPending"
            data-testid="tp-card-submit"
            @click="askConfirm"
          />
        </div>
      </div>
    </template>
  </UModal>

  <!-- AC-33 — every payment goes through this dialog; cancelling it sends nothing -->
  <TopupsCardConfirmDialog
    v-model:open="confirmOpen"
    :amount="amount"
    :currency="currency"
    :account-name="accountName"
    :last4="last4"
    :card-summary-text="confirmCardText"
    :busy="submitting"
    :deferred="later"
    @confirm="submit"
  />
</template>
