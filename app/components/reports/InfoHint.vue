<script setup lang="ts">
/**
 * FEAT-069 — T2c: the "i" info hint mounted next to every number of `/reports/performance` and
 * `/reports/dashboard` (human request 2026-10-27, after review: explain where each value comes from and how it
 * is computed — never the filter/workspace mechanics). One shared component: a small ghost button that opens a
 * click-triggered popover (tooltips do not work on touch) with the Thai text from `app/utils/report-help.ts`,
 * keyed by the owner's own test id. Purely presentational — it never touches the owner's id, `data-value` or
 * layout: it is meant to sit inline right after the owner's label, `shrink-0`.
 *
 * `@click.stop.prevent` on the trigger matters on the few owners that are themselves a `NuxtLink` (the "ตอนนี้" /
 * "delivery now" cards): a click's *default action* (the anchor's navigation) is decided by `defaultPrevented`
 * on the event, independent of propagation — only `.prevent` stops it; `.stop` additionally keeps the click from
 * reaching any other row/card click handler.
 */
const props = defineProps<{
  /** the owner's test id, e.g. `rf-tile-spend` — this renders `<id>-info` / `<id>-info-text` */
  id: string
  text: string
}>()
</script>

<template>
  <UPopover>
    <UButton
      variant="ghost"
      color="neutral"
      size="xs"
      icon="i-lucide-info"
      aria-label="วิธีคำนวณ"
      class="shrink-0"
      :data-testid="`${props.id}-info`"
      @click.stop.prevent
    />
    <template #content>
      <p
        class="max-w-[22rem] p-3 text-sm whitespace-pre-line"
        :data-testid="`${props.id}-info-text`"
      >
        {{ text }}
      </p>
    </template>
  </UPopover>
</template>
