<script setup lang="ts">
/**
 * FEAT-069 — tab "แยกตาม workspace" (`rf-table-workspace`, GOD only): one row per workspace with the results,
 * the five ratios, the range's bans / runs and the "now" counters. Header click sorts client-side
 * (`rf-workspace-sort-<col>`, `aria-sort`); idle rows (no spend and no registers) are dimmed and always last;
 * the name emits `pick` → the page writes `?workspaceId=`. Footer "รวมทั้งหมด" = `results` (each UTM once) + `now`.
 */
import type { PerfNow, PerfResults, PerfWorkspaceRow } from '#shared/types/report-performance'

const props = defineProps<{
  rows: PerfWorkspaceRow[]
  results: PerfResults
  now: PerfNow
}>()

defineEmits<{ pick: [id: string] }>()

type Col = 'name' | 'spend' | 'used' | 'registers' | 'depositors' | 'depositAmount' | 'costReg' | 'costDep' | 'avgDep'
  | 'depReg' | 'depBudget' | 'bans' | 'runs' | 'accounts' | 'banned' | 'launching'

/** FEAT-084 — `thb` = the THB spend (`MoneyCell`), `thb2` = a THB cost ratio (`฿ 12.30`) */
interface NumCol { key: Exclude<Col, 'name'>, label: string, fmt: 'int' | 'dec' | 'pct' | 'thb' | 'thb2', tone?: string }

const NUM_COLS: NumCol[] = [
  { key: 'spend', label: 'Spend', fmt: 'thb' },
  { key: 'used', label: 'Used', fmt: 'int' },
  { key: 'registers', label: 'Register', fmt: 'int' },
  { key: 'depositors', label: 'Deposit', fmt: 'int' },
  { key: 'depositAmount', label: 'Amount', fmt: 'dec' },
  { key: 'costReg', label: 'Cost/Reg', fmt: 'thb2' },
  { key: 'costDep', label: 'Cost/Dep', fmt: 'thb2' },
  { key: 'avgDep', label: 'Avg Dep', fmt: 'dec' },
  { key: 'depReg', label: 'Dep/Reg', fmt: 'pct' },
  { key: 'depBudget', label: 'Dep/Budget', fmt: 'dec' },
  { key: 'bans', label: 'New bans', fmt: 'int', tone: 'text-error' },
  { key: 'runs', label: 'Runs', fmt: 'int' },
  { key: 'accounts', label: 'Accounts', fmt: 'int' },
  { key: 'banned', label: 'Banned', fmt: 'int', tone: 'text-error' },
  { key: 'launching', label: 'Launching', fmt: 'int' }
]

type Values = Record<Exclude<Col, 'name'>, number | null>

function valuesOf(r: Omit<PerfResults, 'spendByDay'>, now: { accounts: number, banned: number, launching: number }): Values {
  const ratios = perfRatios({ spend: r.spend, registers: r.utm.registers, depositors: r.utm.depositors, depositAmount: r.utm.depositAmount })
  return {
    spend: r.spend,
    used: r.usedAdvertisers,
    registers: r.utm.registers,
    depositors: r.utm.depositors,
    depositAmount: r.utm.depositAmount,
    costReg: ratios.costPerRegister,
    costDep: ratios.costPerDeposit,
    avgDep: ratios.averageDeposit,
    depReg: ratios.depRegPct,
    depBudget: ratios.depPerBudget,
    bans: r.bans,
    runs: r.builds.total,
    accounts: now.accounts,
    banned: now.banned,
    launching: now.launching
  }
}

function fmt(value: number | null, kind: NumCol['fmt']): string {
  if (kind === 'pct') return formatPercent(value)
  if (kind === 'thb') return formatThb(value, 0)
  if (kind === 'thb2') return formatThb(value, 2)
  return kind === 'dec' ? formatDecimal(value) : formatInt(value)
}

function isIdle(row: PerfWorkspaceRow): boolean {
  return !row.spend && !row.utm.registers
}

