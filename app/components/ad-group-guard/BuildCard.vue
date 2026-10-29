<script setup lang="ts">
/**
 * FEAT-086 (spec "UI behaviour" §4, AC-23, api-contract §6.3) — the ad group guard card of one build on
 * `/orders/:id` (`od-adgroup-guard`, `data-id` = build id). The parent renders it only when `build.adGroupGuard` is
 * non-null. Reads the snapshot of the existing `GET /campaign-orders/:id` body — no request, no polling (A11).
 *
 * Header: `od-adgroup-guard-state[data-state]` (off / watching / done) · `od-adgroup-guard-rule` (formatted with
 * the snapshot's currency) · `od-adgroup-guard-source[data-source]`. One `od-guard-adgroup[data-state]` per
 * `adGroups[]` entry with the metrics (`od-guard-adgroup-metrics`, queued/paused) or the reason
 * (`od-guard-adgroup-reason`, failed); `od-guard-adgroup-empty` while watching with no group yet.
 */
import type { BuildAdGroupGuard } from '#shared/types/ad-group-guard'
import type { BuildView } from '#shared/types/campaign-orders'

const props = defineProps<{
  build: BuildView
  guard: BuildAdGroupGuard
}>()

const stateBadge = computed(() => AGG_BUILD_STATE[props.guard.state] ?? AGG_BUILD_STATE.off)
const ruleText = computed(() => (props.guard.rule ? formatAdGroupGuardRule(props.guard.rule, props.guard.currency) : 'ไม่มีกฎ'))
const sourceText = computed(() => adGroupGuardSourceLabel(props.guard.source, props.guard.rule !== null))
const title = computed(() => {
  const account = props.build.account?.label ?? props.build.account?.loginEmail ?? '—'
  return props.build.advertiser ? `${account} → ${props.build.advertiser.name}` : account
})
</script>

<template>
  <div
    class="flex min-w-0 flex-col gap-2 rounded-lg border border-default p-3"
    data-testid="od-adgroup-guard"
    :data-id="build.id"
    :data-state="guard.state"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="min-w-0 truncate text-sm font-medium text-highlighted">{{ title }}</span>
      <UBadge
        :color="stateBadge.color"
        variant="subtle"
        size="sm"
        class="whitespace-nowrap"
        data-testid="od-adgroup-guard-state"
        :data-state="guard.state"
      >
        {{ stateBadge.label }}
      </UBadge>
      <UBadge
        color="neutral"
        variant="outline"
        size="sm"
        class="whitespace-nowrap"
        data-testid="od-adgroup-guard-source"
        :data-source="guard.source"
      >
        {{ sourceText }}
      </UBadge>
    </div>
    <p class="text-sm break-words text-muted" data-testid="od-adgroup-guard-rule">
      {{ guard.rule ? `ปิด ad group เมื่อ ${ruleText}` : ruleText }}
    </p>

    <ul v-if="guard.adGroups.length" class="flex flex-col gap-1">
      <li
        v-for="group in guard.adGroups"
        :key="group.tiktokAdGroupId"
        class="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-elevated/40 px-2 py-1.5 text-sm"
        data-testid="od-guard-adgroup"
        :data-id="group.tiktokAdGroupId"
        :data-state="group.state"
      >
        <span class="min-w-0 break-all font-medium text-highlighted" :title="group.tiktokAdGroupId">
          {{ adGroupGuardGroupName(group.name, group.tiktokAdGroupId) }}
        </span>
        <UBadge
          :color="(AGG_GROUP_STATE[group.state] ?? AGG_GROUP_STATE.watching).color"
          variant="subtle"
          size="sm"
          class="whitespace-nowrap"
          data-testid="od-guard-adgroup-state"
        >
          {{ (AGG_GROUP_STATE[group.state] ?? AGG_GROUP_STATE.watching).label }}
        </UBadge>
        <span
          v-if="(group.state === 'queued' || group.state === 'paused') && group.metrics"
          class="w-full text-xs text-muted tabular-nums sm:w-auto"
          data-testid="od-guard-adgroup-metrics"
        >
          {{ formatAdGroupGuardMetrics(group.metrics, guard.currency) }}
        </span>
        <span
          v-if="group.state === 'failed'"
          class="w-full text-xs break-words text-error sm:w-auto"
          data-testid="od-guard-adgroup-reason"
        >
          {{ group.reason || 'ไม่ทราบสาเหตุ' }}
        </span>
      </li>
    </ul>
    <p v-else-if="guard.state === 'watching'" class="text-xs text-muted" data-testid="od-guard-adgroup-empty">
      ยังไม่พบกลุ่มโฆษณาจากรอบ kpi
    </p>
  </div>
</template>
