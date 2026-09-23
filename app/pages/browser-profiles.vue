<script setup lang="ts">
/**
 * FEAT-002 — Browser profiles (functions 2.1 + 2.2 automatic, read-only; api-contract.md v2).
 * One `GET /backend/browser-profiles/available` (no query) per load / Refresh — the API syncs the provider list into
 * the DB and applies per-workspace visibility; search, group and status filters, sort and pagination are client-side
 * on the returned list (AdsPower Local API is throttled to ~1 req/s).
 * No claim / start / stop / delete here — those are later features.
 * FEAT-006 (functions 2.3 + 2.10, api-contract.md v1): header buttons "Default settings"
 * (`BrowserProfilesDefaultsSlideover`) and "Create profile" (`BrowserProfilesCreateModal`, one extra
 * `GET …/available` after a 201); the Proxy column prefers `proxyRef.label` over the FEAT-002 provider snapshot and
 * rows created from the BO carry a fingerprint icon.
 */
import type { TableColumn } from '@nuxt/ui'
import { getPaginationRowModel } from '@tanstack/table-core'
import type { AvailableProfile, AvailableProfileStatus, AvailableResponse, ProviderErrorBody } from '#shared/types/browser-profiles'

useSeoMeta({ title: 'Browser profiles' })

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const UIcon = resolveComponent('UIcon')
const UTooltip = resolveComponent('UTooltip')

const api = useApi()

// `server: false`: the request must be issued by the browser (one visible XHR per load, stubbable by QA with
// page.route) and never block SSR on a slow / down AdsPower.
const { data, status, error, refresh } = useLazyAsyncData(
  'browser-profiles',
  // retry: 0 — ofetch would otherwise re-issue the GET once on 429/502/503; the contract is one request per load
  () => api<AvailableResponse>('/browser-profiles/available', { retry: 0 }),
  { server: false }
)

// `idle` = SSR HTML / before the client fetch starts (server: false) — show it as loading, never as "no data"
const pending = computed(() => status.value === 'idle' || status.value === 'pending')
const profiles = computed<AvailableProfile[]>(() => data.value?.profiles ?? [])
// `groups` / `total` / `syncedAt` fall back gracefully while the API side lands.
const groups = computed<string[]>(() => data.value?.groups ?? [])
const total = computed(() => data.value?.total ?? profiles.value.length)
// top-level `syncedAt` = timestamp of this sync. `useTimeAgo` (VueUse) re-renders every 30 s; `—` when missing.
const syncedAt = computed<string | null>(() => data.value?.syncedAt ?? null)
const syncedAgo = useTimeAgo(() => syncedAt.value ?? 0)

// ── filters (client-side) ────────────────────────────────────────────────────────────────────────────────────────────
const ALL = '__all__'
const search = ref('')
const searchDebounced = refDebounced(search, 250)
const group = ref(ALL)
const statusFilter = ref<'all' | AvailableProfileStatus>('all')

const groupItems = computed(() => [
  { label: 'All groups', value: ALL },
  ...groups.value.map(g => ({ label: g, value: g }))
])
const statusItems = [
  { label: 'All', value: 'all' },
  { label: 'Free', value: 'free' },
  { label: 'Bound', value: 'bound' }
]

const hasActiveFilter = computed(() =>
  search.value.trim() !== '' || group.value !== ALL || statusFilter.value !== 'all'
)

function clearFilters() {
  search.value = ''
  group.value = ALL
  statusFilter.value = 'all'
}

// Same rules as the API's `q` / `group` / `status` (api-contract.md v2): case-insensitive substring on name /
// providerProfileId / groupName; exact groupName; exact status (`free` | `bound`).
const filtered = computed<AvailableProfile[]>(() => {
  const needle = searchDebounced.value.trim().toLowerCase()
  return profiles.value.filter((p) => {
    if (needle) {
      const hit = p.name.toLowerCase().includes(needle)
        || p.providerProfileId.toLowerCase().includes(needle)
        || (p.groupName ?? '').toLowerCase().includes(needle)
      if (!hit) return false
    }
    if (group.value !== ALL && p.groupName !== group.value) return false
    if (statusFilter.value !== 'all' && p.status !== statusFilter.value) return false
    return true
  })
})

// ── table ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const PAGE_SIZE = 20
const pagination = ref({ pageIndex: 0, pageSize: PAGE_SIZE })
const sorting = ref([{ id: 'name', desc: false }])

// TanStack memoises on the state object's identity → always assign a new object, never mutate `pageIndex` in place
function setPage(p: number) {
  pagination.value = { ...pagination.value, pageIndex: Math.max(0, p - 1) }
}
const currentPage = computed(() => pagination.value.pageIndex + 1)

// any filter change (or a fresh dataset) → page 1
watch([searchDebounced, group, statusFilter, data], () => setPage(1))

