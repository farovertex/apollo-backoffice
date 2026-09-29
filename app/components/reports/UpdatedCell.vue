<script setup lang="ts">
/**
 * FEAT-020 — "อัปเดต" cell (api-contract §6.2 `rp-row-updated`): a dot plus the time since the advertiser's
 * last successful fetch. `data-level` is `ok` · `late` (older than 2 × `intervalMs`) · `error` (the
 * advertiser carries a `fetchError`, whose Thai text replaces the time).
 */
import type { ReportError } from '#shared/types/reports'

const props = defineProps<{
  lastFetchAt: string | null
  fetchError: ReportError | null
  fetching?: boolean
  intervalMs: number
  nowMs: number
}>()

const level = computed(() => updatedLevel(props.lastFetchAt, props.fetchError, props.intervalMs, props.nowMs))
const errorText = computed(() => reportErrorText(props.fetchError))
const text = computed(() => errorText.value ?? timeAgoTh(props.lastFetchAt, props.nowMs))
const title = computed(() => {
  const when = formatDateTime(props.lastFetchAt)
  return errorText.value ? `${props.fetchError} · ล่าสุด ${when}` : `ล่าสุด ${when}`
})
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap"
    :class="level === 'error' ? 'text-error' : level === 'late' ? 'text-warning' : 'text-muted'"
    :title="title"
    :data-level="level"
    data-testid="rp-row-updated"
  >
    <UIcon
      v-if="fetching"
      name="i-lucide-loader-circle"
      class="size-3.5 shrink-0 animate-spin"
    />
    <span v-else class="size-2 shrink-0 rounded-full" :class="REPORT_DOT_CLASS[level]" />
    <span>{{ text }}</span>
  </span>
</template>
