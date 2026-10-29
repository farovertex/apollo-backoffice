<script setup lang="ts">
/**
 * FEAT-069 — `rd-table-workspace` (GOD only): per workspace Spend · Impressions · Clicks · Conversions ·
 * Register · Deposit · Amount · Dep/Budget · (now) Accounts · Launching · Banned · Balance; sorted by Dep/Budget
 * desc (nulls last) then spend desc; footer `rd-workspace-footer` = the funnel totals.
 *
 * FEAT-084 — spend is THB (`MoneyCell total` + raw `THB x + USD y` sub), Dep/Budget from that THB spend (the API's
 * `metrics.spend`); the Balance cell keeps the per-currency list as its sub line under the workspace's
 * `now.balanceThb` ("≈ ฿" when estimated; the list alone when the API has no `balanceThb`).
 */
import type { DashboardFunnel, DashboardWorkspaceRow } from '#shared/types/report-dashboard'

const props = defineProps<{
  rows: DashboardWorkspaceRow[]
  funnel: DashboardFunnel
  now: { accounts: number | null, launching: number, banned: number }
}>()

defineEmits<{ pick: [id: string] }>()

function depBudget(depositAmount: number, spend: number): number | null {
  return perfRatios({ spend, registers: 0, depositors: 0, depositAmount }).depPerBudget
}

const shown = computed(() => [...props.rows].sort((a, b) =>
  perfCompare(depBudget(a.utm.depositAmount, a.metrics.spend), depBudget(b.utm.depositAmount, b.metrics.spend), -1)
  || b.metrics.spend - a.metrics.spend))

/** raw balances of one workspace as a `{ currency: amount }` map (unknown currency → not listed; it is in `unconverted`) */
function balanceMap(row: DashboardWorkspaceRow): Record<string, number> {
  const out: Record<string, number> = {}
  for (const b of row.now.balance) if (b.currency) out[b.currency] = (out[b.currency] ?? 0) + b.amount
  return out
}

function balanceText(row: DashboardWorkspaceRow): string {
  if (row.now.balance.length === 0) return REPORT_DASH
  return row.now.balance.map(b => `${formatDecimal(b.amount)} ${b.currency ?? ''}`.trim()).join(' · ')
}

const HEADERS: { label: string, key?: string }[] = [
  { label: 'Spend', key: 'rd-table-workspace-col-spend' },
  { label: 'Impr', key: 'rd-table-workspace-col-impressions' },
  { label: 'Clicks', key: 'rd-table-workspace-col-clicks' },
  { label: 'Conv', key: 'rd-table-workspace-col-conversions' },
  { label: 'Register', key: 'rd-table-workspace-col-registers' },
  { label: 'Deposit', key: 'rd-table-workspace-col-depositors' },
  { label: 'Amount', key: 'rd-table-workspace-col-depositAmount' },
  { label: 'Dep/Budget', key: 'rd-table-workspace-col-depBudget' },
  { label: 'Accounts', key: 'rd-table-workspace-col-accounts' },
  { label: 'Launching', key: 'rd-table-workspace-col-launching' },
  { label: 'Banned', key: 'rd-table-workspace-col-banned' },
  // FEAT-069 (T2c) — no text in the brief's §Texts for Balance, so no hint
  { label: 'Balance' }
]
</script>

<template>
  <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm whitespace-nowrap" data-testid="rd-table-workspace">
      <thead>
        <tr class="border-b border-default">
          <th scope="col" class="sticky left-0 z-[2] bg-elevated px-3 py-2 text-left text-xs font-medium text-muted uppercase">
            Workspace / admin
          </th>
          <th
            v-for="h in HEADERS"
            :key="h.label"
            scope="col"
            class="bg-elevated px-3 py-2 text-right text-xs font-medium text-muted uppercase"
          >
            <span class="inline-flex items-center justify-end gap-1">
              <span>{{ h.label }}</span>
              <ReportsInfoHint v-if="h.key" :id="h.key" :text="REPORT_HELP[h.key]!" />
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in shown"
          :key="row.workspace.id"
          class="border-b border-default/60"
          :class="!row.metrics.spend && !row.utm.registers ? 'opacity-50' : ''"
          data-testid="rd-workspace-row"
          :data-id="row.workspace.id"
        >
          <td class="sticky left-0 z-[1] bg-default px-3 py-2">
            <button type="button" class="font-medium text-primary hover:underline" @click="$emit('pick', row.workspace.id)">
              {{ row.workspace.name ?? row.workspace.id }}
            </button>
            <span v-if="row.admin?.displayName" class="ml-2 text-xs text-muted">{{ row.admin.displayName }}</span>
          </td>
          <td class="px-3 py-2 text-right">
            <MoneyCell
              data-testid="rd-workspace-spend"
              total
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
          <td class="px-3 py-2 text-right font-semibold tabular-nums" data-testid="rd-workspace-depBudget">
            {{ formatDecimal(depBudget(row.utm.depositAmount, row.metrics.spend)) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.now.accounts) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.now.launching) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="row.now.banned > 0 ? 'text-error' : ''">
            {{ formatInt(row.now.banned) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums text-muted" data-testid="rd-workspace-balance">
            <MoneyCell
              v-if="row.now.balanceThb"
              total
              :thb="row.now.balanceThb.amount"
              :estimated="row.now.balanceThb.estimated"
              :by-currency="balanceMap(row)"
              :unconverted="unconvertedFromList(row.now.balanceThb.unconverted)"
            />
            <template v-else>
              {{ balanceText(row) }}
            </template>
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="border-t border-default bg-elevated/50 font-semibold" data-testid="rd-workspace-footer">
          <td class="sticky left-0 z-[1] bg-elevated px-3 py-2">
            รวมทั้งหมด
          </td>
          <td class="px-3 py-2 text-right">
            <MoneyCell
              total
              :thb="funnel.metrics.spend"
              :by-currency="funnel.spendByCurrency ?? {}"
              :unconverted="funnel.spendUnconverted ?? null"
            />
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(funnel.metrics.impressions) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(funnel.metrics.clicks) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(funnel.metrics.conversions) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(funnel.utm.registers) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(funnel.utm.depositors) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(funnel.utm.depositAmount) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(depBudget(funnel.utm.depositAmount, funnel.metrics.spend)) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(now.accounts) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(now.launching) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(now.banned) }}
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  </div>
</template>
