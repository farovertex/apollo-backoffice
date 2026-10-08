<script setup lang="ts">
/**
 * FEAT-035 — table 1 of `/reports/summary` (api-contract.md §3 `rs-groups`): one row per TikTok account
 * (subtotal) with its advertiser rows nested under it, ending in a `<tfoot>` grand total. The whole grouped
 * set is already on the client (AS-3 — not paginated), so sorting is pure JS (`sortGroups`,
 * `app/utils/report-summary.ts`) and never issues a request — unlike table 2, which is paginated and sorts
 * server-side.
 *
 * The footer always comes from the API's `totals`/`adCount`/`advertiserCount`/`accountCount` (the top-level
 * numbers of `GroupedReportResponse`), never from summing the visible rows, and it never takes part in sorting.
 */
import type { GroupedAccount, GroupSortField } from '#shared/types/report-summary'
import type { KpiMetrics } from '#shared/types/reports'

const props = withDefaults(defineProps<{
  accounts: GroupedAccount[]
  totals: KpiMetrics
  adCount: number
  advertiserCount: number
  accountCount: number
  /** e.g. `-spend` */
  sort: string
  pending?: boolean
}>(), {
  pending: false
})

const emit = defineEmits<{
  'update:sort': [value: string]
}>()

const METRIC_COLUMNS: { field: GroupSortField, label: string, format: 'int' | 'dec' | 'pct' }[] = [
  { field: 'adCount', label: 'โฆษณา', format: 'int' },
  { field: 'spend', label: 'Spend', format: 'dec' },
  { field: 'impressions', label: 'Impr.', format: 'int' },
  { field: 'clicks', label: 'Clicks', format: 'int' },
  { field: 'ctr', label: 'CTR', format: 'pct' },
  { field: 'cpc', label: 'CPC', format: 'dec' },
  { field: 'conversions', label: 'Conv.', format: 'int' },
  { field: 'conversionCost', label: 'CPA', format: 'dec' }
]

const sortedAccounts = computed(() => sortGroups(props.accounts, props.sort))
const activeSort = computed(() => parseGroupSort(props.sort))

function ariaSort(field: GroupSortField): 'ascending' | 'descending' | 'none' {
  if (activeSort.value.field !== field) return 'none'
  return activeSort.value.desc ? 'descending' : 'ascending'
}

function toggle(field: GroupSortField) {
  emit('update:sort', toggleGroupSort(props.sort, field))
}

/** `adCount` lives on the row itself, every other column reads the row's `metrics`. */
function cellValue(row: { adCount: number, metrics: KpiMetrics }, field: GroupSortField): number | null {
  return field === 'adCount' ? row.adCount : row.metrics[field]
}

function formatField(value: number | null, format: 'int' | 'dec' | 'pct'): string {
  if (format === 'int') return formatInt(value)
  if (format === 'pct') return formatPercent(value)
  return formatDecimal(value)
}
</script>

<template>
  <div class="min-w-0 overflow-x-auto" data-testid="rs-groups">
    <table class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr class="bg-elevated/50">
          <th
            scope="col"
            class="rounded-l-lg border-y border-l border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
          >
            บัญชี / Advertiser
          </th>
          <th
            v-for="(column, index) in METRIC_COLUMNS"
            :key="column.field"
            scope="col"
            class="cursor-pointer select-none border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted"
            :class="index === METRIC_COLUMNS.length - 1 ? 'rounded-r-lg border-r' : ''"
            :aria-sort="ariaSort(column.field)"
            :data-testid="`rs-gsort-${column.field}`"
            tabindex="0"
            @click="toggle(column.field)"
            @keydown.enter.prevent="toggle(column.field)"
            @keydown.space.prevent="toggle(column.field)"
          >
            {{ column.label }}
            <span v-if="activeSort.field === column.field" aria-hidden="true">{{ activeSort.desc ? '▼' : '▲' }}</span>
          </th>
        </tr>
      </thead>
      <tbody :class="pending ? 'opacity-60' : ''">
        <template v-for="account in sortedAccounts" :key="account.account.id">
          <tr
            data-testid="rs-acc-row"
            :data-id="account.account.id"
            :data-ads="account.adCount"
            :data-advertisers="account.advertiserCount"
            class="bg-default"
          >
            <td class="border-b border-default px-2 py-2 font-semibold">
              <div class="flex min-w-0 flex-col">
                <NuxtLink
                  :to="`/reports?tiktokAccountId=${account.account.id}`"
                  class="max-w-48 truncate text-primary hover:underline"
                  :title="account.account.label ?? ''"
                  data-testid="rs-acc-name"
                >
                  {{ account.account.label || REPORT_DASH }}
                </NuxtLink>
                <span class="text-xs font-normal text-muted">
                  {{ account.workspace.name || REPORT_DASH }} · {{ account.advertiserCount }} advertisers
                </span>
              </div>
            </td>
            <td
              v-for="column in METRIC_COLUMNS"
              :key="column.field"
              class="border-b border-default px-2 py-2 text-right font-semibold tabular-nums"
              :data-field="column.field"
            >
              {{ formatField(cellValue(account, column.field), column.format) }}
            </td>
          </tr>
          <tr
            v-for="advertiser in account.advertisers"
            :key="advertiser.advertiser.id"
            data-testid="rs-adv-row"
            :data-id="advertiser.advertiser.id"
            :data-account="account.account.id"
          >
            <td class="border-b border-default px-2 py-2 pl-6">
              <div class="flex min-w-0 flex-col">
                <NuxtLink
                  :to="`/reports?advertiserId=${advertiser.advertiser.id}`"
                  class="max-w-44 truncate text-primary hover:underline"
                  :title="advertiser.advertiser.name"
                  data-testid="rs-adv-name"
                >
                  {{ advertiser.advertiser.name || REPORT_DASH }}
                </NuxtLink>
                <span class="text-xs text-muted" :title="advertiser.advertiser.tiktokAdvertiserId">
                  aadvid {{ last4(advertiser.advertiser.tiktokAdvertiserId) }}
                </span>
              </div>
            </td>
            <td
              v-for="column in METRIC_COLUMNS"
              :key="column.field"
              class="border-b border-default px-2 py-2 text-right tabular-nums"
              :data-field="column.field"
            >
              {{ formatField(cellValue(advertiser, column.field), column.format) }}
            </td>
          </tr>
        </template>
      </tbody>
      <tfoot>
        <tr data-testid="rs-groups-foot" :data-ads="adCount" class="bg-elevated font-semibold">
          <td class="rounded-bl-lg border-t border-l border-default px-2 py-2">
            รวมทั้งหมด · {{ formatInt(adCount) }} โฆษณา · {{ formatInt(advertiserCount) }} advertisers · {{ formatInt(accountCount) }} บัญชี
          </td>
          <td
            v-for="(column, index) in METRIC_COLUMNS"
            :key="column.field"
            class="border-t border-default px-2 py-2 text-right tabular-nums"
            :class="index === METRIC_COLUMNS.length - 1 ? 'rounded-br-lg border-r' : ''"
            :data-field="column.field"
          >
            {{ formatField(column.field === 'adCount' ? adCount : totals[column.field], column.format) }}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