const sort = usePerfSort<Col>('spend')

const shown = computed(() => {
  const items = props.rows.map(row => ({ row, values: valuesOf(row, row.now), idle: isIdle(row) }))
  const key = sort.col.value
  items.sort((a, b) => {
    const av = key === 'name' ? (a.row.workspace.name ?? '') : a.values[key]
    const bv = key === 'name' ? (b.row.workspace.name ?? '') : b.values[key]
    return perfCompare(av, bv, sort.dir.value)
  })
  return [...items.filter(i => !i.idle), ...items.filter(i => i.idle)]
})

const footer = computed(() => valuesOf(props.results, {
  accounts: props.now.accounts,
  banned: props.now.banned.count,
  launching: props.now.launching
}))
</script>

<template>
  <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm whitespace-nowrap" data-testid="rf-table-workspace">
      <thead>
        <tr class="border-b border-default">
          <ReportPerformanceSortTh
            testid="rf-workspace-sort-name"
            label="Workspace / admin"
            :sort-state="sort.ariaSort('name')"
            sticky
            @sort="sort.toggle('name')"
          />
          <ReportPerformanceSortTh
            v-for="c in NUM_COLS"
            :key="c.key"
            :testid="`rf-workspace-sort-${c.key}`"
            :label="c.label"
            :sort-state="sort.ariaSort(c.key)"
            numeric
            :help-id="`rf-table-workspace-col-${c.key}`"
            :help-text="REPORT_HELP[`rf-table-workspace-col-${c.key}`]"
            @sort="sort.toggle(c.key)"
          />
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="item in shown"
          :key="item.row.workspace.id"
          class="border-b border-default/60"
          :class="item.idle ? 'opacity-50' : ''"
          data-testid="rf-workspace-row"
          :data-id="item.row.workspace.id"
          :data-idle="item.idle ? 'true' : 'false'"
        >
          <td class="sticky left-0 z-[1] bg-default px-3 py-2">
            <button
              type="button"
              class="font-medium text-primary hover:underline"
              data-testid="rf-workspace-pick"
              @click="$emit('pick', item.row.workspace.id)"
            >
              {{ item.row.workspace.name ?? item.row.workspace.id }}
            </button>
            <span v-if="item.row.admin?.displayName" class="ml-2 text-xs text-muted">{{ item.row.admin.displayName }}</span>
            <div v-if="item.row.sharedUtms > 0" class="text-xs text-warning">
              ⚠ ใช้ UTM ร่วมกับ {{ item.row.sharedWith.map(ws => ws.name ?? ws.id).join(', ') }}
            </div>
          </td>
          <td
            v-for="c in NUM_COLS"
            :key="c.key"
            class="px-3 py-2 text-right tabular-nums"
            :class="!item.values[c.key] ? 'text-dimmed' : (c.tone ?? '')"
          >
            <MoneyCell
              v-if="c.fmt === 'thb'"
              data-testid="rf-workspace-spend"
              :thb="item.values[c.key]"
              :by-currency="item.row.spendByCurrency ?? {}"
              :unconverted="item.row.spendUnconverted ?? null"
            />
            <template v-else>
              {{ fmt(item.values[c.key], c.fmt) }}
            </template>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="border-t border-default bg-elevated/50 font-semibold" data-testid="rf-workspace-footer">
          <td class="sticky left-0 z-[1] bg-elevated px-3 py-2">
            รวมทั้งหมด
          </td>
          <td v-for="c in NUM_COLS" :key="c.key" class="px-3 py-2 text-right tabular-nums">
            <MoneyCell
              v-if="c.fmt === 'thb'"
              total
              :thb="footer[c.key]"
              :by-currency="results.spendByCurrency ?? {}"
              :unconverted="results.spendUnconverted ?? null"
            />
            <template v-else>
              {{ fmt(footer[c.key], c.fmt) }}
            </template>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
