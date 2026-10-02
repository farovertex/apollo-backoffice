<script setup lang="ts">
/**
 * FEAT-009 — Reset an admin's password (api-contract.md v1 `POST /admins/:id/reset-password` → 204).
 * Same password block as the Create modal (`prefix="adm-reset"`), a persistent warning that every session of the
 * target ends, and `{ newPassword }` as the only place the plaintext ever appears — never in a toast or a log.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdminListItem, ResetPasswordBody } from '#shared/types/admins'

const props = defineProps<{
  admin: AdminListItem | null
}>()

const emit = defineEmits<{
  reset: []
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'adm-reset-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const state = reactive({ password: '', passwordConfirm: '' })
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)
// BUG-007 lesson: server messages are owned here, not pushed through UForm.setErrors()
const serverErrors = ref<Record<string, string>>({})
const passwordFields = useTemplateRef('passwordFields')

watch(state, () => {
  serverErrors.value = {}
}, { deep: true })

const schema = z.object({
  password: z.string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  passwordConfirm: z.string()
}).superRefine((data, ctx) => {
  if (data.passwordConfirm === '') {
    ctx.addIssue({ code: 'custom', path: ['passwordConfirm'], message: 'Confirm the password' })
  } else if (data.passwordConfirm !== data.password) {
    ctx.addIssue({ code: 'custom', path: ['passwordConfirm'], message: 'Passwords do not match' })
  }
})

type Schema = z.output<typeof schema>

const formRef = useTemplateRef<Form<Schema>>('formRef')

watch(open, (isOpen) => {
  if (!isOpen) return
  state.password = ''
  state.passwordConfirm = ''
  submitting.value = false
  submitError.value = null
  serverErrors.value = {}
  formRef.value?.clear()
  passwordFields.value?.reset()
})

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const admin = props.admin
  if (!admin || submitting.value) return

  submitError.value = null
  serverErrors.value = {}
  submitting.value = true

  const body: ResetPasswordBody = { newPassword: event.data.password }

  try {
    // retry: 0 — exactly one POST per submit; 204 has no body
    await api(`/admins/${encodeURIComponent(admin.id)}/reset-password`, { method: 'POST', body, retry: 0 })
    open.value = false
    // the new password is never echoed — only the username
    toast.add({ title: 'Password reset', description: admin.username, color: 'success' })
    emit('reset')
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues ?? []
    const passwordIssue = issues.find(issue => issue.path === 'newPassword' || issue.path === 'password')
    if (passwordIssue) serverErrors.value.password = passwordIssue.message
    submitError.value = {
      title: err.data?.error ?? err.message ?? 'Could not reset the password',
      description: issues.length && !passwordIssue
        ? issues.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ')
        : undefined
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Reset password"
    :description="admin ? `New password for ${admin.username}` : undefined"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        ref="formRef"
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="`All sessions of ${admin?.username ?? ''} will be logged out.`"
          data-testid="adm-reset-warning"
        />

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="adm-reset-error"
        />

        <AdminsPasswordFields
          ref="passwordFields"
          v-model:password="state.password"
          v-model:confirm="state.passwordConfirm"
          prefix="adm-reset"
          label="New password"
          confirm-label="Confirm new password"
          :disabled="submitting"
          :password-error="serverErrors['password']"
        />
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="adm-reset-cancel"
          @click="open = false"
        />
        <UButton
          label="Reset password"
          color="primary"
          :loading="submitting"
          data-testid="adm-reset-submit"
          @click="formRef?.submit()"
        />
      </div>
    </template>
  </UModal>
</template>
