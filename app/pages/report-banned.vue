<script setup lang="ts">
/**
 * FEAT-043 — Report Banned accounts (api-contract.md §3.2; spec G-2, AC-9…AC-16). A **separate page file**
 * rather than `app/pages/reports/banned.vue`: Nuxt would then treat it as a child of `app/pages/reports.vue`,
 * which has no `<NuxtPage>`, and `/reports` would stop rendering (FEAT-035 F5, reused here verbatim).
 * `definePageMeta({ path: '/reports/banned' })` gives it the nested-looking URL anyway.
 *
 * Same URL-state pattern as `/reports/summary` (`app/pages/report-summary.vue`, not edited here): every
 * filter, the range and the page live in the query, so the screen is shareable and the back button works.
 * One flat table (no grouping, no client sort — the API fixes the order), **no search** (not in the contract).
 *
 * Three requests, independent cadence (contract §3.2):
 * - `GET /reports/banned` — one per load / Refresh / any state change (`retry: 0`, session counter drops a
 *   late answer of a superseded request). `range`, `page`, `limit=50` are always sent explicitly even though
 *   the URL omits their defaults (AS-9), so stubs can assert the exact query.
 * - `GET /tiktok-accounts` — once on mount only, account filter options; a failure is swallowed (options stay
 *   empty, no error state — it must never block the table).
 * - `GET /advertisers?limit=100[&tiktokAccountId]` — on mount and again whenever `tiktokAccountId` changes,
 *   advertiser filter options bound to the selected account; failure swallowed likewise.
 * No polling anywhere on this page.
 *
 * FEAT-056 adds two things and changes nothing else (every `rb-*` test id of FEAT-043/047 stays):
 * - a fourth range button **กำหนดเอง** (`rb-range-custom`) with two date inputs (`rb-from` / `rb-to`) →
 *   `range=custom&from=&to=`. An incomplete or impossible pair renders `rb-range-invalid` and issues **no**
 *   request at all (AC-25), so the API never sees a 400 from this page.
 * - an expandable per-advertiser campaign table: `rb-expand` → `GET /reports/banned/:id/campaigns` with the
 *   **same** range query, once per (row, range); the cache is dropped and the open rows reload when the range
 *   changes. The state lives here (the page owns `useApi()`), the rendering in `ReportBannedCampaigns`.
 */
import type { FetchError } from 'ofetch'
import type { Advertiser, AdvertisersResponse } from '#shared/types/advertisers'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  BannedCampaignsResponse,
  BannedCampaignsState,
  BannedRange,
  BannedReportResponse,
  BannedRow
} from '#shared/types/report-banned'
import type { AccountsResponse, TikTokAccount } from '#shared/types/tiktok-accounts'

useSeoMeta({ title: 'Report Banned accounts' })
definePageMeta({ path: '/reports/banned' })

const LIMIT = 50

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

/** Unlike `/reports`/`/reports/summary` the default range here is `all` — an unknown value also falls to `all` (contract §3.2). */
function parseBannedRange(value: unknown): BannedRange {
  return value === 'today' || value === '7d' || value === 'custom' ? value : 'all'
}

const range = computed<BannedRange>(() => parseBannedRange(route.query.range))
const customFrom = computed(() => queryString('from') ?? '')
const customTo = computed(() => queryString('to') ?? '')

const DAY_MS = 86_400_000
const MAX_RANGE_DAYS = 366
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function dayMs(value: string): number {
  return Date.parse(`${value}T00:00:00Z`)
}

/**
 * Thai reason why the custom pair cannot be sent, `null` when it is fine (contract §6.1: both required,
 * `from ≤ to`, at most 366 days apart). Mirrors the API's `superRefine` so the page never fires a 400.
 */
const rangeInvalid = computed<string | null>(() => {
  if (range.value !== 'custom') return null
  const from = customFrom.value
  const to = customTo.value
  if (!ISO_DAY_RE.test(from) || !ISO_DAY_RE.test(to)) return 'เลือกวันที่เริ่มต้นและวันสิ้นสุด'
  const fromMs = dayMs(from)
  const toMs = dayMs(to)
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 'รูปแบบวันที่ไม่ถูกต้อง'
  if (toMs < fromMs) return 'วันสิ้นสุดต้องไม่น้อยกว่าวันเริ่มต้น'
  if ((toMs - fromMs) / DAY_MS > MAX_RANGE_DAYS) return `ช่วงเวลาต้องไม่เกิน ${MAX_RANGE_DAYS} วัน`
  return null
})

