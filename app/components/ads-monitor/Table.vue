<script setup lang="ts">
/**
 * FEAT-056 — `am-table`: one table component for all three tabs (spec "UI behaviour" → table). The column
 * **set** is chosen by `level`, the rendering of a column is shared, so the Campaign / Ad group / Ad tabs can
 * never drift apart in formatting. No client sort (the API fixes the order), no client sum: the footer
 * `am-total` always prints the response's `totals` (AC-20).
 *
 * Like `ReportBannedTable` this is a plain `<table>` inside a scroll wrapper — the **table** scrolls sideways
 * on tablet/mobile, the page never does (AC-24).
 *
 * T11 (api-contract.md v1.3 §8.3, spec "Human change 2026-10-19 14:00") — the Order **column** is removed on
 * all three tabs (the `am-filter-order` filter and the `orderIds` keys stay); the campaign tab gains a
 * รูปโฆษณา column right after ชื่อ (`ReportsAdThumb` + an eye button `am-row-covers-btn`) that asks the page to
 * open the "all ad images" modal (`show-covers`), mirroring `report-banned/Table.vue`'s `rb-row-covers-btn`.
 *
 * TASK-campaign-delete-ui — the campaign tab gains a **last** column "ลบ" (`AdsMonitorDeleteCell`); no other
 * column moves and the other two tabs are untouched, because the column set is picked by `level`. A row whose
 * `deletedAt` is set is dimmed (`opacity-60`, `data-deleted="true"`) on all three tabs.
 *
 * FEAT-060 — the campaign tab gains a column "งบ advertiser" (`AdsMonitorBudgetCell`) right after "บัญชี /
 * advertiser" and before the campaign's own "งบประมาณ" (spec "UI behaviour"); no other column moves and the
 * Ad group / Ad tabs are untouched.
 *
 * FEAT-064 — the old "บัญชี / advertiser" column is **removed on all three tabs**; its text (account label /
 * email + advertiser name) moves into the merged `name` cell (`am-row-name`, spec "UI behaviour" → Merged
 * column), so "nothing else moves": `status`, `advertiserBudget`, `cover` etc. keep their position, only the
 * `account` column is gone (`advertiserBudget` now immediately follows `status` on the campaign tab). The
 * `name` header becomes a real collapse button (`am-name-collapse`, state owned by the page, persisted in
 * `localStorage`) and each row's `am-row-name` gains a per-row campaign filter button (`am-row-filter`,
 * contract §5). The TikTok id moves out of the cell's visible text into the cell's `title` only.
 *
 * T9 — sticky header (spec "UI behaviour" → "Sticky header"): `am-table` owns its OWN vertical scrollbox
 * (`max-h-[70vh] overflow-auto`) rather than relying on the outer `UDashboardPanel` body scroll. Measured
 * first: on this page the real vertical scroller is that panel's `data-slot="body"` div, several ancestors
 * above `am-table` — but a `th` can only `position: sticky` against its *nearest* ancestor scroll container,
 * and `overflow-x: auto` on this wrapper already makes it one (the CSS spec forces the paired `overflow-y`
 * from `visible` to `auto` the moment `overflow-x` isn't `visible`), so a `thead th` here can never pin to
 * the panel further out — tried, and it does not stick. Giving `am-table` a bounded height makes it the one
 * real scroll container for both axes, so `sticky top-0` on each `th` pins against the box the horizontal
 * scroll already lives in — same container, so it also scrolls sideways with the body (no misalignment).
 * `bg-elevated` (opaque, not `/50`) on both the row and each `th` keeps rows from showing through underneath;
 * `z-10` keeps it above `USwitch` / badges. `am-total` (the `tfoot` totals row) is pinned the same way at the
 * other edge — `sticky bottom-0 z-10 bg-elevated` on each `td` (a `tr` cannot be sticky in a `border-separate`
 * table, so the cells carry it, exactly like the `th`s) — so header and totals stay in view together while
 * the rows scroll between them. With fewer rows than the box's height it simply sits where it always did.
 * `overscroll-contain` on the box stops scroll chaining: once the rows are scrolled to either end, the wheel /
 * touch scroll no longer spills over into the panel body (which still scrolls, since interval + tabs + filters +
 * the 70vh box + pagination exceed the viewport), so the pinned header and totals row stay put instead of the
 * whole box sliding with the page. Scrolling with the pointer outside the table still moves the page as before.
 *
 * FEAT-067 — a collapsible "UTM" column (`AdsMonitorUtmCell`, spec "UI behaviour" → Cell / contract §4) is
 * inserted right after `name` on the ad-group / ad tabs and right after `cover` on the campaign tab; nothing
 * else moves. Its own `utmCollapsed` / `am-utm-collapse` mirror `nameCollapsed` / `am-name-collapse` exactly
 * but are an **independent** page-level ref — collapsing one never affects the other. The cell needs the
 * monitor's current range (`range` prop) to build its `/reports/utm` links.
 */
