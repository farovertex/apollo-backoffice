<script setup lang="ts">
/**
 * FEAT-069 — sections 1 + 2 of `/reports/dashboard` (spec "UI behaviour → /reports/dashboard" 1–2):
 * the **Dep/Budget** hero (`rd-hero` / `rd-tile-depBudget`, depositAmount ÷ spend × 100 as a percent — TASK-dep-budget-pct,
 * before 2026-10-30 a 2-decimal ratio) with the four
 * UTM/Spend numbers beside it, the 8 funnel tiles `rd-tile-<key>` (each with a delta vs `previousFunnel`;
 * `lowerIsBetter` on CPM / CPC / Cost/*) and the funnel bar `rd-funnel` (impressions → clicks → conversions →
 * registers → depositors, each step's % of the previous one, `—` when the previous is 0).
 *
 * FEAT-084 — spend and the cost metrics are THB (the API sums `spendThb`): the spend figures print `฿ …` with the
 * raw `THB x + USD y` breakdown (+ the yellow `+n ?` of `spendUnconverted`) under them, the cost metrics `฿ 0.42`,
 * the spend tile caption is the THB wording of `fx` (no more "ไม่แปลงค่า"). Slot `hero-extra` = one more item
 * of the hero list (the page puts the balance tile there).
 */
import type { FxReportBlock } from '#shared/types/fx'
import type { DashboardFunnel } from '#shared/types/report-dashboard'

const props = defineProps<{
  funnel: DashboardFunnel
  previous: DashboardFunnel | null
  /** FEAT-084 — response-level `fx` (absent on an older API → "ทุกยอดเป็น THB") */
  fx?: FxReportBlock | null
}>()

const spendCaption = computed(() => fxReportCaption(props.fx))

function ratiosOf(f: DashboardFunnel | null) {
  if (!f) return null
  return perfRatios({ spend: f.metrics.spend, registers: f.utm.registers, depositors: f.utm.depositors, depositAmount: f.utm.depositAmount })
}

const r = computed(() => ratiosOf(props.funnel)!)
const p = computed(() => ratiosOf(props.previous))
const m = computed(() => props.funnel.metrics)
const pm = computed(() => props.previous?.metrics ?? null)

const steps = computed(() => {
  const f = props.funnel
  const list = [
    { key: 'impressions', label: 'Impressions', value: f.metrics.impressions },
    { key: 'clicks', label: 'Clicks', value: f.metrics.clicks },
    { key: 'conversions', label: 'Conversions', value: f.metrics.conversions },
    { key: 'registers', label: 'สมัคร', value: f.utm.registers },
    { key: 'depositors', label: 'ฝาก', value: f.utm.depositors }
  ]
  const max = Math.max(1, ...list.map(s => s.value))
  return list.map((s, i) => {
    const pct = i === 0 ? null : funnelStepPct(s.value, list[i - 1]!.value)
    return {
      ...s,
      pct,
      // log scale so 500k impressions and 186 depositors are both visible
      width: s.value > 0 ? Math.max(6, (Math.log10(s.value + 1) / Math.log10(max + 1)) * 100) : 2
    }
  })
})

