<script setup lang="ts">
/**
 * FEAT-002 — Browser profiles (functions 2.1 + 2.2 automatic, read-only; api-contract.md v2).
 * One `GET /backend/browser-profiles/available` (no query) per load / Refresh — the API syncs the provider list into
 * Mongo, then the response is the visible rows already stored there (including rows this pull did not return).
 * Search, group and status filters, sort and pagination are client-side on that list (AdsPower Local API is throttled
 * to ~1 req/s).
 * No claim / start / stop / delete here — those are later features.
 * functions 2.11 (TASK-force-close): one row action, "Force close" (`bp-force-close`) → confirm modal (`bp-force-confirm`)
 * → `POST /backend/browser-profiles/:id/force-close` (202). It is **not** a job: the API records the request and the
 * worker on the profile's node closes the Chrome window right away, even when a job is using the profile (that job
 * ends as cancelled). The row is polled (reason `forceClose`) until its `runState` leaves `closing`; the admin then
 * opens the profile themselves in the AdsPower app. Enabled only for `open` / `opening` / `closing` rows.
 * FEAT-006 (functions 2.3 + 2.10, api-contract.md v1): header buttons "Default settings"
 * (`BrowserProfilesDefaultsSlideover`) and "Create profile" (`BrowserProfilesCreateModal`, one extra
 * `GET …/available` after a 201); the Proxy column prefers `proxyRef.label` over the FEAT-002 provider snapshot and
 * rows created from the BO carry a fingerprint icon.
 * FEAT-007: every item gains `tags` (display only, from the AdsPower `remark`) — the Group column shows one small
 * badge per tag next to the group name; tags are never part of the client-side search or the group filter.
 * FEAT-024 (api-contract §3.1/§3.2/§3.4, §10 · spec AC-11/A12): `/available` answers from Mongo and never calls
 * AdsPower, so the sync is explicit — header button "Sync now" (`bp-sync-now`) posts
 * `/backend/browser-profiles/sync` (202) and the page re-reads itself every 2 s until `sync.status === 'idle'`
 * (`bp-sync-status`, `bp-sync-error`). The same single timer (`useProfilesPoll`, 2 s / 90 s cap, one interval per
 * page) also watches reserved rows: a profile created from the BO starts as `runState: 'provisioning'` with
 * `providerProfileId: null` → `Creating…` badge + `—` Profile ID until its `provider{create}` job is done, or an
 * `Error` badge carrying `provisionError`.
 */
import type { TableColumn } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import { getPaginationRowModel } from '@tanstack/table-core'
import { formatTimeAgo } from '@vueuse/core'
import type { UseTimeAgoMessages } from '@vueuse/core'
import type { AvailableProfile, AvailableProfileStatus, AvailableResponse, ForceCloseResponse, ProviderErrorBody, SyncResponse } from '#shared/types/browser-profiles'
import type { ProviderNodeView, ProviderNodesResponse } from '#shared/types/provider-nodes'
import type { ProfilesPollReason } from '~/composables/useProfilesPoll'

useSeoMeta({ title: 'Browser profiles' })

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const UIcon = resolveComponent('UIcon')
const UTooltip = resolveComponent('UTooltip')

const api = useApi()
const toast = useToast()

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
// FEAT-024: top-level `syncedAt` = `sync.lastSyncedAt`, `null` when the list was never synced (`Synced —`).
// `useTimeAgo` (VueUse) re-renders every 30 s.
const syncedAt = computed<string | null>(() => data.value?.syncedAt ?? null)
const syncedAgo = useTimeAgo(() => syncedAt.value ?? 0)

