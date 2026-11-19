<script setup lang="ts">
/**
 * FEAT-102 — the frame of one of the panel's five step cards: `bpx-step-<key>[data-state]` (api-contract §7.4),
 * number / state icon, title, state text, and the step's own content in the default slot. `state` is
 * `PixelView.steps[key]` as the API derived it; the card never computes it.
 */
import type { PixelStepKey, PixelStepState } from '#shared/types/bc-pixels'

const props = defineProps<{
  stepKey: PixelStepKey
  index: number
  state: PixelStepState
}>()

const STATE_COLOR: Record<PixelStepState, 'success' | 'primary' | 'neutral' | 'error'> = {
  done: 'success',
  current: 'primary',
  todo: 'neutral',
  running: 'primary',
  failed: 'error'
}

const frame = computed(() => {
  switch (props.state) {
    case 'current': return 'border-primary/50 bg-primary/5'
    case 'running': return 'border-primary/50'
    case 'failed': return 'border-error/50'
    default: return 'border-default'
  }
})
</script>

<template>
  <section
    class="rounded-lg border p-3 sm:p-4"
    :class="frame"
    :data-testid="`bpx-step-${stepKey}`"
    :data-state="state"
  >
    <header class="flex items-start gap-2">
      <span
        class="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
        :class="{
          'bg-success text-inverted': state === 'done',
          'bg-primary text-inverted': state === 'current' || state === 'running',
          'bg-error text-inverted': state === 'failed',
          'bg-elevated text-muted': state === 'todo'
        }"
      >
        <UIcon v-if="state === 'done'" name="i-lucide-check" class="size-3.5" />
        <UIcon v-else-if="state === 'running'" name="i-lucide-loader-circle" class="size-3.5 animate-spin" />
        <UIcon v-else-if="state === 'failed'" name="i-lucide-x" class="size-3.5" />
        <template v-else>{{ index }}</template>
      </span>
      <h3 class="min-w-0 flex-1 pt-0.5 text-sm font-semibold text-highlighted">
        {{ BC_PIXEL_STEP_TITLE[stepKey] }}
      </h3>
      <UBadge
        :color="STATE_COLOR[state]"
        variant="subtle"
        size="sm"
        class="shrink-0 whitespace-nowrap"
      >
        {{ BC_PIXEL_STEP_STATE_TEXT[state] }}
      </UBadge>
    </header>
    <div class="mt-2 space-y-3 pl-8 text-sm">
      <slot />
    </div>
  </section>
</template>
