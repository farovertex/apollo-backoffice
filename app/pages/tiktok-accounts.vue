<script setup lang="ts">
/**
 * FEAT-003 — TikTok accounts (functions 3.1 create, 3.3 list, delete from 3.2; api-contract.md v1).
 * One `GET /backend/tiktok-accounts` per load / Refresh / after create / after delete via `useApi()`; search is
 * client-side (label / loginEmail / profile name / profile id), rows sorted by createdAt desc, no pagination.
 * Password: the table renders the literal mask until the row toggle is on (value never in the DOM while masked);
 * Copy reads it from the row data. Delete confirms in a modal.
 * FEAT-004: Login → `POST /backend/tiktok-accounts/:id/login` (202 / 409 → `TiktokAccountsLoginModal`, other →
 * toast); the button is disabled while `runningJob` is set; the badge maps `needsHuman` to "Needs OTP" and a
 * `lastLoginError` chip (`ta-login-error`) sits next to it while `loggedOut`. Modal close / success → one refresh.
 * FEAT-005 (discover advertisers, api-contract.md v1 §5/§7): columns "BC org" (`ta-bc-org` + copy) and "Advertisers"
 * (`ta-adv-count` opens `TiktokAccountsAdvertisersSlideover`, `ta-adv-synced` / `ta-adv-syncing` / `ta-adv-error`
 * chip) after Session status; row action Sync (`ta-sync`) → `POST /backend/tiktok-accounts/:id/discover` (202 / 409 →
 * poll `GET /backend/tiktok-accounts/:id` every 2 s, one loop per account id, until `runningJob === null` → refresh +
 * toast; other errors → toast, no poll). The latest polled account is merged into its row so "Syncing…" shows live.
 */
import type { TableColumn } from '@nuxt/ui'
import { formatTimeAgo } from '@vueuse/core'
import type { UseTimeAgoMessages } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { DiscoverJobResponse } from '#shared/types/advertisers'
import type { AccountsResponse, LoginConflictBody, LoginJobResponse, SessionStatus, TikTokAccount } from '#shared/types/tiktok-accounts'
import PasswordCell from '~/components/PasswordCell.vue'

useSeoMeta({ title: 'TikTok accounts' })

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const UTooltip = resolveComponent('UTooltip')
const UIcon = resolveComponent('UIcon')

const POLL_MS = 2000

const api = useApi()
const toast = useToast()

// `server: false`: one visible XHR per load (stubbable by QA with page.route), never blocks SSR.
const { data, status, error, refresh } = useLazyAsyncData(
  'tiktok-accounts',
  // retry: 0 — one request per load, ofetch must not re-issue it on 5xx
  () => api<AccountsResponse>('/tiktok-accounts', { retry: 0 }),
  { server: false }
)

