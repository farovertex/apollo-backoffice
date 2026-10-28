<script setup lang="ts">
/**
 * FEAT-080 (api-contract v1 §3, spec "UI behaviour") — exchange-rate settings, GOD only.
 *
 * `god-only` sends everybody else home; the tab is hidden for an Admin in `app/pages/settings.vue`; the API
 * (`@Roles('GOD')`) stays the authority. One `GET /settings/fx?days=30` per mount / retry / after every write
 * (`retry: 0`). Per currency: today card (rate, source badge, timestamps, last error, "latest" line when today is
 * empty) + history table with an edit modal (`PUT /settings/fx/<CUR>-<base>/<day>`). "ดึงอัตราใหม่" posts
 * `/settings/fx/refresh`. The currency list comes from the API (today `USD` only) — testids are built from `currency`.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  FxCurrencyView,
  FxHistoryRowView,
  FxManualBody,
  FxManualResult,
  FxRefreshResult,
  FxSettingsView,
  FxSource
} from '#shared/types/fx'

definePageMeta({ middleware: 'god-only' })

useSeoMeta({ title: 'อัตราแลกเปลี่ยน' })

const LOAD_FALLBACK = 'โหลดอัตราแลกเปลี่ยนไม่สำเร็จ'
const RATE_MESSAGE = 'rate ต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 6 ตำแหน่ง)'
const HISTORY_DAYS = 30
const MAX_RATE = 1_000_000

const api = useApi()
const toast = useToast()

type PageState = 'loading' | 'ready' | 'empty' | 'error'

const data = ref<FxSettingsView | null>(null)
const pending = ref(true)
const loadError = ref<string | null>(null)
const refreshing = ref(false)

const hasAnyRate = computed(() =>
  (data.value?.currencies ?? []).some(c => c.today !== null || c.latest !== null || c.history.length > 0)
)

const pageState = computed<PageState>(() => {
  if (pending.value && data.value === null) return 'loading'
  if (loadError.value) return 'error'
  return hasAnyRate.value ? 'ready' : 'empty'
})

let session = 0

async function load() {
  const s = ++session
  pending.value = true
  loadError.value = null
  try {
    const res = await api<FxSettingsView>('/settings/fx', { query: { days: HISTORY_DAYS }, retry: 0 })
    if (s !== session) return
    data.value = res
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    data.value = null
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

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
type BadgeColor = 'neutral' | 'info' | 'warning'

const SOURCE_LABEL: Record<FxSource, string> = {
  fastforex: 'fastforex',
  manual: 'ตั้งเอง',
  carried: 'carried',
  backfill: 'backfill'
}
const SOURCE_COLOR: Record<FxSource, BadgeColor> = {
  fastforex: 'neutral',
  manual: 'info',
  carried: 'warning',
  backfill: 'warning'
}

function sourceLabel(s: FxSource) {
  return SOURCE_LABEL[s] ?? s
}
function sourceColor(s: FxSource): BadgeColor {
  return SOURCE_COLOR[s] ?? 'neutral'
}

/** rates are stored as given — show them as given, without a forced number of decimals */
function fmtRate(rate: number) {
  return String(rate)
}

function carriedText(c: FxCurrencyView) {
  const t = c.today
  if (!t || t.source !== 'carried') return ''
  const attempts = t.fetchAttempts > 0 ? ` (ดึงไม่สำเร็จ ${t.fetchAttempts} ครั้ง)` : ''
  return `ใช้อัตราของวัน ${t.carriedFrom ?? '–'}${attempts}`
}

function latestText(c: FxCurrencyView) {
  const l = c.latest
  if (!l) return 'ยังไม่มีอัตราเลย'
  return `อัตราล่าสุด ${fmtRate(l.rate)} ของวัน ${l.day}${l.estimated ? ' · ประมาณ' : ''}`
}

const base = computed(() => data.value?.base ?? 'THB')

// ── refresh ──────────────────────────────────────────────────────────────────────────────────────────────────────────
async function refresh() {
  if (refreshing.value) return
  refreshing.value = true
  try {
    const res = await api<FxRefreshResult>('/settings/fx/refresh', { method: 'POST', retry: 0 })
    const ok = res.results.map(r => `${r.currency} ${fmtRate(r.rate)}`).join(', ')
    const failed = res.failed.map(f => `${f.currency}: ${f.error}`).join(', ')
    toast.add({
      title: `ดึงอัตราแล้ว · ${ok || '–'}`,
      description: failed ? `ไม่สำเร็จ: ${failed}` : undefined,
      icon: 'i-lucide-check',
      color: failed ? 'warning' : 'success'
    })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: err.data?.error ?? 'ดึงอัตราไม่สำเร็จ',
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    refreshing.value = false
    await load()
  }
}

// ── edit modal ───────────────────────────────────────────────────────────────────────────────────────────────────────
const modalContent = { 'data-testid': 'st-fx-edit-modal' } as Record<string, string>

