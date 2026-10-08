<script setup lang="ts">
/**
 * FEAT-035 — Report summary (api-contract.md §3; spec AC-8…AC-17). A **separate page file** rather than
 * `app/pages/reports/summary.vue`: Nuxt would then treat it as a child of `app/pages/reports.vue`, which has
 * no `<NuxtPage>`, and `/reports` would stop rendering (F5). `definePageMeta({ path: '/reports/summary' })`
 * gives it the nested-looking URL anyway; vue-router prefers the longer static path, so both routes coexist
 * (verified in the browser loop below).
 *
 * Same URL-state pattern as `/reports` (`app/pages/reports.vue`, not edited here — G-4): every filter, the
 * range, the search, both sorts and the page live in the query, so the screen is shareable and the back
 * button works; the query is the only thing that triggers a request. Exactly one `GET /reports/grouped` +
 * one `GET /reports/ads` (through `useApi()` → `/backend`) per load / Refresh / state change, both `retry: 0`,
 * a late answer of a superseded pair dropped by a session counter. **No polling.**
 *
 * Table 1 (`ReportSummaryGroupTable`) sorts **client-side** (`gsort`, no request — the whole grouped set is
 * already on the client, AS-3/AS-9); table 2 (`ReportSummaryAdsTable`) sorts and paginates **server-side**
 * (`sort`/`page`, same as `/reports`). Both footers come from the responses' `totals`, never from summing the
 * rows on screen. Neither table shows balance, even if a stubbed row carries it (FEAT-034 owns balance).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdReportRow, AdsReportResponse, AdState } from '#shared/types/reports'
import type { GroupedReportResponse } from '#shared/types/report-summary'

useSeoMeta({ title: 'Report summary' })
definePageMeta({ path: '/reports/summary' })

const LIMIT = 50
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

const range = computed(() => parseRange(route.query.range))
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const sort = computed(() => parseAdsSort(queryString('sort')))
const gsort = computed(() => queryString('gsort') ?? DEFAULT_SORT)
const workspaceId = computed(() => queryString('workspaceId') ?? 'all')
const accountId = computed(() => queryString('tiktokAccountId') ?? 'all')
const advertiserId = computed(() => queryString('advertiserId') ?? 'all')
const orderId = computed(() => queryString('orderId') ?? 'all')
const AD_STATES: AdState[] = ['delivering', 'pending', 'rejected', 'ended', 'unknown']
const stateFilter = computed<'all' | AdState>(() => {
  const value = queryString('state')
  return AD_STATES.includes(value as AdState) ? value as AdState : 'all'
})
const linkedFilter = computed<'all' | 'true' | 'false'>(() => {
  const value = queryString('linked')
  return value === 'true' || value === 'false' ? value : 'all'
})
const searchQuery = computed(() => queryString('search') ?? '')

const search = ref(searchQuery.value)
const searchDebounced = refDebounced(search, DEBOUNCE_MS)

function orUndefined(value: string): string | undefined {
  return value === 'all' ? undefined : value
}

/**
 * Merge a patch into the URL query. Any change other than `page`/`gsort` resets `page` (contract §3.2):
 * `gsort` never triggers a request, so leaving the page alone there is harmless; a real filter/range/search/
 * sort change always starts table 2 back at page 1.
 */
function setQuery(patch: Record<string, string | undefined>, keepPage = false) {
  const merged = { ...route.query, ...patch }
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (!keepPage && key === 'page') continue
    if (typeof value === 'string' && value !== '') next[key] = value
  }
  void router.replace({ query: next })
}

watch(searchDebounced, (value) => {
  if (value.trim() === searchQuery.value) return
  setQuery({ search: value.trim() || undefined })
})
watch(searchQuery, (value) => {
  if (value !== search.value.trim()) search.value = value
})

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const grouped = ref<GroupedReportResponse | null>(null)
const rows = ref<AdReportRow[]>([])
const total = ref(0)
const adsTotals = ref<AdsReportResponse['totals'] | null>(null)
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

