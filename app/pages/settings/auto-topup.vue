<script setup lang="ts">
/**
 * FEAT-030 — **system** auto top-up settings (api-contract.md v1 §4/§5/§7/§8, spec "UI behaviour").
 *
 * One rule for every launching advertiser, replacing the per-advertiser block of FEAT-029: `enabled`, a
 * per-currency `minBalance`/`amount` rule and the cooldown. GOD only — `god-only` sends everybody else home
 * with the "Not allowed" toast and the tab is hidden in `app/pages/settings.vue`; the API (`@Roles('GOD')`)
 * stays the authority.
 *
 * Exactly one `GET /backend/settings/auto-topup` per mount / Retry and exactly one
 * `PATCH /backend/settings/auto-topup` per Save (`retry: 0` on both). The controls are a **draft**: Save is
 * disabled until the draft differs from the saved values, client zod (the §8 BO texts) blocks a bad value
 * **without a request**, and the 200 body re-seeds the draft so Save goes quiet again.
 *
 * The API stores the cooldown in **milliseconds**, the page shows whole **minutes** (spec AS-4):
 * `Math.round(cooldownMs / 60000)` on load, `× 60000` on save — a value that is not a whole minute (written
 * directly in Mongo) displays rounded and would be saved rounded.
 *
 * TASK-autotopup-currency (2026-10-16, contract v2) — `minBalance`/`amount` move from the top level into a
 * `rules` map, one entry per supported currency (`Object.keys(res.rules)`, the API's table order — `USD`,
 * `THB` with the defaults). The draft holds one `{ min, amount }` text pair per currency instead of a single
 * pair; `currencies` (derived from the last GET/PATCH response) decides which sections render, drives the
 * dirty check and the re-seed, and is rebuilt from scratch on every 200 — a response can list a different
 * currency set than the one the page opened with.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AutoTopupRule, AutoTopupSettings, AutoTopupSettingsBody } from '#shared/types/settings'

definePageMeta({ middleware: 'god-only' })

useSeoMeta({ title: 'Auto top-up settings' })

/** §8 — BO client validation texts (the API's 400 body stays the authority for everything it rejects) */
const COOLDOWN_MESSAGE = 'cooldown ต้องเป็นจำนวนเต็ม ≥ 0 นาที'
const ENABLED_MESSAGE = 'ต้องตั้ง min balance และ amount อย่างน้อยหนึ่งสกุลเงินก่อนเปิดใช้งาน'
const SAVE_FALLBACK = 'บันทึกการตั้งค่าไม่สำเร็จ'
const LOAD_FALLBACK = 'โหลดการตั้งค่าไม่สำเร็จ'

function minBalanceMessage(currency: string): string {
  return `min balance ของ ${currency} ต้องเป็นจำนวนเต็ม ≥ 0`
}

function amountMessage(currency: string, minAmount: number): string {
  return `amount ของ ${currency} ต้องเป็นจำนวนเต็มตั้งแต่ ${minAmount} ${topupQrUnit(currency)}`
}

function pairMessage(currency: string): string {
  return `ต้องตั้ง min balance และ amount ของ ${currency} ให้ครบคู่`
}

const MS_PER_MINUTE = 60_000

const api = useApi()
const toast = useToast()

type PageState = 'loading' | 'ready' | 'error'
interface RuleDraft { min: string, amount: string }

/** the values the API last confirmed; null while the first GET is pending or failed */
const saved = ref<AutoTopupSettings | null>(null)
const pending = ref(true)
const loadError = ref<string | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const pageState = computed<PageState>(() => {
  if (pending.value && saved.value === null) return 'loading'
  return loadError.value ? 'error' : 'ready'
})

/** every supported currency, in the order the last GET/PATCH sent them (`Object.keys(rules)`, table order) */
const currencies = computed<string[]>(() => Object.keys(saved.value?.rules ?? {}))

/** read-only per-currency floor of `amount` — the hint next to the Amount field */
const minAmounts = computed<Record<string, number>>(() => saved.value?.minAmounts ?? {})

const draft = reactive({
  enabled: false,
  cooldown: '',
  rules: {} as Record<string, RuleDraft>
})

function numberText(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : ''
}

function savedRuleDraft(rule: AutoTopupRule | undefined): RuleDraft {
  return { min: numberText(rule?.minBalance), amount: numberText(rule?.amount) }
}

/**
 * the draft pair of one currency — `seed()` always creates one for every currency of `currencies`, this is
 * only a defensive fallback (and keeps the template's `v-model` free of `possibly undefined` from TS)
 */