// `idle` = SSR HTML / before the client fetch starts (server: false) — show it as loading, never as "no data"
const pending = computed(() => status.value === 'idle' || status.value === 'pending')
const accounts = computed<TikTokAccount[]>(() =>
  [...(data.value?.accounts ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
)

// ── search (client-side) ─────────────────────────────────────────────────────────────────────────────────────────────
const search = ref('')
const searchDebounced = refDebounced(search, 250)

const filtered = computed<TikTokAccount[]>(() => {
  const needle = searchDebounced.value.trim().toLowerCase()
  if (!needle) return accounts.value
  return accounts.value.filter(a =>
    (a.label ?? '').toLowerCase().includes(needle)
    || a.loginEmail.toLowerCase().includes(needle)
    || (a.browserProfile?.name ?? '').toLowerCase().includes(needle)
    || (a.browserProfile?.providerProfileId ?? '').toLowerCase().includes(needle)
  )
})

// ── password reveal (per account id, owned here so table re-renders never leak a revealed cell to another row) ───────
const revealed = ref(new Set<string>())
function toggleRevealed(id: string) {
  const next = new Set(revealed.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  revealed.value = next
}
// a fresh dataset (refresh / after create / after delete) starts fully masked and drops the per-row poll snapshots
watch(data, () => {
  revealed.value = new Set()
  polledById.value = new Map()
})

// ── relative time ────────────────────────────────────────────────────────────────────────────────────────────────────
// `useNow` re-renders the Created / Advertisers columns every 30 s (same output as `useTimeAgo`, usable inside cell render fns)
const now = useNow({ interval: 30_000 })
function timeAgo(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}
// compact variant for the Advertisers column ("Synced 5 min ago") so the table still fits at 1440 px with the sidebar
const SHORT_AGO: UseTimeAgoMessages = {
  justNow: 'just now',
  past: n => n.match(/\d/) ? `${n} ago` : n,
  future: n => n.match(/\d/) ? `in ${n}` : n,
  invalid: '—',
  second: n => `${n} s`,
  minute: n => `${n} min`,
  hour: n => `${n} h`,
  day: (n, past) => n === 1 ? (past ? 'yesterday' : 'tomorrow') : `${n} d`,
  week: (n, past) => n === 1 ? (past ? 'last week' : 'next week') : `${n} w`,
  month: (n, past) => n === 1 ? (past ? 'last month' : 'next month') : `${n} mo`,
  year: (n, past) => n === 1 ? (past ? 'last year' : 'next year') : `${n} y`
}
function shortAgo(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, { messages: SHORT_AGO }, now.value)
}
// row action buttons show their label only from `2xl` (1536 px); below that they are icon-only with a tooltip
const wideActions = useMediaQuery('(min-width: 1536px)')
const ACTION_LABEL_UI = { label: 'hidden 2xl:inline' }

// ── clipboard ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function copyText(text: string, title: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({ title, description: text, color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy', description: 'Clipboard access was denied by the browser.', color: 'error' })
  }
}

/** `7616636543968673809` → `7616…3809` (full id stays in `title`) */
function shortId(id: string): string {
  return id.length > 10 ? `${id.slice(0, 4)}…${id.slice(-4)}` : id
}

// ── session status badge ─────────────────────────────────────────────────────────────────────────────────────────────
const SESSION_BADGE: Record<SessionStatus, { label: string, color: 'neutral' | 'success' | 'warning' | 'error', variant: 'subtle' | 'outline' }> = {
  unknown: { label: 'Unknown', color: 'neutral', variant: 'subtle' },
  loggedIn: { label: 'Logged in', color: 'success', variant: 'subtle' },
  loggedOut: { label: 'Logged out', color: 'warning', variant: 'subtle' },
  needsHuman: { label: 'Needs OTP', color: 'error', variant: 'subtle' },
  disabled: { label: 'Disabled', color: 'neutral', variant: 'outline' }
}
function sessionBadge(s: SessionStatus) {
  return SESSION_BADGE[s] ?? { label: s, color: 'neutral', variant: 'subtle' }
}

// ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const deleteOpen = ref(false)
const deleteTarget = ref<TikTokAccount | null>(null)

// ── login (FEAT-004) ─────────────────────────────────────────────────────────────────────────────────────────────────
const loginOpen = ref(false)
const loginTarget = ref<TikTokAccount | null>(null)
// account id whose POST …/login is in flight (button spinner + no double click)
const loginStarting = ref<string | null>(null)

function openLoginModal(account: TikTokAccount) {
  loginTarget.value = account
  loginOpen.value = true
}

