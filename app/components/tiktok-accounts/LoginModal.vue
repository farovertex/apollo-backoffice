<script setup lang="ts">
/**
 * FEAT-004 — Login flow modal (functions 3.5 + 3.7, spec.md "UI behaviour", api-contract.md v1).
 * The page opens it after `POST /backend/tiktok-accounts/:id/login` answered 202 or 409. While open it polls
 * `GET /backend/tiktok-accounts/:id` every 2 s (first poll immediately) and derives one of five states, exposed as
 * `data-state` on the dialog element (`ta-login-modal`):
 *   running  — a job is waiting/active (or a 202 was just received): spinner + step text (`ta-login-step`)
 *   otp      — `sessionStatus === 'needsHuman'` + open otp task: one `GET /backend/human-tasks/:id` → screenshot,
 *              instructions, countdown from `expiresAt`, code input → `POST /backend/human-tasks/:id/resolve`
 *              (202 → running · 410 → expired · 409 → re-poll · other → `ta-otp-error`)
 *   expired  — 410 on resolve or the countdown reached 0 (no request): "Login again" re-POSTs login
 *   success  — `loggedIn` + no running *login* job: toast "Logged in", `success` emitted, modal closes
 *   error    — no login job running and not logged in: `lastLoginError` text (`ta-login-error-text`) + "Try again"
 * Close (`ta-login-close`, Esc, outside click) stops polling; the job continues server-side. The OTP value lives
 * only in the input until submit, is cleared right after, and never reaches a data attribute, log or toast.
 * FEAT-005 (api-contract.md v1 §7): a login success enqueues a `discover` job right away, so only
 * `runningJob.type === 'login'` counts as running here; `loggedIn` + a running discover job is a success and
 * `loggedOut` + a running discover job is an error (the table shows "Syncing…" for that row after the modal closes).
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { HumanTask, ResolveHumanTaskBody, ResolveHumanTaskResponse } from '#shared/types/human-tasks'
import type { JobStep, LoginConflictBody, LoginJobResponse, TikTokAccount } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  accountId: string | null
  /** shown under the title (label or login email) */
  accountLabel?: string | null
}>()

const emit = defineEmits<{
  /** the account reached `loggedIn`; the modal closes itself right after */
  success: [accountId: string]
  /** closed by the user (button / Esc / outside click) before a success */
  close: [accountId: string]
}>()

const open = defineModel<boolean>('open', { default: false })

type LoginState = 'running' | 'otp' | 'expired' | 'success' | 'error'

const POLL_MS = 2000
const COUNTDOWN_MS = 1000

const api = useApi()
const toast = useToast()

// ── poll ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const account = ref<TikTokAccount | null>(null)
const pollError = ref<string | null>(null)
/** set after a 202 (login / resolve) so the UI shows running until the next poll lands */
const forceRunning = ref(false)
const expired = ref(false)
const succeeded = ref(false)

let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false
// bumped on every start/stop so a response from a previous session (closed modal, pre-202 poll) is dropped
let pollSession = 0