function ruleOf(currency: string): RuleDraft {
  return draft.rules[currency] ?? (draft.rules[currency] = { min: '', amount: '' })
}

/** the draft as the saved values would spell it — the dirty check and the re-seed share this shape */
const savedDraft = computed(() => {
  const rules: Record<string, RuleDraft> = {}
  for (const currency of currencies.value) {
    rules[currency] = savedRuleDraft(saved.value?.rules?.[currency])
  }
  return {
    enabled: saved.value?.enabled ?? false,
    cooldown: saved.value ? String(Math.round(saved.value.cooldownMs / MS_PER_MINUTE)) : '',
    rules
  }
})

function seed() {
  const next = savedDraft.value
  draft.enabled = next.enabled
  draft.cooldown = next.cooldown
  // fresh objects per currency — never share a reference with `savedDraft`'s own computed cache
  draft.rules = Object.fromEntries(
    Object.entries(next.rules).map(([currency, rule]) => [currency, { ...rule }])
  )
}

const dirty = computed(() => {
  if (draft.enabled !== savedDraft.value.enabled) return true
  if (draft.cooldown.trim() !== savedDraft.value.cooldown) return true
  return currencies.value.some((currency) => {
    const d = draft.rules[currency] ?? { min: '', amount: '' }
    const s = savedDraft.value.rules[currency] ?? { min: '', amount: '' }
    return d.min.trim() !== s.min || d.amount.trim() !== s.amount
  })
})

const updatedLine = computed(() =>
  saved.value?.updatedAt
    ? `แก้ไขล่าสุด ${formatDateTime(saved.value.updatedAt)}`
    : 'ยังไม่เคยตั้งค่า (ใช้ค่าเริ่มต้น)'
)

// ── load ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
// bumped on every request so a late answer of a superseded GET is dropped
let session = 0

async function load() {
  const s = ++session
  pending.value = true
  loadError.value = null
  try {
    // retry: 0 — exactly one GET per mount / Retry click
    const res = await api<AutoTopupSettings>('/settings/auto-topup', { retry: 0 })
    if (s !== session) return
    saved.value = res
    errorMessage.value = null
    seed()
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    saved.value = null
    loadError.value = err.data?.error ?? err.message ?? LOAD_FALLBACK
  } finally {
    if (s === session) pending.value = false
  }
}

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

