<script setup lang="ts">
/**
 * FEAT-056 — Ads monitor (`/ads-monitor`, api-contract.md v1 §3/§4; spec "UI behaviour", AC-19…AC-24).
 * Three **independent** tabs (Campaign · Ad group · Ad) under **one** filter bar: the tab only decides which
 * endpoint is called (`/ads-monitor/campaigns | ad-groups | ads`), every filter survives a tab switch and the
 * page resets to 1 (AC-19).
 *
 * URL is the only state (same pattern as `/reports/summary` and `/reports/banned`, neither edited here):
 * `?tab=&range=&workspaceId=&tiktokAccountId=&advertiserId=&orderId=&status=&linked=&q=&page=`. Defaults
 * (`tab=campaign`, `range=today`, `status=all`, linked **on**, `page=1`) are omitted from the URL and always
 * sent explicitly in the request, so a stub can assert the exact query. `retry: 0` + a session counter ⇒
 * exactly one request per state change and a superseded answer is dropped. **No polling** (spec A13): a
 * pending switch clears on the next reload / tab switch / Refresh.
 *
 * TASK-campaign-delete-ui — the campaign tab can also **delete** a campaign on TikTok
 * (`POST /ads-monitor/delete-campaign`, confirm modal `am-delete-modal`); the `ads` rows are never deleted, so
 * a deleted campaign keeps showing up with `status.key = 'deleted'` and is filterable through `status=deleted`.
 *
 * Filter options come from the same two side endpoints `/reports/banned` uses (`GET /tiktok-accounts` once,
 * `GET /advertisers?limit=100[&tiktokAccountId]` on mount and per account change, failures swallowed — they
 * must never block the table); order options can only come from the rows, the contract has no order lookup.
 */
import type { FetchError } from 'ofetch'
import type { Advertiser, AdvertisersResponse } from '#shared/types/advertisers'
import type {
  AdsMonitorResponse,
  DeleteAccepted,
  MonitorLevel,
  MonitorLinkedFilter,
  MonitorRange,
  MonitorRow,
  MonitorStatusFilter,
  ToggleAccepted,
  ToggleTarget
} from '#shared/types/ads-monitor'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AccountsResponse, TikTokAccount } from '#shared/types/tiktok-accounts'

useSeoMeta({ title: 'Ads monitor' })

const LIMIT = 20
const DEBOUNCE_MS = 300
const Q_MAX = 100

const TABS: { value: MonitorLevel, label: string, path: string }[] = [
  { value: 'campaign', label: 'Campaign', path: '/ads-monitor/campaigns' },
  { value: 'adGroup', label: 'Ad group', path: '/ads-monitor/ad-groups' },
  { value: 'ad', label: 'Ad', path: '/ads-monitor/ads' }
]

const STATUS_ITEMS: { label: string, value: MonitorStatusFilter }[] = [
  { label: 'ทั้งหมด', value: 'all' },
  { label: 'ใช้งานอยู่', value: 'delivering' },
  { label: 'ไม่ส่ง', value: 'notDelivering' },
  { label: 'หยุดชั่วคราว', value: 'paused' },
  { label: 'ไม่ผ่าน/ถูกลงโทษ', value: 'rejected' },
  { label: 'อื่น ๆ', value: 'other' },
  // TASK-campaign-delete-ui — the API's new top-priority key; filterable like the other five
  { label: 'ลบแล้ว', value: 'deleted' }
]

const RANGES: MonitorRange[] = ['today', '7d', 'all']

const route = useRoute()
const router = useRouter()
const api = useApi()
const toast = useToast()
const nowDate = useNow({ interval: 30_000 })
const nowMs = computed(() => nowDate.value.getTime())

