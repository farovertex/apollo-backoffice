<script setup lang="ts">
/**
 * FEAT-020 — Reports (api-contract.md **v1** §6.2; spec AC-22, AC-23, AC-28). Every filter, the range, the
 * sort and the page live in the **URL query**, so the whole state of the screen is shareable and the back
 * button works; the query is the single source of truth and the only watcher that triggers a request.
 *
 * Exactly one `GET /backend/reports/summary` + one `GET /backend/reports/ads` per load / Refresh / filter /
 * sort / page change (search debounced 300 ms). A late answer of a superseded query is dropped through the
 * session counter. **Nothing polls here** — the job runs every `intervalMs` on the API side and the header
 * says when the newest snapshot was captured; the human presses Refresh.
 *
 * The workspace / account / advertiser / order filters are built from the rows that have been seen (the API
 * has no list endpoint for them, like `/orders`); an id that arrives through the URL (`?advertiserId=…` from
 * the advertisers slideover) is kept as an option even before a row carries it.
 * A 403 (a Payment-only admin that typed the URL) renders `rp-forbidden` with the API text, no redirect.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdReportRow,
  AdState,
  AdsReportResponse,
  ReportRange,
  ReportSummaryResponse
} from '#shared/types/reports'

useSeoMeta({ title: 'Reports' })

const LIMIT = 20
const DEBOUNCE_MS = 300
const DEFAULT_SORT = '-spend'

const route = useRoute()
const router = useRouter()
const api = useApi()
const nowDate = useNow({ interval: 30_000 })
const nowMs = computed(() => nowDate.value.getTime())

// ── url state ────────────────────────────────────────────────────────────────────────────────────────────────────────
function queryString(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const range = computed<ReportRange>(() => parseRange(route.query.range))
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const sort = computed(() => queryString('sort') ?? DEFAULT_SORT)
const workspaceId = computed(() => queryString('workspaceId') ?? 'all')
const accountId = computed(() => queryString('tiktokAccountId') ?? 'all')
const advertiserId = computed(() => queryString('advertiserId') ?? 'all')
const orderId = computed(() => queryString('orderId') ?? 'all')
const AD_STATES: AdState[] = ['delivering', 'pending', 'rejected', 'ended', 'unknown']
/** an unknown `state` / `linked` in the URL is ignored rather than sent to the API */
const stateFilter = computed<'all' | AdState>(() => {
  const value = queryString('state')
  return AD_STATES.includes(value as AdState) ? value as AdState : 'all'
})
const linkedFilter = computed<'all' | 'true' | 'false'>(() => {
  const value = queryString('linked')
  return value === 'true' || value === 'false' ? value : 'all'
})
const searchQuery = computed(() => queryString('search') ?? '')

/** the search box types locally and writes the debounced value into the URL */
const search = ref(searchQuery.value)
const searchDebounced = refDebounced(search, DEBOUNCE_MS)

function setQuery(patch: Record<string, string | undefined>, keepPage = false) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries({ ...route.query, ...patch })) {
    if (typeof value === 'string' && value !== '' && value !== 'all') next[key] = value
  }
  if (!keepPage) delete next.page
  void router.replace({ query: next })
}

watch(searchDebounced, (value) => {
  if (value.trim() === searchQuery.value) return
  setQuery({ search: value.trim() || undefined })
})
// back / forward or a "clear filters" press has to reach the input too
watch(searchQuery, (value) => {
  if (value !== search.value.trim()) search.value = value
})

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const rows = ref<AdReportRow[]>([])
const total = ref(0)
const totals = ref<AdsReportResponse['totals'] | null>(null)
const summary = ref<ReportSummaryResponse | null>(null)
const intervalMs = ref(300_000)
const refreshedAt = ref<string | null>(null)
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
let session = 0

const knownWorkspaces = ref<{ id: string, name: string }[]>([])
const knownAccounts = ref<{ id: string, name: string }[]>([])
const knownAdvertisers = ref<{ id: string, name: string }[]>([])
const knownOrders = ref<{ id: string, name: string }[]>([])

function remember(list: Ref<{ id: string, name: string }[]>, id: string | null | undefined, name: string | null | undefined) {
  if (!id) return
  const existing = list.value.find(item => item.id === id)
  if (existing) {
    if (name && existing.name !== name) existing.name = name
    return
  }
  list.value = [...list.value, { id, name: name || `…${id.slice(-6)}` }]
}

function rememberFromRows(list: AdReportRow[]) {
  for (const row of list) {
    remember(knownWorkspaces, row.workspace?.id, row.workspace?.name)
    remember(knownAccounts, row.account?.id, row.account?.label)
    remember(knownAdvertisers, row.advertiser?.id, row.advertiser?.name)
    remember(knownOrders, row.order?.id, row.order?.name)
  }
}