// ── save ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** empty → `null` (allowed while both fields of the currency are blank); not a finite number → NaN, zod rejects */
function toNumberOrNull(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

/** the cooldown has no "empty" state: a blank field is the same client error as a bad one */
function toNumber(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return Number.NaN
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

/** mirrors the API's zod (§5) with the BO texts of §8 — one currency's `{ minBalance, amount }` pair */
function ruleSchema(currency: string) {
  const minAmount = minAmounts.value[currency] ?? 0
  const minMsg = minBalanceMessage(currency)
  const amtMsg = amountMessage(currency, minAmount)
  return z.object({
    minBalance: z.number({ error: minMsg }).int(minMsg).min(0, minMsg).nullable(),
    amount: z.number({ error: amtMsg }).int(amtMsg).min(minAmount, amtMsg).nullable()
  }).refine(v => (v.minBalance === null) === (v.amount === null), { message: pairMessage(currency) })
}

/** built fresh on every Save so it always matches the currency list of the last GET/PATCH */
function buildSchema() {
  const shape: Record<string, ReturnType<typeof ruleSchema>> = {}
  for (const currency of currencies.value) shape[currency] = ruleSchema(currency)
  return z.object({
    enabled: z.boolean(),
    cooldownMinutes: z.number({ error: COOLDOWN_MESSAGE }).int(COOLDOWN_MESSAGE).min(0, COOLDOWN_MESSAGE),
    rules: z.object(shape)
  }).refine(v => !v.enabled || Object.values(v.rules).some(r => r.minBalance !== null && r.amount !== null), {
    message: ENABLED_MESSAGE,
    path: ['enabled']
  })
}

async function save() {
  if (saving.value || pageState.value !== 'ready') return

  const parsed = buildSchema().safeParse({
    enabled: draft.enabled,
    cooldownMinutes: toNumber(draft.cooldown),
    rules: Object.fromEntries(currencies.value.map((currency) => {
      const rule = draft.rules[currency] ?? { min: '', amount: '' }
      return [currency, { minBalance: toNumberOrNull(rule.min), amount: toNumberOrNull(rule.amount) }]
    }))
  })
  if (!parsed.success) {
    // client error → no request at all
    errorMessage.value = parsed.error.issues.map(i => i.message).join(' · ')
    return
  }

  const body: AutoTopupSettingsBody = {
    enabled: parsed.data.enabled,
    cooldownMs: parsed.data.cooldownMinutes * MS_PER_MINUTE,
    rules: parsed.data.rules
  }

  saving.value = true
  errorMessage.value = null
  try {
    // retry: 0 — exactly one PATCH per click
    const res = await api<AutoTopupSettings>('/settings/auto-topup', { method: 'PATCH', body, retry: 0 })
    saved.value = res
    seed()
    toast.add({ title: 'Auto top-up settings saved', icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
    errorMessage.value = issues.length ? issues.join(' · ') : err.data?.error ?? SAVE_FALLBACK
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div
    data-testid="st-autotopup-page"
    :data-state="pageState"
    :data-enabled="saved?.enabled ? 'true' : 'false'"
  >
    <!-- loading: the GET of the first mount (or of a Retry that follows a failure) -->
    <div v-if="pageState === 'loading'" class="flex flex-col gap-4" data-testid="st-autotopup-loading">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-56 w-full" />
    </div>

    <UAlert
      v-else-if="pageState === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดการตั้งค่าไม่สำเร็จ"
      :description="loadError ?? LOAD_FALLBACK"
      role="alert"
      data-testid="st-autotopup-load-error"
    >
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          variant="solid"
          size="xs"
          :loading="pending"
          data-testid="st-autotopup-retry"
          @click="load()"
        />
      </template>
    </UAlert>

    <form v-else @submit.prevent="save">
      <UPageCard
        title="Auto top-up"
        description="กติกาเดียวสำหรับทุก advertiser ที่กำลังยิงโฆษณา · ระบบสร้างรอบและขอ QR เท่านั้น ไม่จ่ายเงินเอง"
        variant="naked"
        orientation="horizontal"
        class="mb-4"
      >
        <UButton
          type="submit"
          label="Save"
          color="neutral"
          class="w-fit lg:ms-auto"
          :disabled="!dirty"
          :loading="saving"
          data-testid="st-autotopup-save"
        />
      </UPageCard>

      <div class="flex flex-col gap-4">
        <UPageCard variant="subtle">
          <UFormField
            name="enabled"
            description="ปิดอยู่ = job kpi ไม่สร้างรอบเติมเงินอัตโนมัติให้ใครเลย"
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <USwitch
              v-model="draft.enabled"
              label="Enabled"
              :disabled="saving"
              data-testid="st-autotopup-enabled"
            />
          </UFormField>
          <USeparator />
          <UFormField
            name="cooldown"
            label="Cooldown (minutes)"
            description="ระยะพักระหว่างสองรอบของ advertiser เดียวกัน · 0 = ไม่พัก"
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <UInput
              v-model="draft.cooldown"
              type="text"
              inputmode="numeric"
              placeholder="360"
              autocomplete="off"
              :disabled="saving"
              data-testid="st-autotopup-cooldown"
            />
          </UFormField>
        </UPageCard>

        <UPageCard
          v-for="currency in currencies"
          :key="currency"
          :title="currency"
          variant="subtle"
          :data-testid="`st-autotopup-rule-${currency}`"
          :data-currency="currency"
        >
          <UFormField
            :name="`min-${currency}`"
            :label="`Min balance (${currency})`"
            description="ยอดต่ำกว่านี้จึงเติม"
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <UInput
              v-model="ruleOf(currency).min"
              type="text"
              inputmode="numeric"
              placeholder="500"
              autocomplete="off"
              :disabled="saving"
              :data-testid="`st-autotopup-min-${currency}`"
            />
          </UFormField>
          <USeparator />
          <UFormField
            :name="`amount-${currency}`"
            :label="`Amount (${currency})`"
            :description="`จำนวนที่เติมต่อรอบ · ขั้นต่ำ ${minAmounts[currency] ?? ''}`"
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <UInput
              v-model="ruleOf(currency).amount"
              type="text"
              inputmode="numeric"
              placeholder="1000"
              autocomplete="off"
              :disabled="saving"
              :data-testid="`st-autotopup-amount-${currency}`"
            />
          </UFormField>
        </UPageCard>

        <div class="flex flex-col gap-2 px-1">
          <p
            v-if="errorMessage"
            class="text-sm break-words text-error"
            role="alert"
            data-testid="st-autotopup-error"
          >
            {{ errorMessage }}
          </p>
          <span class="text-xs text-muted" data-testid="st-autotopup-updated">{{ updatedLine }}</span>
        </div>
      </div>
    </form>
  </div>
</template>
