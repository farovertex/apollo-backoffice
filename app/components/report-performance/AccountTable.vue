<script setup lang="ts">
/**
 * FEAT-069 — tab "แยกตามบัญชี" (`rf-table-account`): one row per advertiser of the scope with spend in the
 * range or alive now. Account (label → loginEmail) · Workspace (GOD) · Advertiser · UTM campaign(s) · Spend ·
 * Status now (`perfStateBadge`). Sorted by spend desc until a header is clicked.
 */
import type { PerfAccountRow } from '#shared/types/report-performance'

const props = defineProps<{
  rows: PerfAccountRow[]
  isGod: boolean
}>()

type Col = 'account' | 'workspace' | 'advertiser' | 'utm' | 'spend' | 'state'

const STATE_ORDER = ['banned', 'needsHuman', 'loggedOut', 'notDelivering', 'launching', 'idle']

function valueOf(row: PerfAccountRow, col: Col): number | string | null {
  switch (col) {
    case 'account': return perfAccountName(row.account)
    case 'workspace': return row.workspace?.name ?? ''
    case 'advertiser': return row.advertiser.name ?? row.advertiser.id
    case 'utm': return row.utmCampaigns.join(', ')
    case 'spend': return row.spend
    case 'state': return STATE_ORDER.indexOf(row.state)
  }
}

const sort = usePerfSort<Col>('spend')

const cols = computed(() => {
  const list: { key: Col, label: string, numeric?: boolean }[] = [
    { key: 'account', label: 'Account' }
  ]
  if (props.isGod) list.push({ key: 'workspace', label: 'Workspace' })
  list.push(
    { key: 'advertiser', label: 'Advertiser' },
    { key: 'utm', label: 'UTM campaign' },
    { key: 'spend', label: 'Spend', numeric: true },
    { key: 'state', label: 'Status now' }
  )
  return list
})

/** FEAT-069 (T2c) — only `spend` and `state` have a help text; the name/account/workspace/UTM columns do not */
function helpKeyOf(key: Col): string | undefined {
  return key === 'spend' || key === 'state' ? `rf-table-account-col-${key}` : undefined
}

const shown = computed(() => [...props.rows].sort((a, b) =>
  perfCompare(valueOf(a, sort.col.value), valueOf(b, sort.col.value), sort.dir.value)
  || String(a.advertiser.name ?? '').localeCompare(String(b.advertiser.name ?? ''))
))

const totalSpend = computed(() => props.rows.reduce((sum, r) => sum + r.spend, 0))
/** FEAT-084 — the footer's raw breakdown (same-currency sums of the rows' `spendByCurrency`, never a conversion) */
const footerByCurrency = computed(() => mergeByCurrency(props.rows.map(r => r.spendByCurrency)))
const footerUnconverted = computed(() => mergeUnconverted(props.rows.map(r => r.spendUnconverted)))
</script>

<template>
  <div class="min-w-0 overflow-x-auto rounded-lg border border-default">
    <table class="w-full text-sm whitespace-nowrap" data-testid="rf-table-account">
      <thead>
        <tr class="border-b border-default">
          <ReportPerformanceSortTh
            v-for="(c, i) in cols"
            :key="c.key"
            :testid="`rf-account-sort-${c.key}`"
            :label="c.label"
            :sort-state="sort.ariaSort(c.key)"
            :numeric="c.numeric"
            :sticky="i === 0"
            :help-id="helpKeyOf(c.key)"
            :help-text="helpKeyOf(c.key) ? REPORT_HELP[helpKeyOf(c.key)!] : undefined"
            @sort="sort.toggle(c.key)"
          />
        </tr>
      </thead>
      <tbody>
        <tr v-if="rows.length === 0">
          <td :colspan="cols.length" class="px-3 py-4 text-center text-sm text-muted">
            ไม่มีบัญชีในช่วงนี้
          </td>
        </tr>
        <tr
          v-for="row in shown"
          :key="row.advertiser.id"
          class="border-b border-default/60"
          data-testid="rf-account-row"
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
            <div class="truncate">
              {{ row.advertiser.name ?? REPORT_DASH }}
            </div>
            <div class="text-xs text-muted">
              {{ last4(row.advertiser.tiktokAdvertiserId) }}
            </div>
          </td>
          <td class="max-w-48 truncate px-3 py-2 text-muted" :title="row.utmCampaigns.join(', ')">
            {{ row.utmCampaigns.length > 0 ? row.utmCampaigns.join(', ') : REPORT_DASH }}
          </td>
          <td class="px-3 py-2 text-right tabular-nums" :class="row.spend ? '' : 'text-dimmed'">
            <MoneyCell
              data-testid="rf-account-spend"
              :thb="row.spend"
              :by-currency="row.spendByCurrency ?? {}"
              :unconverted="row.spendUnconverted ?? null"
            />
          </td>
          <td class="px-3 py-2">
            <ReportPerformanceStateBadge :state="row.state" testid="rf-account-state" />
          </td>
        </tr>
      </tbody>
      <tfoot v-if="rows.length > 0">
        <tr class="border-t border-default bg-elevated/50 font-semibold" data-testid="rf-account-footer">
          <td class="sticky left-0 z-[1] bg-elevated px-3 py-2">
            รวม {{ formatInt(rows.length) }} advertiser
          </td>
          <td v-if="isGod" />
          <td />
          <td />
          <td class="px-3 py-2 text-right tabular-nums">
            <MoneyCell
              total
              :thb="totalSpend"
              :by-currency="footerByCurrency"
              :unconverted="footerUnconverted"
            />
          </td>
          <td />
        </tr>
      </tfoot>
    </table>
  </div>
</template>