/** an id that only exists in the URL must still be selectable in its dropdown */
function rememberFromQuery() {
  remember(knownWorkspaces, queryString('workspaceId'), null)
  remember(knownAccounts, queryString('tiktokAccountId'), null)
  remember(knownAdvertisers, queryString('advertiserId'), null)
  remember(knownOrders, queryString('orderId'), null)
}

function filterQuery() {
  return {
    workspaceId: workspaceId.value === 'all' ? undefined : workspaceId.value,
    tiktokAccountId: accountId.value === 'all' ? undefined : accountId.value,
    advertiserId: advertiserId.value === 'all' ? undefined : advertiserId.value,
    orderId: orderId.value === 'all' ? undefined : orderId.value
  }
}

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  rememberFromQuery()
  try {
    // retry: 0 — exactly one summary + one list request per change
    const [summaryRes, listRes] = await Promise.all([
      api<ReportSummaryResponse>('/reports/summary', {
        retry: 0,
        query: { range: range.value, ...filterQuery() }
      }),
      api<AdsReportResponse>('/reports/ads', {
        retry: 0,
        query: {
          range: range.value,
          page: page.value,
          limit: LIMIT,
          sort: sort.value,
          search: searchQuery.value || undefined,
          state: stateFilter.value === 'all' ? undefined : stateFilter.value,
          linked: linkedFilter.value === 'all' ? undefined : linkedFilter.value,
          ...filterQuery()
        }
      })
    ])
    if (s !== session) return
    summary.value = summaryRes
    rows.value = listRes.ads ?? []
    total.value = listRes.total ?? rows.value.length
    totals.value = listRes.totals ?? null
    intervalMs.value = listRes.intervalMs || summaryRes.intervalMs || 300_000
    refreshedAt.value = listRes.refreshedAt ?? summaryRes.refreshedAt ?? null
    rememberFromRows(rows.value)
    loaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    rows.value = []
    total.value = 0
    totals.value = null
    summary.value = null
    if ((err.response?.status ?? err.statusCode) === 403) {
      forbidden.value = message
      error.value = null
    } else {
      error.value = message
    }
  } finally {
    if (s === session) pending.value = false
  }
}

const queryKey = computed(() => JSON.stringify([
  range.value, page.value, sort.value, searchQuery.value, workspaceId.value,
  accountId.value, advertiserId.value, orderId.value, stateFilter.value, linkedFilter.value
]))

watch(queryKey, () => {
  void load()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const STATE_ITEMS: { label: string, value: 'all' | AdState }[] = [
  { label: 'ทุกสถานะ', value: 'all' },
  { label: 'กำลังส่ง', value: 'delivering' },
  { label: 'รอตรวจ', value: 'pending' },
  { label: 'ไม่ผ่าน', value: 'rejected' },
  { label: 'จบแล้ว', value: 'ended' },
  { label: 'ไม่ทราบ', value: 'unknown' }
]
const LINKED_ITEMS = [
  { label: 'ทั้งหมด', value: 'all' },
  { label: 'จากระบบ', value: 'true' },
  { label: 'นอกระบบ', value: 'false' }
]

function optionItems(list: { id: string, name: string }[], allLabel: string) {
  return [{ label: allLabel, value: 'all' }, ...list.map(item => ({ label: item.name, value: item.id }))]
}

const workspaceItems = computed(() => optionItems(knownWorkspaces.value, 'ทุก workspace'))
const accountItems = computed(() => optionItems(knownAccounts.value, 'ทุกบัญชี'))
const advertiserItems = computed(() => optionItems(knownAdvertisers.value, 'ทุก advertiser'))
const orderItems = computed(() => optionItems(knownOrders.value, 'ทุก order'))
const showWorkspaceFilter = computed(() => knownWorkspaces.value.length > 1)

const hasFilter = computed(() =>
  searchQuery.value !== ''
  || workspaceId.value !== 'all'
  || accountId.value !== 'all'
  || advertiserId.value !== 'all'
  || orderId.value !== 'all'
  || stateFilter.value !== 'all'
  || linkedFilter.value !== 'all'
)

function clearFilters() {
  search.value = ''
  setQuery({
    search: undefined,
    workspaceId: undefined,
    tiktokAccountId: undefined,
    advertiserId: undefined,
    orderId: undefined,
    state: undefined,
    linked: undefined
  })
}

const isEmpty = computed(() => loaded.value && !error.value && !forbidden.value && total.value === 0 && !hasFilter.value)
const isNoMatch = computed(() => loaded.value && !error.value && !forbidden.value && total.value === 0 && hasFilter.value)
const showTable = computed(() => !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value)
const showSkeleton = computed(() => pending.value && !loaded.value && !error.value && !forbidden.value)

// ── header ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const intervalText = computed(() => {
  if (summary.value && summary.value.enabled === false) return 'ปิดการดึงอัตโนมัติ'
  const minutes = intervalMinutes(intervalMs.value)
  const last = refreshedAt.value ? `${formatClock(refreshedAt.value)} (${timeAgoTh(refreshedAt.value, nowMs.value)})` : REPORT_DASH
  return `อัปเดตทุก ${minutes} นาที · ล่าสุด ${last}`
})

