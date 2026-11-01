<script setup lang="ts">
/**
 * FEAT-094 — one admin's card on `/reports/challenge` (spec "UI behaviour" → Cards, api-contract.md v1 §4):
 * medal + name + delta, the ranking metric, the ยิงไป/ได้ยอด tiles, "กำลังยิง N adv" with coloured dots and
 * the top 3 ads. Click / Enter / Space selects the card (`?admin=`, no request) — the page owns the URL.
 */
import type { ChallengeBy, ChallengeDeliveryState, ChallengePerson } from '#shared/types/report-challenge'
import type { ReportRange } from '#shared/types/reports'

const props = defineProps<{
  person: ChallengePerson
  /** `null` = unranked */
  rank: number | null
  value: number | null
  by: ChallengeBy
  isMe: boolean
  selected: boolean
  rangeKey: ReportRange
}>()

const emit = defineEmits<{ select: [adminId: string] }>()

const MEDAL: Record<number, { cls: string }> = {
  1: { cls: 'text-amber-500' },
  2: { cls: 'text-slate-400' },
  3: { cls: 'text-orange-700' }
}

const DOT_CLASS: Record<ChallengeDeliveryState, string> = {
  delivering: 'bg-success',
  notDelivering: 'bg-warning',
  unknown: 'bg-neutral-400'
}

const previousValue = computed(() => {
  const prev = props.person.previous
  if (!prev) return null
  return props.by === 'depBudget' ? depPerBudgetPct(prev.deposit, prev.spend) : prev.deposit
})

const delta = computed(() => challengeDelta(props.value, previousValue.value))

const deltaText = computed(() => {
  const d = delta.value
  if (d.dir === 'none') return REPORT_DASH
  if (d.dir === 'flat') return props.rangeKey === 'today' ? 'เท่าเมื่อวาน' : 'เท่าช่วงก่อน'
  const arrow = d.dir === 'up' ? '▲' : '▼'
  return `${arrow} ${d.pct}% ${deltaSuffix(props.rangeKey)}`
})

const heroText = computed(() => (props.by === 'depBudget' ? formatPercent(props.value) : formatThb(props.value, 0)))
const heroCaption = computed(() => (props.by === 'depBudget' ? 'คุ้ม = ได้ยอด ÷ ยิงไป' : 'ได้ยอด (THB)'))

const DOT_CAP = 50
const visibleDots = computed(() => props.person.launching.list.slice(0, DOT_CAP))
const extraDots = computed(() => Math.max(0, props.person.launching.list.length - DOT_CAP))

const medal = computed(() => (props.rank !== null ? MEDAL[props.rank] ?? null : null))
const medalClass = computed(() => medal.value?.cls ?? 'text-muted')

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    emit('select', props.person.admin.id)
  }
}
</script>

