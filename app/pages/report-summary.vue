<script setup lang="ts">
/**
 * FEAT-035 — Report summary (api-contract.md §3; spec AC-8…AC-17, amended by Amendment A1 / contract v1.2).
 * A **separate page file** rather than `app/pages/reports/summary.vue`: Nuxt would then treat it as a child of
 * `app/pages/reports.vue`, which has no `<NuxtPage>`, and `/reports` would stop rendering (F5).
 * `definePageMeta({ path: '/reports/summary' })` gives it the nested-looking URL anyway; vue-router prefers the
 * longer static path, so both routes coexist (verified in the browser loop below).
 *
 * Same URL-state pattern as `/reports` (`app/pages/reports.vue`, not edited here — G-4): every filter, the range
 * and the search live in the query, so the screen is shareable and the back button works; the query is the only
 * thing that triggers a request. **One table, one request**: exactly one `GET /reports/grouped` (through
 * `useApi()` → `/backend`) per load / Refresh / state change, `retry: 0`, a late answer of a superseded request
 * dropped by a session counter. **No polling.**
 *
 * Contract v1.2 (human review "เอา section ที่ 2 ออก") removed table 2 (`GET /reports/ads`) entirely: no `sort`/
 * `page` URL state (an old link carrying them is ignored and never sent to the API) and no `rs-filter-order`
 * (its options came from the ads rows, which no longer exist). An `orderId` arriving in the URL — e.g. a link
 * from `/reports` — is still forwarded to `/reports/grouped` as a filter and cleared by `rs-clear`; there is just
 * no UI control to set it from this page.
 *
 * The one surviving table (`ReportSummaryGroupTable`) sorts **client-side** (`gsort`, no request — the whole
 * grouped set is already on the client, AS-3/AS-9). Its footer comes from the response's `totals`, never from
 * summing the rows on screen. It never shows balance, even if a stubbed row carried it (FEAT-034 owns balance).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdState } from '#shared/types/reports'
import type { GroupedReportResponse } from '#shared/types/report-summary'

useSeoMeta({ title: 'Report summary' })
definePageMeta({ path: '/reports/summary' })

const DEBOUNCE_MS = 300
const DEFAULT_GROUP_SORT = '-spend'

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
const gsort = computed(() => queryString('gsort') ?? DEFAULT_GROUP_SORT)
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

/** Merge a patch into the URL query (contract §3.2 v1.2 — no `page` left to preserve/reset any more). */
function setQuery(patch: Record<string, string | undefined>) {
  const merged = { ...route.query, ...patch }
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
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
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
let session = 0

const knownWorkspaces = ref<{ id: string, name: string }[]>([])
const knownAccounts = ref<{ id: string, name: string }[]>([])
const knownAdvertisers = ref<{ id: string, name: string }[]>([])

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

function rememberFromQuery() {
  remember(knownWorkspaces, queryString('workspaceId'), null)
  remember(knownAccounts, queryString('tiktokAccountId'), null)
  remember(knownAdvertisers, queryString('advertiserId'), null)
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
    // retry: 0 — exactly one grouped request per change (contract v1.2 §3.2)
    const groupedRes = await api<GroupedReportResponse>('/reports/grouped', {
      retry: 0,
      query: { range: range.value, ...filterQuery() }
    })
    if (s !== session) return
    grouped.value = groupedRes
    rememberFromGrouped(groupedRes)
    loaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    grouped.value = null
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

/** every key that must re-issue the request — `gsort` is deliberately excluded (client-side only) */
const queryKey = computed(() => JSON.stringify([
  range.value, searchQuery.value, workspaceId.value,
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
  loaded.value && !error.value && !forbidden.value && (grouped.value?.adCount ?? 0) === 0 && !hasFilter.value
)
const isNoMatch = computed(() =>
  loaded.value && !error.value && !forbidden.value && (grouped.value?.adCount ?? 0) === 0 && hasFilter.value
)
const showTable = computed(() => !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value)
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

function setGroupSort(value: string) {
  // client-side only — never issues a request (gsort is outside queryKey)
  setQuery({ gsort: value === DEFAULT_GROUP_SORT ? undefined : value })
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

          <template v-else-if="showTable && grouped">
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
          </template>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