async function onLogin(account: TikTokAccount) {
  if (loginStarting.value || account.runningJob) return
  loginStarting.value = account.id
  try {
    // retry: 0 — exactly one POST per click (ofetch would otherwise re-issue it on 5xx)
    await api<LoginJobResponse>(`/tiktok-accounts/${encodeURIComponent(account.id)}/login`, { method: 'POST', retry: 0 })
    openLoginModal(account)
  } catch (e) {
    const err = e as FetchError<Partial<LoginConflictBody>>
    if (err.statusCode === 409) {
      // a job or human task already exists for this account → follow it in the modal (body: jobId / humanTaskId)
      openLoginModal(account)
    } else {
      toast.add({
        title: 'Could not start the login',
        description: err.data?.error ?? err.message ?? 'Unexpected error',
        color: 'error'
      })
    }
  } finally {
    loginStarting.value = null
  }
}

function askDelete(account: TikTokAccount) {
  deleteTarget.value = account
  deleteOpen.value = true
}

// ── discover / sync advertisers (FEAT-005) ───────────────────────────────────────────────────────────────────────────
// latest `GET /tiktok-accounts/:id` snapshot per polled account, merged into its row (so "Syncing…" is live without
// re-fetching the whole list every 2 s); cleared whenever the list itself is refreshed
const polledById = shallowRef(new Map<string, TikTokAccount>())
const rows = computed<TikTokAccount[]>(() => filtered.value.map(a => polledById.value.get(a.id) ?? a))

// account id whose POST …/discover is in flight (button spinner + no double click)
const syncStarting = ref<string | null>(null)
// one poll loop per account id
const pollTimers = new Map<string, ReturnType<typeof setInterval>>()
const pollInFlight = new Set<string>()

function stopDiscoverPoll(id: string) {
  const t = pollTimers.get(id)
  if (t) clearInterval(t)
  pollTimers.delete(id)
  pollInFlight.delete(id)
}

async function pollDiscover(id: string) {
  if (pollInFlight.has(id) || !pollTimers.has(id)) return
  pollInFlight.add(id)
  try {
    // retry: 0 — one request per tick, ofetch must not re-issue it on 5xx
    const next = await api<TikTokAccount>(`/tiktok-accounts/${encodeURIComponent(id)}`, { retry: 0 })
    if (!pollTimers.has(id)) return // stopped meanwhile (unmount)
    polledById.value = new Map(polledById.value).set(id, next)
    if (next.runningJob === null) {
      stopDiscoverPoll(id)
      await refresh()
      const label = next.label ?? next.loginEmail
      if (next.lastDiscoverError) {
        toast.add({ title: 'Advertiser sync failed', description: `${label}: ${discoverErrorText(next.lastDiscoverError)}`, color: 'error' })
      } else {
        toast.add({ title: `Advertisers synced (${next.advertiserCount})`, description: label, color: 'success' })
      }
    }
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    // the account is gone → nothing left to follow; any other error is transient, the next tick retries
    if (err.statusCode === 404) {
      stopDiscoverPoll(id)
      await refresh()
    }
  } finally {
    pollInFlight.delete(id)
  }
}

function startDiscoverPoll(id: string) {
  if (pollTimers.has(id)) return
  pollTimers.set(id, setInterval(() => {
    void pollDiscover(id)
  }, POLL_MS))
  void pollDiscover(id)
}

onUnmounted(() => {
  for (const id of [...pollTimers.keys()]) stopDiscoverPoll(id)
})

function syncBlockedReason(account: TikTokAccount): string | null {
  if (account.runningJob) return account.runningJob.type === 'discover' ? 'Sync in progress' : 'Login in progress'
  if (account.sessionStatus === 'needsHuman') return 'Needs OTP — finish the login first'
  if (!account.isActive) return 'Account is disabled'
  return null
}

