<script setup lang="ts">
/**
 * FEAT-003 — TikTok accounts (functions 3.1 create, 3.3 list, delete from 3.2; api-contract.md v1).
 * One `GET /backend/tiktok-accounts` per load / Refresh / after create / after delete via `useApi()`; search is
 * client-side (label / loginEmail / profile name / profile id — the name still matches although it is not
 * rendered, see below), rows sorted by createdAt desc, no pagination.
 * The passwords used to be columns with a per-row reveal toggle and a Copy button; they are gone since
 * 2026-10-11 (see below) and the table renders no secret at all any more. Delete confirms in a modal (BUG-029:
 * with an "Also delete the browser profile" checkbox, on by default, that sends `?deleteProfile=1` →
 * `provider/delete` job).
 * FEAT-004: Login → `POST /backend/tiktok-accounts/:id/login` (202 / 409 → `TiktokAccountsLoginModal`, other →
 * toast). BUG-028: the button is **always enabled** — every click POSTs again and the API queues a new login job
 * whatever the account state; the job decides on its own whether it is already logged in (the page guards nothing,
 * a running job only changes the tooltip). The badge maps `needsHuman` to "Needs OTP" and a
 * `lastLoginError` chip (`ta-login-error`) sits next to it while `loggedOut`. Modal close / success → one refresh,
 * and (BUG-010) the discover poll below is started for every row whose refreshed snapshot carries a running
 * `discover` job — the API auto-enqueues one after a successful login (`trigger: 'afterLogin'`), which the page
 * never started itself and therefore used to leave at "Syncing…" until a manual Refresh.
 * FEAT-005 (discover advertisers, api-contract.md v1 §5/§7): columns "BC org" (`ta-bc-org` + copy) and "Advertisers"
 * (`ta-adv-count` opens `TiktokAccountsAdvertisersSlideover`, `ta-adv-synced` / `ta-adv-syncing` / `ta-adv-error`
 * chip) after Session status; row action Sync (`ta-sync`) → `POST /backend/tiktok-accounts/:id/discover` (202 / 409 →
 * poll `GET /backend/tiktok-accounts/:id` every 2 s, one loop per account id, until `runningJob === null` → refresh +
 * toast; other errors → toast, no poll). The latest polled account is merged into its row so "Syncing…" shows live.
 * FEAT-023 (batch upload + first login, api-contract.md v1 §3/§5): navbar button "Batch upload" (`ta-batch-upload`)
 * opens `TiktokAccountsBatchModal` (parses the CSV in the browser, one `POST /backend/tiktok-accounts/batch`,
 * refresh on `imported`). The Password column became **Email password** (`ta-email-password`) + **TikTok password**
 * (`ta-password`), each with its own reveal set, and a **First login** column (`ta-first-login`) shows
 * `email_fail 2/3` / "Pending" / `—` (2026-10-16: no column and no `—` any more — see below). The flag's field
 * name is never printed as a label.
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
 * 2026-10-11 (human request) — the **Email password**, **Recovery email** and **TikTok password** columns are
 * removed from the table (no `ta-email-password` / `ta-recovery-email*` / `ta-password` cells any more); the
 * values are still part of the row data and editable through the add/edit modals. The FEAT-023/036 notes above
 * describe history.
 * 2026-10-12 (human request) — row action **Edit** (`ta-edit`, first in the Actions cell) opens
 * `TiktokAccountsEditModal` with the row; only login email, email password, recovery email and TikTok password
 * are editable (`PATCH /backend/tiktok-accounts/:id`, changed keys only). `updated` → one refresh.
 * FEAT-051 (AC-35, api-contract §7) — the account's saved cards (`TiktokAccountsCardsModal`: set-default and
 * delete) are opened by `ta-cards-open`, **GOD / Payment only** — every payment-card route answers 403 for an
 * Admin (AS-4), so the BO does not even offer it. That used to be its own column **บัตร** (`ta-cards`); since
 * 2026-10-16 it is an item of the row's "⋯" menu (see below) and the `ta-cards` cell no longer exists. The Top
 * up cell passes the account's `balanceCurrency` and name down to `TopupsRowActions`, which is what decides
 * whether the card channel of the pay popover is offered or disabled with a reason (AC-32).
 * FEAT-053 (AC-19/AC-20, api-contract §2/§3) — the account's auto top-up channel: which channel the system uses
 * when it opens an auto top-up round for this account. It was a column **ช่องทาง auto** (`ta-auto-channel`) with
 * the two-value switch `ta-auto-channel-qr` / `ta-auto-channel-card`; since 2026-10-16 the column is gone, the
 * table only *shows* the value (read-only chip `ta-auto-channel` in the Balance cell) and the switch lives in the
 * Edit modal (`ta-edit-auto-channel*`). What the API sees is unchanged: the key still travels in a
 * `PATCH /tiktok-accounts/:id` (now inside the modal's one diff PATCH, AC-19), 400 (no usable card) / 403 (role) /
 * 503 (no card key) still leave the old value in place and still show the API's own text. Like the cards the
 * chip exists for **GOD / Payment only** — for an Admin nothing is rendered and the page issues no request for
 * it (the key is 403 for them, AC-20).
 * 2026-10-16 (human request) — **declutter**: the table went from 13 to 10 columns. Three columns that rendered
 * the same controls on every row are gone and their content moved:
 *   · **ช่องทาง auto** (2 buttons per row) → a read-only `UBadge` `ta-auto-channel` (`data-channel`) appended to
 *     the `ta-autotopup-last` line of the **Balance** cell, GOD/Payment only; changing the channel is now a
 *     field of the Edit modal and is saved by that modal's single diff PATCH (atomic, no separate request), so
 *     `setAutoChannel()` / `autoChannelBusy` and `ta-auto-channel-qr` / `ta-auto-channel-card` are gone here.
 *   · **บัตร** (1 button per row) and **Delete** → items of a new "⋯" `UDropdownMenu` (`ta-more`) at the end of
 *     the **Actions** cell: `ta-cards-open` (GOD/Payment only) and `ta-delete`. A Nuxt UI menu item object is
 *     not bound to the DOM, so both ids are stamped onto the rendered item element from the `item-label` slot
 *     (`stampMenuItem`), and the menu itself is teleported out of the `<tr>`.
 *   · **First login** (`—` on almost every row) → appended to the **Session status** cell, same badges, same
 *     `ta-first-login` / `data-pending` / `data-fail` attributes and the same tooltips — but the column's `—`
 *     placeholder is **dropped**: a row with neither a fail nor a pending flag renders no element at all, so
 *     `ta-first-login` simply does not exist in that row's cell (it was pure noise next to the status badge).
 * 2026-10-16 (human request) — **Login email** and **Browser profile** merged into one column **Account**
 * (`id: 'account'`), in the Login email's old place right after Label, so the table is down to 9 columns. The
 * cell (`ta-account`) is two lines: the login email on top (`ta-account-email`, `text-highlighted` — the
 * foreground colour, not the muted one a `<td>` inherits, so the address reads as the row's identity; it stays
 * unbolded, Label is the only bold column) and the AdsPower **provider profile id** below (`ta-account-profile-id`, `font-mono
 * text-xs text-muted`, `title` = the full id, and `data-profile-id` = the id or `''` so a spec can read it
 * without parsing text). The browser-profile **name** (`faro-01`) is not displayed anywhere any more — the
 * Label column already carries the human-readable name — but the client-side search still matches it, so a row
 * can match for a reason that is not visible in the result. The id line is `—` in both null cases:
 * `browserProfile === null` (orphan account, bound to nothing) and `providerProfileId === null` (FEAT-024: the
 * profile row is only reserved while the create job runs, or the create failed); `data-profile-id` is `''` for
 * both. No copy button — this pass removes per-row buttons, it does not add them. Specs used to address these
 * two cells by column index; they address `ta-account*` now.
 * `ta-edit`, `ta-sync`, `ta-login`, `ta-balance*`, `ta-topup*`, `ta-adv-*` and `ta-bc-org*` are untouched.
 * FEAT-059 (api-contract.md v1 §5/§7/§8, spec "UI behaviour", AC-13..17) — one login may be admin of several
 * Business Center orgs. An account with `organizationCount > 1` gets a chevron **inside** the existing BC org
 * cell (`ta-org-expand`; a new column would move every `ta-*` cell index the specs rely on) and the cell text
 * becomes `<bcOrgName> · N orgs`; expanding renders `TiktokAccountsOrganizationRows` in `UTable`'s `#expanded`
 * row with one `<tr data-testid="ta-org-row">` per org. `GET /tiktok-accounts/:id/organizations` runs **once
 * per account per page lifetime** (`orgsById` is the memo), and again when a discover job of that account ends
 * (the existing poll's `onDone`) or when Refresh is pressed while the row is open — collapse/expand alone never
 * re-requests. The per-org Sync posts `{ bcOrgId }` to the **same** discover endpoint; the account-level Sync
 * still sends no body at all. An account with 0 or 1 org renders exactly as before the feature.
 * TASK-bc-sub-create round 2 (brief `.ai/features/_queue/bc-sub-create-ui.prompt.md`) — row action
 * **สร้าง Sub BC** (`ta-sub-create-<accountId>`, icon-only, right after Sync): one `GET …/bc-sub-create/suggest`
 * per click → `TiktokAccountsSubCreateModal` (`ta-sub-create-modal`) with the prefilled name and the currency →
 * `POST …/bc-sub-create` 202 `{ jobId }`. The job is then followed by its **own** 2 s loop on
 * `GET …/bc-sub-create/latest` (`startSubCreatePoll`, keyed by account id): `startPoll` above cannot be reused
 * as it is — it polls `GET /tiktok-accounts/:id` and hands a `TikTokAccount` to `done`/`onDone`, while this one
 * reads another URL and another shape — so it is the same pattern (one loop per account, no overlapping
 * request, cleared in `onUnmounted`) written for `BcSubCreateJobView`. While it runs the BC org cell shows
 * `ta-sub-create-pending-<id>`; `completed` toasts and calls `refreshAndFollowDiscovers()` (the API chains a
 * discover job, whose existing poll re-reads the org drill-down memo when it ends), `failed`/`cancelled` toasts
 * and leaves `ta-sub-create-failed-<id>` (tooltip = the job's `lastLog`) until the next attempt. The BC org cell
 * renders **exactly** its FEAT-059 DOM whenever there is no chip to show.
 */
