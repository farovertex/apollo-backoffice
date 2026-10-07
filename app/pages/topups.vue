<script setup lang="ts">
/**
 * FEAT-021 — Cashier → Top-ups (AC-18, api-contract v1 §4 + v1.1 §B/§C).
 *
 * **Active** tab: the live set of rounds that are still running, fed by `useTopupsLive`
 * (`EventSource /backend/topups/stream` through the BO's streaming proxy; `polling` every 10 s when the
 * stream is down — the badge `tp-live` says which). A round whose `active` turns false leaves the table.
 * **History** tab: `GET /topups?scope=all&page&limit=20&status&workspaceId`, one request per filter/page
 * change, with its own loading / empty / error+retry states.
 *
 * Row actions are the same component and the same semantics as the advertisers slide-over
 * (`TopupsRowActions`, `TopupsPayModal`); Admin sees badges only (D17), GOD additionally sees "ปลดการจอง".
 * A 403 (an admin with none of GOD/Payment/Admin that typed the URL) renders `tp-forbidden`, no redirect.
 *
 * FEAT-029 (api-contract v1 §4/§7): both tabs have a **Trigger** column (`tp-row-trigger[data-trigger]`) — an
 * `auto` badge for a round the kpi job opened on its own, the word `manual` otherwise — and "คนขอ"
 * (`tp-row-requested`) reads **ระบบ** when `requestedBy` is `null`. The history filters are unchanged (the API
 * also takes `?trigger=`, which this page does not use yet).
 *
 * FEAT-033 (api-contract v1 §5/§7): the navbar starts with the per-admin QR sound switch (`tp-sound-toggle`) and
 * the test button (`tp-sound-test`), the page body carries the one `<audio>` element, and `tp-page` publishes the
 * detector's state (`data-sound`, `data-sound-events`, `data-sound-played`, `data-sound-blocked`). All of it lives
 * in `useTopupQrSound`, wired to the **active** rows of `useTopupsLive`, so the sound exists on this page only (G-6)
 * and both tabs share it (the stream runs on both).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { TopupStatus, TopupView, TopupsResponse } from '#shared/types/topups'
import type { TopupViewer } from '~/utils/topup'

useSeoMeta({ title: 'Top-ups' })

const LIMIT = 20

const api = useApi()
const auth = useAuth()
const nowDate = useNow({ interval: 1000 })
const nowMs = computed(() => nowDate.value.getTime())

const viewer = computed<TopupViewer>(() => ({
  id: auth.admin.value?.id ?? null,
  roles: auth.admin.value?.roles ?? []
}))
/** GOD / Payment see every workspace (D18), so only they get the workspace filter */
const canFilterWorkspace = computed(() => canPayTopups(viewer.value))

const tab = ref<'active' | 'history'>('active')
const forbidden = ref<string | null>(null)

// ── active (live) ────────────────────────────────────────────────────────────────────────────────────────────────────
const workspaceFilter = ref<string>('all')
const liveWorkspaceId = computed(() => workspaceFilter.value === 'all' ? undefined : workspaceFilter.value)

const {
  mode: liveMode,
  rows: activeRows,
  loaded: activeLoaded,
  pending: activePending,
  error: activeError,
  errorStatus: activeErrorStatus,
  refresh: refreshActive,
  start: startLive,
  stop: stopLive
} = useTopupsLive({ workspaceId: liveWorkspaceId })

// ── QR-ready sound (FEAT-033) ────────────────────────────────────────────────────────────────────────────────────────
const {
  audioRef: soundAudio,
  enabled: soundEnabled,
  state: soundState,
  busy: soundBusy,
  events: soundEvents,
  played: soundPlayed,
  blocked: soundBlocked,
  toggle: toggleSound,
  test: testSound,
  observe: observeSound
} = useTopupQrSound()

/** `/sounds/topup-sound.mp3`, the file already tracked on `main` (G-1) */
const soundSrc = TOPUP_SOUND_SRC

// the active rows are the live set the admin is looking at (workspace filter included, G-5); watching them covers
// the SSE upserts, the `ready` refetch, every poll tick and `tp-refresh` alike (F2)
observeSound(activeRows, activeLoaded)

// ── history ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const historyRows = ref<TopupView[]>([])
const historyTotal = ref(0)
const historyPage = ref(1)
const historyStatus = ref<'all' | TopupStatus>('all')
const historyPending = ref(false)
const historyLoaded = ref(false)
const historyError = ref<string | null>(null)
let historySession = 0