import type { MonitorLevel, MonitorRow, ToggleTarget } from '#shared/types/ads-monitor'
import type { KpiMetrics, ReportRangeState } from '#shared/types/reports'
import type { MoneyByCurrency, MoneyUnconverted } from '#shared/types/fx'
import type { MoneyMode } from '~/utils/money'

const props = defineProps<{
  level: MonitorLevel
  rows: MonitorRow[]
  totals: KpiMetrics
  pending?: boolean
  /** FEAT-064 — page-level state, shared by all three tabs, persisted by the page in `localStorage`. */
  nameCollapsed?: boolean
  /** FEAT-067 — same pattern as `nameCollapsed`, independent of it. */
  utmCollapsed?: boolean
  /** FEAT-067 — the monitor's current range (`rangeState`); the UTM cell's links always carry it (spec A5). */
  range: ReportRangeState
  /** FEAT-064 — the campaign id currently in the URL (`?campaignId=`), drives `am-row-filter`'s pressed state */
  campaignId?: string
  /** FEAT-084 — the page's money mode (`useMoneyMode('ads-monitor')`), default `thb` */
  mode?: MoneyMode
  /** FEAT-084 — response-level raw breakdown of `totals.spend` (THB), for the Total row's sub line */
  spendByCurrency?: MoneyByCurrency
  spendUnconverted?: MoneyUnconverted
}>()

const emit = defineEmits<{
  'toggle': [row: MonitorRow, target: ToggleTarget]
  'show-covers': [row: MonitorRow]
  /** TASK-campaign-delete-ui — campaign tab only: the row asks the page to open the confirm modal */
  'delete': [row: MonitorRow]
  /** FEAT-060 — campaign tab only: the row asks the page to open the budget modal */
  'budget': [row: MonitorRow]
  /** FEAT-064 — the `am-name-collapse` header button toggled */
  'update:name-collapsed': [value: boolean]
  /** FEAT-067 — the `am-utm-collapse` header button toggled */
  'update:utm-collapsed': [value: boolean]
  /** FEAT-064 — a row's `am-row-filter` was pressed; the page decides whether that narrows or clears (contract §5) */
  'filter-campaign': [campaignId: string]
}>()

/** TASK-campaign-delete-ui — a deleted row stays in the list, dimmed (`deletedAt` is set on all three tabs). */
function isDeleted(row: MonitorRow): boolean {
  return typeof row.deletedAt === 'string' && row.deletedAt !== ''
}

type Align = 'left' | 'right'
type Format = 'int' | 'dec' | 'pct'

interface Column {
  key: string
  label: string
  align: Align
  /** set on the metric columns only — everything before the first of them is the Total row's label cell */
  metric?: keyof KpiMetrics
  format?: Format
}

/** Spend · CPC · CPM · Impressions · Clicks · CTR · Conversions · CPA · CVR — identical on the three tabs. */
const METRIC_COLUMNS: Column[] = [
  { key: 'spend', label: 'Spend', align: 'right', metric: 'spend', format: 'dec' },
  { key: 'cpc', label: 'CPC', align: 'right', metric: 'cpc', format: 'dec' },
  { key: 'cpm', label: 'CPM', align: 'right', metric: 'cpm', format: 'dec' },
  { key: 'impressions', label: 'Impressions', align: 'right', metric: 'impressions', format: 'int' },
  { key: 'clicks', label: 'Clicks', align: 'right', metric: 'clicks', format: 'int' },
  { key: 'ctr', label: 'CTR', align: 'right', metric: 'ctr', format: 'pct' },
  { key: 'conversions', label: 'Conversions', align: 'right', metric: 'conversions', format: 'int' },
  { key: 'conversionCost', label: 'CPA', align: 'right', metric: 'conversionCost', format: 'dec' },
  { key: 'conversionRate', label: 'CVR', align: 'right', metric: 'conversionRate', format: 'pct' }
]

