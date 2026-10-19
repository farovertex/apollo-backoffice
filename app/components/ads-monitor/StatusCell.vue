<script setup lang="ts">
/**
 * FEAT-056 — `am-status` (spec "UI behaviour" → Status cell). Coloured dot + Thai label of `status.key`,
 * a secondary line with the translated `status.reasons[]` (one map, `app/utils/reports.ts`) and a `title`
 * carrying the **raw** TikTok strings, so nothing is lost in translation.
 *
 * `data-key` is the classified key, `data-primary` the raw primary status — both are what QA asserts on.
 *
 * TASK-campaign-delete-ui — the API's new top-priority key `deleted` is rendered as a neutral **badge**
 * (`am-status-label` stays the element carrying the text, so nothing that asserted on it breaks) with the
 * deletion time underneath (`am-status-deleted-at`, `dd MMM HH:mm` local). Same on all three tabs: group and
 * ad rows of a deleted campaign carry `status.key = 'deleted'` + `deletedAt` as well.
 */
import type { MonitorStatus } from '#shared/types/ads-monitor'

const props = defineProps<{
  status: MonitorStatus
  /** `MonitorRow.deletedAt` — only read when `status.key === 'deleted'` */
  deletedAt?: string | null
}>()

const isDeleted = computed(() => props.status.key === 'deleted')
const deletedAtText = computed(() => formatDayMonthClock(props.deletedAt))
const label = computed(() => monitorStatusLabel(props.status.key, props.status.primary))
const dot = computed(() => monitorStatusDot(props.status.key, props.status.primary))
const textClass = computed(() => monitorStatusText(props.status.key))
const reasons = computed(() => monitorReasonTexts(props.status.reasons))
const title = computed(() => monitorStatusTitle(props.status))
</script>

<template>
  <span
    class="flex min-w-0 flex-col gap-0.5"
    data-testid="am-status"
    :data-key="status.key"
    :data-primary="status.primary"
    :title="title"
  >
    <UBadge
      v-if="isDeleted"
      color="neutral"
      variant="subtle"
      size="sm"
      icon="i-lucide-trash-2"
      :label="label"
      class="w-fit"
      data-testid="am-status-label"
    />
    <span v-else class="flex items-center gap-1.5 whitespace-nowrap">
      <span class="size-2 shrink-0 rounded-full" :class="dot" />
      <span :class="textClass" data-testid="am-status-label">{{ label }}</span>
    </span>

    <span
      v-if="isDeleted"
      class="text-xs whitespace-nowrap text-muted"
      data-testid="am-status-deleted-at"
    >{{ deletedAtText }}</span>

    <span
      v-if="reasons.length > 0"
      class="max-w-32 truncate text-xs text-muted"
      data-testid="am-status-reasons"
    >{{ reasons.join(' · ') }}</span>
  </span>
</template>
