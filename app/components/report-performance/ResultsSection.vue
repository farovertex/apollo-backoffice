<script setup lang="ts">
/**
 * FEAT-069 — sections 1 + 2 of `/reports/performance` (spec "UI behaviour → /reports/performance" 1–2):
 * "ผลงานในช่วงที่เลือก" (`rf-results`: spend card with the bar chart, used, registers, depositors, deposit) and
 * "ความคุ้มค่า" (`rf-ratios`: the five ratios, computed here from `results` / `previousResults`, contract §6).
 * `previousResults: null` (range `all`) → no delta line on any tile.
 *
 * FEAT-084 — `results.spend` / `spendByDay` are THB (the API sums `spendThb`): the spend tile prints `฿ …` with the
 * raw `THB x + USD y` breakdown and the `+n ?` of `spendUnconverted`; the cost ratios are THB (`฿ 12.30`); the
 * caption is the THB wording of `fx` (replaces "สกุลเงินของบัญชี ไม่แปลงค่า").
 */
import type { FxReportBlock } from '#shared/types/fx'
import type { PerfResults, PerfSpendDay } from '#shared/types/report-performance'

const props = defineProps<{
  results: PerfResults
  previous: Omit<PerfResults, 'spendByDay'> | null
  trend: PerfSpendDay[]
  /** the range is a single day → the chart shows `trend` */
  singleDay: boolean
  fx?: FxReportBlock | null
}>()

const spendCaption = computed(() => fxReportCaption(props.fx))

const chartMode = computed<'trend' | 'range'>(() => (props.singleDay ? 'trend' : 'range'))
const chartDays = computed(() => (props.singleDay ? props.trend : (props.results.spendByDay ?? [])))

function ratioInput(r: Omit<PerfResults, 'spendByDay'> | null) {
  return r
    ? { spend: r.spend, registers: r.utm.registers, depositors: r.utm.depositors, depositAmount: r.utm.depositAmount }
    : null
}

const ratios = computed(() => perfRatios(ratioInput(props.results)))
const prevRatios = computed(() => (props.previous ? perfRatios(ratioInput(props.previous)) : null))

const sharedNote = computed(() => {
  const r = props.results
  if (r.sharedUtms <= 0) return null
  const names = r.sharedWith.map(ws => ws.name ?? ws.id).join(', ')
  return `ใช้ UTM ร่วมกับ ${names || REPORT_DASH} ${r.sharedUtms} ตัว — ยอดสมัคร/ฝากนับเต็มของ UTM นั้น`
})
</script>

<template>
  <section class="flex flex-col gap-2" data-testid="rf-results">
    <h2 class="text-sm font-semibold text-highlighted">
      ผลงานในช่วงที่เลือก
    </h2>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <!-- spend card: full width on a phone/tablet, two columns + two rows on desktop -->
      <div class="col-span-2 lg:row-span-2">
        <ReportsMetricTile
          testid="rf-tile-spend"
          label="Spend"
          :value="results.spend"
          :previous="previous?.spend ?? null"
          format="thb"
          :caption="spendCaption"
          child-ids
          :help="REPORT_HELP['rf-tile-spend']"
          class="h-full"
        >
          <MoneySubLine :by-currency="results.spendByCurrency" :unconverted="results.spendUnconverted ?? null" />
          <ReportPerformanceSpendChart :days="chartDays" :mode="chartMode" />
        </ReportsMetricTile>
      </div>
      <ReportsMetricTile
        testid="rf-tile-used"
        label="ที่ใช้งาน (มี spend)"
        :value="results.usedAdvertisers"
        :previous="previous?.usedAdvertisers ?? null"
        child-ids
        :help="REPORT_HELP['rf-tile-used']"
      >
        <span class="text-xs text-muted" data-testid="rf-tile-used-sub">
          {{ formatInt(results.usedAdvertisers) }} advertiser · {{ formatInt(results.usedAccounts) }} บัญชี
        </span>
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rf-tile-registers"
        label="คนสมัคร"
        :value="results.utm.registers"
        :previous="previous?.utm.registers ?? null"
        child-ids
        :help="REPORT_HELP['rf-tile-registers']"
      />
      <ReportsMetricTile
        testid="rf-tile-depositors"
        label="คนฝาก"
        :value="results.utm.depositors"
        :previous="previous?.utm.depositors ?? null"
        child-ids
        :help="REPORT_HELP['rf-tile-depositors']"
      />
      <ReportsMetricTile
        testid="rf-tile-deposit"
        label="ยอดฝาก"
        :value="results.utm.depositAmount"
        :previous="previous?.utm.depositAmount ?? null"
        format="dec"
        child-ids
        :help="REPORT_HELP['rf-tile-deposit']"
      />
    </div>
    <p
      v-if="sharedNote"
      class="text-xs text-warning"
      data-testid="rf-shared-note"
    >
      ⚠ {{ sharedNote }}
    </p>
  </section>

  <section class="flex flex-col gap-2" data-testid="rf-ratios">
    <h2 class="text-sm font-semibold text-highlighted">
      ความคุ้มค่า
    </h2>
    <div class="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <ReportsMetricTile
        testid="rf-tile-costReg"
        label="Cost / Register"
        :value="ratios.costPerRegister"
        :previous="prevRatios?.costPerRegister ?? null"
        format="thb2"
        lower-is-better
        child-ids
        :help="REPORT_HELP['rf-tile-costReg']"
      />
      <ReportsMetricTile
        testid="rf-tile-costDep"
        label="Cost / Deposit"
        :value="ratios.costPerDeposit"
        :previous="prevRatios?.costPerDeposit ?? null"
        format="thb2"
        lower-is-better
        child-ids
        :help="REPORT_HELP['rf-tile-costDep']"
      />
      <ReportsMetricTile
        testid="rf-tile-avgDep"
        label="Average deposit"
        :value="ratios.averageDeposit"
        :previous="prevRatios?.averageDeposit ?? null"
        format="dec"
        child-ids
        :help="REPORT_HELP['rf-tile-avgDep']"
      />
      <ReportsMetricTile
        testid="rf-tile-depReg"
        label="Dep / Reg"
        :value="ratios.depRegPct"
        :previous="prevRatios?.depRegPct ?? null"
        format="pct"
        child-ids
        :help="REPORT_HELP['rf-tile-depReg']"
      />
      <ReportsMetricTile
        testid="rf-tile-depBudget"
        label="Dep / Budget"
        :value="ratios.depPerBudget"
        :previous="prevRatios?.depPerBudget ?? null"
        format="pct"
        caption="ยอดฝาก ÷ spend × 100"
        child-ids
        :help="REPORT_HELP['rf-tile-depBudget']"
        class="col-span-2 lg:col-span-1"
      />
    </div>
  </section>
</template>
