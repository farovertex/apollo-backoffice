<script setup lang="ts">
/**
 * FEAT-020 — the Report tab of `/orders/[id]` (api-contract §6.4; spec AC-25, AC-26). The whole panel is one
 * `GET /backend/campaign-orders/:id/report?range=…`, read on the **first** open of the tab and then only on
 * Refresh, a range change, a toggle or a fetch-now round — this tab never polls (the Builds tab keeps its
 * own 5 s poll, untouched).
 *
 * Two builds can share one advertiser, so a toggle or a finished fetch replaces the **whole** panel from a
 * fresh GET instead of patching one card. Switching tracking **off** asks for confirmation first; switching
 * it on is immediate (AC-26).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdReportRow,
  AdvertiserReport,
  OrderReportBuild,
  OrderReportResponse,
  ReportRange
} from '#shared/types/reports'

const props = defineProps<{
  orderId: string
}>()

const api = useApi()
const toast = useToast()
const nowDate = useNow({ interval: 30_000 })
const nowMs = computed(() => nowDate.value.getTime())

const report = ref<OrderReportResponse | null>(null)
const pending = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)
const range = ref<ReportRange>('today')
let session = 0

const intervalMs = computed(() => report.value?.intervalMs || 300_000)
const builds = computed<OrderReportBuild[]>(() => report.value?.builds ?? [])

/** `silent` = a re-read after a toggle / while an advertiser is fetching: the panel keeps its content */
async function load(silent = false) {
  if (!props.orderId) return
  const s = ++session
  if (!silent) {
    pending.value = true
    error.value = null
  }
  try {
    // retry: 0 — exactly one request per open / Refresh / range change / tick
    const res = await api<OrderReportResponse>(
      `/campaign-orders/${encodeURIComponent(props.orderId)}/report`,
      { retry: 0, query: { range: range.value } }
    )
    if (s !== session) return
    report.value = res
    loaded.value = true
    error.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    const message = err.data?.error ?? err.message ?? 'โหลดรายงานไม่สำเร็จ'
    if (silent) toast.add({ title: 'อัปเดตรายงานไม่สำเร็จ', description: message, color: 'warning' })
    else error.value = message
  } finally {
    if (s === session && !silent) pending.value = false
  }
}

watch(range, () => {
  void load()
})

onMounted(() => {
  void load()
})

onUnmounted(() => {
  session++
})

// ── tracking toggle ──────────────────────────────────────────────────────────────────────────────────────────────────
const confirmOpen = ref(false)
const confirmTarget = ref<OrderReportBuild | null>(null)
const toggling = ref<string | null>(null)

function onToggle(build: OrderReportBuild, next: boolean) {
  if (next) {
    void patchTracking(build, true)
    return
  }
  confirmTarget.value = build
  confirmOpen.value = true
}

