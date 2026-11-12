<script setup lang="ts">
/**
 * FEAT-100 — mssg Pages (`/mssg-pages`, test-id prefix `mp-`; spec "UI behaviour", api-contract.md v1).
 *
 * GOD and Admin link mssg.me accounts (email + password → a dedicated browser profile + an async login job), see
 * plan / quota / sites per account, re-read on demand, log in again, rename and unlink. Every request goes through
 * `useApi()` (`/backend` proxy), every POST with `retry: 0` (a retry would queue a second job).
 *
 * **Areas** (= workspaces, spec H2/A1). An Admin only ever has their own: no tabs, no `/overview` request, the
 * `?area=` query is ignored and nothing area-related is sent. A GOD gets the tabs "พื้นที่ของฉัน" · one per other
 * workspace from `GET /mssg-accounts/overview` (name + account count) · "ทุกผู้ใช้"; the choice lives in the URL
 * (`?area=<workspaceId>` / `?area=all`, own area = no key) so a reload stays there. In another area the warning
 * banner shows, `GET /mssg-accounts` carries `workspaceId` and so does the connect body; the `:id` routes are scoped
 * by the account itself (contract "Roles and area scoping"). "ทุกผู้ใช้" renders the overview read-only — no
 * mutating control at all — with "เข้าไปที่พื้นที่นี้" per group.
 *
 * **Polling** (`useMssgPoll`): one 2 s loop of `GET /mssg-accounts/:id` per account whose job is open, stopped on a
 * terminal job, on an area switch, on leaving the page, or after 15 min with "ยังไม่เสร็จ ลองรีเฟรช".
 *
 * **Unlink (contract v2)**: `DELETE` answers 202 with the account `disconnecting` (a `mssgLogout` job logs out of
 * mssg inside the profile) — the card shows "กำลังออกจากระบบ…" with its controls disabled and is polled like any job;
 * the 404 of `GET /mssg-accounts/:id` that follows is the success: the card goes and a success toast shows. A 200
 * `{ ok: true }` (no profile was bound) removes the card at once.
 */
import type {
  MssgAccountsResponse,
  MssgAccountView,
  MssgOverviewResponse,
  MssgOverviewWorkspace,
  MssgWorkspaceRef
} from '#shared/types/mssg-accounts'

useSeoMeta({ title: 'mssg Pages' })
definePageMeta({ middleware: 'mssg-pages-access' })

const api = useApi()
const auth = useAuth()
const route = useRoute()
const router = useRouter()
const toast = useToast()

const isGod = computed(() => (auth.admin.value?.roles ?? []).includes('GOD'))
const homeWorkspaceId = computed(() => auth.context.value?.homeWorkspaceId ?? auth.admin.value?.homeWorkspaceId ?? '')

// ── area (URL state, GOD only) ───────────────────────────────────────────────────────────────────────────────────────
const OBJECT_ID = /^[a-f0-9]{24}$/i
/** `'own'` · `'all'` · the workspace id of another area */
const area = computed<string>(() => {
  if (!isGod.value) return 'own'
  const raw = route.query.area
  if (raw === 'all') return 'all'
  if (typeof raw === 'string' && OBJECT_ID.test(raw) && raw !== homeWorkspaceId.value) return raw
  return 'own'
})
const isAll = computed(() => area.value === 'all')
const otherWorkspaceId = computed(() => (area.value !== 'own' && area.value !== 'all' ? area.value : ''))

function goArea(next: string) {
  const query = { ...route.query }
  if (next === 'own') delete query.area
  else query.area = next
  void router.replace({ query })
}

// ── list of the shown area ───────────────────────────────────────────────────────────────────────────────────────────
const accounts = ref<MssgAccountView[]>([])
const workspace = ref<MssgWorkspaceRef | null>(null)
const listLoaded = ref(false)
const listPending = ref(false)
const listError = ref<string | null>(null)
let listSeq = 0