/** The range part of every request this page makes (`/reports/banned` and the campaign expansion). */
function rangeQuery(): { range: BannedRange, from?: string, to?: string } {
  return range.value === 'custom'
    ? { range: 'custom', from: customFrom.value, to: customTo.value }
    : { range: range.value }
}
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const workspaceId = computed(() => queryString('workspaceId') ?? 'all')
const accountId = computed(() => queryString('tiktokAccountId') ?? 'all')
const advertiserId = computed(() => queryString('advertiserId') ?? 'all')

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

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const banned = ref<BannedReportResponse | null>(null)
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

/** AS-8 — workspace options = workspaces seen in the banned rows + accounts' `workspaceId` + the URL id. */
function rememberFromBanned(rows: BannedRow[]) {
  for (const row of rows) remember(knownWorkspaces, row.workspace.id, row.workspace.name)
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
}

async function load() {
  // FEAT-056 — an incomplete/impossible custom pair sends nothing at all (AC-25)
  if (rangeInvalid.value) {
    session++
    pending.value = false
    return
  }
  const s = ++session
  pending.value = true
  error.value = null
  rememberFromQuery()
  try {
    // retry: 0 — exactly one banned request per load / Refresh / state change (contract §3.2)
    const res = await api<BannedReportResponse>('/reports/banned', {
      retry: 0,
      query: {
        ...rangeQuery(),
        page: page.value,
        limit: LIMIT,
        workspaceId: workspaceId.value === 'all' ? undefined : workspaceId.value,
        tiktokAccountId: accountId.value === 'all' ? undefined : accountId.value,
        advertiserId: advertiserId.value === 'all' ? undefined : advertiserId.value
      }
    })
    if (s !== session) return
    banned.value = res
    rememberFromBanned(res.rows)
    loaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    banned.value = null
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

/** account options — `GET /tiktok-accounts` once on mount; a failure leaves the dropdown empty, never an error state. */
async function loadAccounts() {
  try {
    const res = await api<AccountsResponse>('/tiktok-accounts', { retry: 0 })
    rememberFromAccounts(res.accounts)
  } catch {
    // swallowed — contract §3.2 "failure ignored → options stay empty, no error state"
  }
}

/** advertiser options — `GET /advertisers?limit=100[&tiktokAccountId]` on mount and on every account change. */
async function loadAdvertisers() {
  try {
    const res = await api<AdvertisersResponse>('/advertisers', {
      retry: 0,
      query: { limit: 100, tiktokAccountId: accountId.value === 'all' ? undefined : accountId.value }
    })
    knownAdvertisers.value = []
    rememberFromAdvertisers(res.advertisers)
    rememberFromQuery()
  } catch {
    // swallowed — same rule as the account options
  }
}

const bannedQueryKey = computed(() => JSON.stringify([
  range.value, customFrom.value, customTo.value, page.value, workspaceId.value, accountId.value, advertiserId.value
]))

watch(bannedQueryKey, () => {
  void load()
})

// ── FEAT-056 · per-advertiser campaign expansion ─────────────────────────────────────────────────────────────────────
const expanded = ref<string[]>([])
const campaigns = ref<Record<string, BannedCampaignsState>>({})

/** identity of the current range — the campaign cache is valid for exactly one of these */
const rangeKey = computed(() => JSON.stringify([range.value, customFrom.value, customTo.value]))

function setCampaignState(id: string, state: BannedCampaignsState) {
  campaigns.value = { ...campaigns.value, [id]: state }
}

async function loadCampaigns(id: string) {
  if (rangeInvalid.value) return
  const key = rangeKey.value
  setCampaignState(id, { pending: true, error: null, data: campaigns.value[id]?.data ?? null })
  try {
    const res = await api<BannedCampaignsResponse>(`/reports/banned/${id}/campaigns`, {
      retry: 0,
      query: rangeQuery()
    })
    if (key !== rangeKey.value) return // the range moved on; the new range reloads on its own
    setCampaignState(id, { pending: false, error: null, data: res })
  } catch (e) {
    if (key !== rangeKey.value) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    setCampaignState(id, {
      pending: false,
      error: err.data?.error ?? err.message ?? 'Unexpected error',
      data: null
    })
  }
}

/** open/close one row; the request happens **once per (row, range)** — the cache is the memo */
function toggleExpand(id: string) {
  if (expanded.value.includes(id)) {
    expanded.value = expanded.value.filter(other => other !== id)
    return
  }
  expanded.value = [...expanded.value, id]
  if (!campaigns.value[id]) void loadCampaigns(id)
}

/** a range change keeps the rows open but throws the numbers away and re-reads them for the new range */
watch(rangeKey, () => {
  campaigns.value = {}
  for (const id of expanded.value) void loadCampaigns(id)
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

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function optionItems(list: { id: string, name: string }[], allLabel: string) {
  return [{ label: allLabel, value: 'all' }, ...list.map(item => ({ label: item.name, value: item.id }))]
}

const workspaceItems = computed(() => optionItems(knownWorkspaces.value, 'ทุก workspace'))
const accountItems = computed(() => optionItems(knownAccounts.value, 'ทุกบัญชี'))
const advertiserItems = computed(() => optionItems(knownAdvertisers.value, 'ทุก advertiser'))
const showWorkspaceFilter = computed(() => knownWorkspaces.value.length > 1)

const hasFilter = computed(() =>
  workspaceId.value !== 'all'
  || accountId.value !== 'all'
  || advertiserId.value !== 'all'
)

function clearFilters() {
  setQuery({ workspaceId: undefined, tiktokAccountId: undefined, advertiserId: undefined })
}

/** an account change also drops `advertiserId` (contract §3.2) */
function setAccount(value: string) {
  setQuery({ tiktokAccountId: orUndefined(value), advertiserId: undefined })
}

const total = computed(() => banned.value?.total ?? 0)
const isEmpty = computed(() => loaded.value && !error.value && !forbidden.value && total.value === 0 && !hasFilter.value)
const isNoMatch = computed(() => loaded.value && !error.value && !forbidden.value && total.value === 0 && hasFilter.value)
const showTable = computed(() => !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value)
const showSkeleton = computed(() => pending.value && !loaded.value && !error.value && !forbidden.value)

// ── header ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const intervalText = computed(() => {
  const phrase = intervalPhraseTh(banned.value?.intervalMs ?? 300_000)
  const refreshedAt = banned.value?.refreshedAt ?? null
  const last = refreshedAt ? `${formatClock(refreshedAt)} (${timeAgoTh(refreshedAt, nowMs.value)})` : REPORT_DASH
  return `อัปเดตทุก ${phrase} · ล่าสุด ${last}`
})

const RANGES: BannedRange[] = ['today', '7d', 'all', 'custom']
const BANNED_RANGE_LABEL: Record<BannedRange, string> = { ...RANGE_LABEL, custom: 'กำหนดเอง' }

/** Switching to `custom` keeps whatever dates are in the URL; with none the page shows `rb-range-invalid`. */
function setRange(value: BannedRange) {
  if (value === 'custom') {
    setQuery({ range: 'custom' })
    return
  }
  setQuery({ range: value === 'all' ? undefined : value, from: undefined, to: undefined })
}

function setCustomDate(side: 'from' | 'to', value: string) {
  setQuery({ [side]: value || undefined })
}

function setPage(value: number) {
  setQuery({ page: value > 1 ? String(value) : undefined }, true)
}

const rangeFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * LIMIT + 1))
const rangeTo = computed(() => Math.min(page.value * LIMIT, total.value))

