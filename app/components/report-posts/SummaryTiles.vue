<script setup lang="ts">
/**
 * FEAT-089 — the five summary tiles of `/reports/posts` (spec "UI behaviour", `rp-sum-*`). Several values here
 * are **fractions** (`approvedRate`, `within24h`, `d7.survived/decided`) printed with `formatPostPercent`
 * (×100, 0 decimals) — not the existing `pct` format of `ReportsMetricTile`, which assumes the API already
 * sent percent points (FEAT-069 convention). Built with the same look as `ReportsMetricTile` (border, label +
 * info hint, big value, caption/sub-lines) instead of reusing it, so the 1-decimal hours and the fraction
 * percents are not forced through a format the component does not have.
 */
import type { PostReportSummary } from '#shared/types/report-posts'

const props = defineProps<{
  summary: PostReportSummary
}>()

const survivedD7Rate = computed(() => ratioOrNull(props.summary.d7.survived, props.summary.d7.decided))
</script>

<template>
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
    <div class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3" data-testid="rp-sum-builds">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>เผยแพร่ในช่วง</span>
        <ReportsInfoHint id="rp-sum-builds" :text="REPORT_HELP['rp-sum-builds']!" />
      </span>
      <span class="truncate text-xl font-semibold tabular-nums text-highlighted" data-testid="rp-sum-builds-value">
        {{ formatInt(summary.builds) }}
      </span>
      <span class="text-[11px] text-dimmed">{{ formatInt(summary.posts) }} โพสต์ · {{ formatInt(summary.accounts) }} บัญชี</span>
    </div>

    <div class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3" data-testid="rp-sum-approved">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>ผ่านตรวจ</span>
        <ReportsInfoHint id="rp-sum-approved" :text="REPORT_HELP['rp-sum-approved']!" />
      </span>
      <span class="truncate text-xl font-semibold tabular-nums text-highlighted" data-testid="rp-sum-approved-value">
        {{ formatPostPercent(summary.approvedRate) }}
      </span>
      <span class="text-[11px] text-dimmed">
        {{ formatInt(summary.approved) }} ผ่าน · {{ formatInt(summary.rejected) }} ปฏิเสธ · {{ formatInt(summary.pending) }} ยังรอ
      </span>
      <span class="text-[11px] text-dimmed">
        ad {{ formatInt(summary.adsApproved) }}/{{ formatInt(summary.ads) }} · {{ formatPostPercent(summary.adApprovedRate) }}
      </span>
    </div>

    <div class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3" data-testid="rp-sum-review">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>เวลาตรวจ (median · P90)</span>
        <ReportsInfoHint id="rp-sum-review" :text="REPORT_HELP['rp-sum-review']!" />
      </span>
      <span class="truncate text-xl font-semibold tabular-nums text-highlighted" data-testid="rp-sum-review-value">
        {{ formatPostHours(summary.hoursMedian) }}
      </span>
      <span class="text-[11px] text-dimmed">
        P90 {{ formatPostHours(summary.hoursP90) }} · ภายใน 24 ชม. {{ formatPostPercent(summary.within24h) }}
      </span>
    </div>

    <div class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3" data-testid="rp-sum-survival">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>อยู่รอด ≥ 7 วัน</span>
        <ReportsInfoHint id="rp-sum-survival" :text="REPORT_HELP['rp-sum-survival']!" />
      </span>
      <span class="truncate text-xl font-semibold tabular-nums text-highlighted" data-testid="rp-sum-survival-value">
        {{ formatPostPercent(survivedD7Rate) }}
      </span>
      <span class="text-[11px] text-dimmed">{{ formatInt(summary.banned) }} แบน · {{ formatInt(summary.missing) }} หาย</span>
    </div>

    <div class="flex min-w-0 flex-col gap-0.5 rounded-lg border border-default p-3" data-testid="rp-sum-money">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>Dep/Budget ของ cohort</span>
        <ReportsInfoHint id="rp-sum-money" :text="REPORT_HELP['rp-sum-money']!" />
      </span>
      <span class="truncate text-xl font-semibold tabular-nums text-highlighted" data-testid="rp-sum-money-value">
        {{ formatDecimal(summary.depPerBudget) }}
      </span>
      <span class="flex flex-col text-[11px] text-dimmed">
        <MoneyCell
          data-testid="rp-sum-money-spend"
          align="start"
          :thb="summary.spend"
          :by-currency="summary.spendByCurrency ?? {}"
          :unconverted="summary.spendUnconverted ?? null"
        />
        <span>ยอดฝาก {{ formatDecimal(summary.utm.depositAmount) }}</span>
      </span>
    </div>
  </div>
</template>
