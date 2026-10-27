<script setup lang="ts">
/**
 * FEAT-069 — one `@unovis/vue` panel of the dashboard chart card (`rd-chart`): optional bars (one series) +
 * lines (one or more series) on a shared y axis. Client-only like `AdChart.client.vue` (unovis measures the
 * DOM). The card stacks a money panel and a count panel so series of very different scales stay readable; the
 * `<details>` table of the card is the non-chart reading of the same numbers.
 */
import { VisAxis, VisCrosshair, VisLine, VisStackedBar, VisTooltip, VisXYContainer } from '@unovis/vue'

export interface DashChartSeries {
  key: string
  label: string
  /** CSS colour (a Nuxt UI token var) */
  color: string
  kind: 'bar' | 'line'
}

export interface DashChartPoint {
  label: string
  values: Record<string, number>
}

const props = withDefaults(defineProps<{
  points: DashChartPoint[]
  series: DashChartSeries[]
  decimals?: boolean
  label: string
  testid: string
}>(), { decimals: false })

const chartRef = useTemplateRef<HTMLElement | null>('chartRef')
const { width } = useElementSize(chartRef)

const x = (_: DashChartPoint, i: number) => i
const bar = computed(() => props.series.find(s => s.kind === 'bar') ?? null)
const lines = computed(() => props.series.filter(s => s.kind === 'line'))
const barY = computed(() => {
  const key = bar.value?.key
  return key ? (d: DashChartPoint) => d.values[key] ?? 0 : null
})
const lineY = computed(() => lines.value.map(s => (d: DashChartPoint) => d.values[s.key] ?? 0))
const lineColors = computed(() => lines.value.map(s => s.color))
const allY = computed(() => [...(barY.value ? [barY.value] : []), ...lineY.value])

const format = (v: number) => (props.decimals ? formatDecimal(v) : formatInt(v))

const xTickValues = computed(() => {
  const n = props.points.length
  const step = n > 16 ? Math.ceil(n / 8) : n > 8 ? 2 : 1
  // counted back from the last point so the last label is always drawn and never collides with its neighbour
  return props.points.map((_, i) => i).filter(i => (n - 1 - i) % step === 0)
})
const xTicks = (i: number) => props.points[Math.round(i)]?.label ?? ''

const template = (d: DashChartPoint) =>
  [d.label, ...props.series.map(s => `${s.label}: ${format(d.values[s.key] ?? 0)}`)].join('<br>')
</script>

<template>
  <div ref="chartRef" :data-testid="testid" :data-points="points.length">
    <VisXYContainer
      :data="points"
      :padding="{ top: 10, bottom: 4 }"
      :margin="{ left: 0, right: 8 }"
      class="h-44"
      :width="width || undefined"
      role="img"
      :aria-label="label"
    >
      <VisStackedBar
        v-if="barY"
        :x="x"
        :y="[barY]"
        :color="bar?.color"
        :bar-padding="0.25"
        :rounded-corners="3"
      />
      <VisLine
        v-if="lineY.length > 0"
        :x="x"
        :y="lineY"
        :color="lineColors"
      />
      <VisAxis type="y" :tick-format="format" :num-ticks="4" />
      <VisAxis
        type="x"
        :x="x"
        :tick-values="xTickValues"
        :tick-format="xTicks"
      />
      <VisCrosshair :x="x" :y="allY" :template="template" />
      <VisTooltip />
    </VisXYContainer>
  </div>
</template>

<style scoped>
.unovis-xy-container {
  --vis-crosshair-line-stroke-color: var(--ui-border-accented);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
}
</style>