// ── "view all ad images" modal (TASK-banned-ad-covers) ──────────────────────────────────────────────────────────────
const coversOpen = ref(false)
const coversRow = ref<BannedRow | null>(null)

function showCovers(row: BannedRow) {
  coversRow.value = row
  coversOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="report-banned">
    <template #header>
      <UDashboardNavbar title="Report Banned accounts">
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
              :label="BANNED_RANGE_LABEL[key]"
              size="xs"
              :color="range === key ? 'primary' : 'neutral'"
              :variant="range === key ? 'solid' : 'outline'"
              :aria-pressed="range === key"
              :data-testid="`rb-range-${key}`"
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
            data-testid="rb-refresh"
            @click="load()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="rb-page"
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
          data-testid="rb-forbidden"
        />

        <template v-else>
          <p class="text-sm text-muted" data-testid="rb-interval">
            {{ intervalText }}
          </p>

          <!-- FEAT-056 — custom range: two day inputs; an invalid pair renders the hint and sends nothing -->
          <div v-if="range === 'custom'" class="flex flex-wrap items-center gap-1.5">
            <UInput
              type="date"
              :model-value="customFrom"
              class="w-44"
              aria-label="ตั้งแต่วันที่"
              data-testid="rb-from"
              @update:model-value="(v: string | number) => setCustomDate('from', String(v))"
            />
            <span class="text-sm text-muted">→</span>
            <UInput
              type="date"
              :model-value="customTo"
              class="w-44"
              aria-label="ถึงวันที่"
              data-testid="rb-to"
              @update:model-value="(v: string | number) => setCustomDate('to', String(v))"
            />
            <p
              v-if="rangeInvalid"
              class="text-sm text-error"
              data-testid="rb-range-invalid"
            >
              {{ rangeInvalid }}
            </p>
          </div>

          <!-- filters -->
          <div class="flex flex-wrap items-center gap-1.5">
            <USelect
              v-if="showWorkspaceFilter"
              :model-value="workspaceId"
              :items="workspaceItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Workspace"
              data-testid="rb-filter-workspace"
              @update:model-value="(v: string) => setQuery({ workspaceId: orUndefined(v) })"
            />
            <USelect
              :model-value="accountId"
              :items="accountItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Account"
              data-testid="rb-filter-account"
              @update:model-value="(v: string) => setAccount(v)"
            />
            <USelect
              :model-value="advertiserId"
              :items="advertiserItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-36"
              aria-label="Advertiser"
              data-testid="rb-filter-advertiser"
              @update:model-value="(v: string) => setQuery({ advertiserId: orUndefined(v) })"
            />
            <UButton
              v-if="hasFilter"
              label="ล้างตัวกรอง"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="sm"
              data-testid="rb-clear"
              @click="clearFilters"
            />
          </div>

          <div v-if="showSkeleton" class="flex flex-col gap-2" data-testid="rb-loading">
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
            data-testid="rb-error"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="rb-retry"
                @click="load()"
              />
            </template>
          </UAlert>

          <UEmpty
            v-else-if="isEmpty"
            icon="i-lucide-ban"
            title="ยังไม่มีบัญชีที่โดนแบน"
            data-testid="rb-empty"
          />

          <UEmpty
            v-else-if="isNoMatch"
            icon="i-lucide-search-x"
            title="ไม่มีบัญชีที่ตรงกับตัวกรอง"
            data-testid="rb-nomatch"
          >
            <template #actions>
              <UButton
                label="ล้างตัวกรอง"
                icon="i-lucide-x"
                color="neutral"
                variant="outline"
                data-testid="rb-clear-nomatch"
                @click="clearFilters"
              />
            </template>
          </UEmpty>

          <template v-else-if="showTable && banned">
            <ReportBannedTable
              :rows="banned.rows"
              :totals="banned.totals"
              :ad-count="banned.adCount"
              :advertiser-count="banned.advertiserCount"
              :account-count="banned.accountCount"
              :pending="pending"
              :expanded="expanded"
              :campaigns="campaigns"
              @toggle-expand="toggleExpand"
              @retry-campaigns="loadCampaigns"
              @show-covers="showCovers"
            />

            <div class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted">
              <span data-testid="rb-count">แสดง {{ rangeFrom }}–{{ rangeTo }} จาก {{ total }}</span>

              <UPagination
                v-if="total > LIMIT"
                :page="page"
                :items-per-page="LIMIT"
                :total="total"
                data-testid="rb-pagination"
                @update:page="setPage"
              />
            </div>
          </template>
        </template>
      </div>
    </template>
  </UDashboardPanel>

  <ReportBannedCoversModal v-model:open="coversOpen" :row="coversRow" />
</template>
