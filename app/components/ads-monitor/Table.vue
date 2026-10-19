<script setup lang="ts">
/**
 * FEAT-056 — `am-table`: one table component for all three tabs (spec "UI behaviour" → table). The column
 * **set** is chosen by `level`, the rendering of a column is shared, so the Campaign / Ad group / Ad tabs can
 * never drift apart in formatting. No client sort (the API fixes the order), no client sum: the footer
 * `am-total` always prints the response's `totals` (AC-20).
 *
 * Like `ReportBannedTable` this is a plain `<table>` inside an `overflow-x-auto` wrapper — the **table**
 * scrolls sideways on tablet/mobile, the page never does (AC-24).
 */
import type { MonitorLevel, MonitorRow, ToggleTarget } from '#shared/types/ads-monitor'
import type { KpiMetrics } from '#shared/types/reports'

const props = defineProps<{
  level: MonitorLevel
  rows: MonitorRow[]
  totals: KpiMetrics
  pending?: boolean
}>()

const emit = defineEmits<{ toggle: [row: MonitorRow, target: ToggleTarget] }>()

type Align = 'left' | 'right'
type Format = 'int' | 'dec' | 'pct'

interface Column {
  key: string
  label: string
  align: Align
  /** set on the metric columns only — everything before the first of them is the Total row's label cell */
  metric?: keyof KpiMetrics
  format?: Format
}

/** Spend · CPC · CPM · Impressions · Clicks · CTR · Conversions · CPA · CVR — identical on the three tabs. */
const METRIC_COLUMNS: Column[] = [
  { key: 'spend', label: 'Spend', align: 'right', metric: 'spend', format: 'dec' },
  { key: 'cpc', label: 'CPC', align: 'right', metric: 'cpc', format: 'dec' },
  { key: 'cpm', label: 'CPM', align: 'right', metric: 'cpm', format: 'dec' },
  { key: 'impressions', label: 'Impressions', align: 'right', metric: 'impressions', format: 'int' },
  { key: 'clicks', label: 'Clicks', align: 'right', metric: 'clicks', format: 'int' },
  { key: 'ctr', label: 'CTR', align: 'right', metric: 'ctr', format: 'pct' },
  { key: 'conversions', label: 'Conversions', align: 'right', metric: 'conversions', format: 'int' },
  { key: 'conversionCost', label: 'CPA', align: 'right', metric: 'conversionCost', format: 'dec' },
  { key: 'conversionRate', label: 'CVR', align: 'right', metric: 'conversionRate', format: 'pct' }
]

const HEAD: Column[] = [
  { key: 'switch', label: 'On/off', align: 'left' },
  { key: 'name', label: 'ชื่อ', align: 'left' },
  { key: 'status', label: 'สถานะ', align: 'left' }
]

const COLUMNS: Record<MonitorLevel, Column[]> = {
  campaign: [
    ...HEAD,
    { key: 'account', label: 'บัญชี / advertiser', align: 'left' },
    { key: 'order', label: 'Order', align: 'left' },
    { key: 'budget', label: 'งบประมาณ', align: 'right' },
    ...METRIC_COLUMNS,
    { key: 'adCount', label: 'โฆษณา', align: 'right' }
  ],
  adGroup: [
    ...HEAD,
    { key: 'campaign', label: 'แคมเปญ', align: 'left' },
    { key: 'account', label: 'บัญชี / advertiser', align: 'left' },
    { key: 'order', label: 'Order', align: 'left' },
    { key: 'budget', label: 'งบประมาณ', align: 'right' },
    { key: 'bid', label: 'Bid', align: 'left' },
    { key: 'schedule', label: 'ตารางเวลา', align: 'left' },
    ...METRIC_COLUMNS
  ],
  ad: [
    ...HEAD,
    { key: 'source', label: 'Source', align: 'left' },
    { key: 'adGroup', label: 'กลุ่มโฆษณา', align: 'left' },
    { key: 'account', label: 'บัญชี / advertiser', align: 'left' },
    { key: 'order', label: 'Order', align: 'left' },
    ...METRIC_COLUMNS
  ]
}

const columns = computed(() => COLUMNS[props.level])
/** the Total row's label cell spans everything in front of the first metric column */
const labelSpan = computed(() => {
  const index = columns.value.findIndex(column => column.metric)
  return index < 0 ? columns.value.length : index
})
const footColumns = computed(() => columns.value.slice(labelSpan.value))

function formatMetric(value: number | null, format: Format | undefined): string {
  if (format === 'int') return formatInt(value)
  if (format === 'pct') return formatPercent(value)
  return formatDecimal(value)
}

function accountLabel(row: MonitorRow): string {
  return row.account.label || `บัญชี ${last4(row.account.id)}`
}

function budgetText(row: MonitorRow): string {
  return formatDecimal(row.budget?.amount ?? null)
}

function bidText(row: MonitorRow): string {
  return row.bid?.pricing || row.bid?.strategy || REPORT_DASH
}

function bidTitle(row: MonitorRow): string {
  const parts = [row.bid?.strategy, row.bid?.pricing, row.bid?.optimizeGoal].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : ''
}

function scheduleText(row: MonitorRow): string {
  const schedule = row.schedule
  if (!schedule) return REPORT_DASH
  if (schedule.text) return schedule.text
  if (schedule.startAt || schedule.endAt) {
    return `${formatDateTime(schedule.startAt)} → ${formatDateTime(schedule.endAt)}`
  }
  return REPORT_DASH
}
</script>