/** workspaces/accounts/advertisers come from the grouped response only (contract §3 "Options"). */
function rememberFromGrouped(response: GroupedReportResponse) {
  for (const account of response.accounts) {
    remember(knownWorkspaces, account.workspace.id, account.workspace.name)
    remember(knownAccounts, account.account.id, account.account.label)
    for (const advertiser of account.advertisers) {
      remember(knownAdvertisers, advertiser.advertiser.id, advertiser.advertiser.name)
    }
  }
}

/** orders come from the ads rows only — there is no order inside the grouped response. */
function rememberOrdersFromRows(list: AdReportRow[]) {
  for (const row of list) {
    remember(knownOrders, row.order?.id, row.order?.name)
  }
}

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
    orderId: orderId.value === 'all' ? undefined : orderId.value,
    state: stateFilter.value === 'all' ? undefined : stateFilter.value,
    linked: linkedFilter.value === 'all' ? undefined : linkedFilter.value,
    search: searchQuery.value || undefined
  }
}

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  rememberFromQuery()
  try {
    // retry: 0 — exactly one grouped + one ads request per change (api-contract §3.2)
    const [groupedRes, adsRes] = await Promise.all([
      api<GroupedReportResponse>('/reports/grouped', {
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
          ...filterQuery()
        }
      })
    ])
    if (s !== session) return
    grouped.value = groupedRes
    rows.value = adsRes.ads ?? []
    total.value = adsRes.total ?? rows.value.length
    adsTotals.value = adsRes.totals ?? null
    rememberFromGrouped(groupedRes)
    rememberOrdersFromRows(rows.value)
    loaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    grouped.value = null
    rows.value = []
    total.value = 0
    adsTotals.value = null
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

/** every key that must re-issue the request pair — `gsort` is deliberately excluded (client-side only) */
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

const isEmpty = computed(() =>
  loaded.value && !error.value && !forbidden.value && (grouped.value?.adCount ?? 0) === 0 && total.value === 0 && !hasFilter.value
)
const isNoMatch = computed(() =>
  loaded.value && !error.value && !forbidden.value && (grouped.value?.adCount ?? 0) === 0 && total.value === 0 && hasFilter.value
)
const showTables = computed(() => !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value)
const showSkeleton = computed(() => pending.value && !loaded.value && !error.value && !forbidden.value)

// ── header ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const intervalText = computed(() => {
  const phrase = intervalPhraseTh(grouped.value?.intervalMs ?? 300_000)
  const refreshedAt = grouped.value?.refreshedAt ?? null
  const last = refreshedAt ? `${formatClock(refreshedAt)} (${timeAgoTh(refreshedAt, nowMs.value)})` : REPORT_DASH
  return `อัปเดตทุก ${phrase} · ล่าสุด ${last}`
})

const RANGES = ['today', '7d', 'all'] as const

function setRange(value: 'today' | '7d' | 'all') {
  setQuery({ range: value === 'today' ? undefined : value })
}

function setSort(value: string) {
  setQuery({ sort: value === DEFAULT_SORT ? undefined : value })
}

function setGroupSort(value: string) {
  // client-side only — never resets table 2's page, never issues a request (gsort is outside queryKey)
  setQuery({ gsort: value === DEFAULT_SORT ? undefined : value }, true)
}

function setPage(value: number) {
  setQuery({ page: value > 1 ? String(value) : undefined }, true)
}
</script>