const tracking = computed(() => summary.value?.tracking ?? null)
const previousTotals = computed(() => summary.value?.previous?.totals ?? null)
const summaryTotals = computed(() => summary.value?.totals ?? totals.value ?? null)

const RANGES: ReportRange[] = ['today', '7d', 'all']

function setRange(value: ReportRange) {
  setQuery({ range: value === 'today' ? undefined : value })
}

function setSort(value: string) {
  setQuery({ sort: value === DEFAULT_SORT ? undefined : value })
}

function setPage(value: number) {
  setQuery({ page: value > 1 ? String(value) : undefined }, true)
}

const rangeFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * LIMIT + 1))
const rangeTo = computed(() => Math.min(page.value * LIMIT, total.value))

// ── slideover ────────────────────────────────────────────────────────────────────────────────────────────────────────
const selectedAdId = ref<string | null>(null)
const slideoverOpen = ref(false)

function openAd(row: AdReportRow) {
  selectedAdId.value = row.id
  slideoverOpen.value = true
}

/** AC-24: closing the slideover puts the focus back on the row that opened it */
function focusRow() {
  const id = selectedAdId.value
  if (!id || !import.meta.client) return
  void nextTick(() => {
    const el = document.querySelector<HTMLElement>(`[data-testid="rp-row"][data-id="${CSS.escape(id)}"]`)
    el?.focus()
  })
}
</script>

