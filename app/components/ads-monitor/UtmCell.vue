<script setup lang="ts">
/**
 * FEAT-067 — `am-row-utm`: the UTM cell of the three Ads monitor tabs (spec "UI behaviour" → Cell, contract
 * §4). `utm === null` ⇒ "—" (`am-row-utm-empty`), no link, no badge. Otherwise the primary set is a plain
 * same-tab link to `/reports/utm` (`am-row-utm-link`, four stacked `am-row-utm-line` spans expanded / one
 * truncated prefix line collapsed, values only — never labelled); a non-empty `others` adds a "+N" badge
 * (`am-row-utm-more`) opening a `UDropdownMenu` of `am-row-utm-other` links, one per other set, in API order.
 * The link always carries the monitor's current range (`reportRangeQuery`, spec A5) and omits an empty-string
 * part from the query (the report page treats it as unset anyway).
 */
import type { DropdownMenuItem } from '@nuxt/ui'
import type { MonitorUtm, MonitorUtmSet } from '#shared/types/ads-monitor'
import type { ReportRangeState } from '#shared/types/reports'

const props = defineProps<{
  /** `undefined` only on a stub missing the key — a harness bug, not a BO case (contract §4); rendered as `—` */
  utm: MonitorUtm | null | undefined
  collapsed?: boolean
  /** the monitor's current range — every link carries it explicitly (spec A5) */
  range: ReportRangeState
}>()

const UTM_PARTS: { key: keyof MonitorUtmSet, max: string }[] = [
  { key: 'prefix', max: 'max-w-36' },
  { key: 'source', max: 'max-w-36' },
  { key: 'medium', max: 'max-w-36' },
  { key: 'campaign', max: 'max-w-36' }
]

function textOf(value: string): string {
  return value === '' ? REPORT_DASH : value
}

function joinedOf(set: MonitorUtmSet): string {
  return [set.prefix, set.source, set.medium, set.campaign].map(textOf).join(' · ')
}

function tooltipOf(utm: MonitorUtm): string {
  const base = joinedOf(utm)
  return utm.others.length > 0 ? `${base} · +${utm.others.length}` : base
}

/** prefix, source, medium, campaign, range[, from, to] — empty-string parts omitted (spec "UI behaviour"). */
function linkQuery(set: MonitorUtmSet): Record<string, string> {
  const query: Record<string, string> = {}
  if (set.prefix !== '') query.prefix = set.prefix
  if (set.source !== '') query.source = set.source
  if (set.medium !== '') query.medium = set.medium
  if (set.campaign !== '') query.campaign = set.campaign
  const rangeQuery = reportRangeQuery(props.range)
  query.range = rangeQuery.range
  if (rangeQuery.from !== undefined) query.from = rangeQuery.from
  if (rangeQuery.to !== undefined) query.to = rangeQuery.to
  return query
}

function linkTo(set: MonitorUtmSet) {
  return { path: '/reports/utm', query: linkQuery(set) }
}

/** the "+N" menu's items, in the API's `others` order — `data-testid`/`data-index` land on the rendered `<a>` (Nuxt UI forwards `data-*` item keys through `pickLinkProps`). */
function otherItemsOf(utm: MonitorUtm): DropdownMenuItem[] {
  return utm.others.map((set, index) => ({
    'label': joinedOf(set),
    'to': linkTo(set),
    'data-testid': 'am-row-utm-other',
    'data-index': String(index)
  }))
}
</script>

<template>
  <div
    class="flex min-w-0 items-start gap-1"
    data-testid="am-row-utm"
    :data-collapsed="collapsed ? 'true' : 'false'"
    :data-empty="utm ? 'false' : 'true'"
  >
    <span v-if="!utm" data-testid="am-row-utm-empty">{{ REPORT_DASH }}</span>

    <template v-else>
      <NuxtLink
        :to="linkTo(utm)"
        class="flex min-w-0 flex-col hover:underline"
        data-testid="am-row-utm-link"
        :title="tooltipOf(utm)"
      >
        <template v-if="!collapsed">
          <span
            v-for="(part, index) in UTM_PARTS"
            :key="part.key"
            class="truncate"
            :class="[part.max, index === 0 ? 'font-normal' : 'text-xs text-muted']"
            data-testid="am-row-utm-line"
            :data-part="part.key"
          >{{ textOf(utm[part.key]) }}</span>
        </template>

        <span
          v-else
          class="max-w-20 truncate"
          data-testid="am-row-utm-line"
          data-part="prefix"
        >{{ textOf(utm.prefix) }}</span>
      </NuxtLink>

      <UDropdownMenu v-if="utm.others.length > 0" :items="otherItemsOf(utm)" :content="{ align: 'start' }">
        <UButton
          size="xs"
          color="neutral"
          variant="soft"
          :label="`+${utm.others.length}`"
          data-testid="am-row-utm-more"
          :data-count="utm.others.length"
          :aria-label="`UTM อื่นอีก ${utm.others.length} ชุด`"
        />
      </UDropdownMenu>
    </template>
  </div>
</template>
