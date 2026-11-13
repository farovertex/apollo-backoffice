<script setup lang="ts">
/**
 * FEAT-101 M6 (AC-39, contract §4.7; design "Analytics · <site>") — the per-site Analytics panel, inline under the site
 * row of the account card.
 *
 * Opening it and switching the range only READ the stored answer (`GET /mssg-sites/:id/analytics?range=`); a read of
 * mssg happens only when the user presses "ดึงสถิติล่าสุด" (`POST …/analytics { range }` → 202 site view, job
 * `mssgAnalytics`). The job is followed with `GET /mssg-sites/:id` every 2 s (`useMssgPoll`); on `done` the stored answer
 * of the range is read again. A failed read keeps the numbers on screen and shows the Thai text of the job's error code.
 * Every request uses `useApi()` with `retry: 0` (a retry would queue a second job). `data: null` → the empty text.
 */
import type { MssgAnalyticsBody, MssgAnalyticsRange, MssgAnalyticsView, MssgSiteView } from '#shared/types/mssg-sites'

const props = defineProps<{
  siteId: string
  siteName: string
}>()
const emit = defineEmits<{
  /** a read was ordered / ended: the page re-reads the account (its job is open meanwhile, AC-19) */
  changed: []
  close: []
}>()

const api = useApi()

const range = ref<MssgAnalyticsRange>('week')
/** stored answers per range (kept when the user switches back and forth) */
const views = ref<Partial<Record<MssgAnalyticsRange, MssgAnalyticsView>>>({})
const loading = ref(false)
const loadError = ref('')
const requestError = ref('')
const requesting = ref(false)
const showDetail = ref(false)
/** range whose job is open (the button is disabled meanwhile) */
const runningRange = ref<MssgAnalyticsRange | null>(null)
const runningJob = ref<MssgSiteView['job']>(null)

const data = computed(() => views.value[range.value]?.data ?? null)
const rangeInfo = computed(() => mssgAnalyticsRange(range.value))
const running = computed(() => runningRange.value !== null)

const visitsDelta = computed(() => data.value
  ? mssgDelta(data.value.current.visits, data.value.previous.visits, rangeInfo.value.previous, 'ครั้ง', { withPct: true })
  : null)
const clicksDelta = computed(() => data.value
  ? mssgDelta(data.value.current.clicks, data.value.previous.clicks, rangeInfo.value.previous, 'ครั้ง', { withPct: true })
  : null)
const rateDelta = computed(() => data.value
  ? mssgDelta(mssgPercent(data.value.current.clickRate), mssgPercent(data.value.previous.clickRate), rangeInfo.value.previous, 'จุด', { digits: 1 })
  : null)
const buttons = computed(() => data.value ? mssgAnalyticsButtons(data.value) : [])
const maxButton = computed(() => Math.max(1, ...buttons.value.map(b => b.value)))
const detailRows = computed(() => data.value ? [...data.value.current.items].sort((a, b) => b.value - a.value) : [])

async function load(r: MssgAnalyticsRange, opts: { quiet?: boolean } = {}) {
  if (!opts.quiet) loading.value = true
  loadError.value = ''
  try {
    const v = await api<MssgAnalyticsView>(`/mssg-sites/${encodeURIComponent(props.siteId)}/analytics`, { query: { range: r }, retry: 0 })
    views.value = { ...views.value, [r]: v }
  } catch {
    if (!views.value[r]) loadError.value = MSSG_ANALYTICS_TEXT.loadFailed
  } finally {
    loading.value = false
  }
}

function pick(r: MssgAnalyticsRange) {
  range.value = r
  showDetail.value = false
  if (!views.value[r]) void load(r)
}