async function loadHistory() {
  const s = ++historySession
  historyPending.value = true
  historyError.value = null
  try {
    // retry: 0 — exactly one request per filter / page change
    const res = await api<TopupsResponse>('/topups', {
      retry: 0,
      query: {
        scope: 'all',
        page: historyPage.value,
        limit: LIMIT,
        status: historyStatus.value === 'all' ? undefined : historyStatus.value,
        workspaceId: liveWorkspaceId.value
      }
    })
    if (s !== historySession) return
    historyRows.value = res.topups ?? []
    historyTotal.value = res.total ?? historyRows.value.length
    historyLoaded.value = true
    forbidden.value = null
  } catch (e) {
    if (s !== historySession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'โหลดประวัติไม่สำเร็จ'
    historyRows.value = []
    historyTotal.value = 0
    if ((err.response?.status ?? err.statusCode) === 403) forbidden.value = message
    else historyError.value = message
  } finally {
    if (s === historySession) historyPending.value = false
  }
}

const historyKey = computed(() => JSON.stringify([tab.value, historyPage.value, historyStatus.value, liveWorkspaceId.value]))
watch(historyKey, () => {
  if (tab.value === 'history') void loadHistory()
})

watch([historyStatus, liveWorkspaceId], () => {
  historyPage.value = 1
})

// a 403 on the live list is the same page state as a 403 on the history list — and nothing may keep polling
watch(activeErrorStatus, (status) => {
  if (status !== 403) return
  forbidden.value = activeError.value
  stopLive()
})

onMounted(() => {
  startLive()
  if (tab.value === 'history') void loadHistory()
})
onUnmounted(() => {
  historySession++
  stopLive()
})

function selectTab(next: 'active' | 'history') {
  if (tab.value === next) return
  tab.value = next
  if (next === 'history' && !historyLoaded.value) void loadHistory()
}

// ── actions (same semantics as the slide-over) ───────────────────────────────────────────────────────────────────────
function patchRow(topup: TopupView) {
  const index = historyRows.value.findIndex(r => r.id === topup.id)
  if (index >= 0) historyRows.value[index] = topup
}

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
} = useTopupPay(patchRow)

const modalBusy = computed(() => !!payingTopup.value && busyId.value === payingTopup.value.id)

async function onOpenTopup(topup: TopupView) {
  const claimed = await claimTopup(topup)
  if (claimed || !staleId.value) return
  staleId.value = null
  void refreshActive()
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

async function onRecheck(topup: TopupView) {
  const updated = await recheckTopup(topup)
  if (updated && tab.value === 'history') void loadHistory()
}

async function onRelease(topup: TopupView) {
  const updated = await releaseTopup(topup)
  if (updated) void refreshActive()
}

function onCreated() {
  void refreshActive()
  if (tab.value === 'history') void loadHistory()
}

/** "Top up หลายบัญชี" — account-level (BC) rounds for many TikTok accounts at once, one amount */
const bulkOpen = ref(false)

// ── chrome ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const STATUS_ITEMS = computed(() => [
  { label: 'ทุกสถานะ', value: 'all' },
  ...TOPUP_STATUSES.map(status => ({ label: TOPUP_BADGE[status].label, value: status }))
])

/** the workspaces that have been seen in a row (the API has no list endpoint for them — same as /reports) */
const knownWorkspaces = ref<string[]>([])
watch([activeRows, historyRows], () => {
  const next = new Set(knownWorkspaces.value)
  for (const row of [...activeRows.value, ...historyRows.value]) next.add(row.workspaceId)
  if (next.size !== knownWorkspaces.value.length) knownWorkspaces.value = [...next]
}, { immediate: true })

const workspaceItems = computed(() => [
  { label: 'ทุก workspace', value: 'all' },
  ...knownWorkspaces.value.map(id => ({ label: `…${id.slice(-6)}`, value: id }))
])

const LIVE_LABEL: Record<string, string> = {
  live: 'real-time',
  polling: 'อัปเดตทุก 10 วินาที',
  connecting: 'กำลังเชื่อมต่อ…'
}

const rows = computed(() => tab.value === 'active' ? activeRows.value : historyRows.value)
const pending = computed(() => tab.value === 'active' ? activePending.value : historyPending.value)
const showActiveEmpty = computed(() => tab.value === 'active' && activeLoaded.value && activeRows.value.length === 0)
const showHistoryEmpty = computed(() => tab.value === 'history' && historyLoaded.value && historyRows.value.length === 0)
const listError = computed(() => tab.value === 'active' ? activeError.value : historyError.value)

