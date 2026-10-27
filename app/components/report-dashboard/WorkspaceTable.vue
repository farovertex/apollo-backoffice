<script setup lang="ts">
/**
 * FEAT-069 — `rd-table-workspace` (GOD only): per workspace Spend · Impressions · Clicks · Conversions ·
 * Register · Deposit · Amount · Dep/Budget · (now) Accounts · Launching · Banned · Balance; sorted by Dep/Budget
 * desc (nulls last) then spend desc; footer `rd-workspace-footer` = the funnel totals.
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

function balanceText(row: DashboardWorkspaceRow): string {
  if (row.now.balance.length === 0) return REPORT_DASH
  return row.now.balance.map(b => `${formatDecimal(b.amount)} ${b.currency ?? ''}`.trim()).join(' · ')
}

const HEADERS = ['Spend', 'Impr', 'Clicks', 'Conv', 'Register', 'Deposit', 'Amount', 'Dep/Budget', 'Accounts', 'Launching', 'Banned', 'Balance']
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
            :key="h"
            scope="col"
            class="bg-elevated px-3 py-2 text-right text-xs font-medium text-muted uppercase"
          >
            {{ h }}
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
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(row.metrics.spend) }}
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
          <td class="px-3 py-2 text-right tabular-nums text-muted">
            {{ balanceText(row) }}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="border-t border-default bg-elevated/50 font-semibold" data-testid="rd-workspace-footer">
          <td class="sticky left-0 z-[1] bg-elevated px-3 py-2">
            รวมทั้งหมด
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(funnel.metrics.spend) }}
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
