<script setup lang="ts">
/**
 * FEAT-029 — the **Auto top-up** block of one advertiser row in the advertisers slide-over
 * (api-contract.md v1 §5 `PATCH /advertisers/:id/auto-topup`, §7 `ta-adv-autotopup*`, spec "UI behaviour").
 *
 * The three controls are a **draft** owned by this component, so typing in one row never touches another and a
 * quiet re-read of the list (SSE polling fallback) never throws typed values away. Save sends exactly one
 * `PATCH` with **numbers** (`retry: 0`); the 200 body is the full advertiser view and is handed to the parent,
 * which replaces the row's `autoTopup` — this component re-seeds its draft from the saved values.
 *
 * Client zod mirrors the API's rules (integer `minBalance` ≥ 0, integer `amount` ≥ `TOPUP_MIN_AMOUNT`), so a bad
 * value is reported in `ta-adv-autotopup-error` **without a request**. With the switch off an empty field is sent
 * as `0` / `TOPUP_MIN_AMOUNT`, so the stored pair always stays valid. An admin without GOD / Payment sees every
 * control disabled with the title "เฉพาะ GOD / Payment" (the API answers 403 anyway).
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { Advertiser, AdvertiserAutoTopup, AdvertiserAutoTopupBody } from '#shared/types/advertisers'

const props = defineProps<{
  advertiser: Advertiser
  /** GOD / Payment — the only roles allowed to change money config (spec AS-8) */
  canConfigure: boolean
}>()

const emit = defineEmits<{
  /** `PATCH` answered 200 with the full advertiser view */
  updated: [advertiser: Advertiser]
}>()

const MIN_MESSAGE = 'min balance ต้องเป็นจำนวนเต็ม ≥ 0'
const AMOUNT_MESSAGE = `amount ต้องเป็นจำนวนเต็มตั้งแต่ ${TOPUP_MIN_AMOUNT} บาท`
const ROLE_TITLE = 'เฉพาะ GOD / Payment'

/** old rows (an API that predates the feature) read as "off, nothing configured" */
const EMPTY: AdvertiserAutoTopup = {
  enabled: false,
  minBalance: null,
  amount: null,
  lastTriggeredAt: null,
  lastRoundId: null
}

const api = useApi()
const toast = useToast()

const saved = computed<AdvertiserAutoTopup>(() => props.advertiser.autoTopup ?? EMPTY)

function numberText(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : ''
}

const state = reactive({
  enabled: saved.value.enabled,
  min: numberText(saved.value.minBalance),
  amount: numberText(saved.value.amount)
})

const savedSignature = computed(() => JSON.stringify([saved.value.enabled, saved.value.minBalance, saved.value.amount]))

// re-seed only when the **stored** triple really changed (our own save, or a reload that brings new values);
// an unchanged list re-read leaves the draft alone
watch(savedSignature, () => {
  state.enabled = saved.value.enabled
  state.min = numberText(saved.value.minBalance)
  state.amount = numberText(saved.value.amount)
})

const saving = ref(false)
const errorMessage = ref<string | null>(null)

const dirty = computed(() =>
  state.enabled !== saved.value.enabled
  || state.min.trim() !== numberText(saved.value.minBalance)
  || state.amount.trim() !== numberText(saved.value.amount)
)

const fieldsDisabled = computed(() => !props.canConfigure || !state.enabled || saving.value)
const roleTitle = computed(() => (props.canConfigure ? undefined : ROLE_TITLE))

const lastLine = computed(() =>
  saved.value.lastTriggeredAt ? `ทริกเกอร์ล่าสุด ${formatDateTime(saved.value.lastTriggeredAt)}` : 'ยังไม่เคยทริกเกอร์'
)

/** mirrors the API's zod (§5); the messages are the ones spec §8 lists for the BO */
const schema = z.object({
  enabled: z.boolean(),
  minBalance: z.number({ error: MIN_MESSAGE }).int(MIN_MESSAGE).min(0, MIN_MESSAGE),
  amount: z.number({ error: AMOUNT_MESSAGE }).int(AMOUNT_MESSAGE).min(TOPUP_MIN_AMOUNT, AMOUNT_MESSAGE)
})

/** empty field → `fallback`; anything that is not a finite number → NaN, which zod rejects with the right text */
function toNumber(text: string, fallback: number): number {
  const trimmed = text.trim()
  if (trimmed === '') return fallback
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

async function save() {
  if (!props.canConfigure || saving.value) return
  const candidate = {
    enabled: state.enabled,
    minBalance: toNumber(state.min, state.enabled ? Number.NaN : 0),
    amount: toNumber(state.amount, state.enabled ? Number.NaN : TOPUP_MIN_AMOUNT)
  }
  const parsed = schema.safeParse(candidate)
  if (!parsed.success) {
    errorMessage.value = parsed.error.issues.map(i => i.message).join(' · ')
    return
  }

  const body: AdvertiserAutoTopupBody = parsed.data
  saving.value = true
  errorMessage.value = null
  try {
    // retry: 0 — exactly one PATCH per click
    const updated = await api<Advertiser>(`/advertisers/${encodeURIComponent(props.advertiser.id)}/auto-topup`, {
      method: 'PATCH',
      body,
      retry: 0
    })
    emit('updated', updated)
    // the parent may be showing another object (list replaced meanwhile) — seed the draft from the answer as well
    const next = updated.autoTopup ?? EMPTY
    state.enabled = next.enabled
    state.min = numberText(next.minBalance)
    state.amount = numberText(next.amount)
    toast.add({ title: 'Auto top-up saved', description: props.advertiser.name, color: 'success' })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
    errorMessage.value = issues.length
      ? issues.join(' · ')
      : err.data?.error ?? err.message ?? 'บันทึก auto top-up ไม่สำเร็จ'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded-md border border-default p-2"
    data-testid="ta-adv-autotopup"
    :data-enabled="saved.enabled ? 'true' : 'false'"
  >
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <USwitch
        v-model="state.enabled"
        label="Auto top-up"
        :disabled="!canConfigure || saving"
        :title="roleTitle"
        data-testid="ta-adv-autotopup-switch"
      />
      <UInput
        v-model="state.min"
        type="text"
        inputmode="numeric"
        placeholder="min balance (฿)"
        size="xs"
        class="w-32"
        :disabled="fieldsDisabled"
        :title="roleTitle"
        aria-label="min balance"
        data-testid="ta-adv-autotopup-min"
      />
      <UInput
        v-model="state.amount"
        type="text"
        inputmode="numeric"
        placeholder="amount (฿)"
        size="xs"
        class="w-28"
        :disabled="fieldsDisabled"
        :title="roleTitle"
        aria-label="amount"
        data-testid="ta-adv-autotopup-amount"
      />
      <UButton
        label="Save"
        color="primary"
        variant="subtle"
        size="xs"
        :disabled="!canConfigure || !dirty"
        :loading="saving"
        :title="roleTitle"
        data-testid="ta-adv-autotopup-save"
        @click="save"
      />
    </div>
    <p
      v-if="errorMessage"
      class="text-xs break-words text-error"
      role="alert"
      data-testid="ta-adv-autotopup-error"
    >
      {{ errorMessage }}
    </p>
    <span
      class="text-xs text-muted"
      data-testid="ta-adv-autotopup-last"
      :data-at="saved.lastTriggeredAt ?? ''"
    >
      {{ lastLine }}
    </span>
  </div>
</template>
