<script setup lang="ts">
/**
 * FEAT-020 — "แนวโน้มวันนี้" cell (api-contract §6.2 `rp-row-spark`): today's per-hour spend deltas as a
 * plain inline SVG (no chart library in a table row). Nothing is rendered when the series is empty, so the
 * testid is absent exactly when `sparkline` is `[]`.
 */
const props = defineProps<{
  values: number[] | null | undefined
  testid?: string
}>()

const path = computed(() => sparklinePath(props.values))
const label = computed(() => `spend ต่อชั่วโมงของวันนี้ · ${props.values?.length ?? 0} จุด`)
</script>

<template>
  <svg
    v-if="path"
    viewBox="0 0 96 28"
    class="h-7 w-24 overflow-visible text-primary"
    role="img"
    :aria-label="label"
    :data-points="values?.length ?? 0"
    :data-testid="testid ?? 'rp-row-spark'"
  >
    <path :d="path.area" fill="currentColor" fill-opacity="0.12" />
    <path
      :d="path.line"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <circle
      :cx="path.lastX"
      :cy="path.lastY"
      r="2"
      fill="currentColor"
    />
  </svg>
</template>
