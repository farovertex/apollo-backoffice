<script setup lang="ts">
/**
 * FEAT-043 — `/reports/banned` table (api-contract.md §3 `rb-table`). One flat row per banned advertiser (no
 * nesting, unlike `ReportSummaryGroupTable`'s account→advertiser groups) and **no sortable headers** — the
 * API fixes the order (`bannedAt` desc, null last, tie by advertiser id). The footer always comes from the
 * response's top-level counts and `totals`, never from summing the visible rows (pagination makes that wrong).
 *
 * FEAT-047 — adds the "Launched" column (`rb-row-launched`) between Advertiser and Banned at, mirroring
 * `rb-row-banned`'s `formatDateTime`/`data-iso` handling; footer first cell `colspan` 3 → 4.
 *
 * FEAT-056 — per-advertiser campaign expansion (spec "UI behaviour", AC-25). The chevron `rb-expand` is put
 * **inside** the existing account cell instead of a new leading column on purpose: a new column would change
 * `rb-foot`'s `colspan` (4) and the FEAT-043 spec asserts it. An icon-only `UButton` adds no text, so the
 * account cell's exact-text assertions keep passing. The expansion is one extra `<tr>` per open row; the
 * request and its state belong to the page, this component only renders and emits.
 */
import type { BannedCampaignsState, BannedRow } from '#shared/types/report-banned'
import type { KpiMetrics } from '#shared/types/reports'

const props = withDefaults(defineProps<{
  rows: BannedRow[]
  totals: KpiMetrics
  adCount: number
  advertiserCount: number
  accountCount: number
  pending?: boolean
  /** advertiser ids whose campaign table is open */
  expanded?: string[]
  /** per-advertiser campaign state, keyed by advertiser id */
  campaigns?: Record<string, BannedCampaignsState>
}>(), {
  pending: false,
  expanded: () => [],
  campaigns: () => ({})
})

const emit = defineEmits<{ 'toggle-expand': [id: string], 'retry-campaigns': [id: string] }>()

function isExpanded(id: string): boolean {
  return props.expanded.includes(id)
}

const METRIC_COLUMNS: { field: keyof KpiMetrics | 'adCount', label: string, format: 'int' | 'dec' | 'pct' }[] = [
  { field: 'adCount', label: 'โฆษณา', format: 'int' },
  { field: 'spend', label: 'Spend', format: 'dec' },
  { field: 'impressions', label: 'Impr.', format: 'int' },
  { field: 'clicks', label: 'Clicks', format: 'int' },
  { field: 'ctr', label: 'CTR', format: 'pct' },
  { field: 'cpc', label: 'CPC', format: 'dec' },
  { field: 'conversions', label: 'Conv.', format: 'int' },
  { field: 'conversionCost', label: 'CPA', format: 'dec' }
]

/** account + advertiser + launched + banned (4) plus every metric column */
const expansionSpan = 4 + METRIC_COLUMNS.length

/** `adCount` lives on the row itself, every other column reads the row's `metrics`. */
function cellValue(row: BannedRow, field: string): number | null {
  return field === 'adCount' ? row.adCount : row.metrics[field as keyof KpiMetrics]
}

function footValue(field: string): number | null {
  return field === 'adCount' ? props.adCount : props.totals[field as keyof KpiMetrics]
}

function formatField(value: number | null, format: 'int' | 'dec' | 'pct'): string {
  if (format === 'int') return formatInt(value)
  if (format === 'pct') return formatPercent(value)
  return formatDecimal(value)
}
</script>