async function onSync(account: TikTokAccount) {
  if (syncStarting.value || syncBlockedReason(account)) return
  const label = account.label ?? account.loginEmail
  syncStarting.value = account.id
  try {
    // retry: 0 — exactly one POST per click (ofetch would otherwise re-issue it on 5xx)
    await api<DiscoverJobResponse>(`/tiktok-accounts/${encodeURIComponent(account.id)}/discover`, { method: 'POST', retry: 0 })
    toast.add({ title: 'Syncing advertisers…', description: label, color: 'info' })
    startDiscoverPoll(account.id)
  } catch (e) {
    const err = e as FetchError<Partial<LoginConflictBody>>
    if (err.statusCode === 409) {
      // a login / discover job or a human task already exists for this account → follow it anyway
      toast.add({ title: 'Already running', description: err.data?.error ?? label, color: 'info' })
      startDiscoverPoll(account.id)
    } else {
      toast.add({
        title: 'Could not start the sync',
        description: err.data?.error ?? err.message ?? 'Unexpected error',
        color: 'error'
      })
    }
  } finally {
    syncStarting.value = null
  }
}

// ── advertisers slideover (FEAT-005) ─────────────────────────────────────────────────────────────────────────────────
const advOpen = ref(false)
const advTargetId = ref<string | null>(null)
// resolved from the live rows so the slideover sees the polled `runningJob` / `advertiserCount`
const advTarget = computed<TikTokAccount | null>(() => {
  const id = advTargetId.value
  if (!id) return null
  return polledById.value.get(id) ?? accounts.value.find(a => a.id === id) ?? null
})

function openAdvertisers(account: TikTokAccount) {
  advTargetId.value = account.id
  advOpen.value = true
}

