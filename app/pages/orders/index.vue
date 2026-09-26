<script setup lang="ts">
/**
 * FEAT-016 — Orders list (functions 6.5, 6.6; api-contract.md **v1** `GET /campaign-orders`; spec AC-17).
 * Server-side list: exactly one `GET /backend/campaign-orders?page=<n>&limit=20[&q][&status][&publishMode]
 * [&workspaceId]` per load / Refresh / page change / filter change / 300 ms-debounced search. Count line and
 * pagination come from `total`, never from the rendered rows; the `N running` badge comes from `runningCount`
 * (orders in scope with status `queued|running`, filters ignored) — the list refreshes manually only, nothing
 * polls here (spec A7).
 *
 * The workspace filter is built from the workspaces seen in the loaded rows (the API has no workspace list
 * endpoint) and is hidden while only one is known; picking one is a server-side filter (`workspaceId`).
 * A 403 (a Payment-only admin that typed the URL) renders `ord-forbidden` with the API text, no redirect.
 * The table is plain markup so every `<tr>` can carry `data-id` / `data-status`; a click opens the detail.
 */
import { formatTimeAgo } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { CampaignOrdersResponse, OrderStatus, OrderView, PublishMode } from '#shared/types/campaign-orders'

useSeoMeta({ title: 'Orders' })

const LIMIT = 20
const DEBOUNCE_MS = 300

const api = useApi()

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const page = ref(1)
const search = ref('')
const searchDebounced = refDebounced(search, DEBOUNCE_MS)
const statusFilter = ref<'all' | OrderStatus>('all')
const modeFilter = ref<'all' | PublishMode>('all')
const workspaceFilter = ref<string>('all')

const statusItems: { label: string, value: 'all' | OrderStatus }[] = [
  { label: 'All statuses', value: 'all' },
  { label: 'Queued', value: 'queued' },
  { label: 'Running', value: 'running' },
  { label: 'Done', value: 'done' },
  { label: 'Partial', value: 'partialFailed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Cancelled', value: 'cancelled' }
]

const modeItems: { label: string, value: 'all' | PublishMode }[] = [
  { label: 'All modes', value: 'all' },
  { label: 'Publish', value: 'publish' },
  { label: 'Draft', value: 'draft' }
]

// ── list ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const items = ref<OrderView[]>([])
const total = ref(0)
const runningCount = ref(0)
const pending = ref(true)
const loaded = ref(false)
const error = ref<string | null>(null)
const forbidden = ref<string | null>(null)
/** workspaces seen so far (id → name) — the source of the workspace filter */
const knownWorkspaces = ref<{ id: string, name: string }[]>([])
// bumped on every request so a late response from a superseded query is dropped
let session = 0

const workspaceItems = computed(() => [
  { label: 'All workspaces', value: 'all' },
  ...knownWorkspaces.value.map(w => ({ label: w.name, value: w.id }))
])
const showWorkspaceFilter = computed(() => knownWorkspaces.value.length > 1)

function rememberWorkspaces(orders: OrderView[]) {
  const seen = new Map(knownWorkspaces.value.map(w => [w.id, w.name]))
  for (const order of orders) {
    const id = order.workspace?.id
    if (id && !seen.has(id)) seen.set(id, order.workspace.name ?? id)
  }
  knownWorkspaces.value = [...seen].map(([id, name]) => ({ id, name }))
}

async function load() {
  const s = ++session
  pending.value = true
  error.value = null
  const q = searchDebounced.value.trim()
  try {
    // retry: 0 — exactly one request per load, ofetch must not re-issue it on 5xx
    const res = await api<CampaignOrdersResponse>('/campaign-orders', {
      retry: 0,
      query: {
        page: page.value,
        limit: LIMIT,
        q: q || undefined,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value,
        publishMode: modeFilter.value === 'all' ? undefined : modeFilter.value,
        workspaceId: workspaceFilter.value === 'all' ? undefined : workspaceFilter.value
      }
    })
    if (s !== session) return
    items.value = res.orders ?? []
    total.value = res.total ?? items.value.length
    runningCount.value = res.runningCount ?? 0
    rememberWorkspaces(items.value)
    loaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    items.value = []
    total.value = 0
    runningCount.value = 0
    if ((err.response?.status ?? err.statusCode) === 403) forbidden.value = message
    else error.value = message
  } finally {
    if (s === session) pending.value = false
  }
}