<template>
  <div
    data-testid="rc-card"
    :data-admin="person.admin.id"
    :data-rank="rank ?? ''"
    :data-me="isMe ? 'true' : 'false'"
    :data-selected="selected ? 'true' : 'false'"
    tabindex="0"
    role="button"
    class="flex min-w-0 flex-col gap-3 rounded-lg border p-4 transition-colors"
    :class="[
      rank === null ? 'opacity-70' : '',
      isMe ? 'ring-2 ring-primary' : '',
      rank === 1 ? 'border-amber-400' : 'border-default',
      selected ? 'bg-elevated/60' : 'hover:bg-elevated/30'
    ]"
    @click="emit('select', person.admin.id)"
    @keydown="onKeydown"
  >
    <div class="flex items-center gap-2">
      <span data-testid="rc-card-rank" class="flex items-center gap-1 font-semibold" :class="medalClass">
        <UIcon v-if="medal" name="i-lucide-medal" class="size-4" />
        <span>{{ rank ? `#${rank}` : REPORT_DASH }}</span>
      </span>
      <span class="min-w-0 flex-1 truncate font-medium text-highlighted">{{ person.admin.displayName ?? person.admin.id }}</span>
      <UBadge
        v-if="isMe"
        size="xs"
        color="primary"
        variant="subtle"
      >
        ฉัน
      </UBadge>
      <span class="shrink-0 text-xs tabular-nums" data-testid="rc-card-delta" :data-dir="delta.dir">{{ deltaText }}</span>
    </div>

    <div data-testid="rc-card-hero" :data-value="value ?? ''">
      <div class="flex items-center gap-1">
        <span class="text-2xl font-bold tabular-nums text-highlighted">{{ heroText }}</span>
        <ReportsInfoHint id="rc-card-hero" :text="REPORT_HELP['rc-card-hero']!" />
      </div>
      <p class="text-[11px] text-dimmed">
        {{ heroCaption }}
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <ReportsMetricTile
        testid="rc-card-spend"
        label="ยิงไป"
        :value="person.spend"
        format="thb"
        :help="REPORT_HELP['rc-card-spend']"
      >
        <span
          v-if="unconvertedMarker(person.spendUnconverted)"
          class="text-[11px] text-warning"
          :title="unconvertedTitle(person.spendUnconverted)"
        >{{ unconvertedMarker(person.spendUnconverted) }}</span>
      </ReportsMetricTile>
      <ReportsMetricTile
        testid="rc-card-deposit"
        label="ได้ยอด"
        :value="person.deposit"
        format="thb"
        :help="REPORT_HELP['rc-card-deposit']"
      />
    </div>

    <div
      data-testid="rc-card-launching"
      :data-total="person.launching.total"
      :data-delivering="person.launching.delivering"
      :data-not-delivering="person.launching.notDelivering"
      :data-unknown="person.launching.unknown"
      class="flex flex-col gap-1"
    >
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>กำลังยิง <strong class="text-default">{{ person.launching.total }}</strong> adv</span>
        <ReportsInfoHint id="rc-card-launching" :text="REPORT_HELP['rc-card-launching']!" />
      </span>
      <div v-if="person.launching.total > 0" class="flex flex-wrap items-center gap-1">
        <span
          v-for="row in visibleDots"
          :key="row.advertiserId"
          data-testid="rc-dot"
          :data-state="row.state"
          class="size-2 shrink-0 rounded-full"
          :class="DOT_CLASS[row.state]"
          :title="row.name ?? row.advertiserId"
        />
        <span v-if="extraDots > 0" class="text-[11px] text-muted">+{{ extraDots }}</span>
        <UBadge
          v-if="person.launching.notDelivering > 0"
          color="warning"
          variant="subtle"
          size="xs"
          data-testid="rc-card-nd"
        >
          {{ person.launching.notDelivering }} ไม่ส่ง
        </UBadge>
      </div>
      <UBadge
        v-else
        color="neutral"
        variant="subtle"
        size="xs"
        class="w-fit"
        data-testid="rc-card-idle"
      >
        ไม่ได้ยิงอยู่ตอนนี้
      </UBadge>
    </div>

    <div data-testid="rc-card-ads" class="flex flex-col gap-1">
      <span class="flex items-center gap-1 text-xs text-muted">
        <span>Top 3</span>
        <ReportsInfoHint id="rc-card-ads" :text="REPORT_HELP['rc-card-ads']!" />
      </span>
      <div v-if="person.topAds.length > 0" class="flex gap-2">
        <div
          v-for="ad in person.topAds"
          :key="ad.adId"
          data-testid="rc-card-ad"
          :data-id="ad.adId"
          :data-conversions="ad.conversions"
          class="flex flex-col items-center gap-1"
        >
          <ReportsAdThumb :url="ad.coverUrl" :is-video="ad.isVideo" size="md" />
          <span class="text-[11px] tabular-nums text-muted">{{ formatInt(ad.conversions) }}</span>
        </div>
      </div>
      <p v-else class="text-xs text-muted" data-testid="rc-card-ads-empty">
        ยังไม่มีโฆษณาที่มีผล
      </p>
    </div>
  </div>
</template>
