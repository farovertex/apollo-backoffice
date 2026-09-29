<script setup lang="ts">
/**
 * FEAT-020 — one summary tile of `/reports` (api-contract §6.2 `rp-tile-*`). The comparison line is the
 * difference against `previous` (the equal range directly before); it is absent for `range=all`, where the
 * API sends `previous: null`.
 *
 * `lowerIsBetter` flips the colouring for CPA: a rise is shown as worse (and says so in words).
 */
const props = withDefaults(defineProps<{
  testid: string
  label: string
  value: number | null
  previous?: number | null
  /** `int` 1,234 · `dec` 1,234.50 · `pct` 2.71% (a pct tile compares in points, not in percent) */
  format?: 'int' | 'dec' | 'pct'
  /** small caption under the value, e.g. the currency note of the spend tile (spec A8) */
  caption?: string
  lowerIsBetter?: boolean
}>(), {
  previous: null,
  format: 'int',
  caption: undefined,
  lowerIsBetter: false
})

const text = computed(() => {
  if (props.format === 'pct') return formatPercent(props.value)
  return props.format === 'dec' ? formatDecimal(props.value) : formatInt(props.value)
})

const delta = computed(() => tileDelta(props.value, props.previous ?? null, props.lowerIsBetter))

const deltaText = computed(() => {
  const d = delta.value
  if (!d) return null
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '='
  if (d.direction === 'flat') return 'เท่าเดิม'
  if (props.format === 'pct') return `${arrow} ${formatDecimal(Math.abs(d.diff))} pt`
  if (d.percent === null) {
    const abs = props.format === 'dec' ? formatDecimal(Math.abs(d.diff)) : formatInt(Math.abs(d.diff))
    return `${arrow} ${abs}`
  }
  return `${arrow} ${formatDecimal(Math.abs(d.percent))}%`
})

const deltaClass = computed(() => {
  const d = delta.value
  if (!d || d.direction === 'flat') return 'text-muted'
  return d.good ? 'text-success' : 'text-error'
})

const worseNote = computed(() => (delta.value && !delta.value.good && props.lowerIsBetter ? ' (แพงขึ้น)' : ''))
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3"
    :data-testid="testid"
    :data-value="value ?? ''"
  >
    <span class="text-xs text-muted">{{ label }}</span>
    <span class="truncate text-xl font-semibold tabular-nums text-highlighted" :title="text">{{ text }}</span>
    <span v-if="caption" class="text-[11px] text-dimmed">{{ caption }}</span>
    <span
      v-if="deltaText"
      class="text-xs tabular-nums"
      :class="deltaClass"
      data-testid="rp-tile-delta"
    >{{ deltaText }}{{ worseNote }} <span class="text-dimmed">เทียบช่วงก่อน</span></span>
  </div>
</template>