<template>
  <div class="min-w-0 overflow-x-auto" data-testid="am-table" :data-level="level">
    <table class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr class="bg-elevated/50">
          <th
            v-for="(column, index) in columns"
            :key="column.key"
            scope="col"
            class="border-y border-default px-2 py-2 font-semibold whitespace-nowrap text-highlighted"
            :class="[
              column.align === 'right' ? 'text-right' : 'text-left',
              index === 0 ? 'rounded-l-lg border-l' : '',
              index === columns.length - 1 ? 'rounded-r-lg border-r' : ''
            ]"
            :data-field="column.key"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>

      <tbody :class="pending ? 'opacity-60' : ''">
        <tr
          v-for="row in rows"
          :key="`${row.level}:${row.id}`"
          data-testid="am-row"
          :data-id="row.id"
          :data-level="row.level"
          :data-advertiser="row.advertiser.id"
        >
          <td
            v-for="column in columns"
            :key="column.key"
            class="border-b border-default px-2 py-2 align-top"
            :class="column.align === 'right' ? 'text-right tabular-nums' : ''"
            :data-field="column.key"
          >
            <template v-if="column.metric">
              {{ formatMetric(row.metrics[column.metric], column.format) }}
            </template>

            <AdsMonitorSwitchCell
              v-else-if="column.key === 'switch'"
              :row="row"
              @toggle="(target) => emit('toggle', row, target)"
            />

            <div v-else-if="column.key === 'name'" class="flex min-w-0 items-center gap-2">
              <span
                v-if="level === 'ad'"
                class="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated"
                data-testid="am-thumb"
                :data-kind="row.media?.isVideo ? 'video' : 'image'"
              >
                <img
                  v-if="row.media?.coverUrl"
                  :src="row.media.coverUrl"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  class="size-full object-cover"
                >
                <UIcon
                  v-else
                  :name="row.media?.isVideo ? 'i-lucide-play' : 'i-lucide-image'"
                  class="size-4 text-dimmed"
                />
              </span>
              <span class="flex min-w-0 flex-col" data-testid="am-row-name">
                <span class="max-w-40 truncate" :title="row.name ?? ''">{{ row.name || REPORT_DASH }}</span>
                <span class="text-xs text-muted" :title="row.id">{{ row.id || REPORT_DASH }}</span>
              </span>
            </div>

            <AdsMonitorStatusCell v-else-if="column.key === 'status'" :status="row.status" />

            <span
              v-else-if="column.key === 'campaign'"
              class="block max-w-32 truncate"
              :title="row.campaign?.name ?? ''"
              data-testid="am-row-campaign"
            >{{ row.campaign?.name || REPORT_DASH }}</span>

            <span
              v-else-if="column.key === 'adGroup'"
              class="flex min-w-0 flex-col"
              data-testid="am-row-adgroup"
            >
              <span class="max-w-32 truncate" :title="row.adGroup?.name ?? ''">{{ row.adGroup?.name || REPORT_DASH }}</span>
              <span class="text-xs text-muted">{{ row.adGroup?.id || REPORT_DASH }}</span>
            </span>

            <span
              v-else-if="column.key === 'source'"
              class="block max-w-32 truncate"
              :title="row.source ?? ''"
              data-testid="am-row-source"
            >{{ row.source || REPORT_DASH }}</span>

            <span v-else-if="column.key === 'account'" class="flex min-w-0 flex-col" data-testid="am-row-account">
              <span class="max-w-32 truncate" :title="accountLabel(row)">{{ accountLabel(row) }}</span>
              <span class="max-w-32 truncate text-xs text-muted" :title="row.advertiser.tiktokAdvertiserId">
                {{ row.advertiser.name || REPORT_DASH }} {{ last4(row.advertiser.tiktokAdvertiserId) }}
              </span>
            </span>

            <span v-else-if="column.key === 'order'" class="whitespace-nowrap" data-testid="am-row-order">
              <template v-if="row.orderIds.length > 0">
                <ULink :to="`/orders/${row.orderIds[0]}`" class="text-primary">{{ last4(row.orderIds[0]) }}</ULink>
                <span v-if="row.orderIds.length > 1" class="ml-1 text-xs text-muted">+{{ row.orderIds.length - 1 }}</span>
              </template>
              <template v-else>{{ REPORT_DASH }}</template>
            </span>

            <span
              v-else-if="column.key === 'budget'"
              class="whitespace-nowrap"
              :title="row.budget?.mode ?? ''"
              data-testid="am-row-budget"
            >{{ budgetText(row) }}</span>

            <span
              v-else-if="column.key === 'bid'"
              class="block max-w-28 truncate"
              :title="bidTitle(row)"
              data-testid="am-row-bid"
            >{{ bidText(row) }}</span>

            <span
              v-else-if="column.key === 'schedule'"
              class="block max-w-32 truncate"
              :title="scheduleText(row)"
              data-testid="am-row-schedule"
            >{{ scheduleText(row) }}</span>

            <template v-else-if="column.key === 'adCount'">
              {{ formatInt(row.adCount ?? null) }}
            </template>

            <template v-else>
              {{ REPORT_DASH }}
            </template>
          </td>
        </tr>
      </tbody>

      <tfoot>
        <tr data-testid="am-total" class="bg-elevated font-semibold">
          <td :colspan="labelSpan" class="rounded-bl-lg border-t border-l border-default px-2 py-2">
            รวมทั้งหมด
          </td>
          <td
            v-for="(column, index) in footColumns"
            :key="column.key"
            class="border-t border-default px-2 py-2 text-right tabular-nums"
            :class="index === footColumns.length - 1 ? 'rounded-br-lg border-r' : ''"
            :data-field="column.key"
          >
            <template v-if="column.metric">
              {{ formatMetric(totals[column.metric], column.format) }}
            </template>
            <template v-else>
              {{ REPORT_DASH }}
            </template>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
