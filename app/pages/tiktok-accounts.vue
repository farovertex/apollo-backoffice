<script setup lang="ts">
/**
 * FEAT-003 — TikTok accounts (functions 3.1 create, 3.3 list, delete from 3.2; api-contract.md v1).
 * One `GET /backend/tiktok-accounts` per load / Refresh / after create / after delete via `useApi()`; search is
 * client-side (label / loginEmail / profile name / profile id), rows sorted by createdAt desc, no pagination.
 * Password: the table renders the literal mask until the row toggle is on (value never in the DOM while masked);
 * Copy reads it from the row data. Delete confirms in a modal (BUG-029: with an "Also delete the browser profile"
 * checkbox, on by default, that sends `?deleteProfile=1` → `provider/delete` job).
 * FEAT-004: Login → `POST /backend/tiktok-accounts/:id/login` (202 / 409 → `TiktokAccountsLoginModal`, other →
 * toast). BUG-028: the button is **always enabled** — every click POSTs again and the API queues a new login job
 * whatever the account state; the job decides on its own whether it is already logged in (the page guards nothing,
 * a running job only changes the tooltip). The badge maps `needsHuman` to "Needs OTP" and a
 * `lastLoginError` chip (`ta-login-error`) sits next to it while `loggedOut`. Modal close / success → one refresh.
 * FEAT-005 (discover advertisers, api-contract.md v1 §5/§7): columns "BC org" (`ta-bc-org` + copy) and "Advertisers"
 * (`ta-adv-count` opens `TiktokAccountsAdvertisersSlideover`, `ta-adv-synced` / `ta-adv-syncing` / `ta-adv-error`
 * chip) after Session status; row action Sync (`ta-sync`) → `POST /backend/tiktok-accounts/:id/discover` (202 / 409 →
 * poll `GET /backend/tiktok-accounts/:id` every 2 s, one loop per account id, until `runningJob === null` → refresh +
 * toast; other errors → toast, no poll). The latest polled account is merged into its row so "Syncing…" shows live.
 * FEAT-023 (batch upload + first login, api-contract.md v1 §3/§5): navbar button "Batch upload" (`ta-batch-upload`)
 * opens `TiktokAccountsBatchModal` (parses the CSV in the browser, one `POST /backend/tiktok-accounts/batch`,
 * refresh on `imported`). The Password column became **Email password** (`ta-email-password`) + **TikTok password**
 * (`ta-password`), each with its own reveal set, and a **First login** column (`ta-first-login`) shows
 * `email_fail 2/3` / "Pending" / `—`. The flag's field name is never printed as a label.
 * Account-level (Business Center) top-up: column **Balance** (`ta-balance`, the BC's shared cash balance read from
 * `query_payment_summary`) with **Reload balance** (`ta-balance-reload` → `POST /backend/topups/accounts/:id/balance`
 * 202 `{ jobId }`, then the same 2 s account poll until that job is no longer the running one), and column **Top up**
 * (`ta-topup`: the round badge + `TopupsRowActions` with `advertiserId: null` → `POST /backend/topups/accounts`).
 * Rounds stay live through `useTopupsLive` (account-level events only) and are paid in `TopupsPayModal`.
 * FEAT-029 (api-contract.md v1 §4/§5/§7): the Advertisers cell shows the **Launching ads** badge (`ta-launching`)
 * of an account that has at least one launching advertiser, and the toolbar has the **Launching only** switch
 * (`ta-filter-launching`) — on → the list is re-read as `GET /backend/tiktok-accounts?launchingAds=1`, off →
 * without the param (one request per toggle, server-side filter per AS-12, not persisted). Search still composes
 * client-side on top, the per-account poll is untouched. An empty filtered list renders `ta-empty-launching`.
 * FEAT-034 (api-contract.md v1 §4, spec "UI behaviour" AC-17) — the Balance cell gains a second, read-only line
 * `ta-autotopup-last` (`data-at` = `account.autoTopup.lastTriggeredAt` ISO or `''`): "เติมอัตโนมัติล่าสุด <time>"
 * or "ยังไม่เคยเติมอัตโนมัติ". The auto top-up decision moved to the account (was per advertiser); `ta-balance`,
 * `ta-balance-reload` and `ta-balance-error` are unchanged.
 * FEAT-036 (api-contract.md v1 §4/§7) — column **Recovery email** (`ta-recovery-email`) right after Email
 * password: masked by default (`maskRecoveryEmail`, `app/utils/recovery-email.ts`), its own reveal set
 * (`revealedRecovery`, never shared with the password columns), toggle `ta-recovery-email-toggle` + copy
 * `ta-recovery-email-copy`, `—` when null. `lastLoginError` may now be `mailboxIdentityCheck`
 * (`login-errors.ts`), rendered by the existing `ta-login-error` chip with no code change here.
 */
