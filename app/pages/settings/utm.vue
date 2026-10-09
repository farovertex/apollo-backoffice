<script setup lang="ts">
/**
 * FEAT-038 — the global list of **UTM prefixes** an ad template may bind to (api-contract.md v1 §4, spec U3).
 *
 * A prefix becomes part of the 3rd-party UTM host (`https://<md5(prefix)><suffix>`), so it is case-sensitive
 * and may not contain whitespace. GOD only — `god-only` sends everybody else home with the "Not allowed"
 * toast and the tab is hidden in `app/pages/settings.vue`; the API (`@Roles('GOD')` on the PATCH) stays the
 * authority. `GET /settings/utm` is Admin-readable for the API's own consumers, which does not open this page.
 *
 * Exactly one `GET /backend/settings/utm` per mount / Retry, and exactly one
 * `PATCH /backend/settings/utm { prefixes }` per add / remove (`retry: 0` on both) — there is no Save button:
 * every chip change is written immediately with the **complete** new list and the 200 body re-seeds the state.
 * A client-side refusal (empty, whitespace inside, already in the list) shows the inline error and sends
 * **nothing**. When a removed prefix is still used by an ad template the 200 body says so in `inUse` → info
 * alert: those templates keep working, but their next save with `utm` has to pick a listed prefix (AS-5).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { UtmSettings, UtmSettingsBody, UtmSettingsPatchResponse } from '#shared/types/settings'

definePageMeta({ middleware: 'god-only' })

useSeoMeta({ title: 'UTM prefixes' })

/** client texts; the API's 400 body stays the authority for everything it rejects (api-contract §4.3) */
const EMPTY_MESSAGE = 'ต้องไม่ว่าง'
const WHITESPACE_MESSAGE = 'prefix ต้องไม่มีช่องว่าง'
const DUPLICATE_MESSAGE = 'prefix ซ้ำกัน'
const TOO_LONG_MESSAGE = `prefix ยาวเกิน ${UTM_PREFIX_MAX_LENGTH} ตัว`
const SAVE_FALLBACK = 'บันทึกรายการ Prefix ไม่สำเร็จ'
const LOAD_FALLBACK = 'โหลดรายการ Prefix ไม่สำเร็จ'

const api = useApi()
const toast = useToast()

type PageState = 'loading' | 'ready' | 'error'

/** the list the API last confirmed; null while the first GET is pending or failed */
const saved = ref<UtmSettings | null>(null)
const pending = ref(true)
const loadError = ref<string | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
/** prefixes that this PATCH removed while an ad template still binds to them (`inUse` of the 200 body) */
const inUse = ref<string[]>([])
const draft = ref('')

const pageState = computed<PageState>(() => {
  if (pending.value && saved.value === null) return 'loading'
  return loadError.value ? 'error' : 'ready'
})

const prefixes = computed<string[]>(() => saved.value?.prefixes ?? [])

const updatedLine = computed(() =>
  saved.value?.updatedAt
    ? `แก้ไขล่าสุด ${formatDateTime(saved.value.updatedAt)}`
    : 'ยังไม่เคยตั้งค่า'
)

