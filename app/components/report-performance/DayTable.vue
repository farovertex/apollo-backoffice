<script setup lang="ts">
/**
 * FEAT-069 — tab "รายวัน" (`rf-table-day`): one row per day of the range, newest first (API order), no sort;
 * footer "ทั้งช่วง" = sums, except Used, which is the range's distinct count (`results.usedAdvertisers`).
 * `range=all` → `byDay` is `[]` and the note `rf-day-empty` replaces the table.
 * FEAT-084 — `spend` is THB (`MoneyCell`, raw `THB x + USD y` sub, `+n ?` for `spendUnconverted`).
 */
import type { PerfDayRow } from '#shared/types/report-performance'

const props = defineProps<{
  rows: PerfDayRow[]
  isAll: boolean
  usedTotal: number
  today: string
}>()

const totals = computed(() => {
  const t = { spend: 0, bans: 0, lifted: 0, total: 0, done: 0, failed: 0, stopped: 0, running: 0 }
  for (const r of props.rows) {
    t.spend += r.spend
    t.bans += r.bans
    t.lifted += r.lifted
    t.total += r.builds.total
    t.done += r.builds.done
    t.failed += r.builds.failed
    t.stopped += r.builds.stopped
    t.running += r.builds.running
  }
  return t
})

const footerByCurrency = computed(() => mergeByCurrency(props.rows.map(r => r.spendByCurrency)))
const footerUnconverted = computed(() => mergeUnconverted(props.rows.map(r => r.spendUnconverted)))

const HEADERS: { label: string, key?: string }[] = [
  { label: 'Day' },
  { label: 'Spend', key: 'rf-table-day-col-spend' },
  { label: 'Used', key: 'rf-table-day-col-used' },
  { label: 'New bans', key: 'rf-table-day-col-bans' },
  { label: 'Lifted', key: 'rf-table-day-col-lifted' },
  { label: 'Runs', key: 'rf-table-day-col-runs' },
  { label: 'Done', key: 'rf-table-day-col-done' },
  { label: 'Failed', key: 'rf-table-day-col-failed' },
  { label: 'Stopped', key: 'rf-table-day-col-stopped' },
  { label: 'Running', key: 'rf-table-day-col-running' }
]

function dim(value: number): string {
  return value === 0 ? 'text-dimmed' : ''
}
</script>

<template>
  <div
    v-if="isAll"
    class="rounded-lg border border-dashed border-default p-6 text-center text-sm text-muted"
    data-testid="rf-day-empty"
  >
    เลือกช่วงวันเพื่อดูรายวัน
  </div>
  <div v-else class="min-w-0 overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm whitespace-nowrap" data-testid="rf-table-day">
      <thead>
        <tr class="border-b border-default">
          <th
            v-for="(h, i) in HEADERS"
            :key="h.label"
            scope="col"
            class="bg-elevated px-3 py-2 text-xs font-medium text-muted uppercase"
            :class="i === 0 ? 'sticky left-0 z-[2] text-left' : 'text-right'"
          >
            <span class="inline-flex items-center gap-1" :class="i === 0 ? '' : 'justify-end'">
              <span>{{ h.label }}</span>
              <ReportsInfoHint v-if="h.key" :id="h.key" :text="REPORT_HELP[h.key]!" />
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.day"
          class="border-b border-default/60"
          data-testid="rf-day-row"
          :data-id="row.day"
        >
          <td class="sticky left-0 z-[1] bg-default px-3 py-2">
            {{ formatRangeDay(row.day) }}
            <UBadge
              v-if="row.day === today"
              label="วันนี้"
              size="sm"
              variant="subtle"
              class="ml-1"
            />
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="dim(row.spend)">
            <MoneyCell
              data-testid="rf-day-spend"
              :thb="row.spend"
              :by-currency="row.spendByCurrency ?? {}"
              :unconverted="row.spendUnconverted ?? null"
            />
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="dim(row.used)">
            {{ formatInt(row.used) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="row.bans > 0 ? 'text-error' : 'text-dimmed'">
            {{ formatInt(row.bans) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="dim(row.lifted)">
            {{ formatInt(row.lifted) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="dim(row.builds.total)">
            {{ formatInt(row.builds.total) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="dim(row.builds.done)">
            {{ formatInt(row.builds.done) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="row.builds.failed > 0 ? 'text-error' : 'text-dimmed'">
            {{ formatInt(row.builds.failed) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="dim(row.builds.stopped)">
            {{ formatInt(row.builds.stopped) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="dim(row.builds.running)">
            {{ formatInt(row.builds.running) }}
          </td>
        </tr>
      </tbody>
      <tfoot>
        <tr class="border-t border-default bg-elevated/50 font-semibold" data-testid="rf-day-footer">
          <td class="sticky left-0 z-[1] bg-elevated px-3 py-2">
            ทั้งช่วง
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            <MoneyCell
              total
              :thb="totals.spend"
              :by-currency="footerByCurrency"
              :unconverted="footerUnconverted"
            />
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(usedTotal) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.bans) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.lifted) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.total) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.done) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.failed) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.stopped) }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums">
            {{ formatInt(totals.running) }}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