// ── url state ────────────────────────────────────────────────────────────────────────────────────────────────────────
function queryString(key: string): string | undefined {
  const value = route.query[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

const tab = computed<MonitorLevel>(() => {
  const value = queryString('tab')
  return TABS.some(item => item.value === value) ? value as MonitorLevel : 'campaign'
})
const range = computed<MonitorRange>(() => {
  const value = queryString('range')
  return value === '7d' || value === 'all' ? value : 'today'
})
const status = computed<MonitorStatusFilter>(() => {
  const value = queryString('status')
  return STATUS_ITEMS.some(item => item.value === value && value !== 'all') ? value as MonitorStatusFilter : 'all'
})
/** the switch is "เฉพาะจากระบบ": on ⇒ `linked=true` (default, URL empty) · off ⇒ `linked=all` */
const linked = computed<MonitorLinkedFilter>(() => (queryString('linked') === 'all' ? 'all' : 'true'))
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const workspaceId = computed(() => queryString('workspaceId') ?? 'all')
const accountId = computed(() => queryString('tiktokAccountId') ?? 'all')
const advertiserId = computed(() => queryString('advertiserId') ?? 'all')
const orderId = computed(() => queryString('orderId') ?? 'all')
const searchQuery = computed(() => (queryString('q') ?? '').slice(0, Q_MAX))

const search = ref(searchQuery.value)
const searchDebounced = refDebounced(search, DEBOUNCE_MS)

function orUndefined(value: string): string | undefined {
  return value === 'all' ? undefined : value
}

/** Merge a patch into the URL query; any change other than `page` itself resets `page` unless `keepPage`. */
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
  const trimmed = value.trim().slice(0, Q_MAX)
  if (trimmed === searchQuery.value) return
  setQuery({ q: trimmed || undefined })
})
watch(searchQuery, (value) => {
  if (value !== search.value.trim()) search.value = value
})

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const data = ref<AdsMonitorResponse | null>(null)
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
let session = 0

/**
 * Switch / delete state the client knows but the server has not told us yet (our own accepted 202). Dropped
 * on every load, because the response is then the truth again — so the optimistic "กำลังลบ…" survives a
 * re-render but never outlives a reload, where the API's own `deletePending` takes over (TASK-campaign-delete-ui).
 */
type RowOverride = Partial<Pick<MonitorRow, 'optPending' | 'optError' | 'deletePending' | 'deleteError'>>
const overrides = ref<Record<string, RowOverride>>({})
/** guards a double click from sending a second POST before the first one answered */
const inFlight = new Set<string>()

function rowKey(row: Pick<MonitorRow, 'level' | 'id'>): string {
  return `${row.level}:${row.id}`
}

const rows = computed<MonitorRow[]>(() =>
  (data.value?.rows ?? []).map((row) => {
    const override = overrides.value[rowKey(row)]
    return override ? { ...row, ...override } : row
  })
)

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

function rememberFromRows(list: MonitorRow[]) {
  for (const row of list) {
    remember(knownWorkspaces, row.workspace.id, row.workspace.name)
    remember(knownAccounts, row.account.id, row.account.label)
    remember(knownAdvertisers, row.advertiser.id, row.advertiser.name)
    for (const id of row.orderIds) remember(knownOrders, id, null)
  }
}

function rememberFromAccounts(accounts: TikTokAccount[]) {
  for (const account of accounts) {
    remember(knownAccounts, account.id, account.label || account.loginEmail)
    remember(knownWorkspaces, account.workspaceId, null)
  }
}

function rememberFromAdvertisers(advertisers: Advertiser[]) {
  for (const advertiser of advertisers) remember(knownAdvertisers, advertiser.id, advertiser.name)
}

function rememberFromQuery() {
  remember(knownWorkspaces, queryString('workspaceId'), null)
  remember(knownAccounts, queryString('tiktokAccountId'), null)
  remember(knownAdvertisers, queryString('advertiserId'), null)
  remember(knownOrders, queryString('orderId'), null)
}