const poll = useMssgPoll<MssgSiteView>({
  read: id => api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(id)}`, { retry: 0 }),
  onUpdate: (v) => {
    runningJob.value = v.job
  },
  needsPoll: v => mssgJobIsOpen(v.job),
  onEnd: (v) => {
    const r = runningRange.value
    runningRange.value = null
    runningJob.value = null
    if (v.job?.type === 'mssgAnalytics' && v.job.status === 'failed') {
      requestError.value = mssgErrorText(v.lastError?.code)
    } else if (r) {
      requestError.value = ''
    }
    if (r) void load(r, { quiet: true })
    emit('changed')
  },
  onGone: () => {
    runningRange.value = null
    runningJob.value = null
    requestError.value = 'ไม่พบเว็บนี้แล้ว'
  },
  onTimeout: () => {
    runningRange.value = null
    runningJob.value = null
    requestError.value = MSSG_POLL_TIMEOUT_TEXT
  }
})

async function refresh() {
  if (requesting.value || running.value) return
  requesting.value = true
  requestError.value = ''
  const r = range.value
  try {
    const v = await api<MssgSiteView>(`/mssg-sites/${encodeURIComponent(props.siteId)}/analytics`, {
      method: 'POST',
      body: { range: r } satisfies MssgAnalyticsBody,
      retry: 0
    })
    runningRange.value = r
    runningJob.value = v.job
    poll.follow(props.siteId)
    emit('changed')
  } catch (e) {
    requestError.value = mssgFailure(e, MSSG_ANALYTICS_TEXT.requestFailed).message
  } finally {
    requesting.value = false
  }
}

onMounted(() => load(range.value))
</script>

<template>
  <section
    class="flex min-w-0 basis-full flex-col gap-3 rounded-md border border-default bg-default p-3"
    data-testid="an-panel"
    :data-range="range"
    :data-running="running ? 'true' : 'false'"
    :aria-label="`Analytics · ${siteName}`"
  >
    <header class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <h4 class="min-w-0 flex-1 basis-40 text-sm font-semibold break-words text-highlighted" data-testid="an-title">
        Analytics · {{ siteName }}
      </h4>
      <div class="flex flex-wrap items-center gap-1" role="group" aria-label="ช่วงเวลา">
        <UButton
          v-for="r in MSSG_ANALYTICS_RANGES"
          :key="r.value"
          :label="r.label"
          size="xs"
          :color="range === r.value ? 'primary' : 'neutral'"
          :variant="range === r.value ? 'soft' : 'outline'"
          :aria-pressed="range === r.value"
          :data-active="range === r.value ? 'true' : 'false'"
          :data-testid="`an-range-${r.value}`"
          @click="pick(r.value)"
        />
      </div>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="xs"
        aria-label="ปิด Analytics"
        title="ปิด"
        data-testid="an-close"
        @click="emit('close')"
      />
    </header>

    <p v-if="loading && !views[range]" class="text-xs text-muted" data-testid="an-loading">
      กำลังโหลดตัวเลข…
    </p>
    <UAlert
      v-if="loadError"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="loadError"
      data-testid="an-load-error"
      :actions="[{ label: 'ลองใหม่', color: 'neutral', variant: 'outline', size: 'xs', onClick: () => load(range) }]"
    />

    <template v-if="data">
      <p class="text-sm break-words text-toned" data-testid="an-summary">
        {{ mssgAnalyticsSummary(range, data) }}
      </p>
      <p class="text-xs text-muted" data-testid="an-dates">
        {{ mssgAnalyticsDate(data.from) }}<template v-if="data.from !== data.to">
          – {{ mssgAnalyticsDate(data.to) }}
        </template>
        <span class="text-dimmed"> · เทียบกับ{{ rangeInfo.previous }}</span>
      </p>

      <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div class="flex min-w-0 flex-col gap-1 rounded-md border border-default p-2.5" data-testid="an-visits">
          <span class="text-xs text-muted">{{ MSSG_ANALYTICS_TEXT.visits }}</span>
          <span class="text-2xl font-semibold text-highlighted tabular-nums" data-testid="an-visits-value">{{ data.current.visits.toLocaleString('th-TH') }}</span>
          <span
            class="text-xs break-words"
            :class="visitsDelta!.trend === 'up' ? 'text-success' : visitsDelta!.trend === 'down' ? 'text-warning' : 'text-muted'"
            :data-trend="visitsDelta!.trend"
            data-testid="an-delta-visits"
          >{{ visitsDelta!.text }}</span>
        </div>
        <div class="flex min-w-0 flex-col gap-1 rounded-md border border-default p-2.5" data-testid="an-clicks">
          <span class="text-xs text-muted">{{ MSSG_ANALYTICS_TEXT.clicks }}</span>
          <span class="text-2xl font-semibold text-highlighted tabular-nums" data-testid="an-clicks-value">{{ data.current.clicks.toLocaleString('th-TH') }}</span>
          <span
            class="text-xs break-words"
            :class="clicksDelta!.trend === 'up' ? 'text-success' : clicksDelta!.trend === 'down' ? 'text-warning' : 'text-muted'"
            :data-trend="clicksDelta!.trend"
            data-testid="an-delta-clicks"
          >{{ clicksDelta!.text }}</span>
        </div>
        <div class="flex min-w-0 flex-col gap-1 rounded-md border border-default p-2.5" data-testid="an-rate">
          <span class="text-xs text-muted">{{ MSSG_ANALYTICS_TEXT.rate }}</span>
          <span class="text-2xl font-semibold text-highlighted tabular-nums" data-testid="an-rate-value">{{ mssgPercentText(data.current.clickRate) }}</span>
          <span
            class="text-xs break-words"
            :class="rateDelta!.trend === 'up' ? 'text-success' : rateDelta!.trend === 'down' ? 'text-warning' : 'text-muted'"
            :data-trend="rateDelta!.trend"
            data-testid="an-delta-rate"
          >{{ rateDelta!.text }}</span>
        </div>
      </div>

      <div class="flex flex-col gap-1.5" data-testid="an-buttons">
        <h5 class="text-xs font-semibold text-highlighted">
          {{ MSSG_ANALYTICS_TEXT.buttons }}
        </h5>
        <p v-if="!buttons.length" class="text-xs text-muted" data-testid="an-buttons-empty">
          {{ MSSG_ANALYTICS_TEXT.noButtons }}
        </p>
        <ul v-else class="flex flex-col gap-1.5">
          <li
            v-for="b in buttons"
            :key="`${b.action}-${b.key}`"
            class="flex flex-col gap-0.5"
            data-testid="an-button-row"
            :data-action="b.action"
          >
            <span class="flex items-baseline justify-between gap-2 text-xs">
              <span class="min-w-0 break-words text-toned">{{ b.label || mssgAnalyticsActionLabel(b) }}</span>
              <span class="shrink-0 text-muted tabular-nums">{{ b.value.toLocaleString('th-TH') }}</span>
            </span>
            <span class="block h-1.5 rounded-full bg-elevated" aria-hidden="true">
              <span class="block h-full rounded-full bg-primary" :style="{ width: `${Math.max(4, Math.round((b.value / maxButton) * 100))}%` }" />
            </span>
          </li>
        </ul>
      </div>

      <div class="flex flex-col gap-1.5">
        <UButton
          :label="MSSG_ANALYTICS_TEXT.detail"
          :icon="showDetail ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          color="neutral"
          variant="ghost"
          size="xs"
          class="self-start"
          :aria-expanded="showDetail"
          data-testid="an-detail-toggle"
          @click="showDetail = !showDetail"
        />
        <ul v-if="showDetail" class="flex flex-col divide-y divide-default rounded-md border border-default" data-testid="an-detail">
          <li v-if="!detailRows.length" class="px-2.5 py-2 text-xs text-muted">
            ไม่มีรายการ
          </li>
          <li
            v-for="row in detailRows"
            :key="`${row.action}-${row.key}`"
            class="flex items-baseline justify-between gap-3 px-2.5 py-1.5 text-xs"
            data-testid="an-detail-row"
            :data-action="row.action"
          >
            <span class="min-w-0 break-words text-toned">
              {{ mssgAnalyticsActionLabel(row) }}<template v-if="row.action !== 'page.view' && row.label"> · {{ row.label }}</template>
            </span>
            <span class="shrink-0 text-highlighted tabular-nums">{{ row.value.toLocaleString('th-TH') }}</span>
          </li>
        </ul>
      </div>
    </template>
    <p
      v-else-if="!loading && !loadError"
      class="rounded-md border border-dashed border-default px-3 py-4 text-center text-sm text-muted"
      data-testid="an-empty"
    >
      {{ MSSG_ANALYTICS_TEXT.empty }}
    </p>

    <UAlert
      v-if="requestError"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="requestError"
      data-testid="an-error"
    />

    <footer class="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-default pt-2">
      <UButton
        :label="MSSG_ANALYTICS_TEXT.refresh"
        icon="i-lucide-refresh-cw"
        color="primary"
        variant="soft"
        size="xs"
        :loading="requesting"
        :disabled="running || requesting"
        :title="running ? mssgJobProgressText(runningJob) : `ดึงสถิติของช่วง ${rangeInfo.label} จาก mssg`"
        data-testid="an-refresh"
        @click="refresh"
      />
      <span
        v-if="running"
        class="text-xs text-muted"
        role="status"
        data-testid="an-progress"
      >
        {{ mssgJobTypeText('mssgAnalytics') }} · {{ mssgJobProgressText(runningJob) }}
      </span>
      <span class="text-xs text-muted" data-testid="an-read-at">
        <template v-if="data">อัปเดตล่าสุด {{ formatDateTime(data.readAt) }}</template>
        <template v-else>{{ MSSG_ANALYTICS_TEXT.neverRead }}</template>
      </span>
    </footer>
  </section>
</template>