const HEAD: Column[] = [
  { key: 'switch', label: 'On/off', align: 'left' },
  { key: 'name', label: 'ชื่อ', align: 'left' },
  // FEAT-067 — right after `name` on the ad-group / ad tabs (spec "UI behaviour" → Column placement)
  { key: 'utm', label: 'UTM', align: 'left' },
  { key: 'status', label: 'สถานะ', align: 'left' }
]

/**
 * `HEAD` is `[switch, name, utm, status]`; the cover column is spliced in right after `name` (index 2, before
 * `utm`) so the order stays switch → name → รูปโฆษณา → UTM → status, exactly as the spec lists it (FEAT-067 —
 * `utm` right after `cover` on the campaign tab, not after `name` like the other two tabs).
 */
const CAMPAIGN_HEAD: Column[] = [
  ...HEAD.slice(0, 2),
  { key: 'cover', label: 'รูปโฆษณา', align: 'left' },
  ...HEAD.slice(2)
]

const COLUMNS: Record<MonitorLevel, Column[]> = {
  campaign: [
    ...CAMPAIGN_HEAD,
    // FEAT-064 — the old "บัญชี / advertiser" column is gone (moved into `am-row-name`); advertiserBudget now
    // follows `status` directly, nothing else moves.
    { key: 'advertiserBudget', label: 'งบ advertiser', align: 'left' },
    { key: 'budget', label: 'งบประมาณ', align: 'right' },
    ...METRIC_COLUMNS,
    { key: 'adCount', label: 'โฆษณา', align: 'right' },
    // TASK-campaign-delete-ui — campaign tab only, always the **last** column (nothing else moves)
    { key: 'delete', label: 'ลบ', align: 'left' }
  ],
  adGroup: [
    ...HEAD,
    { key: 'campaign', label: 'แคมเปญ', align: 'left' },
    { key: 'budget', label: 'งบประมาณ', align: 'right' },
    { key: 'bid', label: 'Bid', align: 'left' },
    { key: 'schedule', label: 'ตารางเวลา', align: 'left' },
    ...METRIC_COLUMNS
  ],
  ad: [
    ...HEAD,
    { key: 'source', label: 'Source', align: 'left' },
    { key: 'adGroup', label: 'กลุ่มโฆษณา', align: 'left' },
    ...METRIC_COLUMNS
  ]
}

const columns = computed(() => COLUMNS[props.level])
/** the Total row's label cell spans everything in front of the first metric column */
const labelSpan = computed(() => {
  const index = columns.value.findIndex(column => column.metric)
  return index < 0 ? columns.value.length : index
})
const footColumns = computed(() => columns.value.slice(labelSpan.value))

function formatMetric(value: number | null, format: Format | undefined): string {
  if (format === 'int') return formatInt(value)
  if (format === 'pct') return formatPercent(value)
  return formatDecimal(value)
}

function accountLabel(row: MonitorRow): string {
  return row.account.label || row.account.loginEmail || REPORT_DASH
}

/**
 * FEAT-064 — tooltip of the merged `name` cell: `"<name> · <id> · <account> · <advertiser> · <aadvid last4>"`
 * (spec "UI behaviour" → Merged column). The TikTok id lives here, never as visible text.
 */
function nameTitle(row: MonitorRow): string {
  const parts = [row.name || REPORT_DASH, row.id, accountLabel(row), row.advertiser.name || REPORT_DASH, last4(row.advertiser.tiktokAdvertiserId)]
  return parts.join(' · ')
}

/** FEAT-064 — campaign id of a row (contract §5): campaign tab = `row.id`, ad-group/ad tabs = `row.campaign.id`. */
function campaignIdOf(row: MonitorRow): string {
  return props.level === 'campaign' ? row.id : (row.campaign?.id ?? '')
}

function isCampaignFilterActive(row: MonitorRow): boolean {
  const id = campaignIdOf(row)
  return id !== '' && id === props.campaignId
}

