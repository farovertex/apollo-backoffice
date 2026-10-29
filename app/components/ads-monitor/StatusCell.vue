<script setup lang="ts">
/**
 * FEAT-056 — `am-status` (spec "UI behaviour" → Status cell). Coloured dot + Thai label of `status.key`,
 * a secondary line with the translated `status.reasons[]` (one map, `app/utils/reports.ts`) and a `title`
 * carrying the **raw** TikTok strings, so nothing is lost in translation.
 *
 * `data-key` is the classified key, `data-primary` the raw primary status — both are what QA asserts on.
 *
 * TASK-campaign-delete-ui — the API's new top-priority key `deleted` is rendered as a neutral **badge**
 * (`am-status-label` stays the element carrying the text, so nothing that asserted on it breaks) with the
 * deletion time underneath (`am-status-deleted-at`, `dd MMM HH:mm` local). Same on all three tabs: group and
 * ad rows of a deleted campaign carry `status.key = 'deleted'` + `deletedAt` as well.
 *
 * FEAT-064 — `status.key === 'banned'` is rendered as a red **badge** (same pattern as the `deleted` badge,
 * `am-status-label` still carries the text), `data-key="banned"` comes from the existing binding below. No
 * dimming: dimming stays tied to `deletedAt` (the row/table component), never to `banned`.
 *
 * FEAT-068 — `status.key === 'missing'` (the row's `missingSince` is set, i.e. gone from TikTok) is rendered
 * as a neutral **badge** (same pattern), `data-key="missing"` comes from the existing binding below. No
 * dimming either: dimming stays tied to `deletedAt` only.
 *
 * FEAT-082 (api-contract.md §6, spec "UI behaviour (BO)") — on the **ad tab only** the same label becomes a
 * button `am-review-open` when the row has a `review` and is either rejected or already in an appeal flow
 * (`isReviewOpenable()`, the contract's rule, never re-derived here); pressing it asks the page to open the
 * review drawer. Nothing about the rendering changes — the button wraps the very same badge / dot + label, so
 * every existing `am-status-label` assertion still holds. A **rejected** ad row **without** a review keeps the
 * static label and explains itself through `am-review-missing` ("รอรอบ kpi ถัดไป"). The appeal badge
 * (`AdsMonitorAppealBadge`) is appended under the label and renders nothing in state `none`.
 */
import type { MonitorReviewSummary, MonitorStatus } from '#shared/types/ads-monitor'

const props = defineProps<{
  status: MonitorStatus
  /** `MonitorRow.deletedAt` — only read when `status.key === 'deleted'` */
  deletedAt?: string | null
  /** FEAT-082 — `MonitorRow.review`; `undefined` (campaign/ad-group row, old stub) reads like `null` */
  review?: MonitorReviewSummary | null
  /** FEAT-082 — the review drawer is an **ad tab** affordance (spec AS-5); anything else renders as before */
  reviewable?: boolean
}>()

const emit = defineEmits<{
  /** FEAT-082 — `am-review-open` pressed; the page opens the drawer for this row */
  'open-review': []
}>()

const isDeleted = computed(() => props.status.key === 'deleted')
const isBanned = computed(() => props.status.key === 'banned')
const isMissing = computed(() => props.status.key === 'missing')
const deletedAtText = computed(() => formatDayMonthClock(props.deletedAt))
const label = computed(() => monitorStatusLabel(props.status.key, props.status.primary))
const dot = computed(() => monitorStatusDot(props.status.key, props.status.primary))
const textClass = computed(() => monitorStatusText(props.status.key))
const reasons = computed(() => monitorReasonTexts(props.status.reasons))
const title = computed(() => monitorStatusTitle(props.status))

const review = computed(() => props.review ?? null)
/** contract §6 — the button exists only under this exact condition */
const openable = computed(() => props.reviewable === true && isReviewOpenable(props.status.key, review.value))
/** a rejected ad row the kpi round has not captured yet: static label + the "why" tooltip */
const missingReview = computed(() => props.reviewable === true && review.value === null && props.status.key === 'rejected')
const MISSING_TEXT = 'ยังไม่มีรายละเอียดการตรวจสอบ (รอรอบ kpi ถัดไป)'
</script>

<template>
  <span
    class="flex min-w-0 flex-col gap-0.5"
    data-testid="am-status"
    :data-key="status.key"
    :data-primary="status.primary"
    :title="title"
  >
    <!-- the label itself: identical markup whether or not it is wrapped in `am-review-open` -->
    <component
      :is="openable ? 'button' : 'span'"
      :type="openable ? 'button' : undefined"
      :aria-label="openable ? 'ดูรายละเอียดการตรวจสอบ' : undefined"
      :data-testid="openable ? 'am-review-open' : undefined"
      class="flex min-w-0 flex-col items-start gap-0.5 text-left"
      :class="openable ? 'cursor-pointer hover:underline' : ''"
      @click="openable ? emit('open-review') : undefined"
    >
      <UBadge
        v-if="isDeleted"
        color="neutral"
        variant="subtle"
        size="sm"
        icon="i-lucide-trash-2"
        :label="label"
        class="w-fit"
        data-testid="am-status-label"
      />
      <UBadge
        v-else-if="isBanned"
        color="error"
        variant="subtle"
        size="sm"
        icon="i-lucide-ban"
        :label="label"
        class="w-fit"
        data-testid="am-status-label"
      />
      <UBadge
        v-else-if="isMissing"
        color="neutral"
        variant="subtle"
        size="sm"
        icon="i-lucide-eye-off"
        :label="label"
        class="w-fit"
        data-testid="am-status-label"
      />
      <UTooltip v-else-if="missingReview" :text="MISSING_TEXT">
        <span
          class="flex items-center gap-1.5 whitespace-nowrap"
          data-testid="am-review-missing"
          :title="MISSING_TEXT"
        >
          <span class="size-2 shrink-0 rounded-full" :class="dot" />
          <span :class="textClass" data-testid="am-status-label">{{ label }}</span>
        </span>
      </UTooltip>
      <span v-else class="flex items-center gap-1.5 whitespace-nowrap">
        <span class="size-2 shrink-0 rounded-full" :class="dot" />
        <span :class="textClass" data-testid="am-status-label">{{ label }}</span>
      </span>
    </component>

    <AdsMonitorAppealBadge v-if="reviewable" :review="review" />

    <span
      v-if="isDeleted"
      class="text-xs whitespace-nowrap text-muted"
      data-testid="am-status-deleted-at"
    >{{ deletedAtText }}</span>

    <span
      v-if="reasons.length > 0"
      class="max-w-32 truncate text-xs text-muted"
      data-testid="am-status-reasons"
    >{{ reasons.join(' · ') }}</span>
  </span>
</template>