<template>
  <UDashboardPanel id="reports">
    <template #header>
      <UDashboardNavbar title="Reports">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <div
            v-if="!forbidden"
            class="flex flex-wrap gap-1"
            role="group"
            aria-label="ช่วงเวลา"
          >
            <UButton
              v-for="key in RANGES"
              :key="key"
              :label="RANGE_LABEL[key]"
              size="xs"
              :color="range === key ? 'primary' : 'neutral'"
              :variant="range === key ? 'solid' : 'outline'"
              :aria-pressed="range === key"
              :data-testid="`rp-range-${key}`"
              @click="setRange(key)"
            />
          </div>
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="rp-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rp-page"
        :data-range="range"
        :data-pending="pending ? 'true' : 'false'"
        class="flex flex-1 flex-col gap-4"
      >
        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="คุณไม่มีสิทธิ์ดูรายงาน"
          :description="forbidden"
          data-testid="rp-forbidden"
        />

        <template v-else>
          <p class="text-sm text-muted" data-testid="rp-interval">
            {{ intervalText }}
          </p>

          <!-- tiles -->
          <div v-if="showSkeleton" class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6" data-testid="rp-loading">
            <USkeleton v-for="n in 6" :key="n" class="h-20 w-full" />
          </div>
          <div v-else-if="!error" class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
            <ReportsMetricTile
              testid="rp-tile-spend"
              label="Spend"
              format="dec"
              caption="สกุลเงินของบัญชี"
              :value="summaryTotals?.spend ?? null"
              :previous="previousTotals?.spend ?? null"
            />
            <ReportsMetricTile
              testid="rp-tile-impressions"
              label="Impressions"
              :value="summaryTotals?.impressions ?? null"
              :previous="previousTotals?.impressions ?? null"
            />
            <ReportsMetricTile
              testid="rp-tile-clicks"
              label="Clicks"
              :value="summaryTotals?.clicks ?? null"
              :previous="previousTotals?.clicks ?? null"
            />
            <ReportsMetricTile
              testid="rp-tile-ctr"
              label="CTR"
              format="pct"
              :value="summaryTotals?.ctr ?? null"
              :previous="previousTotals?.ctr ?? null"
            />
            <ReportsMetricTile
              testid="rp-tile-conversions"
              label="Conversions"
              :value="summaryTotals?.conversions ?? null"
              :previous="previousTotals?.conversions ?? null"
            />
            <ReportsMetricTile
              testid="rp-tile-cpa"
              label="Cost / conv."
              format="dec"
              lower-is-better
              :value="summaryTotals?.conversionCost ?? null"
              :previous="previousTotals?.conversionCost ?? null"
            />
          </div>

          <!-- tracking summary -->
          <div
            v-if="tracking"
            class="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted"
            data-testid="rp-tracking"
            :data-tracking="tracking.tracking"
            :data-off="tracking.off"
            :data-error="tracking.error"
          >
            <span class="inline-flex items-center gap-1.5">
              <span class="size-2 rounded-full bg-success" />ติดตาม <b class="tabular-nums text-highlighted">{{ tracking.tracking }}</b>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="size-2 rounded-full bg-muted" />ปิดไว้ <b class="tabular-nums text-highlighted">{{ tracking.off }}</b>
            </span>
            <span class="inline-flex items-center gap-1.5">
              <span class="size-2 rounded-full bg-error" />ผิดพลาด <b class="tabular-nums text-highlighted">{{ tracking.error }}</b>
              <UButton
                v-if="tracking.error > 0"
                label="ดู"
                color="error"
                variant="link"
                size="xs"
                data-testid="rp-tracking-errors"
                @click="clearFilters()"
              />
            </span>
            <span v-if="tracking.fetching > 0" class="inline-flex items-center gap-1.5">
              <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />กำลังดึง <b class="tabular-nums text-highlighted">{{ tracking.fetching }}</b>
            </span>
          </div>

          <!-- filters -->
          <div class="flex flex-wrap items-center gap-1.5">
            <UInput
              v-model="search"
              class="w-full sm:max-w-xs"
              icon="i-lucide-search"
              placeholder="ค้นหาชื่อโฆษณา / กลุ่มโฆษณา / แคมเปญ"
              aria-label="ค้นหา"
              data-testid="rp-search"
            />
            <USelect
              v-if="showWorkspaceFilter"
              :model-value="workspaceId"
              :items="workspaceItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Workspace"
              data-testid="rp-filter-workspace"
              @update:model-value="(v: string) => setQuery({ workspaceId: v })"
            />
            <USelect
              :model-value="accountId"
              :items="accountItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Account"
              data-testid="rp-filter-account"
              @update:model-value="(v: string) => setQuery({ tiktokAccountId: v })"
            />
            <USelect
              :model-value="advertiserId"
              :items="advertiserItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Advertiser"
              data-testid="rp-filter-advertiser"
              @update:model-value="(v: string) => setQuery({ advertiserId: v })"
            />
            <USelect
              :model-value="orderId"
              :items="orderItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Order"
              data-testid="rp-filter-order"
              @update:model-value="(v: string) => setQuery({ orderId: v })"
            />
            <USelect
              :model-value="stateFilter"
              :items="STATE_ITEMS"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-32"
              aria-label="สถานะ"
              data-testid="rp-filter-state"
              @update:model-value="(v: string) => setQuery({ state: v })"
            />
            <USelect
              :model-value="linkedFilter"
              :items="LINKED_ITEMS"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-32"
              aria-label="ที่มา"
              data-testid="rp-filter-linked"
              @update:model-value="(v: string) => setQuery({ linked: v })"
            />
            <UButton
              v-if="hasFilter"
              label="ล้างตัวกรอง"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              data-testid="rp-clear"
              @click="clearFilters"
            />
          </div>

          <UAlert
            v-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="rp-error"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rp-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <UEmpty
            v-else-if="isEmpty"
            icon="i-lucide-chart-no-axes-combined"
            title="ยังไม่มีข้อมูลโฆษณา"
            description="เผยแพร่ order แล้วระบบจะเริ่มเก็บยอดให้อัตโนมัติ"
            data-testid="rp-empty"
          >
            <template #actions>
              <UButton
                label="Launch ads"
                icon="i-lucide-rocket"
                color="primary"
                to="/launch-ads"
                data-testid="rp-empty-launch"
              />
            </template>
          </UEmpty>

          <UEmpty
            v-else-if="isNoMatch"
            icon="i-lucide-search-x"
            title="ไม่พบโฆษณาที่ตรงกับตัวกรอง"
            data-testid="rp-nomatch"
          >
            <template #actions>
              <UButton
                label="ล้างตัวกรอง"
                icon="i-lucide-x"
                color="neutral"
                variant="outline"
                data-testid="rp-clear-filters"
                @click="clearFilters"
              />
            </template>
          </UEmpty>

          <ReportsAdsTable
            v-if="showTable"
            :rows="rows"
            :interval-ms="intervalMs"
            :now-ms="nowMs"
            :sort="sort"
            sortable
            :pending="pending"
            :active-id="slideoverOpen ? selectedAdId : null"
            @select="openAd"
            @update:sort="setSort"
          />

          <div
            v-if="!error"
            class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
          >
            <span data-testid="rp-count">แสดง {{ rangeFrom }}–{{ rangeTo }} จาก {{ total }}</span>

            <UPagination
              v-if="total > LIMIT"
              :page="page"
              :items-per-page="LIMIT"
              :total="total"
              data-testid="rp-pagination"
              @update:page="setPage"
            />
          </div>
        </template>
      </div>

      <ReportsAdSlideover
        v-model:open="slideoverOpen"
        :ad-id="selectedAdId"
        :range="range"
        @refreshed="load()"
        @closed="focusRow()"
      />
    </template>
  </UDashboardPanel>
</template>