async function loadList() {
  if (isAll.value) return
  const s = ++listSeq
  listPending.value = true
  try {
    const wsId = otherWorkspaceId.value
    const res = await api<MssgAccountsResponse>('/mssg-accounts', {
      retry: 0,
      ...(wsId ? { query: { workspaceId: wsId } } : {})
    })
    if (s !== listSeq) return
    accounts.value = res.accounts ?? []
    workspace.value = res.workspace ?? null
    listLoaded.value = true
    listError.value = null
  } catch (e) {
    if (s !== listSeq) return
    listError.value = mssgFailure(e, MSSG_LOAD_FALLBACK).message
  } finally {
    if (s === listSeq) listPending.value = false
  }
}

/** the area is the caller's own: by the URL, or by the API's answer when the URL named the own id */
const isOwnArea = computed(() => !isAll.value && (area.value === 'own' || workspace.value?.isOwn === true))
const isOtherArea = computed(() => !isAll.value && !isOwnArea.value)

function upsert(view: MssgAccountView) {
  const i = accounts.value.findIndex(a => a.id === view.id)
  if (i === -1) {
    // a new account of this area (202 of connect): appended, the list is sorted by createdAt ascending
    if (workspace.value && view.workspaceId !== workspace.value.id) return
    accounts.value = [...accounts.value, view]
    return
  }
  const next = accounts.value.slice()
  next[i] = view
  accounts.value = next
}

function removeAccount(id: string) {
  poll.stop(id)
  accounts.value = accounts.value.filter(a => a.id !== id)
}

// ── overview (GOD only: tabs + "ทุกผู้ใช้") ─────────────────────────────────────────────────────────────────────────
const overview = ref<MssgOverviewResponse | null>(null)
const overviewPending = ref(false)
const overviewError = ref<string | null>(null)
let overviewSeq = 0

async function loadOverview() {
  if (!isGod.value) return
  const s = ++overviewSeq
  overviewPending.value = true
  try {
    const res = await api<MssgOverviewResponse>('/mssg-accounts/overview', { retry: 0 })
    if (s !== overviewSeq) return
    overview.value = res
    overviewError.value = null
  } catch (e) {
    if (s !== overviewSeq) return
    overviewError.value = mssgFailure(e, 'โหลดภาพรวมทุกผู้ใช้ไม่สำเร็จ').message
  } finally {
    if (s === overviewSeq) overviewPending.value = false
  }
}

interface AreaTab {
  key: string
  testid: string
  label: string
  count: number | null
}

const tabs = computed<AreaTab[]>(() => {
  const ws = overview.value?.workspaces ?? []
  const own = ws.find(w => w.isOwn)
  const others: { id: string, name: string, accountCount: number }[] = ws.filter(w => !w.isOwn)
  const shownId = otherWorkspaceId.value
  // the shown area may have no account yet (the overview lists only areas with ≥1) — it still gets its tab
  if (shownId && isOtherArea.value && !others.some(w => w.id === shownId)) {
    others.push({ id: shownId, name: workspace.value?.id === shownId ? workspace.value.name : '…', accountCount: accounts.value.length })
  }
  return [
    { key: 'own', testid: 'mp-tab-own', label: 'พื้นที่ของฉัน', count: isOwnArea.value && listLoaded.value ? accounts.value.length : (own?.accountCount ?? null) },
    ...others.map(w => ({
      key: w.id,
      testid: `mp-tab-${w.id}`,
      label: w.name,
      count: w.id === shownId && listLoaded.value ? accounts.value.length : w.accountCount
    })),
    { key: 'all', testid: 'mp-tab-all', label: 'ทุกผู้ใช้', count: overview.value?.totals.accounts ?? null }
  ]
})

const activeTab = computed(() => (isAll.value ? 'all' : isOwnArea.value ? 'own' : otherWorkspaceId.value))

const areaName = computed(() => {
  if (workspace.value?.name) return workspace.value.name
  const id = otherWorkspaceId.value
  return overview.value?.workspaces.find(w => (id ? w.id === id : w.isOwn))?.name ?? ''
})

const subtitle = computed(() => {
  if (isAll.value) return 'ภาพรวมทุกผู้ใช้ · อ่านอย่างเดียว'
  if (isOwnArea.value) return areaName.value ? `พื้นที่ของฉัน · ${areaName.value}` : 'พื้นที่ของฉัน'
  return `พื้นที่ของ ${areaName.value || '…'} · ดูแทนในฐานะผู้ดูแล`
})