const endpoint = computed(() => TABS.find(item => item.value === tab.value)!.path)

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  rememberFromQuery()
  try {
    // retry: 0 — exactly one request per load / Refresh / state change (AC-19)
    const res = await api<AdsMonitorResponse>(endpoint.value, {
      retry: 0,
      query: {
        range: range.value,
        status: status.value,
        linked: linked.value,
        page: page.value,
        limit: LIMIT,
        workspaceId: orUndefined(workspaceId.value),
        tiktokAccountId: orUndefined(accountId.value),
        advertiserId: orUndefined(advertiserId.value),
        orderId: orUndefined(orderId.value),
        q: searchQuery.value || undefined
      }
    })
    if (s !== session) return
    data.value = res
    overrides.value = {}
    rememberFromRows(res.rows)
    loaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    data.value = null
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

/** account options — once on mount; a failure leaves the dropdown empty, never an error state. */
async function loadAccounts() {
  try {
    const res = await api<AccountsResponse>('/tiktok-accounts', { retry: 0 })
    rememberFromAccounts(res.accounts)
  } catch {
    // swallowed on purpose — options are a convenience, the table must still render
  }
}

/** advertiser options — on mount and on every account change. */
async function loadAdvertisers() {
  try {
    const res = await api<AdvertisersResponse>('/advertisers', {
      retry: 0,
      query: { limit: 100, tiktokAccountId: orUndefined(accountId.value) }
    })
    knownAdvertisers.value = []
    rememberFromAdvertisers(res.advertisers)
    rememberFromQuery()
  } catch {
    // swallowed — same rule as the account options
  }
}

const queryKey = computed(() => JSON.stringify([
  tab.value, range.value, status.value, linked.value, page.value,
  workspaceId.value, accountId.value, advertiserId.value, orderId.value, searchQuery.value
]))

watch(queryKey, () => {
  void load()
})

watch(accountId, () => {
  void loadAdvertisers()
})

onMounted(() => {
  void load()
  void loadAccounts()
  void loadAdvertisers()
})

onUnmounted(() => {
  session++
})

// ── "view all ad images" modal (T11, api-contract.md v1.3 §8.3) ────────────────────────────────────────────────────
const coversOpen = ref(false)
const coversRow = ref<MonitorRow | null>(null)

function showCovers(row: MonitorRow) {
  coversRow.value = row
  coversOpen.value = true
}

// ── toggle ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * One POST per press, no confirm dialog (brief §0.4). 202 → the row renders `am-switch-pending` from the
 * returned `optPending`; 409 → the API's own Thai sentence in a "ทำไม่ได้" toast + one re-read of this tab.
 */
async function toggle(row: MonitorRow, target: ToggleTarget) {
  const key = rowKey(row)
  if (inFlight.has(key)) return
  inFlight.add(key)
  try {
    const res = await api<ToggleAccepted>('/ads-monitor/toggle', {
      retry: 0,
      method: 'POST',
      body: { advertiserId: row.advertiser.id, level: row.level, tiktokId: row.id, target }
    })
    overrides.value = { ...overrides.value, [key]: { optPending: res.optPending, optError: null } }
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'เปลี่ยนสวิตช์ไม่สำเร็จ'
    if ((err.response?.status ?? err.statusCode) === 409) {
      toast.add({ title: 'ทำไม่ได้', description: message, icon: 'i-lucide-triangle-alert', color: 'warning' })
      await load()
    } else {
      toast.add({ title: 'เปลี่ยนสวิตช์ไม่สำเร็จ', description: message, icon: 'i-lucide-triangle-alert', color: 'error' })
    }
  } finally {
    inFlight.delete(key)
  }
}

// ── delete campaign (TASK-campaign-delete-ui · `POST /ads-monitor/delete-campaign`) ─────────────────────────────────
/**
 * Campaign tab only, always behind the `am-delete-modal` confirm step. 202 → the row renders
 * `am-delete-pending-<id>` from the returned `deletePending` through the same `overrides` mechanism as the
 * toggle (reload-safe: after a reload the API's own `deletePending` says the same); 409 → the API's Thai
 * sentence in a "ทำไม่ได้" toast plus one re-read of this tab, exactly like `toggle()`; anything else → a
 * generic error toast. No polling — the row clears on the next reload / tab switch / Refresh (spec A13).
 */
const deleteOpen = ref(false)
const deleteRow = ref<MonitorRow | null>(null)
const deleting = ref(false)

function askDelete(row: MonitorRow) {
  deleteRow.value = row
  deleteOpen.value = true
}

async function confirmDelete(row: MonitorRow) {
  const key = rowKey(row)
  if (inFlight.has(key)) return
  inFlight.add(key)
  deleting.value = true
  try {
    const res = await api<DeleteAccepted>('/ads-monitor/delete-campaign', {
      retry: 0,
      method: 'POST',
      body: { advertiserId: row.advertiser.id, tiktokCampaignId: row.id }
    })
    overrides.value = { ...overrides.value, [key]: { deletePending: res.deletePending, deleteError: null } }
    deleteOpen.value = false
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'ลบแคมเปญไม่สำเร็จ'
    deleteOpen.value = false
    if ((err.response?.status ?? err.statusCode) === 409) {
      toast.add({ title: 'ทำไม่ได้', description: message, icon: 'i-lucide-triangle-alert', color: 'warning' })
      await load()
    } else {
      toast.add({ title: 'ลบแคมเปญไม่สำเร็จ', description: message, icon: 'i-lucide-triangle-alert', color: 'error' })
    }
  } finally {
    deleting.value = false
    inFlight.delete(key)
  }
}

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
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
  || status.value !== 'all'
  || linked.value !== 'true'
)

