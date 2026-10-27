<script setup lang="ts">
/**
 * FEAT-069 — `rf-spend-chart`: plain SVG bars of spend per day inside the spend card (spec A12, to-the-mars
 * `SpendChart`). `mode="trend"` = the 7 days ending at the range end (single-day ranges, captioned
 * "7 วันล่าสุด"), `mode="range"` = `results.spendByDay` ("รายวัน"). The last bar is highlighted.
 */
import type { PerfSpendDay } from '#shared/types/report-performance'

const props = defineProps<{
  days: PerfSpendDay[]
  mode: 'trend' | 'range'
}>()

const W = 600
const H = 96
const PAD = 2

const caption = computed(() => (props.mode === 'trend' ? '7 วันล่าสุด' : 'รายวัน'))
const max = computed(() => Math.max(1, ...props.days.map(d => d.spend)))

const bars = computed(() => {
  const n = props.days.length
  if (n === 0) return []
  const bw = (W - PAD * 2) / n
  return props.days.map((d, i) => {
    const h = d.spend > 0 ? Math.max(2, Math.round((d.spend / max.value) * (H - 4))) : 1
    return {
      day: d.day,
      x: Math.round((PAD + i * bw + bw * 0.12) * 100) / 100,
      y: H - h,
      w: Math.max(1, Math.round(bw * 0.76 * 100) / 100),
      h,
      last: i === n - 1,
      title: `${formatRangeDay(d.day)}: ${formatDecimal(d.spend)}`
    }
  })
})
</script>

<template>
  <figure
    class="relative mt-2 min-w-0"
    data-testid="rf-spend-chart"
    :data-mode="mode"
    :data-points="days.length"
  >
    <ReportsInfoHint id="rf-spend-chart" :text="REPORT_HELP['rf-spend-chart']!" class="absolute right-0 top-0" />
    <svg
      v-if="days.length > 0"
      :viewBox="`0 0 ${W} ${H}`"
      preserveAspectRatio="none"
      class="h-20 w-full"
      role="img"
      :aria-label="`spend ${caption} · ${days.length} วัน`"
    >
      <rect
        v-for="bar in bars"
        :key="bar.day"
        :x="bar.x"
        :y="bar.y"
        :width="bar.w"
        :height="bar.h"
        rx="2"
        :class="bar.last ? 'fill-primary' : 'fill-primary/40'"
      >
        <title>{{ bar.title }}</title>
      </rect>
    </svg>
    <figcaption v-if="days.length > 0" class="mt-1 flex justify-between gap-2 text-[11px] text-dimmed">
      <span class="truncate">{{ formatRangeDay(days[0]!.day) }}</span>
      <span class="truncate">{{ caption }} · สูงสุด {{ formatDecimal(max) }}</span>
      <span class="truncate">{{ formatRangeDay(days[days.length - 1]!.day) }}</span>
    </figcaption>
  </figure>
</template>
