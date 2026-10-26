<script setup lang="ts">
/** FEAT-069 — "Status now" badge of an account row, shared by both pages (`perfStateBadge()`, contract §6). */
import type { PerfAccountState } from '#shared/types/report-performance'

const props = defineProps<{ state: PerfAccountState, testid: string }>()
const badge = computed(() => perfStateBadge(props.state))
</script>

<template>
  <UBadge
    :label="badge.label"
    :color="badge.color"
    variant="subtle"
    size="sm"
    :data-testid="testid"
    :data-state="state"
  />
</template>
