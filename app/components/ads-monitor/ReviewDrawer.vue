<script setup lang="ts">
/**
 * FEAT-082 — `am-review-drawer`: TikTok's "รายละเอียดการตรวจสอบโฆษณา" drawer, replicated in the BO
 * (api-contract.md v1 §2/§3/§6, spec "UI behaviour (BO)", reference screenshots
 * `qa/artifacts/explore/2026-10-29-appeal/16-review-issue-click.png` + `18-appeal-dialog.png`).
 * There is **no iframe** (spec F1: `ads.tiktok.com` forbids framing and the session lives in the worker's
 * browser) — every field here comes from `ads.review`, captured by the kpi round.
 *
 * One request on open, `GET /ads-monitor/ads/:adId/review` through `useApi()` (`retry: 0`, session counter →
 * a superseded/late answer is dropped), plus one `POST /ads-monitor/appeal` per submit. Nothing else.
 *
 * States (contract §6): `am-review-loading` (skeleton) · `am-review-error` + `am-review-retry` ·
 * `am-review-empty` (`review === null`, still a 200) · content. The appeal flow adds `am-appeal-open`
 * (disabled with the Thai `appealable.reason` tooltip), `am-appeal-state[data-state]`, the form
 * `am-appeal-form` and, while a job runs, a 5 s poll (`am-review-drawer[data-polling=1]`, cap 10 min).
 *
 * Closing the drawer stops the poll **and** hands the page a fresh `MonitorReviewSummary` (`update:review`)
 * so the row's badge/button are right without a reload — the same optimistic-override mechanism the budget
 * and delete flows use (`ads-monitor.vue` → `overrides`).
 *
 * FEAT-085 (merged 2026-10-29) — the appeal 409 goes through `appealConflictToast()`, the drawer's copy of
 * `ads-monitor.vue`'s `conflictToast()`: a shared `duplicate` body reads "มีงานนี้รออยู่แล้ว (ลำดับที่ n)", every
 * FEAT-082 reason keeps the "ทำไม่ได้" + API sentence of contract §3.
 *
 * QA escape hatch (like FEAT-081's `__FEAT081_POLL_CAP_MS`): `window.__FEAT082_POLL_MS` /
 * `window.__FEAT082_POLL_CAP_MS` (positive numbers) are read **once per poll start**. Nothing in the app
 * ever sets them.
 */
import type { FetchError } from 'ofetch'
import type { SlideoverProps, ModalProps } from '@nuxt/ui'
import type {
  AppealAccepted,
  AppealReason,
  MonitorReviewSummary,
  MonitorRow,
  ReviewDetailView,
  ReviewFrameView
} from '#shared/types/ads-monitor'
import { APPEAL_REASONS, APPEAL_REASON_ITEMS } from '#shared/types/ads-monitor'
import type { ApiErrorBody } from '#shared/types/auth'
import type { MaybeDuplicateBody } from '~/utils/job-queue'

const props = defineProps<{
  /** the ad row whose status button was pressed; `null` before the first open */
  row: MonitorRow | null
}>()

