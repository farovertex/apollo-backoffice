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
 * FEAT-011 adds two read-only columns: **Targeting** (the saved audience name, or `Custom` when the template
 * uses its own targeting) and **Catalog** (the `v<N>` part of `catalogVersion`, `–` when the document predates
 * FEAT-011), with an `Older catalog` badge whenever the row's version differs from the one `/options` announces.
 * A 403 on the list (a Payment-only admin that typed the URL) renders `agt-forbidden` with the API text; no
 * redirect, the sidebar item is hidden for that admin anyway (display-only, the API is the authority).
 * The table is plain markup (not `UTable`) so every `<tr>` can carry `data-id`.
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupTemplate,
  AdGroupTemplateOptions,
  AdGroupTemplatesResponse,
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
      query: { page: page.value, limit: LIMIT, q: q || undefined }
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

const queryKey = computed(() => `${page.value}|${searchDebounced.value.trim()}`)
watch(queryKey, () => {
  void load()
})

onMounted(() => {
  void load()
  void loadOptions()
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
const isEmpty = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && !hasSearch.value
)
const isNoMatch = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && hasSearch.value
)
const showTable = computed(() => !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value)

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

/** `<placement label> · <optimizationEvent label>` */
function placementCell(template: AdGroupTemplate): string {
  return `${labelOf(options.value?.placement, template.config.placement)} · ${labelOf(options.value?.optimizationEvent, template.config.optimizationEvent)}`
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

/** Targeting cell: the saved audience name when one is named, else the English word `Custom` (A8) */
function targetingCell(template: AdGroupTemplate): string {
  const saved = template.config?.savedAudience
  return saved?.mode === 'named' ? saved.name : 'Custom'
}

/** Catalog cell: the part after `/` of `catalogVersion` (`v1`), `–` for a document written before FEAT-011 */
function catalogCell(template: AdGroupTemplate): string {
  const version = template.catalogVersion
  if (!version) return '–'
  return version.split('/')[1] ?? version
}

/** the row was authored against another catalog version than the one the API serves now (null included) */
function isStaleCatalog(template: AdGroupTemplate): boolean {
  const current = options.value?.catalogVersion
  // without `/options` there is nothing to compare against — never cry wolf
  if (!current) return false
  return template.catalogVersion !== current
}

// row actions show their label only from `2xl` (1536 px); below that they are icon-only with a tooltip (FEAT-003)
const wideActions = useMediaQuery('(min-width: 1536px)')
const ACTION_LABEL_UI = { label: 'hidden 2xl:inline' }

// ── modals ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const formOpen = ref(false)
const formTarget = ref<AdGroupTemplate | null>(null)
const deleteOpen = ref(false)
const deleteTarget = ref<AdGroupTemplate | null>(null)

function openCreate() {
  formTarget.value = null
  formOpen.value = true
}

function openEdit(template: AdGroupTemplate) {
  formTarget.value = template
  formOpen.value = true
}

function askDelete(template: AdGroupTemplate) {
  deleteTarget.value = template
  deleteOpen.value = true
}

function onCreated() {
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
                  Placement / event
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Budget
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Schedule
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Goal
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
                  <span class="whitespace-nowrap" data-testid="agt-goal">{{ labelOf(options?.optimizationGoal, template.config.optimizationGoal) }}</span>
                </td>
                <td class="border-b border-default px-2 py-2">
                  <span class="line-clamp-2 max-w-32" :title="targetingCell(template)" data-testid="agt-targeting">{{ targetingCell(template) }}</span>
                </td>
                <td class="border-b border-default px-2 py-2">
                  <!-- stacked: the badge under the version keeps the two new columns inside the 1440 table width -->
                  <div class="flex flex-col items-start gap-1">
                    <span class="whitespace-nowrap" data-testid="agt-catalog">{{ catalogCell(template) }}</span>
                    <UBadge
                      v-if="isStaleCatalog(template)"
                      color="warning"
                      variant="subtle"
                      size="sm"
                      icon="i-lucide-triangle-alert"
                      class="whitespace-nowrap"
                      data-testid="agt-catalog-stale"
                    >
                      Older catalog
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
                    <UTooltip text="Edit" :disabled="wideActions">
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
                    <UTooltip text="Delete" :disabled="wideActions">
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
