<script setup lang="ts">
/**
 * Edit account modal (2026-10-12, human request — functions 3.2 "edit credential"; 2026-10-14 TASK-account-label
 * added the Label field). Opened by the row action **Edit** (`ta-edit`) on /tiktok-accounts. Six fields are
 * editable — **Label**, **Login email**, **Email password**, **Recovery email**, **TikTok password** and
 * (2026-10-16, GOD/Payment only) **ช่องทางเติมอัตโนมัติ**; the browser profile and every flag stay read-only
 * (the API's `PATCH /tiktok-accounts/:id` body is `.strict()` on those six keys).
 * 2026-10-16 (human request) — the auto top-up channel (FEAT-053 AC-19) moved here from the table's
 * **ช่องทาง auto** column: two buttons in a `role="radiogroup"` (`ta-edit-auto-channel` + `-qr` / `-card`),
 * rendered only when the `canPay` prop is true (the page passes `canPayTopups(viewer)`; the key is 403 for an
 * Admin, AC-20, and an Admin's modal must not even show it). It is an ordinary field of the diff: the change
 * travels in the **one** PATCH behind Save, together with whatever else was edited, so the whole edit is atomic.
 * A 400 (no usable card) / 503 (no card key) therefore fails the whole save — nothing is written, the modal
 * stays open and the API's own text is shown in `ta-edit-error`. That is deliberate: no fallback, no second
 * request.
 * On every open the form is prefilled from the row; both passwords start masked (eye toggles, same as the Add
 * modal) and the modal never puts a secret anywhere but the inputs. Submit sends **only the keys that differ** from
 * the row (`PatchAccountBody`) — nothing changed → the Save button is disabled, no request. `recoveryEmail` is
 * sent as `null` when the user cleared it, and so is `label` (an empty label clears it, matching the Add modal's
 * "omitted/empty → null" rule). 200 → close + toast + `updated` (the page refreshes the list);
 * 409 (login email already in the workspace) / 400 → `UAlert` under the form (`ta-edit-error`), modal stays open.
 * zod mirrors the API: label trimmed ≤ 100, optional; email trim → lowercase → valid ≤ 254; passwords 1..128
 * verbatim (no trim); recovery email optional, non-empty must be a valid email. An old row whose `emailPassword`
 * is null may leave that field empty (the key is simply not sent); a row that has one cannot clear it (the API
 * refuses `''`).
 * BUG-045: `validate-on` is `['input']` only — see AddModal.vue for why `blur`/`change` must not come back.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PatchAccountBody, TikTokAccount } from '#shared/types/tiktok-accounts'
import type { TopupChannel } from '#shared/types/topups'

const props = defineProps<{
  account: TikTokAccount | null
  /** GOD/Payment (`canPayTopups`) — only they may send `autoTopupChannel`, so only they see the field */
  canPay?: boolean
}>()