function budgetText(row: MonitorRow): string {
  return formatDecimal(row.budget?.amount ?? null)
}

/**
 * FEAT-084 — money columns of a single-account row: Spend = raw `metrics.spend` + row `currency` with the stored
 * `spendThb` (R amount, hover = average rate); CPC / CPM / CPA in `thb` mode = `spendThb ÷ count` (`costThb`, a
 * division, no FX), in `account` mode the raw values. `null` = not a money column (rendered as before).
 */
const COST_PER: Partial<Record<keyof KpiMetrics, { count: keyof KpiMetrics, per: number }>> = {
  cpc: { count: 'clicks', per: 1 },
  cpm: { count: 'impressions', per: 1000 },
  conversionCost: { count: 'conversions', per: 1 }
}

function moneyOf(row: MonitorRow, metric: keyof KpiMetrics) {
  const currency = row.currency ?? null
  const spendThb = rowSpendThb(row.spendThb, row.spendUnconverted)
  if (metric === 'spend') {
    return {
      native: { amount: row.metrics.spend, currency },
      thb: spendThb,
      unconverted: row.spendUnconverted ?? null,
      rateText: currency && currency !== 'THB' ? averageRateText(spendThb, row.metrics.spend) : null,
      decimals: 0
    }
  }
  const cost = COST_PER[metric]
  if (!cost) return null
  const count = row.metrics[cost.count]
  return {
    native: { amount: row.metrics[metric], currency },
    thb: costThb(spendThb, typeof count === 'number' ? count : null, cost.per),
    unconverted: null,
    rateText: null,
    decimals: 2
  }
}

function bidText(row: MonitorRow): string {
  return row.bid?.pricing || row.bid?.strategy || REPORT_DASH
}

function bidTitle(row: MonitorRow): string {
  const parts = [row.bid?.strategy, row.bid?.pricing, row.bid?.optimizeGoal].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : ''
}

function scheduleText(row: MonitorRow): string {
  const schedule = row.schedule
  if (!schedule) return REPORT_DASH
  if (schedule.text) return schedule.text
  if (schedule.startAt || schedule.endAt) {
    return `${formatDateTime(schedule.startAt)} → ${formatDateTime(schedule.endAt)}`
  }
  return REPORT_DASH
}
</script>

