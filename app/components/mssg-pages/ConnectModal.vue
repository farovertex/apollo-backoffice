<script setup lang="ts">
/**
 * FEAT-099 (spec "UI behaviour → Connect / relogin modal", AC-10, AC-11, AC-12, AC-15) — three steps:
 *   1. email + password (show/hide) → `POST /mssg-accounts` (connect) or `POST /mssg-accounts/:id/relogin` (relogin,
 *      email read-only, the body is `{ password }` only);
 *   2. "กำลังเข้าสู่ระบบ mssg" with the queue/step text while the job runs — closing the modal cancels nothing;
 *   3. success: email, plan, quota, sites + optional nickname → `PATCH /mssg-accounts/:id` only when it changed.
 *
 * Like FEAT-098's `TtUnlinkModal`, this modal only makes its own POST/PATCH (`retry: 0`, one per click). The page
 * owns the 2 s poll of `GET /mssg-accounts/:id`, because the job outlives the modal, and hands the latest view back
 * in as `account`. A failed job returns to step 1 with the Thai text of `lastError.code`; after a failed **connect**
 * the account exists (status `error`, profile kept, AC-11), so the modal continues as a relogin of that account.
 *
 * The password is held only in this component's form state and is cleared the moment the request is sent — never in
 * a store, the URL, a log or `localStorage`. Server messages live in a component-owned `serverErrors` map bound to
 * each `UFormField :error` (FEAT-008 BUG-007: `UForm.setErrors()` is wiped by the validate-on-input debounce).
 * `validate-on` is `['input']` only (BUG-045: `change`/`blur` fire while the mouse is down on the submit button, the
 * inserted error line moves it and the click is lost; submit still validates every field).
 */
import * as z from 'zod'
import type { Form, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { MssgAccountView, MssgConnectBody, MssgReloginBody, MssgRenameBody } from '#shared/types/mssg-accounts'

const props = defineProps<{
  /** relogin: the account from the start · connect: `null` until the 202, then the page's latest view of it */
  account: MssgAccountView | null
  /** opened as a relogin of `account` */
  relogin: boolean
  /** GOD in another area: sent in the connect body; `''` = own area (key omitted) */
  workspaceId: string
  /** the page's 15 min follow-up of this account gave up */
  pollTimedOut: boolean
}>()

const emit = defineEmits<{
  /** 202 of connect/relogin: the page upserts the view and follows its job */
  requested: [view: MssgAccountView]
  /** 200 of the nickname PATCH */
  renamed: [view: MssgAccountView]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless: the test id goes on the rendered DialogContent (same as `ta-tt-unlink-modal`)
const modalContent = computed(() => ({ 'data-testid': 'mp-modal', 'data-step': String(step.value), 'data-mode': mode.value }) as ModalProps['content'])

const api = useApi()
const toast = useToast()

type Step = 1 | 2 | 3
const step = ref<Step>(1)
/** connect until an account exists for this modal, then relogin (also after a failed connect) */
const mode = ref<'connect' | 'relogin'>('connect')
/** the job this modal ordered; `null` = nothing ordered since the last step-1 view */
const orderedJobId = ref<string | null>(null)
const requesting = ref(false)
const saving = ref(false)
/** a failed job or a request error shown above the step-1 submit */
const formError = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})
const showPassword = ref(false)

const STEPS: { n: Step, label: string }[] = [
  { n: 1, label: 'กรอกบัญชี' },
  { n: 2, label: 'ตรวจสอบ' },
  { n: 3, label: 'ยืนยัน' }
]

// ── step 1 form ──────────────────────────────────────────────────────────────────────────────────────────────────────
const emailSchema = z.string({ error: 'กรอกอีเมลบัญชี mssg' })
  .trim()
  .toLowerCase()
  .min(1, 'กรอกอีเมลบัญชี mssg')
  .max(254, 'อีเมลยาวได้ไม่เกิน 254 ตัวอักษร')
  .pipe(z.email('กรอกอีเมลบัญชี mssg ให้ถูกต้อง'))
