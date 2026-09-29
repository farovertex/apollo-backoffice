<script setup lang="ts">
/**
 * FEAT-020 — the one chart of the ad slideover (api-contract §6.3 `rp-ad-chart`): **one series, one axis**
 * (the metric switch decides which), line + area, a crosshair tooltip per bucket. Colours are the Nuxt UI
 * tokens (`--ui-primary`, `--ui-border`, `--ui-bg`, `--ui-text-*`) so it reads in light and dark without a
 * second palette — the same trick `HomeChart.client.vue` already uses.
 *
 * Client-only (`.client.vue`): `@unovis/vue` measures the DOM, and the slideover is never rendered on the
 * server anyway. The daily table under the chart is the non-chart reading of exactly these numbers.
 */
import { VisArea, VisAxis, VisCrosshair, VisLine, VisTooltip, VisXYContainer } from '@unovis/vue'

export interface ChartPoint {
  /** x label (hour `09:00` or day `09-29`) */
  label: string
  value: number
  /** the tooltip line under the label */
  detail: string
}

const props = withDefaults(defineProps<{
  points: ChartPoint[]
  /** name of the drawn metric, used by the tooltip and the aria label */
  metricLabel: string
  /** how a value is printed in the tooltip and on the y axis */
  decimals?: boolean
  emptyText?: string
}>(), {
  decimals: false,
  emptyText: 'ยังไม่มีข้อมูลสำหรับช่วงนี้'
})

const chartRef = useTemplateRef<HTMLElement | null>('chartRef')
const { width } = useElementSize(chartRef)

const x = (_: ChartPoint, i: number) => i
const y = (d: ChartPoint) => d.value

const format = (v: number) => (props.decimals ? formatDecimal(v) : formatInt(v))

/** only the first, the last and every 4th tick, so 24 hourly points never overlap */
const xTicks = (i: number) => {
  const point = props.points[i]
  if (!point) return ''
  if (i === 0 || i === props.points.length - 1) return point.label
  return i % 4 === 0 ? point.label : ''
}

const template = (d: ChartPoint) => `${d.label} · ${props.metricLabel} ${format(d.value)}\n${d.detail}`

const ariaLabel = computed(() => `${props.metricLabel} · ${props.points.length} จุด`)
</script>

<template>
  <div ref="chartRef" :data-points="points.length" data-testid="rp-ad-chart">
    <div
      v-if="points.length === 0"
      class="flex h-48 items-center justify-center rounded-lg border border-dashed border-default text-sm text-muted"
      data-testid="rp-ad-chart-empty"
    >
      {{ emptyText }}
    </div>

    <VisXYContainer
      v-else
      :data="points"
      :padding="{ top: 12, bottom: 4 }"
      :margin="{ left: 0, right: 8 }"
      class="h-48"
      :width="width || undefined"
      role="img"
      :aria-label="ariaLabel"
    >
      <VisArea
        :x="x"
        :y="y"
        color="var(--ui-primary)"
        :opacity="0.12"
      />
      <VisLine :x="x" :y="y" color="var(--ui-primary)" />
      <VisAxis type="y" :tick-format="format" :num-ticks="4" />
      <VisAxis type="x" :x="x" :tick-format="xTicks" />
      <VisCrosshair color="var(--ui-primary)" :template="template" />
      <VisTooltip />
    </VisXYContainer>
  </div>
</template>

<style scoped>
.unovis-xy-container {
  --vis-crosshair-line-stroke-color: var(--ui-primary);
  --vis-crosshair-circle-stroke-color: var(--ui-bg);

  --vis-axis-grid-color: var(--ui-border);
  --vis-axis-tick-color: var(--ui-border);
  --vis-axis-tick-label-color: var(--ui-text-dimmed);

  --vis-tooltip-background-color: var(--ui-bg);
  --vis-tooltip-border-color: var(--ui-border);
  --vis-tooltip-text-color: var(--ui-text-highlighted);
}
</style>