function clearFilters() {
  search.value = ''
  setQuery({
    q: undefined,
    workspaceId: undefined,
    tiktokAccountId: undefined,
    advertiserId: undefined,
    orderId: undefined,
    status: undefined,
    linked: undefined
  })
}

/** an account change also drops `advertiserId` (its options are bound to the account) */
function setAccount(value: string) {
  setQuery({ tiktokAccountId: orUndefined(value), advertiserId: undefined })
}

function setTab(value: MonitorLevel) {
  if (value === tab.value) return
  setQuery({ tab: value === 'campaign' ? undefined : value })
}

function setRange(value: MonitorRange) {
  setQuery({ range: value === 'today' ? undefined : value })
}

function setLinked(value: boolean) {
  setQuery({ linked: value ? undefined : 'all' })
}

function setPage(value: number) {
  setQuery({ page: value > 1 ? String(value) : undefined }, true)
}

/** mobile only — the filter bar collapses behind `am-filters-toggle` under the `sm` breakpoint */
const filtersOpen = ref(false)

// ── states ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const total = computed(() => data.value?.total ?? 0)
const unfilteredTotal = computed(() => data.value?.unfilteredTotal ?? 0)
const settled = computed(() => loaded.value && !error.value && !forbidden.value)
const isEmpty = computed(() => settled.value && unfilteredTotal.value === 0)
const isNoMatch = computed(() => settled.value && unfilteredTotal.value > 0 && total.value === 0)
const showTable = computed(() => !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value)
const showSkeleton = computed(() => pending.value && !loaded.value && !error.value && !forbidden.value)

const rangeFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * LIMIT + 1))
const rangeTo = computed(() => Math.min(page.value * LIMIT, total.value))

const intervalText = computed(() => {
  const phrase = intervalPhraseTh(data.value?.intervalMs ?? 300_000)
  const refreshedAt = data.value?.refreshedAt ?? null
  const last = refreshedAt ? `${formatClock(refreshedAt)} (${timeAgoTh(refreshedAt, nowMs.value)})` : REPORT_DASH
  return `อัปเดตทุก ${phrase} · ล่าสุด ${last}`
})
</script>