async function poll() {
  const id = props.accountId
  if (!id || pollInFlight) return
  const session = pollSession
  pollInFlight = true
  try {
    // retry: 0 — one request per tick, ofetch must not re-issue it on 5xx
    const next = await api<TikTokAccount>(`/tiktok-accounts/${encodeURIComponent(id)}`, { retry: 0 })
    if (session !== pollSession) return
    account.value = next
    pollError.value = null
    forceRunning.value = false
  } catch (e) {
    if (session !== pollSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    pollError.value = err.data?.error ?? err.message ?? 'Could not refresh the status'
  } finally {
    if (session === pollSession) pollInFlight = false
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  pollSession++
  pollInFlight = false
}

function startPolling() {
  stopPolling()
  void poll()
  pollTimer = setInterval(() => {
    void poll()
  }, POLL_MS)
}

// ── state ────────────────────────────────────────────────────────────────────────────────────────────────────────────
const state = computed<LoginState>(() => {
  const a = account.value
  if (!a) return 'running'
  // FEAT-005: a `discover` job (auto-enqueued after login) is not a login job — ignore it here
  const loginRunning = a.runningJob !== null && a.runningJob.type === 'login'
  if (a.sessionStatus === 'loggedIn' && !loginRunning) return 'success'
  if (expired.value) return 'expired'
  if (forceRunning.value) return 'running'
  if (a.sessionStatus === 'needsHuman' && a.openHumanTask?.kind === 'otp') return 'otp'
  // no login job running and not logged in: `loggedOut` + `lastLoginError` (spec), or any other status left behind
  if (!loginRunning) return 'error'
  return 'running'
})

// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-login-modal[data-state]`).
const modalContent = computed(() => ({ 'data-testid': 'ta-login-modal', 'data-state': state.value }) as ModalProps['content'])

const TITLE: Record<LoginState, string> = {
  running: 'Logging in…',
  otp: 'Enter the verification code',
  expired: 'The code expired',
  success: 'Logged in',
  error: 'Login failed'
}
const title = computed(() => TITLE[state.value])

// login steps only: the discover steps never reach this modal (a running discover job is not shown as running)
const STEP_TEXT: Partial<Record<JobStep, string>> = {
  starting: 'Starting the browser…',
  checking: 'Checking the session…',
  fillingForm: 'Filling the login form…',
  solvingCaptcha: 'Solving the captcha…',
  waitingHuman: 'Waiting for the verification code…',
  enteringOtp: 'Entering the code…',
  finishing: 'Finishing…'
}
const stepText = computed<string>(() => {
  const job = account.value?.runningJob
  if (!job || job.type !== 'login') return 'Starting…'
  const base = job.step ? (STEP_TEXT[job.step] ?? job.step) : job.status === 'waiting' ? 'Queued…' : 'Starting…'
  return job.trigger === 'retry' ? `Retrying (2/2)… ${base}` : base
})

const errorText = computed(() => loginErrorText(account.value?.lastLoginError))

// FEAT-031 — `on <id>` under the step text while an active login job carries a WORKER_INSTANCE (`ta-login-worker`)
const loginWorkerInstance = computed<string | null>(() => {
  const job = account.value?.runningJob
  if (!job || job.type !== 'login') return null
  return job.workerInstance
})

// ── otp task (one GET per task id) ───────────────────────────────────────────────────────────────────────────────────
const task = ref<HumanTask | null>(null)
const taskPending = ref(false)
const taskError = ref<string | null>(null)
let taskFetchedFor: string | null = null

async function loadTask(taskId: string) {
  taskFetchedFor = taskId
  taskPending.value = true
  taskError.value = null
  const session = pollSession
  try {
    const t = await api<HumanTask>(`/human-tasks/${encodeURIComponent(taskId)}`, { retry: 0 })
    if (session !== pollSession) return
    task.value = t
    if (t.status === 'expired') expired.value = true
  } catch (e) {
    if (session !== pollSession) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    if (err.statusCode === 410) {
      expired.value = true
    } else {
      taskError.value = err.data?.error ?? err.message ?? 'Could not load the task'
    }
  } finally {
    if (session === pollSession) taskPending.value = false
  }
}

function resetTask() {
  task.value = null
  taskPending.value = false
  taskError.value = null
  taskFetchedFor = null
  otpError.value = null
  otpForm.otpInput = ''
  form.value?.clear()
}

const screenshotSrc = computed(() =>
  task.value?.screenshotBase64 ? `data:image/png;base64,${task.value.screenshotBase64}` : null
)
const instructions = computed(() => task.value?.instructions ?? 'Enter the code TikTok emailed to this account.')

// ── countdown (1 s tick while in otp state; 0 → expired without a request) ──────────────────────────────────────────
const now = ref(Date.now())
let countdownTimer: ReturnType<typeof setInterval> | null = null

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer)
  countdownTimer = null
}
function startCountdown() {
  stopCountdown()
  now.value = Date.now()
  countdownTimer = setInterval(() => {
    now.value = Date.now()
  }, COUNTDOWN_MS)
}