// ── table ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const columns: TableColumn<TikTokAccount>[] = [
  {
    accessorKey: 'label',
    header: 'Label',
    cell: ({ row }) => row.original.label
      ? h('span', { class: 'font-medium text-highlighted' }, row.original.label)
      : h('span', { class: 'text-muted' }, '—')
  },
  {
    accessorKey: 'loginEmail',
    header: 'Login email',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, row.original.loginEmail)
  },
  {
    id: 'password',
    header: 'Password',
    cell: ({ row }) => h(PasswordCell, {
      key: row.original.id,
      value: row.original.password,
      shown: revealed.value.has(row.original.id),
      onToggle: () => toggleRevealed(row.original.id)
    })
  },
  {
    id: 'browserProfile',
    header: 'Browser profile',
    cell: ({ row }) => {
      const p = row.original.browserProfile
      if (!p) return h('span', { class: 'text-muted' }, '—')
      return h('div', { class: 'flex flex-col whitespace-nowrap' }, [
        h('span', { class: 'font-medium text-highlighted' }, p.name),
        h('span', { class: 'font-mono text-xs text-muted' }, p.providerProfileId)
      ])
    }
  },
  {
    accessorKey: 'sessionStatus',
    header: 'Session status',
    cell: ({ row }) => {
      const b = sessionBadge(row.original.sessionStatus)
      const err = row.original.lastLoginError
      const children = [h(UBadge, { color: b.color, variant: b.variant, class: 'whitespace-nowrap' }, () => b.label)]
      if (row.original.sessionStatus === 'loggedOut' && err) {
        children.push(h(UBadge, {
          'color': 'neutral',
          'variant': 'outline',
          'size': 'sm',
          'icon': 'i-lucide-triangle-alert',
          'class': 'whitespace-nowrap',
          'title': loginErrorText(err),
          'data-testid': 'ta-login-error',
          'data-error': err
        }, () => loginErrorShort(err)))
      }
      return h('div', { class: 'flex flex-wrap items-center gap-1' }, children)
    }
  },
  {
    accessorKey: 'bcOrgId',
    header: 'BC org',
    cell: ({ row }) => {
      const org = row.original.bcOrgId
      if (!org) return h('span', { 'class': 'text-muted', 'data-testid': 'ta-bc-org' }, '—')
      return h('div', { class: 'flex items-center gap-0.5 whitespace-nowrap' }, [
        h('span', { 'class': 'font-mono text-xs text-highlighted', 'title': org, 'data-testid': 'ta-bc-org', 'data-org': org }, shortId(org)),
        h(UButton, {
          'icon': 'i-lucide-copy',
          'color': 'neutral',
          'variant': 'ghost',
          'size': 'xs',
          'aria-label': 'Copy BC org id',
          'data-testid': 'ta-bc-org-copy',
          'onClick': () => copyText(org, 'BC org id copied')
        })
      ])
    }
  },
  {
    accessorKey: 'advertiserCount',
    header: 'Advertisers',
    cell: ({ row }) => {
      const a = row.original
      const syncing = a.runningJob?.type === 'discover'
      const children = [
        h(UButton, {
          'label': String(a.advertiserCount),
          'icon': 'i-lucide-building-2',
          'color': 'neutral',
          'variant': 'ghost',
          'size': 'xs',
          'class': 'font-medium tabular-nums',
          'aria-label': `${a.advertiserCount} advertisers — open the list`,
          'data-testid': 'ta-adv-count',
          'data-count': a.advertiserCount,
          'onClick': () => openAdvertisers(a)
        })
      ]
      if (syncing) {
        children.push(h('span', { 'class': 'flex items-center gap-1 whitespace-nowrap text-xs text-muted', 'data-testid': 'ta-adv-syncing' }, [
          h(UIcon, { name: 'i-lucide-loader-circle', class: 'size-3.5 shrink-0 animate-spin text-primary' }),
          'Syncing…'
        ]))
      } else {
        children.push(h('span', {
          'class': 'whitespace-nowrap text-xs text-muted',
          'title': a.lastDiscoverAt ?? undefined,
          'data-testid': 'ta-adv-synced'
        }, a.lastDiscoverAt ? `Synced ${shortAgo(a.lastDiscoverAt)}` : 'Never synced'))
        if (a.lastDiscoverError && !a.runningJob) {
          const code = a.lastDiscoverError
          children.push(h(UTooltip, { text: discoverErrorText(code) }, () => h(UBadge, {
            'color': 'error',
            'variant': 'subtle',
            'size': 'sm',
            'icon': 'i-lucide-triangle-alert',
            'class': 'whitespace-nowrap',
            'title': discoverErrorText(code),
            'data-testid': 'ta-adv-error',
            'data-error': code
          }, () => discoverErrorShort(code))))
        }
      }
      return h('div', { class: 'flex flex-col items-start gap-0.5' }, children)
    }
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap', title: row.original.createdAt }, timeAgo(row.original.createdAt))
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => {
      const job = row.original.runningJob
      const running = !!job
      const syncBlocked = syncBlockedReason(row.original)
      const loginBlocked = running ? (job.type === 'discover' ? 'Sync in progress' : 'Login in progress') : null
      const wide = wideActions.value
      return h('div', { class: 'flex items-center justify-end gap-1 whitespace-nowrap' }, [
        // the tooltip trigger is a span so it still opens on hover while the button is disabled; below 2xl the
        // buttons are icon-only and the tooltip names the action
        h(UTooltip, { text: syncBlocked ?? 'Sync advertisers', disabled: wide && !syncBlocked }, () => h('span', { class: 'inline-flex' }, [
          h(UButton, {
            'label': 'Sync',
            'icon': 'i-lucide-refresh-cw',
            'color': 'neutral',
            'variant': 'outline',
            'size': 'xs',
            'ui': ACTION_LABEL_UI,
            'disabled': !!syncBlocked,
            'loading': syncStarting.value === row.original.id,
            'aria-label': 'Sync',
            'data-testid': 'ta-sync',
            'onClick': () => onSync(row.original)
          })
        ])),
        h(UTooltip, { text: loginBlocked ?? 'Login', disabled: wide && !loginBlocked }, () => h('span', { class: 'inline-flex' }, [
          h(UButton, {
            'label': 'Login',
            'icon': 'i-lucide-log-in',
            'color': 'neutral',
            'variant': 'outline',
            'size': 'xs',
            'ui': ACTION_LABEL_UI,
            'disabled': running,
            'loading': loginStarting.value === row.original.id,
            'aria-label': 'Login',
            'data-testid': 'ta-login',
            'onClick': () => onLogin(row.original)
          })
        ])),
        h(UTooltip, { text: 'Delete', disabled: wide }, () => h('span', { class: 'inline-flex' }, [
          h(UButton, {
            'label': 'Delete',
            'icon': 'i-lucide-trash-2',
            'color': 'error',
            'variant': 'subtle',
            'size': 'xs',
            'ui': ACTION_LABEL_UI,
            'aria-label': 'Delete',
            'data-testid': 'ta-delete',
            'onClick': () => askDelete(row.original)
          })
        ]))
      ])
    }
  }
]