const emit = defineEmits<{
  /**
   * The row's `review` summary as the drawer last saw it (`null` = no review). Emitted after a 202, after a
   * poll outcome and on close, so the table's badge follows without a reload.
   */
  'update:review': [row: MonitorRow, review: MonitorReviewSummary | null]
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()

const DESCRIPTION_MAX = 2000
const POLL_MS = 5_000
const POLL_CAP_MS = 600_000

// ── data ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const detail = ref<ReviewDetailView | null>(null)
const pending = ref(false)
const errorText = ref<string | null>(null)
let session = 0

const adId = computed(() => props.row?.adId ?? '')
const adName = computed(() => detail.value?.name ?? props.row?.name ?? REPORT_DASH)
const review = computed(() => detail.value?.review ?? null)
const issues = computed(() => review.value?.issues ?? [])

/** `review === null` is a 200 as well (contract §2) — an empty state, never an error */
const isEmpty = computed(() => !pending.value && !errorText.value && detail.value !== null && review.value === null)

const status = computed(() => detail.value?.status ?? props.row?.status ?? null)
/**
 * FEAT-082 v1.4 §8.1/§8.3 — the header says what the row's status cell says: the API's TikTok wording when it
 * is there (`status.tiktok`), the BO's own label as the pre-v1.4 fallback. The second line follows the same
 * `tone` colouring as the cell.
 */
const statusLabel = computed(() => (status.value
  ? status.value.tiktok?.primary || monitorStatusLabel(status.value.key, status.value.primary)
  : REPORT_DASH))
const statusSecondary = computed(() => status.value?.tiktok?.secondary || null)
const statusSecondaryClass = computed(() => monitorToneText(status.value?.tiktok?.tone))
const statusDot = computed(() => (status.value ? monitorStatusDot(status.value.key, status.value.primary) : 'bg-muted'))
const statusText = computed(() => (status.value ? monitorStatusText(status.value.key) : 'text-default'))

/** "พบการละเมิดนโยบาย {N} รายการ ซึ่งส่งผลกระทบ {M} ภูมิภาค" — M = distinct `forbiddenCountries` */
const regionCount = computed(() => {
  const set = new Set<string>()
  for (const issue of issues.value) for (const code of issue.forbiddenCountries ?? []) if (code) set.add(code)
  return set.size
})
const summaryText = computed(() => `พบการละเมิดนโยบาย ${issues.value.length} รายการ ซึ่งส่งผลกระทบ ${regionCount.value} ภูมิภาค`)

// ── appeal state block (contract §6: same rule as the row badge) ──────────────────────────────────────────────────
const appealPending = computed(() => detail.value?.appealPending ?? null)
const appealError = computed(() => detail.value?.appealError ?? null)
const lastAppeal = computed(() => detail.value?.lastAppeal ?? null)
const appealState = computed(() => appealBadgeState({
  appeal: review.value?.appeal ?? 'none',
  appealPending: appealPending.value,
  appealError: appealError.value
}))
const appealStateText = computed(() => APPEAL_BADGE_TEXT[appealState.value])
const appealStateColor = computed(() => APPEAL_BADGE_COLOR[appealState.value])
const appealStateIcon = computed(() => APPEAL_BADGE_ICON[appealState.value])

const appealable = computed(() => detail.value?.appealable ?? { ok: false, reason: null })
/**
 * The API's rule, plus the one case it cannot know yet: right after our own 202 the stored `appealable` still
 * says `ok` until the next GET lands, while `appealPending` is already set — so a second appeal must be
 * refused here too (`appealPending` is also what the API would answer 409 with).
 */
const canAppeal = computed(() => appealable.value.ok && !appealPending.value)
const appealBlockedText = computed(() => {
  if (canAppeal.value) return ''
  if (appealable.value.ok && appealPending.value) return appealableReasonText('appealPending')
  return appealableReasonText(appealable.value.reason, review.value?.appeal)
})

/** "ยื่นโดย <displayName> เมื่อ <dd/MM HH:mm> · เหตุผล: <reason text>" */
const lastAppealLine = computed(() => {
  const last = lastAppeal.value
  if (!last) return ''
  const who = last.byAdmin?.displayName || last.byAdmin?.username || 'ระบบ'
  return `ยื่นโดย ${who} เมื่อ ${formatSlashDayClock(last.at)} · เหตุผล: ${APPEAL_REASONS[last.reason] ?? last.reason}`
})

const pendingLine = computed(() => {
  const p = appealPending.value
  return p ? `กำลังยื่นอุทธรณ์… เริ่ม ${formatClock(p.requestedAt)}` : ''
})

const fetchedAtText = computed(() => (review.value ? formatDateTime(review.value.fetchedAt) : REPORT_DASH))

// ── requests ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `silent` = a poll tick / a re-read after a 409: the panel keeps its content while the request runs */
async function load(silent = false): Promise<void> {
  const id = adId.value
  if (!id) return
  const s = ++session
  if (!silent) {
    pending.value = true
    errorText.value = null
  }
  try {
    // retry: 0 — exactly one request per open / retry / tick
    const res = await api<ReviewDetailView>(`/ads-monitor/ads/${encodeURIComponent(id)}/review`, { retry: 0 })
    if (s !== session) return
    detail.value = res
    errorText.value = null
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    if (!silent) {
      detail.value = null
      errorText.value = err.data?.error ?? err.message ?? 'โหลดรายละเอียดการตรวจสอบไม่สำเร็จ'
    }
    // a failed poll tick changes nothing: the next tick (or the cap) decides
  } finally {
    if (s === session && !silent) pending.value = false
  }
}

/** The row summary as this detail sees it (contract §1 shape) — what the table needs after a change. */
function summaryOf(d: ReviewDetailView | null): MonitorReviewSummary | null {
  if (!d?.review) return null
  const last = d.lastAppeal
  return {
    appeal: d.review.appeal,
    appealStatus: d.review.appealStatus,
    policyTitle: d.review.issues[0]?.policyTitle ?? null,
    issueCount: d.review.issues.length,
    fetchedAt: d.review.fetchedAt,
    error: d.review.error,
    appealPending: d.appealPending,
    appealError: d.appealError,
    lastAppeal: last ? { jobId: last.jobId, at: last.at, by: last.by, reason: last.reason } : null
  }
}

function emitPatch() {
  const row = props.row
  if (!row || !detail.value) return
  emit('update:review', row, summaryOf(detail.value))
}

// ── polling while an appeal job runs (contract §6, spec "Polling while pending") ──────────────────────────────────
const polling = ref(false)
let timer: ReturnType<typeof setInterval> | null = null
let pollStartedAt = 0
let pollCapMs = POLL_CAP_MS
const pollTimedOut = ref(false)
let tickInFlight = false

function pollEveryMs(): number {
  if (import.meta.client) {
    const override = (window as unknown as { __FEAT082_POLL_MS?: unknown }).__FEAT082_POLL_MS
    if (typeof override === 'number' && override > 0) return override
  }
  return POLL_MS
}

function pollCapOf(): number {
  if (import.meta.client) {
    const override = (window as unknown as { __FEAT082_POLL_CAP_MS?: unknown }).__FEAT082_POLL_CAP_MS
    if (typeof override === 'number' && override > 0) return override
  }
  return POLL_CAP_MS
}

function stopPoll() {
  if (timer) clearInterval(timer)
  timer = null
  polling.value = false
  tickInFlight = false
}

function startPoll() {
  if (timer) return
  pollStartedAt = Date.now()
  pollCapMs = pollCapOf()
  pollTimedOut.value = false
  polling.value = true
  timer = setInterval(() => void tick(), pollEveryMs())
}

/** the job ended while we were watching: tell the human once, and hand the row its new summary */
function announceOutcome() {
  if (appealError.value) {
    toast.add({
      title: 'ยื่นอุทธรณ์ไม่สำเร็จ',
      description: appealError.value.reason,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } else {
    toast.add({
      title: `ยื่นอุทธรณ์แล้ว · สถานะ: ${appealStateText.value}`,
      icon: 'i-lucide-circle-check',
      color: 'success'
    })
  }
  emitPatch()
}

async function tick() {
  if (!open.value || tickInFlight) return
  if (Date.now() - pollStartedAt >= pollCapMs) {
    stopPoll()
    pollTimedOut.value = true
    return
  }
  tickInFlight = true
  try {
    await load(true)
  } finally {
    tickInFlight = false
  }
  if (!appealPending.value && timer) {
    stopPoll()
    announceOutcome()
  }
}

/** every answer decides whether the poll should run: pending → poll, nothing pending → no timer */
watch(appealPending, (value) => {
  if (!open.value) return
  if (value && !timer) startPoll()
})

// ── appeal form (contract §3/§6) ──────────────────────────────────────────────────────────────────────────────────
const formOpen = ref(false)
const reason = ref<AppealReason | null>(null)
const description = ref('')
const submitting = ref(false)

const canSubmit = computed(() => reason.value !== null && description.value.trim() !== '' && !submitting.value)

function openForm() {
  formOpen.value = true
  // the form remembers nothing between opens (spec AS-8)
  reason.value = null
  description.value = ''
}

function closeForm() {
  formOpen.value = false
  reason.value = null
  description.value = ''
}

/**
 * The 409 toast. FEAT-082's own reasons (`noReview` / `appealPending` / `notAppealable` / `advertiserBanned` /
 * `accountUnavailable` / `adGone`, contract §3) are a plain "ทำไม่ได้" with the API's Thai sentence — but since
 * FEAT-085 every job-creating endpoint may answer the shared `duplicate` body instead, so this reads exactly
 * like `ads-monitor.vue`'s `conflictToast()` ("มีงานนี้รออยู่แล้ว (ลำดับที่ n)") when it does.
 */
function appealConflictToast(body: MaybeDuplicateBody | undefined, message: string) {
  if (isDuplicate(body)) {
    toast.add({ title: duplicateText(body?.queuePosition), description: message, icon: 'i-lucide-clock', color: 'warning' })
    return
  }
  toast.add({ title: 'ทำไม่ได้', description: message, icon: 'i-lucide-triangle-alert', color: 'warning' })
}

async function submitAppeal() {
  const id = adId.value
  if (!id || reason.value === null || submitting.value) return
  const body = { adId: id, reason: reason.value, description: description.value.trim() }
  submitting.value = true
  try {
    // retry: 0 — one POST per press, never a silent second appeal
    const res = await api<AppealAccepted>('/ads-monitor/appeal', { retry: 0, method: 'POST', body })
    closeForm()
    // optimistic, exactly like the budget/delete 202s: the pending block shows before the next GET lands
    if (detail.value) detail.value = { ...detail.value, appealPending: res.appealPending, appealError: null }
    emitPatch()
    toast.add({ title: 'ส่งคำร้องเข้าคิวแล้ว', icon: 'i-lucide-circle-check', color: 'success' })
    startPoll()
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody & MaybeDuplicateBody>>
    const message = err.data?.error ?? err.message ?? 'ยื่นอุทธรณ์ไม่ได้'
    if ((err.response?.status ?? err.statusCode) === 409) {
      appealConflictToast(err.data, message)
      closeForm()
      await load(true)
      emitPatch()
    } else {
      // the form keeps its values so the admin can press again
      toast.add({ title: `ยื่นอุทธรณ์ไม่ได้ · ${message}`, icon: 'i-lucide-triangle-alert', color: 'error' })
    }
  } finally {
    submitting.value = false
  }
}

// ── full-size frame modal ────────────────────────────────────────────────────────────────────────────────────────────
const frameOpen = ref(false)
const frameUrl = ref<string | null>(null)
/** frames whose image failed to load (expired/blocked URL) — rendered as the placeholder instead */
const brokenFrames = ref<string[]>([])

function showFrame(frame: ReviewFrameView) {
  if (!frame.url || brokenFrames.value.includes(frame.key)) return
  frameUrl.value = frame.url
  frameOpen.value = true
}

function onFrameError(frame: ReviewFrameView) {
  if (!brokenFrames.value.includes(frame.key)) brokenFrames.value = [...brokenFrames.value, frame.key]
}

function frameReady(frame: ReviewFrameView): boolean {
  return !!frame.url && !brokenFrames.value.includes(frame.key)
}

// ── open / close ─────────────────────────────────────────────────────────────────────────────────────────────────────
watch(open, (isOpen) => {
  if (isOpen) {
    detail.value = null
    errorText.value = null
    pollTimedOut.value = false
    brokenFrames.value = []
    closeForm()
    void load()
  } else {
    // drops a late answer of a now-closed drawer, stops the poll, and patches the row (spec)
    session++
    stopPoll()
    emitPatch()
  }
})

onUnmounted(() => {
  session++
  stopPoll()
})

// USlideover's root is renderless: `content` is v-bound onto the DialogContent element QA locates as
// `am-review-drawer[data-polling]` (same trick as `ta-adv-slideover`). 720 px from 769 px up, full width below
// (spec: full width ≤ 768 px).
const drawerContent = computed(() => ({
  'data-testid': 'am-review-drawer',
  'data-polling': polling.value ? '1' : '0'
}) as SlideoverProps['content'])
/**
 * The width goes through `ui.content` (tailwind-merge), **not** through the `content` attrs above: a `class`
 * attribute there is concatenated with the theme's own `max-w-md` and loses the cascade.
 */
const drawerUi = { content: 'w-full max-w-full min-[769px]:max-w-[720px]', body: 'flex flex-col gap-4' }
const closeButton = { 'data-testid': 'am-review-close' } as SlideoverProps['close']
const frameModalContent = { 'data-testid': 'am-review-frame-modal' } as ModalProps['content']
</script>

<template>
  <USlideover
    v-model:open="open"
    title="รายละเอียดการตรวจสอบโฆษณา"
    side="right"
    :close="closeButton"
    :content="drawerContent"
    :ui="drawerUi"
  >
    <template #description>
      <span class="block truncate text-xs text-muted" data-testid="am-review-ad-name">{{ adName }}</span>
    </template>

    <template #body>
      <!-- loading -->
      <div v-if="pending" class="flex flex-col gap-3" data-testid="am-review-loading">
        <USkeleton class="h-20 w-full" />
        <USkeleton class="h-40 w-full" />
        <USkeleton class="h-24 w-full" />
      </div>

      <!-- error -->
      <UAlert
        v-else-if="errorText"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="โหลดรายละเอียดการตรวจสอบไม่สำเร็จ"
        :description="errorText"
        data-testid="am-review-error"
      >
        <template #actions>
          <UButton
            label="ลองใหม่"
            icon="i-lucide-refresh-cw"
            color="error"
            size="xs"
            data-testid="am-review-retry"
            @click="load()"
          />
        </template>
      </UAlert>

      <template v-else-if="detail">
        <!-- status + summary + อุทธรณ์ (TikTok's drawer header card) -->
        <div class="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-default p-3">
          <div class="flex min-w-0 flex-col gap-1">
            <span class="flex items-center gap-1.5 font-medium" data-testid="am-review-status">
              <UIcon v-if="status?.key === 'rejected'" name="i-lucide-triangle-alert" class="size-4 text-error" />
              <span v-else class="size-2 shrink-0 rounded-full" :class="statusDot" />
              <span :class="statusText">{{ statusLabel }}</span>
            </span>
            <span
              v-if="statusSecondary"
              class="text-sm break-words"
              :class="statusSecondaryClass"
              data-testid="am-review-status-secondary"
            >{{ statusSecondary }}</span>
            <span v-if="review" class="text-sm text-muted" data-testid="am-review-summary">{{ summaryText }}</span>
          </div>

          <UTooltip :text="appealBlockedText" :disabled="canAppeal">
            <span class="inline-flex" :title="appealBlockedText || undefined">
              <UButton
                label="อุทธรณ์"
                icon="i-lucide-gavel"
                color="primary"
                variant="outline"
                :disabled="!canAppeal || formOpen"
                data-testid="am-appeal-open"
                @click="openForm"
              />
            </span>
          </UTooltip>
        </div>

        <!-- appeal state: pending spinner · last appeal · last failure -->
        <div
          v-if="appealState !== 'none'"
          class="flex min-w-0 flex-col gap-1 rounded-lg border border-default p-3"
          data-testid="am-appeal-state"
          :data-state="appealState"
        >
          <span v-if="appealState === 'pending'" class="flex items-center gap-2 text-sm text-muted">
            <UIcon name="i-lucide-loader-circle" class="size-4 shrink-0 animate-spin" />
            <span data-testid="am-appeal-pending-line">{{ pendingLine }}</span>
          </span>

          <template v-else>
            <UBadge
              :color="appealStateColor"
              variant="subtle"
              size="sm"
              :icon="appealStateIcon"
              :label="appealStateText"
              class="w-fit"
            />
            <span
              v-if="appealState === 'error' && appealError"
              class="text-sm break-words text-error"
              data-testid="am-appeal-error-reason"
            >{{ appealError.reason }}</span>
            <UButton
              v-if="appealState === 'error'"
              label="ลองอีกครั้ง"
              icon="i-lucide-rotate-ccw"
              color="error"
              variant="subtle"
              size="xs"
              class="w-fit"
              :disabled="!canAppeal || formOpen"
              data-testid="am-appeal-retry"
              @click="openForm"
            />
          </template>

          <span
            v-if="lastAppealLine"
            class="text-xs break-words text-muted"
            data-testid="am-appeal-last"
          >{{ lastAppealLine }}</span>
        </div>

        <p
          v-if="pollTimedOut"
          class="text-sm text-warning"
          data-testid="am-review-poll-timeout"
        >
          ยังไม่ทราบผล — ปิดแล้วเปิดใหม่ภายหลัง
        </p>

        <!-- appeal form (TikTok's "คำร้องเกี่ยวกับโฆษณา" dialog, inline in the drawer) -->
        <form
          v-if="formOpen"
          class="flex min-w-0 flex-col gap-3 rounded-lg border border-primary/40 bg-elevated/40 p-3"
          data-testid="am-appeal-form"
          @submit.prevent="submitAppeal"
        >
          <p class="font-medium text-highlighted">
            คำร้องเกี่ยวกับโฆษณา
          </p>

          <fieldset class="flex min-w-0 flex-col gap-2">
            <legend class="mb-1 text-sm text-muted">
              เหตุผลในการอุทธรณ์
            </legend>
            <label
              v-for="item in APPEAL_REASON_ITEMS"
              :key="item.value"
              class="flex min-w-0 cursor-pointer items-start gap-2 text-sm"
            >
              <input
                v-model="reason"
                type="radio"
                name="am-appeal-reason"
                class="mt-0.5 size-4 shrink-0 accent-primary"
                :value="item.value"
                :data-testid="`am-appeal-reason-${item.value}`"
              >
              <span class="min-w-0">{{ item.label }}</span>
            </label>
          </fieldset>

          <div class="flex min-w-0 flex-col gap-1">
            <label class="text-sm text-muted" for="am-appeal-description-input">คำอธิบาย</label>
            <UTextarea
              id="am-appeal-description-input"
              v-model="description"
              :rows="4"
              :maxlength="DESCRIPTION_MAX"
              placeholder="อธิบายเหตุผลของการอุทธรณ์ที่นี่"
              :ui="{ base: 'resize-y' }"
              data-testid="am-appeal-description"
            />
            <span
              class="self-end text-xs text-muted tabular-nums"
              data-testid="am-appeal-counter"
            >{{ description.length }}/{{ DESCRIPTION_MAX }}</span>
          </div>

          <p class="text-xs text-muted">
            เอกสารประกอบ: ยังไม่รองรับในเวอร์ชันนี้
          </p>

          <div class="flex flex-wrap justify-end gap-2">
            <UButton
              label="ยกเลิก"
              color="neutral"
              variant="subtle"
              type="button"
              data-testid="am-appeal-cancel"
              @click="closeForm"
            />
            <UButton
              label="ส่ง"
              color="primary"
              type="submit"
              :disabled="!canSubmit"
              :loading="submitting"
              data-testid="am-appeal-submit"
            />
          </div>
        </form>

        <!-- review === null is a 200 too -->
        <UAlert
          v-if="isEmpty"
          color="neutral"
          variant="subtle"
          icon="i-lucide-file-question"
          title="ไม่มีรายละเอียด"
          description="ยังไม่มีรายละเอียดการตรวจสอบของโฆษณานี้ — รอรอบ kpi ถัดไป"
          data-testid="am-review-empty"
        />

        <!-- "เนื้อหาที่ถูกปฏิเสธ | รายละเอียดการปฏิเสธ" -->
        <div v-else-if="review" class="flex min-w-0 flex-col" data-testid="am-review-table">
          <div class="hidden gap-4 border-b border-default pb-2 text-sm font-semibold text-highlighted sm:grid sm:grid-cols-[10rem_1fr]">
            <span>เนื้อหาที่ถูกปฏิเสธ</span>
            <span>รายละเอียดการปฏิเสธ</span>
          </div>

          <div
            v-for="issue in issues"
            :key="issue.materialId"
            class="grid min-w-0 gap-2 border-b border-default py-3 sm:grid-cols-[10rem_1fr] sm:gap-4"
            data-testid="am-review-issue"
            :data-material-id="issue.materialId"
          >
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="text-sm break-words" data-testid="am-review-content-title">{{ issue.contentTitle || REPORT_DASH }}</span>
              <span class="text-xs text-dimmed sm:hidden">เนื้อหาที่ถูกปฏิเสธ</span>
            </div>

            <div class="flex min-w-0 flex-col gap-2">
              <span class="font-semibold text-highlighted" data-testid="am-review-policy">{{ issue.policyTitle || REPORT_DASH }}</span>

              <p
                v-if="issue.specification"
                class="text-sm break-words text-default"
                data-testid="am-review-specification"
              >
                {{ issue.specification }}
              </p>

              <p
                v-if="issue.suggestion"
                class="text-sm break-words text-muted"
                data-testid="am-review-suggestion"
              >
                {{ issue.suggestion }}
              </p>

              <ul v-if="issue.reasons.length > 0" class="list-disc space-y-0.5 pl-5" data-testid="am-review-reasons">
                <li v-for="(text, i) in issue.reasons" :key="i" class="text-sm break-words text-muted">
                  {{ text }}
                </li>
              </ul>

              <template v-if="issue.frames.length > 0">
                <span class="text-xs text-muted">ภาพหน้าจอที่มีการละเมิด</span>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    v-for="frame in issue.frames"
                    :key="frame.key"
                    type="button"
                    class="flex aspect-square min-w-0 items-center justify-center overflow-hidden rounded-md border border-default bg-elevated"
                    :class="frameReady(frame) ? 'cursor-zoom-in' : 'cursor-default'"
                    :aria-label="frameReady(frame) ? 'ดูภาพขนาดเต็ม' : 'ไม่มีภาพ'"
                    @click="showFrame(frame)"
                  >
                    <img
                      v-if="frameReady(frame)"
                      :src="frame.url ?? ''"
                      alt="ภาพหน้าจอที่มีการละเมิด"
                      loading="lazy"
                      referrerpolicy="no-referrer"
                      class="size-full object-cover"
                      data-testid="am-review-frame"
                      :data-key="frame.key"
                      @error="onFrameError(frame)"
                    >
                    <UIcon
                      v-else
                      name="i-lucide-image-off"
                      class="size-6 text-dimmed"
                      data-testid="am-review-frame-missing"
                      :data-key="frame.key"
                    />
                  </button>
                </div>
              </template>

              <span
                v-if="issue.forbiddenCountries.length > 0"
                class="text-sm break-words text-muted"
                data-testid="am-review-countries"
              >ภูมิภาคที่ได้รับผลกระทบ: {{ countriesText(issue.forbiddenCountries) }}</span>

              <span
                v-if="issue.forbiddenAges.length > 0"
                class="text-sm break-words text-muted"
                data-testid="am-review-ages"
              >ช่วงอายุ: {{ ageBandsText(issue.forbiddenAges) }}</span>
            </div>
          </div>
        </div>

        <!-- footer -->
        <div v-if="review" class="flex min-w-0 flex-col gap-1">
          <span class="text-xs text-muted" data-testid="am-review-fetched-at">อัปเดตล่าสุด {{ fetchedAtText }}</span>
          <span
            v-if="review.error"
            class="text-xs break-words text-warning"
            data-testid="am-review-warning"
          >{{ review.error }}</span>
          <span
            v-if="review.framesError"
            class="text-xs break-words text-warning"
            data-testid="am-review-frames-warning"
          >{{ review.framesError }}</span>
        </div>
      </template>
    </template>
  </USlideover>

  <UModal
    v-model:open="frameOpen"
    title="ภาพหน้าจอที่มีการละเมิด"
    :ui="{ content: 'sm:max-w-3xl' }"
    :content="frameModalContent"
  >
    <template #body>
      <img
        v-if="frameUrl"
        :src="frameUrl"
        alt="ภาพหน้าจอที่มีการละเมิด (ขนาดเต็ม)"
        referrerpolicy="no-referrer"
        class="mx-auto block max-h-[70vh] w-auto max-w-full rounded-lg border border-default bg-elevated object-contain"
        data-testid="am-review-frame-full"
      >
    </template>
  </UModal>
</template>