<template>
  <UDashboardPanel id="ads-monitor">
    <template #header>
      <UDashboardNavbar title="Ads monitor">
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
              :data-testid="`am-range-${key}`"
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
            data-testid="am-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="am-page"
        :data-tab="tab"
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
          data-testid="am-forbidden"
        />

        <template v-else>
          <p class="text-sm text-muted" data-testid="am-interval">
            {{ intervalText }}
          </p>

          <!-- tabs: a segmented control on mobile, an underlined tab bar from `sm` up -->
          <div
            class="flex w-full gap-1 rounded-lg bg-elevated/50 p-1 sm:w-auto sm:gap-4 sm:rounded-none sm:bg-transparent sm:p-0"
            role="tablist"
            aria-label="ระดับโฆษณา"
          >
            <button
              v-for="item in TABS"
              :key="item.value"
              type="button"
              role="tab"
              :aria-selected="tab === item.value"
              class="flex-1 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap sm:flex-none sm:rounded-none sm:border-b-2 sm:px-1 sm:py-2"
              :class="tab === item.value
                ? 'bg-default text-highlighted shadow-xs sm:bg-transparent sm:border-primary sm:text-primary'
                : 'text-muted sm:border-transparent hover:text-default'"
              :data-testid="`am-tab-${item.value}`"
              @click="setTab(item.value)"
            >
              {{ item.label }}
            </button>
          </div>

          <!-- filters: one bar for all tabs; collapsed behind a button under `sm` -->
          <UButton
            :label="`ตัวกรอง${hasFilter ? ' •' : ''}`"
            icon="i-lucide-sliders-horizontal"
            color="neutral"
            variant="outline"
            size="sm"
            class="self-start sm:hidden"
            :aria-expanded="filtersOpen"
            data-testid="am-filters-toggle"
            @click="filtersOpen = !filtersOpen"
          />
          <div
            class="flex-wrap items-center gap-1.5 sm:flex"
            :class="filtersOpen ? 'flex' : 'hidden'"
            data-testid="am-filters"
          >
            <UInput
              v-model="search"
              class="w-full sm:max-w-xs"
              icon="i-lucide-search"
              :maxlength="Q_MAX"
              placeholder="ค้นหาชื่อ / ID"
              aria-label="ค้นหา"
              data-testid="am-search"
            />
            <USelect
              v-if="showWorkspaceFilter"
              :model-value="workspaceId"
              :items="workspaceItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Workspace"
              data-testid="am-filter-workspace"
              @update:model-value="(v: string) => setQuery({ workspaceId: orUndefined(v) })"
            />
            <USelect
              :model-value="accountId"
              :items="accountItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Account"
              data-testid="am-filter-account"
              @update:model-value="(v: string) => setAccount(v)"
            />
            <USelect
              :model-value="advertiserId"
              :items="advertiserItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Advertiser"
              data-testid="am-filter-advertiser"
              @update:model-value="(v: string) => setQuery({ advertiserId: orUndefined(v) })"
            />
            <USelect
              :model-value="orderId"
              :items="orderItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-32"
              aria-label="Order"
              data-testid="am-filter-order"
              @update:model-value="(v: string) => setQuery({ orderId: orUndefined(v) })"
            />
            <USelect
              :model-value="status"
              :items="STATUS_ITEMS"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-32"
              aria-label="สถานะ"
              data-testid="am-filter-status"
              @update:model-value="(v: string) => setQuery({ status: orUndefined(v) })"
            />
            <USwitch
              :model-value="linked === 'true'"
              label="เฉพาะจากระบบ"
              data-testid="am-filter-linked"
              @update:model-value="setLinked"
            />
            <UButton
              v-if="hasFilter"
              label="ล้างตัวกรอง"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              data-testid="am-clear"
              @click="clearFilters"
            />
          </div>

          <div v-if="showSkeleton" class="flex flex-col gap-2" data-testid="am-loading">
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
            data-testid="am-error"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="am-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <UEmpty
            v-else-if="isEmpty"
            icon="i-lucide-toggle-left"
            title="ยังไม่มีโฆษณาในช่วงที่เลือก"
            data-testid="am-empty"
          />

          <UEmpty
            v-else-if="isNoMatch"
            icon="i-lucide-search-x"
            title="ไม่มีแถวที่ตรงกับตัวกรอง"
            data-testid="am-nomatch"
          >
            <template #actions>
              <UButton
                label="ล้างตัวกรอง"
                icon="i-lucide-x"
                color="neutral"
                variant="outline"
                data-testid="am-clear-nomatch"
                @click="clearFilters"
              />
            </template>
          </UEmpty>

          <template v-else-if="showTable && data">
            <AdsMonitorTable
              :level="tab"
              :rows="rows"
              :totals="data.totals"
              :pending="pending"
              @toggle="toggle"
              @show-covers="showCovers"
              @delete="askDelete"
            />

            <div class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted">
              <span data-testid="am-count">แสดง {{ rangeFrom }}–{{ rangeTo }} จาก {{ total }}</span>

              <UPagination
                v-if="total > LIMIT"
                :page="page"
                :items-per-page="LIMIT"
                :total="total"
                data-testid="am-pagination"
                @update:page="setPage"
              />
            </div>
          </template>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <AdsMonitorCoversModal v-model:open="coversOpen" :row="coversRow" />

  <AdsMonitorDeleteModal
    v-model:open="deleteOpen"
    :row="deleteRow"
    :deleting="deleting"
    @confirm="confirmDelete"
  />
</template>
