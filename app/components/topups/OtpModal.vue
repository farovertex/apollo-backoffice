<script setup lang="ts">
/**
 * FEAT-051 (AC-34, api-contract §8) — the bank's OTP of a card top-up. Same shape as the login OTP modal
 * (`TiktokAccountsLoginModal`, FEAT-004) with three differences that come straight from the contract:
 *   - the round itself is the context: amount, currency, account and the last 4 digits. **TASK-otp-shot (2026-10-31,
 *     AC-25 cancelled by the human)**: on top of that the modal shows the bank's OTP page as the worker saw it while
 *     the code box was still empty — `topup.humanTask.screenshot` (api-contract v1.2) names the `cardPay` job whose
 *     `jobScreenshots` row it is, and the image comes from `GET /tiktok-accounts/:id/failure-screenshots/:jobId`
 *     (FEAT-071, presigned URL or inline base64), fetched once per open (`tp-otp-shot`, `data-state` loading · ready ·
 *     error · expired). No screenshot ref = the compact modal of before (the code can still be typed),
 *   - `POST /human-tasks/:id/resolve` answers 202 with **no job** (`jobId: null`): the worker is still holding
 *     the profile and picks the code up itself, so there is nothing to follow here — the row turns `verifying`
 *     through SSE,
 *   - the countdown is the 5 minutes of `humanTask.expiresAt` (`TOPUP_OTP_WAIT_MS`); at 0 the modal says the
 *     code expired, sends nothing and can simply be closed.
 *
 * **The code lives in the input and in the body of that one request only**: masked (`type="password"`), wiped the
 * moment it is submitted and on every close, never in a data attribute, a toast, the console or localStorage
 * (AC-24/AC-36).
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { ResolveHumanTaskBody, ResolveHumanTaskResponse } from '#shared/types/human-tasks'
import { isFailureScreenshotUrl } from '#shared/types/tiktok-accounts'
import type { FailureScreenshotImage } from '#shared/types/tiktok-accounts'
import type { TopupView } from '#shared/types/topups'

const props = defineProps<{
  /** the `awaitingOtp` round whose `humanTask` is open; null while the modal is closed */
  topup: TopupView | null
}>()

