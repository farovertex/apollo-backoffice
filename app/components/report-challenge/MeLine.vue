<script setup lang="ts">
/**
 * FEAT-094 — the accent "my rank" band of `/reports/challenge` (spec "UI behaviour" → My line, api-contract.md
 * v1 §4): my rank + the lead/behind/alone/unranked/not-in-people sentence, plus the team totals on the right.
 */
import type { ChallengeBy, ChallengePerson, ChallengeTeam } from '#shared/types/report-challenge'
import type { ChallengeRanked } from '~/utils/report-challenge'

const props = defineProps<{
  meAdminId: string | null
  mePerson: ChallengePerson | null
  /** `null` = unranked or not in `people` */
  meRank: number | null
  /** count of ranked people (= "M" of "อันดับ N จาก M") */
  rankedCount: number
  rankOne: ChallengeRanked | null
  rankTwo: ChallengeRanked | null
  by: ChallengeBy
  team: ChallengeTeam
}>()

const state = computed<'ranked' | 'unranked' | 'absent'>(() => {
  if (!props.mePerson) return 'absent'
  return props.meRank !== null ? 'ranked' : 'unranked'
})

const myValue = computed(() => (props.mePerson ? challengeValue(props.mePerson, props.by) : null))

const phrase = computed(() => {
  if (props.meRank === null) return ''
  if (props.rankedCount <= 1) return 'คุณเป็นคนเดียวในช่วงนี้'
  if (props.meRank === 1) {
    const other = props.rankTwo
    if (!other || other.value === null) return ''
    const gap = gapText(props.by, myValue.value ?? 0, other.value)
    return `นำที่ 2 (${other.person.admin.displayName ?? REPORT_DASH}) อยู่ ${gap}`
  }
  const other = props.rankOne
  if (!other || other.value === null) return ''
  const gap = gapText(props.by, myValue.value ?? 0, other.value)
  return `ตามที่ 1 (${other.person.admin.displayName ?? REPORT_DASH}) อยู่ ${gap}`
})

const sentence = computed(() => {
  if (state.value === 'absent') return 'คุณไม่อยู่ในตาราง — ยังไม่มี workspace ที่คุณเป็นเจ้าของ'
  if (state.value === 'unranked') return 'คุณยังไม่มีอันดับในช่วงนี้ (ยังไม่มีการยิง)'
  const base = `คุณอยู่อันดับ ${props.meRank} จาก ${props.rankedCount}`
  return phrase.value ? `${base} · ${phrase.value}` : base
})

const teamRatio = computed(() => depPerBudgetPct(props.team.deposit, props.team.spend))
const teamText = computed(() => `ทั้งทีม ยิงไป ${formatThb(props.team.spend, 0)} · ได้ยอด ${formatThb(props.team.deposit, 0)} · คุ้ม ${formatPercent(teamRatio.value)}`)
</script>

<template>
  <div
    data-testid="rc-me"
    :data-rank="meRank ?? ''"
    :data-of="rankedCount"
    :data-admin="meAdminId ?? ''"
    class="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between"
  >
    <div class="flex min-w-0 items-center gap-2">
      <span v-if="state === 'ranked'" class="text-2xl font-bold tabular-nums text-primary">#{{ meRank }}</span>
      <p class="min-w-0 truncate text-sm text-highlighted">
        {{ sentence }}
      </p>
    </div>
    <p
      data-testid="rc-team"
      :data-spend="team.spend"
      :data-deposit="team.deposit"
      :data-ratio="teamRatio ?? ''"
      class="shrink-0 text-xs text-muted"
    >
      {{ teamText }}
    </p>
  </div>
</template>