const sharedNote = computed(() => {
  const f = props.funnel
  if (f.sharedUtms <= 0) return null
  return `ใช้ UTM ร่วมกับ ${f.sharedWith.map(ws => ws.name ?? ws.id).join(', ') || REPORT_DASH} ${f.sharedUtms} ตัว — ยอดสมัคร/ฝากนับเต็มของ UTM นั้น`
})
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="rd-funnel-section">
    <!-- hero: Dep/Budget + the four numbers it is made of -->
    <div
      class="relative grid grid-cols-1 gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]"
      data-testid="rd-hero"
      :data-value="r.depPerBudget ?? ''"
    >
      <ReportsInfoHint id="rd-hero" :text="REPORT_HELP['rd-hero']!" class="absolute right-2 top-2 z-[1]" />
      <ReportsMetricTile
        testid="rd-tile-depBudget"
        label="Dep / Budget"
        :value="r.depPerBudget"
        :previous="p?.depPerBudget ?? null"
        format="pct"
        caption="ยอดฝาก ÷ spend × 100"
        child-ids
        :help="REPORT_HELP['rd-tile-depBudget']"
        class="bg-default"
      />
      <!-- FEAT-084 — with the balance tile the 5th column reaches the hero's corner: keep it clear of the info hint -->
      <dl class="grid grid-cols-2 gap-3" :class="$slots['hero-extra'] ? 'lg:grid-cols-5 lg:pr-7' : 'lg:grid-cols-4'">
        <div class="flex min-w-0 flex-col">
          <dt class="text-xs text-muted">
            Spend
          </dt>
          <dd class="min-w-0 text-lg font-semibold">
            <MoneyCell
              data-testid="rd-hero-spend"
              total
              align="start"
              :thb="m.spend"
              :by-currency="funnel.spendByCurrency ?? {}"
              :unconverted="funnel.spendUnconverted ?? null"
            />
          </dd>
        </div>
        <div class="flex min-w-0 flex-col">
          <dt class="text-xs text-muted">
            ยอดฝาก
          </dt>
          <dd class="truncate text-lg font-semibold tabular-nums text-success" data-testid="rd-hero-deposit">
            {{ formatDecimal(funnel.utm.depositAmount) }}
          </dd>
        </div>
        <div class="flex min-w-0 flex-col">
          <dt class="text-xs text-muted">
            คนสมัคร
          </dt>
          <dd class="truncate text-lg font-semibold tabular-nums" data-testid="rd-hero-registers">
            {{ formatInt(funnel.utm.registers) }}
          </dd>
        </div>
        <div class="flex min-w-0 flex-col">
          <dt class="text-xs text-muted">
            คนฝาก
          </dt>
          <dd class="truncate text-lg font-semibold tabular-nums" data-testid="rd-hero-depositors">
            {{ formatInt(funnel.utm.depositors) }}
          </dd>
        </div>
        <slot name="hero-extra" />
      </dl>
    </div>

    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <ReportsMetricTile
        testid="rd-tile-spend"
        label="Spend"
        :value="m.spend"
        :previous="pm?.spend ?? null"
        format="thb"
        :caption="spendCaption"
        child-ids
        :help="REPORT_HELP['rd-tile-spend']"
      >
        <MoneySubLine :by-currency="funnel.spendByCurrency" :unconverted="funnel.spendUnconverted ?? null" />
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rd-tile-impressions"
        label="Impressions"
        :value="m.impressions"
        :previous="pm?.impressions ?? null"
        child-ids
        :help="REPORT_HELP['rd-tile-impressions']"
      >
        <ReportDashboardSubMetric
          testid="rd-sub-cpm"
          label="CPM"
          :value="m.cpm"
          :previous="pm?.cpm ?? null"
          format="thb"
          lower-is-better
        />
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rd-tile-clicks"
        label="Clicks"
        :value="m.clicks"
        :previous="pm?.clicks ?? null"
        child-ids
        :help="REPORT_HELP['rd-tile-clicks']"
      >
        <span class="flex flex-wrap gap-x-3">
          <ReportDashboardSubMetric
            testid="rd-sub-ctr"
            label="CTR"
            :value="m.ctr"
            :previous="pm?.ctr ?? null"
            format="pct"
          />
          <ReportDashboardSubMetric
            testid="rd-sub-cpc"
            label="CPC"
            :value="m.cpc"
            :previous="pm?.cpc ?? null"
            format="thb"
            lower-is-better
          />
        </span>
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rd-tile-conversions"
        label="Conversions (TikTok)"
        :value="m.conversions"
        :previous="pm?.conversions ?? null"
        child-ids
        :help="REPORT_HELP['rd-tile-conversions']"
      >
        <span class="flex flex-wrap gap-x-3">
          <ReportDashboardSubMetric
            testid="rd-sub-costConv"
            label="Cost/Conv"
            :value="m.conversionCost"
            :previous="pm?.conversionCost ?? null"
            format="thb"
            lower-is-better
          />
          <ReportDashboardSubMetric
            testid="rd-sub-convRate"
            label="Conv rate"
            :value="m.conversionRate"
            :previous="pm?.conversionRate ?? null"
            format="pct"
          />
        </span>
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rd-tile-registers"
        label="คนสมัคร"
        :value="funnel.utm.registers"
        :previous="previous?.utm.registers ?? null"
        child-ids
        :help="REPORT_HELP['rd-tile-registers']"
      >
        <ReportDashboardSubMetric
          testid="rd-sub-costReg"
          label="Cost/Reg"
          :value="r.costPerRegister"
          :previous="p?.costPerRegister ?? null"
          format="thb"
          lower-is-better
        />
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rd-tile-depositors"
        label="คนฝาก (FTD)"
        :value="funnel.utm.depositors"
        :previous="previous?.utm.depositors ?? null"
        child-ids
        :help="REPORT_HELP['rd-tile-depositors']"
      >
        <span class="flex flex-wrap gap-x-3">
          <ReportDashboardSubMetric
            testid="rd-sub-costDep"
            label="Cost/Dep"
            :value="r.costPerDeposit"
            :previous="p?.costPerDeposit ?? null"
            format="thb"
            lower-is-better
          />
          <ReportDashboardSubMetric
            testid="rd-sub-ftd"
            label="FTD"
            :value="r.depRegPct"
            :previous="p?.depRegPct ?? null"
            format="pct"
          />
        </span>
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rd-tile-deposit"
        label="ยอดฝาก"
        :value="funnel.utm.depositAmount"
        :previous="previous?.utm.depositAmount ?? null"
        format="dec"
        child-ids
        :help="REPORT_HELP['rd-tile-deposit']"
      >
        <ReportDashboardSubMetric
          testid="rd-sub-avgDep"
          label="Avg deposit"
          :value="r.averageDeposit"
          :previous="p?.averageDeposit ?? null"
        />
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rd-tile-winLose"
        label="Win - Lose"
        :value="funnel.winLose"
        :previous="previous?.winLose ?? null"
        format="dec"
        caption="ยอดฝาก − ยอดถอน"
        child-ids
        :help="REPORT_HELP['rd-tile-winLose']"
      />
    </div>

    <div class="rounded-lg border border-default p-3" data-testid="rd-funnel">
      <div class="mb-1.5 flex items-center justify-end gap-1">
        <ReportsInfoHint id="rd-funnel" :text="REPORT_HELP['rd-funnel']!" />
      </div>
      <ol class="flex flex-col gap-1.5">
        <li
          v-for="s in steps"
          :key="s.key"
          class="grid grid-cols-[6rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs sm:grid-cols-[8rem_minmax(0,1fr)_5rem]"
          :data-testid="`rd-funnel-step-${s.key}`"
          :data-pct="s.pct ?? ''"
          :data-value="s.value"
        >
          <span class="truncate text-muted">{{ s.label }}</span>
          <span class="flex min-w-0 items-center gap-2">
            <span class="h-3 shrink-0 rounded-sm bg-primary/60" :style="{ width: `${s.width}%` }" />
            <span class="tabular-nums text-default">{{ formatInt(s.value) }}</span>
          </span>
          <span class="text-right tabular-nums" :class="s.pct === null ? 'text-dimmed' : 'text-highlighted'">
            {{ s.key === 'impressions' ? '' : formatPercent(s.pct) }}
          </span>
        </li>
      </ol>
      <p class="mt-2 text-[11px] text-dimmed">
        % = ขั้นนี้ ÷ ขั้นก่อนหน้า · แถบใช้สเกล log
      </p>
    </div>
    <p v-if="sharedNote" class="text-xs text-warning" data-testid="rd-shared-note">
      ⚠ {{ sharedNote }}
    </p>
  </section>
</template>
