<script setup lang="ts">
/**
 * FEAT-077 — `/settings/telegram` (spec "UI behaviour", api-contract v1 §3 / §10, AC-15).
 *
 * GOD only — `god-only` sends everybody else home with the "Not allowed" toast and the tab is hidden in
 * `app/pages/settings.vue`; the API (`@Roles('GOD')`) stays the authority.
 *
 * One switch for the whole Telegram QR-group feature. Exactly one `GET /backend/settings/telegram` per mount / Retry
 * and exactly one `PATCH /backend/settings/telegram { enabled }` per Save (`retry: 0` on both). The switch is a
 * **draft**: Save is disabled until it differs from the saved value, and the 200 body re-seeds it. The bot line says
 * whether the server has a token (`configured`) and whether Telegram answered `getMe` (`botUsername`) — the token
 * itself never reaches the BO. Groups are linked per prefix on `/settings/prefixes`.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { TelegramSettings, TelegramSettingsBody } from '#shared/types/settings'

definePageMeta({ middleware: 'god-only' })

useSeoMeta({ title: 'Telegram settings' })

const SAVE_FALLBACK = 'บันทึกการตั้งค่าไม่สำเร็จ'
const LOAD_FALLBACK = 'โหลดการตั้งค่าไม่สำเร็จ'
const NOTE = 'กลุ่มผูกที่หน้า Prefixes · รอบ QR ของบัญชีที่มี prefix ที่ผูกกลุ่มแล้วจะถูกส่งเข้ากลุ่ม · ช่องทางบัตรไม่เข้า Telegram'

const api = useApi()
const toast = useToast()

type PageState = 'loading' | 'ready' | 'error'

/** the values the API last confirmed; null while the first GET is pending or failed */
const saved = ref<TelegramSettings | null>(null)
const pending = ref(true)
const loadError = ref<string | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const pageState = computed<PageState>(() => {
  if (pending.value && saved.value === null) return 'loading'
  return loadError.value ? 'error' : 'ready'
})

const draft = reactive({ enabled: false })

function seed() {
  draft.enabled = saved.value?.enabled ?? false
}

const dirty = computed(() => draft.enabled !== (saved.value?.enabled ?? false))

/** the three states of `st-telegram-bot` (spec "UI behaviour") */
const botLine = computed<{ text: string, configured: boolean, reachable: boolean }>(() => {
  const s = saved.value
  if (!s?.configured) {
    return { text: 'ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN ที่เซิร์ฟเวอร์ — เปิดสวิตช์ได้แต่จะยังไม่ส่ง', configured: false, reachable: false }
  }
  if (!s.botUsername) return { text: 'ติดต่อ Telegram ไม่ได้ (getMe)', configured: true, reachable: false }
  return { text: `บอท @${s.botUsername}`, configured: true, reachable: true }
})

const updatedLine = computed(() =>
  saved.value?.updatedAt
    ? `แก้ไขล่าสุด ${formatDateTime(saved.value.updatedAt)}`
    : 'ยังไม่เคยตั้งค่า (ปิดอยู่)'
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
    const res = await api<TelegramSettings>('/settings/telegram', { retry: 0 })
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
async function save() {
  if (saving.value || pageState.value !== 'ready' || !dirty.value) return

  const body: TelegramSettingsBody = { enabled: draft.enabled }

  saving.value = true
  errorMessage.value = null
  try {
    // retry: 0 — exactly one PATCH per click
    const res = await api<TelegramSettings>('/settings/telegram', { method: 'PATCH', body, retry: 0 })
    saved.value = res
    seed()
    toast.add({ title: 'Telegram settings saved', icon: 'i-lucide-check', color: 'success' })
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
    data-testid="st-telegram-page"
    :data-state="pageState"
    :data-enabled="saved?.enabled ? 'true' : 'false'"
  >
    <div v-if="pageState === 'loading'" class="flex flex-col gap-4" data-testid="st-telegram-loading">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-40 w-full" />
    </div>

    <UAlert
      v-else-if="pageState === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดการตั้งค่าไม่สำเร็จ"
      role="alert"
      data-testid="st-telegram-load-error"
    >
      <template #description>
        <span class="break-words">{{ loadError ?? LOAD_FALLBACK }}</span>
      </template>
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          variant="solid"
          size="xs"
          :loading="pending"
          data-testid="st-telegram-retry"
          @click="load()"
        />
      </template>
    </UAlert>

    <form v-else @submit.prevent="save">
      <UPageCard
        title="Telegram"
        description="ส่ง QR เติมเงินเข้ากลุ่ม Telegram ของ prefix · ปิด = ทุกรอบจ่ายที่หน้า BO"
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
          data-testid="st-telegram-save"
        />
      </UPageCard>

      <div class="flex flex-col gap-4">
        <UPageCard variant="subtle">
          <UFormField
            name="enabled"
            description="เปิด = รอบ QR ของบัญชีที่ prefix ผูกกลุ่มแล้วจะถูกส่งไปจ่ายในกลุ่ม"
            class="flex max-sm:flex-col justify-between items-start gap-4"
          >
            <USwitch
              v-model="draft.enabled"
              label="Enabled"
              :disabled="saving"
              data-testid="st-telegram-enabled"
            />
          </UFormField>
          <USeparator />
          <p
            class="flex items-start gap-2 text-sm break-words"
            :class="botLine.reachable ? 'text-highlighted' : 'text-warning'"
            data-testid="st-telegram-bot"
            :data-configured="botLine.configured ? 'true' : 'false'"
          >
            <UIcon
              :name="botLine.reachable ? 'i-lucide-bot' : 'i-lucide-triangle-alert'"
              class="mt-0.5 size-4 shrink-0"
            />
            <span class="min-w-0">{{ botLine.text }}</span>
          </p>
        </UPageCard>

        <UAlert
          color="neutral"
          variant="subtle"
          icon="i-lucide-info"
          :description="NOTE"
          data-testid="st-telegram-note"
        />

        <div class="flex flex-col gap-2 px-1">
          <p
            v-if="errorMessage"
            class="text-sm break-words text-error"
            role="alert"
            data-testid="st-telegram-error"
          >
            {{ errorMessage }}
          </p>
          <span class="text-xs text-muted" data-testid="st-telegram-updated">{{ updatedLine }}</span>
        </div>
      </div>
    </form>
  </div>
</template>
