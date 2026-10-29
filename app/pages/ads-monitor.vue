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
 * a deleted campaign keeps its row with `status.key = 'deleted'`. Since TASK-monitor-hide-deleted (2026-10-21) the
 * API's `status=all` (default) **excludes** deleted rows, so they are only visible through `status=deleted` — the
 * "ทั้งหมด" option is labelled "ทั้งหมด (ยกเว้นลบแล้ว)" to say so.
 *
 * Filter options come from the same two side endpoints `/reports/banned` uses (`GET /tiktok-accounts` once,
 * `GET /advertisers?limit=100[&tiktokAccountId]` on mount and per account change, failures swallowed — they
 * must never block the table); order options can only come from the rows, the contract has no order lookup.
 *
 * FEAT-064 (api-contract.md v1 §5) — `campaignId` is a fourth kind of URL state: like the other filters it is
 * part of `queryKey` / `hasFilter` / `clearFilters`, sent to the request only when set, and survives a tab
 * switch / Refresh. It is **toggled**, not set from a dropdown: every row's `am-row-filter` button asks
 * `onFilterCampaign(id)`, which sets the id when a different row (or none) was active and clears it when the
 * same row's button is pressed again (contract §5 / spec "Per-row campaign filter"). The chip's label uses
 * `campaign.name` from the **last** response (kept in `campaignName`, spec: "fine while a tab switch is in
 * flight"), falling back to the id. The collapsible `name` column (`nameCollapsed`) is unrelated page state,
 * one ref shared by the three tabs and persisted in `localStorage` (spec "Collapsible header", A9).
 *
 * FEAT-065 — the three-button range row became the shared `ReportsDateRange` popover (`am-range`,
 * `am-range-today|yesterday|7d|all|custom`, `am-from`/`am-to` inside `am-range-panel`): the five keys and a
 * custom pair, parsed/validated/serialised by `app/utils/report-range.ts`. `range` stays always explicit in
 * the request, the pair travels only with `custom`, the default still leaves the URL empty, and an invalid
 * pair makes `load()` return before any request. Nothing else about the query changed.
 *
 * FEAT-064 v1.1 (api-contract.md §6.4, AC-17/AC-18) — a second switch "เฉพาะบัญชีที่ไม่ถูกระงับ" (`hideBanned`,
 * **on** by default) works exactly like `linked`: the default is omitted from the URL (`?hideBanned=false` only
 * while off) and the request always sends `hideBanned=true|false` explicitly. It is coupled with the status
 * dropdown in one `setQuery` each way: choosing "ถูกระงับ" while the switch is on also turns it off
 * (`status=banned&hideBanned=false`, one request); turning the switch on while `status=banned` also resets the
 * status to "ทั้งหมด" — so the BO never sends `status=banned&hideBanned=true` (an always-empty pair).
 *
 * FEAT-067 (api-contract.md §4) — a second collapsible column, "UTM" (`AdsMonitorUtmCell`): `utmCollapsed` is
 * a page-level ref mirroring `nameCollapsed` exactly (its own `localStorage` key, read in `onMounted`,
 * independent of `nameCollapsed`) and is **not** part of `queryKey` / the request / `hasFilter` /
 * `clearFilters` — it only drives `AdsMonitorTable`'s rendering. The table also receives the page's
 * `rangeState` so its UTM cells can build `/reports/utm` links carrying the monitor's current range (spec
 * A5); no new request, no URL change.
 *
 * FEAT-082 (api-contract.md §2/§3/§6) — the **ad tab**'s status label becomes `am-review-open` for a row that
 * has a `review`; it opens `AdsMonitorReviewDrawer`, which owns `GET /ads-monitor/ads/:adId/review`, the
 * appeal form (`POST /ads-monitor/appeal`) and the 5 s poll while a job runs. No new page state beyond the
 * opened row and no new URL key: the drawer's `update:review` lands in the existing `overrides` map, so the
 * row's badge follows a 202 / poll outcome / close without a reload (spec "Polling while pending").
 */