import type { VNode } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { formatTimeAgo } from '@vueuse/core'
import type { UseTimeAgoMessages } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { DiscoverJobResponse } from '#shared/types/advertisers'
import type { AccountsResponse, LoginConflictBody, LoginJobResponse, SessionStatus, TikTokAccount } from '#shared/types/tiktok-accounts'
import type { AccountBalanceResponse, TopupView } from '#shared/types/topups'
import type { TopupViewer } from '~/utils/topup'
import PasswordCell from '~/components/PasswordCell.vue'

useSeoMeta({ title: 'TikTok accounts' })

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const UTooltip = resolveComponent('UTooltip')
const UIcon = resolveComponent('UIcon')
const TopupsStatusBadge = resolveComponent('TopupsStatusBadge')
const TopupsRowActions = resolveComponent('TopupsRowActions')

const POLL_MS = 2000

const api = useApi()
const toast = useToast()

// FEAT-029 — "Launching only": the filter is a server param (AS-12), so flipping the switch re-reads the list
// exactly once; it is never persisted (every load starts with every account).
const launchingOnly = ref(false)

// `server: false`: one visible XHR per load (stubbable by QA with page.route), never blocks SSR.
const { data, status, error, refresh } = useLazyAsyncData(
  'tiktok-accounts',
  // retry: 0 — one request per load, ofetch must not re-issue it on 5xx
  () => api<AccountsResponse>('/tiktok-accounts', {
    retry: 0,
    // no key at all while the switch is off — the request must stay the FEAT-003 one
    query: launchingOnly.value ? { launchingAds: 1 } : undefined
  }),
  { server: false, watch: [launchingOnly] }
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
// one set per column (FEAT-023): revealing the TikTok password must not reveal the mailbox one
const revealed = ref(new Set<string>())
const revealedEmail = ref(new Set<string>())
// FEAT-036 — own reveal set for the Recovery email column, never shared with the two password columns
const revealedRecovery = ref(new Set<string>())
function toggle(set: Ref<Set<string>>, id: string) {
  const next = new Set(set.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  set.value = next
}
// a fresh dataset (refresh / after create / after delete / after an import) starts fully masked and drops the
// per-row poll snapshots
watch(data, () => {
  revealed.value = new Set()
  revealedEmail.value = new Set()
  revealedRecovery.value = new Set()
  polledById.value = new Map()
  topupById.value = new Map()
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

// ── launching ads (FEAT-029) ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * UTable renders the `<tr>` itself and only lets a column add classes to it, so the row-level flag lives on
 * `ta-row` (the Label cell wrapper, one per row) and is mirrored onto the enclosing `<tr>` from the cell's own
 * vnode — that keeps both `[data-testid="ta-row"][data-launching]` and `tr[data-launching]` usable as selectors.
 */
function markRowLaunching(launching: boolean) {
  return (vnode: VNode) => {
    const el = vnode.el as HTMLElement | null
    el?.closest('tr')?.setAttribute('data-launching', launching ? 'true' : 'false')
  }
}

function launchingTitle(since: string | null | undefined): string {
  return since ? `since ${formatDateTime(since)}` : 'since —'
}

// ── actions ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const batchOpen = ref(false)
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
  // BUG-028: no state guard here — only one POST at a time per click
  if (loginStarting.value) return
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
// account-level rounds pushed by the top-up stream / a mutation, newer than the row's own `topup`
const topupById = shallowRef(new Map<string, TopupView>())
const rows = computed<TikTokAccount[]>(() => filtered.value.map((a) => {
  const row = polledById.value.get(a.id) ?? a
  const topup = topupById.value.get(a.id)
  return topup ? { ...row, topup } : row
}))

// account id whose POST …/discover is in flight (button spinner + no double click)
const syncStarting = ref<string | null>(null)
// one poll loop per (kind, account id) — a balance reload must not cancel a sync that is being followed;
// `done` decides on each snapshot whether the job it follows has finished
type PollKind = 'discover' | 'balance'
interface AccountPoll {
  accountId: string
  timer: ReturnType<typeof setInterval>
  done: (next: TikTokAccount) => boolean
  onDone: (next: TikTokAccount) => void
}
const polls = new Map<string, AccountPoll>()
const pollInFlight = new Set<string>()

function stopPoll(key: string) {
  const p = polls.get(key)
  if (p) clearInterval(p.timer)
  polls.delete(key)
  pollInFlight.delete(key)
}

async function pollAccount(key: string) {
  const p = polls.get(key)
  if (!p || pollInFlight.has(key)) return
  const id = p.accountId
  pollInFlight.add(key)
  try {
    // retry: 0 — one request per tick, ofetch must not re-issue it on 5xx
    const next = await api<TikTokAccount>(`/tiktok-accounts/${encodeURIComponent(id)}`, { retry: 0 })
    if (polls.get(key) !== p) return // stopped meanwhile (unmount / replaced)
    polledById.value = new Map(polledById.value).set(id, next)
    if (p.done(next)) {
      stopPoll(key)
      await refresh()
      p.onDone(next)
    }
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    // the account is gone → nothing left to follow; any other error is transient, the next tick retries
    if (err.statusCode === 404) {
      stopPoll(key)
      await refresh()
    }
  } finally {
    pollInFlight.delete(key)
  }
}

function startPoll(kind: PollKind, id: string, done: AccountPoll['done'], onDone: AccountPoll['onDone']) {
  const key = `${kind}:${id}`
  if (polls.has(key)) return
  polls.set(key, {
    accountId: id,
    timer: setInterval(() => {
      void pollAccount(key)
    }, POLL_MS),
    done,
    onDone
  })
  void pollAccount(key)
}

function startDiscoverPoll(id: string) {
  startPoll('discover', id, next => next.runningJob === null, (next) => {
    const label = next.label ?? next.loginEmail
    if (next.lastDiscoverError) {
      toast.add({ title: 'Advertiser sync failed', description: `${label}: ${discoverErrorText(next.lastDiscoverError)}`, color: 'error' })
    } else {
      toast.add({ title: `Advertisers synced (${next.advertiserCount})`, description: label, color: 'success' })
    }
  })
}

onUnmounted(() => {
  for (const id of [...polls.keys()]) stopPoll(id)
})

// ── balance + account-level top-up ───────────────────────────────────────────────────────────────────────────────────
const auth = useAuth()
const viewer = computed<TopupViewer>(() => ({
  id: auth.admin.value?.id ?? null,
  roles: auth.admin.value?.roles ?? []
}))
const canPay = computed(() => canPayTopups(viewer.value))

// account ids whose balance job is queued or running (spinner on the reload button)
const balanceLoading = ref(new Set<string>())
function setBalanceLoading(id: string, on: boolean) {
  const next = new Set(balanceLoading.value)
  if (on) next.add(id)
  else next.delete(id)
  balanceLoading.value = next
}

function balanceBlockedReason(account: TikTokAccount): string | null {
  if (!account.isActive) return 'Account is disabled'
  if (!account.bcOrgId) return 'BC unknown — run Sync first'
  return null
}

async function onReloadBalance(account: TikTokAccount) {
  if (balanceLoading.value.has(account.id) || balanceBlockedReason(account)) return
  const label = account.label ?? account.loginEmail
  setBalanceLoading(account.id, true)
  try {
    // retry: 0 — exactly one POST per click; an open balance job is reused by the API (`reused: true`)
    const res = await api<AccountBalanceResponse>(`/topups/accounts/${encodeURIComponent(account.id)}/balance`, { method: 'POST', retry: 0 })
    toast.add({ title: res.reused ? 'Balance reload already queued' : 'Reloading balance…', description: label, color: 'info' })
    const before = account.balanceAt
    // the view's `runningJob` is only the newest running job: ours is over once it was seen and is gone again
    // (a reused job may sit behind a newer one, so "not seen yet" alone means nothing until no job runs at all)
    let seen = false
    startPoll(
      'balance',
      account.id,
      (next) => {
        if (next.runningJob?.id === res.jobId) seen = true
        if (next.balanceAt !== null && next.balanceAt !== before) return true
        return next.runningJob === null || (seen && next.runningJob.id !== res.jobId)
      },
      (next) => {
        setBalanceLoading(account.id, false)
        if (next.balanceAt !== before && next.balanceAmount) {
          toast.add({ title: `Balance ${balanceText(next.balanceAmount, next.balanceCurrency)}`, description: label, color: 'success' })
        } else if (next.balanceError) {
          toast.add({ title: 'Could not read the balance', description: `${label}: ${next.balanceError}`, color: 'error' })
        }
      }
    )
  } catch (e) {
    setBalanceLoading(account.id, false)
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: 'Could not reload the balance',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
  }
}

/** an SSE `topup` event (or the answer of a mutation) replaces the account-level round of its account */
function patchTopup(topup: TopupView) {
  if (topup.level !== 'account') return
  topupById.value = new Map(topupById.value).set(topup.tiktokAccountId, topup)
  // a paid round also moved the account's balance — re-read the list once so the Balance column follows
  if (topup.status === 'paid') void refresh()
}

const { start: startLive, stop: stopLive } = useTopupsLive({ onTopup: patchTopup })
const {
  current: payingTopup,
  qrImage,
  modalOpen,
  busyId,
  staleId,
  open: claimTopup,
  cancel: cancelTopup,
  confirm: confirmTopup,
  recheck: recheckTopup,
  release: releaseTopup,
  closeModal,
  notify
} = useTopupPay(patchTopup)
const modalBusy = computed(() => !!payingTopup.value && busyId.value === payingTopup.value.id)

onMounted(startLive)
onUnmounted(stopLive)

/** "Ready to pay" / re-open my own round: claim first, the modal opens only on 200 */
async function onOpenTopup(topup: TopupView) {
  const claimed = await claimTopup(topup)
  if (claimed || !staleId.value) return
  // 409 "QR หมดอายุแล้ว" / "ไม่ได้อยู่ในสถานะพร้อมจ่าย" — what the row shows is stale
  staleId.value = null
  await refresh()
}

async function onConfirmTopup(topup: TopupView) {
  if (await confirmTopup(topup)) closeModal()
}

async function onCancelTopup(topup: TopupView) {
  if (await cancelTopup(topup)) closeModal()
}

function onLeaseExpired() {
  closeModal()
  notify('หมดเวลาจอง', 'รอบนี้ถูกคืนให้คนอื่นจ่ายต่อแล้ว')
}

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
    cell: ({ row }) => {
      const a = row.original
      const launching = a.launchingAds === true
      return h('div', {
        'class': 'flex min-w-0 flex-col',
        'data-testid': 'ta-row',
        'data-id': a.id,
        'data-launching': launching ? 'true' : 'false',
        'onVnodeMounted': markRowLaunching(launching),
        'onVnodeUpdated': markRowLaunching(launching)
      }, [
        a.label
          ? h('span', { class: 'font-medium text-highlighted' }, a.label)
          : h('span', { class: 'text-muted' }, '—')
      ])
    }
  },
  {
    accessorKey: 'loginEmail',
    header: 'Login email',
    cell: ({ row }) => h('span', { class: 'whitespace-nowrap' }, row.original.loginEmail)
  },
  {
    id: 'emailPassword',
    header: 'Email password',
    cell: ({ row }) => {
      // rows created before FEAT-023 have no mailbox password; nothing to mask or copy there
      const value = row.original.emailPassword
      if (!value) return h('span', { 'class': 'text-muted', 'data-testid': 'ta-email-password', 'data-shown': 'false' }, '—')
      return h(PasswordCell, {
        key: row.original.id,
        value,
        shown: revealedEmail.value.has(row.original.id),
        testIdPrefix: 'ta-email',
        name: 'email password',
        onToggle: () => toggle(revealedEmail, row.original.id)
      })
    }
  },
  {
    id: 'recoveryEmail',
    header: 'Recovery email',
    cell: ({ row }) => {
      // FEAT-036 — the temp-mail address Microsoft's identity/confirm page sends its code to; null on rows
      // created before the feature and on every row the human has not set it on yet
      const value = row.original.recoveryEmail
      if (!value) return h('span', { 'class': 'text-muted', 'data-testid': 'ta-recovery-email', 'data-shown': 'false' }, '—')
      const shown = revealedRecovery.value.has(row.original.id)
      return h('div', { class: 'flex items-center gap-1 whitespace-nowrap' }, [
        h('span', {
          'class': ['font-mono text-sm', shown ? 'text-highlighted' : 'text-muted'],
          'data-testid': 'ta-recovery-email',
          'data-shown': shown ? 'true' : 'false'
        }, shown ? value : maskRecoveryEmail(value)),
        h(UButton, {
          'icon': shown ? 'i-lucide-eye-off' : 'i-lucide-eye',
          'color': 'neutral',
          'variant': 'ghost',
          'size': 'xs',
          'aria-label': shown ? 'Hide recovery email' : 'Show recovery email',
          'aria-pressed': shown,
          'data-testid': 'ta-recovery-email-toggle',
          'onClick': () => toggle(revealedRecovery, row.original.id)
        }),
        h(UButton, {
          'icon': 'i-lucide-copy',
          'color': 'neutral',
          'variant': 'ghost',
          'size': 'xs',
          'aria-label': 'Copy recovery email',
          'data-testid': 'ta-recovery-email-copy',
          'onClick': () => copyText(value, 'Recovery email copied')
        })
      ])
    }
  },
  {
    id: 'password',
    header: 'TikTok password',
    cell: ({ row }) => h(PasswordCell, {
      key: row.original.id,
      value: row.original.password,
      shown: revealed.value.has(row.original.id),
      name: 'TikTok password',
      onToggle: () => toggle(revealed, row.original.id)
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
        // FEAT-024: null while the profile row is only reserved (create job running) or the create failed
        h('span', { class: 'font-mono text-xs text-muted' }, p.providerProfileId ?? '—')
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
    id: 'firstLogin',
    // FEAT-023: the UI name of `pendingFirstLogin` is "Auto first login" / this column — never the field name
    header: 'First login',
    cell: ({ row }) => {
      const a = row.original
      const fail = a.firstLoginFail
      if (fail) {
        // spec.md "UI behaviour": the cell reads `email_fail 2/3`; the tooltip explains the code
        const count = firstLoginTryCount(fail, a.firstLoginTries)
        const text = firstLoginFailText(fail)
        return h(UTooltip, { text }, () => h(UBadge, {
          'color': 'error',
          'variant': 'subtle',
          'size': 'sm',
          'icon': 'i-lucide-triangle-alert',
          'class': 'whitespace-nowrap font-mono',
          'title': text,
          'data-testid': 'ta-first-login',
          'data-pending': a.pendingFirstLogin ? 'true' : 'false',
          'data-fail': fail
        }, () => count ? `${fail} ${count}` : fail))
      }
      if (a.pendingFirstLogin) {
        return h(UTooltip, { text: AUTO_FIRST_LOGIN_HELP }, () => h(UBadge, {
          'color': 'info',
          'variant': 'subtle',
          'size': 'sm',
          'icon': 'i-lucide-clock',
          'class': 'whitespace-nowrap',
          'title': AUTO_FIRST_LOGIN_HELP,
          'data-testid': 'ta-first-login',
          'data-pending': 'true'
        }, () => 'Pending'))
      }
      return h('span', { 'class': 'text-muted', 'data-testid': 'ta-first-login', 'data-pending': 'false' }, '—')
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
      // FEAT-029 — at least one advertiser of this account is launching ads right now
      if (a.launchingAds) {
        children.push(h(UBadge, {
          'color': 'success',
          'variant': 'subtle',
          'size': 'sm',
          'icon': 'i-lucide-rocket',
          'class': 'whitespace-nowrap',
          'title': launchingTitle(a.launchingSince),
          'data-testid': 'ta-launching',
          'data-since': a.launchingSince ?? ''
        }, () => 'Launching ads'))
      }
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
    id: 'balance',
    header: 'Balance',
    cell: ({ row }) => {
      const a = row.original
      const text = balanceText(a.balanceAmount, a.balanceCurrency)
      const blocked = balanceBlockedReason(a)
      const loading = balanceLoading.value.has(a.id)
      const amountLine = h('div', { class: 'flex items-center gap-0.5 whitespace-nowrap' }, [
        h('span', {
          'class': text ? 'font-medium tabular-nums text-highlighted' : 'text-muted',
          'data-testid': 'ta-balance',
          'data-amount': a.balanceAmount ?? ''
        }, text || '—'),
        canPay.value
          ? h(UTooltip, { text: blocked ?? 'Reload balance' }, () => h('span', { class: 'inline-flex' }, [
              h(UButton, {
                'icon': 'i-lucide-rotate-cw',
                'color': 'neutral',
                'variant': 'ghost',
                'size': 'xs',
                'disabled': !!blocked,
                'loading': loading,
                'aria-label': 'Reload balance',
                'data-testid': 'ta-balance-reload',
                'onClick': () => onReloadBalance(a)
              })
            ]))
          : null
      ])
      const children = [amountLine]
      if (loading) {
        children.push(h('span', { class: 'text-xs text-muted' }, 'Reading…'))
      } else if (a.balanceAt) {
        children.push(h('span', { class: 'whitespace-nowrap text-xs text-muted', title: a.balanceAt }, shortAgo(a.balanceAt)))
      }
      if (a.balanceError && !loading) {
        const err = a.balanceError
        children.push(h(UTooltip, { text: err }, () => h(UBadge, {
          'color': 'error',
          'variant': 'subtle',
          'size': 'sm',
          'icon': 'i-lucide-triangle-alert',
          'class': 'max-w-40 truncate whitespace-nowrap',
          'title': err,
          'data-testid': 'ta-balance-error'
        }, () => err)))
      }
      // FEAT-034 — read-only: when the system last opened an auto top-up round for this account
      const autoAt = a.autoTopup?.lastTriggeredAt ?? null
      children.push(h('span', {
        'class': 'whitespace-nowrap text-xs text-muted',
        'data-testid': 'ta-autotopup-last',
        'data-at': autoAt ?? ''
      }, autoAt ? `เติมอัตโนมัติล่าสุด ${formatDateTime(autoAt)}` : 'ยังไม่เคยเติมอัตโนมัติ'))
      return h('div', { class: 'flex flex-col items-start gap-0.5' }, children)
    }
  },
  {
    id: 'topup',
    header: 'Top up',
    cell: ({ row }) => {
      const a = row.original
      const topup = a.topup ?? null
      const children = []
      if (topup) children.push(h(TopupsStatusBadge, { topup, testid: 'ta-topup-badge' }))
      // no BC yet → the API answers 400 "กด Sync ก่อน"; say it on the row instead of offering the button
      if (!a.bcOrgId) {
        if (canPay.value && !topup) children.push(h('span', { class: 'whitespace-nowrap text-xs text-muted' }, 'Sync first'))
      } else if (a.isActive) {
        children.push(h(TopupsRowActions, {
          topup,
          tiktokAccountId: a.id,
          advertiserId: null,
          viewer: viewer.value,
          prefix: 'ta-topup',
          busy: !!topup && busyId.value === topup.id,
          onCreated: patchTopup,
          onOpen: onOpenTopup,
          onRecheck: recheckTopup,
          onRelease: releaseTopup
        }))
      }
      if (!children.length) return h('span', { 'class': 'text-muted', 'data-testid': 'ta-topup' }, '—')
      return h('div', { 'class': 'flex flex-wrap items-center gap-1', 'data-testid': 'ta-topup', 'data-status': topup?.status ?? '' }, children)
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
      // BUG-028: never disabled — a running job only annotates the tooltip
      const loginHint = running ? (job.type === 'discover' ? 'Sync in progress — login again anyway' : 'Login in progress — login again anyway') : null
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
        h(UTooltip, { text: loginHint ?? 'Login', disabled: wide && !loginHint }, () => h('span', { class: 'inline-flex' }, [
          h(UButton, {
            'label': 'Login',
            'icon': 'i-lucide-log-in',
            'color': 'neutral',
            'variant': 'outline',
            'size': 'xs',
            'ui': ACTION_LABEL_UI,
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
// FEAT-029 — empty **because of** the filter: its own state so "No TikTok accounts yet" keeps its meaning
const isLaunchingEmpty = computed(() => isEmpty.value && launchingOnly.value)
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
            label="Batch upload"
            aria-label="Batch upload"
            icon="i-lucide-file-up"
            color="neutral"
            variant="outline"
            :ui="{ label: 'hidden lg:inline' }"
            data-testid="ta-batch-upload"
            @click="batchOpen = true"
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
      <div
        data-testid="ta-page"
        :data-status="status"
        :data-launching-only="launchingOnly ? 'true' : 'false'"
        class="flex flex-1 flex-col gap-4"
      >
        <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <UInput
            v-model="search"
            class="w-full sm:max-w-sm"
            icon="i-lucide-search"
            placeholder="Search label, email, profile name or id"
            :disabled="pending"
            data-testid="ta-search"
          />
          <!-- FEAT-029 — server-side filter: one GET per toggle, never persisted -->
          <USwitch
            v-model="launchingOnly"
            label="Launching only"
            data-testid="ta-filter-launching"
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

        <!-- FEAT-029 — the filter is on and no account is launching ads; the button turns the switch off -->
        <UEmpty
          v-else-if="isLaunchingEmpty"
          icon="i-lucide-rocket"
          title="No account is launching ads"
          description="Only accounts with at least one launching advertiser are listed while the filter is on."
          data-testid="ta-empty-launching"
        >
          <template #actions>
            <UButton
              label="Show all"
              icon="i-lucide-list"
              color="primary"
              data-testid="ta-filter-launching-off"
              @click="launchingOnly = false"
            />
          </template>
        </UEmpty>

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
            <UButton
              label="Batch upload"
              icon="i-lucide-file-up"
              color="neutral"
              variant="outline"
              data-testid="ta-empty-batch"
              @click="batchOpen = true"
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
      <TiktokAccountsBatchModal v-model:open="batchOpen" @imported="refresh()" />
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
      <TopupsPayModal
        v-model:open="modalOpen"
        :topup="payingTopup"
        :qr-image="qrImage"
        :busy="modalBusy"
        @confirm="onConfirmTopup"
        @cancel="onCancelTopup"
        @expired="onLeaseExpired"
      />
    </template>
  </UDashboardPanel>
</template>
