<script setup lang="ts">
/**
 * FEAT-020 — the three status pills C / G / A (campaign / ad group / ad, api-contract §6.2 `rp-row-levels`
 * and §6.3 `rp-ad-levels`). The colour comes from that level's own raw TikTok string; the raw strings are
 * never translated and are always readable on hover (`title`), because the API stores them in the UI
 * language of the account.
 */
import type { AdStatusBlock } from '#shared/types/reports'

const props = withDefaults(defineProps<{
  status: AdStatusBlock | null
  /** `true` in the slideover header: the raw string is printed next to the letter */
  withText?: boolean
  testid?: string
}>(), {
  withText: false,
  testid: 'rp-row-levels'
})

const levels = computed(() => {
  const s = props.status
  const detail = s?.creativeDetail ?? ''
  return [
    { key: 'C', label: 'แคมเปญ', raw: s?.campaign ?? '', detail: '' },
    { key: 'G', label: 'กลุ่มโฆษณา', raw: s?.adGroup ?? '', detail: '' },
    { key: 'A', label: 'โฆษณา', raw: s?.creative ?? '', detail }
  ].map(level => ({
    ...level,
    color: levelColor(level.raw),
    title: `${level.label}: ${level.raw || REPORT_DASH}${level.detail ? ` · ${level.detail}` : ''}`
  }))
})
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1" :data-testid="testid">
    <UBadge
      v-for="level in levels"
      :key="level.key"
      :color="level.color"
      variant="subtle"
      size="sm"
      class="whitespace-nowrap"
      :title="level.title"
      :data-level="level.key"
      :data-raw="level.raw"
      data-testid="rp-level"
    >
      {{ level.key }}<template v-if="withText">&nbsp;{{ level.raw || REPORT_DASH }}</template>
    </UBadge>
  </span>
</template>