const emit = defineEmits<{
  /** the code was accepted (202) — the round is on its way to `verifying` */
  resolved: [topup: TopupView]
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()

const modalContent = computed(() => ({
  'data-testid': 'tp-otp-modal',
  'data-expired': expired.value ? 'true' : 'false'
}) as ModalProps['content'])

// ---------------------------------------------------------------- TASK-otp-shot: the bank's OTP page (empty box)
type ShotState = 'loading' | 'ready' | 'error' | 'expired'
const SHOT_ERR_FALLBACK = 'โหลดภาพไม่ได้'

/** the `jobScreenshots` summary of the OTP page; null = the worker could not take it (or an older API) */
const shot = computed(() => props.topup?.humanTask?.screenshot ?? null)
const shotState = ref<ShotState>('loading')
const shotSrc = ref<string | null>(null)
const shotError = ref<string | null>(null)
// bumped on every open/close so a late response of a previous open is dropped
let shotSession = 0

async function loadShot() {
  const s = ++shotSession
  const accountId = props.topup?.tiktokAccountId
  const jobId = shot.value?.jobId
  shotSrc.value = null
  shotError.value = null
  if (!accountId || !jobId) return
  shotState.value = 'loading'
  try {
    // retry: 0 — exactly one request per open (per click on retry)
    const res = await api<FailureScreenshotImage>(
      `/tiktok-accounts/${encodeURIComponent(accountId)}/failure-screenshots/${encodeURIComponent(jobId)}`,
      { retry: 0 }
    )
    if (s !== shotSession) return
    if (isFailureScreenshotUrl(res)) shotSrc.value = res.url
    else if (res.base64) shotSrc.value = `data:${res.mimeType};base64,${res.base64}`
    else throw new Error(SHOT_ERR_FALLBACK)
    shotState.value = 'ready'
  } catch (e) {
    if (s !== shotSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    if (err.statusCode === 404) {
      shotState.value = 'expired'
    } else {
      shotError.value = err.data?.error ?? SHOT_ERR_FALLBACK
      shotState.value = 'error'
    }
  }
}

function onShotError() {
  shotError.value = SHOT_ERR_FALLBACK
  shotState.value = 'error'
}

// the ref can only appear/change while the modal is open through SSE (a fresh row): reload then, never poll
watch(() => shot.value?.jobId ?? null, () => {
  if (open.value) void loadShot()
})

const { now, pause, resume } = useNow({ interval: 1000, controls: true })
const nowMs = computed(() => now.value.getTime())

const code = ref('')
const submitting = ref(false)
const errorText = ref<string | null>(null)
/** 410 from the API, or the countdown reached 0 */
const gone = ref(false)

const taskId = computed(() => props.topup?.humanTask?.id ?? null)
const remainMs = computed(() => otpRemainingMs(props.topup, nowMs.value))
const expiresAt = computed(() => props.topup?.humanTask?.expiresAt ?? null)
const expired = computed(() => gone.value || (!!expiresAt.value && remainMs.value === 0))
const card = computed(() => topupCard(props.topup))

const amountText = computed(() => {
  const topup = props.topup
  if (!topup) return ''
  return `${formatInt(topup.amount)} ${topup.currency}`
})

/**
 * The same rule the API validates (`human-tasks.dto.ts`: 4–8 letters or digits) so the BO can never refuse a code
 * the API would have accepted. A bank code is numeric in practice, which is what `inputmode="numeric"` is for.
 */
const codeError = computed(() => {
  const value = code.value.trim()
  if (!value) return 'กรอกรหัส OTP'
  if (!/^[A-Za-z0-9]{4,8}$/.test(value)) return 'รหัส OTP เป็นตัวเลขหรือตัวอักษร 4–8 ตัว'
  return null
})

watch(open, (isOpen) => {
  if (isOpen) {
    code.value = ''
    errorText.value = null
    gone.value = false
    resume()
    void loadShot()
  } else {
    // ★ the code never outlives the modal
    code.value = ''
    errorText.value = null
    pause()
    shotSession++
    shotSrc.value = null
  }
}, { immediate: true })

onUnmounted(() => {
  shotSession++
})

async function submit() {
  const id = taskId.value
  if (!id || submitting.value || expired.value) return
  if (codeError.value) {
    errorText.value = codeError.value
    return
  }
  const body: ResolveHumanTaskBody = { otpInput: code.value.trim() }
  // ★ out of the DOM as soon as it is sent
  code.value = ''
  submitting.value = true
  errorText.value = null
  try {
    // retry: 0 — one submit per click, a code is good exactly once
    await api<ResolveHumanTaskResponse>(`/human-tasks/${encodeURIComponent(id)}/resolve`, { method: 'POST', retry: 0, body })
    open.value = false
    toast.add({
      'title': 'ส่งรหัสแล้ว',
      'description': 'ระบบกำลังกรอกรหัสและรอผลการจ่ายเงิน',
      'color': 'success',
      'data-testid': 'ta-toast'
    } as Parameters<typeof toast.add>[0])
    if (props.topup) emit('resolved', props.topup)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    // the API's own text, always (410 = the code's 5 minutes are over, 409 = somebody already sent one)
    errorText.value = err.data?.error ?? err.message ?? 'ส่งรหัสไม่สำเร็จ'
    if (status === 410) gone.value = true
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="กรอกรหัส OTP จากธนาคาร"
    :dismissible="!submitting"
    :ui="{ content: shot ? 'max-w-2xl' : 'max-w-sm' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <div class="flex flex-col gap-1 rounded-lg bg-elevated/50 px-3 py-2 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="min-w-0 break-words text-muted">{{ topupTargetName(topup) }}</span>
            <span class="font-semibold tabular-nums whitespace-nowrap text-highlighted" data-testid="tp-otp-amount">{{ amountText }}</span>
          </div>
          <span v-if="card" class="text-xs text-muted" data-testid="tp-otp-card">{{ cardSummary(card) }}</span>
        </div>

        <!-- TASK-otp-shot: the bank's OTP page while its box was still empty (ref code, masked phone, amount as the bank shows it) -->
        <div
          v-if="shot"
          class="flex flex-col gap-1"
          data-testid="tp-otp-shot"
          :data-state="shotState"
          :data-job-id="shot.jobId"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
            <span>หน้า OTP ของธนาคาร (ตอนช่องยังว่าง)</span>
            <span data-testid="tp-otp-shot-at">{{ formatDateTime(shot.at) }}</span>
          </div>
          <USkeleton v-if="shotState === 'loading'" class="h-56 w-full" data-testid="tp-otp-shot-loading" />
          <img
            v-else-if="shotState === 'ready' && shotSrc"
            :key="shot.jobId"
            :src="shotSrc"
            alt="หน้า OTP ของธนาคารตอนช่องยังว่าง"
            class="mx-auto block max-h-[55vh] max-w-full w-auto rounded-lg border border-default bg-elevated object-contain"
            data-testid="tp-otp-shot-img"
            @error="onShotError"
          >
          <UAlert
            v-else-if="shotState === 'expired'"
            color="neutral"
            variant="subtle"
            icon="i-lucide-image-off"
            title="ไม่มีภาพแล้ว (หมดอายุหรือถูกแทนที่)"
            data-testid="tp-otp-shot-expired"
          />
          <div
            v-else
            class="flex flex-wrap items-center gap-3 rounded-lg bg-error/10 p-3 text-error"
            role="alert"
            data-testid="tp-otp-shot-error-box"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-5 shrink-0" />
            <p class="min-w-0 flex-1 text-sm" data-testid="tp-otp-shot-error-text">
              {{ shotError ?? SHOT_ERR_FALLBACK }}
            </p>
            <UButton
              label="ลองใหม่"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="subtle"
              size="xs"
              data-testid="tp-otp-shot-retry"
              @click="loadShot"
            />
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 text-sm">
          <span class="text-muted">เหลือเวลา</span>
          <span
            class="inline-flex items-center gap-1 font-mono tabular-nums"
            :class="remainMs < 30_000 ? 'text-error' : 'text-highlighted'"
            data-testid="tp-otp-remain"
            :data-expires-at="expiresAt ?? ''"
          >
            <UIcon name="i-lucide-timer" class="size-4 shrink-0" />
            {{ formatRemain(remainMs) }}
          </span>
        </div>

        <UAlert
          v-if="expired"
          color="warning"
          variant="subtle"
          icon="i-lucide-timer-off"
          title="รหัสหมดอายุแล้ว"
          :description="errorText ?? 'ปิดหน้านี้ได้เลย — ระบบจะไปตรวจรายการเงินให้เอง'"
          data-testid="tp-otp-expired"
        />

        <!-- a `<form>` so Enter submits and Chromium does not warn about a password field outside one -->
        <form
          v-else
          class="flex flex-col gap-2"
          autocomplete="off"
          @submit.prevent="submit"
        >
          <UFormField label="รหัส OTP" :error="errorText ?? undefined">
            <UInput
              v-model="code"
              type="password"
              inputmode="numeric"
              autocomplete="one-time-code"
              maxlength="8"
              placeholder="••••••"
              class="w-full"
              :disabled="submitting"
              data-testid="tp-otp-input"
            />
          </UFormField>
          <p class="text-xs text-muted">
            ธนาคารส่งรหัสไปที่มือถือของเจ้าของบัตร · ใส่ได้ครั้งเดียวต่อรหัส
          </p>
        </form>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ปิด"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="tp-otp-close"
            @click="open = false"
          />
          <UButton
            v-if="!expired"
            label="ส่งรหัส"
            icon="i-lucide-check"
            color="primary"
            :loading="submitting"
            data-testid="tp-otp-submit"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