const passwordSchema = z.string({ error: 'กรอกรหัสผ่าน' })
  .min(1, 'กรอกรหัสผ่าน')
  .max(200, 'รหัสผ่านยาวได้ไม่เกิน 200 ตัวอักษร')

const loginSchema = computed(() => z.object({
  // relogin: the email is read-only and never sent, so it is not validated
  email: mode.value === 'connect' ? emailSchema : z.string(),
  password: passwordSchema
}))
type LoginSchema = z.output<typeof loginSchema.value>

const login = reactive({ email: '', password: '' })
const loginForm = useTemplateRef<Form<LoginSchema>>('loginForm')

// any edit invalidates what the server said about the form
watch(() => [login.email, login.password], () => {
  serverErrors.value = {}
})

// ── step 3 form ──────────────────────────────────────────────────────────────────────────────────────────────────────
const nicknameSchema = z.object({
  nickname: z.string().trim().max(60, 'ชื่อเรียกยาวได้ไม่เกิน 60 ตัวอักษร')
})
type NicknameSchema = z.output<typeof nicknameSchema>
const nick = reactive({ nickname: '' })
const nickForm = useTemplateRef<Form<NicknameSchema>>('nickForm')
watch(() => nick.nickname, () => {
  delete serverErrors.value.nickname
})

// ── open / reset ─────────────────────────────────────────────────────────────────────────────────────────────────────
function reset() {
  step.value = 1
  mode.value = props.relogin ? 'relogin' : 'connect'
  orderedJobId.value = null
  requesting.value = false
  saving.value = false
  formError.value = null
  showPassword.value = false
  login.email = props.relogin ? (props.account?.email ?? '') : ''
  login.password = ''
  nick.nickname = props.account?.nickname ?? ''
  serverErrors.value = {}
  loginForm.value?.clear()
  nickForm.value?.clear()
}

// open → a clean form for this account; close → the same, so the password never outlives the modal
watch(open, () => reset())

const title = computed(() => (mode.value === 'relogin' ? 'เข้าสู่ระบบ mssg ใหม่' : 'เชื่อมบัญชี mssg'))
const description = computed(() => {
  if (mode.value === 'relogin' && props.account) return `${mssgAccountName(props.account)} · ใช้โปรไฟล์เบราว์เซอร์เดิมของบัญชีนี้`
  // contract v2: a free mssg profile of the area is reused, else a new dedicated one is created
  return 'ระบบจะใช้โปรไฟล์เบราว์เซอร์ mssg ที่ว่างของพื้นที่นี้ หรือสร้างใหม่ถ้าไม่มี แล้วเข้าสู่ระบบ next.mssg.me ให้'
})

// ── follow the ordered job through the page's view ──────────────────────────────────────────────────────────────────
watch(
  () => [props.account?.id, props.account?.job?.id, props.account?.job?.status] as const,
  () => {
    if (!open.value || step.value !== 2 || !orderedJobId.value) return
    const acc = props.account
    if (!acc) {
      // unlinked meanwhile (the page got a 404)
      step.value = 1
      orderedJobId.value = null
      formError.value = 'ไม่พบบัญชีนี้แล้ว อาจถูกยกเลิกการเชื่อมไปแล้ว'
      mode.value = 'connect'
      return
    }
    const job = acc.job
    if (!job || mssgJobIsOpen(job)) return
    orderedJobId.value = null
    if (job.status === 'completed') {
      nick.nickname = acc.nickname ?? ''
      step.value = 3
      return
    }
    // failed / cancelled → back to step 1 with the Thai text; the account exists now → relogin of it (AC-11)
    mode.value = 'relogin'
    login.email = acc.email
    formError.value = job.status === 'cancelled' ? 'งานถูกยกเลิก ลองใหม่อีกครั้ง' : mssgErrorText(acc.lastError?.code)
    step.value = 1
  }
)

const job = computed(() => props.account?.job ?? null)
const progressText = computed(() => mssgJobProgressText(job.value))

