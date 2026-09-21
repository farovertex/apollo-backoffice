<script setup lang="ts">
/**
 * FEAT-003 — TikTok accounts (functions 3.1 create, 3.3 list, delete from 3.2; api-contract.md v1).
 * One `GET /backend/tiktok-accounts` per load / Refresh / after create / after delete via `useApi()`; search is
 * client-side (label / loginEmail / profile name / profile id), rows sorted by createdAt desc, no pagination.
 * Password: the table renders the literal mask until the row toggle is on (value never in the DOM while masked);
 * Copy reads it from the row data. Login is a BO-only mock (toast, no request). Delete confirms in a modal.
 */
import type { TableColumn } from '@nuxt/ui'
import { formatTimeAgo } from '@vueuse/core'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AccountsResponse, SessionStatus, TikTokAccount } from '#shared/types/tiktok-accounts'
import PasswordCell from '~/components/tiktok-accounts/PasswordCell.vue'

useSeoMeta({ title: 'TikTok accounts' })

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')

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
// a fresh dataset (refresh / after create / after delete) starts fully masked
watch(data, () => {
  revealed.value = new Set()
})

// ── relative time ────────────────────────────────────────────────────────────────────────────────────────────────────
// `useNow` re-renders the Created column every 30 s (same output as `useTimeAgo`, usable inside cell render fns)
const now = useNow({ interval: 30_000 })
function createdAgo(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : formatTimeAgo(d, {}, now.value)
}

// ── session status badge ─────────────────────────────────────────────────────────────────────────────────────────────
const SESSION_BADGE: Record<SessionStatus, { label: string, color: 'neutral' | 'success' | 'warning' | 'error', variant: 'subtle' | 'outline' }> = {
  unknown: { label: 'Unknown', color: 'neutral', variant: 'subtle' },
  loggedIn: { label: 'Logged in', color: 'success', variant: 'subtle' },
  loggedOut: { label: 'Logged out', color: 'warning', variant: 'subtle' },
  needsHuman: { label: 'Needs human', color: 'error', variant: 'subtle' },
  disabled: { label: 'Disabled', color: 'neutral', variant: 'outline' }
}
function sessionBadge(s: SessionStatus) {
  return SESSION_BADGE[s] ?? { label: s, color: 'neutral', variant: 'subtle' }
}

// ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const deleteOpen = ref(false)
const deleteTarget = ref<TikTokAccount | null>(null)

// Login mock (human decision 2026-09-22): toast only — no request, no state change.
function onLogin() {
  toast.add({ title: 'Login is not available yet', color: 'neutral' })
}

function askDelete(account: TikTokAccount) {
  deleteTarget.value = account
  deleteOpen.value = true
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
      return h(UBadge, { color: b.color, variant: b.variant, class: 'whitespace-nowrap' }, () => b.label)
    }
  },
  {
    accessorKey: 'createdAt',
    header: 'Created',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap', title: row.original.createdAt }, createdAgo(row.original.createdAt))
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => h('div', { class: 'flex items-center justify-end gap-1 whitespace-nowrap' }, [
      h(UButton, {
        'label': 'Login',
        'icon': 'i-lucide-log-in',
        'color': 'neutral',
        'variant': 'outline',
        'size': 'xs',
        'data-testid': 'ta-login',
        'onClick': onLogin
      }),
      h(UButton, {
        'label': 'Delete',
        'icon': 'i-lucide-trash-2',
        'color': 'error',
        'variant': 'subtle',
        'size': 'xs',
        'data-testid': 'ta-delete',
        'onClick': () => askDelete(row.original)
      })
    ])
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
              {{ pending ? 'Loading accounts…' : 'No accounts match your search' }}
            </template>
          </UTable>
        </div>

        <div
          v-if="!error"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
        >
          <span data-testid="ta-count">{{ filtered.length }} accounts</span>
        </div>
      </div>

      <TiktokAccountsAddModal v-model:open="addOpen" @created="refresh()" />
      <TiktokAccountsDeleteModal
        v-model:open="deleteOpen"
        :account="deleteTarget"
        @deleted="refresh()"
      />
    </template>
  </UDashboardPanel>
</template>