import type { FetchError } from 'ofetch'
import type { Advertiser, AdvertisersResponse } from '#shared/types/advertisers'
import type {
  AdsMonitorResponse,
  BudgetPendingView,
  DeleteAccepted,
  MonitorLevel,
  MonitorLinkedFilter,
  MonitorReviewSummary,
  MonitorRow,
  MonitorStatusFilter,
  SetBudgetAccepted,
  SetBudgetBody,
  SetBudgetUnchanged,
  ToggleAccepted,
  ToggleTarget
} from '#shared/types/ads-monitor'
import type { ApiErrorBody } from '#shared/types/auth'
import type { MaybeDuplicateBody } from '~/utils/job-queue'
import type { ReportRange } from '#shared/types/reports'
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
  // TASK-monitor-hide-deleted (2026-10-21) — the API's `all` excludes `deleted`; the label says so
  { label: 'ทั้งหมด (ยกเว้นลบแล้ว)', value: 'all' },
  { label: 'ใช้งานอยู่', value: 'delivering' },
  { label: 'ไม่ส่ง', value: 'notDelivering' },
  { label: 'หยุดชั่วคราว', value: 'paused' },
  { label: 'ไม่ผ่าน/ถูกลงโทษ', value: 'rejected' },
  // FEAT-064 — banned advertisers are listed whenever they have kpi data in the selected range (FEAT-068 §1)
  { label: 'ถูกระงับ', value: 'banned' },
  // FEAT-068 — a row whose `missingSince` is set (gone from TikTok); same visibility rule as every other row
  { label: 'ไม่พบบน TikTok แล้ว', value: 'missing' },
  { label: 'อื่น ๆ', value: 'other' },
  // TASK-campaign-delete-ui — the API's new top-priority key; filterable like the other five
  { label: 'ลบแล้ว', value: 'deleted' }
]

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
const rangeState = computed(() => parseReportRange(route.query, 'today'))
const range = computed<ReportRange>(() => rangeState.value.range)
/** an incomplete/impossible custom pair is never sent (spec AC-10) */
const rangeInvalid = computed(() => reportRangeInvalid(rangeState.value))
const status = computed<MonitorStatusFilter>(() => {
  const value = queryString('status')
  return STATUS_ITEMS.some(item => item.value === value && value !== 'all') ? value as MonitorStatusFilter : 'all'
})
/** the switch is "เฉพาะจากระบบ": on ⇒ `linked=true` (default, URL empty) · off ⇒ `linked=all` */
const linked = computed<MonitorLinkedFilter>(() => (queryString('linked') === 'all' ? 'all' : 'true'))
/**
 * FEAT-064 v1.1 — the switch "เฉพาะบัญชีที่ไม่ถูกระงับ": on ⇒ `hideBanned=true` (default, URL empty) · off ⇒
 * `hideBanned=false` (the v1 banned-today view). Same URL/request pattern as `linked` (contract §6.4).
 */
const hideBanned = computed<'true' | 'false'>(() => (queryString('hideBanned') === 'false' ? 'false' : 'true'))
const page = computed(() => {
  const n = Number(route.query.page)
  return Number.isInteger(n) && n > 0 ? n : 1
})
const workspaceId = computed(() => queryString('workspaceId') ?? 'all')
const accountId = computed(() => queryString('tiktokAccountId') ?? 'all')
const advertiserId = computed(() => queryString('advertiserId') ?? 'all')
const orderId = computed(() => queryString('orderId') ?? 'all')
const searchQuery = computed(() => (queryString('q') ?? '').slice(0, Q_MAX))
/** FEAT-064 — per-row campaign filter (contract §5), `undefined` when absent. */
const campaignId = computed(() => queryString('campaignId'))

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
type RowOverride = Partial<Pick<MonitorRow, 'optPending' | 'optError' | 'deletePending' | 'deleteError' | 'review'>>
const overrides = ref<Record<string, RowOverride>>({})