async function patchTracking(build: OrderReportBuild, enabled: boolean) {
  const advertiserId = build.advertiser?.id
  if (!advertiserId || toggling.value) return
  toggling.value = advertiserId
  try {
    // retry: 0 — exactly one PATCH per confirmed toggle
    await api<AdvertiserReport>(`/advertisers/${encodeURIComponent(advertiserId)}/report`, {
      method: 'PATCH',
      retry: 0,
      body: { enabled }
    })
    confirmOpen.value = false
    toast.add({
      title: enabled ? 'เปิดการติดตามแล้ว' : 'ปิดการติดตามแล้ว',
      description: build.advertiser?.name ?? undefined,
      color: 'success'
    })
    // two builds can share one advertiser → replace the whole panel
    await load(true)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    confirmOpen.value = false
    toast.add({
      title: 'เปลี่ยนการติดตามไม่สำเร็จ',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
  } finally {
    toggling.value = null
  }
}

function confirmToggleOff() {
  const build = confirmTarget.value
  if (build) void patchTracking(build, false)
}

// ── fetch now ────────────────────────────────────────────────────────────────────────────────────────────────────────
const fetchNow = useFetchNow()
const fetchingAdvertiserId = ref<string | null>(null)

const anyFetching = computed(() => builds.value.some(b => b.tracking?.fetching))

function startWatching() {
  fetchNow.watchUntilDone(async () => {
    await load(true)
    const still = builds.value.some(b => b.tracking?.fetching)
    if (!still) fetchingAdvertiserId.value = null
    return still
  })
}

async function onFetchNow(build: OrderReportBuild) {
  const advertiserId = build.advertiser?.id
  if (!advertiserId) return
  fetchingAdvertiserId.value = advertiserId
  const res = await fetchNow.request(advertiserId)
  if (!res) {
    fetchingAdvertiserId.value = null
    return
  }
  await load(true)
  startWatching()
}

watch(anyFetching, (isFetching, was) => {
  if (isFetching && !was && !fetchNow.watching.value) startWatching()
})

// ── slideover ────────────────────────────────────────────────────────────────────────────────────────────────────────
const selectedAdId = ref<string | null>(null)
const slideoverOpen = ref(false)

function openAd(row: AdReportRow) {
  selectedAdId.value = row.id
  slideoverOpen.value = true
}

function focusRow() {
  const id = selectedAdId.value
  if (!id || !import.meta.client) return
  void nextTick(() => {
    document.querySelector<HTMLElement>(`[data-testid="or-row"][data-id="${CSS.escape(id)}"]`)?.focus()
  })
}

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const RANGES: ReportRange[] = ['today', '7d', 'all']

function trackText(build: OrderReportBuild): string {
  const t = build.tracking
  if (!t) return REPORT_DASH
  const errorText = reportErrorText(t.lastError)
  if (errorText) return errorText
  if (t.state === 'off') return 'ปิดการติดตามอยู่'
  if (t.state === 'never') return 'ยังไม่เริ่มติดตาม'
  const last = t.lastFetchAt ? `${formatClock(t.lastFetchAt)} (${timeAgoTh(t.lastFetchAt, nowMs.value)})` : REPORT_DASH
  const next = t.nextFetchAt ? formatClock(t.nextFetchAt) : REPORT_DASH
  return `ล่าสุด ${last} · รอบถัดไป ${next} · ทุก ${intervalMinutes(intervalMs.value)} นาที`
}

function buildEmptyText(build: OrderReportBuild): string | null {
  if (build.build?.status !== 'published') return 'ยังไม่เผยแพร่ — ไม่มีรายงานสำหรับ build นี้'
  if ((build.ads?.length ?? 0) === 0) return 'รอรอบดึงข้อมูลแรก'
  return null
}

const confirmContent = { 'data-testid': 'or-confirm' } as Record<string, string>
</script>

<template>
  <div
    data-testid="or-panel"
    :data-range="range"
    :data-pending="pending ? 'true' : 'false'"
    class="flex flex-1 flex-col gap-4"
  >
    <!-- controls -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap gap-1" role="group" aria-label="ช่วงเวลา">
        <UButton
          v-for="key in RANGES"
          :key="key"
          :label="RANGE_LABEL[key]"
          size="xs"
          :color="range === key ? 'primary' : 'neutral'"
          :variant="range === key ? 'solid' : 'outline'"
          :aria-pressed="range === key"
          :data-testid="`or-range-${key}`"
          @click="range = key"
        />
      </div>
      <div class="flex items-center gap-2">
        <span v-if="report" class="text-xs text-muted" data-testid="or-interval">
          อัปเดตทุก {{ intervalMinutes(intervalMs) }} นาที · ล่าสุด
          {{ report.refreshedAt ? formatClock(report.refreshedAt) : REPORT_DASH }}
        </span>
        <UButton
          label="Refresh"
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="outline"
          size="xs"
          :loading="pending"
          data-testid="or-refresh"
          @click="load()"
        />
      </div>
    </div>

    <div v-if="pending && !loaded" class="space-y-3" data-testid="or-loading">
      <USkeleton class="h-20 w-full" />
      <USkeleton class="h-40 w-full" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="โหลดรายงานไม่สำเร็จ"
      :description="error"
      data-testid="or-error"
    >
      <template #actions>
        <UButton
          label="Retry"
          icon="i-lucide-refresh-cw"
          color="error"
          size="xs"
          :loading="pending"
          data-testid="or-retry"
          @click="load()"
        />
      </template>
    </UAlert>

    <template v-else-if="report">
      <!-- order totals -->
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5" data-testid="or-totals">
        <ReportsMetricTile
          testid="or-total-spend"
          label="Spend"
          format="dec"
          caption="สกุลเงินของบัญชี"
          :value="report.totals?.spend ?? null"
        />
        <ReportsMetricTile
          testid="or-total-impressions"
          label="Impressions"
          :value="report.totals?.impressions ?? null"
        />
        <ReportsMetricTile
          testid="or-total-clicks"
          label="Clicks"
          :value="report.totals?.clicks ?? null"
        />
        <ReportsMetricTile
          testid="or-total-conversions"
          label="Conversions"
          :value="report.totals?.conversions ?? null"
        />
        <ReportsMetricTile
          testid="or-total-ads"
          label="โฆษณา"
          :value="report.adCount ?? 0"
        />
      </div>

      <!-- one card per build -->
      <div
        v-for="item in builds"
        :key="item.build.id"
        class="flex flex-col gap-2 rounded-lg border border-default p-3"
        data-testid="or-build"
        :data-build-id="item.build.id"
        :data-build-status="item.build.status"
        :data-tracking="item.tracking?.state ?? 'never'"
      >
        <div class="flex flex-wrap items-start justify-between gap-2">
          <div class="flex min-w-0 flex-col">
            <span class="font-medium text-highlighted">
              {{ item.account?.label || REPORT_DASH }} · {{ item.advertiser?.name || REPORT_DASH }}
            </span>
            <span class="text-xs text-muted">
              advertiser {{ last4(item.advertiser?.tiktokAdvertiserId) }}
              · แคมเปญ <span class="font-mono">{{ last4(item.build?.tiktokCampaignId) }}</span>
              · เผยแพร่ {{ formatDateTime(item.build?.publishedAt) }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <USwitch
              :model-value="item.tracking?.enabled === true"
              label="ติดตาม"
              :loading="toggling === item.advertiser?.id"
              :aria-label="`ติดตามรายงานของ ${item.advertiser?.name ?? ''}`"
              data-testid="or-build-switch"
              @update:model-value="(v: boolean) => onToggle(item, v)"
            />
            <UButton
              :label="item.tracking?.fetching ? 'กำลังดึงข้อมูล…' : 'ดึงตอนนี้'"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="outline"
              size="xs"
              :disabled="!!item.tracking?.fetching"
              :loading="fetchNow.requesting.value && fetchingAdvertiserId === item.advertiser?.id"
              data-testid="or-build-fetch"
              @click="onFetchNow(item)"
            />
          </div>
        </div>

        <p
          class="text-xs"
          :class="item.tracking?.lastError ? 'text-error' : 'text-muted'"
          data-testid="or-build-track"
        >
          {{ trackText(item) }}
        </p>

        <p
          v-if="buildEmptyText(item)"
          class="rounded-md border border-dashed border-default px-3 py-4 text-center text-sm text-muted"
          data-testid="or-build-empty"
        >
          {{ buildEmptyText(item) }}
        </p>

        <ReportsAdsTable
          v-else
          :rows="item.ads"
          :interval-ms="intervalMs"
          :now-ms="nowMs"
          prefix="or"
          compact
          :active-id="slideoverOpen ? selectedAdId : null"
          @select="openAd"
        />
      </div>

      <UEmpty
        v-if="builds.length === 0"
        icon="i-lucide-chart-no-axes-combined"
        title="order นี้ยังไม่มี build"
        description="เมื่อมี build ที่เผยแพร่แล้ว รายงานจะขึ้นที่นี่"
        data-testid="or-empty"
      />
    </template>

    <UModal
      v-model:open="confirmOpen"
      title="ปิดการติดตามรายงาน?"
      description="ระบบจะหยุดดึงยอดของ advertiser นี้จนกว่าจะเปิดใหม่ ข้อมูลเดิมยังอยู่ครบ"
      :content="confirmContent"
      :ui="{ content: 'max-w-md' }"
    >
      <template #body>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            data-testid="or-confirm-cancel"
            @click="confirmOpen = false"
          />
          <UButton
            label="ปิดการติดตาม"
            color="error"
            :loading="!!toggling"
            data-testid="or-confirm-ok"
            @click="confirmToggleOff"
          />
        </div>
      </template>
    </UModal>

    <ReportsAdSlideover
      v-model:open="slideoverOpen"
      :ad-id="selectedAdId"
      :range="range"
      @refreshed="load(true)"
      @closed="focusRow()"
    />
  </div>
</template>