const emit = defineEmits<{
  updated: [account: TikTokAccount]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-edit-modal`).
const modalContent = { 'data-testid': 'ta-edit-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

// ── form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface FormState {
  label: string
  loginEmail: string
  emailPassword: string
  recoveryEmail: string
  password: string
  /** FEAT-053 — read through `accountAutoTopupChannel()`, never from the raw key (an old row has none) */
  autoTopupChannel: TopupChannel
}

/** what the row holds, normalised the way the API stores it — the submit diffs the form against this */
function stateOf(account: TikTokAccount | null): FormState {
  return {
    label: account?.label ?? '',
    loginEmail: account?.loginEmail ?? '',
    emailPassword: account?.emailPassword ?? '',
    recoveryEmail: account?.recoveryEmail ?? '',
    password: account?.password ?? '',
    autoTopupChannel: accountAutoTopupChannel(account)
  }
}

const original = ref<FormState>(stateOf(null))
const state = reactive<FormState>(stateOf(null))

/**
 * TASK-topup-qr-usd (2026-10-26) — the QR option is closed for a USD account (the auto round would only be skipped
 * by the API with this same reason). The API does not refuse the PATCH itself, so this is a hint, not a gate: an
 * old row that already sits on `qr` keeps showing it selected until the admin moves it to card.
 */
const qrBlocked = computed(() => qrChannelBlockedReason(props.account?.balanceCurrency))

const schema = z.object({
  label: z.string()
    .trim()
    .max(100, 'Label must be at most 100 characters')
    .optional(),
  loginEmail: z.string({ error: 'Login email is required' })
    .trim()
    .toLowerCase()
    .min(1, 'Login email is required')
    .max(254, 'Login email must be at most 254 characters')
    .pipe(z.email('Enter a valid email address')),
  // may stay empty only while the row has no mailbox password yet (old rows) — checked in superRefine
  emailPassword: z.string()
    .max(128, 'Email password must be at most 128 characters'),
  recoveryEmail: z.string()
    .trim()
    .toLowerCase()
    .optional(),
  password: z.string({ error: 'TikTok password is required' })
    .min(1, 'TikTok password is required')
    .max(128, 'TikTok password must be at most 128 characters'),
  autoTopupChannel: z.enum(['qr', 'card'])
}).superRefine((data, ctx) => {
  if (!data.emailPassword && original.value.emailPassword) {
    ctx.addIssue({ code: 'custom', path: ['emailPassword'], message: 'Email password is required' })
  }
  if (data.recoveryEmail && (data.recoveryEmail.length > 254 || !z.email().safeParse(data.recoveryEmail).success)) {
    ctx.addIssue({ code: 'custom', path: ['recoveryEmail'], message: 'Enter a valid recovery email address' })
  }
})

type Schema = z.output<typeof schema>

// one toggle per password field; both start masked on every open
const showEmailPassword = ref(false)
const showPassword = ref(false)
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

/** true while at least one of the six fields differs from the row (the raw input, before zod normalises it) */
const dirty = computed(() =>
  state.label !== original.value.label
  || state.loginEmail !== original.value.loginEmail
  || state.emailPassword !== original.value.emailPassword
  || state.recoveryEmail !== original.value.recoveryEmail
  || state.password !== original.value.password
  || state.autoTopupChannel !== original.value.autoTopupChannel
)

function resetForm() {
  original.value = stateOf(props.account)
  Object.assign(state, stateOf(props.account))
  showEmailPassword.value = false
  showPassword.value = false
  submitting.value = false
  submitError.value = null
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function errorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  return {
    title: err.data?.error ?? err.message ?? 'Could not save the account',
    description: issues && issues.length ? issues.join(' · ') : undefined
  }
}

/** only the keys whose normalised value differs from the row; `recoveryEmail`/`label` are `null` when cleared */
function changedBody(data: Schema): PatchAccountBody {
  const body: PatchAccountBody = {}
  const label = data.label ?? ''
  if (label !== original.value.label) body.label = label || null
  if (data.loginEmail !== original.value.loginEmail) body.loginEmail = data.loginEmail
  if (data.emailPassword && data.emailPassword !== original.value.emailPassword) body.emailPassword = data.emailPassword
  const recovery = data.recoveryEmail ?? ''
  if (recovery !== original.value.recoveryEmail) body.recoveryEmail = recovery || null
  if (data.password !== original.value.password) body.password = data.password
  // GOD/Payment only, and only when it really changed — an Admin never has the field and never sends the key
  if (props.canPay && data.autoTopupChannel !== original.value.autoTopupChannel) body.autoTopupChannel = data.autoTopupChannel
  return body
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const account = props.account
  if (!account || submitting.value) return
  const body = changedBody(event.data)
  if (Object.keys(body).length === 0) {
    open.value = false
    return
  }
  submitting.value = true
  submitError.value = null
  try {
    // retry: 0 — exactly one PATCH per click (ofetch would otherwise re-issue it on 5xx)
    const updated = await api<TikTokAccount>(`/tiktok-accounts/${encodeURIComponent(account.id)}`, { method: 'PATCH', body, retry: 0 })
    open.value = false
    toast.add({ title: 'Account updated', description: updated.label ?? updated.loginEmail, color: 'success' })
    emit('updated', updated)
  } catch (e) {
    submitError.value = errorState(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Edit account ${account?.label ?? account?.loginEmail ?? ''}`"
    :description="canPay
      ? 'The label, login email, both passwords, the recovery email and the auto top-up channel can be changed here.'
      : 'The label, login email, both passwords and the recovery email can be changed here.'"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        :validate-on="['input']"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Label" name="label" hint="Shown everywhere instead of the login email">
          <UInput
            v-model="state.label"
            autocomplete="off"
            placeholder="Optional"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-edit-label"
          />
        </UFormField>

        <UFormField label="Login email" name="loginEmail" required>
          <UInput
            v-model="state.loginEmail"
            type="email"
            autocomplete="off"
            placeholder="ads@example.com"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-edit-email"
          />
        </UFormField>

        <UFormField
          label="Email password"
          name="emailPassword"
          :required="!!original.emailPassword"
          :hint="original.emailPassword ? undefined : 'Not set'"
        >
          <UInput
            v-model="state.emailPassword"
            :type="showEmailPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Mailbox password of the login email"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
            :disabled="submitting"
            data-testid="ta-edit-email-password"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showEmailPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showEmailPassword ? 'Hide email password' : 'Show email password'"
                :aria-pressed="showEmailPassword"
                data-testid="ta-edit-email-password-toggle"
                @click="showEmailPassword = !showEmailPassword"
              />
            </template>
          </UInput>
        </UFormField>

        <UFormField label="Recovery email" name="recoveryEmail" hint="Optional">
          <UInput
            v-model="state.recoveryEmail"
            type="email"
            autocomplete="off"
            placeholder="recovery@example.com"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-edit-recovery-email"
          />
          <template #help>
            <span data-testid="ta-edit-recovery-email-helper">{{ RECOVERY_EMAIL_HELP }} Leave empty to clear it.</span>
          </template>
        </UFormField>

        <UFormField label="TikTok password" name="password" required>
          <UInput
            v-model="state.password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="TikTok Ads password"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
            :disabled="submitting"
            data-testid="ta-edit-password"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? 'Hide TikTok password' : 'Show TikTok password'"
                :aria-pressed="showPassword"
                data-testid="ta-edit-password-toggle"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </UFormField>

        <!-- 2026-10-16 — FEAT-053's auto channel; GOD/Payment only, saved by the same diff PATCH as the rest -->
        <UFormField
          v-if="canPay"
          label="ช่องทางเติมอัตโนมัติ"
          name="autoTopupChannel"
        >
          <div
            class="flex items-center gap-1"
            role="radiogroup"
            aria-label="ช่องทางเติมเงินอัตโนมัติ"
            data-testid="ta-edit-auto-channel"
            :data-channel="state.autoTopupChannel"
          >
            <UButton
              :label="TOPUP_CHANNEL_LABEL.qr"
              icon="i-lucide-qr-code"
              :color="state.autoTopupChannel === 'qr' ? 'primary' : 'neutral'"
              :variant="state.autoTopupChannel === 'qr' ? 'solid' : 'outline'"
              size="xs"
              role="radio"
              :aria-checked="state.autoTopupChannel === 'qr'"
              :disabled="submitting || !!qrBlocked"
              data-testid="ta-edit-auto-channel-qr"
              @click="state.autoTopupChannel = 'qr'"
            />
            <UButton
              :label="TOPUP_CHANNEL_LABEL.card"
              icon="i-lucide-credit-card"
              :color="state.autoTopupChannel === 'card' ? 'primary' : 'neutral'"
              :variant="state.autoTopupChannel === 'card' ? 'solid' : 'outline'"
              size="xs"
              role="radio"
              :aria-checked="state.autoTopupChannel === 'card'"
              :disabled="submitting"
              data-testid="ta-edit-auto-channel-card"
              @click="state.autoTopupChannel = 'card'"
            />
          </div>
          <template #help>
            <span data-testid="ta-edit-auto-channel-helper">ช่องทางที่ระบบใช้เมื่อเปิดรอบเติมเงินอัตโนมัติให้บัญชีนี้</span>
            <span v-if="qrBlocked" class="block text-warning" data-testid="ta-edit-auto-channel-qr-reason">{{ qrBlocked }}</span>
          </template>
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="ta-edit-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-edit-cancel"
            @click="open = false"
          />
          <UButton
            label="Save"
            icon="i-lucide-save"
            color="primary"
            variant="solid"
            type="submit"
            :disabled="!dirty"
            :loading="submitting"
            data-testid="ta-edit-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