// ── step 1 submit ────────────────────────────────────────────────────────────────────────────────────────────────────
const FIELD_NAMES = new Set(['email', 'password'])

function showRequestError(e: unknown) {
  const failure = mssgFailure(e, mode.value === 'relogin' ? 'เข้าสู่ระบบใหม่ไม่สำเร็จ' : 'เชื่อมบัญชีไม่สำเร็จ')
  const { status, body } = failure
  if (status === 409 && body?.reason === 'emailAlreadyLinked') {
    serverErrors.value = { email: MSSG_CONFLICT_TEXT.emailAlreadyLinked }
    return
  }
  if (status === 400 && body?.issues?.length) {
    const next: Record<string, string> = {}
    const unmatched: string[] = []
    for (const issue of body.issues) {
      if (FIELD_NAMES.has(issue.path) && !(issue.path === 'email' && mode.value === 'relogin')) next[issue.path] = issue.message
      else unmatched.push(issue.path ? `${issue.path}: ${issue.message}` : issue.message)
    }
    serverErrors.value = next
    if (unmatched.length) formError.value = unmatched.join(' · ')
    return
  }
  formError.value = failure.message
}

async function onLogin(event: FormSubmitEvent<LoginSchema>) {
  if (requesting.value) return
  const relogin = mode.value === 'relogin'
  const target = props.account
  if (relogin && !target) return
  // take the password out of the form before the request leaves: nothing keeps it after this line
  const password = event.data.password
  login.password = ''
  showPassword.value = false
  requesting.value = true
  formError.value = null
  serverErrors.value = {}
  try {
    let view: MssgAccountView
    if (relogin && target) {
      const body: MssgReloginBody = { password }
      view = await api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(target.id)}/relogin`, { method: 'POST', body, retry: 0 })
    } else {
      const body: MssgConnectBody = { email: event.data.email, password }
      if (props.workspaceId) body.workspaceId = props.workspaceId
      view = await api<MssgAccountView>('/mssg-accounts', { method: 'POST', body, retry: 0 })
    }
    mode.value = 'relogin'
    login.email = view.email
    emit('requested', view)
    const ordered = view.job
    if (ordered && mssgJobIsOpen(ordered)) {
      // the normal 202: `job.status: pending` — step 2 until the page's view of this job is terminal
      orderedJobId.value = ordered.id
      step.value = 2
    } else if (ordered?.status === 'completed') {
      nick.nickname = view.nickname ?? ''
      step.value = 3
    } else {
      formError.value = mssgErrorText(view.lastError?.code)
    }
  } catch (e) {
    showRequestError(e)
  } finally {
    requesting.value = false
  }
}

// ── step 3 finish ────────────────────────────────────────────────────────────────────────────────────────────────────
async function onFinish(event: FormSubmitEvent<NicknameSchema>) {
  const acc = props.account
  if (!acc || saving.value) return
  const next = event.data.nickname === '' ? null : event.data.nickname
  if (next === (acc.nickname ?? null)) {
    open.value = false
    return
  }
  saving.value = true
  try {
    const body: MssgRenameBody = { nickname: next }
    const view = await api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(acc.id)}`, { method: 'PATCH', body, retry: 0 })
    emit('renamed', view)
    toast.add({ title: 'บันทึกชื่อเรียกแล้ว', description: mssgAccountName(view), color: 'success' })
    open.value = false
  } catch (e) {
    const failure = mssgFailure(e, 'บันทึกชื่อเรียกไม่สำเร็จ')
    const issue = failure.body?.issues?.find(i => i.path === 'nickname')
    serverErrors.value = { ...serverErrors.value, nickname: issue?.message ?? failure.message }
  } finally {
    saving.value = false
  }
}

