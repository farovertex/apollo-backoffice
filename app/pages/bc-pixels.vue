<script setup lang="ts">
/**
 * FEAT-102 — Pixel (`/bc-pixels`, test-id prefix `bpx-`; spec "UI behaviour", AC-20…AC-24; api-contract.md v1 §3, §7).
 *
 * GOD / Admin (the `mssg-pages-access` middleware: Payment → home + "Not allowed"). One `GET /bc-pixels` per load /
 * page change / 300 ms-debounced search / filter toggle (`page`, `limit=20`, `search` when not empty, `superseded=all`
 * when "รวม pixel เก่า" is on — the default `false` is not sent). Rows: name + code tail (copy = whole code) · site ·
 * BC · five step dots · event badge · linked count · created at; a table from `md`, cards below. Loading skeleton,
 * empty (`bpx-empty`), no-match, error + retry. Row click → `?pixel=<id>` → `PixelPanel`; a direct
 * `/bc-pixels?pixel=<id>` opens it the same way (the notification link of `pixelRunFinished`).
 *
 * Create: `CreateModal` → 202 `{ jobId, siteId, name }` → the banner `bpx-create-job` follows
 * `GET /bc-pixels/create/latest?siteId=` every 2 s (one loop, never two requests in flight) until the job ends →
 * one list re-read; success opens the new pixel's panel, failure keeps the banner with the Thai text of the code
 * until it is dismissed.
 *
 * Re-attach: one `GET /bc-pixel-runs/active` on mount (and with `bpx-refresh`) marks rows with an open run
 * (`bpx-row-run-<id>`); a row's own `run` does the same. The panel tells the page when its pixel went idle
 * (`settled`) → one list re-read.
 */
import type { FetchError } from 'ofetch'
import type {
  PixelActiveRunsResponse,
  PixelCreateAccepted,
  PixelCreateLatestResponse,
  PixelJobView,
  PixelListResponse,
  PixelSummary,
  PixelView
} from '#shared/types/bc-pixels'

useSeoMeta({ title: 'Pixel' })
definePageMeta({ middleware: 'mssg-pages-access' })

const DEBOUNCE_MS = 300
const LIMIT = BC_PIXEL_LIST_LIMIT

const api = useApi()
const toast = useToast()
const route = useRoute()
const router = useRouter()
const { copy } = useClipboard({ legacy: true })

// ── list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const page = ref(1)
const search = ref('')
const searchDebounced = refDebounced(search, DEBOUNCE_MS)
const withSuperseded = ref(false)

const rows = ref<PixelSummary[]>([])
const total = ref(0)
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
let session = 0

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  const q = searchDebounced.value.trim()
  try {
    // retry: 0 — exactly one request per load
    const res = await api<PixelListResponse>('/bc-pixels', {
      retry: 0,
      query: {
        page: page.value,
        limit: LIMIT,
        search: q || undefined,
        superseded: withSuperseded.value ? 'all' : undefined
      }
    })
    if (s !== session) return
    rows.value = res.pixels ?? []
    total.value = res.total ?? rows.value.length
    loaded.value = true
  } catch (e) {
    if (s !== session) return
    rows.value = []
    total.value = 0
    error.value = bcPixelFailure(e, 'โหลดรายการ pixel ไม่สำเร็จ').message
  } finally {
    if (s === session) pending.value = false
  }
}

// a new search / filter starts at page 1 — registered before the query watcher so both collapse into one request
watch([searchDebounced, withSuperseded], () => {
  page.value = 1
})
const queryKey = computed(() => `${page.value}|${searchDebounced.value.trim()}|${withSuperseded.value}`)
watch(queryKey, () => {
  void load()
})

const hasSearch = computed(() => searchDebounced.value.trim() !== '')
const isEmpty = computed(() => loaded.value && !error.value && total.value === 0 && !hasSearch.value)
const isNoMatch = computed(() => loaded.value && !error.value && total.value === 0 && hasSearch.value)
const showRows = computed(() => !error.value && !isEmpty.value && !isNoMatch.value)
const firstLoad = computed(() => pending.value && !loaded.value && !error.value)

// ── open runs (re-attach) ────────────────────────────────────────────────────────────────────────────────────────────
const activeRunPixelIds = ref(new Set<string>())

async function loadActiveRuns() {
  try {
    const res = await api<PixelActiveRunsResponse>('/bc-pixel-runs/active', { retry: 0 })
    activeRunPixelIds.value = new Set((res.runs ?? []).filter(r => r.status !== 'completed').map(r => r.pixelId))
  } catch {
    // the spinner is a hint only; the panel reads the truth
  }
}

