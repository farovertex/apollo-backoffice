<script setup lang="ts">
/**
 * FEAT-089 — `rp-funnel` of `/reports/posts/:key` (spec "UI behaviour → /reports/posts/:key"): 6 horizontal
 * bars (เผยแพร่ → ผ่านตรวจ → มี spend → มี deposit → รอดถึง D7 → ยังส่งอยู่), width proportional to `published`
 * (AC-18), same bar look as `report-dashboard/FunnelSection.vue` but linear (every step is a build count of
 * the same cohort, no log-scale need).
 */
import type { PostReportFunnel, PostReportRow } from '#shared/types/report-posts'

const props = defineProps<{
  funnel: PostReportFunnel
  row: PostReportRow
}>()

const steps = computed(() => {
  const max = Math.max(1, props.funnel.published)
  return postFunnelSteps(props.funnel).map(s => ({
    ...s,
    width: s.value > 0 ? Math.max(2, (s.value / max) * 100) : 0
  }))
})

const badEndCaption = computed(() => {
  const rejected = props.row.builds.rejected
  const banned = props.row.survival.banned
  const missing = props.row.survival.missing
  return `จบไม่ดี: ปฏิเสธ ${formatInt(rejected)} · แบน ${formatInt(banned)} · หาย ${formatInt(missing)}`
})
</script>

<template>
  <section class="rounded-lg border border-default p-3" data-testid="rp-funnel">
    <div class="mb-1.5 flex items-center justify-end gap-1">
      <ReportsInfoHint id="rp-funnel" :text="REPORT_HELP['rp-funnel']!" />
    </div>
    <ol class="flex flex-col gap-1.5">
      <li
        v-for="s in steps"
        :key="s.key"
        class="grid grid-cols-[6rem_minmax(0,1fr)_3.5rem] items-center gap-2 text-xs sm:grid-cols-[8rem_minmax(0,1fr)_4rem]"
        data-testid="rp-funnel-step"
        :data-step="s.key"
        :data-value="s.value"
      >
        <span class="truncate text-muted">{{ s.label }}</span>
        <span class="flex min-w-0 items-center gap-2">
          <span
            class="h-3 shrink-0 rounded-sm bg-primary/60"
            data-testid="rp-funnel-bar"
            :style="{ width: `${s.width}%` }"
          />
        </span>
        <span class="text-right tabular-nums text-default">{{ formatInt(s.value) }}</span>
      </li>
    </ol>
    <p class="mt-2 text-[11px] text-dimmed" data-testid="rp-funnel-bad">
      {{ badEndCaption }}
    </p>
  </section>
</template>