const expiresAt = computed<number | null>(() => {
  const iso = task.value?.expiresAt ?? account.value?.openHumanTask?.expiresAt
  if (!iso) return null
  const ms = new Date(iso).getTime()
  return Number.isNaN(ms) ? null : ms
})
const remainingSeconds = computed(() =>
  expiresAt.value === null ? null : Math.max(0, Math.floor((expiresAt.value - now.value) / 1000))
)
const countdown = computed(() => {
  const s = remainingSeconds.value
  if (s === null) return '--:--'
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
})

watch(remainingSeconds, (s) => {
  if (s === 0 && state.value === 'otp') expired.value = true
})

// ── otp form ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const schema = z.object({
  otpInput: z.string({ error: 'Enter the code' })
    .trim()
    .regex(/^[A-Za-z0-9]{4,8}$/, 'Enter the 4 to 8 character code (letters and digits)')
})
type Schema = z.output<typeof schema>

const otpForm = reactive<{ otpInput: string }>({ otpInput: '' })
const form = useTemplateRef('form')
const otpError = ref<string | null>(null)
const submitting = ref(false)

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const taskId = task.value?.id ?? account.value?.openHumanTask?.id
  if (!taskId || submitting.value) return
  const body: ResolveHumanTaskBody = { otpInput: event.data.otpInput }
  // the code leaves the DOM as soon as it is submitted
  otpForm.otpInput = ''
  submitting.value = true
  otpError.value = null
  try {
    await api<ResolveHumanTaskResponse>(`/human-tasks/${encodeURIComponent(taskId)}/resolve`, { method: 'POST', body, retry: 0 })
    forceRunning.value = true
    startPolling()
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    if (err.statusCode === 410) {
      expired.value = true
    } else if (err.statusCode === 409) {
      // resolved elsewhere / a job already runs → the next poll decides
      startPolling()
    } else {
      otpError.value = err.data?.error ?? err.message ?? 'Could not submit the code'
    }
  } finally {
    submitting.value = false
  }
}

// ── Try again / Login again ──────────────────────────────────────────────────────────────────────────────────────────
const restarting = ref(false)

function backToRunning() {
  expired.value = false
  forceRunning.value = true
  resetTask()
  startPolling()
}

async function restartLogin() {
  const id = props.accountId
  if (!id || restarting.value) return
  restarting.value = true
  try {
    await api<LoginJobResponse>(`/tiktok-accounts/${encodeURIComponent(id)}/login`, { method: 'POST', retry: 0 })
    backToRunning()
  } catch (e) {
    const err = e as FetchError<Partial<LoginConflictBody>>
    if (err.statusCode === 409) {
      // a job / task already exists for this account → just follow it
      backToRunning()
    } else {
      toast.add({
        title: 'Could not start the login',
        description: err.data?.error ?? err.message ?? 'Unexpected error',
        color: 'error'
      })
    }
  } finally {
    restarting.value = false
  }
}

// ── lifecycle ────────────────────────────────────────────────────────────────────────────────────────────────────────
function reset() {
  account.value = null
  pollError.value = null
  forceRunning.value = false
  expired.value = false
  succeeded.value = false
  submitting.value = false
  restarting.value = false
  resetTask()
}

watch(open, (isOpen) => {
  if (isOpen) {
    reset()
    startPolling()
  } else {
    const id = props.accountId
    stopPolling()
    stopCountdown()
    if (!succeeded.value && id) emit('close', id)
    reset()
  }
})

watch(state, (s) => {
  if (s === 'otp') {
    startCountdown()
    const taskId = account.value?.openHumanTask?.id
    if (taskId && taskId !== taskFetchedFor) void loadTask(taskId)
  } else {
    stopCountdown()
  }
  if (s === 'success' && !succeeded.value) {
    succeeded.value = true
    stopPolling()
    const id = props.accountId
    toast.add({ title: 'Logged in', description: props.accountLabel ?? undefined, color: 'success' })
    if (id) emit('success', id)
    open.value = false
  }
})

