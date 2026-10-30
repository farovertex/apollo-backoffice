<script setup lang="ts">
/**
 * FEAT-082 — `am-appeal-badge` (api-contract.md §6, spec "UI behaviour (BO)" → ad tab). The appeal state of
 * one ad row, rendered right under/next to its status label on the **ad tab only**.
 *
 * `data-state` is the one attribute QA asserts on; it comes from `appealBadgeState()` (`app/utils/appeal.ts`),
 * the single rule shared with the drawer's `am-appeal-state` block: pending (a job is queued/running) → error
 * (the last job failed) → the API's own `appeal`. State `none` renders **nothing at all** (the element is
 * absent, contract §6), which is also what a row without a `review` gets.
 *
 * FEAT-082 v1.4 §8.3 (TASK-am-tiktok-wording) — the badge now keeps **only the two transient job states**
 * `pending` and `error`: since v1.4 the appeal *result* ("กำลังอุทธรณ์" / "การอุทธรณ์ผ่านการอนุมัติ" /
 * "การอุทธรณ์ไม่ผ่านการอนุมัติ") is the status cell's second line, computed by the API, so showing it here as
 * well would say the same thing twice. `appealing` / `approved` / `rejected` / `unknown` therefore render
 * nothing, exactly like `none`.
 *
 * The `error` state carries `appealError.reason` as its tooltip + `title`; `pending` carries its own text.
 */
import type { MonitorReviewSummary } from '#shared/types/ads-monitor'

const props = defineProps<{
  /** `row.review`; `undefined` (old stub) reads exactly like `null` */
  review?: MonitorReviewSummary | null
}>()

const state = computed(() => appealBadgeState(props.review))
/** v1.4 — only the two states the status cell's second line cannot show (they are about *our* job, not TikTok) */
const visible = computed(() => state.value === 'pending' || state.value === 'error')
const label = computed(() => APPEAL_BADGE_TEXT[state.value])
const color = computed(() => APPEAL_BADGE_COLOR[state.value])
const icon = computed(() => APPEAL_BADGE_ICON[state.value])
/** the failure sentence is the only extra information a badge can show (it never fits in the badge itself) */
const tooltip = computed(() => (state.value === 'error' ? props.review?.appealError?.reason ?? label.value : label.value))
</script>

<template>
  <UTooltip v-if="visible" :text="tooltip">
    <UBadge
      :color="color"
      variant="subtle"
      size="sm"
      :label="label"
      :title="tooltip"
      class="w-fit max-w-full"
      :ui="{ leadingIcon: state === 'pending' ? 'animate-spin' : '' }"
      :icon="icon"
      data-testid="am-appeal-badge"
      :data-state="state"
    />
  </UTooltip>
</template>
