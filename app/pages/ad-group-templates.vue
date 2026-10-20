<script setup lang="ts">
/**
 * FEAT-008 + FEAT-011 — Ad group templates (function 6.8; api-contract.md **v2**
 * `GET/POST/PATCH/DELETE /ad-group-templates`).
 *
 * Server-side list: exactly one `GET /backend/ad-group-templates?page=<n>&limit=20[&q=<q>]` per load / Refresh /
 * page change / 300 ms-debounced search / after create / edit / delete (`q` is omitted while the search box is
 * empty). Count line and pagination come from `total`, never from the rendered rows.
 * `GET /backend/ad-group-templates/options` is issued **once per page lifetime**; the form modal receives the
 * result as a prop and never re-fetches it. Every enum is rendered with the Thai label from that response —
 * the BO hard-codes no enum label.
 * FEAT-011 adds two read-only columns: **Targeting** and **Catalog** (the `v<N>` part of `catalogVersion`, `–`
 * when the document predates FEAT-011).
 *
 * **FEAT-061** (api-contract v1 §1.2, §2.1, §2.2 · spec AC-18, AC-19): every row carries `kind`
 * (`smartPlus` = authored against the version `/options` serves, `manual` = anything older, `null` included).
 * A **manual** row shows the badge `agt-kind-manual` in the Catalog cell instead of the stale badge, cannot be
 * edited any more (the API refuses the PATCH) and offers **`agt-migrate`** ("ปรับเป็น Smart+") in place of
 * `agt-edit`: the same form modal in `mode="migrate"`, which reads `GET /:id/migration` and saves through
 * `POST /:id/migrate`. The columns that used to read the removed v2 keys render both shapes — the Bid column
 * shows the v3 bid strategy (+ target CPA) and `—` for a manual row, Targeting says `Custom` unless an old row
 * still names a saved audience. Duplicate and Delete are unchanged (a duplicate of a manual row is created as
 * Smart+ — AS-6, handled inside the modal).
 * A 403 on the list (a Payment-only admin that typed the URL) renders `agt-forbidden` with the API text; no
 * redirect, the sidebar item is hidden for that admin anyway (display-only, the API is the authority).
 * The table is plain markup (not `UTable`) so every `<tr>` can carry `data-id`.
 *
 * **FEAT-057** (api-contract v1 §1.1, §4, §5 · spec AC-13, AC-14, AC-17): the list now shows **every** admin's
 * templates, so the row actions follow the view key `canEdit` (`createdBy` = caller, or GOD): `agt-edit` and
 * `agt-delete` are **rendered only** for a row with `canEdit: true` — not disabled, simply absent (A10; the
 * `Created by` column says who owns the row). The new first action `agt-duplicate` is on **every** row: it opens
 * the same form modal in duplicate mode (`duplicateFrom`, `template` still null), which POSTs a new template of
 * the caller's own with `duplicateOf` and reloads page 1 like any create. A stale page whose PATCH / DELETE is
 * refused with 403 `TEMPLATE_NOT_OWNER` shows the API text where that modal already shows its errors
 * (`agt-form-error` / the delete toast) and the list is re-read afterwards.
 *
 * **FEAT-058** (api-contract v1 §1–§3 · spec AC-4..8, AC-10): a **Created by** select (`agt-filter-created-by`)
 * right after the search box filters the list by `workspaceId`. Default = `useAuth().context.homeWorkspaceId`
 * (fallback `all`); the first list request already carries it, before `GET /ad-group-templates/creators`
 * (fetched once per page lifetime) has answered — items fall back to `Everyone` + `<admin.username> (me)`
 * from the session until then or on a failed `/creators` (silent, `data-creators`). Changing the select resets
 * the page to 1 and collapses into one list request, like the search box. Three empty states beyond the
 * unchanged `agt-empty` / `agt-no-match`: `agt-empty-mine` (filter = me), `agt-empty-creator` (another
 * creator), both with `agt-show-all` to fall back to `Everyone`. After a create or duplicate, a filter on
 * another creator switches to **me** before the single `reload(1)` (the new row is always the caller's own);
 * `all` / `me` keep the filter, like edit / delete.
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupTemplate,
  AdGroupTemplateKind,
  AdGroupTemplateOptions,
  AdGroupTemplatesResponse,
  Creator,
  CreatorsResponse,
  OptionItem
} from '#shared/types/ad-group-templates'

useSeoMeta({ title: 'Ad group templates' })

const LIMIT = 20
const DEBOUNCE_MS = 300

const api = useApi()

// ── options (one request per page lifetime, reused by the modals) ────────────────────────────────────────────────────
const options = ref<AdGroupTemplateOptions | null>(null)
const optionsError = ref<string | null>(null)

async function loadOptions() {
  try {
    // retry: 0 — exactly one request; never re-issued (Refresh reloads the list only)
    options.value = await api<AdGroupTemplateOptions>('/ad-group-templates/options', { retry: 0 })
    optionsError.value = null
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    options.value = null
    optionsError.value = err.data?.error ?? err.message ?? 'Unexpected error'
  }
}

/** the label of an option value; falls back to the raw value so an unknown value still renders */
function labelOf(list: OptionItem[] | undefined, value: string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return list?.find(item => item.value === value)?.label ?? value
}