// a new search / filter starts at page 1 — registered before the queryKey watcher so both changes collapse
// into one request
watch([searchDebounced, statusFilter, modeFilter, workspaceFilter], () => {
  page.value = 1
})

const queryKey = computed(() =>
  [page.value, searchDebounced.value.trim(), statusFilter.value, modeFilter.value, workspaceFilter.value].join('|')
)
watch(queryKey, () => {
  void load()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

const hasFilter = computed(() =>
  searchDebounced.value.trim() !== ''
  || statusFilter.value !== 'all'
  || modeFilter.value !== 'all'
  || workspaceFilter.value !== 'all'
)
const isEmpty = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && !hasFilter.value
)
const isNoMatch = computed(() =>
  loaded.value && !error.value && !forbidden.value && total.value === 0 && hasFilter.value
)
const showTable = computed(() => !error.value && !forbidden.value && !isEmpty.value && !isNoMatch.value)

function clearFilters() {
  search.value = ''
  statusFilter.value = 'all'
  modeFilter.value = 'all'
  workspaceFilter.value = 'all'
}

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const now = useNow({ interval: 30_000 })
function timeAgo(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}

/** last 6 characters of the id — enough to tell two orders with the same name apart */
function shortId(id: string): string {
  return id.length > 6 ? `…${id.slice(-6)}` : id
}

function openOrder(order: OrderView) {
  void navigateTo(`/orders/${order.id}`)
}
</script>

<template>
  <UDashboardPanel id="orders">
    <template #header>
      <UDashboardNavbar title="Orders">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #trailing>
          <UBadge
            v-if="runningCount > 0"
            color="info"
            variant="subtle"
            class="whitespace-nowrap"
            data-testid="ord-running"
          >
            {{ runningCount }} running
          </UBadge>
        </template>

        <template #right>
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="ord-refresh"
            @click="load()"
          />
          <UButton
            v-if="!forbidden"
            label="New order"
            aria-label="New order"
            icon="i-lucide-rocket"
            color="primary"
            to="/launch-ads"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="ord-new"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div data-testid="ord-page" :data-pending="pending ? 'true' : 'false'" class="flex flex-1 flex-col gap-4">
        <div v-if="!forbidden" class="flex flex-wrap items-center gap-1.5">
          <UInput
            v-model="search"
            class="w-full sm:max-w-xs"
            icon="i-lucide-search"
            placeholder="Search order name"
            data-testid="ord-search"
          />
          <USelect
            v-model="statusFilter"
            :items="statusItems"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="min-w-36"
            aria-label="Status"
            data-testid="ord-status"
          />
          <USelect
            v-model="modeFilter"
            :items="modeItems"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="min-w-32"
            aria-label="Mode"
            data-testid="ord-mode"
          />
          <USelect
            v-if="showWorkspaceFilter"
            v-model="workspaceFilter"
            :items="workspaceItems"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            class="min-w-36"
            aria-label="Workspace"
            data-testid="ord-ws"
          />
          <UButton
            v-if="hasFilter"
            label="Clear"
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            data-testid="ord-clear"
            @click="clearFilters"
          />
        </div>

        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="You cannot access orders"
          :description="forbidden"
          data-testid="ord-forbidden"
        />

        <UAlert
          v-else-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load the orders"
          :description="error"
          data-testid="ord-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              size="xs"
              :loading="pending"
              data-testid="ord-retry"
              @click="load()"
            />
          </template>
        </UAlert>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-list-checks"
          title="No orders yet"
          description="Launch your first campaign order"
          data-testid="ord-empty"
        >
          <template #actions>
            <UButton
              label="New order"
              icon="i-lucide-rocket"
              color="primary"
              to="/launch-ads"
              data-testid="ord-empty-new"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="isNoMatch"
          icon="i-lucide-search-x"
          title="No order matches your filters"
          data-testid="ord-nomatch"
        >
          <template #actions>
            <UButton
              label="Clear filters"
              icon="i-lucide-x"
              color="neutral"
              variant="outline"
              data-testid="ord-clear-filters"
              @click="clearFilters"
            />
          </template>
        </UEmpty>

        <div v-if="showTable" class="overflow-x-auto" data-testid="ord-table">
          <table class="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr class="bg-elevated/50">
                <th class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Order
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Status
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Builds
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Templates
                </th>
                <th class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Copies
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Mode
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Workspace
                </th>
                <th class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Created by
                </th>
                <th class="rounded-r-lg border-y border-r border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  Created
                </th>
              </tr>
            </thead>
            <tbody :class="pending ? 'opacity-60' : ''">
              <tr v-if="pending && items.length === 0" data-testid="ord-loading">
                <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="9">
                  Loading orders…
                </td>
              </tr>
              <tr
                v-for="order in items"
                :key="order.id"
                :data-id="order.id"
                :data-status="order.status"
                data-slot="tr"
                data-testid="ord-row"
                class="cursor-pointer"
                @click="openOrder(order)"
              >
                <td class="border-b border-default px-3 py-2">
                  <div class="flex flex-col">
                    <NuxtLink
                      :to="`/orders/${order.id}`"
                      class="font-medium text-highlighted"
                      data-testid="ord-name"
                      @click.stop
                    >
                      {{ order.name }}
                    </NuxtLink>
                    <span class="text-xs text-muted">{{ shortId(order.id) }}</span>
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    :color="orderStatusBadge(order.status).color"
                    variant="subtle"
                    class="whitespace-nowrap"
                    data-testid="ord-status-badge"
                  >
                    {{ orderStatusBadge(order.status).label }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex min-w-40 flex-col gap-1">
                    <span class="text-xs text-muted" data-testid="ord-builds">{{ buildSummaryText(order.buildCounts) }}</span>
                    <span class="flex h-1.5 w-full overflow-hidden rounded-full bg-elevated" data-testid="ord-builds-bar">
                      <span
                        v-for="segment in buildSegments(order.buildCounts)"
                        :key="segment.status"
                        :class="segment.class"
                        :style="{ width: `${segment.percent}%` }"
                        :data-status="segment.status"
                        :data-count="segment.count"
                        data-testid="ord-builds-segment"
                      />
                    </span>
                  </div>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <div class="flex max-w-56 flex-col">
                    <span class="truncate text-highlighted" :title="order.adGroupTemplate?.name">
                      {{ order.adGroupTemplate?.name ?? '—' }}
                    </span>
                    <span class="truncate text-xs text-muted" :title="order.adTemplate?.name">
                      {{ order.adTemplate?.name ?? '—' }}
                    </span>
                  </div>
                </td>
                <td class="border-b border-default px-2 py-2 text-right">
                  <span data-testid="ord-copies">{{ order.adGroupCopies }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    :color="order.publishMode === 'publish' ? 'warning' : 'neutral'"
                    variant="subtle"
                    :icon="order.publishMode === 'publish' ? 'i-lucide-triangle-alert' : undefined"
                    class="whitespace-nowrap"
                    data-testid="ord-mode-badge"
                  >
                    {{ order.publishMode === 'publish' ? 'Publish' : 'Draft' }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    color="neutral"
                    variant="outline"
                    class="whitespace-nowrap"
                    data-testid="ord-workspace"
                  >
                    {{ order.workspace?.name ?? '—' }}
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap">{{ order.createdBy?.username ?? '—' }}</span>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <span class="whitespace-nowrap" :title="order.createdAt">{{ timeAgo(order.createdAt) }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="!error && !forbidden"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
        >
          <span data-testid="ord-count">{{ total }} orders</span>

          <UPagination
            v-if="total > LIMIT"
            :page="page"
            :items-per-page="LIMIT"
            :total="total"
            data-testid="ord-pagination"
            @update:page="(p: number) => page = p"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
