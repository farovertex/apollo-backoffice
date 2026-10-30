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
 * FEAT-082 (api-contract.md §6, spec "UI behaviour (BO)") — on the **ad tab only** the row can open the review
 * drawer (`am-review-open`) when it has a `review` and is either rejected or already in an appeal flow
 * (`isReviewOpenable()`, the contract's rule, never re-derived here). A **rejected** ad row **without** a review
 * explains itself through `am-review-missing` ("รอรอบ kpi ถัดไป").
 *
 * FEAT-082 v1.4 §8.1/§8.3 (TASK-am-tiktok-wording) — the cell now reads like TikTok's own status column:
 *   line 1 `am-status-primary` = `status.tiktok.primary` (dot/badge colour still from `key`, so every existing
 *     colour rule and the `am-status-label` element are unchanged)
 *   line 2 `am-status-secondary` = `status.tiktok.secondary`, coloured by the API's `tone`
 *     (`monitorToneText()`); **on the ad tab it is the `am-review-open` button** when the FEAT-082 rule holds,
 *     plain text everywhere else.
 * The wording itself is the API's (`tiktokWording()`); the BO never computes it. A row whose API/stub predates
 * v1.4 (`tiktok` absent) falls back to `monitorStatusLabel()` for line 1 and renders no second line, i.e. to
 * exactly the pre-v1.4 cell. Because the appeal wording now lives in line 2, `AdsMonitorAppealBadge` only keeps
 * the two transient states (`pending` / `error`) — nothing is shown twice.
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
/** v1.4: the API's main line; pre-v1.4 rows keep the BO's own label (filters/legends still use it too) */
const label = computed(() => props.status.tiktok?.primary || monitorStatusLabel(props.status.key, props.status.primary))
const dot = computed(() => monitorStatusDot(props.status.key, props.status.primary))
const textClass = computed(() => monitorStatusText(props.status.key))
const reasons = computed(() => monitorReasonTexts(props.status.reasons))
const title = computed(() => monitorStatusTitle(props.status))

/** v1.4 line 2 — `null`/absent ⇒ no second line at all */
const secondary = computed(() => props.status.tiktok?.secondary || null)
const secondaryClass = computed(() => monitorToneText(props.status.tiktok?.tone))

const review = computed(() => props.review ?? null)
/** contract §6 — the button exists only under this exact condition (unchanged by v1.4) */
const openable = computed(() => props.reviewable === true && isReviewOpenable(props.status.key, review.value))
/** a rejected ad row the kpi round has not captured yet: static text + the "why" tooltip */
const missingReview = computed(() => props.reviewable === true && review.value === null && props.status.key === 'rejected')
/** since v1.4 that explanation belongs to the second line (which says "ปัญหาในการตรวจสอบ"); without one it stays on line 1 */
const missingOnSecondary = computed(() => missingReview.value && secondary.value !== null)
const missingOnPrimary = computed(() => missingReview.value && secondary.value === null)
/**
 * Where `am-review-open` lives: on the second line since v1.4 — but a pre-v1.4 row (no `tiktok`, so no second
 * line) keeps the T4 behaviour and wraps the main line, so the button never disappears for an older API/stub.
 */
const openableOnSecondary = computed(() => openable.value && secondary.value !== null)
const openableOnPrimary = computed(() => openable.value && secondary.value === null)
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
    <!--
      line 1 — the API's main line; the badge variants and `am-status-label` are untouched. It only becomes a
      button (or carries the `am-review-missing` tooltip) for a pre-v1.4 row that has no second line.
    -->
    <span class="flex min-w-0 flex-col items-start" data-testid="am-status-primary">
      <component
        :is="openableOnPrimary ? 'button' : 'span'"
        :type="openableOnPrimary ? 'button' : undefined"
        :aria-label="openableOnPrimary ? 'ดูรายละเอียดการตรวจสอบ' : undefined"
        :data-testid="openableOnPrimary ? 'am-review-open' : undefined"
        class="flex min-w-0 flex-col items-start text-left"
        :class="openableOnPrimary ? 'cursor-pointer hover:underline' : ''"
        @click="openableOnPrimary ? emit('open-review') : undefined"
      >
        <UTooltip v-if="missingOnPrimary" :text="MISSING_TEXT">
          <span class="flex items-center gap-1.5 whitespace-nowrap" data-testid="am-review-missing">
            <span class="size-2 shrink-0 rounded-full" :class="dot" />
            <span :class="textClass" data-testid="am-status-label">{{ label }}</span>
          </span>
        </UTooltip>
        <UBadge
          v-else-if="isDeleted"
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
        <span v-else class="flex items-center gap-1.5 whitespace-nowrap">
          <span class="size-2 shrink-0 rounded-full" :class="dot" />
          <span :class="textClass" data-testid="am-status-label">{{ label }}</span>
        </span>
      </component>
    </span>

    <!-- line 2 — the API's secondary line: the review button on the ad tab, plain text elsewhere -->
    <template v-if="secondary">
      <button
        v-if="openableOnSecondary"
        type="button"
        class="max-w-40 cursor-pointer text-left text-xs leading-tight text-balance break-words hover:underline sm:whitespace-nowrap"
        :class="secondaryClass"
        aria-label="ดูรายละเอียดการตรวจสอบ"
        data-testid="am-review-open"
        @click="emit('open-review')"
      >
        <span data-testid="am-status-secondary">{{ secondary }}</span>
      </button>

      <UTooltip v-else-if="missingOnSecondary" :text="MISSING_TEXT">
        <span
          class="block max-w-40 text-xs leading-tight text-balance break-words sm:whitespace-nowrap"
          :class="secondaryClass"
          :title="MISSING_TEXT"
          data-testid="am-review-missing"
        ><span data-testid="am-status-secondary">{{ secondary }}</span></span>
      </UTooltip>

      <span
        v-else
        class="block max-w-40 text-xs leading-tight text-balance break-words sm:whitespace-nowrap"
        :class="secondaryClass"
        data-testid="am-status-secondary"
      >{{ secondary }}</span>
    </template>

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