function retry() {
  if (tab.value === 'active') void refreshActive()
  else void loadHistory()
}

const rangeFrom = computed(() => historyTotal.value === 0 ? 0 : (historyPage.value - 1) * LIMIT + 1)
const rangeTo = computed(() => Math.min(historyPage.value * LIMIT, historyTotal.value))
</script>

<template>
  <UDashboardPanel id="topups">
    <template #header>
      <UDashboardNavbar title="Top-ups">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <!-- FEAT-033 §7 — the switch is a toggle button (no USwitch): `aria-pressed` + the icon are the state -->
          <UButton
            v-if="!forbidden"
            label="เสียง"
            aria-label="เสียงแจ้งเตือน QR"
            :icon="soundEnabled ? 'i-lucide-volume-2' : 'i-lucide-volume-x'"
            :color="soundEnabled ? 'primary' : 'neutral'"
            :variant="soundEnabled ? 'solid' : 'outline'"
            :aria-pressed="soundEnabled ? 'true' : 'false'"
            :data-enabled="soundEnabled ? 'true' : 'false'"
            :disabled="soundState === 'loading' || soundBusy"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="tp-sound-toggle"
            @click="toggleSound()"
          />
          <UButton
            v-if="!forbidden"
            label="ทดสอบเสียง"
            aria-label="ทดสอบเสียง"
            icon="i-lucide-play"
            color="neutral"
            variant="outline"
            :disabled="soundState === 'loading'"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="tp-sound-test"
            @click="testSound()"
          />
          <UBadge
            v-if="!forbidden"
            :color="liveMode === 'live' ? 'success' : liveMode === 'polling' ? 'warning' : 'neutral'"
            variant="subtle"
            size="sm"
            class="whitespace-nowrap"
            data-testid="tp-live"
            :data-mode="liveMode"
          >
            <UIcon :name="liveMode === 'live' ? 'i-lucide-radio' : 'i-lucide-refresh-cw'" class="size-3.5 shrink-0" />
            <!--
              FEAT-033 — the two sound controls made the right group 92 px wider, which pushed the navbar title into
              an ellipsis at 390 px. The badge keeps its colour, its icon, `data-testid="tp-live"` and `data-mode`
              (what FEAT-021 asserts); only the wordy Thai label follows the same `hidden sm:inline` rule as every
              other navbar label here.
            -->
            <span class="hidden sm:inline">{{ LIVE_LABEL[liveMode] }}</span>
          </UBadge>
          <UButton
            v-if="!forbidden && canPayTopups(viewer)"
            label="Top up หลายบัญชี"
            aria-label="Top up หลายบัญชี"
            icon="i-lucide-wallet-cards"
            color="primary"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="tp-bulk-open"
            @click="bulkOpen = true"
          />
          <UButton
            v-if="!forbidden"
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="pending"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="tp-refresh"
            @click="retry()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="tp-page"
        :data-tab="tab"
        :data-sound="soundState"
        :data-sound-events="soundEvents"
        :data-sound-played="soundPlayed"
        :data-sound-blocked="soundBlocked ? 'true' : 'false'"
        class="flex flex-1 flex-col gap-4"
      >
        <UAlert
          v-if="forbidden"
          color="error"
          variant="subtle"
          icon="i-lucide-shield-alert"
          title="คุณไม่มีสิทธิ์ดูรายการฝากเงิน"
          :description="forbidden"
          data-testid="tp-forbidden"
        />

        <template v-else>
          <!-- tabs -->
          <div class="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Top-ups">
            <UButton
              label="Active"
              role="tab"
              :aria-selected="tab === 'active'"
              :color="tab === 'active' ? 'primary' : 'neutral'"
              :variant="tab === 'active' ? 'solid' : 'outline'"
              size="sm"
              data-testid="tp-tab-active"
              @click="selectTab('active')"
            />
            <UButton
              label="History"
              role="tab"
              :aria-selected="tab === 'history'"
              :color="tab === 'history' ? 'primary' : 'neutral'"
              :variant="tab === 'history' ? 'solid' : 'outline'"
              size="sm"
              data-testid="tp-tab-history"
              @click="selectTab('history')"
            />

            <USelect
              v-if="tab === 'history'"
              v-model="historyStatus"
              :items="STATUS_ITEMS"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-40"
              aria-label="สถานะ"
              data-testid="tp-filter-status"
            />
            <USelect
              v-if="canFilterWorkspace && workspaceItems.length > 1"
              v-model="workspaceFilter"
              :items="workspaceItems"
              :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
              class="min-w-40"
              aria-label="Workspace"
              data-testid="tp-filter-workspace"
            />
          </div>

          <UAlert
            v-if="listError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดรายการไม่สำเร็จ"
            :description="listError"
            data-testid="tp-error"
          >
            <template #actions>
              <UButton
                label="ลองอีกครั้ง"
                icon="i-lucide-refresh-cw"
                color="error"
                size="xs"
                :loading="pending"
                data-testid="tp-retry"
                @click="retry()"
              />
            </template>
          </UAlert>

          <UEmpty
            v-else-if="showActiveEmpty"
            icon="i-lucide-wallet"
            title="ยังไม่มีรอบฝากเงินที่กำลังทำงาน"
            description="กดจ่ายเงินที่ advertiser ในหน้า TikTok accounts เพื่อเริ่มรอบใหม่"
            data-testid="tp-empty"
          >
            <template #actions>
              <UButton
                label="TikTok accounts"
                icon="i-lucide-user-round"
                color="primary"
                to="/tiktok-accounts"
                data-testid="tp-empty-accounts"
              />
            </template>
          </UEmpty>

          <UEmpty
            v-else-if="showHistoryEmpty"
            icon="i-lucide-search-x"
            title="ไม่พบรอบฝากเงิน"
            data-testid="tp-history-empty"
          />

          <!-- table -->
          <div
            v-else
            class="min-w-0 overflow-x-auto"
            :data-testid="tab === 'active' ? 'tp-table' : 'tp-history'"
          >
            <table class="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr class="bg-elevated/50">
                  <th scope="col" class="rounded-l-lg border-y border-l border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    Advertiser / BC
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    บัญชี
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    Workspace
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                    ยอด
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    สถานะ
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    Trigger
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    คนจอง
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    QR เหลือ
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    จองเหลือ
                  </th>
                  <th scope="col" class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    คนขอ
                  </th>
                  <th scope="col" class="rounded-r-lg border-y border-r border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                    การทำงาน
                  </th>
                </tr>
              </thead>
              <tbody :class="pending ? 'opacity-60' : ''">
                <tr v-if="pending && rows.length === 0" data-testid="tp-table-loading">
                  <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="11">
                    กำลังโหลด…
                  </td>
                </tr>
                <tr
                  v-for="row in rows"
                  :key="row.id"
                  :data-topup-id="row.id"
                  :data-status="row.status"
                  data-testid="tp-row"
                >
                  <td class="border-b border-default px-2 py-2">
                    <div
                      v-if="row.level === 'account'"
                      class="flex max-w-56 min-w-0 flex-col"
                      data-testid="tp-row-level"
                      data-level="account"
                    >
                      <span class="flex min-w-0 items-center gap-1">
                        <UBadge
                          label="BC"
                          color="info"
                          variant="subtle"
                          size="sm"
                        />
                        <span class="truncate font-medium text-highlighted" :title="topupTargetName(row)" data-testid="tp-row-advertiser">{{ topupTargetName(row) }}</span>
                      </span>
                      <span class="font-mono text-xs text-muted" data-testid="tp-row-advertiser-id">{{ row.bcOrgId || REPORT_DASH }}</span>
                    </div>
                    <div
                      v-else
                      class="flex max-w-56 min-w-0 flex-col"
                      data-testid="tp-row-level"
                      data-level="advertiser"
                    >
                      <span class="truncate font-medium text-highlighted" :title="row.advertiser?.name" data-testid="tp-row-advertiser">{{ row.advertiser?.name || REPORT_DASH }}</span>
                      <span class="font-mono text-xs text-muted" data-testid="tp-row-advertiser-id">{{ row.advertiser?.tiktokAdvertiserId || REPORT_DASH }}</span>
                    </div>
                  </td>
                  <td class="border-b border-default px-2 py-2 whitespace-nowrap" data-testid="tp-row-account">
                    {{ row.account?.label || REPORT_DASH }}
                  </td>
                  <td class="border-b border-default px-2 py-2 font-mono text-xs whitespace-nowrap" data-testid="tp-row-workspace">
                    …{{ row.workspaceId.slice(-6) }}
                  </td>
                  <td class="border-b border-default px-2 py-2 text-right tabular-nums whitespace-nowrap" data-testid="tp-row-amount">
                    {{ formatInt(row.amount) }}
                  </td>
                  <td class="border-b border-default px-2 py-2">
                    <TopupsStatusBadge :topup="row" testid="tp-row-status" />
                    <p v-if="row.status === 'qrFailed' && row.error" class="mt-0.5 max-w-48 text-xs break-words text-error" data-testid="tp-row-error">
                      {{ row.error }}
                    </p>
                    <p v-else-if="row.status === 'verifying'" class="mt-0.5 text-xs whitespace-nowrap text-muted" data-testid="tp-row-check-info">
                      {{ topupCheckInfo(row) }}
                    </p>
                    <p v-else-if="row.status === 'paid' && row.balanceAmount" class="mt-0.5 text-xs whitespace-nowrap text-muted" data-testid="tp-row-balance">
                      {{ topupBalanceText(row) }}
                    </p>
                  </td>
                  <td
                    class="border-b border-default px-2 py-2"
                    data-testid="tp-row-trigger"
                    :data-trigger="topupTrigger(row)"
                  >
                    <UBadge
                      v-if="topupTrigger(row) === 'auto'"
                      label="auto"
                      color="info"
                      variant="subtle"
                      size="sm"
                      icon="i-lucide-zap"
                      class="whitespace-nowrap"
                    />
                    <span v-else class="text-xs whitespace-nowrap text-muted">manual</span>
                  </td>
                  <td class="border-b border-default px-2 py-2 whitespace-nowrap" data-testid="tp-row-paying-by">
                    {{ row.payingBy?.displayName || REPORT_DASH }}
                  </td>
                  <td class="border-b border-default px-2 py-2 tabular-nums whitespace-nowrap" data-testid="tp-row-qr-remain">
                    {{ row.active && row.qrExpiresAt ? formatRemainLong(qrRemainingMs(row, nowMs)) : REPORT_DASH }}
                  </td>
                  <td class="border-b border-default px-2 py-2 tabular-nums whitespace-nowrap" data-testid="tp-row-lease-remain">
                    {{ row.status === 'paying' ? formatRemain(leaseRemainingMs(row, nowMs)) : REPORT_DASH }}
                  </td>
                  <td class="border-b border-default px-2 py-2 whitespace-nowrap" data-testid="tp-row-requested">
                    <span class="block">{{ topupRequesterName(row) }}</span>
                    <span class="block text-xs text-muted">{{ formatDateTime(row.requestedAt) }}</span>
                  </td>
                  <td class="border-b border-default px-2 py-2">
                    <TopupsRowActions
                      :topup="row"
                      :tiktok-account-id="row.tiktokAccountId"
                      :advertiser-id="row.advertiserId"
                      :viewer="viewer"
                      prefix="tp-row"
                      :busy="busyId === row.id"
                      @created="onCreated"
                      @open="onOpenTopup"
                      @recheck="onRecheck"
                      @release="onRelease"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            v-if="tab === 'history' && !listError"
            class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
          >
            <span data-testid="tp-count">แสดง {{ rangeFrom }}–{{ rangeTo }} จาก {{ historyTotal }}</span>
            <UPagination
              v-if="historyTotal > LIMIT"
              :page="historyPage"
              :items-per-page="LIMIT"
              :total="historyTotal"
              data-testid="tp-pagination"
              @update:page="(value: number) => historyPage = value"
            />
          </div>
        </template>
      </div>

      <TopupsPayModal
        v-model:open="modalOpen"
        :topup="payingTopup"
        :qr-image="qrImage"
        :busy="modalBusy"
        @confirm="onConfirmTopup"
        @cancel="onCancelTopup"
        @expired="onLeaseExpired"
      />
      <TopupsBulkAccountModal v-model:open="bulkOpen" @created="onCreated" />

      <!--
        FEAT-033 — the one sound source of the page: an element (not `new Audio()`), so it is removed with the page
        and nothing can sound after a route change (G-6). `preload="auto"` keeps the first real alert instant (AS-9).
      -->
      <audio
        ref="soundAudio"
        data-testid="tp-sound-audio"
        :src="soundSrc"
        preload="auto"
        aria-hidden="true"
        class="hidden"
      />
    </template>
  </UDashboardPanel>
</template>