// ── FEAT-058 · Created by filter ─────────────────────────────────────────────────────────────────────────────────────
const auth = useAuth()
const homeWorkspaceId = computed(() => auth.context.value?.homeWorkspaceId ?? null)

/** default = own workspace (fallback `all`); never waits for `/creators` */
const createdBy = ref<string>(homeWorkspaceId.value ?? 'all')

const creators = ref<Creator[]>([])
const creatorsStatus = ref<'pending' | 'ready' | 'error'>('pending')

async function loadCreators() {
  try {
    // retry: 0, once per page lifetime — Refresh never re-issues it
    const res = await api<CreatorsResponse>('/ad-group-templates/creators', { retry: 0 })
    creators.value = res.creators ?? []
    creatorsStatus.value = 'ready'
  } catch {
    // silent — fallback items below, no alert, no console error
    creators.value = []
    creatorsStatus.value = 'error'
  }
}

const EVERYONE_ITEM = { label: 'Everyone', value: 'all' }

/** before `/creators` resolves and when it fails: `Everyone` + `<admin.username> (me)` from the session */
function fallbackCreatedByItems(): { label: string, value: string }[] {
  const home = homeWorkspaceId.value
  if (!home) return [EVERYONE_ITEM]
  const username = auth.admin.value?.username ?? 'me'
  return [EVERYONE_ITEM, { label: `${username} (me)`, value: home }]
}

function creatorLabel(creator: Creator): string {
  const base = creator.username ?? creator.workspaceName ?? creator.workspaceId.slice(-4)
  return creator.me ? `${base} (me)` : base
}

const createdByItems = computed(() => {
  if (creatorsStatus.value !== 'ready') return fallbackCreatedByItems()
  return [EVERYONE_ITEM, ...creators.value.map(creator => ({ label: creatorLabel(creator), value: creator.workspaceId }))]
})

// ── list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const page = ref(1)
const search = ref('')
const searchDebounced = refDebounced(search, DEBOUNCE_MS)

const items = ref<AdGroupTemplate[]>([])
const total = ref(0)
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
// bumped on every request so a late response from a superseded query is dropped
let session = 0

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  const q = searchDebounced.value.trim()
  try {
    // retry: 0 — exactly one request per load, ofetch must not re-issue it on 5xx
    const res = await api<AdGroupTemplatesResponse>('/ad-group-templates', {
      retry: 0,
      query: {
        page: page.value,
        limit: LIMIT,
        q: q || undefined,
        workspaceId: createdBy.value !== 'all' ? createdBy.value : undefined
      }
    })
    if (s !== session) return
    items.value = res.templates ?? []
    total.value = res.total ?? items.value.length
    loaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    items.value = []
    total.value = 0
    if ((err.response?.status ?? err.statusCode) === 403) forbidden.value = message
    else error.value = message
  } finally {
    if (s === session) pending.value = false
  }
}

// a new search starts at page 1 — registered before the queryKey watcher so both changes collapse into one request
watch(searchDebounced, () => {
  page.value = 1
})

// FEAT-058 — same rule for the Created by filter, registered before the queryKey watcher
watch(createdBy, () => {
  page.value = 1
})