function rowRunOpen(row: PixelSummary): boolean {
  return rowHasOpenRun(row) || activeRunPixelIds.value.has(row.id)
}

function refreshAll() {
  void load()
  void loadActiveRuns()
}

onMounted(() => {
  void load()
  void loadActiveRuns()
})

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const wide = useMediaQuery('(min-width: 768px)')

function copyCode(row: PixelSummary) {
  void copy(row.pixelCode)
  toast.add({ title: 'คัดลอกโค้ด pixel แล้ว', description: `…${bcPixelTail(row.pixelCode)}`, color: 'success' })
}

const DOT_CLASS: Record<string, string> = {
  done: 'bg-success',
  current: 'bg-primary ring-2 ring-primary/30',
  running: 'bg-primary animate-pulse',
  failed: 'bg-error',
  todo: 'bg-elevated ring-1 ring-inset ring-accented'
}

function dotTitle(step: keyof PixelSummary['steps'], state: string): string {
  return `${BC_PIXEL_STEP_TITLE[step]}: ${(BC_PIXEL_STEP_STATE_TEXT as Record<string, string>)[state] ?? state}`
}

// ── panel (`?pixel=<id>`) ────────────────────────────────────────────────────────────────────────────────────────────
const queryPixel = computed(() => {
  const raw = route.query.pixel
  return typeof raw === 'string' && raw ? raw : null
})
/** keeps the last id after close so the slideover does not blank out while it animates away */
const panelPixelId = ref<string | null>(queryPixel.value)
watch(queryPixel, (id) => {
  if (id) panelPixelId.value = id
})
const panelOpen = computed({
  get: () => !!queryPixel.value,
  set: (v: boolean) => {
    if (!v && queryPixel.value) {
      const query = { ...route.query }
      delete query.pixel
      void router.replace({ query })
    }
  }
})

function openPanel(id: string) {
  panelPixelId.value = id
  void router.replace({ query: { ...route.query, pixel: id } })
}

/** the panel read a fresher view of a listed pixel → patch the row in place (a view is a superset of a summary) */
function onPanelUpdate(view: PixelView) {
  const i = rows.value.findIndex(r => r.id === view.id)
  if (i === -1) return
  const next = rows.value.slice()
  next[i] = view
  rows.value = next
  if (!rowHasOpenRun(view) && activeRunPixelIds.value.has(view.id) && !view.busy) {
    const ids = new Set(activeRunPixelIds.value)
    ids.delete(view.id)
    activeRunPixelIds.value = ids
  }
}

function onPanelSettled() {
  void load()
}

// ── create + follow the create job ───────────────────────────────────────────────────────────────────────────────────
const createOpen = ref(false)

interface CreateFollow {
  siteId: string
  name: string
  job: PixelJobView | null
  /** request-level failure of the follow (404 site, …) */
  error: string | null
  done: boolean
}
const follow = ref<CreateFollow | null>(null)
let followTimer: ReturnType<typeof setInterval> | null = null
let followInFlight = false
let followSeq = 0

function stopFollow() {
  if (followTimer) clearInterval(followTimer)
  followTimer = null
}

async function pollCreate() {
  const f = follow.value
  if (!f || f.done || followInFlight) return
  const s = followSeq
  followInFlight = true
  try {
    const res = await api<PixelCreateLatestResponse>('/bc-pixels/create/latest', { retry: 0, query: { siteId: f.siteId } })
    if (s !== followSeq || !follow.value) return
    const job = res.job
    follow.value = { ...follow.value, job, error: null }
    if (!job || isPixelJobOpen(job)) return
    // the job ended
    stopFollow()
    follow.value = { ...follow.value, done: true }
    void load()
    if (job.status === 'completed') {
      toast.add({ title: BC_PIXEL_TOAST.createDone, description: f.name, color: 'success' })
      follow.value = null
      if (res.pixelId) openPanel(res.pixelId)
    } else {
      toast.add({
        title: BC_PIXEL_TOAST.createFailed,
        description: `${f.name}: ${job.status === 'cancelled' && !job.error ? 'งานถูกยกเลิก' : bcPixelErrorText(job.error)}`,
        color: 'error'
      })
    }
  } catch (e) {
    if (s !== followSeq || !follow.value) return
    const err = e as FetchError
    if ((err.response?.status ?? err.statusCode) === 404) {
      stopFollow()
      follow.value = { ...follow.value, done: true, error: bcPixelFailure(e, 'ไม่พบเว็บ').message }
    }
    // other errors: transient, the next tick tries again
  } finally {
    if (s === followSeq) followInFlight = false
  }
}

