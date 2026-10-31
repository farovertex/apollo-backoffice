<script setup lang="ts">
/**
 * FEAT-089 — `rp-byday` of `/reports/posts/:key` (spec "UI behaviour → /reports/posts/:key"): 7 groups of 2
 * CSS-div bars (spend avg / deposit avg per build, day 1..7 after approval). Each metric is normalised to its
 * own max across the 7 days (spend and deposit are different units, so one shared scale would flatten
 * whichever is smaller). Empty text when every `buildsAlive` is 0 (AC-18).
 */
import type { PostReportDayAfterApproval } from '#shared/types/report-posts'

const props = defineProps<{ days: PostReportDayAfterApproval[] }>()

const isEmpty = computed(() => props.days.every(d => d.buildsAlive === 0))

const maxSpend = computed(() => Math.max(1, ...props.days.map(d => d.spendAvg ?? 0)))
const maxDeposit = computed(() => Math.max(1, ...props.days.map(d => d.depositAvg ?? 0)))

function heightOf(value: number | null, max: number): number {
  if (value === null || value <= 0) return 0
  return Math.max(2, (value / max) * 100)
}
</script>

<template>
  <section class="rounded-lg border border-default p-3" data-testid="rp-byday">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="flex items-center gap-3 text-xs text-muted">
        <span class="flex items-center gap-1"><span class="size-2.5 rounded-sm bg-primary" />Spend เฉลี่ย/build</span>
        <span class="flex items-center gap-1"><span class="size-2.5 rounded-sm bg-sky-500" />Deposit เฉลี่ย/build</span>
      </div>
      <ReportsInfoHint id="rp-byday" :text="REPORT_HELP['rp-byday']!" />
    </div>

    <p v-if="isEmpty" class="text-sm text-muted" data-testid="rp-byday-empty">
      ยังไม่มี build ที่ผ่านตรวจพอจะดูแนวโน้มรายวัน
    </p>

    <div v-else class="grid grid-cols-7 items-end gap-2" style="height: 8rem">
      <div
        v-for="d in days"
        :key="d.day"
        class="flex h-full flex-col items-center justify-end gap-1"
        data-testid="rp-byday-day"
        :data-day="d.day"
        :data-builds-alive="d.buildsAlive"
      >
        <div class="flex h-full items-end gap-1">
          <div
            class="w-3 rounded-t-sm bg-primary"
            data-testid="rp-byday-bar"
            data-series="spend"
            :style="{ height: `${heightOf(d.spendAvg, maxSpend)}%` }"
            :title="`Spend เฉลี่ย ${formatDecimal(d.spendAvg)}`"
          />
          <div
            class="w-3 rounded-t-sm bg-sky-500"
            data-testid="rp-byday-bar"
            data-series="deposit"
            :style="{ height: `${heightOf(d.depositAvg, maxDeposit)}%` }"
            :title="`Deposit เฉลี่ย ${formatDecimal(d.depositAvg)}`"
          />
        </div>
        <span class="text-xs text-muted">D{{ d.day }}</span>
      </div>
    </div>
  </section>
</template>
