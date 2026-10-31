<script setup lang="ts">
/**
 * FEAT-089 — the three layer cards of `/reports/posts/:key` (spec "UI behaviour → /reports/posts/:key"):
 * `rp-card-review` · `rp-card-survival` · `rp-card-money`, grid 3 → 1 on mobile.
 */
import type { PostReportRow } from '#shared/types/report-posts'

const props = defineProps<{ row: PostReportRow }>()

const survivedD3 = computed(() => ratioOrNull(props.row.survival.d3.survived, props.row.survival.d3.decided))
const survivedD7 = computed(() => ratioOrNull(props.row.survival.d7.survived, props.row.survival.d7.decided))
</script>

<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
    <section class="flex flex-col gap-1.5 rounded-lg border border-default p-3" data-testid="rp-card-review">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>ผ่านตรวจ</span>
        <ReportsInfoHint id="rp-card-review" :text="REPORT_HELP['rp-card-review']!" />
      </span>
      <span class="text-2xl font-semibold tabular-nums text-highlighted" data-testid="rp-card-review-value">
        {{ formatPostPercent(row.review.approvedRate) }}
      </span>
      <p class="text-xs text-muted">
        {{ formatInt(row.builds.approved) }} / {{ formatInt(row.builds.total) }} build
      </p>
      <p class="text-xs text-muted">
        median {{ formatPostHours(row.review.hoursMedian) }} · P90 {{ formatPostHours(row.review.hoursP90) }} · ภายใน 24 ชม. {{ formatPostPercent(row.review.within24h) }}
      </p>
      <p class="text-xs text-muted">
        ถูกปฏิเสธ {{ formatInt(row.builds.rejected) }} · ยื่นอุทธรณ์ {{ formatInt(row.review.appeals.submitted) }} · อุทธรณ์ผ่าน {{ formatInt(row.review.appeals.approved) }}
      </p>
    </section>

    <section class="flex flex-col gap-1.5 rounded-lg border border-default p-3" data-testid="rp-card-survival">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>อยู่รอด</span>
        <ReportsInfoHint id="rp-card-survival" :text="REPORT_HELP['rp-card-survival']!" />
      </span>
      <span class="text-2xl font-semibold tabular-nums text-highlighted" data-testid="rp-card-survival-value">
        {{ formatPostDays(row.survival.aliveDaysMedian) }}
      </span>
      <p class="text-xs text-muted">
        รอดถึง D3 {{ formatPostPercent(survivedD3) }} · D7 {{ formatPostPercent(survivedD7) }} · ยังส่งอยู่ {{ formatInt(row.survival.alive) }}
      </p>
      <p class="text-xs text-muted">
        แบน {{ formatInt(row.survival.banned) }} · หาย {{ formatInt(row.survival.missing) }} · ปิดเอง {{ formatInt(row.survival.paused) }}
      </p>
    </section>

    <section class="flex flex-col gap-1.5 rounded-lg border border-default p-3" data-testid="rp-card-money">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>Dep/Budget</span>
        <ReportsInfoHint id="rp-card-money" :text="REPORT_HELP['rp-card-money']!" />
      </span>
      <span class="text-2xl font-semibold tabular-nums text-highlighted" data-testid="rp-card-money-value">
        {{ formatDecimal(row.money.depPerBudget) }}
      </span>
      <p class="flex flex-col text-xs text-muted">
        <MoneyCell
          data-testid="rp-card-money-spend"
          align="start"
          :thb="row.money.spend"
          :by-currency="row.money.spendByCurrency ?? {}"
          :unconverted="row.money.spendUnconverted ?? null"
        />
        <span>ยอดฝาก {{ formatDecimal(row.money.utm?.depositAmount ?? null) }} · Cost/Dep {{ formatThb(row.money.costPerDep, 2) }}</span>
      </p>
      <p class="text-xs text-muted">
        spend/build {{ formatThb(row.money.spendPerBuild) }} · deposit/build {{ formatDecimal(row.money.depositPerBuild) }}
      </p>
    </section>
  </div>
</template>
