<script setup lang="ts">
/**
 * FEAT-069 — the chart card of `/reports/dashboard` (`rd-chart`, spec "UI behaviour → /reports/dashboard" 3):
 * the toggle `rd-chart-daily` / `rd-chart-hourly` (URL `?chart=`, owned by the page), the legend
 * `rd-chart-legend`, two unovis panels and the `<details>` table `rd-chart-table` with the same numbers.
 *
 * - daily: spend (bars) + deposit amount (line) on the money panel, registers + depositors on the count panel;
 * - hourly: today's cumulative spend on the money panel, clicks + conversions on the count panel — only when
 *   `hourly !== null`; otherwise the hourly button is disabled with the title "มีเฉพาะเมื่อช่วงรวมวันนี้".
 */
import type { DashboardChart, DashboardDailyPoint, DashboardHourlyPoint } from '#shared/types/report-dashboard'
import type { DashChartPoint, DashChartSeries } from './Chart.client.vue'

const props = defineProps<{
  chart: DashboardChart
  daily: DashboardDailyPoint[]
  hourly: DashboardHourlyPoint[] | null
}>()

defineEmits<{ chart: [value: DashboardChart] }>()

const HOURLY_OFF = 'มีเฉพาะเมื่อช่วงรวมวันนี้'

/** what is drawn: `?chart=hourly` without hourly data shows the daily view */
const mode = computed<DashboardChart>(() => (props.chart === 'hourly' && props.hourly ? 'hourly' : 'daily'))

/** fixed hues (indigo / emerald / sky / amber — the to-the-mars palette) so the four series never share a colour */
const C = {
  spend: '#6366f1',
  deposit: '#10b981',
  registers: '#0ea5e9',
  depositors: '#f59e0b',
  clicks: '#0ea5e9',
  conversions: '#f59e0b'
}

const moneySeries = computed<DashChartSeries[]>(() => mode.value === 'daily'
  ? [
      { key: 'spend', label: 'Spend', color: C.spend, kind: 'bar' },
      { key: 'depositAmount', label: 'ยอดฝาก', color: C.deposit, kind: 'line' }
    ]
  : [{ key: 'spend', label: 'Spend สะสม', color: C.spend, kind: 'line' }])

const countSeries = computed<DashChartSeries[]>(() => mode.value === 'daily'
  ? [
      { key: 'registers', label: 'คนสมัคร', color: C.registers, kind: 'line' },
      { key: 'depositors', label: 'คนฝาก', color: C.depositors, kind: 'line' }
    ]
  : [
      { key: 'clicks', label: 'Clicks สะสม', color: C.clicks, kind: 'line' },
      { key: 'conversions', label: 'Conversions สะสม', color: C.conversions, kind: 'line' }
    ])

const legend = computed(() => [...moneySeries.value, ...countSeries.value])

function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

const points = computed<DashChartPoint[]>(() => mode.value === 'daily'
  ? props.daily.map(d => ({
      label: formatRangeDay(d.day).replace(/ \d{4}$/, ''),
      values: { spend: d.spend, depositAmount: d.depositAmount, registers: d.registers, depositors: d.depositors }
    }))
  : (props.hourly ?? []).map(p => ({
      label: hourLabel(p.h),
      values: { spend: p.spend, clicks: p.clicks, conversions: p.conversions, impressions: p.impressions }
    })))

const tableCols = computed(() => mode.value === 'daily'
  ? [
      { key: 'spend', label: 'Spend', dec: true },
      { key: 'impressions', label: 'Impr', dec: false },
      { key: 'clicks', label: 'Clicks', dec: false },
      { key: 'conversions', label: 'Conv', dec: false },
      { key: 'registers', label: 'สมัคร', dec: false },
      { key: 'depositors', label: 'ฝาก', dec: false },
      { key: 'depositAmount', label: 'ยอดฝาก', dec: true }
    ]
  : [
      { key: 'spend', label: 'Spend', dec: true },
      { key: 'impressions', label: 'Impr', dec: false },
      { key: 'clicks', label: 'Clicks', dec: false },
      { key: 'conversions', label: 'Conv', dec: false }
    ])