// ── filters (client-side) ────────────────────────────────────────────────────────────────────────────────────────────
const ALL = '__all__'
// FEAT-027: the Proxies page "Bound to" link lands here as `?q=<profile name>` so the match is pre-filled.
const route = useRoute()
const initialQuery = typeof route.query.q === 'string' ? route.query.q : ''
const search = ref(initialQuery)
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
// FEAT-024: `providerProfileId` may be null (reserved row) — the API ignores those for `q`, so do we.
const filtered = computed<AvailableProfile[]>(() => {
  const needle = searchDebounced.value.trim().toLowerCase()
  return profiles.value.filter((p) => {
    if (needle) {
      const hit = p.name.toLowerCase().includes(needle)
        || (p.providerProfileId ?? '').toLowerCase().includes(needle)
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

// any filter change → page 1. FEAT-024: a re-read (Refresh or a 2 s poll tick) keeps the current page — it only
// clamps it when the list got shorter, otherwise polling would drag the admin back to page 1 every 2 s.
watch([searchDebounced, group, statusFilter], () => setPage(1))
watch(filtered, (rows) => {
  const lastPage = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  if (currentPage.value > lastPage) setPage(lastPage)
})

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

/**
 * FEAT-024 — second badge of the Status column (`bp-run-state`, `data-state` = the raw `runState`):
 * `provisioning` → neutral `Creating…` while the `provider{create}` job runs · `error` + `provisionError` → error
 * badge whose tooltip/`title` is the API's own text. Every other `runState` (closed / opening / open / closing) is
 * normal operation and adds nothing.
 */
function runStateBadge(p: AvailableProfile) {
  if (p.runState === 'provisioning') {
    return h(UBadge, {
      'color': 'neutral',
      'variant': 'subtle',
      'icon': 'i-lucide-loader-circle',
      'class': 'whitespace-nowrap',
      'ui': { leadingIcon: 'animate-spin' },
      'title': 'The browser profile is being created in AdsPower',
      'data-testid': 'bp-run-state',
      'data-state': p.runState
    }, () => 'Creating…')
  }
  if (p.runState === 'error' && p.provisionError) {
    return h(UTooltip, { text: p.provisionError }, () => h(UBadge, {
      'color': 'error',
      'variant': 'subtle',
      'icon': 'i-lucide-triangle-alert',
      'class': 'whitespace-nowrap',
      'title': p.provisionError ?? undefined,
      'data-testid': 'bp-run-state',
      'data-state': p.runState
    }, () => 'Error'))
  }
  return null
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

// ── sync + polling (FEAT-024) ────────────────────────────────────────────────────────────────────────────────────────
const sync = computed(() => data.value?.sync ?? null)
/** the POST itself is in flight */
const syncPosting = ref(false)
/**
 * we got a 202 and have not seen an `idle` answer yet. Without it the button would flicker out of `loading` between
 * the 202 and the first poll tick (the data in hand still says `idle`).
 */
const syncRequested = ref(false)
/** the API says a `syncList` job is queued/running (or we just asked for one) */
const syncRunning = computed(() => sync.value?.status === 'running' || syncRequested.value)
/** `providerNodes.lastSyncError` of the last sync — shown under Synced and toasted once per distinct text */
const syncError = computed<string | null>(() => sync.value?.lastError ?? null)
/** visible rows (after the client-side filters) whose provider profile is still being created */
const provisioningCount = computed(() => filtered.value.filter(p => p.runState === 'provisioning').length)
/** functions 2.11 — ids we asked to force-close and have not yet seen leave `closing` (the same single timer watches them) */
const forceClosing = ref<string[]>([])
const forceClosingCount = computed(() => forceClosing.value.filter(id => profiles.value.find(p => p.id === id)?.runState === 'closing').length)

// one interval for the whole page (spec A12): 2 s, 90 s per reason, cleared on unmount
const poll = useProfilesPoll(() => refresh())

poll.onTimeout('sync', () => {
  syncRequested.value = false
  toast.add({
    title: 'Sync is taking longer than expected',
    description: 'The sync job is still queued. Press Refresh in a moment.',
    color: 'warning'
  })
})

/** what the single timer is waiting for — a data attribute QA can watch (`''` = no timer) */
const pollingReasons = computed(() => poll.waiting.value.join(' '))

/** the Sync now button is busy: POST in flight, or a job is running and we have not given up watching it */
const syncing = computed(() => syncPosting.value || (syncRunning.value && !poll.hasGivenUp('sync')))

// a response that says the job is over ends the "requested" state
watch(sync, (s) => {
  if (s?.status === 'idle') syncRequested.value = false
})

// one toast per distinct sync error (the poll sees the same text every 2 s)
let toastedSyncError: string | null = null
watch(syncError, (message) => {
  if (!message) {
    toastedSyncError = null
    return
  }
  if (message === toastedSyncError) return
  toastedSyncError = message
  toast.add({ title: 'Last profile sync failed', description: message, color: 'error' })
}, { immediate: true })

// the single source of truth for the timer: which reasons the data in hand still waits for
watch([syncRunning, provisioningCount, forceClosingCount], () => {
  const reasons: ProfilesPollReason[] = []
  if (syncRunning.value) reasons.push('sync')
  if (provisioningCount.value > 0) reasons.push('provisioning')
  if (forceClosingCount.value > 0) reasons.push('forceClose')
  poll.track(reasons)
}, { immediate: true })

// ── provider nodes (FEAT-031, api-contract §4.1/§7) ─────────────────────────────────────────────────────────────────
/** secondary information under `bp-synced`: never blocks or toasts — a down node registry must not hide the table */
const nodesState = ref<'loading' | 'ready' | 'error'>('loading')
const nodes = ref<ProviderNodeView[]>([])

/** `GET /backend/provider-nodes`, `retry: 0` — called on load, on the Refresh button and once a sync job finishes;
 * never from the 2 s sync/provisioning/forceClose poll (api-contract §7 request count). */
async function loadNodes() {
  nodesState.value = 'loading'
  try {
    const res = await api<ProviderNodesResponse>('/provider-nodes', { retry: 0 })
    nodes.value = res.nodes
    nodesState.value = 'ready'
  } catch {
    // no toast, no alert, no console error — the footer chip is secondary information (spec "UI behaviour")
    nodes.value = []
    nodesState.value = 'error'
  }
}
if (import.meta.client) void loadNodes()

// "after a sync finishes" = the running → idle transition, not every poll tick that still sees `running`
watch(syncRunning, (running, wasRunning) => {
  if (wasRunning && !running) void loadNodes()
})

const nodesNow = useNow({ interval: 30_000 })
const NODE_AGO_MESSAGES: UseTimeAgoMessages = {
  justNow: 'just now',
  past: n => n.match(/\d/) ? `${n} ago` : n,
  future: n => n.match(/\d/) ? `in ${n}` : n,
  invalid: '—',
  second: n => `${n}s`,
  minute: n => `${n}m`,
  hour: n => `${n}h`,
  day: n => `${n}d`,
  week: n => `${n}w`,
  month: n => `${n}mo`,
  year: n => `${n}y`
}
/** `<id> · <timeAgo(lastHeartbeatAt)>` per instance, joined with ` · ` — the `bp-node` tooltip (api-contract §7) */
function nodeTooltip(node: ProviderNodeView): string {
  return node.instances
    .map((inst) => {
      const d = new Date(inst.lastHeartbeatAt)
      const ago = Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, { messages: NODE_AGO_MESSAGES }, nodesNow.value)
      return `${inst.id} · ${ago}`
    })
    .join(' · ')
}

/** `POST /backend/browser-profiles/sync` — exactly one request per click, then the poll takes over */
async function syncNow() {
  if (syncing.value) return
  syncPosting.value = true
  try {
    // retry: 0 — one POST per click (the API dedupes anyway, but a retry would be a second audit row)
    const res = await api<SyncResponse>('/browser-profiles/sync', { method: 'POST', retry: 0 })
    syncRequested.value = true
    // a click after a 90 s give-up restarts the watch window
    poll.retry('sync')
    if (res.reused) {
      toast.add({ title: 'A sync is already running', description: `node ${res.node}`, color: 'info' })
    }
  } catch (e) {
    const err = e as FetchError<Partial<ProviderErrorBody>>
    toast.add({
      title: 'Could not start the sync',
      description: err.data?.error ?? err.message,
      color: 'error'
    })
  } finally {
    syncPosting.value = false
  }
}

// ── force close (functions 2.11) ──────────────────────────────────────────────────────────────────────────────────────
/** only a browser that is (or is about to be) open can be force-closed; a reserved / failed row has nothing to close */
function canForceClose(p: AvailableProfile): boolean {
  return !!p.providerProfileId && (p.runState === 'open' || p.runState === 'opening' || p.runState === 'closing')
}

const forceTarget = ref<AvailableProfile | null>(null)
const forceConfirmOpen = ref(false)
const forcePosting = ref(false)
const forceModalContent = { 'data-testid': 'bp-force-confirm' } as Record<string, string>

function askForceClose(p: AvailableProfile) {
  forceTarget.value = p
  forceConfirmOpen.value = true
}

/** `POST /backend/browser-profiles/:id/force-close` — one request per confirm, then the poll takes over */
async function runForceClose() {
  const target = forceTarget.value
  if (!target || forcePosting.value) return
  forcePosting.value = true
  try {
    const res = await api<ForceCloseResponse>(`/browser-profiles/${encodeURIComponent(target.id)}/force-close`, { method: 'POST', retry: 0 })
    if (!forceClosing.value.includes(target.id)) forceClosing.value = [...forceClosing.value, target.id]
    forceConfirmOpen.value = false
    // the data in hand still says `open` — re-read now so the row shows `closing` and the watcher picks the reason up
    await refresh()
    poll.retry('forceClose')
    toast.add({
      title: res.reused ? 'Force close already requested' : 'Force close requested',
      description: `${target.name} · the node closes the browser in a moment`,
      color: res.reused ? 'info' : 'success'
    })
  } catch (e) {
    const err = e as FetchError<Partial<ProviderErrorBody>>
    const status = err.response?.status ?? err.statusCode
    forceConfirmOpen.value = false
    toast.add({ title: 'Could not force close', description: err.data?.error ?? err.message, color: status === 409 ? 'warning' : 'error' })
    if (status === 409) void refresh()
  } finally {
    forcePosting.value = false
  }
}

// a watched row left `closing` → one toast with the outcome, and the id is dropped (missing row = dropped silently)
watch(profiles, (rows) => {
  if (!forceClosing.value.length) return
  const keep: string[] = []
  for (const id of forceClosing.value) {
    const p = rows.find(r => r.id === id)
    if (!p) continue
    if (p.runState === 'closing') {
      keep.push(id)
      continue
    }
    if (p.runState === 'error' && p.provisionError) {
      toast.add({ title: 'Force close failed', description: `${p.name} · ${p.provisionError}`, color: 'error' })
    } else {
      toast.add({ title: 'Browser closed', description: `${p.name} · open it from the AdsPower app to have a look`, color: 'success' })
    }
  }
  if (keep.length !== forceClosing.value.length) forceClosing.value = keep
})

poll.onTimeout('forceClose', () => {
  toast.add({
    title: 'Force close is taking longer than expected',
    description: 'Is the worker of that node running? Press Refresh in a moment.',
    color: 'warning'
  })
})

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
    // FEAT-024: a reserved row has no provider id yet (and a failed create never gets one) → `—`
    cell: ({ row }) => {
      const id = row.original.providerProfileId
      return h('span', {
        'class': id ? 'font-mono text-xs' : 'font-mono text-xs text-muted',
        'data-testid': 'bp-profile-id'
      }, id ?? '—')
    }
  },
  {
    accessorKey: 'groupName',
    header: 'Group',
    enableSorting: false,
    // FEAT-007: the group text is followed by one small badge per tag (display only — not searched/filtered)
    cell: ({ row }) => {
      const tags = row.original.tags
      const children = [h('span', {}, row.original.groupName ?? '—')]
      if (tags.length) {
        children.push(h('span', { 'class': 'flex flex-wrap items-center gap-1', 'data-testid': 'bp-tags' },
          tags.map(tag => h(UBadge, {
            'key': tag,
            'color': 'neutral',
            'variant': 'subtle',
            'icon': 'i-lucide-tag',
            'class': 'whitespace-nowrap',
            'data-testid': 'bp-tag',
            'data-tag': tag
          }, () => tag))))
      }
      return h('div', { class: 'flex flex-wrap items-center gap-1.5' }, children)
    }
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
    // FEAT-024: the Free/Bound badge is kept and a second `bp-run-state` badge is added for a row whose provider
    // profile is still being created or whose create failed.
    cell: ({ row }) => {
      const p = row.original
      const children = [
        p.status === 'bound'
          ? h(UBadge, { color: 'warning', variant: 'subtle', class: 'whitespace-nowrap' }, () => boundLabel(p))
          : h(UBadge, { color: 'success', variant: 'subtle', class: 'whitespace-nowrap' }, () => 'Free')
      ]
      const runState = runStateBadge(p)
      if (runState) children.push(runState)
      return h('div', { class: 'flex flex-wrap items-center gap-1' }, children)
    }
  },
  {
    id: 'scope',
    header: 'Scope',
    enableSorting: false,
    // workspaceId null = synced from the provider, shared with every admin; set = claimed by a workspace
    cell: ({ row }) => row.original.workspaceId === null
      ? h(UBadge, { color: 'neutral', variant: 'outline', class: 'whitespace-nowrap' }, () => 'Shared')
      : h(UBadge, { color: 'primary', variant: 'subtle', class: 'whitespace-nowrap' }, () => 'Workspace')
  },
  {
    id: 'actions',
    header: '',
    enableSorting: false,
    // functions 2.11: the only row action — disabled for rows with nothing to close, spinning while the node works
    cell: ({ row }) => {
      const p = row.original
      const busy = forceClosing.value.includes(p.id) && p.runState === 'closing'
      return h('div', { class: 'flex justify-end' }, [
        h(UButton, {
          'label': 'Force close',
          'aria-label': `Force close ${p.name}`,
          'icon': 'i-lucide-power-off',
          'color': 'error',
          'variant': 'outline',
          'size': 'xs',
          'disabled': !canForceClose(p) || busy,
          'loading': busy,
          'title': canForceClose(p) ? 'Close the Chrome window right now, even if a job is using it' : 'Nothing to close — the browser is not open',
          'data-testid': 'bp-force-close',
          'data-state': p.runState,
          'onClick': () => askForceClose(p)
        })
      ])
    }
  }
]

// ── states ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// FEAT-024: `/available` reads Mongo, so 503/429/502 cannot come from this route any more — the branches stay as a
// harmless fallback (an old API, or a proxy in between), but a plain failure no longer blames AdsPower.
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
      return { title: 'Could not load profiles', description: body?.error }
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
          <!-- four labelled buttons clip the H1 (`truncate`) at 390 px → icon-only below `sm`, aria-label keeps the name -->
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="bp-refresh"
            @click="() => { refresh(); loadNodes() }"
          />
          <!-- FEAT-024: the explicit profile-list sync (the GET above no longer touches AdsPower) -->
          <UButton
            label="Sync now"
            aria-label="Sync now"
            icon="i-lucide-refresh-ccw-dot"
            color="neutral"
            variant="outline"
            :loading="syncing"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="bp-sync-now"
            @click="syncNow()"
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
      <div
        data-testid="bp-page"
        :data-status="status"
        :data-polling="pollingReasons"
        class="flex flex-1 flex-col gap-4"
      >
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
          description="Create a profile here, or create it in the AdsPower app and press Sync now."
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
              :title="syncedAt ?? 'Never synced'"
              data-testid="bp-synced"
            >Synced {{ syncedAt ? syncedAgo : '—' }}</span>
            <!-- FEAT-031: node chips (per-instance heartbeat) — secondary info, hidden while loading/error -->
            <span
              data-testid="bp-nodes"
              :data-state="nodesState"
              class="inline-flex flex-wrap items-center gap-x-3 gap-y-1"
            >
              <span
                v-for="node in nodes"
                :key="node.id"
                data-testid="bp-node"
                :data-node="node.name"
                :data-alive="node.alive ? 'true' : 'false'"
                :data-alive-instances="node.aliveInstances"
                :data-instances="node.instanceCount"
                :class="node.alive ? 'text-success' : 'text-error'"
                :title="nodeTooltip(node)"
              >{{ node.name }} · {{ node.aliveInstances }}/{{ node.instanceCount }} workers</span>
            </span>
            <!-- FEAT-024: state of the sync job + the node's last sync error, next to / under Synced -->
            <span
              v-if="syncing"
              class="inline-flex items-center gap-1 text-primary"
              data-testid="bp-sync-status"
            >
              <UIcon name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
              Syncing…
            </span>
            <span
              v-if="syncError"
              class="basis-full text-xs text-error"
              :title="syncError"
              data-testid="bp-sync-error"
            >{{ syncError }}</span>
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

      <!-- functions 2.11: confirm before the node kills the browser (a running job on it ends as cancelled) -->
      <UModal
        v-model:open="forceConfirmOpen"
        title="Force close this browser?"
        :description="forceTarget ? `${forceTarget.name} · ${forceTarget.providerProfileId ?? ''}` : ''"
        :dismissible="!forcePosting"
        :ui="{ content: 'max-w-md' }"
        :content="forceModalContent"
      >
        <template #body>
          <div class="flex flex-col gap-4">
            <p class="text-sm text-muted">
              AdsPower closes the Chrome window of this profile right now. A job that is using it fails and ends as
              cancelled. Afterwards open the profile yourself in the AdsPower app to have a look.
            </p>
            <div class="flex flex-wrap justify-end gap-2">
              <UButton
                label="Keep open"
                color="neutral"
                variant="subtle"
                :disabled="forcePosting"
                data-testid="bp-force-confirm-cancel"
                @click="forceConfirmOpen = false"
              />
              <UButton
                label="Force close"
                icon="i-lucide-power-off"
                color="error"
                :loading="forcePosting"
                data-testid="bp-force-confirm-ok"
                @click="runForceClose"
              />
            </div>
          </div>
        </template>
      </UModal>

      <BrowserProfilesDefaultsSlideover v-model:open="defaultsOpen" />
      <BrowserProfilesCreateModal v-model:open="createOpen" @created="onCreated" />
    </template>
  </UDashboardPanel>
</template>