const queryKey = computed(() => `${page.value}|${searchDebounced.value.trim()}|${createdBy.value}`)
watch(queryKey, () => {
  void load()
})

onMounted(() => {
  void load()
  void loadOptions()
  void loadCreators()
})

onUnmounted(() => {
  session++
})

/** one request after a mutation: either through the page watcher (page really changes) or directly */
function reload(target?: number) {
  if (target !== undefined && target !== page.value) page.value = target
  else void load()
}

const hasSearch = computed(() => searchDebounced.value.trim() !== '')
const isFilterAll = computed(() => createdBy.value === 'all')
const isFilterMine = computed(() => !isFilterAll.value && createdBy.value === homeWorkspaceId.value)
const isFilterOtherCreator = computed(() => !isFilterAll.value && !isFilterMine.value)

const baseEmpty = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && !hasSearch.value
)
const isEmpty = computed(() => baseEmpty.value && isFilterAll.value)
const isEmptyMine = computed(() => baseEmpty.value && isFilterMine.value)
const isEmptyCreator = computed(() => baseEmpty.value && isFilterOtherCreator.value)
const isNoMatch = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && hasSearch.value
)
const showTable = computed(() =>
  !error.value && !forbidden.value && !isEmpty.value && !isEmptyMine.value && !isEmptyCreator.value && !isNoMatch.value
)

function clearSearch() {
  search.value = ''
}

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const now = useNow({ interval: 30_000 })
function timeAgo(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}

/** deterministic local short datetime (`YYYY-MM-DD HH:mm`) — never locale-dependent */
function shortDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** `<placement label>` — FEAT-061 dropped `optimizationEvent` from the shape */
function placementCell(template: AdGroupTemplate): string {
  return labelOf(options.value?.placement, template.config?.placement)
}

/** `<amount 2 decimals> <currency label> / <budgetType label>` — e.g. `300.00 THB / รายวัน` */
function budgetCell(template: AdGroupTemplate): string {
  const budget = template.config.budget
  const amount = Number.isFinite(budget?.amount) ? budget.amount.toFixed(2) : '—'
  return `${amount} ${labelOf(options.value?.currency, budget?.currency)} / ${labelOf(options.value?.budgetType, budget?.type)}`
}

/** `<scheduleMode label>`, plus ` · <start> → <end>` for a date range */
function scheduleCell(template: AdGroupTemplate): string {
  const schedule = template.config.schedule
  const mode = labelOf(options.value?.scheduleMode, schedule?.mode)
  if (schedule?.mode !== 'dateRange') return mode
  const start = schedule.startTime === 'now'
    ? labelOf(options.value?.startTimeMode, 'now')
    : shortDateTime(String(schedule.startTime))
  return `${mode} · ${start} → ${shortDateTime(schedule.endTime)}`
}

/**
 * Targeting cell: the English word `Custom` for a v3 row. A **manual** row may still store the v2 key
 * `savedAudience` — then its name is shown, so an old row keeps reading the way it did (FEAT-011 A8).
 */
function targetingCell(template: AdGroupTemplate): string {
  const saved = (template.config as unknown as Record<string, unknown> | undefined)?.savedAudience as
    { mode?: string, name?: string } | undefined
  return saved?.mode === 'named' && saved.name ? saved.name : 'Custom'
}

/**
 * FEAT-061 — the row's kind: the API's own `kind` when it serves one, else the FEAT-011 catalog comparison
 * (an API that predates the feature). `null` while `/options` has not answered — never cry wolf.
 */
function kindOf(template: AdGroupTemplate): AdGroupTemplateKind | null {
  if (template.kind) return template.kind
  const current = options.value?.catalogVersion
  if (!current) return null
  return template.catalogVersion === current ? 'smartPlus' : 'manual'
}

function isManual(template: AdGroupTemplate): boolean {
  return kindOf(template) === 'manual'
}

/**
 * Bid cell (FEAT-061): the bid-strategy label of `config.campaign`, plus the target CPA for `costCap`.
 * A manual row has no campaign section at all → `—`.
 */
