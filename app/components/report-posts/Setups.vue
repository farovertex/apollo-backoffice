<script setup lang="ts">
/**
 * FEAT-089 — `rp-setups` of `/reports/posts/:key` (spec "UI behaviour → /reports/posts/:key"): "ค่าตั้งที่ใช้
 * กับโพสต์นี้", the other lens grouped inside this key (post → ad-group template, other lenses → post),
 * sorted `depPerBudget` desc (contract §3). Rows with `enough false` are dimmed, same rule as `rp-table`.
 */
import type { PostReportSetup } from '#shared/types/report-posts'

defineProps<{ setups: PostReportSetup[] }>()
</script>

<template>
  <section class="flex flex-col gap-2 rounded-lg border border-default p-3" data-testid="rp-setups">
    <h2 class="flex items-center gap-1 text-sm font-semibold text-highlighted">
      <span>ค่าตั้งที่ใช้กับโพสต์นี้</span>
      <ReportsInfoHint id="rp-setups" :text="REPORT_HELP['rp-setups']!" />
    </h2>
    <p v-if="setups.length === 0" class="text-sm text-muted" data-testid="rp-setups-empty">
      ไม่มีค่าตั้งอื่นในช่วงนี้
    </p>
    <div v-else class="overflow-x-auto">
      <table class="w-full text-sm whitespace-nowrap">
        <thead>
          <tr class="border-b border-default text-xs text-muted">
            <th class="px-2 py-1.5 text-left font-medium">
              ชื่อ
            </th>
            <th class="px-2 py-1.5 text-right font-medium">
              Build
            </th>
            <th class="px-2 py-1.5 text-right font-medium">
              รอด D7
            </th>
            <th class="px-2 py-1.5 text-right font-medium">
              Dep/Budget
            </th>
            <th class="px-2 py-1.5 text-right font-medium">
              Cost/Dep
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="s in setups"
            :key="s.key"
            class="border-b border-default/60 last:border-b-0"
            :class="s.enough ? '' : 'opacity-55'"
            data-testid="rp-setups-row"
            :data-key="s.key"
            :data-enough="s.enough ? 'true' : 'false'"
          >
            <td class="max-w-56 truncate px-2 py-1.5" :title="s.name ?? ''">
              {{ s.name ?? REPORT_DASH }}
            </td>
            <td class="px-2 py-1.5 text-right tabular-nums">
              {{ formatInt(s.builds) }}
            </td>
            <td class="px-2 py-1.5 text-right tabular-nums">
              {{ formatPostPercent(s.d7Rate) }}
            </td>
            <td class="px-2 py-1.5 text-right tabular-nums font-semibold">
              {{ formatDecimal(s.depPerBudget) }}
            </td>
            <td class="px-2 py-1.5 text-right tabular-nums">
              {{ formatThb(s.costPerDep, 2) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
