<script setup lang="ts">
/**
 * FEAT-005 — advertisers of one TikTok account (functions 3.9, spec.md "UI behaviour", api-contract.md v1 §5/§7).
 * Opened from the Advertisers column (`ta-adv-count`). While open it lists
 * `GET /backend/tiktok-accounts/:id/advertisers?page=&limit=50&sort=bcOrder&missing=<false|all>[&q=][&status=]` — exactly one
 * request per open / filter change (search debounced 300 ms), page reset to 1 on every filter change, "Load more"
 * appends the next page while `page * limit < total`. State is exposed as `data-state` on the dialog element
 * (`ta-adv-slideover`): loading (first page in flight, nothing shown yet) · ready · empty · error.
 * Filters reset when the slideover closes, so the next open starts from `page=1&missing=false` with one request.
 * The "Sync advertisers" button of the empty state emits `sync`; the page runs the same POST + poll as the row.
 *
 * FEAT-021 (api-contract v1 §3.2, v1.1 §C): the top-up part of a row is driven by `advertiser.topup`
 * (`TopupView | null`) — one element set per status, the amount popover instead of a modal, and the pay modal
 * that only opens after a `claim` 200. The rows stay fresh through `useTopupsLive`: the SSE `topup` events
 * patch `adv.topup` in place, and while the stream is down (`polling`) the list is re-read quietly on every
 * poll tick as long as a visible advertiser has an active round. No account-wide "busy" lock any more (D6).
 *
 * FEAT-020 (api-contract §6.5): each row also shows the ads-report state of that advertiser (`adv-report`,
 * `data-state` = never|on|off|error) — it comes with the list view (AC-21), so no extra request — and links
 * to `/reports?advertiserId=<id>`. The link is rendered for GOD/Admin only, like the Reports nav item.
 *
 * FEAT-026 (api-contract v1 §3): `ta-adv-balance` is rendered for **every** row now (not just when non-empty) —
 * `ยอดคงเหลือ <advertiserBalanceText(adv)>` or `ยอดคงเหลือ —`, `data-has-balance`, and a `title` carrying the
 * local date-time of `balanceAt` (or "ยังไม่เคยอ่านยอด" when it was never credited).
 *
 * FEAT-029 (api-contract v1 §4/§5/§7, spec "UI behaviour"): a row additionally carries
 * `data-launching` / `data-suspended-reason`, the **Launching ads · since …** badge (`ta-adv-launching`), the
 * kpi reason in the suspended tooltip, the last-read line `ta-adv-balance-at` + `ta-adv-balance-error`, and the
 * per-row **Auto top-up** block (`ta-adv-autotopup*`): a draft (switch + min balance + amount) that Save sends as
 * exactly one `PATCH /backend/advertisers/:id/auto-topup { enabled, minBalance, amount }` (numbers, `retry: 0`);
 * 200 replaces the row's `autoTopup` from the answered view, 400/403/404 render the API text in
 * `ta-adv-autotopup-error`. Client zod (integers, amount ≥ `TOPUP_MIN_AMOUNT`) blocks a bad value without a
 * request; an admin without GOD / Payment sees every control disabled.
 */