function formatProxy(proxy: AvailableProfile['proxy']): string {
  if (!proxy) return '—'
  const endpoint = proxy.port ? `${proxy.host}:${proxy.port}` : proxy.host
  const main = [proxy.type, endpoint].filter(Boolean).join(' ')
  return proxy.country ? `${main} · ${proxy.country}` : main
}

function boundLabel(p: AvailableProfile): string {
  const account = p.boundAccount
  return account ? `Bound · ${account.label ?? account.loginEmail}` : 'Bound'
}

/** FEAT-006 — tooltip of the fingerprint icon: `Chrome ua_auto · Windows · WebRTC disabled · Noise on` */
function fingerprintText(fp: NonNullable<AvailableProfile['fingerprint']>): string {
  return `Chrome ${fp.browser.version} · ${fp.os} · WebRTC ${fp.webrtc} · Noise ${fp.hardwareNoise.enabled ? 'on' : 'off'}`
}

// ── create / defaults (FEAT-006) ─────────────────────────────────────────────────────────────────────────────────────
const defaultsOpen = ref(false)
const createOpen = ref(false)

/** 201 from the Create modal → drop the client-side filters (so the new row is visible) + exactly one re-GET */
function onCreated() {
  clearFilters()
  return refresh()
}

const columns: TableColumn<AvailableProfile>[] = [
  {
    accessorKey: 'name',
    header: ({ column }) => {
      const isSorted = column.getIsSorted()
      return h(UButton, {
        color: 'neutral',
        variant: 'ghost',
        label: 'Name',
        icon: isSorted
          ? isSorted === 'asc'
            ? 'i-lucide-arrow-up-narrow-wide'
            : 'i-lucide-arrow-down-wide-narrow'
          : 'i-lucide-arrow-up-down',
        class: '-mx-2.5',
        onClick: () => column.toggleSorting(column.getIsSorted() === 'asc')
      })
    },
    sortingFn: (a, b) => a.original.name.localeCompare(b.original.name, undefined, { sensitivity: 'base' }),
    // FEAT-006: a profile created from the BO carries its fingerprint → info icon next to the name; synced rows
    // (`fingerprint: null`) show nothing
    cell: ({ row }) => {
      const fp = row.original.fingerprint
      const children = [h('span', { class: 'font-medium text-highlighted' }, row.original.name)]
      if (fp) {
        const text = fingerprintText(fp)
        children.push(h(UTooltip, { text }, () => h(UIcon, {
          'name': 'i-lucide-fingerprint',
          'class': 'size-4 shrink-0 text-muted',
          'title': text,
          'aria-label': text,
          'data-testid': 'bp-fingerprint'
        })))
      }
      return h('div', { class: 'flex items-center gap-1' }, children)
    }
  },
  {
    accessorKey: 'providerProfileId',
    header: 'Profile ID',
    enableSorting: false,
    cell: ({ row }) => h('span', { class: 'font-mono text-xs' }, row.original.providerProfileId)
  },
  {
    accessorKey: 'groupName',
    header: 'Group',
    enableSorting: false,
    cell: ({ row }) => row.original.groupName ?? '—'
  },
  {
    id: 'proxy',
    header: 'Proxy',
    enableSorting: false,
    // FEAT-006: the proxy row chosen at create time (`proxyRef`) wins over the provider snapshot (FEAT-002)
    cell: ({ row }) => {
      const ref = row.original.proxyRef
      if (!ref) {
        return h('span', { 'class': 'whitespace-nowrap', 'data-testid': 'bp-proxy' }, formatProxy(row.original.proxy))
      }
      const endpoint = `${ref.type} ${ref.host}:${ref.port}`
      return h(UTooltip, { text: endpoint }, () => h('span', {
        'class': 'font-medium whitespace-nowrap text-highlighted',
        'title': endpoint,
        'data-testid': 'bp-proxy',
        'data-proxy-id': ref.id
      }, ref.label))
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    enableSorting: false,
    // `free` = no TikTok account bound to this profile yet, `bound` = boundAccountId set. FEAT-003: the Bound badge
    // names the account (`label`, else `loginEmail`); plain `Bound` when the join is null (dangling id).
    cell: ({ row }) => row.original.status === 'bound'
      ? h(UBadge, { color: 'warning', variant: 'subtle', class: 'whitespace-nowrap' }, () => boundLabel(row.original))
      : h(UBadge, { color: 'success', variant: 'subtle', class: 'whitespace-nowrap' }, () => 'Free')
  },
  {
    id: 'scope',
    header: 'Scope',
    enableSorting: false,
    // workspaceId null = synced from the provider, shared with every admin; set = claimed by a workspace
    cell: ({ row }) => row.original.workspaceId === null
      ? h(UBadge, { color: 'neutral', variant: 'outline', class: 'whitespace-nowrap' }, () => 'Shared')
      : h(UBadge, { color: 'primary', variant: 'subtle', class: 'whitespace-nowrap' }, () => 'Workspace')
  }
]

// ── states ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const errorState = computed<{ title: string, description?: string } | null>(() => {
  if (!error.value) return null
  const statusCode = error.value.statusCode
  const body = error.value.data as Partial<ProviderErrorBody> | undefined
  switch (statusCode) {
    case 503:
      return { title: 'AdsPower is not reachable. Is the AdsPower app running?' }
    case 429:
      return { title: 'AdsPower is busy, try again in a moment' }
    case 502:
      return { title: 'AdsPower returned an error', description: body?.error }
    default:
      return { title: 'Could not load profiles' }
  }
})

