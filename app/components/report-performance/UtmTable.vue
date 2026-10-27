<script setup lang="ts">
/**
 * FEAT-069 — tab "แยกตาม UTM" (`rf-table-utm`): one row per UTM key in scope with facts in the range. The UTM
 * cell links to `/reports/utm?prefix&source&medium&campaign` + the current range (`rf-utm-link`, the pattern of
 * FEAT-067's `UtmCell` — re-implemented here, not imported, the ads-monitor files belong to FEAT-068). A key
 * used by more than one workspace carries the "ใช้ร่วมกับ …" warning. Sorted by spend desc (nulls last) until a
 * header is clicked.
 */
import type { PerfUtmRow } from '#shared/types/report-performance'
import type { ReportRangeState } from '#shared/types/reports'

const props = defineProps<{
  rows: PerfUtmRow[]
  range: ReportRangeState
  /** the workspaces in the current scope — the warning names the *other* ones */
  scopeIds: string[]
}>()

type Col = 'utm' | 'advertisers' | 'spend' | 'registers' | 'depositors' | 'depositAmount' | 'costReg' | 'costDep'
  | 'avgDep' | 'depReg' | 'depBudget'

interface NumCol { key: Exclude<Col, 'utm'>, label: string, fmt: 'int' | 'dec' | 'pct' }

const NUM_COLS: NumCol[] = [
  { key: 'advertisers', label: 'Advertisers', fmt: 'int' },
  { key: 'spend', label: 'Spend', fmt: 'dec' },
  { key: 'registers', label: 'Register', fmt: 'int' },
  { key: 'depositors', label: 'Deposit', fmt: 'int' },
  { key: 'depositAmount', label: 'Amount', fmt: 'dec' },
  { key: 'costReg', label: 'Cost/Reg', fmt: 'dec' },
  { key: 'costDep', label: 'Cost/Dep', fmt: 'dec' },
  { key: 'avgDep', label: 'Avg Dep', fmt: 'dec' },
  { key: 'depReg', label: 'Dep/Reg', fmt: 'pct' },
  { key: 'depBudget', label: 'Dep/Budget', fmt: 'dec' }
]

type Values = Record<Exclude<Col, 'utm'>, number | null>

function valuesOf(r: { advertisers: number, spend: number | null, registers: number, depositors: number, depositAmount: number }): Values {
  const ratios = perfRatios(r)
  return {
    advertisers: r.advertisers,
    spend: r.spend,
    registers: r.registers,
    depositors: r.depositors,
    depositAmount: r.depositAmount,
    costReg: ratios.costPerRegister,
    costDep: ratios.costPerDeposit,
    avgDep: ratios.averageDeposit,
    depReg: ratios.depRegPct,
    depBudget: ratios.depPerBudget
  }
}

function fmt(value: number | null, kind: NumCol['fmt']): string {
  if (kind === 'pct') return formatPercent(value)
  return kind === 'dec' ? formatDecimal(value) : formatInt(value)
}

function keyOf(r: PerfUtmRow): string {
  return `${r.prefix}|${r.sourceId}|${r.mediumId}|${r.campaignId}`
}

/** prefix, source, medium, campaign, range[, from, to] — empty parts omitted (FEAT-067 rule) */
function linkTo(r: PerfUtmRow) {
  const query: Record<string, string> = {}
  if (r.prefix !== '') query.prefix = r.prefix
  if (r.source !== '') query.source = r.source
  if (r.medium !== '') query.medium = r.medium
  if (r.campaign !== '') query.campaign = r.campaign
  const rq = reportRangeQuery(props.range)
  query.range = rq.range
  if (rq.from !== undefined) query.from = rq.from
  if (rq.to !== undefined) query.to = rq.to
  return { path: '/reports/utm', query }
}

function sharedText(r: PerfUtmRow): string | null {
  if (r.workspaces.length <= 1) return null
  const others = r.workspaces.filter(ws => !props.scopeIds.includes(ws.id))
  const list = (others.length > 0 ? others : r.workspaces).map(ws => ws.name ?? ws.id)
  return `ใช้ร่วมกับ ${list.join(', ')}`
}

