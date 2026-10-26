<script setup lang="ts">
/** FEAT-069 — one sub-line of a dashboard funnel tile ("CPM 24.69 ▲"), with its own small delta arrow. */
const props = withDefaults(defineProps<{
  label: string
  value: number | null
  previous?: number | null
  format?: 'dec' | 'pct' | 'int'
  lowerIsBetter?: boolean
  testid: string
}>(), { previous: null, format: 'dec', lowerIsBetter: false })

const text = computed(() => {
  if (props.format === 'pct') return formatPercent(props.value)
  return props.format === 'int' ? formatInt(props.value) : formatDecimal(props.value)
})
const delta = computed(() => tileDelta(props.value, props.previous ?? null, props.lowerIsBetter))
const arrow = computed(() => {
  const d = delta.value
  if (!d || d.direction === 'flat') return ''
  return d.direction === 'up' ? '▲' : '▼'
})
</script>

<template>
  <span class="flex items-baseline gap-1 text-xs text-muted" :data-testid="testid" :data-value="value ?? ''">
    <span>{{ label }}</span>
    <span class="tabular-nums text-default">{{ text }}</span>
    <span v-if="arrow" :class="delta?.good ? 'text-success' : 'text-error'">{{ arrow }}</span>
  </span>
</template>