/**
 * FEAT-060 — the budget is per **advertiser** (spec A1), so its optimistic state is a *second* override map,
 * keyed by `advertiser.id` rather than by row, merged into every row of that advertiser's `advertiserBudget`
 * below. Dropped on every `load()` exactly like `overrides` — the API's own `pending`/`error` on the next
 * response is then the truth again.
 */
type AdvertiserBudgetOverride = { pending: BudgetPendingView | null, error: string | null }
const advertiserOverrides = ref<Record<string, AdvertiserBudgetOverride>>({})

/** guards a double click from sending a second POST before the first one answered */
const inFlight = new Set<string>()

function rowKey(row: Pick<MonitorRow, 'level' | 'id'>): string {
  return `${row.level}:${row.id}`
}

const rows = computed<MonitorRow[]>(() =>
  (data.value?.rows ?? []).map((row) => {
    const override = overrides.value[rowKey(row)]
    const next = override ? { ...row, ...override } : row
    const budgetOverride = advertiserOverrides.value[row.advertiser.id]
    if (!budgetOverride || !next.advertiserBudget) return next
    return {
      ...next,
      advertiserBudget: { ...next.advertiserBudget, pending: budgetOverride.pending, error: budgetOverride.error }
    }
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
  // FEAT-065 — an invalid custom pair sends nothing at all; the previous table and the hint stay
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
    // retry: 0 — exactly one request per load / Refresh / state change (AC-19)
    const res = await api<AdsMonitorResponse>(endpoint.value, {
      retry: 0,
      query: {
        ...reportRangeQuery(rangeState.value),
        status: status.value,
        linked: linked.value,
        // FEAT-064 v1.1 — always explicit, like `linked` (contract §6.4)
        hideBanned: hideBanned.value,
        page: page.value,
        limit: LIMIT,
        workspaceId: orUndefined(workspaceId.value),
        tiktokAccountId: orUndefined(accountId.value),
        advertiserId: orUndefined(advertiserId.value),
        orderId: orUndefined(orderId.value),
        q: searchQuery.value || undefined,
        // FEAT-064 — sent only when set (defaults stay omitted, contract §5)
        campaignId: campaignId.value
      }
    })
    if (s !== session) return
    data.value = res
    overrides.value = {}
    advertiserOverrides.value = {}
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
  tab.value, range.value, rangeState.value.from, rangeState.value.to,
  status.value, linked.value, hideBanned.value, page.value,
  workspaceId.value, accountId.value, advertiserId.value, orderId.value, searchQuery.value,
  campaignId.value
]))

watch(queryKey, () => {
  void load()
})

watch(accountId, () => {
  void loadAdvertisers()
})

