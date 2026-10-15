<script setup lang="ts">
/**
 * FEAT-051 (AC-34, api-contract §8) — the bank's OTP of a card top-up. Same shape as the login OTP modal
 * (`TiktokAccountsLoginModal`, FEAT-004) with three differences that come straight from the contract:
 *   - there is **no screenshot** (a picture of the OTP page would be a secret — AC-25), the round itself is the
 *     context: amount, currency, account and the last 4 digits,
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

const codeError = computed(() => {
  const digits = code.value.trim()
  if (!digits) return 'กรอกรหัส OTP'
  if (!/^\d{4,8}$/.test(digits)) return 'รหัส OTP เป็นตัวเลข 4–8 หลัก'
  return null
})

watch(open, (isOpen) => {
  if (isOpen) {
    code.value = ''
    errorText.value = null
    gone.value = false
    resume()
  } else {
    // ★ the code never outlives the modal
    code.value = ''
    errorText.value = null
    pause()
  }
}, { immediate: true })

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
    :ui="{ content: 'max-w-sm' }"
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