<template>
  <div class="min-w-0 overflow-x-auto" data-testid="rb-table">
    <table class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr class="bg-elevated/50">
          <th
            scope="col"
            class="rounded-l-lg border-y border-l border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
          >
            TikTok account
          </th>
          <th
            scope="col"
            class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
          >
            Advertiser
          </th>
          <th
            scope="col"
            class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
          >
            วันที่ยิงแอด
          </th>
          <th
            scope="col"
            class="border-y border-default px-2 py-2 text-left font-semibold whitespace-nowrap text-highlighted"
          >
            วันที่โดนแบน
          </th>
          <th
            v-for="(column, index) in METRIC_COLUMNS"
            :key="column.field"
            scope="col"
            class="border-y border-default px-2 py-2 text-right font-semibold whitespace-nowrap text-highlighted"
            :class="index === METRIC_COLUMNS.length - 1 ? 'rounded-r-lg border-r' : ''"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody :class="pending ? 'opacity-60' : ''">
        <template v-for="row in rows" :key="row.advertiser.id">
          <tr
            data-testid="rb-row"
            :data-id="row.advertiser.id"
            :data-account="row.account.id"
            :data-ads="row.adCount"
            :data-expanded="isExpanded(row.advertiser.id) ? 'true' : 'false'"
          >
            <td class="border-b border-default px-2 py-2" data-testid="rb-row-account">
              <div class="flex min-w-0 items-center gap-1">
                <UButton
                  :icon="isExpanded(row.advertiser.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  class="shrink-0"
                  :aria-expanded="isExpanded(row.advertiser.id)"
                  :aria-label="`แคมเปญของ ${row.advertiser.name || row.advertiser.id}`"
                  data-testid="rb-expand"
                  :data-id="row.advertiser.id"
                  @click="emit('toggle-expand', row.advertiser.id)"
                />
                <div class="flex min-w-0 flex-col">
                  <span class="max-w-48 truncate" :title="row.account.label ?? row.account.loginEmail ?? ''">
                    {{ row.account.label || row.account.loginEmail || REPORT_DASH }}
                  </span>
                  <span class="text-xs text-muted">{{ row.workspace.name || REPORT_DASH }}</span>
                </div>
              </div>
            </td>
            <td class="border-b border-default px-2 py-2" data-testid="rb-row-advertiser">
              <div class="flex min-w-0 flex-col">
                <span class="max-w-44 truncate" :title="row.advertiser.name">
                  {{ row.advertiser.name || REPORT_DASH }}
                </span>
                <span class="text-xs text-muted" :title="row.advertiser.tiktokAdvertiserId">
                  aadvid {{ last4(row.advertiser.tiktokAdvertiserId) }}
                </span>
              </div>
            </td>
            <td
              class="border-b border-default px-2 py-2 whitespace-nowrap tabular-nums"
              data-testid="rb-row-launched"
              :data-iso="row.launchedAt ?? ''"
            >
              {{ formatDateTime(row.launchedAt) }}
            </td>
            <td
              class="border-b border-default px-2 py-2 whitespace-nowrap tabular-nums"
              data-testid="rb-row-banned"
              :data-iso="row.bannedAt ?? ''"
            >
              {{ formatDateTime(row.bannedAt) }}
            </td>
            <td
              v-for="column in METRIC_COLUMNS"
              :key="column.field"
              class="border-b border-default px-2 py-2 text-right tabular-nums"
              :data-field="column.field"
            >
              {{ formatField(cellValue(row, column.field), column.format) }}
            </td>
          </tr>

          <tr
            v-if="isExpanded(row.advertiser.id)"
            data-testid="rb-expansion"
            :data-id="row.advertiser.id"
          >
            <td :colspan="expansionSpan" class="border-b border-default bg-elevated/30 px-2 py-2">
              <ReportBannedCampaigns
                :advertiser-id="row.advertiser.id"
                :state="campaigns[row.advertiser.id]"
                @retry="emit('retry-campaigns', row.advertiser.id)"
              />
            </td>
          </tr>
        </template>
      </tbody>
      <tfoot>
        <tr
          data-testid="rb-foot"
          :data-ads="adCount"
          :data-advertisers="advertiserCount"
          :data-accounts="accountCount"
          class="bg-elevated font-semibold"
        >
          <td colspan="4" class="rounded-bl-lg border-t border-l border-default px-2 py-2">
            รวมทั้งหมด · {{ formatInt(adCount) }} โฆษณา · {{ formatInt(advertiserCount) }} advertisers · {{ formatInt(accountCount) }} บัญชี
          </td>
          <td
            v-for="(column, index) in METRIC_COLUMNS"
            :key="column.field"
            class="border-t border-default px-2 py-2 text-right tabular-nums"
            :class="index === METRIC_COLUMNS.length - 1 ? 'rounded-br-lg border-r' : ''"
            :data-field="column.field"
          >
            {{ formatField(footValue(column.field), column.format) }}
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