function bidCell(template: AdGroupTemplate): string {
  const campaign = template.config?.campaign
  if (!campaign?.bidStrategy) return '—'
  const label = labelOf(options.value?.bidStrategy, campaign.bidStrategy)
  const targetCpa = template.config?.targetCpa
  return campaign.bidStrategy === 'costCap' && Number.isFinite(targetCpa)
    ? `${label} · ${(targetCpa as number).toFixed(2)}`
    : label
}

/** Catalog cell: the part after `/` of `catalogVersion` (`v1`), `–` for a document written before FEAT-011 */
function catalogCell(template: AdGroupTemplate): string {
  const version = template.catalogVersion
  if (!version) return '–'
  return version.split('/')[1] ?? version
}

// row actions show their label only from `2xl` (1536 px); below that they are icon-only with a tooltip (FEAT-003)
const wideActions = useMediaQuery('(min-width: 1536px)')
const ACTION_LABEL_UI = { label: 'hidden 2xl:inline' }

// ── modals ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const formOpen = ref(false)
const formTarget = ref<AdGroupTemplate | null>(null)
/** FEAT-057 — the row a Duplicate click starts from; `formTarget` stays null (the modal creates) */
const duplicateTarget = ref<AdGroupTemplate | null>(null)
/** FEAT-061 — `'migrate'` while the modal converts the manual row in `formTarget` */
const formMode = ref<'form' | 'migrate'>('form')
const deleteOpen = ref(false)
const deleteTarget = ref<AdGroupTemplate | null>(null)

function openCreate() {
  formTarget.value = null
  duplicateTarget.value = null
  formMode.value = 'form'
  formOpen.value = true
}

function openEdit(template: AdGroupTemplate) {
  formTarget.value = template
  duplicateTarget.value = null
  formMode.value = 'form'
  formOpen.value = true
}

/** FEAT-057 — the same modal in duplicate mode: create, pre-filled from this row, `duplicateOf` in the POST */
function openDuplicate(template: AdGroupTemplate) {
  formTarget.value = null
  duplicateTarget.value = template
  formMode.value = 'form'
  formOpen.value = true
}

/**
 * FEAT-061 — the same modal in migrate mode: the manual row's `/migration` draft, `POST /:id/migrate`.
 * `updated` refreshes the list, so the row re-renders as Smart+ without a page reload.
 */
function openMigrate(template: AdGroupTemplate) {
  formTarget.value = template
  duplicateTarget.value = null
  formMode.value = 'migrate'
  formOpen.value = true
}

function askDelete(template: AdGroupTemplate) {
  deleteTarget.value = template
  deleteOpen.value = true
}

function onCreated() {
  // FEAT-058 — a filter on another creator would hide the new row (always the caller's own): switch to
  // `me` and let the createdBy/queryKey watchers collapse the page reset into the single list request;
  // calling reload(1) as well here would double the request (watcher + direct call both firing).
  if (isFilterOtherCreator.value) {
    createdBy.value = homeWorkspaceId.value ?? 'all'
    return
  }
  // the list is sorted by -updatedAt — the new row is on page 1
  reload(1)
}

function onUpdated() {
  reload()
}

function onDeleted() {
  // last row of a page → step back one page, otherwise reload the current one (one request either way)
  reload(items.value.length === 1 && page.value > 1 ? page.value - 1 : undefined)
}
</script>