const tableRows = computed(() => mode.value === 'daily'
  ? props.daily.map(d => ({ key: d.day, label: formatRangeDay(d.day), values: d as unknown as Record<string, number> }))
  : (props.hourly ?? []).map(p => ({ key: String(p.h), label: hourLabel(p.h), values: p as unknown as Record<string, number> })))
</script>

<template>
  <section
    class="flex min-w-0 flex-col gap-3 rounded-lg border border-default p-3"
    data-testid="rd-chart"
    :data-mode="mode"
    :data-points="points.length"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div
        role="group"
        aria-label="มุมมองกราฟ"
        class="flex gap-1"
        data-testid="rd-chart-toggle"
      >
        <UButton
          label="รายวัน"
          size="xs"
          :color="mode === 'daily' ? 'primary' : 'neutral'"
          :variant="mode === 'daily' ? 'soft' : 'ghost'"
          :aria-pressed="mode === 'daily'"
          data-testid="rd-chart-daily"
          @click="$emit('chart', 'daily')"
        />
        <UButton
          label="วันนี้รายชั่วโมง"
          size="xs"
          :color="mode === 'hourly' ? 'primary' : 'neutral'"
          :variant="mode === 'hourly' ? 'soft' : 'ghost'"
          :aria-pressed="mode === 'hourly'"
          :disabled="hourly === null"
          :title="hourly === null ? HOURLY_OFF : undefined"
          data-testid="rd-chart-hourly"
          @click="$emit('chart', 'hourly')"
        />
      </div>
      <ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" data-testid="rd-chart-legend">
        <li v-for="s in legend" :key="s.key + s.label" class="flex items-center gap-1">
          <span
            class="inline-block shrink-0"
            :class="s.kind === 'bar' ? 'size-2.5 rounded-sm' : 'h-0.5 w-3'"
            :style="{ background: s.color }"
          />
          {{ s.label }}
        </li>
      </ul>
    </div>

    <div
      v-if="points.length === 0"
      class="flex h-44 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted"
      data-testid="rd-chart-empty"
    >
      ยังไม่มีข้อมูลสำหรับช่วงนี้
    </div>
    <template v-else>
      <ReportDashboardChart
        :points="points"
        :series="moneySeries"
        decimals
        :label="`${mode === 'daily' ? 'spend และยอดฝากรายวัน' : 'spend สะสมรายชั่วโมงวันนี้'} · ${points.length} จุด`"
        testid="rd-chart-money"
      />
      <ReportDashboardChart
        :points="points"
        :series="countSeries"
        :label="`${mode === 'daily' ? 'คนสมัครและคนฝากรายวัน' : 'clicks และ conversions สะสมรายชั่วโมงวันนี้'} · ${points.length} จุด`"
        testid="rd-chart-count"
      />
    </template>

    <details class="text-sm" data-testid="rd-chart-table">
      <summary class="cursor-pointer text-xs text-muted">
        ดูเป็นตาราง
      </summary>
      <div class="mt-2 min-w-0 overflow-x-auto">
        <table class="w-full whitespace-nowrap">
          <thead>
            <tr class="border-b border-default text-xs text-muted">
              <th class="px-2 py-1 text-left">
                {{ mode === 'daily' ? 'วัน' : 'ชั่วโมง' }}
              </th>
              <th v-for="c in tableCols" :key="c.key" class="px-2 py-1 text-right">
                {{ c.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in tableRows"
              :key="row.key"
              class="border-b border-default/60"
              data-testid="rd-chart-table-row"
            >
              <td class="px-2 py-1">
                {{ row.label }}
              </td>
              <td v-for="c in tableCols" :key="c.key" class="px-2 py-1 text-right tabular-nums">
                {{ c.dec ? formatDecimal(row.values[c.key]) : formatInt(row.values[c.key]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </section>
</template>