const inUseLine = computed(() =>
  inUse.value.length
    ? `Prefix ${inUse.value.join(', ')} ยังถูกใช้ใน ad template — template เดิมยังใช้งานได้ แต่ต้องเลือก Prefix ใหม่เมื่อบันทึกครั้งหน้า`
    : ''
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
    const res = await api<UtmSettings>('/settings/utm', { retry: 0 })
    if (s !== session) return
    saved.value = res
    errorMessage.value = null
    inUse.value = []
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

// ── write (one PATCH per add / remove, always the complete list) ─────────────────────────────────────────────────────
async function patch(next: string[], removed: string | null) {
  if (saving.value || pageState.value !== 'ready') return
  saving.value = true
  errorMessage.value = null
  inUse.value = []
  const body: UtmSettingsBody = { prefixes: next }
  try {
    // retry: 0 — exactly one PATCH per click / Enter
    const res = await api<UtmSettingsPatchResponse>('/settings/utm', { method: 'PATCH', body, retry: 0 })
    // the 200 body is the new truth (order included) — never the optimistic local array
    saved.value = { prefixes: res.prefixes ?? [], updatedAt: res.updatedAt ?? null }
    inUse.value = res.inUse ?? []
    toast.add({
      title: removed ? 'Prefix removed' : 'Prefix added',
      description: removed ?? next[next.length - 1] ?? '',
      icon: 'i-lucide-check',
      color: 'success'
    })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
    errorMessage.value = issues.length ? issues.join(' · ') : err.data?.error ?? SAVE_FALLBACK
  } finally {
    saving.value = false
  }
}

/** client rules mirror api-contract §4.3 — a refusal here never reaches the network */
function add() {
  const value = draft.value.trim()
  if (value === '') {
    errorMessage.value = EMPTY_MESSAGE
    return
  }
  if (/\s/.test(value)) {
    errorMessage.value = WHITESPACE_MESSAGE
    return
  }
  if (value.length > UTM_PREFIX_MAX_LENGTH) {
    errorMessage.value = TOO_LONG_MESSAGE
    return
  }
  // case-sensitive, like the API and like the host rule
  if (prefixes.value.includes(value)) {
    errorMessage.value = DUPLICATE_MESSAGE
    return
  }
  draft.value = ''
  void patch([...prefixes.value, value], null)
}

function remove(prefix: string) {
  void patch(prefixes.value.filter(item => item !== prefix), prefix)
}
</script>

<template>
  <div
    data-testid="st-utm-page"
    :data-state="pageState"
    :data-count="prefixes.length"
  >
    <!-- loading: the GET of the first mount (or of a Retry that follows a failure) -->
    <div v-if="pageState === 'loading'" class="flex flex-col gap-4" data-testid="st-utm-loading">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-40 w-full" />
    </div>

    <UAlert
      v-else-if="pageState === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดรายการ Prefix ไม่สำเร็จ"
      role="alert"
      data-testid="st-utm-load-error"
    >
      <!-- the reason carries `st-utm-error` too: one test id for "the error text of this page", either state -->
      <template #description>
        <span class="break-words" data-testid="st-utm-error">{{ loadError ?? LOAD_FALLBACK }}</span>
      </template>
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          variant="solid"
          size="xs"
          :loading="pending"
          data-testid="st-utm-retry"
          @click="load()"
        />
      </template>
    </UAlert>

    <template v-else>
      <UPageCard
        title="UTM prefixes"
        description="รายการ Prefix ที่ผูก UTM ได้ · มีผลกับ host ของระบบปลายทาง (ตัวพิมพ์ใหญ่-เล็กต่างกัน)"
        variant="subtle"
      >
        <div class="flex flex-wrap items-center gap-2" data-testid="st-utm-list">
          <span
            v-for="prefix in prefixes"
            :key="prefix"
            class="flex items-center gap-1 rounded-md border border-default bg-elevated/50 px-2 py-1 text-sm text-highlighted"
            :data-prefix="prefix"
            data-testid="st-utm-prefix"
          >
            <span class="break-all">{{ prefix }}</span>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-label="`Remove ${prefix}`"
              :disabled="saving"
              data-testid="st-utm-remove"
              @click="remove(prefix)"
            />
          </span>
          <span v-if="prefixes.length === 0" class="text-sm text-muted" data-testid="st-utm-empty">
            ยังไม่มี Prefix
          </span>
        </div>

        <USeparator />

        <form class="flex flex-wrap items-start gap-2" @submit.prevent="add">
          <UInput
            v-model="draft"
            placeholder="Prefix ใหม่"
            class="w-full sm:max-w-xs"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :maxlength="UTM_PREFIX_MAX_LENGTH"
            :disabled="saving"
            data-testid="st-utm-input"
          />
          <UButton
            type="submit"
            label="เพิ่ม"
            icon="i-lucide-plus"
            color="neutral"
            :loading="saving"
            data-testid="st-utm-add"
          />
        </form>

        <p
          v-if="errorMessage"
          class="text-sm break-words text-error"
          role="alert"
          data-testid="st-utm-error"
        >
          {{ errorMessage }}
        </p>

        <UAlert
          v-if="inUseLine"
          color="info"
          variant="subtle"
          icon="i-lucide-info"
          :description="inUseLine"
          role="status"
          data-testid="st-utm-inuse"
        />

        <span class="text-xs text-muted" data-testid="st-utm-updated">{{ updatedLine }}</span>
      </UPageCard>
    </template>
  </div>
</template>
