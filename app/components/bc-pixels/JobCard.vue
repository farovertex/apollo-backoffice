<script setup lang="ts">
/**
 * FEAT-102 — the job card of a panel step (`bpx-job-<install|event|link>[data-status][data-error]`, api-contract
 * §7.4; spec "Every job card shows the job's step + last log while it runs and the Thai text of the fixed error
 * code when it failed, with a ลองใหม่ that repeats the same request"). Pure renderer: the step owns the request and
 * gets `retry` back. `retryable: false` hides the retry button (e.g. superseded pixel, or no request to repeat).
 */
import type { PixelJobView } from '#shared/types/bc-pixels'

const props = withDefaults(defineProps<{
  kind: 'install' | 'event' | 'link'
  job: PixelJobView
  /** code → Thai (install uses the mssg-aware variant) */
  errorText?: (code: string | null | undefined) => string
  retryable?: boolean
  retrying?: boolean
  /** shown but not pressable (e.g. the request to repeat is not known yet); the text is the hint under the card */
  retryBlockedHint?: string | null
}>(), {
  errorText: undefined,
  retryable: true,
  retrying: false,
  retryBlockedHint: null
})

const emit = defineEmits<{ retry: [] }>()

const open = computed(() => isPixelJobOpen(props.job))
const failed = computed(() => isPixelJobFailed(props.job))
const errorLine = computed(() => {
  if (props.job.status === 'cancelled' && !props.job.error) return 'งานถูกยกเลิก'
  return (props.errorText ?? bcPixelErrorText)(props.job.error)
})
</script>

<template>
  <div
    class="rounded-md border px-3 py-2 text-xs"
    :class="failed ? 'border-error/40 bg-error/5' : open ? 'border-primary/30 bg-primary/5' : 'border-default bg-elevated/40'"
    :data-testid="`bpx-job-${kind}`"
    :data-status="job.status"
    :data-error="job.error ?? ''"
  >
    <div class="flex flex-wrap items-start gap-2">
      <UIcon
        :name="open ? 'i-lucide-loader-circle' : failed ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
        class="mt-0.5 size-4 shrink-0"
        :class="open ? 'animate-spin text-primary' : failed ? 'text-error' : 'text-success'"
      />
      <div class="min-w-0 flex-1 space-y-0.5">
        <p v-if="failed" class="font-medium break-words text-error">
          {{ errorLine }}
        </p>
        <p v-else class="font-medium break-words text-highlighted">
          {{ bcPixelJobProgressText(job) }}
          <span v-if="!open && job.finishedAt" class="font-normal text-muted"> · {{ bcPixelDateTime(job.finishedAt) }}</span>
        </p>
        <p v-if="job.lastLog" class="break-words text-muted">
          {{ job.lastLog }}
        </p>
        <p v-if="failed && retryable && retryBlockedHint" class="break-words text-dimmed">
          {{ retryBlockedHint }}
        </p>
      </div>
      <UButton
        v-if="failed && retryable"
        label="ลองใหม่"
        icon="i-lucide-rotate-ccw"
        color="error"
        variant="soft"
        size="xs"
        class="shrink-0"
        :loading="retrying"
        :disabled="!!retryBlockedHint"
        :title="retryBlockedHint ?? undefined"
        :data-testid="`bpx-job-retry-${kind}`"
        @click="emit('retry')"
      />
    </div>
  </div>
</template>
