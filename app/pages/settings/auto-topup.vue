<script setup lang="ts">
/**
 * FEAT-030 — **system** auto top-up settings (api-contract.md v1 §4/§5/§7/§8, spec "UI behaviour").
 *
 * GOD only — `god-only` sends everybody else home with the "Not allowed" toast and the tab is hidden in
 * `app/pages/settings.vue`; the API (`@Roles('GOD')`) stays the authority.
 *
 * Exactly one `GET /backend/settings/auto-topup` per mount / Retry and exactly one
 * `PATCH /backend/settings/auto-topup` per Save (`retry: 0` on both). The controls are a **draft**: Save is
 * disabled until the draft differs from the saved values, client zod blocks a bad value **without a request**, and
 * the 200 body re-seeds the draft so Save goes quiet again.
 *
 * The API stores the cooldown in **milliseconds**, the page shows whole **minutes** (spec AS-4):
 * `Math.round(cooldownMs / 60000)` on load, `× 60000` on save — a value that is not a whole minute (written
 * directly in Mongo) displays rounded and would be saved rounded.
 *
 * History: TASK-autotopup-currency (2026-10-16, contract v2) moved `minBalance`/`amount` from the top level into a
 * per-currency `rules` map, one `st-autotopup-rule-<CUR>` card each.
 * FEAT-075 (api-contract v1 §1.2/§4, spec "UI behaviour", AC-17) — those amounts moved **onto each TikTok
 * account** (`autoTopupConfig`, set from the account's Edit modal), so this page is down to what is really
 * system-wide: the master switch and the cooldown. `rules` / `minAmounts` are gone from the view, from the body
 * (`{ enabled, cooldownMs }` — the API answers 400 `ไม่รู้จัก field "rules"` for anything else), from the client
 * validation (only the cooldown is left) and from the DOM (no `st-autotopup-rule-*` / `st-autotopup-min-*` /
 * `st-autotopup-amount-*` any more); `st-autotopup-per-account-note` says where the numbers live now.
 * `enabled: true` needs no numbers.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AutoTopupSettings, AutoTopupSettingsBody } from '#shared/types/settings'

definePageMeta({ middleware: 'god-only' })

useSeoMeta({ title: 'Auto top-up settings' })

/** §8 — BO client validation texts (the API's 400 body stays the authority for everything it rejects) */
const COOLDOWN_MESSAGE = 'cooldown ต้องเป็นจำนวนเต็ม ≥ 0 นาที'
const SAVE_FALLBACK = 'บันทึกการตั้งค่าไม่สำเร็จ'
const LOAD_FALLBACK = 'โหลดการตั้งค่าไม่สำเร็จ'
/** FEAT-075 — where `ยอดต่ำกว่า` / `เติมครั้งละ` live since the rules left this page */
const PER_ACCOUNT_NOTE = 'ยอดต่ำกว่า / เติมครั้งละ ตั้งที่หน้า TikTok accounts (ปุ่ม Edit ของแต่ละบัญชี)'

const MS_PER_MINUTE = 60_000

const api = useApi()
const toast = useToast()

type PageState = 'loading' | 'ready' | 'error'

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

const draft = reactive({
  enabled: false,
  cooldown: ''
})

/** the draft as the saved values would spell it — the dirty check and the re-seed share this shape */
const savedDraft = computed(() => ({
  enabled: saved.value?.enabled ?? false,
  cooldown: saved.value ? String(Math.round(saved.value.cooldownMs / MS_PER_MINUTE)) : ''
}))

function seed() {
  const next = savedDraft.value
  draft.enabled = next.enabled
  draft.cooldown = next.cooldown
}

const dirty = computed(() =>
  draft.enabled !== savedDraft.value.enabled
  || draft.cooldown.trim() !== savedDraft.value.cooldown
)

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
/** the cooldown has no "empty" state: a blank field is the same client error as a bad one */
function toNumber(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return Number.NaN
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : Number.NaN
}

/** mirrors the API's zod (§4): two keys, and `enabled: true` needs nothing else since FEAT-075 */
const schema = z.object({
  enabled: z.boolean(),
  cooldownMinutes: z.number({ error: COOLDOWN_MESSAGE }).int(COOLDOWN_MESSAGE).min(0, COOLDOWN_MESSAGE)
})

async function save() {
  if (saving.value || pageState.value !== 'ready') return

  const parsed = schema.safeParse({
    enabled: draft.enabled,
    cooldownMinutes: toNumber(draft.cooldown)
  })
  if (!parsed.success) {
    // client error → no request at all
    errorMessage.value = parsed.error.issues.map(i => i.message).join(' · ')
    return
  }

  const body: AutoTopupSettingsBody = {
    enabled: parsed.data.enabled,
    cooldownMs: parsed.data.cooldownMinutes * MS_PER_MINUTE
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
        description="สวิตช์รวมของระบบ · ปิด = ไม่มีบัญชีไหนเติมอัตโนมัติ"
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

        <!-- FEAT-075 — the per-currency rule cards left this page; this is where the numbers live now -->
        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :description="PER_ACCOUNT_NOTE"
          data-testid="st-autotopup-per-account-note"
        />

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