import type { FetchError } from 'ofetch'
import type { SlideoverProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { Advertiser, AdvertiserMissingFilter, AdvertisersResponse, AdvertiserStatus } from '#shared/types/advertisers'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'
import type { TopupView } from '#shared/types/topups'
import type { TopupViewer } from '~/utils/topup'

const props = defineProps<{
  account: TikTokAccount | null
}>()

const emit = defineEmits<{
  /** the empty state's "Sync advertisers" button — the page starts the discover job (same as the row action) */
  sync: [account: TikTokAccount]
}>()

const open = defineModel<boolean>('open', { default: false })

type ListState = 'loading' | 'ready' | 'empty' | 'error'

const LIMIT = 50
const DEBOUNCE_MS = 300
const REJECT_MAX = 60

const api = useApi()
const toast = useToast()
const auth = useAuth()

/** FEAT-020 §6.5 — the report line links to `/reports`, which is GOD/Admin only (display-only gate) */
const canSeeReports = computed(() => {
  const roles = auth.admin.value?.roles ?? []
  return roles.includes('GOD') || roles.includes('Admin')
})

// ── filters ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const search = ref('')
const searchDebounced = refDebounced(search, DEBOUNCE_MS)
const statusFilter = ref<'all' | AdvertiserStatus>('all')
const showMissing = ref(false)

const statusItems: { label: string, value: 'all' | AdvertiserStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Suspended', value: 'suspended' },
  { label: 'Unknown', value: 'unknown' }
]

const hasFilter = computed(() => search.value.trim() !== '' || statusFilter.value !== 'all' || showMissing.value)

function resetFilters() {
  search.value = ''
  statusFilter.value = 'all'
  showMissing.value = false
}

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const items = ref<Advertiser[]>([])
const page = ref(1)
const total = ref(0)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref<string | null>(null)
// bumped on every close / reload so a late response from a previous request is dropped
let session = 0

const hasMore = computed(() => page.value * LIMIT < total.value)

async function load(nextPage: number, append = false, quiet = false) {
  const id = props.account?.id
  if (!id) return
  const s = ++session
  if (append) loadingMore.value = true
  else if (!quiet) loading.value = true
  if (!quiet) error.value = null
  try {
    const q = searchDebounced.value.trim()
    const missing: AdvertiserMissingFilter = showMissing.value ? 'all' : 'false'
    // retry: 0 — exactly one request per filter change / page, ofetch must not re-issue it on 5xx
    const res = await api<AdvertisersResponse>(`/tiktok-accounts/${encodeURIComponent(id)}/advertisers`, {
      retry: 0,
      query: {
        page: nextPage,
        limit: LIMIT,
        sort: 'bcOrder',
        missing,
        q: q || undefined,
        status: statusFilter.value === 'all' ? undefined : statusFilter.value
      }
    })
    if (s !== session) return
    items.value = append ? [...items.value, ...res.advertisers] : res.advertisers
    page.value = res.page
    total.value = res.total
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'Could not load the advertisers'
    if (append) {
      // keep the rows already shown; the user can press "Load more" again
      toast.add({ title: 'Could not load more advertisers', description: message, color: 'error' })
    } else if (!quiet) {
      error.value = message
    }
  } finally {
    if (s === session) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function reload() {
  void load(1)
}

function loadMore() {
  if (loadingMore.value || loading.value || !hasMore.value) return
  void load(page.value + 1, true)
}

function reset() {
  session++
  items.value = []
  page.value = 1
  total.value = 0
  loading.value = false
  loadingMore.value = false
  error.value = null
}

// one request per distinct (account, filters) while open; `null` while closed. `lastDiscoverAt` is part of the key
// so a sync that finishes while the slideover is open (empty-state button / row action) reloads the list once.
const queryKey = computed<string | null>(() =>
  open.value && props.account
    ? JSON.stringify([props.account.id, props.account.lastDiscoverAt, searchDebounced.value.trim(), statusFilter.value, showMissing.value])
    : null
)
watch(queryKey, (key) => {
  if (key) reload()
})

watch(open, (isOpen) => {
  if (!isOpen) {
    reset()
    resetFilters()
    stopClock()
    stopLive()
    closeModal()
  } else {
    startClock()
    startLive()
  }
})

// ── top-up (FEAT-021) ────────────────────────────────────────────────────────────────────────────────────────────────
const nowMs = ref(Date.now())
let clockTimer: ReturnType<typeof setInterval> | undefined

const viewer = computed<TopupViewer>(() => ({
  id: auth.admin.value?.id ?? null,
  roles: auth.admin.value?.roles ?? []
}))

/** an SSE `topup` event (or the answer of a mutation) replaces the round of the advertiser it belongs to */
function patchTopup(topup: TopupView) {
  const row = items.value.find(a => a.id === topup.advertiserId)
  if (row) row.topup = topup
}

const { mode: liveMode, syncedAt, start: startLive, stop: stopLive } = useTopupsLive({ onTopup: patchTopup })
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

/** the list carries `advertiser.topup`; only a quiet re-read can show a round that ended while we polled */
watch(syncedAt, () => {
  if (!open.value || liveMode.value !== 'polling') return
  if (page.value !== 1 || loading.value || loadingMore.value) return
  if (!items.value.some(a => a.topup?.active)) return
  void load(1, false, true)
})

function startClock() {
  stopClock()
  nowMs.value = Date.now()
  clockTimer = setInterval(() => {
    nowMs.value = Date.now()
  }, 1000)
}

function stopClock() {
  if (clockTimer) clearInterval(clockTimer)
  clockTimer = undefined
}

/** "Ready to pay" / re-open my own round: claim first, the modal opens only on 200 (AC-17) */
async function onOpenTopup(topup: TopupView) {
  const claimed = await claimTopup(topup)
  if (claimed || !staleId.value) return
  // 409 "QR หมดอายุแล้ว" / "ไม่ได้อยู่ในสถานะพร้อมจ่าย" — what the row shows is stale
  staleId.value = null
  void load(1, false, true)
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

onUnmounted(() => {
  session++
  stopClock()
  stopLive()
})

// ── auto top-up (FEAT-029) ───────────────────────────────────────────────────────────────────────────────────────────
const NO_DELIVERY_TIP = 'ปิดเพราะโฆษณาทั้งหมดไม่ส่งแล้ว (ตรวจจาก kpi)'

/** only GOD / Payment may change money config (same rule as the Pay button, spec AS-8) */
const canConfigureAutoTopup = computed(() => canPayTopups(viewer.value))

/** the PATCH answered the whole advertiser view — only its `autoTopup` replaces what the row shows */
function onAutoTopupSaved(updated: Advertiser) {
  const row = items.value.find(a => a.id === updated.id)
  if (row) row.autoTopup = updated.autoTopup
}

/** the suspended badge explains the kpi rule when the kpi job was the one that suspended the advertiser */
function statusTip(adv: Advertiser): string {
  return adv.suspendedReason === 'noDelivery' ? NO_DELIVERY_TIP : accountStatusTip(adv.accountStatus)
}

function launchingLabel(adv: Advertiser): string {
  return adv.launchingSince ? `Launching ads · since ${formatDateTime(adv.launchingSince)}` : 'Launching ads'
}

function balanceAtLine(adv: Advertiser): string {
  return adv.balanceAt ? `อ่านล่าสุด ${formatDateTime(adv.balanceAt)}` : 'ยังไม่เคยอ่านยอด'
}

// ── state ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const state = computed<ListState>(() => {
  if (error.value) return 'error'
  if (loading.value) return 'loading'
  if (items.value.length === 0) return 'empty'
  return 'ready'
})

// USlideover's root is renderless: `content` is v-bound onto the DialogContent element QA locates as
// `ta-adv-slideover[data-state]` (same trick as the LoginModal).
const slideoverContent = computed(() => ({ 'data-testid': 'ta-adv-slideover', 'data-state': state.value }) as SlideoverProps['content'])

const title = computed(() => `Advertisers — ${props.account?.label ?? props.account?.loginEmail ?? ''}`)
const canSync = computed(() => {
  const a = props.account
  return !!a && a.advertiserCount === 0 && a.runningJob === null && a.sessionStatus !== 'needsHuman' && a.isActive
})
const emptyTitle = computed(() => hasFilter.value ? 'No match' : 'No advertisers yet')
const emptyDescription = computed(() =>
  hasFilter.value
    ? 'No advertiser matches the current search or filters.'
    : props.account?.advertiserCount === 0
      ? 'Press Sync advertisers to read them from the Business Center.'
      : 'Nothing to show.'
)

// ── cells ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<AdvertiserStatus, { label: string, color: 'success' | 'error' | 'neutral' }> = {
  active: { label: 'Active', color: 'success' },
  suspended: { label: 'Suspended', color: 'error' },
  unknown: { label: 'Unknown', color: 'neutral' }
}
function statusBadge(s: AdvertiserStatus) {
  return STATUS_BADGE[s] ?? { label: s, color: 'neutral' }
}

function truncateReject(text: string): string {
  return text.length > REJECT_MAX ? `${text.slice(0, REJECT_MAX).trimEnd()}…` : text
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

async function copyId(id: string) {
  try {
    await navigator.clipboard.writeText(id)
    toast.add({ title: 'Advertiser id copied', description: id, color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy the id', description: 'Clipboard access was denied by the browser.', color: 'error' })
  }
}

/** "รายงาน: เปิด · 5 นาทีที่แล้ว" · "รายงาน: ปิด" · the Thai error text · "รายงาน: —" when never tracked */
function reportLine(adv: Advertiser): string {
  const report = adv.report
  if (!report || report.state === 'never') return `รายงาน: ${REPORT_DASH}`
  if (report.state === 'off') return 'รายงาน: ปิด'
  if (report.state === 'error') return `รายงาน: ${reportErrorText(report.lastError) ?? 'ผิดพลาด'}`
  return `รายงาน: เปิด · ${timeAgoTh(report.lastFetchAt, nowMs.value)}`
}

function onSync() {
  if (props.account && canSync.value) emit('sync', props.account)
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :ui="{ content: 'sm:max-w-xl', body: 'flex flex-col gap-4' }"
    :content="slideoverContent"
  >
    <template #description>
      <span class="flex items-center gap-1 font-mono text-xs" data-testid="ta-adv-org">
        <UIcon name="i-lucide-building-2" class="size-3.5 shrink-0" />
        <span v-if="account?.bcOrgId" :title="account.bcOrgId">BC org {{ account.bcOrgId }}</span>
        <span v-else>No Business Center org yet</span>
      </span>
    </template>

    <template #body>
      <!-- filters -->
      <div class="flex flex-wrap items-center gap-1.5">
        <UInput
          v-model="search"
          class="w-full sm:flex-1 sm:min-w-48"
          icon="i-lucide-search"
          placeholder="Search name or id"
          data-testid="ta-adv-search"
        />
        <USelect
          v-model="statusFilter"
          :items="statusItems"
          :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
          class="min-w-32"
          aria-label="Status"
          data-testid="ta-adv-status"
        />
        <USwitch
          v-model="showMissing"
          label="Show missing"
          data-testid="ta-adv-missing"
        />
      </div>

      <!-- loading (first page) -->
      <div v-if="state === 'loading'" class="space-y-2" data-testid="ta-adv-loading">
        <USkeleton v-for="n in 6" :key="n" class="h-16 w-full" />
      </div>

      <!-- error -->
      <UAlert
        v-else-if="state === 'error'"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="Could not load advertisers"
        :description="error ?? undefined"
        data-testid="ta-adv-error-state"
      >
        <template #actions>
          <UButton
            label="Retry"
            icon="i-lucide-refresh-cw"
            color="error"
            variant="solid"
            size="xs"
            :loading="loading"
            data-testid="ta-adv-retry"
            @click="reload"
          />
        </template>
      </UAlert>

      <!-- empty -->
      <UEmpty
        v-else-if="state === 'empty'"
        :icon="hasFilter ? 'i-lucide-search-x' : 'i-lucide-building-2'"
        :title="emptyTitle"
        :description="emptyDescription"
        data-testid="ta-adv-empty"
      >
        <template v-if="canSync" #actions>
          <UButton
            label="Sync advertisers"
            icon="i-lucide-refresh-cw"
            color="primary"
            data-testid="ta-adv-empty-sync"
            @click="onSync"
          />
        </template>
      </UEmpty>

      <!-- ready -->
      <template v-else>
        <ul class="divide-y divide-default rounded-lg border border-default" data-testid="ta-adv-list">
          <li
            v-for="adv in items"
            :key="adv.id"
            class="flex flex-col gap-1.5 p-3 text-sm"
            :class="adv.missingSince ? 'opacity-60' : ''"
            data-testid="ta-adv-row"
            :data-id="adv.id"
            :data-advertiser-id="adv.tiktokAdvertiserId"
            :data-status="adv.status"
            :data-missing="adv.missingSince ? 'true' : 'false'"
            :data-launching="adv.launchingAds ? 'true' : 'false'"
            :data-suspended-reason="adv.suspendedReason ?? ''"
          >
            <div class="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <span class="min-w-0 break-words font-medium text-highlighted" data-testid="ta-adv-name">{{ adv.name }}</span>
              <div class="flex shrink-0 flex-wrap items-center gap-1">
                <UBadge
                  v-if="adv.missingSince"
                  color="neutral"
                  variant="outline"
                  size="sm"
                  icon="i-lucide-eye-off"
                  class="whitespace-nowrap"
                  :title="adv.missingSince"
                  data-testid="ta-adv-missing-badge"
                >
                  Not seen since {{ formatDate(adv.missingSince) }}
                </UBadge>
                <UBadge
                  v-if="adv.launchingAds"
                  color="success"
                  variant="subtle"
                  size="sm"
                  icon="i-lucide-rocket"
                  class="whitespace-nowrap"
                  :title="launchingLabel(adv)"
                  data-testid="ta-adv-launching"
                  :data-since="adv.launchingSince ?? ''"
                >
                  {{ launchingLabel(adv) }}
                </UBadge>
                <UTooltip :text="statusTip(adv)">
                  <UBadge
                    :color="statusBadge(adv.status).color"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                    data-testid="ta-adv-status-badge"
                    :data-status="adv.status"
                  >
                    {{ statusBadge(adv.status).label }}
                  </UBadge>
                </UTooltip>
                <!-- `readyToPay` has no badge here: the primary button already reads "Ready to pay" (spec status table) -->
                <TopupsStatusBadge
                  v-if="adv.topup?.status !== 'readyToPay'"
                  :topup="adv.topup"
                  testid="ta-adv-topup-badge"
                />
                <TopupsRowActions
                  v-if="account"
                  :topup="adv.topup"
                  :tiktok-account-id="account.id"
                  :advertiser-id="adv.id"
                  :viewer="viewer"
                  prefix="ta-adv-topup"
                  :busy="busyId === adv.topup?.id"
                  @created="patchTopup"
                  @open="onOpenTopup"
                  @recheck="recheckTopup"
                  @release="releaseTopup"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span class="inline-flex items-center gap-0.5">
                <span class="font-mono" data-testid="ta-adv-id">{{ adv.tiktokAdvertiserId }}</span>
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  aria-label="Copy advertiser id"
                  data-testid="ta-adv-id-copy"
                  @click="copyId(adv.tiktokAdvertiserId)"
                />
              </span>
              <span class="inline-flex items-center gap-1" data-testid="ta-adv-owner">
                <UIcon name="i-lucide-user-round" class="size-3.5 shrink-0" />
                {{ adv.ownerName || '—' }}
              </span>
              <UTooltip text="ad_account_type (raw)">
                <span class="inline-flex items-center gap-1" data-testid="ta-adv-type">
                  <UIcon name="i-lucide-tag" class="size-3.5 shrink-0" />
                  type {{ adv.adAccountType ?? '—' }}
                </span>
              </UTooltip>
            </div>

            <NuxtLink
              v-if="canSeeReports"
              :to="`/reports?advertiserId=${adv.id}`"
              class="inline-flex w-fit items-center gap-1.5 text-xs text-muted hover:underline"
              data-testid="adv-report"
              :data-state="adv.report?.state ?? 'never'"
              @click.stop
            >
              <span class="size-2 shrink-0 rounded-full" :class="reportDot(adv.report?.state)" />
              <span>{{ reportLine(adv) }}</span>
            </NuxtLink>

            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <p
                class="text-xs text-muted tabular-nums"
                data-testid="ta-adv-balance"
                :data-has-balance="advertiserBalanceText(adv) ? 'true' : 'false'"
                :title="adv.balanceAt ? `อัปเดต ${formatDateTime(adv.balanceAt)}` : 'ยังไม่เคยอ่านยอด'"
              >
                ยอดคงเหลือ {{ advertiserBalanceText(adv) || '—' }}
              </p>
              <!-- FEAT-029 — when the kpi job last read it (or that it never did) -->
              <span
                class="text-xs text-muted"
                data-testid="ta-adv-balance-at"
                :data-at="adv.balanceAt ?? ''"
              >
                {{ balanceAtLine(adv) }}
              </span>
              <UBadge
                v-if="adv.balanceError"
                color="warning"
                variant="subtle"
                size="sm"
                icon="i-lucide-triangle-alert"
                class="min-w-0 break-words"
                title="อ่านล่าสุดล้ม · ยอดเดิมคงไว้"
                data-testid="ta-adv-balance-error"
              >
                {{ adv.balanceError }}
              </UBadge>
            </div>

            <!-- FEAT-029 — auto top-up of this advertiser (GOD / Payment write, Admin reads) -->
            <TiktokAccountsAutoTopupBlock
              :advertiser="adv"
              :can-configure="canConfigureAutoTopup"
              @updated="onAutoTopupSaved"
            />
            <p
              v-if="adv.topup?.status === 'readyToPay'"
              class="text-xs text-muted tabular-nums"
              data-testid="ta-adv-topup-qr-remain"
            >
              QR หมดอายุใน {{ formatRemainLong(qrRemainingMs(adv.topup, nowMs)) }}
            </p>
            <p
              v-if="adv.topup?.status === 'paying'"
              class="text-xs text-muted tabular-nums"
              data-testid="ta-adv-topup-lease-remain"
            >
              จองไว้อีก {{ formatRemain(leaseRemainingMs(adv.topup, nowMs)) }}
            </p>
            <p
              v-if="adv.topup?.status === 'verifying'"
              class="text-xs text-muted"
              data-testid="ta-adv-topup-check-info"
            >
              {{ topupCheckInfo(adv.topup) }}
            </p>
            <p v-if="adv.topup?.status === 'qrFailed' && adv.topup.error" class="text-xs text-error" data-testid="ta-adv-topup-error">
              {{ adv.topup.error }}
            </p>
            <UTooltip v-if="adv.rejectReason" :text="adv.rejectReason" :ui="{ content: 'max-w-md h-auto py-2 whitespace-normal' }">
              <p
                class="flex items-start gap-1 text-xs text-error"
                :title="adv.rejectReason"
                data-testid="ta-adv-reject"
              >
                <UIcon name="i-lucide-ban" class="mt-0.5 size-3.5 shrink-0" />
                <span class="min-w-0 break-words">{{ truncateReject(adv.rejectReason) }}</span>
              </p>
            </UTooltip>
          </li>
        </ul>

        <UButton
          v-if="hasMore"
          label="Load more"
          icon="i-lucide-chevrons-down"
          color="neutral"
          variant="outline"
          class="self-center"
          :loading="loadingMore"
          data-testid="ta-adv-more"
          @click="loadMore"
        />
      </template>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3 text-sm text-muted">
        <span data-testid="ta-adv-total">{{ total }} advertisers</span>
        <UButton
          label="Close"
          color="neutral"
          variant="subtle"
          data-testid="ta-adv-close"
          @click="open = false"
        />
      </div>
    </template>
  </USlideover>
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