<template>
  <div
    class="min-w-0 max-h-[70vh] overflow-auto overscroll-contain"
    data-testid="am-table"
    :data-level="level"
    :data-name-collapsed="nameCollapsed ? 'true' : 'false'"
    :data-utm-collapsed="utmCollapsed ? 'true' : 'false'"
  >
    <table class="w-full border-separate border-spacing-0 text-sm">
      <thead>
        <tr class="bg-elevated">
          <th
            v-for="(column, index) in columns"
            :key="column.key"
            scope="col"
            class="sticky top-0 z-10 border-y border-default bg-elevated px-2 py-2 font-semibold whitespace-nowrap text-highlighted"
            :class="[
              column.align === 'right' ? 'text-right' : 'text-left',
              index === 0 ? 'rounded-l-lg border-l' : '',
              index === columns.length - 1 ? 'rounded-r-lg border-r' : ''
            ]"
            :data-field="column.key"
          >
            <button
              v-if="column.key === 'name'"
              type="button"
              class="inline-flex items-center gap-1 font-semibold text-highlighted"
              data-testid="am-name-collapse"
              :aria-expanded="!nameCollapsed"
              :title="nameCollapsed ? 'ขยายคอลัมน์' : 'ย่อคอลัมน์'"
              @click="emit('update:name-collapsed', !nameCollapsed)"
            >
              <span>{{ nameCollapsed ? 'ชื่อ…' : 'ชื่อ / บัญชี / advertiser' }}</span>
              <UIcon :name="nameCollapsed ? 'i-lucide-chevrons-right' : 'i-lucide-chevrons-left'" class="size-4" />
            </button>
            <button
              v-else-if="column.key === 'utm'"
              type="button"
              class="inline-flex items-center gap-1 font-semibold text-highlighted"
              data-testid="am-utm-collapse"
              :aria-expanded="!utmCollapsed"
              :title="utmCollapsed ? 'ขยายคอลัมน์' : 'ย่อคอลัมน์'"
              @click="emit('update:utm-collapsed', !utmCollapsed)"
            >
              <span>UTM</span>
              <UIcon :name="utmCollapsed ? 'i-lucide-chevrons-right' : 'i-lucide-chevrons-left'" class="size-4" />
            </button>
            <template v-else>
              {{ column.label }}
            </template>
          </th>
        </tr>
      </thead>

      <tbody :class="pending ? 'opacity-60' : ''">
        <tr
          v-for="row in rows"
          :key="`${row.level}:${row.id}`"
          data-testid="am-row"
          :data-id="row.id"
          :data-level="row.level"
          :data-advertiser="row.advertiser.id"
          :data-deleted="isDeleted(row) ? 'true' : 'false'"
          :class="isDeleted(row) ? 'opacity-60' : ''"
        >
          <td
            v-for="column in columns"
            :key="column.key"
            class="border-b border-default px-2 py-2 align-top"
            :class="column.align === 'right' ? 'text-right tabular-nums' : ''"
            :data-field="column.key"
          >
            <MoneyCell
              v-if="column.metric && moneyOf(row, column.metric)"
              v-bind="moneyOf(row, column.metric)!"
              :mode="mode ?? 'thb'"
              :data-testid="`am-row-${column.key}`"
            />
            <template v-else-if="column.metric">
              {{ formatMetric(row.metrics[column.metric], column.format) }}
            </template>

            <AdsMonitorSwitchCell
              v-else-if="column.key === 'switch'"
              :row="row"
              @toggle="(target) => emit('toggle', row, target)"
            />

            <div
              v-else-if="column.key === 'name'"
              class="flex min-w-0 items-start gap-2"
              data-testid="am-row-name"
              :data-collapsed="nameCollapsed ? 'true' : 'false'"
            >
              <span
                v-if="level === 'ad'"
                class="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-elevated"
                data-testid="am-thumb"
                :data-kind="row.media?.isVideo ? 'video' : 'image'"
              >
                <img
                  v-if="row.media?.coverUrl"
                  :src="row.media.coverUrl"
                  alt=""
                  loading="lazy"
                  referrerpolicy="no-referrer"
                  class="size-full object-cover"
                >
                <UIcon
                  v-else
                  :name="row.media?.isVideo ? 'i-lucide-play' : 'i-lucide-image'"
                  class="size-4 text-dimmed"
                />
              </span>

              <span class="flex min-w-0 flex-col" :title="nameTitle(row)">
                <span
                  class="truncate"
                  :class="nameCollapsed ? 'max-w-28' : 'max-w-40'"
                  data-testid="am-row-name-text"
                >{{ row.name || REPORT_DASH }}</span>

                <span v-if="!nameCollapsed" class="flex min-w-0 flex-col" data-testid="am-row-account">
                  <span class="truncate text-xs text-muted" data-testid="am-row-account-label">{{ accountLabel(row) }}</span>
                  <span class="truncate text-xs text-muted" data-testid="am-row-advertiser">{{ row.advertiser.name || REPORT_DASH }}</span>
                </span>
              </span>

              <UButton
                icon="i-lucide-filter"
                size="xs"
                :color="isCampaignFilterActive(row) ? 'primary' : 'neutral'"
                :variant="isCampaignFilterActive(row) ? 'solid' : 'ghost'"
                :aria-pressed="isCampaignFilterActive(row) ? 'true' : 'false'"
                :aria-label="isCampaignFilterActive(row) ? 'ยกเลิกกรองแคมเปญนี้' : 'กรองเฉพาะแคมเปญนี้'"
                data-testid="am-row-filter"
                :data-campaign-id="campaignIdOf(row)"
                @click="emit('filter-campaign', campaignIdOf(row))"
              />
            </div>

            <AdsMonitorUtmCell
              v-else-if="column.key === 'utm'"
              :utm="row.utm"
              :collapsed="utmCollapsed"
              :range="range"
            />

            <div
              v-else-if="column.key === 'cover'"
              class="flex items-center gap-1.5"
              data-testid="am-row-cover"
            >
              <ReportsAdThumb :url="row.cover?.coverUrl ?? null" :is-video="row.cover?.isVideo ?? false" size="sm" />
              <UButton
                icon="i-lucide-eye"
                aria-label="ดูรูปโฆษณาทั้งหมด"
                color="neutral"
                variant="ghost"
                size="xs"
                data-testid="am-row-covers-btn"
                :data-id="row.id"
                @click="emit('show-covers', row)"
              />
            </div>

            <AdsMonitorStatusCell
              v-else-if="column.key === 'status'"
              :status="row.status"
              :deleted-at="row.deletedAt"
            />

            <AdsMonitorDeleteCell
              v-else-if="column.key === 'delete'"
              :row="row"
              @ask="emit('delete', row)"
            />

            <span
              v-else-if="column.key === 'campaign'"
              class="block max-w-32 truncate"
              :title="row.campaign?.name ?? ''"
              data-testid="am-row-campaign"
            >{{ row.campaign?.name || REPORT_DASH }}</span>

            <span
              v-else-if="column.key === 'adGroup'"
              class="flex min-w-0 flex-col"
              data-testid="am-row-adgroup"
            >
              <span class="max-w-32 truncate" :title="row.adGroup?.name ?? ''">{{ row.adGroup?.name || REPORT_DASH }}</span>
              <span class="text-xs text-muted">{{ row.adGroup?.id || REPORT_DASH }}</span>
            </span>

            <span
              v-else-if="column.key === 'source'"
              class="block max-w-32 truncate"
              :title="row.source ?? ''"
              data-testid="am-row-source"
            >{{ row.source || REPORT_DASH }}</span>

            <AdsMonitorBudgetCell
              v-else-if="column.key === 'advertiserBudget'"
              :row="row"
              :mode="mode ?? 'thb'"
              @ask="emit('budget', row)"
            />

            <span
              v-else-if="column.key === 'budget'"
              class="whitespace-nowrap"
              :title="row.budget?.mode ?? ''"
              data-testid="am-row-budget"
            >
              <MoneyCell
                v-if="row.budget?.amount != null && row.budget.currency"
                :native="{ amount: row.budget.amount, currency: row.budget.currency }"
                :thb="row.budget.thb?.amount ?? null"
                :estimated="row.budget.thb?.estimated"
                :rate="row.budget.thb?.rate"
                :day="row.budget.thb?.day"
                :mode="mode ?? 'thb'"
              />
              <template v-else>{{ budgetText(row) }}</template>
            </span>

            <span
              v-else-if="column.key === 'bid'"
              class="block max-w-28 truncate"
              :title="bidTitle(row)"
              data-testid="am-row-bid"
            >{{ bidText(row) }}</span>

            <span
              v-else-if="column.key === 'schedule'"
              class="block max-w-32 truncate"
              :title="scheduleText(row)"
              data-testid="am-row-schedule"
            >{{ scheduleText(row) }}</span>

            <template v-else-if="column.key === 'adCount'">
              {{ formatInt(row.adCount ?? null) }}
            </template>

            <template v-else>
              {{ REPORT_DASH }}
            </template>
          </td>
        </tr>
      </tbody>

      <tfoot>
        <tr data-testid="am-total" class="bg-elevated font-semibold">
          <td :colspan="labelSpan" class="sticky bottom-0 z-10 rounded-bl-lg border-t border-l border-default bg-elevated px-2 py-2">
            รวมทั้งหมด
          </td>
          <td
            v-for="(column, index) in footColumns"
            :key="column.key"
            class="sticky bottom-0 z-10 border-t border-default bg-elevated px-2 py-2 text-right tabular-nums"
            :class="index === footColumns.length - 1 ? 'rounded-br-lg border-r' : ''"
            :data-field="column.key"
          >
            <!-- FEAT-084 — `totals` is THB (Σ spendThb of every listed group): ฿ in both modes + raw breakdown -->
            <MoneyCell
              v-if="column.metric === 'spend'"
              total
              data-testid="am-total-spend"
              :thb="totals.spend"
              :by-currency="spendByCurrency ?? {}"
              :unconverted="spendUnconverted ?? null"
            />
            <template v-else-if="column.metric && COST_PER[column.metric]">
              {{ formatThb(totals[column.metric], 2) }}
            </template>
            <template v-else-if="column.metric">
              {{ formatMetric(totals[column.metric], column.format) }}
            </template>
            <template v-else>
              {{ REPORT_DASH }}
            </template>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>
</template>