const editOpen = ref(false)
const editing = ref<{ currency: string, row: FxHistoryRowView } | null>(null)
const editRate = ref('')
const saving = ref(false)
const editError = ref<string | null>(null)

/** at most 6 decimals, > 0, ≤ 1e6 — the API's zod is the authority, this only saves the round trip */
const rateSchema = z.object({
  rate: z.number({ error: RATE_MESSAGE })
    .gt(0, RATE_MESSAGE)
    .max(MAX_RATE, RATE_MESSAGE)
    .refine(v => Math.abs(Math.round(v * 1e6) - v * 1e6) < 1e-6, RATE_MESSAGE)
})

function openEdit(currency: string, row: FxHistoryRowView) {
  editing.value = { currency, row }
  editRate.value = fmtRate(row.rate)
  editError.value = null
  editOpen.value = true
}

const editNotToday = computed(() =>
  editing.value !== null && editing.value.row.day !== data.value?.serverDay
)

async function saveEdit() {
  const target = editing.value
  if (!target || saving.value) return
  const text = editRate.value.trim()
  const parsed = rateSchema.safeParse({ rate: text === '' ? Number.NaN : Number(text) })
  if (!parsed.success) {
    editError.value = parsed.error.issues.map(i => i.message).join(' · ')
    return
  }
  const body: FxManualBody = { rate: parsed.data.rate }
  saving.value = true
  editError.value = null
  try {
    const res = await api<FxManualResult>(`/settings/fx/${target.currency}-${base.value}/${target.row.day}`, {
      method: 'PUT',
      body,
      retry: 0
    })
    editOpen.value = false
    toast.add({
      title: `ตั้งอัตรา ${res.day} = ${fmtRate(res.rate)} แล้ว (ประทับใหม่ ${res.restamped} แถว)`,
      icon: 'i-lucide-check',
      color: 'success'
    })
    await load()
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
    editError.value = issues.length ? issues.join(' · ') : err.data?.error ?? 'บันทึกอัตราไม่สำเร็จ'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div data-testid="st-fx-page" :data-state="pageState">
    <UPageCard
      title="อัตราแลกเปลี่ยน"
      :description="`อัตราต่อวันสำหรับแปลงเป็น ${base} · ดึงอัตโนมัติวันละครั้ง`"
      variant="naked"
      orientation="horizontal"
      class="mb-4"
    >
      <UButton
        label="ดึงอัตราใหม่"
        icon="i-lucide-refresh-cw"
        color="neutral"
        class="w-fit lg:ms-auto"
        :loading="refreshing"
        :disabled="refreshing || pageState === 'loading'"
        data-testid="st-fx-refresh"
        @click="refresh"
      />
    </UPageCard>

    <div v-if="data" class="flex flex-col gap-2 mb-4">
      <UAlert
        v-if="data.client === 'fake'"
        color="warning"
        variant="subtle"
        icon="i-lucide-flask-conical"
        title="ค่าปลอมสำหรับทดสอบ (FX_CLIENT=fake)"
        data-testid="st-fx-client"
      />
      <UAlert
        v-if="!data.enabled"
        color="neutral"
        variant="subtle"
        icon="i-lucide-pause"
        title="ตัวดึงอัตราอัตโนมัติปิดอยู่ (FX_ENABLED=false)"
        data-testid="st-fx-disabled"
      />
      <UAlert
        v-if="data.lastError"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="ดึงอัตราอัตโนมัติไม่สำเร็จ"
        :description="data.lastError"
        data-testid="st-fx-last-error"
      />
    </div>

    <div v-if="pageState === 'loading'" class="flex flex-col gap-4" data-testid="st-fx-loading">
      <USkeleton class="h-32 w-full" />
      <USkeleton class="h-56 w-full" />
    </div>

    <UAlert
      v-else-if="pageState === 'error'"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดอัตราแลกเปลี่ยนไม่สำเร็จ"
      :description="loadError ?? LOAD_FALLBACK"
      role="alert"
      data-testid="st-fx-error"
    >
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          variant="solid"
          size="xs"
          :loading="pending"
          data-testid="st-fx-retry"
          @click="load()"
        />
      </template>
    </UAlert>

    <UAlert
      v-else-if="pageState === 'empty'"
      color="neutral"
      variant="subtle"
      icon="i-lucide-info"
      title="ยังไม่มีอัตรา — กดดึงอัตราใหม่"
      data-testid="st-fx-empty"
    />

    <div v-else class="flex flex-col gap-6">
      <section
        v-for="c in data?.currencies ?? []"
        :key="c.currency"
        class="flex flex-col gap-4 min-w-0"
        :data-testid="`st-fx-currency-${c.currency}`"
      >
        <UPageCard variant="subtle" :data-testid="`st-fx-today-${c.currency}`">
          <div class="flex flex-col gap-2 min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-sm text-muted">{{ c.pair }} · วันนี้ {{ data?.serverDay }}</span>
              <UBadge
                v-if="c.today"
                :color="sourceColor(c.today.source)"
                variant="subtle"
                :label="sourceLabel(c.today.source)"
                :data-testid="`st-fx-today-source-${c.currency}`"
              />
              <UBadge
                v-else
                color="neutral"
                variant="outline"
                label="ยังไม่มีอัตราของวันนี้"
                :data-testid="`st-fx-today-source-${c.currency}`"
              />
            </div>

            <p v-if="c.today" class="text-2xl font-semibold break-words" :data-testid="`st-fx-today-rate-${c.currency}`">
              1 {{ c.currency }} = {{ fmtRate(c.today.rate) }} {{ base }}
            </p>

            <p v-if="c.today?.source === 'carried'" class="text-sm text-warning">
              {{ carriedText(c) }}
            </p>

            <p v-if="c.today" class="text-xs text-muted">
              ดึงเมื่อ {{ formatDateTime(c.today.fetchedAt) }}<template v-if="c.today.sourceUpdatedAt">
                · ต้นทางอัปเดต {{ formatDateTime(c.today.sourceUpdatedAt) }}
              </template>
            </p>

            <p
              v-if="c.today?.lastError"
              class="text-sm text-error break-words"
              role="alert"
              :data-testid="`st-fx-today-error-${c.currency}`"
            >
              {{ c.today.lastError }}
            </p>

            <p v-if="!c.today" class="text-sm text-muted" :data-testid="`st-fx-latest-${c.currency}`">
              {{ latestText(c) }}
            </p>
          </div>
        </UPageCard>

        <UPageCard
          :title="`ประวัติ ${c.pair}`"
          :description="`ล่าสุด ${HISTORY_DAYS} วัน · ใหม่ไปเก่า`"
          variant="subtle"
          :ui="{ container: 'min-w-0' }"
        >
          <div class="overflow-x-auto -mx-1" :data-testid="`st-fx-history-${c.currency}`">
            <table class="w-full text-sm min-w-[32rem]">
              <thead>
                <tr class="text-left text-muted">
                  <th class="py-2 px-1 font-medium">
                    วัน
                  </th>
                  <th class="py-2 px-1 font-medium">
                    อัตรา
                  </th>
                  <th class="py-2 px-1 font-medium">
                    แหล่ง
                  </th>
                  <th class="py-2 px-1 font-medium">
                    ตั้งโดย
                  </th>
                  <th class="py-2 px-1" />
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in c.history"
                  :key="row.day"
                  class="border-t border-default"
                  :data-testid="`st-fx-row-${c.currency}-${row.day}`"
                >
                  <td class="py-2 px-1 whitespace-nowrap">
                    {{ row.day }}
                  </td>
                  <td class="py-2 px-1 tabular-nums">
                    {{ fmtRate(row.rate) }}
                  </td>
                  <td class="py-2 px-1">
                    <UBadge :color="sourceColor(row.source)" variant="subtle" :label="sourceLabel(row.source)" />
                    <span v-if="row.source === 'carried' && row.carriedFrom" class="text-xs text-muted ms-1">
                      จาก {{ row.carriedFrom }}
                    </span>
                  </td>
                  <td class="py-2 px-1">
                    {{ row.setBy?.displayName ?? '–' }}
                  </td>
                  <td class="py-2 px-1 text-right">
                    <UButton
                      label="แก้"
                      icon="i-lucide-pencil"
                      size="xs"
                      color="neutral"
                      variant="subtle"
                      :data-testid="`st-fx-edit-${c.currency}-${row.day}`"
                      @click="openEdit(c.currency, row)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </UPageCard>
      </section>
    </div>

    <UModal
      v-model:open="editOpen"
      :title="editing ? `แก้อัตรา ${editing.currency}/${base} · ${editing.row.day}` : 'แก้อัตรา'"
      description="ตั้งเอง — ใช้แทนอัตราของวันนั้น"
      :dismissible="!saving"
      :ui="{ content: 'max-w-md' }"
      :content="modalContent"
    >
      <template #body>
        <form class="flex flex-col gap-4" @submit.prevent="saveEdit">
          <UFormField name="rate" :label="`อัตรา (1 ${editing?.currency ?? ''} = ? ${base})`">
            <UInput
              v-model="editRate"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="w-full"
              :disabled="saving"
              data-testid="st-fx-edit-rate"
            />
          </UFormField>
          <p v-if="editNotToday" class="text-sm text-warning" data-testid="st-fx-edit-warning">
            รายงานของวันนี้จะคำนวณใหม่ด้วยอัตรานี้
          </p>
          <p
            v-if="editError"
            class="text-sm text-error break-words"
            role="alert"
            data-testid="st-fx-edit-error"
          >
            {{ editError }}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              label="ยกเลิก"
              color="neutral"
              variant="subtle"
              :disabled="saving"
              data-testid="st-fx-edit-cancel"
              @click="editOpen = false"
            />
            <UButton
              type="submit"
              label="บันทึก"
              color="neutral"
              :loading="saving"
              data-testid="st-fx-edit-save"
            />
          </div>
        </form>
      </template>
    </UModal>
  </div>
</template>
