<script setup lang="ts">
/**
 * FEAT-089 — `rp-table` (spec "UI behaviour → /reports/posts"): one row per key of the current lens. Scroll
 * box with the first column and header sticky (both axes, like `ads-monitor/Table.vue`'s `am-table`) and a
 * sticky total row (`rp-total`) built from `summary`, not a client sum of the visible rows.
 *
 * Default sort = API order (`enough` first, then `depPerBudget` desc, spec "ordering of rows[]"); clicking a
 * header switches to that column (`perfCompare`/`perfAriaSort`, the same comparator `usePerfSort` uses — a
 * literal `usePerfSort` would force an initial sort, which the API-order default must not have).
 */
import type { PostReportGate, PostReportRow, PostReportSummary } from '#shared/types/report-posts'

const props = defineProps<{
  rows: PostReportRow[]
  summary: PostReportSummary
  gate: PostReportGate
  enoughOnly: boolean
}>()

const emit = defineEmits<{ open: [key: string] }>()

type Col = 'builds' | 'approved' | 'review' | 'rejected' | 'survival' | 'spend' | 'deposit' | 'depBudget' | 'costDep'

const sortCol = ref<Col | null>(null)
const sortDir = ref<1 | -1>(-1)

function toggle(next: Col) {
  if (sortCol.value === next) {
    sortDir.value = sortDir.value === 1 ? -1 : 1
  } else {
    sortCol.value = next
    sortDir.value = -1
  }
}

function ariaSort(c: Col): 'ascending' | 'descending' | 'none' {
  return sortCol.value === c ? perfAriaSort(true, sortDir.value) : 'none'
}

function valueOf(row: PostReportRow, col: Col): number | null {
  switch (col) {
    case 'builds': return row.builds.total
    case 'approved': return row.review.approvedRate
    case 'review': return row.review.hoursMedian
    case 'rejected': return row.builds.rejected
    case 'survival': return row.survival.aliveDaysMedian
    case 'spend': return row.money.spend
    case 'deposit': return row.money.utm?.depositAmount ?? null
    case 'depBudget': return row.money.depPerBudget
    case 'costDep': return row.money.costPerDep
  }
}

const shown = computed(() => {
  if (!sortCol.value) return props.rows
  const col = sortCol.value
  return [...props.rows].sort((a, b) => perfCompare(valueOf(a, col), valueOf(b, col), sortDir.value))
})

const COLS: { key: Col, label: string, help?: string }[] = [
  { key: 'builds', label: 'ยิง', help: 'rp-table-col-builds' },
  { key: 'approved', label: 'ผ่านตรวจ', help: 'rp-table-col-approved' },
  { key: 'review', label: 'เวลาตรวจ', help: 'rp-table-col-review' },
  { key: 'rejected', label: 'ถูกปฏิเสธ', help: 'rp-table-col-rejected' },
  { key: 'survival', label: 'อยู่รอด', help: 'rp-table-col-survival' },
  { key: 'spend', label: 'Spend', help: 'rp-table-col-spend' },
  { key: 'deposit', label: 'Deposit', help: 'rp-table-col-deposit' },
  { key: 'depBudget', label: 'Dep/Budget', help: 'rp-table-col-depBudget' },
  { key: 'costDep', label: 'Cost/Dep', help: 'rp-table-col-costDep' }
]
</script>

