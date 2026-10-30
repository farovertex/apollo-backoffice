<script setup lang="ts">
/**
 * FEAT-069 — `rd-table-account`: per advertiser Account · Workspace (GOD) · Advertiser · Spend · Impr · Clicks ·
 * Conv · Register · Deposit · Amount · Dep/Budget · Status now (`perfStateBadge`), "UTM ร่วม" chip
 * (`rd-utm-shared`) when the advertiser's UTM key is shared; sorted by Dep/Budget desc (nulls last) then spend desc.
 *
 * FEAT-084 — `metrics.spend` is THB (the API sums `spendThb`), so Dep/Budget and the sort already use THB; the
 * spend cell is a `MoneyCell` (`฿ 665` / `20.10 USD`, `+n ?` for `spendUnconverted`), the footer `฿` total with
 * the merged raw breakdown.
 */
import type { DashboardAccountRow } from '#shared/types/report-dashboard'

const props = defineProps<{
  rows: DashboardAccountRow[]
  isGod: boolean
}>()

function depBudget(row: DashboardAccountRow): number | null {
  return perfRatios({ spend: row.metrics.spend, registers: 0, depositors: 0, depositAmount: row.utm.depositAmount }).depPerBudget
}

const shown = computed(() => [...props.rows].sort((a, b) =>
  perfCompare(depBudget(a), depBudget(b), -1) || b.metrics.spend - a.metrics.spend))

/** FEAT-069 (T2c) — the 8 numeric columns in the order they are rendered below */
const NUM_HEADERS: { label: string, key: string }[] = [
  { label: 'Spend', key: 'rd-table-account-col-spend' },
  { label: 'Impr', key: 'rd-table-account-col-impressions' },
  { label: 'Clicks', key: 'rd-table-account-col-clicks' },
  { label: 'Conv', key: 'rd-table-account-col-conversions' },
  { label: 'Register', key: 'rd-table-account-col-registers' },
  { label: 'Deposit', key: 'rd-table-account-col-depositors' },
  { label: 'Amount', key: 'rd-table-account-col-depositAmount' },
  { label: 'Dep/Budget', key: 'rd-table-account-col-depBudget' }
]

const totals = computed(() => {
  const t = { spend: 0, impressions: 0, clicks: 0, conversions: 0, registers: 0, depositors: 0, depositAmount: 0 }
  for (const r of props.rows) {
    t.spend += r.metrics.spend
    t.impressions += r.metrics.impressions
    t.clicks += r.metrics.clicks
    t.conversions += r.metrics.conversions
    t.registers += r.utm.registers
    t.depositors += r.utm.depositors
    t.depositAmount += r.utm.depositAmount
  }
  return t
})

const footerByCurrency = computed(() => mergeByCurrency(props.rows.map(r => r.spendByCurrency)))
const footerUnconverted = computed(() => mergeUnconverted(props.rows.map(r => r.spendUnconverted)))
</script>

<template>
  <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm whitespace-nowrap" data-testid="rd-table-account">
      <thead>
        <tr class="border-b border-default text-xs font-medium text-muted uppercase">
          <th scope="col" class="sticky left-0 z-[2] bg-elevated px-3 py-2 text-left">
            Account
          </th>
          <th v-if="isGod" scope="col" class="bg-elevated px-3 py-2 text-left">
            Workspace
          </th>
          <th scope="col" class="bg-elevated px-3 py-2 text-left">
            Advertiser
          </th>
          <th
            v-for="h in NUM_HEADERS"
            :key="h.label"
            scope="col"
            class="bg-elevated px-3 py-2 text-right"
          >
            <span class="inline-flex items-center justify-end gap-1">
              <span>{{ h.label }}</span>
              <ReportsInfoHint :id="h.key" :text="REPORT_HELP[h.key]!" />
            </span>
          </th>
          <th scope="col" class="bg-elevated px-3 py-2 text-left">
            <span class="inline-flex items-center gap-1">
              <span>Status now</span>
              <ReportsInfoHint id="rd-table-account-col-state" :text="REPORT_HELP['rd-table-account-col-state']!" />
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="isGod ? 12 : 11" class="px-3 py-4 text-center text-sm text-muted">
            ไม่มีบัญชีในช่วงนี้
          </td>
        </tr>
        <tr
          v-for="row in shown"
          :key="row.advertiser.id"
          class="border-b border-default/60"
          data-testid="rd-account-row"
          :data-id="row.advertiser.id"
          :data-state="row.state"
        >
          <td class="sticky left-0 z-[1] max-w-52 truncate bg-default px-3 py-2 font-medium text-highlighted">
            {{ perfAccountName(row.account) }}
          </td>
          <td v-if="isGod" class="max-w-40 truncate px-3 py-2 text-muted">
            {{ row.workspace?.name ?? REPORT_DASH }}
          </td>
          <td class="max-w-52 px-3 py-2">
            <div class="flex items-center gap-1">
              <span class="truncate">{{ row.advertiser.name ?? REPORT_DASH }}</span>
              <UBadge
                v-if="row.utmShared"
                label="UTM ร่วม"
                color="warning"
                variant="subtle"
                size="sm"
                data-testid="rd-utm-shared"
              />
            </div>
            <div class="text-xs text-muted">
              {{ last4(row.advertiser.tiktokAdvertiserId) }}
            </div>
          </td>
          <td class="px-3 py-2 text-right">
            <MoneyCell
              data-testid="rd-account-spend"
              :thb="row.metrics.spend"
              :by-currency="row.spendByCurrency ?? {}"
              :unconverted="row.spendUnconverted ?? null"
            />
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.metrics.impressions) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.metrics.clicks) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.metrics.conversions) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.utm.registers) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.utm.depositors) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(row.utm.depositAmount) }}
          </td>
          <td class="px-3 py-2 text-right font-semibold tabular-nums" data-testid="rd-account-depBudget">
            {{ formatPercent(depBudget(row)) }}
          </td>
          <td class="px-3 py-2">
            <ReportPerformanceStateBadge :state="row.state" testid="rd-account-state" />
          </td>
        </tr>
      </tbody>
      <tfoot v-if="rows.length > 0">
        <tr class="border-t border-default bg-elevated/50 font-semibold" data-testid="rd-account-footer">
          <td class="sticky left-0 z-[1] bg-elevated px-3 py-2">
            รวม {{ formatInt(rows.length) }} advertiser
          </td>
          <td v-if="isGod" />
          <td />
          <td class="px-3 py-2 text-right">
            <MoneyCell
              total
              :thb="totals.spend"
              :by-currency="footerByCurrency"
              :unconverted="footerUnconverted"
            />
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.impressions) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.clicks) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.conversions) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.registers) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.depositors) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(totals.depositAmount) }}
          </td>
          <td />
          <td />
        </tr>
      </tfoot>
    </table>
  </div>
</template>