function enterGroup(ws: MssgOverviewWorkspace) {
  goArea(ws.isOwn ? 'own' : ws.id)
}

// ── polling ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const poll = useMssgPoll({
  read: id => api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(id)}`, { retry: 0 }),
  onUpdate: upsert,
  onEnd: notifyJobEnd,
  onGone: (id) => {
    const acc = accounts.value.find(a => a.id === id)
    removeAccount(id)
    if (!acc) return
    if (acc.status === 'disconnecting') {
      // v2: the logout job ended and the account was deleted — this 404 is the unlink's success
      toast.add({ title: 'ยกเลิกการเชื่อมแล้ว', description: `${mssgAccountName(acc)} · ออกจากระบบ mssg และปลดโปรไฟล์แล้ว`, color: 'success' })
      if (isGod.value) void loadOverview()
    } else {
      toast.add({ title: 'บัญชีนี้ถูกยกเลิกการเชื่อมไปแล้ว', description: mssgAccountName(acc), color: 'info' })
    }
  },
  onTimeout: (id) => {
    const acc = accounts.value.find(a => a.id === id)
    toast.add({ title: MSSG_POLL_TIMEOUT_TEXT, description: acc ? mssgAccountName(acc) : undefined, color: 'warning' })
  }
})

const openIds = computed(() => accounts.value.filter(a => mssgNeedsPoll(a)).map(a => a.id))
watch(openIds, ids => poll.track(ids))

/** a job ended while the page followed it — the modal tells its own story, everything else gets a toast */
function notifyJobEnd(view: MssgAccountView) {
  if (connectOpen.value && modalAccountId.value === view.id) return
  const job = view.job
  if (!job) return
  const name = mssgAccountName(view)
  if (job.status === 'completed') {
    toast.add({ title: job.type === 'mssgSync' ? 'ดึงข้อมูลจาก mssg แล้ว' : 'เชื่อมบัญชี mssg แล้ว', description: name, color: 'success' })
  } else {
    toast.add({
      title: job.type === 'mssgSync' ? 'ดึงข้อมูลไม่สำเร็จ' : 'เข้าสู่ระบบ mssg ไม่สำเร็จ',
      description: `${name}: ${job.status === 'cancelled' ? 'งานถูกยกเลิก' : mssgErrorText(view.lastError?.code)}`,
      color: 'error'
    })
  }
}

// ── area switch / mount / leave ──────────────────────────────────────────────────────────────────────────────────────
function resetArea() {
  listSeq++
  poll.stopAll()
  poll.resetTimeouts()
  accounts.value = []
  workspace.value = null
  listLoaded.value = false
  listPending.value = false
  listError.value = null
}

watch(area, () => {
  resetArea()
  if (isAll.value) void loadOverview()
  else void loadList()
})

onMounted(() => {
  if (!isAll.value) void loadList()
  if (isGod.value) void loadOverview()
})

onUnmounted(() => {
  listSeq++
  overviewSeq++
})

function reloadList() {
  poll.resetTimeouts()
  void loadList()
}

// ── refresh: one account / page level ───────────────────────────────────────────────────────────────────────────────
const requestingIds = ref<string[]>([])
const syncAllRequesting = ref(false)

const connectedAccounts = computed(() => accounts.value.filter(a => a.status === 'connected'))
/**
 * Page "ดึงข้อมูลใหม่" targets (spec AC-17, Lead decision round 1): `connected` accounts with no open job and no POST of
 * their own in flight. An account that is `connecting` / `disconnecting` / `expired` / `error`, or already syncing, is
 * left alone and does not block the others.
 */
const syncableAccounts = computed(() => connectedAccounts.value.filter(a => !mssgNeedsPoll(a) && !requestingIds.value.includes(a.id)))
/**
 * "กำลังดึงข้อมูลจาก mssg…" shows (and `data-syncing`) while any job of the area is followed or a POST is in flight.
 * Followed, not merely open: a job whose 15 min follow-up gave up no longer counts (its card says so).
 * It is only the progress text now — the page button has its own rule (`syncableAccounts`).
 */
const anyJobOpen = computed(() => poll.polling.value.length > 0 || syncAllRequesting.value || requestingIds.value.length > 0)
const syncButtonTitle = computed(() => {
  if (syncableAccounts.value.length) return undefined
  return connectedAccounts.value.length === 0 ? 'ไม่มีบัญชีที่เชื่อมแล้วในพื้นที่นี้' : 'บัญชีที่เชื่อมแล้วกำลังทำงานอยู่ รอให้งานเสร็จก่อน'
})
const siteTotal = computed(() => accounts.value.reduce((n, a) => n + a.sites.length, 0))

async function postSync(acc: MssgAccountView): Promise<string | null> {
  try {
    const view = await api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(acc.id)}/sync`, { method: 'POST', retry: 0 })
    upsert(view)
    return null
  } catch (e) {
    const failure = mssgFailure(e, 'ดึงข้อมูลไม่สำเร็จ')
    // 409: the account's state moved on (a job is open, or it is no longer connected) — show what it is now
    if (failure.status === 409) {
      void api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(acc.id)}`, { retry: 0 }).then(upsert).catch(() => {})
    }
    if (failure.status === 404) removeAccount(acc.id)
    return `${mssgAccountName(acc)}: ${failure.message}`
  }
}

async function syncOne(acc: MssgAccountView) {
  if (requestingIds.value.includes(acc.id)) return
  requestingIds.value = [...requestingIds.value, acc.id]
  try {
    const failed = await postSync(acc)
    if (failed) toast.add({ title: 'ดึงข้อมูลไม่ได้', description: failed, color: 'error' })
  } finally {
    requestingIds.value = requestingIds.value.filter(id => id !== acc.id)
  }
}

/**
 * spec AC-17 — one `POST …/sync` per `connected` account of the shown area that has no open job, none for any other
 * status (so never `connecting` / `disconnecting` / `expired` / `error`). A refusal of one account (409 …) is reported
 * and never stops the others (`postSync` does not throw).
 */
async function syncAll() {
  if (syncAllRequesting.value || isAll.value) return
  const targets = syncableAccounts.value
  if (!targets.length) return
  syncAllRequesting.value = true
  try {
    const results = await Promise.all(targets.map(postSync))
    const failed = results.filter((r): r is string => r !== null)
    if (failed.length) toast.add({ title: 'ดึงข้อมูลไม่ได้บางบัญชี', description: failed.join(' · '), color: 'error' })
  } finally {
    syncAllRequesting.value = false
  }
}

// ── modals ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const connectOpen = ref(false)
const connectRelogin = ref(false)
/** the account the connect/relogin modal follows (`null` = connect, nothing ordered yet) */
const modalAccountId = ref<string | null>(null)
const modalAccount = computed(() => (modalAccountId.value ? accounts.value.find(a => a.id === modalAccountId.value) ?? null : null))

function openConnect() {
  if (isAll.value) return
  modalAccountId.value = null
  connectRelogin.value = false
  connectOpen.value = true
}

function openRelogin(acc: MssgAccountView) {
  modalAccountId.value = acc.id
  connectRelogin.value = true
  connectOpen.value = true
}

function onRequested(view: MssgAccountView) {
  upsert(view)
  modalAccountId.value = view.id
  if (isGod.value) void loadOverview() // tab counts
}

watch(connectOpen, (isOpen) => {
  if (!isOpen) modalAccountId.value = null
})

const renameOpen = ref(false)
const renameId = ref<string | null>(null)
const renameAccount = computed(() => (renameId.value ? accounts.value.find(a => a.id === renameId.value) ?? null : null))
function openRename(acc: MssgAccountView) {
  renameId.value = acc.id
  renameOpen.value = true
}

const unlinkOpen = ref(false)
const unlinkId = ref<string | null>(null)
const unlinkAccount = computed(() => (unlinkId.value ? accounts.value.find(a => a.id === unlinkId.value) ?? null : null))
function openUnlink(acc: MssgAccountView) {
  unlinkId.value = acc.id
  unlinkOpen.value = true
}
function onUnlinked(id: string) {
  removeAccount(id)
  if (isGod.value) void loadOverview()
}
/** v2 — 202 of the unlink: the card turns `disconnecting` and `openIds` starts its poll, which ends on the 404 */
function onDisconnecting(view: MssgAccountView) {
  upsert(view)
}

// ── page state ───────────────────────────────────────────────────────────────────────────────────────────────────────
const pageState = computed<'loading' | 'error' | 'empty' | 'ready'>(() => {
  if (isAll.value) {
    if (overviewError.value && !overview.value) return 'error'
    if (!overview.value) return 'loading'
    return overview.value.workspaces.every(w => w.accounts.length === 0) ? 'empty' : 'ready'
  }
  if (listError.value && !listLoaded.value) return 'error'
  if (!listLoaded.value) return 'loading'
  return accounts.value.length ? 'ready' : 'empty'
})
/** "all": the Thai/API text of the failure; with an overview already on screen it also says the data below is old */
const overviewAlertDescription = computed(() => {
  const text = overviewError.value && overviewError.value !== 'โหลดภาพรวมทุกผู้ใช้ไม่สำเร็จ' ? overviewError.value : ''
  if (!overview.value) return text || undefined
  return [text, 'ข้อมูลด้านล่างเป็นของการโหลดครั้งก่อน อาจไม่เป็นปัจจุบัน'].filter(Boolean).join(' · ')
})
const areaKind = computed(() => (isAll.value ? 'all' : isOwnArea.value ? 'own' : 'other'))
</script>

<template>
  <UDashboardPanel id="mssg-pages">
    <template #header>
      <UDashboardNavbar title="mssg Pages">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            v-if="!isAll"
            label="+ เชื่อมบัญชี mssg"
            :disabled="!listLoaded"
            data-testid="mp-connect"
            @click="openConnect"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="mp-page"
        :data-state="pageState"
        :data-area="areaKind"
        :data-workspace-id="isAll ? '' : (workspace?.id ?? '')"
        :data-polling="poll.polling.value.length"
        :data-syncing="anyJobOpen ? 'true' : 'false'"
        class="flex min-w-0 flex-1 flex-col gap-4"
      >
        <p class="text-sm text-muted" data-testid="mp-subtitle">
          {{ subtitle }}
        </p>

        <!-- GOD only: area tabs -->
        <div
          v-if="isGod"
          role="tablist"
          aria-label="พื้นที่ทำงาน"
          class="flex max-w-full flex-wrap gap-1 self-start rounded-lg border border-default bg-elevated/40 p-1"
          data-testid="mp-tabs"
        >
          <UButton
            v-for="tab in tabs"
            :key="tab.key"
            role="tab"
            :aria-selected="activeTab === tab.key"
            :color="activeTab === tab.key ? 'primary' : 'neutral'"
            :variant="activeTab === tab.key ? 'soft' : 'ghost'"
            size="sm"
            class="max-w-full"
            :data-testid="tab.testid"
            :data-active="activeTab === tab.key ? 'true' : 'false'"
            @click="goArea(tab.key)"
          >
            <span class="truncate">{{ tab.label }}</span>
            <span v-if="tab.count !== null" class="text-xs text-muted" data-testid="mp-tab-count">{{ tab.count }}</span>
          </UButton>
        </div>
        <UAlert
          v-if="isGod && overviewError && !isAll"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="โหลดรายชื่อพื้นที่ไม่สำเร็จ"
          :description="overviewError"
          data-testid="mp-tabs-error"
        >
          <template #actions>
            <UButton
              label="ลองใหม่"
              color="warning"
              variant="outline"
              size="xs"
              :loading="overviewPending"
              data-testid="mp-tabs-retry"
              @click="loadOverview()"
            />
          </template>
        </UAlert>

        <!-- own area strip / other area banner / overview strip -->
        <p
          v-if="isOwnArea"
          class="text-sm text-muted"
          data-testid="mp-info-own"
        >
          พื้นที่ของคุณ · บัญชี mssg และเว็บที่นี่เป็นของพื้นที่คุณเท่านั้น ผู้ใช้อื่นไม่เห็นและแก้ไม่ได้ ยกเว้นผู้ดูแลระบบ (GOD)
        </p>
        <div
          v-else-if="isOtherArea"
          role="status"
          class="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3"
          data-testid="mp-banner"
        >
          <span class="min-w-0 flex-1 basis-64 text-sm break-words text-warning">
            คุณกำลังดูพื้นที่ของ <strong data-testid="mp-banner-name">{{ areaName || '…' }}</strong>
            · แก้ไขได้ในฐานะผู้ดูแล ทุกการแก้ไขจะบันทึกชื่อคุณ
          </span>
          <UButton
            label="กลับไปพื้นที่ของฉัน"
            color="warning"
            variant="outline"
            size="sm"
            data-testid="mp-banner-back"
            @click="goArea('own')"
          />
        </div>
        <div
          v-else
          role="status"
          class="rounded-lg border border-default bg-elevated/40 px-4 py-3 text-sm text-toned"
          data-testid="mp-overview-strip"
        >
          ภาพรวมทุกผู้ใช้ · <strong>อ่านอย่างเดียว</strong> · กด "เข้าไปที่พื้นที่นี้" เพื่อแก้ไขในพื้นที่นั้น
        </div>

        <!-- ── one area ─────────────────────────────────────────────────────────────────────────────────────────── -->
        <template v-if="!isAll">
          <UAlert
            v-if="pageState === 'error'"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="MSSG_LOAD_FALLBACK"
            :description="listError && listError !== MSSG_LOAD_FALLBACK ? listError : undefined"
            data-testid="mp-error"
          >
            <template #actions>
              <UButton
                label="ลองใหม่"
                icon="i-lucide-refresh-cw"
                color="error"
                variant="solid"
                size="xs"
                :loading="listPending"
                data-testid="mp-error-retry"
                @click="reloadList()"
              />
            </template>
          </UAlert>

          <div v-else-if="pageState === 'loading'" class="grid grid-cols-1 gap-3 xl:grid-cols-2" data-testid="mp-loading">
            <USkeleton v-for="n in 2" :key="n" class="h-40 w-full rounded-lg" />
          </div>

          <div
            v-else-if="pageState === 'empty'"
            class="flex flex-col items-center gap-3 rounded-lg border border-dashed border-default px-4 py-10 text-center"
            data-testid="mp-empty"
          >
            <UIcon name="i-lucide-message-circle" class="size-8 text-dimmed" />
            <p class="text-sm text-muted">
              {{ MSSG_EMPTY_TEXT }}
            </p>
            <UButton
              label="+ เชื่อมบัญชี mssg"
              variant="soft"
              data-testid="mp-empty-connect"
              @click="openConnect"
            />
          </div>

          <section
            v-else
            aria-label="บัญชี mssg และเว็บ"
            class="flex flex-col gap-3 rounded-lg border border-default p-3 sm:p-4"
            data-testid="mp-list"
          >
            <div class="flex flex-wrap items-center gap-2">
              <span class="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
                <span class="font-semibold text-highlighted">บัญชี mssg และเว็บ</span>
                <span class="text-xs text-muted" data-testid="mp-summary">
                  {{ siteTotal }} เว็บ · {{ accounts.length }} บัญชี mssg · ดึงเมื่อเชื่อมสำเร็จหรือเมื่อกด "ดึงข้อมูลใหม่"
                </span>
              </span>
              <span
                v-if="anyJobOpen"
                role="status"
                class="text-sm text-warning"
                data-testid="mp-syncing"
              >{{ MSSG_SYNCING_TEXT }}</span>
              <UButton
                label="ดึงข้อมูลใหม่"
                icon="i-lucide-refresh-cw"
                color="primary"
                variant="outline"
                size="sm"
                :loading="syncAllRequesting"
                :disabled="syncAllRequesting || syncableAccounts.length === 0"
                :title="syncButtonTitle"
                data-testid="mp-sync-all"
                @click="syncAll"
              />
            </div>

            <UAlert
              v-if="listError"
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :title="listError"
              data-testid="mp-reload-error"
            />

            <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
              <MssgPagesAccountCard
                v-for="acc in accounts"
                :key="acc.id"
                :account="acc"
                :requesting="requestingIds.includes(acc.id)"
                :page-syncing="syncAllRequesting"
                :poll-timed-out="poll.hasTimedOut(acc.id)"
                @refresh="syncOne(acc)"
                @relogin="openRelogin(acc)"
                @rename="openRename(acc)"
                @unlink="openUnlink(acc)"
                @reload="reloadList()"
              />
            </div>
          </section>
        </template>

        <!-- ── GOD overview "ทุกผู้ใช้" (read-only) ───────────────────────────────────────────────────────────────── -->
        <template v-else>
          <!-- first load failed (nothing to show) or a re-read failed (the stale overview stays below the alert) -->
          <UAlert
            v-if="overviewError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดภาพรวมทุกผู้ใช้ไม่สำเร็จ"
            :description="overviewAlertDescription"
            :data-stale="overview ? 'true' : 'false'"
            data-testid="mp-error"
          >
            <template #actions>
              <UButton
                label="ลองใหม่"
                icon="i-lucide-refresh-cw"
                color="error"
                variant="solid"
                size="xs"
                :loading="overviewPending"
                data-testid="mp-error-retry"
                @click="loadOverview()"
              />
            </template>
          </UAlert>

          <div v-if="pageState === 'loading'" class="grid grid-cols-1 gap-3 xl:grid-cols-2" data-testid="mp-loading">
            <USkeleton v-for="n in 2" :key="n" class="h-40 w-full rounded-lg" />
          </div>

          <div v-else-if="pageState !== 'error'" class="flex flex-col gap-4" data-testid="mp-overview">
            <p v-if="overview" class="text-xs text-muted" data-testid="mp-overview-totals">
              {{ overview.totals.workspaces }} พื้นที่ · {{ overview.totals.accounts }} บัญชี mssg · {{ overview.totals.sites }} เว็บ
            </p>
            <p v-if="pageState === 'empty'" class="text-sm text-muted" data-testid="mp-empty">
              {{ MSSG_EMPTY_TEXT }}
            </p>
            <section
              v-for="ws in overview?.workspaces ?? []"
              :key="ws.id"
              class="flex flex-col gap-3 rounded-lg border border-default p-3 sm:p-4"
              :data-testid="`mp-overview-group-${ws.id}`"
              :data-own="ws.isOwn ? 'true' : 'false'"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
                  <span class="font-semibold break-words text-highlighted">
                    {{ ws.name }}
                    <UBadge
                      v-if="ws.isOwn"
                      label="ของฉัน"
                      color="primary"
                      variant="subtle"
                      size="sm"
                      class="ms-1 align-middle"
                    />
                  </span>
                  <span class="text-xs text-muted">{{ ws.accountCount }} บัญชี mssg · {{ ws.siteCount }} เว็บ</span>
                </span>
                <UButton
                  label="เข้าไปที่พื้นที่นี้"
                  icon="i-lucide-arrow-right"
                  trailing
                  color="neutral"
                  variant="outline"
                  size="sm"
                  :data-testid="`mp-overview-enter-${ws.id}`"
                  @click="enterGroup(ws)"
                />
              </div>
              <div v-if="ws.accounts.length" class="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <MssgPagesAccountCard
                  v-for="acc in ws.accounts"
                  :key="acc.id"
                  :account="acc"
                  readonly
                />
              </div>
              <p v-else class="rounded-md border border-dashed border-default px-3 py-3 text-center text-xs text-muted">
                ผู้ใช้นี้ยังไม่ได้เชื่อมบัญชี mssg
              </p>
            </section>
          </div>
        </template>
      </div>

      <MssgPagesConnectModal
        v-model:open="connectOpen"
        :account="modalAccount"
        :relogin="connectRelogin"
        :workspace-id="otherWorkspaceId"
        :poll-timed-out="!!modalAccountId && poll.hasTimedOut(modalAccountId)"
        @requested="onRequested"
        @renamed="upsert"
      />
      <MssgPagesRenameModal
        v-model:open="renameOpen"
        :account="renameAccount"
        @renamed="upsert"
      />
      <MssgPagesUnlinkModal
        v-model:open="unlinkOpen"
        :account="unlinkAccount"
        @unlinked="onUnlinked"
        @disconnecting="onDisconnecting"
      />
    </template>
  </UDashboardPanel>
</template>