import type { VNode } from 'vue'
import type { Row } from '@tanstack/table-core'
import type { DropdownMenuItem, TableColumn } from '@nuxt/ui'
import { formatTimeAgo } from '@vueuse/core'
import type { UseTimeAgoMessages } from '@vueuse/core'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { DiscoverJobResponse } from '#shared/types/advertisers'
import type {
  AccountsResponse,
  BcOrganization,
  BcSubCreateJobResponse,
  BcSubCreateLatestResponse,
  BcSubCreateSuggest,
  DiscoverOrgBody,
  JobType,
  LoginConflictBody,
  LoginJobResponse,
  OrganizationsResponse,
  OrganizationsState,
  PatchOrganizationBody,
  SessionStatus,
  TikTokAccount
} from '#shared/types/tiktok-accounts'
import type { AccountBalanceResponse, TopupView } from '#shared/types/topups'
import type { TopupViewer } from '~/utils/topup'

useSeoMeta({ title: 'TikTok accounts' })

const UButton = resolveComponent('UButton')
const UBadge = resolveComponent('UBadge')
const UTooltip = resolveComponent('UTooltip')
const UIcon = resolveComponent('UIcon')
const UDropdownMenu = resolveComponent('UDropdownMenu')
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
  // 2026-10-16: the browser-profile **name** is no longer rendered anywhere in the table, but it is still
  // searchable on purpose (people know their profiles as `faro-01`). A row can therefore match for a reason the
  // eye cannot see in the result — intended, do not "fix" by dropping the name here.
  return accounts.value.filter(a =>
    (a.label ?? '').toLowerCase().includes(needle)
    || a.loginEmail.toLowerCase().includes(needle)
    || (a.browserProfile?.name ?? '').toLowerCase().includes(needle)
    || (a.browserProfile?.providerProfileId ?? '').toLowerCase().includes(needle)
  )
})

