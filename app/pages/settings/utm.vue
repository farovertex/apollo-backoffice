<script setup lang="ts">
/**
 * FEAT-038 — the global list of **UTM prefixes** an ad template may bind to (api-contract.md v1 §4, spec U3).
 *
 * A prefix becomes part of the 3rd-party UTM host (`https://<md5(prefix)><suffix>`), so it is case-sensitive
 * and may not contain whitespace. GOD only — `god-only` sends everybody else home with the "Not allowed"
 * toast and the tab is hidden in `app/pages/settings.vue`.
 *
 * FEAT-076 (spec "UI behaviour", AC-14) — **read-only**: prefixes are rows of the `prefixes` collection now and are
 * managed on `/settings/prefixes` (`st-utm-manage-link`). The input / add / remove buttons and the in-use alert are
 * gone; the page sends exactly one `GET /backend/settings/utm` per mount / Retry (`retry: 0`) and **never** a PATCH
 * (the API answers `PATCH /settings/utm` with 410). The chips are the codes of the active prefixes, API order.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { UtmSettings } from '#shared/types/settings'

definePageMeta({ middleware: 'god-only' })

useSeoMeta({ title: 'UTM prefixes' })

const LOAD_FALLBACK = 'โหลดรายการ Prefix ไม่สำเร็จ'

const api = useApi()

type PageState = 'loading' | 'ready' | 'error'

/** the list the API last answered; null while the first GET is pending or failed */
const saved = ref<UtmSettings | null>(null)
const pending = ref(true)
const loadError = ref<string | null>(null)

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
        description="รายการ Prefix ที่ใช้งานอยู่ ซึ่ง ad template ผูก UTM ได้ · มีผลกับ host ของระบบปลายทาง (ตัวพิมพ์ใหญ่-เล็กต่างกัน)"
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
          </span>
          <span v-if="prefixes.length === 0" class="text-sm text-muted" data-testid="st-utm-empty">
            ยังไม่มี Prefix
          </span>
        </div>

        <USeparator />

        <div class="flex flex-wrap items-center justify-between gap-2" data-testid="st-utm-notice">
          <span class="text-sm text-muted">รายการ Prefix จัดการที่หน้า Prefixes</span>
          <UButton
            to="/settings/prefixes"
            label="ไปที่ Prefixes"
            trailing-icon="i-lucide-arrow-right"
            color="neutral"
            variant="outline"
            size="sm"
            data-testid="st-utm-manage-link"
          />
        </div>

        <span class="text-xs text-muted" data-testid="st-utm-updated">{{ updatedLine }}</span>
      </UPageCard>
    </template>
  </div>
</template>
