<script setup lang="ts">
/**
 * FEAT-102 — step 5 "ทำให้เขียว" (spec "UI behaviour → Panel" 5). B1 renders the summary line only: green
 * "เขียวแล้ว (Active) · HH:mm" when the event is Active, else the latest run's status, else what the step needs.
 * The run card (start / stop / resume / retry / verify-only, countdown, `bpx-run-*`) is task B2 (AC-26).
 */
import type { PixelView } from '#shared/types/bc-pixels'

const props = defineProps<{
  pixel: PixelView
}>()

const run = computed(() => props.pixel.latestRun)
</script>

<template>
  <div class="space-y-2">
    <p
      v-if="pixel.eventStatus === 'active'"
      class="flex items-center gap-1.5 font-medium text-success"
    >
      <UIcon name="i-lucide-badge-check" class="size-4" />
      เขียวแล้ว (Active) · {{ bcPixelTime(pixel.event?.activeAt) }}
    </p>
    <p v-else-if="run" class="flex flex-wrap items-center gap-1.5 text-muted">
      <UBadge :color="bcPixelRunColor(run)" variant="subtle" size="sm">
        {{ bcPixelRunStatusText(run) }}
      </UBadge>
      <span v-if="run.status === 'stopped' && run.stopReason">{{ bcPixelRunStopText(run.stopReason) }}</span>
      <span v-else>เริ่ม {{ bcPixelDateTime(run.createdAt) }}</span>
    </p>
    <p v-else-if="!pixel.event" class="text-muted">
      ต้องสร้าง event กดปุ่มก่อน (ขั้นที่ 3)
    </p>
    <p v-else class="text-muted">
      ยังไม่ได้เริ่มทำให้เขียว
    </p>
  </div>
</template>