<template>
  <div class="min-w-0 max-h-[70vh] overflow-auto overscroll-contain rounded-lg border border-default" data-testid="rp-table">
    <table v-if="rows.length > 0" class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr class="bg-elevated">
          <th
            scope="col"
            class="sticky top-0 left-0 z-20 rounded-tl-lg border-y border-l border-default bg-elevated px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted"
          >
            รายการ
          </th>
          <th
            v-for="c in COLS"
            :key="c.key"
            scope="col"
            class="sticky top-0 z-10 border-y border-default bg-elevated p-0 text-xs font-medium whitespace-nowrap text-muted"
            :aria-sort="ariaSort(c.key)"
          >
            <div class="flex items-center justify-end gap-1 px-3 py-2">
              <button
                type="button"
                class="flex items-center gap-1 uppercase hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
                :class="sortCol === c.key ? 'text-highlighted' : ''"
                :data-testid="`rp-sort-${c.key}`"
                @click="toggle(c.key)"
              >
                <span>{{ c.label }}</span>
                <span aria-hidden="true" class="w-2">{{ sortCol === c.key ? (sortDir === 1 ? '↑' : '↓') : '' }}</span>
              </button>
              <ReportsInfoHint
                v-if="c.help"
                :id="c.help"
                :text="REPORT_HELP[c.help]!"
                class="shrink-0"
              />
            </div>
          </th>
          <th
            scope="col"
            class="sticky top-0 z-10 rounded-tr-lg border-y border-r border-default bg-elevated px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted"
          >
            <div class="flex items-center gap-1">
              <span>ข้อมูล</span>
              <ReportsInfoHint id="rp-table-col-enough" :text="REPORT_HELP['rp-table-col-enough']!" class="shrink-0" />
            </div>
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="row in shown"
          :key="row.key"
          class="cursor-pointer border-b border-default/60 hover:bg-elevated/50"
          :class="!row.enough && !enoughOnly ? 'rp-row-dim' : ''"
          data-testid="rp-row"
          :data-key="row.key"
          @click="emit('open', row.key)"
        >
          <td class="sticky left-0 z-[1] max-w-72 bg-default px-3 py-2">
            <div class="flex items-center gap-2">
              <ReportPostsCover :url="row.subject.coverUrl" :is-video="row.subject.isVideo" size="sm" />
              <div class="min-w-0">
                <div class="truncate font-medium text-highlighted" :title="row.subject.title">
                  {{ row.subject.title }}
                </div>
                <div class="truncate text-xs text-muted" :title="row.subject.subtitle">
                  {{ row.subject.subtitle }}
                </div>
              </div>
            </div>
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.builds.total) }}
            <div class="text-xs text-dimmed">
              {{ formatInt(row.builds.accounts) }} บัญชี
            </div>
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.builds.approved) }}
            <div class="text-xs text-dimmed">
              {{ formatPostPercent(row.review.approvedRate) }}
            </div>
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatPostHours(row.review.hoursMedian) }}
            <div class="text-xs text-dimmed">
              P90 {{ formatPostHours(row.review.hoursP90) }}
            </div>
          </td>
          <td class="max-w-40 px-3 py-2 text-right tabular-nums">
            {{ formatInt(row.builds.rejected) }}
            <div class="truncate text-xs text-dimmed" :title="row.review.topReason?.label ?? ''">
              {{ row.review.topReason?.label ?? REPORT_DASH }}
            </div>
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatPostDays(row.survival.aliveDaysMedian) }}
            <div class="text-xs text-dimmed">
              {{ formatInt(row.survival.banned) }} แบน
            </div>
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            <MoneyCell
              data-testid="rp-row-spend"
              :thb="row.money.spend"
              :by-currency="row.money.spendByCurrency ?? {}"
              :unconverted="row.money.spendUnconverted ?? null"
            />
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(row.money.utm?.depositAmount ?? null) }}
          </td>
          <td class="px-3 py-2 text-right font-semibold tabular-nums">
            {{ formatDecimal(row.money.depPerBudget) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatThb(row.money.costPerDep, 2) }}
          </td>
          <td class="px-3 py-2" @click.stop>
            <ReportPostsEnoughBadge
              :enough="row.enough"
              :why="row.enoughWhy"
              :gate="gate"
              :approved="row.builds.approved"
            />
          </td>
        </tr>
      </tbody>

      <tfoot>
        <tr data-testid="rp-total" class="bg-elevated font-semibold">
          <td class="sticky bottom-0 left-0 z-[11] rounded-bl-lg border-t border-l border-default bg-elevated px-3 py-2">
            รวมทั้งหมด
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ formatInt(summary.builds) }}
            <div class="text-xs text-dimmed">
              {{ formatInt(summary.accounts) }} บัญชี
            </div>
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ formatInt(summary.approved) }}
            <div class="text-xs text-dimmed">
              {{ formatPostPercent(summary.approvedRate) }}
            </div>
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ formatPostHours(summary.hoursMedian) }}
            <div class="text-xs text-dimmed">
              P90 {{ formatPostHours(summary.hoursP90) }}
            </div>
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ formatInt(summary.rejected) }}
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ REPORT_DASH }}
            <div class="text-xs text-dimmed">
              {{ formatInt(summary.banned) }} แบน
            </div>
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            <MoneyCell
              data-testid="rp-total-spend"
              total
              :thb="summary.spend"
              :by-currency="summary.spendByCurrency ?? {}"
              :unconverted="summary.spendUnconverted ?? null"
            />
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(summary.utm.depositAmount) }}
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ formatDecimal(summary.depPerBudget) }}
          </td>
          <td class="sticky bottom-0 z-10 border-t border-default bg-elevated px-3 py-2 text-right tabular-nums">
            {{ formatThb(summary.costPerDep, 2) }}
          </td>
          <td class="sticky bottom-0 z-10 rounded-br-lg border-t border-r border-default bg-elevated px-3 py-2" />
        </tr>
      </tfoot>
    </table>

    <p v-else class="px-3 py-4 text-center text-sm text-muted" data-testid="rp-table-empty">
      ไม่มีรายการในช่วงนี้
    </p>
  </div>
</template>