// ── states ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const errorDescription = computed<string | undefined>(() => {
  if (!error.value) return undefined
  const body = error.value.data as Partial<ApiErrorBody> | undefined
  return body?.error ?? error.value.message ?? undefined
})
const isEmpty = computed(() => status.value === 'success' && !error.value && accounts.value.length === 0)
const showTable = computed(() => !error.value && !isEmpty.value)
</script>

<template>
  <UDashboardPanel id="tiktok-accounts">
    <template #header>
      <UDashboardNavbar title="TikTok accounts">
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
            data-testid="ta-refresh"
            @click="refresh()"
          />
          <UButton
            label="Add account"
            aria-label="Add account"
            icon="i-lucide-plus"
            color="primary"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="ta-add"
            @click="addOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div data-testid="ta-page" :data-status="status" class="flex flex-1 flex-col gap-4">
        <div class="flex flex-wrap items-center gap-1.5">
          <UInput
            v-model="search"
            class="w-full sm:max-w-sm"
            icon="i-lucide-search"
            placeholder="Search label, email, profile name or id"
            :disabled="pending"
            data-testid="ta-search"
          />
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="Could not load accounts"
          :description="errorDescription"
          data-testid="ta-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="pending"
              data-testid="ta-retry"
              @click="refresh()"
            />
          </template>
        </UAlert>

        <UEmpty
          v-else-if="isEmpty"
          icon="i-lucide-user-round"
          title="No TikTok accounts yet"
          description="Add a TikTok Ads account and bind it to a free AdsPower profile."
          data-testid="ta-empty"
        >
          <template #actions>
            <UButton
              label="Add account"
              icon="i-lucide-plus"
              color="primary"
              data-testid="ta-empty-add"
              @click="addOpen = true"
            />
          </template>
        </UEmpty>

        <div v-if="showTable" class="overflow-x-auto" data-testid="ta-table">
          <UTable
            :data="rows"
            :columns="columns"
            :loading="pending"
            loading-animation="carousel"
            class="shrink-0"
            :ui="{
              base: 'border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'px-3 py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r whitespace-nowrap',
              td: 'px-3 border-b border-default',
              separator: 'h-0'
            }"
          >
            <template #empty>
              {{ pending ? 'Loading accounts…' : 'No accounts match your search' }}
            </template>
          </UTable>
        </div>

        <div
          v-if="!error"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
        >
          <span data-testid="ta-count">{{ rows.length }} accounts</span>
        </div>
      </div>

      <TiktokAccountsAddModal v-model:open="addOpen" @created="refresh()" />
      <TiktokAccountsDeleteModal
        v-model:open="deleteOpen"
        :account="deleteTarget"
        @deleted="refresh()"
      />
      <TiktokAccountsLoginModal
        v-model:open="loginOpen"
        :account-id="loginTarget?.id ?? null"
        :account-label="loginTarget?.label ?? loginTarget?.loginEmail ?? null"
        @success="refresh()"
        @close="refresh()"
      />
      <TiktokAccountsAdvertisersSlideover
        v-model:open="advOpen"
        :account="advTarget"
        @sync="onSync"
      />
    </template>
  </UDashboardPanel>
</template>
