<script setup lang="ts">
/**
 * FEAT-102 — step 4 "ผูกบัญชีโฆษณา" (spec "UI behaviour → Panel" 4). B1 renders the summary line
 * (`bpx-link-summary[data-linked][data-total]`) and the link / unlink job card; the account picker
 * (`bpx-link-open` → `AccountsPicker`), unlink and the retry of the job card are task B2 (AC-25).
 */
import type { PixelView } from '#shared/types/bc-pixels'

const props = defineProps<{
  pixel: PixelView
}>()

const job = computed(() => props.pixel.jobs.link)
const showJob = computed(() => {
  const j = job.value
  return !!j && (isPixelJobOpen(j) || isPixelJobFailed(j))
})
</script>

<template>
  <div class="space-y-3">
    <p
      class="text-highlighted"
      data-testid="bpx-link-summary"
      :data-linked="pixel.linkedCount"
      :data-total="pixel.advertiserCount"
    >
      {{ bcPixelLinkSummary(pixel.linkedCount, pixel.advertiserCount) }}
    </p>
    <p v-if="pixel.linkedSyncedAt" class="text-xs text-muted">
      อ่านจาก BC ล่าสุด {{ bcPixelDateTime(pixel.linkedSyncedAt) }}
    </p>

    <BcPixelsJobCard
      v-if="job && showJob"
      kind="link"
      :job="job"
      :retryable="false"
    />
  </div>
</template>