onMounted(() => {
  nameCollapsed.value = readNameCollapsed()
  utmCollapsed.value = readUtmCollapsed()
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

// ── FEAT-082 · review drawer + appeal (api-contract.md §2/§3/§6) ───────────────────────────────────────────────────
/**
 * Ad tab only (spec AS-5): the row's `am-review-open` opens `AdsMonitorReviewDrawer`, which owns the detail
 * request, the appeal form and the 5 s poll. The page only keeps the row it was opened for and writes the
 * drawer's `update:review` into the **same** `overrides` map the toggle/delete 202s use — so a 202, a poll
 * outcome or simply closing the drawer updates that row's badge/button without a reload, and the next
 * `load()` drops the override because the response is the truth again.
 */
const reviewOpen = ref(false)
const reviewRow = ref<MonitorRow | null>(null)

function showReview(row: MonitorRow) {
  reviewRow.value = row
  reviewOpen.value = true
}

function onReviewPatch(row: MonitorRow, review: MonitorReviewSummary | null) {
  const key = rowKey(row)
  overrides.value = { ...overrides.value, [key]: { ...overrides.value[key], review } }
}

/**
 * FEAT-085 — the 409 toast of the three row actions: `duplicate` (a switch / delete / budget job of the same
 * target is already pending, waiting or running) → "มีงานนี้รออยู่แล้ว (ลำดับที่ n)"; every other reason
 * (`banned` / `notLoggedIn` / `notDiscovered`) → "ทำไม่ได้" with the API's own sentence. The caller re-reads.
 *
 * FEAT-082 — the appeal 409 lives in `AdsMonitorReviewDrawer` (the drawer owns that request) and reuses the
 * same two shapes through `appealConflictToast()` there, so a `duplicate` body reads the same everywhere.
 */
function conflictToast(body: MaybeDuplicateBody | undefined, message: string) {
  if (isDuplicate(body)) {
    toast.add({ title: duplicateText(body?.queuePosition), description: message, icon: 'i-lucide-clock', color: 'warning' })
    return
  }
  toast.add({ title: 'ทำไม่ได้', description: message, icon: 'i-lucide-triangle-alert', color: 'warning' })
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
    const err = e as FetchError<Partial<ApiErrorBody & MaybeDuplicateBody>>
    const message = err.data?.error ?? err.message ?? 'เปลี่ยนสวิตช์ไม่สำเร็จ'
    if ((err.response?.status ?? err.statusCode) === 409) {
      conflictToast(err.data, message)
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
    const err = e as FetchError<Partial<ApiErrorBody & MaybeDuplicateBody>>
    const message = err.data?.error ?? err.message ?? 'ลบแคมเปญไม่สำเร็จ'
    deleteOpen.value = false
    if ((err.response?.status ?? err.statusCode) === 409) {
      conflictToast(err.data, message)
      await load()
    } else {
      toast.add({ title: 'ลบแคมเปญไม่สำเร็จ', description: message, icon: 'i-lucide-triangle-alert', color: 'error' })
    }
  } finally {
    deleting.value = false
    inFlight.delete(key)
  }
}

// ── budget (FEAT-060 · `POST /advertisers/:advertiserId/budget`) ───────────────────────────────────────────────────
/**
 * Campaign tab only, opened from `AdsMonitorBudgetCell`'s wallet/retry button. The budget is per
 * **advertiser** (spec A1), so the in-flight guard and the optimistic state are keyed by `advertiser.id`,
 * never by row (contrast `toggle()` / `confirmDelete()`): **202** → close the modal and write
 * `advertiserOverrides[advertiserId]` from the returned `budgetPending`, so every row of that advertiser
 * renders `am-budget-pending-<id>` at once; **200 `unchanged`** (defensive — the modal already disables Save
 * on this) → close + a neutral toast, no override written; **409** → close, a `ทำไม่ได้` toast with the API's
 * sentence, then exactly one re-read of this tab, exactly like `toggle()` / `confirmDelete()`; any other
 * error → an error toast and the modal stays open with the entered values (only `budgetSaving` resets).
 */
const budgetOpen = ref(false)
const budgetRow = ref<MonitorRow | null>(null)
const budgetSaving = ref(false)

function askBudget(row: MonitorRow) {
  budgetRow.value = row
  budgetOpen.value = true
}

async function confirmBudget(row: MonitorRow, body: SetBudgetBody) {
  const advertiserId = row.advertiser.id
  const key = `budget:${advertiserId}`
  if (inFlight.has(key)) return
  inFlight.add(key)
  budgetSaving.value = true
  try {
    const res = await api<SetBudgetAccepted | SetBudgetUnchanged>(`/advertisers/${advertiserId}/budget`, {
      retry: 0,
      method: 'POST',
      body
    })
    budgetOpen.value = false
    if ('unchanged' in res) {
      toast.add({ title: 'ค่าเดิม', description: 'ไม่ได้ส่ง job', icon: 'i-lucide-circle-check', color: 'neutral' })
    } else {
      advertiserOverrides.value = {
        ...advertiserOverrides.value,
        [advertiserId]: { pending: res.budgetPending, error: null }
      }
    }
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody & MaybeDuplicateBody>>
    const message = err.data?.error ?? err.message ?? 'ตั้งงบไม่สำเร็จ'
    if ((err.response?.status ?? err.statusCode) === 409) {
      budgetOpen.value = false
      conflictToast(err.data, message)
      await load()
    } else {
      toast.add({ title: 'ตั้งงบไม่สำเร็จ', description: message, icon: 'i-lucide-triangle-alert', color: 'error' })
    }
  } finally {
    budgetSaving.value = false
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
  || hideBanned.value !== 'true'
  || campaignId.value !== undefined
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
    linked: undefined,
    hideBanned: undefined,
    campaignId: undefined
  })
}

// ── FEAT-064 · per-row campaign filter (contract §5) ────────────────────────────────────────────────────────────────
/** Keep the last response's `campaign.name` while a tab switch (or any other reload) is in flight. */
const campaignName = ref<string | null>(null)
watch(data, (value) => {
  if (value?.campaign) campaignName.value = value.campaign.name
})

function setCampaignFilter(id: string | undefined) {
  setQuery({ campaignId: id })
}

/** `am-row-filter` click (from the table): toggles — inactive → set, active → clear. */
function onFilterCampaign(id: string) {
  if (!id) return
  setCampaignFilter(campaignId.value === id ? undefined : id)
}

function clearCampaignFilter() {
  setCampaignFilter(undefined)
}

/** an account change also drops `advertiserId` (its options are bound to the account) */
function setAccount(value: string) {
  setQuery({ tiktokAccountId: orUndefined(value), advertiserId: undefined })
}

function setTab(value: MonitorLevel) {
  if (value === tab.value) return
  setQuery({ tab: value === 'campaign' ? undefined : value })
}

/** FEAT-065 — the picker's `update`: the default key leaves the URL, `page` resets as before */
function onRange(patch: { range: ReportRange, from?: string, to?: string }) {
  setQuery(rangeUrlPatch({ range: patch.range, from: patch.from ?? '', to: patch.to ?? '' }, 'today'))
}

function setLinked(value: boolean) {
  setQuery({ linked: value ? undefined : 'all' })
}

// ── FEAT-064 v1.1 · "เฉพาะบัญชีที่ไม่ถูกระงับ" ↔ status coupling (contract §6.4, AC-18) ───────────────────────────
/**
 * Switch on → drop `hideBanned` from the URL; if the status was "ถูกระงับ" it goes back to "ทั้งหมด" in the **same**
 * `setQuery` (one request). Switch off → `hideBanned=false`, status untouched.
 */
function setHideBanned(on: boolean) {
  if (!on) {
    setQuery({ hideBanned: 'false' })
    return
  }
  const patch: Record<string, string | undefined> = { hideBanned: undefined }
  if (status.value === 'banned') patch.status = undefined
  setQuery(patch)
}

/** Status dropdown: choosing "ถูกระงับ" while the switch is on also turns it off in the same `setQuery`. */
function setStatus(value: string) {
  const patch: Record<string, string | undefined> = { status: orUndefined(value) }
  if (value === 'banned' && hideBanned.value === 'true') patch.hideBanned = 'false'
  setQuery(patch)
}

function setPage(value: number) {
  setQuery({ page: value > 1 ? String(value) : undefined }, true)
}

/** mobile only — the filter bar collapses behind `am-filters-toggle` under the `sm` breakpoint */
const filtersOpen = ref(false)

// ── FEAT-064 · collapsible name column (spec "UI behaviour" → Collapsible header, A9) ──────────────────────────────
// Browser-local only, one value shared by the three tabs. SSR renders expanded (`false`); the client applies the
// stored value in `onMounted` so there is no hydration mismatch. Every storage access is guarded — a
// missing/blocked `localStorage` leaves the column expanded and never throws (spec).
const NAME_COLLAPSED_KEY = 'apollo.adsMonitor.nameCollapsed'
const nameCollapsed = ref(false)

function readNameCollapsed(): boolean {
  try {
    return localStorage.getItem(NAME_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function setNameCollapsed(value: boolean) {
  nameCollapsed.value = value
  try {
    localStorage.setItem(NAME_COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // blocked storage — the toggle still works for the session (spec AC-9), nothing is logged
  }
}

// ── FEAT-067 · collapsible UTM column (spec "UI behaviour" → Header, A6) ───────────────────────────────────────────
// Same pattern as `nameCollapsed` above, its own key, independent ref.
const UTM_COLLAPSED_KEY = 'apollo.adsMonitor.utmCollapsed'
const utmCollapsed = ref(false)

function readUtmCollapsed(): boolean {
  try {
    return localStorage.getItem(UTM_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

function setUtmCollapsed(value: boolean) {
  utmCollapsed.value = value
  try {
    localStorage.setItem(UTM_COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // blocked storage — the toggle still works for the session (contract §4), nothing is logged
  }
}

// ── states ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const total = computed(() => data.value?.total ?? 0)

// FEAT-084 — "แสดงเป็น: THB | สกุลของบัญชี", one `localStorage` key for the three tabs; the `account`-mode badge
// quotes the newest S rate of the listed rows (balance / advertiser budget / campaign budget `thb` blocks)
const { mode: moneyMode, setMode: setMoneyMode } = useMoneyMode('ads-monitor')
const moneyLatest = computed(() => latestThbBlock((data.value?.rows ?? []).flatMap(r => [
  r.account?.balance?.thb,
  r.advertiserBudget?.thb,
  r.budget?.thb
])))
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
          <ReportsDateRange
            v-if="!forbidden"
            prefix="am"
            :range="rangeState.range"
            :from="rangeState.from"
            :to="rangeState.to"
            :pending="pending"
            @update="onRange"
          />
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
            <UButton
              v-if="campaignId"
              :label="`แคมเปญ: ${campaignName || campaignId}`"
              color="primary"
              variant="subtle"
              size="sm"
              trailing-icon="i-lucide-x"
              aria-label="ยกเลิกตัวกรองแคมเปญ"
              data-testid="am-filter-campaign"
              :data-campaign-id="campaignId"
              @click="clearCampaignFilter"
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
              @update:model-value="(v: string) => setStatus(v)"
            />
            <USwitch
              :model-value="linked === 'true'"
              label="เฉพาะจากระบบ"
              data-testid="am-filter-linked"
              @update:model-value="setLinked"
            />
            <USwitch
              :model-value="hideBanned === 'true'"
              label="เฉพาะบัญชีที่ไม่ถูกระงับ"
              data-testid="am-filter-hide-banned"
              @update:model-value="setHideBanned"
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
            <!-- FEAT-084 — money mode of the three tabs (one key for the page) + the mode badge -->
            <div class="flex flex-wrap items-center gap-2 sm:ms-auto">
              <MoneyNote :mode="moneyMode" :fx="data?.fx" :latest="moneyLatest" />
              <MoneyModeSwitch :mode="moneyMode" @update:mode="setMoneyMode" />
            </div>
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
              :mode="moneyMode"
              :spend-by-currency="data.spendByCurrency"
              :spend-unconverted="data.spendUnconverted"
              :pending="pending"
              :name-collapsed="nameCollapsed"
              :utm-collapsed="utmCollapsed"
              :range="rangeState"
              :campaign-id="campaignId"
              @toggle="toggle"
              @show-covers="showCovers"
              @delete="askDelete"
              @budget="askBudget"
              @update:name-collapsed="setNameCollapsed"
              @update:utm-collapsed="setUtmCollapsed"
              @filter-campaign="onFilterCampaign"
              @open-review="showReview"
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

  <AdsMonitorBudgetModal
    v-model:open="budgetOpen"
    :row="budgetRow"
    :saving="budgetSaving"
    @confirm="confirmBudget"
  />

  <AdsMonitorReviewDrawer
    v-model:open="reviewOpen"
    :row="reviewRow"
    @update:review="onReviewPatch"
  />
</template>