const sort = usePerfSort<Col>('spend')

const shown = computed(() => {
  const items = props.rows.map(row => ({ row, values: valuesOf(row) }))
  const key = sort.col.value
  return items.sort((a, b) => {
    const av = key === 'utm' ? a.row.campaign : a.values[key]
    const bv = key === 'utm' ? b.row.campaign : b.values[key]
    return perfCompare(av, bv, sort.dir.value) || a.row.campaign.localeCompare(b.row.campaign)
  })
})

const footer = computed(() => {
  let spend: number | null = null
  const t = { advertisers: 0, registers: 0, depositors: 0, depositAmount: 0 }
  for (const r of props.rows) {
    if (r.spend !== null) spend = (spend ?? 0) + r.spend
    t.registers += r.registers
    t.depositors += r.depositors
    t.depositAmount += r.depositAmount
  }
  const values = valuesOf({ ...t, spend })
  values.advertisers = null
  return values
})
</script>

<template>
  <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm whitespace-nowrap" data-testid="rf-table-utm">
      <thead>
        <tr class="border-b border-default">
          <ReportPerformanceSortTh
            testid="rf-utm-sort-utm"
            label="UTM"
            :sort-state="sort.ariaSort('utm')"
            sticky
            @sort="sort.toggle('utm')"
          />
          <ReportPerformanceSortTh
            v-for="c in NUM_COLS"
            :key="c.key"
            :testid="`rf-utm-sort-${c.key}`"
            :label="c.label"
            :sort-state="sort.ariaSort(c.key)"
            numeric
            :help-id="`rf-table-utm-col-${c.key}`"
            :help-text="REPORT_HELP[`rf-table-utm-col-${c.key}`]"
            @sort="sort.toggle(c.key)"
          />
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="NUM_COLS.length + 1" class="px-3 py-4 text-center text-sm text-muted">
            ไม่มียอดจาก UTM ในช่วงนี้
          </td>
        </tr>
        <tr
          v-for="item in shown"
          :key="keyOf(item.row)"
          class="border-b border-default/60"
          data-testid="rf-utm-row"
          :data-id="keyOf(item.row)"
        >
          <td class="sticky left-0 z-[1] max-w-64 bg-default px-3 py-2">
            <NuxtLink
              :to="linkTo(item.row)"
              class="flex min-w-0 flex-col hover:underline"
              data-testid="rf-utm-link"
            >
              <span class="truncate font-medium text-highlighted">{{ item.row.campaign || REPORT_DASH }}</span>
              <span class="truncate text-xs text-muted">{{ item.row.prefix }} · {{ item.row.source }} · {{ item.row.medium }}</span>
            </NuxtLink>
            <div v-if="sharedText(item.row)" class="truncate text-xs text-warning" data-testid="rf-utm-shared">
              ⚠ {{ sharedText(item.row) }}
            </div>
          </td>
          <td
            v-for="c in NUM_COLS"
            :key="c.key"
            class="px-3 py-2 text-right tabular-nums"
            :class="!item.values[c.key] ? 'text-dimmed' : ''"
          >
            {{ fmt(item.values[c.key], c.fmt) }}
            <span
              v-if="c.key === 'spend' && item.row.spendCurrency && item.row.spendCurrency !== 'THB'"
              class="ml-1 text-xs text-muted"
            >{{ item.row.spendCurrency }}</span>
          </td>
        </tr>
      </tbody>
      <tfoot v-if="rows.length > 0">
        <tr class="border-t border-default bg-elevated/50 font-semibold" data-testid="rf-utm-footer">
          <td class="sticky left-0 z-[1] bg-elevated px-3 py-2">
            รวม {{ formatInt(rows.length) }} UTM
          </td>
          <td v-for="c in NUM_COLS" :key="c.key" class="px-3 py-2 text-right tabular-nums">
            {{ c.key === 'advertisers' ? '' : fmt(footer[c.key], c.fmt) }}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