const summary = computed(() => props.account)
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :description="description"
    :dismissible="!requesting && !saving"
    :close="!requesting && !saving"
    :ui="{ content: 'max-w-md', header: 'min-w-0', wrapper: 'min-w-0', title: 'wrap-anywhere', description: 'wrap-anywhere' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-5">
        <ol class="grid grid-cols-3 gap-1.5" aria-label="ขั้นตอน" data-testid="mp-modal-steps">
          <li
            v-for="s in STEPS"
            :key="s.n"
            class="flex flex-col gap-1.5"
            :aria-current="s.n === step ? 'step' : undefined"
            :data-testid="`mp-modal-steps-${s.n}`"
            :data-active="s.n === step ? 'true' : 'false'"
          >
            <span class="h-1 rounded-full" :class="s.n <= step ? 'bg-primary' : 'bg-accented'" />
            <span class="text-xs" :class="s.n === step ? 'text-highlighted' : 'text-muted'">{{ s.n }}. {{ s.label }}</span>
          </li>
        </ol>

        <!-- step 1 -->
        <UForm
          v-if="step === 1"
          ref="loginForm"
          :schema="loginSchema"
          :state="login"
          :validate-on="['input']"
          class="flex flex-col gap-4"
          data-testid="mp-modal-step-1"
          @submit="onLogin"
        >
          <p class="text-sm text-toned">
            กรอกอีเมลและรหัสผ่านเดียวกับที่ใช้ล็อกอิน next.mssg.me
          </p>
          <UFormField
            label="อีเมล"
            name="email"
            :required="mode === 'connect'"
            :error="serverErrors['email']"
            data-testid="mp-modal-email-field"
          >
            <UInput
              v-if="mode === 'connect'"
              v-model="login.email"
              type="email"
              autocomplete="username"
              placeholder="name@example.com"
              class="w-full"
              size="lg"
              :disabled="requesting"
              data-testid="mp-modal-email"
            />
            <p
              v-else
              class="rounded-md border border-default bg-elevated/50 px-3 py-2 text-sm break-all text-highlighted"
              data-testid="mp-modal-email-readonly"
            >
              {{ login.email }}
            </p>
          </UFormField>
          <UFormField
            label="รหัสผ่าน"
            name="password"
            required
            :error="serverErrors['password']"
            data-testid="mp-modal-password-field"
          >
            <UInput
              v-model="login.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              class="w-full"
              size="lg"
              :ui="{ trailing: 'pe-1' }"
              :disabled="requesting"
              data-testid="mp-modal-password"
            >
              <template #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  :label="showPassword ? 'ซ่อน' : 'แสดง'"
                  :aria-label="showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'"
                  :aria-pressed="showPassword"
                  data-testid="mp-modal-password-toggle"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>

          <UAlert
            v-if="formError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="formError"
            role="alert"
            data-testid="mp-modal-error"
            :data-code="account?.lastError?.code ?? ''"
          />

          <p class="flex items-center gap-1.5 text-xs text-muted" data-testid="mp-modal-secure-note">
            <UIcon name="i-lucide-lock" class="size-3.5 shrink-0" />
            รหัสผ่านถูกเข้ารหัสระหว่างส่งให้ระบบ ใช้ครั้งเดียวตอนเข้าสู่ระบบ และไม่ถูกเก็บหรือแสดงซ้ำ
          </p>

          <div class="flex flex-col gap-2">
            <UButton
              type="submit"
              label="ถัดไป: ตรวจสอบบัญชี"
              size="lg"
              block
              :loading="requesting"
              data-testid="mp-modal-submit"
            />
            <UButton
              label="ยกเลิก"
              color="neutral"
              variant="ghost"
              block
              :disabled="requesting"
              data-testid="mp-modal-cancel"
              @click="open = false"
            />
          </div>
        </UForm>

        <!-- step 2 -->
        <div
          v-else-if="step === 2"
          class="flex flex-col items-center gap-3 py-6 text-center"
          role="status"
          data-testid="mp-modal-step-2"
          :data-job-status="job?.status ?? ''"
          :data-job-step="job?.step ?? ''"
        >
          <UIcon name="i-lucide-loader-circle" class="size-10 animate-spin text-primary" />
          <p class="font-semibold text-highlighted">
            กำลังเข้าสู่ระบบ mssg
          </p>
          <p class="text-sm text-muted" data-testid="mp-modal-progress">
            {{ progressText }}
          </p>
          <p class="text-xs text-dimmed">
            ตรวจสอบบัญชี แพ็กเกจ และเว็บทั้งหมดในบัญชีนี้ · ปิดหน้าต่างนี้ได้ งานจะทำต่อ
          </p>
          <UAlert
            v-if="pollTimedOut"
            color="warning"
            variant="subtle"
            icon="i-lucide-clock-alert"
            :title="MSSG_POLL_TIMEOUT_TEXT"
            data-testid="mp-modal-poll-timeout"
          />
          <UButton
            label="ปิด"
            color="neutral"
            variant="subtle"
            data-testid="mp-modal-close"
            @click="open = false"
          />
        </div>

        <!-- step 3 -->
        <UForm
          v-else-if="summary"
          ref="nickForm"
          :schema="nicknameSchema"
          :state="nick"
          :validate-on="['input']"
          class="flex flex-col gap-4"
          data-testid="mp-modal-step-3"
          @submit="onFinish"
        >
          <div class="flex items-center gap-3">
            <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <UIcon name="i-lucide-check" class="size-5" />
            </span>
            <span class="flex min-w-0 flex-col">
              <span class="font-semibold text-highlighted">เข้าสู่ระบบสำเร็จ</span>
              <span class="text-sm break-all text-muted" data-testid="mp-modal-summary-email">{{ summary.email }}</span>
            </span>
          </div>
          <div class="flex flex-col gap-2.5 rounded-lg border border-default bg-elevated/40 p-3">
            <div class="flex items-center gap-2">
              <span class="flex-1 text-sm text-toned">แพ็กเกจ</span>
              <UBadge
                :label="summary.plan?.name ?? 'ไม่ทราบแพ็กเกจ'"
                :color="mssgIsPro(summary.plan) ? 'primary' : 'neutral'"
                variant="subtle"
                data-testid="mp-modal-summary-plan"
              />
            </div>
            <div class="flex flex-col gap-1.5">
              <span class="flex justify-between gap-2 text-sm text-toned">
                เว็บในบัญชีนี้
                <span class="text-highlighted" data-testid="mp-modal-summary-quota">{{ mssgQuotaText(summary.quota) }} เว็บ</span>
              </span>
              <UProgress
                v-if="summary.quota && summary.quota.limit"
                :model-value="mssgQuotaPct(summary.quota)"
                size="xs"
                aria-hidden="true"
              />
            </div>
            <ul v-if="summary.sites.length" class="flex flex-col">
              <li
                v-for="(site, i) in summary.sites"
                :key="`${i}-${site.url}`"
                class="flex items-center gap-2 border-t border-default py-1.5"
                data-testid="mp-modal-summary-site"
                :data-url="site.url"
              >
                <span class="flex min-w-0 flex-1 flex-col">
                  <span class="text-sm break-words">{{ site.name }}</span>
                  <span class="truncate text-xs text-muted">{{ site.url }}</span>
                </span>
                <span class="text-xs text-muted">{{ mssgSiteStatusText(site.status) }}</span>
              </li>
            </ul>
            <p v-else class="border-t border-default pt-2 text-xs text-muted" data-testid="mp-modal-summary-no-sites">
              ยังไม่มีเว็บในบัญชีนี้
            </p>
          </div>
          <UFormField
            label="ตั้งชื่อเรียกบัญชี (ไม่บังคับ)"
            name="nickname"
            :error="serverErrors['nickname']"
            data-testid="mp-modal-nickname-field"
          >
            <UInput
              v-model="nick.nickname"
              placeholder="เช่น ร้านหลัก, แบรนด์ที่ 2"
              class="w-full"
              :disabled="saving"
              data-testid="mp-modal-nickname"
            />
          </UFormField>
          <UButton
            type="submit"
            label="เสร็จสิ้น"
            size="lg"
            block
            :loading="saving"
            data-testid="mp-modal-finish"
          />
        </UForm>
      </div>
    </template>
  </UModal>
</template>
