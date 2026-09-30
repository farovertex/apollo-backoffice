<script setup lang="ts">
/**
 * FEAT-020 — ad slideover (api-contract §6.3). Opened by a row click on `/reports` and on the order Report
 * tab; the two surfaces mount the same component.
 *
 * Requests on open: `GET /reports/ads/:id?range=<the page's range>` and
 * `GET /reports/ads/:id/series?bucket=1h&date=<today>&mode=delta`. The metric switch is pure presentation
 * (a series point already carries the four metrics), so only a change of view / date / mode re-reads the
 * series. Nothing polls here except the fetch-now re-read of `useFetchNow()` (5 s, max 3 min, cleared when
 * the slideover closes or unmounts).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { SlideoverProps } from '@nuxt/ui'
import type {
  AdDetailResponse,
  AdSeriesHourlyResponse,
  AdSeriesResponse,
  ChartMetric,
  ReportRange
} from '#shared/types/reports'
import type { ChartPoint } from './AdChart.client.vue'

const props = defineProps<{
  adId: string | null
  /** the range the calling page shows — `ad.metrics` and `rp-ad-kpis` follow it */
  range: ReportRange
}>()

const emit = defineEmits<{
  /** a fetch-now round finished: the caller reloads its own list */
  refreshed: []
  /** the slideover is fully closed — the caller returns focus to the row */
  closed: []
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const nowMs = useNow({ interval: 30_000 })

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const detail = ref<AdDetailResponse | null>(null)
const series = ref<AdSeriesResponse | null>(null)
const pending = ref(false)
const seriesPending = ref(false)
const error = ref<string | null>(null)
const seriesError = ref<string | null>(null)
let detailSession = 0
let seriesSession = 0

// ── view state ───────────────────────────────────────────────────────────────────────────────────────────────────────
type Tab = 'overview' | 'setup' | 'days'
const tab = ref<Tab>('overview')
const metric = ref<ChartMetric>('spend')
const view = ref<'hourly' | 'daily'>('hourly')
const mode = ref<'delta' | 'cumulative'>('delta')

function todayLocal(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function daysAgoLocal(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const date = ref(todayLocal())

const METRICS: { key: ChartMetric, label: string, decimals: boolean }[] = [
  { key: 'spend', label: 'Spend', decimals: true },
  { key: 'impressions', label: 'Impressions', decimals: false },
  { key: 'clicks', label: 'Clicks', decimals: false },
  { key: 'conversions', label: 'Conversions', decimals: false }
]
const metricMeta = computed(() => METRICS.find(m => m.key === metric.value) ?? METRICS[0]!)

// ── loading ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `silent` = a fetch-now re-read: the panel keeps its content while the request runs */
async function loadDetail(silent = false): Promise<boolean> {
  const id = props.adId
  if (!id) return false
  const s = ++detailSession
  if (!silent) {
    pending.value = true
    error.value = null
  }
  try {
    // retry: 0 — exactly one request per open / range change / tick
    const res = await api<AdDetailResponse>(`/reports/ads/${encodeURIComponent(id)}`, {
      retry: 0,
      query: { range: props.range }
    })
    if (s !== detailSession) return false
    detail.value = res
    error.value = null
    return !!res.tracking?.fetching
  } catch (e) {
    if (s !== detailSession) return false
    const err = e as FetchError<Partial<ApiErrorBody>>
    if (!silent) {
      detail.value = null
      error.value = err.data?.error ?? err.message ?? 'โหลดข้อมูลโฆษณาไม่สำเร็จ'
    }
    return false
  } finally {
    if (s === detailSession && !silent) pending.value = false
  }
}

async function loadSeries() {
  const id = props.adId
  if (!id) return
  const s = ++seriesSession
  seriesPending.value = true
  seriesError.value = null
  try {
    const query = view.value === 'hourly'
      ? { bucket: '1h', date: date.value, mode: mode.value }
      : { bucket: '1d', from: daysAgoLocal(29), to: todayLocal() }
    // retry: 0 — exactly one request per view / date / mode change
    const res = await api<AdSeriesResponse>(`/reports/ads/${encodeURIComponent(id)}/series`, { retry: 0, query })
    if (s !== seriesSession) return
    series.value = res
  } catch (e) {
    if (s !== seriesSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    series.value = null
    seriesError.value = err.data?.error ?? err.message ?? 'โหลดกราฟไม่สำเร็จ'
  } finally {
    if (s === seriesSession) seriesPending.value = false
  }
}

function reset() {
  detailSession++
  seriesSession++
  detail.value = null
  series.value = null
  error.value = null
  seriesError.value = null
  pending.value = false
  seriesPending.value = false
  tab.value = 'overview'
  metric.value = 'spend'
  view.value = 'hourly'
  mode.value = 'delta'
  date.value = todayLocal()
}

const fetchNow = useFetchNow()

// open + adId are set together (open a row) and change together (open a different row while the
// slideover stays open): one `watch` on both sources so the flush that changes either or both of
// them loads exactly once, instead of two separate watchers each reacting to the same flush (BUG-021).
watch([open, () => props.adId], ([isOpen, id], [wasOpen]) => {
  if (isOpen && id) {
    reset()
    void loadDetail()
    void loadSeries()
  } else if (!isOpen && wasOpen) {
    fetchNow.stop()
    reset()
    emit('closed')
  }
})

// the page's range switch while the slideover is open
watch(() => props.range, () => {
  if (open.value) void loadDetail()
})

watch([view, date, mode], () => {
  if (open.value) void loadSeries()
})

onUnmounted(() => {
  detailSession++
  seriesSession++
  fetchNow.stop()
})

// ── fetch now ────────────────────────────────────────────────────────────────────────────────────────────────────────
const tracking = computed(() => detail.value?.tracking ?? null)
const isFetching = computed(() => !!tracking.value?.fetching || fetchNow.watching.value)

function startWatching() {
  fetchNow.watchUntilDone(async () => {
    const stillFetching = await loadDetail(true)
    if (!stillFetching) {
      await loadSeries()
      emit('refreshed')
    }
    return stillFetching
  })
}

async function onFetchNow() {
  const advertiserId = detail.value?.ad?.advertiser?.id
  if (!advertiserId) return
  const res = await fetchNow.request(advertiserId)
  if (!res) return
  await loadDetail(true)
  startWatching()
}

// an advertiser that was already fetching when the slideover opened is watched too
watch(() => tracking.value?.fetching, (fetching, was) => {
  if (fetching && !was && open.value && !fetchNow.watching.value) startWatching()
})

// ── presentation ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ad = computed(() => detail.value?.ad ?? null)

const slideoverContent = computed(() => ({
  'data-testid': 'rp-ad',
  'data-id': props.adId ?? '',
  'data-tab': tab.value,
  'data-state': pending.value ? 'loading' : error.value ? 'error' : 'ready'
}) as SlideoverProps['content'])

const title = computed(() => ad.value?.creativeName || 'โฆษณา')

const chartPoints = computed<ChartPoint[]>(() => {
  const s = series.value
  if (!s) return []
  if (s.bucket === '1h') {
    return s.points.map(p => ({
      label: `${String(p.h).padStart(2, '0')}:00`,
      value: p[metric.value] ?? 0,
      detail: `Spend ${formatDecimal(p.spend)} · Impr. ${formatInt(p.impressions)} · Clicks ${formatInt(p.clicks)} · Conv. ${formatInt(p.conversions)}`
    }))
  }
  return s.points.map(p => ({
    label: p.at.slice(5),
    value: (p.metrics?.[metric.value] as number | null) ?? 0,
    detail: `Spend ${formatDecimal(p.metrics?.spend ?? null)} · Impr. ${formatInt(p.metrics?.impressions ?? null)} · Clicks ${formatInt(p.metrics?.clicks ?? null)} · Conv. ${formatInt(p.metrics?.conversions ?? null)}${p.final ? ' · ปิดยอดแล้ว' : ''}`
  }))
})

const hourlySeries = computed<AdSeriesHourlyResponse | null>(() =>
  series.value && series.value.bucket === '1h' ? series.value : null
)

const chartCaption = computed(() => {
  if (view.value === 'daily') return `${metricMeta.value.label} รายวัน · 30 วันล่าสุด`
  const suffix = mode.value === 'delta' ? 'ต่อชั่วโมง' : 'สะสม'
  return `${metricMeta.value.label} ${suffix} · ${date.value}${hourlySeries.value?.final ? ' · ปิดยอดแล้ว' : ''}`
})

const kpis = computed(() => {
  const m = ad.value?.metrics
  return [
    { key: 'spend', label: 'Spend', text: formatDecimal(m?.spend ?? null) },
    { key: 'impressions', label: 'Impressions', text: formatInt(m?.impressions ?? null) },
    { key: 'clicks', label: 'Clicks', text: formatInt(m?.clicks ?? null) },
    { key: 'ctr', label: 'CTR', text: formatPercent(m?.ctr ?? null) },
    { key: 'conversions', label: 'Conversions', text: formatInt(m?.conversions ?? null) },
    { key: 'cpa', label: 'CPA', text: formatDecimal(m?.conversionCost ?? null) }
  ]
})

const ids = computed(() => [
  { key: 'campaign', label: 'แคมเปญ', value: ad.value?.tiktokCampaignId ?? null },
  { key: 'adGroup', label: 'กลุ่มโฆษณา', value: ad.value?.tiktokAdGroupId ?? null },
  { key: 'creative', label: 'โฆษณา', value: ad.value?.tiktokCreativeId ?? null }
])

const SETUP_LABELS: { key: keyof NonNullable<AdDetailResponse['setup']>, label: string, decimal?: boolean, datetime?: boolean }[] = [
  { key: 'budget', label: 'งบกลุ่มโฆษณา', decimal: true },
  { key: 'budgetMode', label: 'โหมดงบ' },
  { key: 'pricing', label: 'การคิดราคา' },
  { key: 'bidStrategy', label: 'กลยุทธ์บิด' },
  { key: 'optimizeGoal', label: 'เป้าหมายการเพิ่มประสิทธิภาพ' },
  { key: 'optimizationLocation', label: 'ตำแหน่งการเพิ่มประสิทธิภาพ' },
  { key: 'pixelName', label: 'Pixel' },
  { key: 'placement', label: 'ตำแหน่ง' },
  { key: 'location', label: 'พื้นที่' },
  { key: 'age', label: 'อายุ' },
  { key: 'gender', label: 'เพศ' },
  { key: 'languages', label: 'ภาษา' },
  { key: 'schedule', label: 'ตาราง' },
  { key: 'startDeliveryAt', label: 'เริ่มส่ง', datetime: true },
  { key: 'endDeliveryAt', label: 'สิ้นสุด', datetime: true },
  { key: 'pageName', label: 'เพจ' },
  { key: 'pageId', label: 'Page id' },
  { key: 'callToAction', label: 'CTA' },
  { key: 'identityName', label: 'Identity' },
  { key: 'postName', label: 'โพสต์' },
  { key: 'effectNote', label: 'Conversion event' }
]

const setupRows = computed(() => {
  const setup = detail.value?.setup
  if (!setup) return []
  return SETUP_LABELS
    .map((row) => {
      const raw = setup[row.key]
      if (raw === null || raw === undefined || raw === '') return null
      const value = row.decimal && typeof raw === 'number'
        ? formatDecimal(raw)
        : row.datetime
          ? formatDateTime(String(raw))
          : String(raw)
      return { key: row.key as string, label: row.label, value }
    })
    .filter((row): row is { key: string, label: string, value: string } => row !== null)
})

const trackingLine = computed(() => {
  const t = tracking.value
  if (!t) return REPORT_DASH
  const parts = [`ติดตาม: ${ADVERTISER_REPORT_LABEL[t.state] ?? t.state}`]
  parts.push(`ล่าสุด ${t.lastFetchAt ? `${formatClock(t.lastFetchAt)} (${timeAgoTh(t.lastFetchAt, nowMs.value.getTime())})` : REPORT_DASH}`)
  parts.push(`รอบถัดไป ${t.nextFetchAt ? formatClock(t.nextFetchAt) : REPORT_DASH}`)
  const errorText = reportErrorText(t.lastError)
  if (errorText) parts.push(errorText)
  return parts.join(' · ')
})

const toast = useToast()
async function copy(value: string | null) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
    toast.add({ title: 'คัดลอกแล้ว', description: value, color: 'success' })
  } catch {
    toast.add({ title: 'คัดลอกไม่สำเร็จ', description: 'เบราว์เซอร์ปฏิเสธการเข้าถึงคลิปบอร์ด', color: 'error' })
  }
}

const TABS: { key: Tab, label: string }[] = [
  { key: 'overview', label: 'ภาพรวม' },
  { key: 'setup', label: 'การตั้งค่า' },
  { key: 'days', label: 'รายวัน' }
]
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="title"
    :ui="{ content: 'sm:max-w-3xl', body: 'flex flex-col gap-4' }"
    :content="slideoverContent"
  >
    <template #description>
      <span class="block truncate text-xs text-muted" data-testid="rp-ad-title">
        {{ ad?.adGroupName || REPORT_DASH }} · {{ ad?.campaignName || REPORT_DASH }}
      </span>
    </template>

    <template #body>
      <div v-if="pending" class="space-y-3" data-testid="rp-ad-loading">
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-48 w-full" />
        <USkeleton class="h-24 w-full" />
      </div>

      <UAlert
        v-else-if="error"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="โหลดข้อมูลโฆษณาไม่สำเร็จ"
        :description="error"
        data-testid="rp-ad-error"
      >
        <template #actions>
          <UButton
            label="ลองใหม่"
            icon="i-lucide-refresh-cw"
            color="error"
            size="xs"
            data-testid="rp-ad-retry"
            @click="loadDetail()"
          />
        </template>
      </UAlert>

      <template v-else-if="ad">
        <!-- header -->
        <div class="flex flex-wrap items-start gap-3">
          <ReportsAdThumb :url="ad.media?.coverUrl ?? null" :is-video="!!ad.media?.isVideo" size="md" />
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <ReportsLevelPills :status="ad.status" with-text testid="rp-ad-levels" />
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted" data-testid="rp-ad-ids">
              <span v-for="item in ids" :key="item.key" class="inline-flex items-center gap-0.5">
                <span class="text-dimmed">{{ item.label }}</span>
                <span class="font-mono" :data-id-kind="item.key">{{ item.value || REPORT_DASH }}</span>
                <UButton
                  v-if="item.value"
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  :aria-label="`คัดลอก id ${item.label}`"
                  data-testid="rp-ad-id-copy"
                  @click="copy(item.value)"
                />
              </span>
            </div>
          </div>
        </div>

        <!-- tracking + fetch now -->
        <div class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default p-2">
          <span
            class="text-xs text-muted"
            :data-state="tracking?.state ?? 'never'"
            data-testid="rp-ad-tracking"
          >{{ trackingLine }}</span>
          <div class="flex items-center gap-2">
            <span v-if="isFetching" class="text-xs text-muted" data-testid="rp-ad-fetching">กำลังดึงข้อมูล…</span>
            <UButton
              :label="isFetching ? 'กำลังดึงข้อมูล…' : 'ดึงตอนนี้'"
              icon="i-lucide-refresh-cw"
              color="primary"
              size="xs"
              :disabled="isFetching"
              :loading="fetchNow.requesting.value"
              data-testid="rp-ad-fetch"
              @click="onFetchNow"
            />
          </div>
        </div>

        <!-- tabs -->
        <div class="flex gap-1 border-b border-default" role="tablist" aria-label="แท็บโฆษณา">
          <button
            v-for="item in TABS"
            :key="item.key"
            type="button"
            role="tab"
            :aria-selected="tab === item.key"
            class="-mb-px border-b-2 px-3 py-2 text-sm font-medium"
            :class="tab === item.key ? 'border-primary text-highlighted' : 'border-transparent text-muted hover:text-default'"
            :data-testid="`rp-ad-tab-${item.key}`"
            @click="tab = item.key"
          >
            {{ item.label }}
          </button>
        </div>

        <!-- overview -->
        <div v-if="tab === 'overview'" class="flex flex-col gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex flex-wrap gap-1" role="group" aria-label="เมตริก">
              <UButton
                v-for="item in METRICS"
                :key="item.key"
                :label="item.label"
                size="xs"
                :color="metric === item.key ? 'primary' : 'neutral'"
                :variant="metric === item.key ? 'solid' : 'outline'"
                :aria-pressed="metric === item.key"
                :data-testid="`rp-ad-metric-${item.key}`"
                @click="metric = item.key"
              />
            </div>
            <div class="flex flex-wrap gap-1" role="group" aria-label="มุมมอง">
              <UButton
                label="รายชั่วโมง"
                size="xs"
                :color="view === 'hourly' ? 'primary' : 'neutral'"
                :variant="view === 'hourly' ? 'solid' : 'outline'"
                :aria-pressed="view === 'hourly'"
                data-testid="rp-ad-view-hourly"
                @click="view = 'hourly'"
              />
              <UButton
                label="รายวัน"
                size="xs"
                :color="view === 'daily' ? 'primary' : 'neutral'"
                :variant="view === 'daily' ? 'solid' : 'outline'"
                :aria-pressed="view === 'daily'"
                data-testid="rp-ad-view-daily"
                @click="view = 'daily'"
              />
            </div>
            <template v-if="view === 'hourly'">
              <UInput
                v-model="date"
                type="date"
                size="xs"
                aria-label="วันที่"
                data-testid="rp-ad-date"
              />
              <div class="flex flex-wrap gap-1" role="group" aria-label="โหมด">
                <UButton
                  label="ต่อชั่วโมง"
                  size="xs"
                  :color="mode === 'delta' ? 'primary' : 'neutral'"
                  :variant="mode === 'delta' ? 'solid' : 'outline'"
                  :aria-pressed="mode === 'delta'"
                  data-testid="rp-ad-mode-delta"
                  @click="mode = 'delta'"
                />
                <UButton
                  label="สะสม"
                  size="xs"
                  :color="mode === 'cumulative' ? 'primary' : 'neutral'"
                  :variant="mode === 'cumulative' ? 'solid' : 'outline'"
                  :aria-pressed="mode === 'cumulative'"
                  data-testid="rp-ad-mode-cumulative"
                  @click="mode = 'cumulative'"
                />
              </div>
            </template>
          </div>

          <p class="text-xs text-muted" data-testid="rp-ad-chart-caption">
            {{ chartCaption }}
          </p>

          <UAlert
            v-if="seriesError"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โหลดกราฟไม่สำเร็จ"
            :description="seriesError"
            data-testid="rp-ad-series-error"
          />
          <ReportsAdChart
            v-else
            :points="chartPoints"
            :metric-label="metricMeta.label"
            :decimals="metricMeta.decimals"
          />

          <dl class="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="rp-ad-kpis">
            <div v-for="item in kpis" :key="item.key" class="rounded-lg border border-default p-2">
              <dt class="text-xs text-muted">
                {{ item.label }}
              </dt>
              <dd class="text-base font-semibold tabular-nums text-highlighted" :data-kpi="item.key">
                {{ item.text }}
              </dd>
            </div>
          </dl>

          <!-- the same numbers as the chart, for people who read tables -->
          <div class="max-h-48 overflow-y-auto rounded-lg border border-default" data-testid="rp-ad-points">
            <table class="w-full text-xs">
              <thead class="sticky top-0 bg-elevated/80">
                <tr>
                  <th scope="col" class="px-2 py-1 text-left font-semibold text-highlighted">
                    {{ view === 'hourly' ? 'ชั่วโมง' : 'วัน' }}
                  </th>
                  <th scope="col" class="px-2 py-1 text-right font-semibold text-highlighted">
                    {{ metricMeta.label }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="chartPoints.length === 0">
                  <td class="px-2 py-2 text-center text-muted" colspan="2">
                    ยังไม่มีข้อมูล
                  </td>
                </tr>
                <tr
                  v-for="point in chartPoints"
                  :key="point.label"
                  data-testid="rp-ad-point"
                  :data-label="point.label"
                >
                  <td class="px-2 py-1">
                    {{ point.label }}
                  </td>
                  <td class="px-2 py-1 text-right tabular-nums">
                    {{ metricMeta.decimals ? formatDecimal(point.value) : formatInt(point.value) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- setup -->
        <div v-else-if="tab === 'setup'">
          <dl v-if="setupRows.length" class="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="rp-ad-setup">
            <template v-for="row in setupRows" :key="row.key">
              <dt class="text-muted">
                {{ row.label }}
              </dt>
              <dd class="break-words text-highlighted" :data-field="row.key">
                {{ row.value }}
              </dd>
            </template>
          </dl>
          <UEmpty
            v-else
            icon="i-lucide-settings"
            title="ยังไม่มีการตั้งค่าที่อ่านได้"
            description="รอบดึงข้อมูลถัดไปจะบันทึกการตั้งค่าของโฆษณานี้"
            data-testid="rp-ad-setup-empty"
          />
        </div>

        <!-- days -->
        <div v-else class="overflow-x-auto" data-testid="rp-ad-days">
          <table class="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr class="bg-elevated/50">
                <th scope="col" class="rounded-l-lg border-y border-l border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  วัน
                </th>
                <th scope="col" class="border-y border-default px-3 py-2 text-left font-semibold whitespace-nowrap text-highlighted">
                  สถานะ
                </th>
                <th scope="col" class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Spend
                </th>
                <th scope="col" class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Impr.
                </th>
                <th scope="col" class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Clicks
                </th>
                <th scope="col" class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  Conv.
                </th>
                <th scope="col" class="rounded-r-lg border-y border-r border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted">
                  ดึงแล้ว
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="(detail?.days.length ?? 0) === 0">
                <td class="border-b border-default px-3 py-6 text-center text-muted" colspan="7" data-testid="rp-ad-days-empty">
                  ยังไม่มีแถวรายวัน
                </td>
              </tr>
              <tr
                v-for="day in detail?.days ?? []"
                :key="day.periodDate"
                :data-date="day.periodDate"
                :data-final="day.final ? 'true' : 'false'"
                data-testid="rp-ad-day"
              >
                <td class="border-b border-default px-3 py-2 whitespace-nowrap">
                  <span class="text-highlighted">{{ day.periodDate }}</span>
                  <UBadge
                    v-if="day.final"
                    color="neutral"
                    variant="outline"
                    size="sm"
                    class="ml-1 whitespace-nowrap"
                    data-testid="rp-ad-day-final"
                  >
                    ปิดยอดแล้ว
                  </UBadge>
                </td>
                <td class="border-b border-default px-3 py-2">
                  <UBadge
                    v-if="day.state"
                    :color="adStateBadge(day.state).color"
                    variant="subtle"
                    size="sm"
                    class="whitespace-nowrap"
                  >
                    {{ adStateBadge(day.state).label }}
                  </UBadge>
                  <span v-else class="text-muted">{{ REPORT_DASH }}</span>
                </td>
                <td class="border-b border-default px-2 py-2 text-right tabular-nums">
                  {{ formatDecimal(day.metrics?.spend ?? null) }}
                </td>
                <td class="border-b border-default px-2 py-2 text-right tabular-nums">
                  {{ formatInt(day.metrics?.impressions ?? null) }}
                </td>
                <td class="border-b border-default px-2 py-2 text-right tabular-nums">
                  {{ formatInt(day.metrics?.clicks ?? null) }}
                </td>
                <td class="border-b border-default px-2 py-2 text-right tabular-nums">
                  {{ formatInt(day.metrics?.conversions ?? null) }}
                </td>
                <td class="border-b border-default px-2 py-2 text-right tabular-nums">
                  {{ formatInt(day.fetchCount) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-3 text-xs text-muted">
        <span>{{ ad?.workspace?.name || REPORT_DASH }} · {{ ad?.account?.label || REPORT_DASH }} · {{ ad?.advertiser?.name || REPORT_DASH }}</span>
        <UButton
          label="ปิด"
          color="neutral"
          variant="subtle"
          data-testid="rp-ad-close"
          @click="open = false"
        />
      </div>
    </template>
  </USlideover>
</template>