// (2026-10-11) the per-row password / recovery-email reveal sets went away with their columns — the secrets are
// no longer rendered in the table at all.
// a fresh dataset (refresh / after create / after delete / after an import) drops the per-row poll snapshots
watch(data, () => {
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

/**
 * FEAT-023 "Auto first login" — `email_fail 2/3` or "Pending". The flag's field name is never printed as a
 * label. 2026-10-16: this used to be the **First login** column; it is rendered inside the Session status cell
 * now (byte-identical badges, so `ta-first-login` + `data-pending` + `data-fail` keep working row-scoped).
 * A row with nothing to say renders **nothing at all** — the column's `—` placeholder made sense in a column of
 * its own, next to the session badge it is exactly the noise this task removes, so `ta-first-login` does not
 * exist in the cell of a clean row.
 */
function firstLoginNode(a: TikTokAccount): VNode | null {
  const fail = a.firstLoginFail
  if (fail) {
    // spec.md "UI behaviour": the badge reads `email_fail 2/3`; the tooltip explains the code
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
  return null
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
// 2026-10-12 — Edit modal (login email / email password / recovery email / TikTok password only)
const editOpen = ref(false)
const editTarget = ref<TikTokAccount | null>(null)

function askEdit(account: TikTokAccount) {
  editTarget.value = account
  editOpen.value = true
}

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

/** a "⋯" menu item plus the `data-testid` QA clicks (item objects are not bound to the DOM) */
type RowAction = DropdownMenuItem & { label: string, testid: string }

/**
 * 2026-10-16 — the row's overflow menu: **บัตรที่จำไว้** (FEAT-051, GOD/Payment only — every payment-card route
 * answers 403 for an Admin, so the item is not even offered) and **Delete**. Both used to be a button per row.
 */
function moreActions(account: TikTokAccount): RowAction[] {
  const items: RowAction[] = []
  if (canPay.value) {
    items.push({
      label: 'บัตรที่จำไว้',
      icon: 'i-lucide-credit-card',
      testid: 'ta-cards-open',
      onSelect: () => openCards(account)
    })
  }
  items.push({
    label: 'Delete',
    icon: 'i-lucide-trash-2',
    color: 'error',
    testid: 'ta-delete',
    onSelect: () => askDelete(account)
  })
  return items
}

/**
 * Nuxt UI 4 forwards only `class` / `ui` from an item object to the DOM, so a `data-testid` written on the item
 * would land nowhere. The `item-label` slot stamps it onto the rendered menu item element itself
 * (`[data-slot="item"]`, the element that owns the click and the disabled state) — and onto the label span if
 * that ancestor ever disappears, so the id can never vanish from the DOM.
 */
function stampMenuItem(testid: string) {
  return (vnode: VNode) => {
    const el = vnode.el as HTMLElement | null
    const target = el?.closest('[data-slot="item"]') ?? el
    target?.setAttribute('data-testid', testid)
  }
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
    // FEAT-059 — the job wrote `advertiserCount` / `lastDiscoverAt` / `lastDiscoverError` per org: re-read the
    // drill-down of this account (only when it was opened at least once, i.e. it has a cache entry)
    if (orgsById.value[id]) void loadOrgs(id)
    if (next.lastDiscoverError) {
      toast.add({ title: 'Advertiser sync failed', description: `${label}: ${discoverErrorText(next.lastDiscoverError)}`, color: 'error' })
    } else {
      toast.add({ title: `Advertisers synced (${next.advertiserCount})`, description: label, color: 'success' })
    }
  })
}

/**
 * BUG-010 — `startDiscoverPoll` used to be reachable from `onSync()` only, so a discover the page did **not**
 * start itself (the API auto-enqueues one on a login success, `trigger: 'afterLogin'`) was never followed: the
 * login modal's single `refresh()` usually lands while that discover still runs, and the row stayed frozen at
 * "Syncing…" with advertiser count 0, no BC org and Sync disabled until a human pressed Refresh.
 * The login modal's `success` / `close` now refresh **and then** follow every row whose fresh snapshot carries a
 * running discover job, so the row converges on its own. Nothing about the poll itself changes: `startPoll` is
 * keyed `discover:<id>` and returns early when that loop already runs (no duplicate poll, e.g. when the user
 * pressed Sync first), each tick is the existing single `GET /tiktok-accounts/:id`, the finished poll does the
 * one `refresh()` + toast it always did, and `onUnmounted` still clears it.
 */
async function refreshAndFollowDiscovers() {
  await refresh()
  for (const account of data.value?.accounts ?? []) {
    if (account.runningJob?.type === 'discover') startDiscoverPoll(account.id)
  }
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

/**
 * What the row says while a job of that account runs. `runningJob.type` is the API's raw `JobType` (every
 * type can appear since the BO itself starts a `bcSubCreate`), so the three the row has an opinion about are
 * named — `login` / `discover` with exactly the wording they always had — and everything else (build, kpi,
 * top-up, provider, budget, …) gets one honest generic sentence instead of being called a login.
 */
const RUNNING_JOB_REASON: Partial<Record<JobType, string>> = {
  discover: 'Sync in progress',
  login: 'Login in progress',
  bcSubCreate: 'กำลังสร้าง Sub BC'
}
function runningJobReason(type: JobType): string {
  return RUNNING_JOB_REASON[type] ?? 'Job in progress'
}

function syncBlockedReason(account: TikTokAccount): string | null {
  if (account.runningJob) return runningJobReason(account.runningJob.type)
  if (account.sessionStatus === 'needsHuman') return 'Needs OTP — finish the login first'
  if (!account.isActive) return 'Account is disabled'
  return null
}

/**
 * FEAT-059 — `bcOrgId` null (the account action and the slideover's empty state) posts **no body at all**, byte
 * for byte the FEAT-005 request; an org row posts `{ bcOrgId }` (contract §5/§8, AC-14). Everything after the
 * POST — toasts, 409 handling, the poll — is shared on purpose: one job per login whatever its scope.
 */
async function onSync(account: TikTokAccount, bcOrgId: string | null = null) {
  if (syncStarting.value || orgSyncStarting.value || syncBlockedReason(account)) return
  const label = account.label ?? account.loginEmail
  if (bcOrgId) orgSyncStarting.value = bcOrgId
  else syncStarting.value = account.id
  try {
    // retry: 0 — exactly one POST per click (ofetch would otherwise re-issue it on 5xx)
    await api<DiscoverJobResponse>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/discover`,
      bcOrgId
        ? { method: 'POST', retry: 0, body: { bcOrgId } satisfies DiscoverOrgBody }
        : { method: 'POST', retry: 0 }
    )
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
    orgSyncStarting.value = null
  }
}

// ── FEAT-059 · Business Center org drill-down ────────────────────────────────────────────────────────────────────────
/**
 * `expandedOrgs` is `UTable`'s own `expanded` model (keyed by account id thanks to `get-row-id`), so the
 * expansion `<tr>` is rendered by the table itself instead of a second table next to it; `orgsById` is both the
 * cache and the memo — a key exists ⇒ the account was opened at least once ⇒ a finished discover re-reads it.
 */
const expandedOrgs = ref<Record<string, boolean>>({})
const orgsById = ref<Record<string, OrganizationsState>>({})
/** API error text of the last parent PATCH, keyed by `orgId` (shown inline in `ta-org-parent-error`) */
const orgParentErrors = ref<Record<string, string>>({})
const orgParentBusy = ref<string | null>(null)
/** `orgId` whose per-org `POST …/discover` is in flight */
const orgSyncStarting = ref<string | null>(null)

const expandedOrgIds = computed(() => Object.keys(expandedOrgs.value).filter(id => expandedOrgs.value[id]))

function setOrgsState(id: string, state: OrganizationsState) {
  orgsById.value = { ...orgsById.value, [id]: state }
}

/** one `GET …/organizations` per call; the previous rows stay visible while it is in flight */
async function loadOrgs(id: string) {
  setOrgsState(id, { pending: true, error: null, data: orgsById.value[id]?.data ?? null })
  try {
    // retry: 0 — one request, ofetch must not re-issue it on 5xx (the error row offers Retry)
    const res = await api<OrganizationsResponse>(`/tiktok-accounts/${encodeURIComponent(id)}/organizations`, { retry: 0 })
    setOrgsState(id, { pending: false, error: null, data: res.organizations })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    setOrgsState(id, { pending: false, error: err.data?.error ?? err.message ?? 'Unexpected error', data: null })
  }
}

/** open/close one account; the request happens **once per account** — `orgsById` is the memo */
function toggleOrgs(id: string) {
  const open = !expandedOrgs.value[id]
  expandedOrgs.value = { ...expandedOrgs.value, [id]: open }
  if (open && !orgsById.value[id]) void loadOrgs(id)
}

/** Refresh re-reads the orgs of every row that is open right now (AC-13) */
function reloadOpenOrgs() {
  for (const id of expandedOrgIds.value) void loadOrgs(id)
}

async function onRefresh() {
  await refresh()
  reloadOpenOrgs()
}

/**
 * The human picks the parent of an org the rule could not decide: one PATCH, then the orgs of that account are
 * re-read (the badge becomes **sub** and the select disappears). 404/409 keep the row as it is and print the
 * API's own text inline.
 */
async function onSetOrgParent(accountId: string, payload: { org: BcOrganization, parentOrgId: string | null }) {
  if (orgParentBusy.value) return
  const { org, parentOrgId } = payload
  orgParentBusy.value = org.orgId
  // drop the previous inline error of this org (a new attempt starts clean)
  orgParentErrors.value = Object.fromEntries(
    Object.entries(orgParentErrors.value).filter(([orgId]) => orgId !== org.orgId)
  )
  try {
    // retry: 0 — exactly one PATCH per choice
    await api<BcOrganization>(
      `/tiktok-accounts/${encodeURIComponent(accountId)}/organizations/${encodeURIComponent(org.orgId)}`,
      { method: 'PATCH', retry: 0, body: { parentOrgId } satisfies PatchOrganizationBody }
    )
    await loadOrgs(accountId)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    orgParentErrors.value = {
      ...orgParentErrors.value,
      [org.orgId]: err.data?.error ?? err.message ?? 'Unexpected error'
    }
  } finally {
    orgParentBusy.value = null
  }
}

// ── TASK-bc-sub-create — create a sub Business Center ────────────────────────────────────────────────────────────────
const subCreateOpen = ref(false)
const subCreateTarget = ref<TikTokAccount | null>(null)
/** answer of the one `GET …/bc-sub-create/suggest` made for the open modal (the modal itself requests nothing) */
const subCreateSuggest = ref<BcSubCreateSuggest | null>(null)
/** account id whose suggest request is in flight (button spinner + no double click) */
const subCreateAsking = ref<string | null>(null)
/** account ids whose `bcSubCreate` job is being followed → chip `ta-sub-create-pending-<id>` */
const subCreatePending = ref(new Set<string>())
/** account id → text of the last failed attempt → chip `ta-sub-create-failed-<id>`; dropped on the next attempt */
const subCreateFailed = ref(new Map<string, string>())

function setSubCreatePending(id: string, on: boolean) {
  const next = new Set(subCreatePending.value)
  if (on) next.add(id)
  else next.delete(id)
  subCreatePending.value = next
}

function setSubCreateFailed(id: string, text: string | null) {
  const next = new Map(subCreateFailed.value)
  if (text) next.set(id, text)
  else next.delete(id)
  subCreateFailed.value = next
}

/**
 * Why the row action is disabled (the tooltip text), `null` = enabled. The brief's rule is "a `bcOrgId` and no
 * running job"; `isActive` is checked too because the API answers 409 `inactive` for a disabled account, and
 * the running job is named by `runningJobReason()` (the sub-create job of another tab says so, anything else
 * gets the generic sentence instead of the wrong one).
 */
function subCreateBlockedReason(account: TikTokAccount): string | null {
  if (subCreatePending.value.has(account.id)) return 'กำลังสร้าง Sub BC อยู่'
  if (!account.bcOrgId) return 'Sync first'
  if (account.runningJob) return runningJobReason(account.runningJob.type)
  if (!account.isActive) return 'Account is disabled'
  return null
}

/** click → one suggest request → the modal opens on 200 only (any error is a toast and no modal) */
async function onAskSubCreate(account: TikTokAccount) {
  if (subCreateAsking.value || subCreateBlockedReason(account)) return
  subCreateAsking.value = account.id
  try {
    // retry: 0 — one GET per click, ofetch must not re-issue it on 5xx
    const suggest = await api<BcSubCreateSuggest>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/bc-sub-create/suggest`,
      { retry: 0 }
    )
    subCreateTarget.value = account
    subCreateSuggest.value = suggest
    subCreateOpen.value = true
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: 'เปิดฟอร์มสร้าง Sub BC ไม่ได้',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
  } finally {
    subCreateAsking.value = null
  }
}

/**
 * Same pattern as `startPoll` (one loop per account id, 2 s, never two requests in flight, cleared on unmount)
 * on `GET …/bc-sub-create/latest` — see the file header for why it is not the same function.
 */
const subCreatePolls = new Map<string, ReturnType<typeof setInterval>>()
const subCreateInFlight = new Set<string>()

function stopSubCreatePoll(id: string) {
  const timer = subCreatePolls.get(id)
  if (timer) clearInterval(timer)
  subCreatePolls.delete(id)
  subCreateInFlight.delete(id)
}

async function pollSubCreate(id: string, jobId: string, label: string) {
  if (!subCreatePolls.has(id) || subCreateInFlight.has(id)) return
  subCreateInFlight.add(id)
  try {
    // retry: 0 — one request per tick
    const res = await api<BcSubCreateLatestResponse>(
      `/tiktok-accounts/${encodeURIComponent(id)}/bc-sub-create/latest`,
      { retry: 0 }
    )
    if (!subCreatePolls.has(id)) return // stopped meanwhile (unmount / terminal in another tick)
    const job = res.job
    if (!job) return // nothing to follow yet — the next tick looks again
    if (job.id !== jobId) {
      // a newer job of this account is the latest one: that attempt owns the row now
      stopSubCreatePoll(id)
      setSubCreatePending(id, false)
      return
    }
    if (job.status === 'waiting' || job.status === 'active') return
    stopSubCreatePoll(id)
    setSubCreatePending(id, false)
    if (job.status === 'completed') {
      const orgId = job.result?.orgId ?? null
      toast.add({
        title: `สร้าง ${job.name} แล้ว${orgId ? ` (org …${orgId.slice(-4)})` : ''} — กำลัง Sync`,
        description: label,
        color: 'success'
      })
      // the API chained a discover job for the whole login: refresh and let the existing discover poll follow
      // it (its `onDone` re-reads the org drill-down memo, so the new sub appears there on its own)
      await refreshAndFollowDiscovers()
      if (orgsById.value[id]) void loadOrgs(id)
    } else {
      const detail = [job.error, job.lastLog].filter(Boolean).join(' — ') || 'ไม่ทราบสาเหตุ'
      setSubCreateFailed(id, detail)
      toast.add({ title: 'สร้าง Sub BC ไม่สำเร็จ', description: `${label}: ${detail}`, color: 'error' })
      await refresh()
    }
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    // the account (or the route) is gone → nothing left to follow; any other error is transient
    if (err.statusCode === 404) {
      stopSubCreatePoll(id)
      setSubCreatePending(id, false)
    }
  } finally {
    subCreateInFlight.delete(id)
  }
}

function startSubCreatePoll(account: TikTokAccount, job: BcSubCreateJobResponse) {
  const id = account.id
  setSubCreateFailed(id, null) // a new attempt starts clean
  setSubCreatePending(id, true)
  if (subCreatePolls.has(id)) return
  const label = account.label ?? account.loginEmail
  subCreatePolls.set(id, setInterval(() => {
    void pollSubCreate(id, job.jobId, label)
  }, POLL_MS))
  void pollSubCreate(id, job.jobId, label)
}

/** 202 of the modal's POST: the modal closed itself, the row takes over */
function onSubCreated(job: BcSubCreateJobResponse) {
  const account = subCreateTarget.value
  if (!account) return
  toast.add({ title: 'เริ่มสร้าง Sub BC แล้ว', description: job.name, color: 'info' })
  startSubCreatePoll(account, job)
}

onUnmounted(() => {
  for (const id of [...subCreatePolls.keys()]) stopSubCreatePoll(id)
})

/** pending / failed chip of the BC org cell; `null` → that cell keeps its FEAT-059 DOM byte for byte */
function subCreateChip(a: TikTokAccount): VNode | null {
  if (subCreatePending.value.has(a.id)) {
    return h('span', {
      'class': 'flex items-center gap-1 whitespace-nowrap text-xs text-muted',
      'data-testid': `ta-sub-create-pending-${a.id}`,
      'data-id': a.id
    }, [
      h(UIcon, { name: 'i-lucide-loader-circle', class: 'size-3.5 shrink-0 animate-spin text-primary' }),
      'กำลังสร้าง Sub BC…'
    ])
  }
  const failed = subCreateFailed.value.get(a.id)
  if (!failed) return null
  return h(UTooltip, { text: failed }, () => h(UBadge, {
    'color': 'error',
    'variant': 'subtle',
    'size': 'sm',
    'icon': 'i-lucide-triangle-alert',
    'class': 'max-w-48 truncate whitespace-nowrap',
    'title': failed,
    'data-testid': `ta-sub-create-failed-${a.id}`,
    'data-id': a.id
  }, () => 'สร้าง Sub BC ไม่สำเร็จ'))
}

// ── advertisers slideover (FEAT-005) ─────────────────────────────────────────────────────────────────────────────────
// FEAT-051 — saved cards of one account (GOD/Payment only; the column is not rendered for anybody else)
const cardsOpen = ref(false)
const cardsTarget = ref<TikTokAccount | null>(null)

function openCards(account: TikTokAccount) {
  cardsTarget.value = account
  cardsOpen.value = true
}

// 2026-10-16 — FEAT-053's `setAutoChannel()` / `autoChannelBusy` left this page with the column: the channel is
// now one of the fields of the Edit modal and is written by that modal's single diff PATCH.

const advOpen = ref(false)
const advTargetId = ref<string | null>(null)
// FEAT-059 — set only when the slideover was opened from one org row (`ta-org-adv-count`)
const advOrgId = ref<string | null>(null)
const advOrgName = ref<string | null>(null)
// resolved from the live rows so the slideover sees the polled `runningJob` / `advertiserCount`
const advTarget = computed<TikTokAccount | null>(() => {
  const id = advTargetId.value
  if (!id) return null
  return polledById.value.get(id) ?? accounts.value.find(a => a.id === id) ?? null
})

/**
 * FEAT-059 — `org` null (the account-level count button) lists every org of the login exactly as before;
 * from an org row the slideover gets `bcOrgId` + the org name, which adds `bcOrgId=<orgId>` to its request and
 * ` · <org name>` to its title (AC-16).
 */
function openAdvertisers(account: TikTokAccount, org: BcOrganization | null = null) {
  advTargetId.value = account.id
  advOrgId.value = org?.orgId ?? null
  advOrgName.value = org ? (org.name || `…${org.orgId.slice(-4)}`) : null
  advOpen.value = true
}

// ── table ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The list is a computed because two cells read `canPay`: the Balance cell's auto-channel chip and the "⋯"
 * menu's cards item must not exist at all for an Admin (FEAT-053 AC-20 / FEAT-051 AC-35). Nine columns since
 * the 2026-10-16 declutter and the Login email + Browser profile merge.
 */
const columns = computed<TableColumn<TikTokAccount>[]>(() => [
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
  // 2026-10-11 (human request): the "Email password", "Recovery email" and "TikTok password" columns are no
  // longer rendered in the table — the values stay in the row data and in the edit/add modals.
  // 2026-10-16 (human request): "Login email" + "Browser profile" merged into this one two-line cell.
  {
    id: 'account',
    header: 'Account',
    cell: ({ row }) => {
      // `providerProfileId` is null in two cases, both rendered as `—` with `data-profile-id=""`: no profile at
      // all (orphan account) and FEAT-024 (the profile row is only reserved while the create job runs, or the
      // create failed). The profile *name* is deliberately not rendered — the Label column carries the
      // human-readable name.
      const pid = row.original.browserProfile?.providerProfileId ?? null
      return h('div', { 'class': 'flex min-w-0 flex-col', 'data-testid': 'ta-account' }, [
        h('span', { 'class': 'whitespace-nowrap text-highlighted', 'data-testid': 'ta-account-email' }, row.original.loginEmail),
        h('span', {
          'class': 'font-mono text-xs text-muted',
          'data-testid': 'ta-account-profile-id',
          'data-profile-id': pid ?? '',
          'title': pid ?? undefined
        }, pid ?? '—')
      ])
    }
  },
  {
    accessorKey: 'sessionStatus',
    header: 'Session status',
    cell: ({ row }) => {
      const a = row.original
      const b = sessionBadge(a.sessionStatus)
      const err = a.lastLoginError
      const children = [h(UBadge, { color: b.color, variant: b.variant, class: 'whitespace-nowrap' }, () => b.label)]
      if (a.sessionStatus === 'loggedOut' && err) {
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
      // 2026-10-16 — the former **First login** column (FEAT-023); same badges, same ids, same tooltips, next
      // to the status badge now. Nothing to say → nothing is appended (no `—`, no `ta-first-login`).
      const firstLogin = firstLoginNode(a)
      if (firstLogin) children.push(firstLogin)
      return h('div', { class: 'flex flex-wrap items-center gap-1' }, children)
    }
  },
  {
    accessorKey: 'bcOrgId',
    header: 'BC org',
    cell: ({ row }) => {
      const a = row.original
      const org = a.bcOrgId
      // FEAT-059 — the drill-down exists only for a login that really is admin of several orgs (A9); with 0 or 1
      // org this cell is byte-identical to FEAT-005/FEAT-010 (no chevron, no count, same text).
      const count = a.organizationCount
      const multi = count > 1
      const expanded = expandedOrgs.value[a.id] === true
      const chevron = multi
        ? h(UButton, {
            'icon': expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right',
            'color': 'neutral',
            'variant': 'ghost',
            'size': 'xs',
            'class': 'shrink-0',
            'aria-expanded': expanded,
            'aria-label': `Business Center orgs ของ ${a.bcOrgName ?? a.label ?? a.loginEmail}`,
            'data-testid': 'ta-org-expand',
            'data-id': a.id,
            'onClick': () => toggleOrgs(a.id)
          })
        : null
      // TASK-bc-sub-create — the create job's live state belongs to the Business Center column; no chip ⇒ the
      // cell is byte-identical to FEAT-059 (`withChip` returns the untouched node)
      const chip = subCreateChip(a)
      const withChip = (node: VNode) => chip
        ? h('div', { class: 'flex flex-col items-start gap-0.5' }, [node, chip])
        : node
      if (!org) {
        const dash = h('span', { 'class': 'text-muted', 'data-testid': 'ta-bc-org' }, '—')
        // no root org id but several org rows: keep the drill-down reachable instead of hiding the orgs
        return withChip(multi ? h('div', { class: 'flex items-center gap-0.5 whitespace-nowrap' }, [chevron, dash]) : dash)
      }
      // > 1 org: the name says which Business Center the balance belongs to, the count that there are subs
      const label = multi ? `${a.bcOrgName || shortId(org)} · ${count} orgs` : shortId(org)
      return withChip(h('div', { class: 'flex items-center gap-0.5 whitespace-nowrap' }, [
        chevron,
        h('span', {
          // a Business Center name can be long: it is truncated visually (the full text stays in the DOM for
          // QA and the `title` keeps the org id) so the column does not widen the whole table
          'class': multi ? 'inline-block max-w-48 truncate align-middle text-highlighted' : 'font-mono text-xs text-highlighted',
          'title': org,
          'data-testid': 'ta-bc-org',
          'data-org': org,
          // only on a multi-org row: a single-org cell keeps the exact DOM it had before FEAT-059
          'data-orgs': multi ? count : undefined
        }, label),
        h(UButton, {
          'icon': 'i-lucide-copy',
          'color': 'neutral',
          'variant': 'ghost',
          'size': 'xs',
          'aria-label': 'Copy BC org id',
          'data-testid': 'ta-bc-org-copy',
          'onClick': () => copyText(org, 'BC org id copied')
        })
      ]))
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
      // 2026-10-16 — the amount and the currency are two elements now: grouped digits (`6,091.06`) + a coloured
      // badge, because "6091.06 THB" in one flat string made a USD row impossible to spot while scanning. The
      // `ta-balance` span still carries the raw `data-amount` and still renders the muted dash on its own.
      const text = balanceAmountText(a.balanceAmount)
      const blocked = balanceBlockedReason(a)
      const loading = balanceLoading.value.has(a.id)
      const amountLine = h('div', { class: 'flex items-center gap-1 whitespace-nowrap' }, [
        h('span', {
          'class': text ? 'font-medium tabular-nums text-highlighted' : 'text-muted',
          'data-testid': 'ta-balance',
          'data-amount': a.balanceAmount ?? ''
        }, text || '—'),
        text && a.balanceCurrency
          ? h(UBadge, {
              'color': balanceCurrencyColor(a.balanceCurrency),
              'variant': 'subtle',
              'size': 'sm',
              'class': 'font-medium whitespace-nowrap',
              'data-testid': 'ta-balance-currency',
              'data-currency': a.balanceCurrency
            }, () => a.balanceCurrency)
          : null,
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
      // 2026-10-16 — FEAT-053's auto channel, read-only (the switch moved into the Edit modal). GOD/Payment
      // only: an Admin gets no element at all and the page still issues no request for the key (AC-20).
      if (canPay.value) {
        const channel = accountAutoTopupChannel(a)
        children.push(h(UBadge, {
          'color': 'neutral',
          'variant': 'subtle',
          'size': 'sm',
          'icon': channel === 'card' ? 'i-lucide-credit-card' : 'i-lucide-qr-code',
          'class': 'whitespace-nowrap',
          'title': 'ช่องทางที่ระบบใช้เมื่อเติมเงินอัตโนมัติ — แก้ได้ที่ปุ่ม Edit',
          'data-testid': 'ta-auto-channel',
          'data-channel': channel
        }, () => `auto: ${TOPUP_CHANNEL_LABEL[channel]}`))
      }
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
          // FEAT-051 — the account's own currency and name decide the card option and fill the confirm dialog
          balanceCurrency: a.balanceCurrency,
          accountName: a.bcOrgName || a.label || a.loginEmail,
          onCreated: patchTopup,
          onOpen: onOpenTopup,
          onRecheck: recheckTopup,
          onRelease: releaseTopup,
          onChanged: patchTopup
        }))
      }
      if (!children.length) return h('span', { 'class': 'text-muted', 'data-testid': 'ta-topup' }, '—')
      return h('div', { 'class': 'flex flex-wrap items-center gap-1', 'data-testid': 'ta-topup', 'data-status': topup?.status ?? '' }, children)
    }
  },
  // 2026-10-16 — the FEAT-051 **บัตร** column and the FEAT-053 **ช่องทาง auto** column are gone: the cards
  // button is an item of the row's "⋯" menu and the channel is the read-only chip of the Balance cell.
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
      const subCreateBlocked = subCreateBlockedReason(row.original)
      // BUG-028: never disabled — a running job only annotates the tooltip (named by `runningJobReason`, so a
      // build / top-up / sub-create job is no longer announced as a login)
      const loginHint = running ? `${runningJobReason(job.type)} — login again anyway` : null
      const wide = wideActions.value
      return h('div', { class: 'flex items-center justify-end gap-1 whitespace-nowrap' }, [
        // 2026-10-12 — Edit credentials (never disabled: the modal only writes the four credential fields)
        h(UTooltip, { text: 'Edit', disabled: wide }, () => h('span', { class: 'inline-flex' }, [
          h(UButton, {
            'label': 'Edit',
            'icon': 'i-lucide-pencil',
            'color': 'neutral',
            'variant': 'outline',
            'size': 'xs',
            'ui': ACTION_LABEL_UI,
            'aria-label': 'Edit',
            'data-testid': 'ta-edit',
            'onClick': () => askEdit(row.original)
          })
        ])),
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
        // TASK-bc-sub-create — icon-only on every viewport (a 4th label would widen the Actions column); the
        // tooltip is therefore always on and names the action or says why it is disabled
        h(UTooltip, { text: subCreateBlocked ?? 'สร้าง Sub BC' }, () => h('span', { class: 'inline-flex' }, [
          h(UButton, {
            'icon': 'i-lucide-building-2',
            'color': 'neutral',
            'variant': 'outline',
            'size': 'xs',
            'disabled': !!subCreateBlocked,
            'loading': subCreateAsking.value === row.original.id,
            'aria-label': 'สร้าง Sub BC',
            'data-testid': `ta-sub-create-${row.original.id}`,
            'data-id': row.original.id,
            'onClick': () => onAskSubCreate(row.original)
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
        // 2026-10-16 — everything that is not an everyday action lives behind "⋯" (saved cards + Delete)
        h(UDropdownMenu, {
          items: moreActions(row.original),
          content: { align: 'end' }
        }, {
          'default': () => h(UButton, {
            'icon': 'i-lucide-ellipsis-vertical',
            'color': 'neutral',
            'variant': 'outline',
            'size': 'xs',
            'aria-label': 'More actions',
            'data-testid': 'ta-more'
          }),
          // the item object itself is not bound to the DOM — stamp the id onto the rendered item element
          'item-label': ({ item }: { item: RowAction }) => h('span', {
            class: 'truncate',
            onVnodeMounted: stampMenuItem(item.testid),
            onVnodeUpdated: stampMenuItem(item.testid)
          }, item.label)
        })
      ])
    }
  }
])

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
            @click="onRefresh()"
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
            v-model:expanded="expandedOrgs"
            :data="rows"
            :columns="columns"
            :loading="pending"
            loading-animation="carousel"
            class="shrink-0"
            :get-row-id="(account: TikTokAccount) => account.id"
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

            <!-- FEAT-059 — the Business Center orgs of the opened account (one `<tr>` per org inside this cell) -->
            <template #expanded="{ row }: { row: Row<TikTokAccount> }">
              <TiktokAccountsOrganizationRows
                :account="row.original"
                :state="orgsById[row.original.id]"
                :parent-errors="orgParentErrors"
                :parent-busy="orgParentBusy"
                :sync-blocked="syncBlockedReason(row.original)"
                :sync-starting="orgSyncStarting"
                @retry="loadOrgs(row.original.id)"
                @sync="org => onSync(row.original, org.orgId)"
                @advertisers="org => openAdvertisers(row.original, org)"
                @copy="org => copyText(org.orgId, 'BC org id copied')"
                @set-parent="payload => onSetOrgParent(row.original.id, payload)"
              />
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
      <TiktokAccountsEditModal
        v-model:open="editOpen"
        :account="editTarget"
        :can-pay="canPay"
        @updated="refresh()"
      />
      <TiktokAccountsDeleteModal
        v-model:open="deleteOpen"
        :account="deleteTarget"
        @deleted="refresh()"
      />
      <TiktokAccountsLoginModal
        v-model:open="loginOpen"
        :account-id="loginTarget?.id ?? null"
        :account-label="loginTarget?.label ?? loginTarget?.loginEmail ?? null"
        @success="refreshAndFollowDiscovers()"
        @close="refreshAndFollowDiscovers()"
      />
      <TiktokAccountsAdvertisersSlideover
        v-model:open="advOpen"
        :account="advTarget"
        :bc-org-id="advOrgId"
        :org-name="advOrgName"
        @sync="onSync"
      />
      <TiktokAccountsCardsModal
        v-model:open="cardsOpen"
        :account="cardsTarget"
      />
      <TiktokAccountsSubCreateModal
        v-model:open="subCreateOpen"
        :account="subCreateTarget"
        :suggest="subCreateSuggest"
        @created="onSubCreated"
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