<template>
  <UDashboardPanel id="ad-group-templates">
    <template #header>
      <UDashboardNavbar title="Ad group templates">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <!-- two labelled buttons clip the H1 (`truncate`) at 390 px → icon-only below `sm`, aria-label keeps the name -->
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="agt-refresh"
            @click="reload()"
          />
          <UButton
            label="Create template"
            aria-label="Create template"
            icon="i-lucide-plus"
            color="primary"
            :disabled="!options"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="agt-create"
            @click="openCreate"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div data-testid="agt-page" :data-pending="pending ? 'true' : 'false'" class="flex flex-1 flex-col gap-4">
        <div v-if="!forbidden" class="flex flex-wrap items-center gap-1.5">
          <UInput
            v-model="search"
            class="w-full sm:max-w-sm"
            icon="i-lucide-search"
            placeholder="Search name or description"
            data-testid="agt-search"
          />
          <span :data-creators="creatorsStatus" data-testid="agt-filter-created-by-state">
            <USelect
              :model-value="createdBy"
              :items="createdByItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="w-full sm:w-auto sm:min-w-48"
              aria-label="Created by"
              data-testid="agt-filter-created-by"
              @update:model-value="(v: string) => createdBy = v"
            />
          </span>
        </div>

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="You cannot access ad group templates"
          :description="forbidden"
          data-testid="agt-forbidden"
        />

        <UAlert
          v-else-if="optionsError"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load the template options"
          :description="optionsError"
          data-testid="agt-options-error"
        />

        <UAlert
          v-if="error && !forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load ad group templates"
          :description="error"
          data-testid="agt-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="pending"
              data-testid="agt-retry"
              @click="load()"
            />
          </template>
        </UAlert>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-layout-template"
          title="No templates yet"
          description="Create one from the TikTok defaults"
          data-testid="agt-empty"
        >
          <template #actions>
            <UButton
              label="Create template"
              icon="i-lucide-plus"
              color="primary"
              :disabled="!options"
              data-testid="agt-empty-create"
              @click="openCreate"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="isEmptyMine"
          icon="i-lucide-layout-template"
          title="You have no templates yet"
          description="Create one, or look at everyone's templates"
          data-testid="agt-empty-mine"
        >
          <template #actions>
            <UButton
              label="Create template"
              icon="i-lucide-plus"
              color="primary"
              :disabled="!options"
              data-testid="agt-empty-create"
              @click="openCreate"
            />
            <UButton
              label="Show everyone's templates"
              icon="i-lucide-users"
              color="neutral"
              variant="outline"
              data-testid="agt-show-all"
              @click="createdBy = 'all'"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="isEmptyCreator"
          icon="i-lucide-search-x"
          title="No templates from this creator"
          data-testid="agt-empty-creator"
        >
          <template #actions>
            <UButton
              label="Show everyone's templates"
              icon="i-lucide-users"
              color="neutral"
              variant="outline"
              data-testid="agt-show-all"
              @click="createdBy = 'all'"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="isNoMatch"
          icon="i-lucide-search-x"
          title="No templates match your search"
          data-testid="agt-no-match"
        >
          <template #actions>
            <UButton
              label="Clear search"
              icon="i-lucide-x"
              color="neutral"
              variant="outline"
              data-testid="agt-clear-search"
              @click="clearSearch"
            />
          </template>
        </UEmpty>

        <div v-if="showTable" class="overflow-x-auto" data-testid="agt-table">
          <table class="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr class="bg-elevated/50">
                <th class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Name
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Placement
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Budget
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Schedule
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Bid
                </th>
                <th class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Targeting
                </th>
                <th class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Catalog
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Workspace
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Created by
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Updated
                </th>
                <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody :class="pending ? 'opacity-60' : ''">
              <tr v-if="pending && items.length === 0" data-testid="agt-loading">
                <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="11">
                  Loading templates…
                </td>
              </tr>
              <!-- `data-slot="tr"` mirrors UTable's rows so a row locator works the same on every table of the BO -->
              <tr
                v-for="template in items"
                :key="template.id"
                :data-id="template.id"
                data-slot="tr"
                data-testid="agt-row"
              >
                <td class="border-b border-default px-3 py-2">
                  <div class="flex flex-col">
                    <span class="font-medium text-highlighted" data-testid="agt-name">{{ template.name }}</span>
                    <span
                      v-if="template.description"
                      class="line-clamp-1 text-xs text-muted"
                      :title="template.description"
                      data-testid="agt-description"
                    >{{ template.description }}</span>
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" data-testid="agt-placement">{{ placementCell(template) }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" data-testid="agt-budget">{{ budgetCell(template) }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span data-testid="agt-schedule">{{ scheduleCell(template) }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <!-- FEAT-061 — the v3 bid strategy (+ target CPA); `—` for a manual row. The costCap label is
                       long, so the cell wraps instead of pushing the table wider (title = the full text) -->
                  <span class="line-clamp-2 max-w-40" :title="bidCell(template)" data-testid="agt-goal">{{ bidCell(template) }}</span>
                </td>
                <td class="border-b border-default px-2 py-2">
                  <span class="line-clamp-2 max-w-32" :title="targetingCell(template)" data-testid="agt-targeting">{{ targetingCell(template) }}</span>
                </td>
                <td class="border-b border-default px-2 py-2">
                  <!-- stacked: the badge under the version keeps the two new columns inside the 1440 table width -->
                  <div class="flex flex-col items-start gap-1">
                    <span class="whitespace-nowrap" data-testid="agt-catalog">{{ catalogCell(template) }}</span>
                    <!-- FEAT-061 — a manual row (any older catalog version, `null` included) says so -->
                    <UBadge
                      v-if="isManual(template)"
                      color="warning"
                      variant="subtle"
                      size="sm"
                      icon="i-lucide-triangle-alert"
                      class="whitespace-nowrap"
                      data-testid="agt-kind-manual"
                    >
                      manual
                    </UBadge>
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    color="neutral"
                    variant="outline"
                    class="whitespace-nowrap"
                    data-testid="agt-workspace"
                  >
                    {{ template.workspace?.name ?? '—' }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" data-testid="agt-created-by">{{ template.createdBy?.username ?? '—' }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" :title="template.updatedAt" data-testid="agt-updated">{{ timeAgo(template.updatedAt) }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex items-center justify-end gap-1 whitespace-nowrap">
                    <!-- FEAT-057 — every row can be copied into a template of the caller's own -->
                    <UTooltip text="Duplicate" :disabled="wideActions">
                      <UButton
                        label="Duplicate"
                        icon="i-lucide-copy"
                        color="neutral"
                        variant="outline"
                        size="xs"
                        :ui="ACTION_LABEL_UI"
                        :disabled="!options"
                        aria-label="Duplicate"
                        data-testid="agt-duplicate"
                        @click="openDuplicate(template)"
                      />
                    </UTooltip>
                    <!-- FEAT-057 — only the creator (and GOD) may write: no disabled ghosts for anybody else (A10) -->
                    <!-- FEAT-061 — a manual row cannot be edited: the migrate action takes Edit's place -->
                    <UTooltip v-if="template.canEdit && isManual(template)" text="ปรับเป็น Smart+" :disabled="wideActions">
                      <UButton
                        label="ปรับเป็น Smart+"
                        icon="i-lucide-wand-sparkles"
                        color="warning"
                        variant="outline"
                        size="xs"
                        :ui="ACTION_LABEL_UI"
                        :disabled="!options"
                        aria-label="ปรับเป็น Smart+"
                        data-testid="agt-migrate"
                        @click="openMigrate(template)"
                      />
                    </UTooltip>
                    <UTooltip v-else-if="template.canEdit" text="Edit" :disabled="wideActions">
                      <UButton
                        label="Edit"
                        icon="i-lucide-pencil"
                        color="neutral"
                        variant="outline"
                        size="xs"
                        :ui="ACTION_LABEL_UI"
                        :disabled="!options"
                        aria-label="Edit"
                        data-testid="agt-edit"
                        @click="openEdit(template)"
                      />
                    </UTooltip>
                    <UTooltip v-if="template.canEdit" text="Delete" :disabled="wideActions">
                      <UButton
                        label="Delete"
                        icon="i-lucide-trash-2"
                        color="error"
                        variant="subtle"
                        size="xs"
                        :ui="ACTION_LABEL_UI"
                        aria-label="Delete"
                        data-testid="agt-delete"
                        @click="askDelete(template)"
                      />
                    </UTooltip>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="!error && !forbidden"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
        >
          <span data-testid="agt-count">{{ total }} templates</span>

          <UPagination
            v-if="total > LIMIT"
            :page="page"
            :items-per-page="LIMIT"
            :total="total"
            data-testid="agt-pagination"
            @update:page="(p: number) => page = p"
          />
        </div>
      </div>

      <AdGroupTemplatesFormModal
        v-if="options"
        v-model:open="formOpen"
        :template="formTarget"
        :duplicate-from="duplicateTarget"
        :mode="formMode"
        :options="options"
        @created="onCreated"
        @updated="onUpdated"
      />
      <AdGroupTemplatesDeleteModal
        v-model:open="deleteOpen"
        :template="deleteTarget"
        @deleted="onDeleted"
      />
    </template>
  </UDashboardPanel>
</template>