onUnmounted(() => {
  stopPolling()
  stopCountdown()
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="accountLabel ?? undefined"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4">
        <!-- running -->
        <div v-if="state === 'running'" class="flex items-center gap-3" data-testid="ta-login-running">
          <UIcon name="i-lucide-loader-circle" class="size-6 shrink-0 animate-spin text-primary" />
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted" data-testid="ta-login-step">
              {{ stepText }}
            </p>
            <p v-if="loginWorkerInstance" class="text-xs text-muted" data-testid="ta-login-worker">
              on {{ loginWorkerInstance }}
            </p>
            <p class="text-xs text-muted">
              You can close this window, the login keeps running.
            </p>
            <p v-if="pollError" class="text-xs text-warning" data-testid="ta-login-poll-error">
              Status refresh failed: {{ pollError }}
            </p>
          </div>
        </div>

        <!-- otp -->
        <template v-else-if="state === 'otp'">
          <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span class="text-highlighted" data-testid="ta-otp-instructions">{{ instructions }}</span>
            <span class="flex items-center gap-1 whitespace-nowrap text-muted">
              <UIcon name="i-lucide-timer" class="size-4" />
              <span
                class="font-mono tabular-nums"
                :class="remainingSeconds !== null && remainingSeconds < 30 ? 'text-error' : 'text-highlighted'"
                data-testid="ta-otp-countdown"
              >{{ countdown }}</span>
            </span>
          </div>

          <USkeleton v-if="taskPending" class="h-40 w-full" data-testid="ta-otp-screenshot-loading" />
          <img
            v-else-if="screenshotSrc"
            :src="screenshotSrc"
            alt="Screenshot of the TikTok verification page"
            class="max-h-[45vh] w-full rounded-lg border border-default bg-elevated object-contain"
            data-testid="ta-otp-screenshot"
          >
          <UAlert
            v-if="taskError"
            color="warning"
            variant="subtle"
            icon="i-lucide-image-off"
            title="Could not load the screenshot"
            :description="taskError"
            data-testid="ta-otp-task-error"
          />

          <UForm
            ref="form"
            :schema="schema"
            :state="otpForm"
            class="space-y-4"
            @submit="onSubmit"
          >
            <UFormField label="Verification code" name="otpInput" required>
              <UInput
                v-model="otpForm.otpInput"
                type="text"
                autocomplete="one-time-code"
                maxlength="8"
                placeholder="4 to 8 letters or digits"
                icon="i-lucide-key-round"
                class="w-full"
                :disabled="submitting"
                data-testid="ta-otp-input"
              />
            </UFormField>

            <UAlert
              v-if="otpError"
              color="error"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :title="otpError"
              role="alert"
              data-testid="ta-otp-error"
            />
          </UForm>
        </template>

        <!-- expired -->
        <UAlert
          v-else-if="state === 'expired'"
          color="warning"
          variant="subtle"
          icon="i-lucide-timer-off"
          title="The code expired. Press Login again."
          data-testid="ta-login-expired-text"
        />

        <!-- error -->
        <div
          v-else-if="state === 'error'"
          class="flex items-start gap-3 rounded-lg bg-error/10 p-3 text-error"
          role="alert"
        >
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-5 shrink-0" />
          <p class="text-sm" data-testid="ta-login-error-text">
            {{ errorText }}
          </p>
        </div>

        <!-- success (visible for a frame before the modal closes itself) -->
        <div v-else class="flex items-center gap-3 text-success">
          <UIcon name="i-lucide-check-circle-2" class="size-6 shrink-0" />
          <p class="text-sm font-medium">
            Logged in
          </p>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="Close"
            color="neutral"
            variant="subtle"
            data-testid="ta-login-close"
            @click="open = false"
          />
          <UButton
            v-if="state === 'otp'"
            label="Submit code"
            icon="i-lucide-check"
            color="primary"
            :loading="submitting"
            data-testid="ta-otp-submit"
            @click="form?.submit()"
          />
          <UButton
            v-else-if="state === 'expired'"
            label="Login again"
            icon="i-lucide-log-in"
            color="primary"
            :loading="restarting"
            data-testid="ta-login-again"
            @click="restartLogin"
          />
          <UButton
            v-else-if="state === 'error'"
            label="Try again"
            icon="i-lucide-refresh-cw"
            color="primary"
            :loading="restarting"
            data-testid="ta-login-retry"
            @click="restartLogin"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