function startFollow(accepted: PixelCreateAccepted) {
  followSeq++
  followInFlight = false
  stopFollow()
  follow.value = { siteId: accepted.siteId, name: accepted.name, job: null, error: null, done: false }
  followTimer = setInterval(() => void pollCreate(), BC_PIXEL_POLL_MS)
  void pollCreate()
}

function onCreated(accepted: PixelCreateAccepted) {
  toast.add({ title: BC_PIXEL_TOAST.createStarted, description: accepted.name, color: 'info' })
  startFollow(accepted)
}

function dismissFollow() {
  followSeq++
  stopFollow()
  follow.value = null
}

const followStatus = computed(() => {
  const f = follow.value
  if (!f) return ''
  if (f.error) return 'failed'
  return f.job?.status ?? 'pending'
})
const followFailed = computed(() => followStatus.value === 'failed' || followStatus.value === 'cancelled')

onUnmounted(() => {
  session++
  followSeq++
  stopFollow()
})
</script>

<template>
  <UDashboardPanel id="bc-pixels">
    <template #header>
      <UDashboardNavbar title="Pixel">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="รีเฟรช"
            aria-label="รีเฟรช"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="bpx-refresh"
            @click="refreshAll()"
          />
          <UButton
            label="สร้าง pixel"
            icon="i-lucide-plus"
            color="primary"
            data-testid="bpx-create"
            @click="createOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div data-testid="bpx-page" :data-pending="pending ? 'true' : 'false'" class="flex flex-1 flex-col gap-4">
        <!-- create job banner -->
        <div
          v-if="follow"
          class="flex flex-wrap items-start gap-2 rounded-lg border px-3 py-2 text-sm"
          :class="followFailed ? 'border-error/40 bg-error/5' : 'border-primary/30 bg-primary/5'"
          data-testid="bpx-create-job"
          :data-status="followStatus"
          :data-error="follow.job?.error ?? ''"
        >
          <UIcon
            :name="followFailed ? 'i-lucide-circle-x' : 'i-lucide-loader-circle'"
            class="mt-0.5 size-4 shrink-0"
            :class="followFailed ? 'text-error' : 'animate-spin text-primary'"
          />
          <div class="min-w-0 flex-1 space-y-0.5">
            <p class="font-medium break-words text-highlighted">
              <template v-if="followFailed">
                {{ BC_PIXEL_TOAST.createFailed }} · {{ follow.name }}
              </template>
              <template v-else>
                กำลังสร้าง pixel “{{ follow.name }}”
                <span v-if="follow.job" class="font-normal text-muted"> · {{ bcPixelJobProgressText(follow.job) }}</span>
              </template>
            </p>
            <p v-if="followFailed" class="break-words text-error">
              {{ follow.error ?? (follow.job?.status === 'cancelled' && !follow.job?.error ? 'งานถูกยกเลิก' : bcPixelErrorText(follow.job?.error)) }}
            </p>
            <p v-if="follow.job?.lastLog" class="break-words text-xs text-muted">
              {{ follow.job.lastLog }}
            </p>
          </div>
          <UButton
            v-if="followFailed"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="ปิด"
            data-testid="bpx-create-job-dismiss"
            @click="dismissFollow"
          />
        </div>

        <!-- toolbar -->
        <div class="flex flex-wrap items-center gap-3">
          <UInput
            v-model="search"
            class="w-full sm:max-w-sm"
            icon="i-lucide-search"
            placeholder="ค้นหาชื่อ / โค้ด / เว็บ"
            data-testid="bpx-search"
          />
          <USwitch
            v-model="withSuperseded"
            label="รวม pixel เก่า"
            data-testid="bpx-filter-superseded"
          />
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="โหลดรายการ pixel ไม่สำเร็จ"
          :description="error"
          data-testid="bpx-error"
        >
          <template #actions>
            <UButton
              label="ลองใหม่"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="pending"
              data-testid="bpx-retry"
              @click="load()"
            />
          </template>
        </UAlert>

        <div v-else-if="firstLoad" class="flex flex-col gap-2" data-testid="bpx-loading">
          <USkeleton v-for="n in 5" :key="n" class="h-14 w-full" />
        </div>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-target"
          :title="BC_PIXEL_TEXT.empty"
          data-testid="bpx-empty"
        >
          <template #actions>
            <UButton
              label="สร้าง pixel"
              icon="i-lucide-plus"
              color="primary"
              @click="createOpen = true"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="isNoMatch"
          icon="i-lucide-search-x"
          title="ไม่พบ pixel ที่ตรงกับคำค้น"
          data-testid="bpx-no-match"
        >
          <template #actions>
            <UButton
              label="ล้างคำค้น"
              icon="i-lucide-x"
              color="neutral"
              variant="outline"
              @click="search = ''"
            />
          </template>
        </UEmpty>

        <!-- table (md and up) -->
        <div
          v-if="showRows && !firstLoad && wide"
          class="overflow-x-auto"
          data-testid="bpx-table"
        >
          <table class="w-full border-separate border-spacing-0 text-sm" :class="pending ? 'opacity-60' : ''">
            <thead>
              <tr class="bg-elevated/50">
                <th class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Pixel
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  เว็บ
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  BC
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  ขั้นตอน
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Event
                </th>
                <!-- below lg the created-at column folds into this one (768 px fits six columns, not seven) -->
                <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted lg:rounded-none lg:border-r-0">
                  ผูกบัญชี
                </th>
                <th class="hidden rounded-r-lg border-y border-r border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted lg:table-cell">
                  สร้างเมื่อ
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.id"
                class="cursor-pointer hover:bg-elevated/40"
                :class="row.superseded ? 'opacity-70' : ''"
                data-slot="tr"
                :data-id="row.id"
                :data-testid="`bpx-row-${row.id}`"
                :data-event-status="row.eventStatus"
                :data-superseded="row.superseded ? 'true' : 'false'"
                tabindex="0"
                @click="openPanel(row.id)"
                @keydown.enter="openPanel(row.id)"
              >
                <td class="border-b border-default px-3 py-2">
                  <div class="flex items-center gap-1.5">
                    <UIcon
                      v-if="rowRunOpen(row)"
                      name="i-lucide-loader-circle"
                      class="size-4 shrink-0 animate-spin text-primary"
                      :data-testid="`bpx-row-run-${row.id}`"
                    />
                    <span class="max-w-36 truncate font-medium text-highlighted lg:max-w-48" :title="row.name">{{ row.name }}</span>
                    <UBadge
                      v-if="row.superseded"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      class="whitespace-nowrap"
                    >
                      {{ BC_PIXEL_TEXT.superseded }}
                    </UBadge>
                  </div>
                  <div class="flex items-center gap-0.5 text-xs text-muted">
                    <span class="font-mono" :title="row.pixelCode" :data-testid="`bpx-row-code-${row.id}`">…{{ bcPixelTail(row.pixelCode) }}</span>
                    <UButton
                      icon="i-lucide-copy"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      aria-label="คัดลอกโค้ด pixel"
                      :data-testid="`bpx-row-copy-${row.id}`"
                      @click.stop="copyCode(row)"
                    />
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <p class="max-w-32 truncate text-highlighted lg:max-w-44" :title="row.site.name">
                    {{ row.site.name || '—' }}
                  </p>
                  <p class="max-w-32 truncate text-xs text-muted lg:max-w-44" :title="row.site.domain">
                    {{ row.site.domain }}
                  </p>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <p class="max-w-24 truncate lg:max-w-36" :title="row.org.name">
                    {{ row.org.name || '—' }}
                  </p>
                  <p class="font-mono text-xs whitespace-nowrap text-muted">
                    …{{ bcPixelTail(row.org.orgId) }}
                  </p>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex items-center gap-1" :data-testid="`bpx-steps-${row.id}`">
                    <span
                      v-for="step in BC_PIXEL_STEP_KEYS"
                      :key="step"
                      class="inline-block size-2.5 rounded-full"
                      :class="DOT_CLASS[row.steps[step]]"
                      :title="dotTitle(step, row.steps[step])"
                      :aria-label="dotTitle(step, row.steps[step])"
                      :data-testid="`bpx-dot-${row.id}-${step}`"
                      :data-state="row.steps[step]"
                    />
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    :color="BC_PIXEL_EVENT_STATUS_COLOR[row.eventStatus]"
                    variant="subtle"
                    class="whitespace-nowrap"
                    :data-testid="`bpx-row-event-${row.id}`"
                  >
                    {{ BC_PIXEL_EVENT_STATUS_TEXT[row.eventStatus] }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2 whitespace-nowrap">
                  <span :data-testid="`bpx-row-linked-${row.id}`">{{ row.linkedCount }} บัญชี</span>
                  <span class="block text-xs text-muted lg:hidden" :title="row.createdAt">{{ bcPixelDateTime(row.createdAt) }}</span>
                </td>
                <td class="hidden border-b border-default px-3 py-2 text-xs whitespace-nowrap text-muted lg:table-cell" :title="row.createdAt">
                  {{ bcPixelDateTime(row.createdAt) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- cards (below md) -->
        <ul
          v-else-if="showRows && !firstLoad"
          class="flex flex-col gap-2"
          :class="pending ? 'opacity-60' : ''"
          data-testid="bpx-table"
        >
          <li
            v-for="row in rows"
            :key="row.id"
            class="cursor-pointer rounded-lg border border-default p-3 hover:bg-elevated/40"
            :class="row.superseded ? 'opacity-70' : ''"
            :data-id="row.id"
            :data-testid="`bpx-row-${row.id}`"
            :data-event-status="row.eventStatus"
            :data-superseded="row.superseded ? 'true' : 'false'"
            tabindex="0"
            @click="openPanel(row.id)"
            @keydown.enter="openPanel(row.id)"
          >
            <div class="flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <p class="flex items-center gap-1.5">
                  <UIcon
                    v-if="rowRunOpen(row)"
                    name="i-lucide-loader-circle"
                    class="size-4 shrink-0 animate-spin text-primary"
                    :data-testid="`bpx-row-run-${row.id}`"
                  />
                  <span class="truncate font-medium text-highlighted">{{ row.name }}</span>
                  <UBadge
                    v-if="row.superseded"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                  >
                    {{ BC_PIXEL_TEXT.superseded }}
                  </UBadge>
                </p>
                <p class="flex items-center gap-0.5 text-xs text-muted">
                  <span class="font-mono" :title="row.pixelCode" :data-testid="`bpx-row-code-${row.id}`">…{{ bcPixelTail(row.pixelCode) }}</span>
                  <UButton
                    icon="i-lucide-copy"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    aria-label="คัดลอกโค้ด pixel"
                    :data-testid="`bpx-row-copy-${row.id}`"
                    @click.stop="copyCode(row)"
                  />
                </p>
              </div>
              <UBadge
                :color="BC_PIXEL_EVENT_STATUS_COLOR[row.eventStatus]"
                variant="subtle"
                class="shrink-0 whitespace-nowrap"
                :data-testid="`bpx-row-event-${row.id}`"
              >
                {{ BC_PIXEL_EVENT_STATUS_TEXT[row.eventStatus] }}
              </UBadge>
            </div>
            <p class="mt-1 truncate text-xs text-muted">
              <UIcon name="i-lucide-globe" class="size-3 align-[-1px]" />
              {{ row.site.name || '—' }} · {{ row.site.domain }}
            </p>
            <p class="truncate text-xs text-muted">
              <UIcon name="i-lucide-building-2" class="size-3 align-[-1px]" />
              {{ row.org.name || '—' }} (…{{ bcPixelTail(row.org.orgId) }})
            </p>
            <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div class="flex items-center gap-1" :data-testid="`bpx-steps-${row.id}`">
                <span
                  v-for="step in BC_PIXEL_STEP_KEYS"
                  :key="step"
                  class="inline-block size-2.5 rounded-full"
                  :class="DOT_CLASS[row.steps[step]]"
                  :title="dotTitle(step, row.steps[step])"
                  :aria-label="dotTitle(step, row.steps[step])"
                  :data-testid="`bpx-dot-${row.id}-${step}`"
                  :data-state="row.steps[step]"
                />
              </div>
              <span class="whitespace-nowrap text-muted">
                <span :data-testid="`bpx-row-linked-${row.id}`">{{ row.linkedCount }} บัญชี</span>
                · {{ bcPixelDateTime(row.createdAt) }}
              </span>
            </div>
          </li>
        </ul>

        <div
          v-if="!error && loaded"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
        >
          <span data-testid="bpx-count">{{ total }} pixel</span>
          <UPagination
            v-if="total > LIMIT"
            :page="page"
            :items-per-page="LIMIT"
            :total="total"
            data-testid="bpx-pagination"
            @update:page="(p: number) => page = p"
          />
        </div>
      </div>

      <BcPixelsCreateModal
        v-model:open="createOpen"
        @created="onCreated"
      />
      <BcPixelsPixelPanel
        v-model:open="panelOpen"
        :pixel-id="panelPixelId"
        @update="onPanelUpdate"
        @settled="onPanelSettled"
      />
    </template>
  </UDashboardPanel>
</template>