const isEmpty = computed(() => status.value === 'success' && !error.value && profiles.value.length === 0)
const isNoMatch = computed(() => status.value === 'success' && !error.value && profiles.value.length > 0 && filtered.value.length === 0)
const showTable = computed(() => !errorState.value && !isEmpty.value && !isNoMatch.value)
</script>

<template>
  <UDashboardPanel id="browser-profiles">
    <template #header>
      <UDashboardNavbar title="Browser profiles">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <!-- three labelled buttons clip the H1 (`truncate`) at 390 px → icon-only below `sm`, aria-label keeps the name -->
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="bp-refresh"
            @click="refresh()"
          />
          <UButton
            label="Default settings"
            aria-label="Default settings"
            icon="i-lucide-sliders-horizontal"
            color="neutral"
            variant="outline"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="bp-defaults"
            @click="defaultsOpen = true"
          />
          <UButton
            label="Create profile"
            aria-label="Create profile"
            icon="i-lucide-plus"
            color="primary"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="bp-create"
            @click="createOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div data-testid="bp-page" :data-status="status" class="flex flex-1 flex-col gap-4">
        <div class="flex flex-wrap items-center gap-1.5">
          <UInput
            v-model="search"
            class="w-full sm:max-w-sm"
            icon="i-lucide-search"
            placeholder="Search name, profile id or group"
            :disabled="pending"
            data-testid="bp-search"
          />

          <div class="flex flex-wrap items-center gap-1.5">
            <USelect
              v-model="group"
              :items="groupItems"
              :disabled="pending"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              placeholder="All groups"
              class="min-w-36"
              data-testid="bp-group-filter"
            />
            <USelect
              v-model="statusFilter"
              :items="statusItems"
              :disabled="pending"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              placeholder="Status"
              class="min-w-36"
              data-testid="bp-status-filter"
            />
            <UButton
              v-if="hasActiveFilter"
              label="Clear filters"
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              :disabled="pending"
              data-testid="bp-clear-filters"
              @click="clearFilters"
            />
          </div>
        </div>

        <UAlert
          v-if="errorState"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="errorState.title"
          :description="errorState.description"
          data-testid="bp-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="pending"
              data-testid="bp-retry"
              @click="refresh()"
            />
          </template>
        </UAlert>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-app-window"
          title="No profiles in AdsPower"
          description="Create profiles in the AdsPower app, then refresh."
          data-testid="bp-empty"
        />

        <UEmpty
          v-else-if="isNoMatch"
          icon="i-lucide-search-x"
          title="No profiles match your filters"
          data-testid="bp-no-match"
        >
          <template #actions>
            <UButton
              label="Clear filters"
              icon="i-lucide-x"
              color="neutral"
              variant="outline"
              data-testid="bp-no-match-clear"
              @click="clearFilters"
            />
          </template>
        </UEmpty>

        <div v-if="showTable" class="overflow-x-auto" data-testid="bp-table">
          <UTable
            v-model:pagination="pagination"
            v-model:sorting="sorting"
            :pagination-options="{ getPaginationRowModel: getPaginationRowModel() }"
            :data="filtered"
            :columns="columns"
            :loading="pending"
            loading-animation="carousel"
            class="shrink-0"
            :ui="{
              base: 'border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r whitespace-nowrap',
              td: 'border-b border-default',
              separator: 'h-0'
            }"
          >
            <template #empty>
              {{ pending ? 'Loading profiles…' : '' }}
            </template>
          </UTable>
        </div>

        <div
          v-if="!errorState"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4"
        >
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            <span data-testid="bp-count">Showing {{ filtered.length }} of {{ total }} profiles</span>
            <span class="hidden sm:inline" aria-hidden="true">·</span>
            <span
              :title="syncedAt ?? undefined"
              data-testid="bp-synced"
            >Synced {{ syncedAt ? syncedAgo : '—' }}</span>
          </div>

          <UPagination
            v-if="filtered.length > PAGE_SIZE"
            :page="currentPage"
            :items-per-page="PAGE_SIZE"
            :total="filtered.length"
            data-testid="bp-pagination"
            @update:page="setPage"
          />
        </div>
      </div>

      <BrowserProfilesDefaultsSlideover v-model:open="defaultsOpen" />
      <BrowserProfilesCreateModal v-model:open="createOpen" @created="onCreated" />
    </template>
  </UDashboardPanel>
</template>
