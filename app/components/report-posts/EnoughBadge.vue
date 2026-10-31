<script setup lang="ts">
/**
 * FEAT-089 — the "ข้อมูลพอ/รอ" badge of `rp-table` and `rp-setups` (spec "UI behaviour"): green "พอ" or grey
 * "รอ (<approved>/<minBuilds> build)" / "รอ (spend)", tooltip explains which side of the gate is short.
 */
import type { PostReportEnoughWhy, PostReportGate } from '#shared/types/report-posts'

const props = defineProps<{
  enough: boolean
  why: PostReportEnoughWhy
  gate: PostReportGate
  approved: number
}>()

const text = computed(() => enoughBadgeText(props.enough, props.why, props.gate, props.approved))
const title = computed(() => enoughBadgeTitle(props.why, props.gate))
</script>

<template>
  <UBadge
    :color="enough ? 'success' : 'neutral'"
    variant="subtle"
    size="sm"
    data-testid="rp-enough"
    :data-enough="enough ? 'true' : 'false'"
    :title="title"
  >
    {{ text }}
  </UBadge>
</template>