<template>
  <UDashboardPanel id="report-summary">
    <template #header>
      <UDashboardNavbar title="Report summary">
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
              :data-testid="`rs-range-${key}`"
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
            data-testid="rs-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rs-page"
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
          data-testid="rs-forbidden"
        />

        <template v-else>
          <p class="text-sm text-muted" data-testid="rs-interval">
            {{ intervalText }}
          </p>

          <!-- filters -->
          <div class="flex flex-wrap items-center gap-1.5">
            <UInput
              v-model="search"
              class="w-full sm:max-w-xs"
              icon="i-lucide-search"
              placeholder="ค้นหาชื่อโฆษณา / กลุ่มโฆษณา / แคมเปญ"
              aria-label="ค้นหา"
              data-testid="rs-search"
            />
            <USelect
              v-if="showWorkspaceFilter"
              :model-value="workspaceId"
              :items="workspaceItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Workspace"
              data-testid="rs-filter-workspace"
              @update:model-value="(v: string) => setQuery({ workspaceId: orUndefined(v) })"
            />
            <USelect
              :model-value="accountId"
              :items="accountItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Account"
              data-testid="rs-filter-account"
              @update:model-value="(v: string) => setQuery({ tiktokAccountId: orUndefined(v) })"
            />
            <USelect
              :model-value="advertiserId"
              :items="advertiserItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Advertiser"
              data-testid="rs-filter-advertiser"
              @update:model-value="(v: string) => setQuery({ advertiserId: orUndefined(v) })"
            />
            <USelect
              :model-value="orderId"
              :items="orderItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Order"
              data-testid="rs-filter-order"
              @update:model-value="(v: string) => setQuery({ orderId: orUndefined(v) })"
            />
            <USelect
              :model-value="stateFilter"
              :items="STATE_ITEMS"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-32"
              aria-label="สถานะ"
              data-testid="rs-filter-state"
              @update:model-value="(v: string) => setQuery({ state: orUndefined(v) })"
            />
            <USelect
              :model-value="linkedFilter"
              :items="LINKED_ITEMS"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-32"
              aria-label="ที่มา"
              data-testid="rs-filter-linked"
              @update:model-value="(v: string) => setQuery({ linked: orUndefined(v) })"
            />
            <UButton
              v-if="hasFilter"
              label="ล้างตัวกรอง"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              data-testid="rs-clear"
              @click="clearFilters"
            />
          </div>

          <div v-if="showSkeleton" class="flex flex-col gap-2" data-testid="rs-loading">
            <USkeleton class="h-40 w-full" />
            <USkeleton class="h-40 w-full" />
          </div>

          <UAlert
            v-else-if="error"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายงานไม่สำเร็จ"
            :description="error"
            data-testid="rs-error"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rs-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <UEmpty
            v-else-if="isEmpty"
            icon="i-lucide-chart-no-axes-combined"
            title="ยังไม่มีโฆษณาในรายงาน"
            data-testid="rs-empty"
          >
            <template #actions>
              <UButton
                label="Launch ads"
                icon="i-lucide-rocket"
                color="primary"
                to="/launch-ads"
                data-testid="rs-empty-launch"
              />
            </template>
          </UEmpty>

          <UEmpty
            v-else-if="isNoMatch"
            icon="i-lucide-search-x"
            title="ไม่มีโฆษณาที่ตรงกับตัวกรอง"
            data-testid="rs-nomatch"
          >
            <template #actions>
              <UButton
                label="ล้างตัวกรอง"
                icon="i-lucide-x"
                color="neutral"
                variant="outline"
                data-testid="rs-clear-nomatch"
                @click="clearFilters"
              />
            </template>
          </UEmpty>

          <template v-else-if="showTables && grouped">
            <ReportSummaryGroupTable
              :accounts="grouped.accounts"
              :totals="grouped.totals"
              :ad-count="grouped.adCount"
              :advertiser-count="grouped.advertiserCount"
              :account-count="grouped.accountCount"
              :sort="gsort"
              :pending="pending"
              @update:sort="setGroupSort"
            />

            <ReportSummaryAdsTable
              :rows="rows"
              :total="total"
              :totals="adsTotals"
              :sort="sort"
              :page="page"
              :limit="LIMIT"
              :pending="pending"
              @update:sort="setSort"
              @update:page="setPage"
            />
          </template>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
