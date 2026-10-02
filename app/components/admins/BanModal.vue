<script setup lang="ts">
/**
 * FEAT-009 — Ban / Unban an admin (api-contract.md v1 `PATCH /admins/:id`).
 * Ban sends `{ isActive: false }` plus `reason` only when the (optional, ≤ 200 chars) textarea is not empty —
 * the reason is written to the audit detail, never stored on the admin. Unban sends exactly `{ isActive: true }`.
 * A 409 (last active GOD / self) keeps the modal open and shows the API text in `adm-ban-error`.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdminListItem, AdminView, UpdateAdminBody } from '#shared/types/admins'

const REASON_MAX = 200

const props = defineProps<{
  admin: AdminListItem | null
}>()

const emit = defineEmits<{
  done: []
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'adm-ban-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

/** ban when the target is currently active, unban when it is banned */
const isBan = computed(() => props.admin?.status !== 'banned')
const reason = ref('')
const submitting = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  reason.value = ''
  submitting.value = false
  error.value = null
})

async function confirm() {
  const admin = props.admin
  if (!admin || submitting.value) return

  submitting.value = true
  error.value = null

  const trimmed = reason.value.trim()
  const body: UpdateAdminBody = isBan.value ? { isActive: false } : { isActive: true }
  // `reason` is omitted entirely when empty (the API refuses `{ reason }` alone and audits it when present)
  if (isBan.value && trimmed !== '') body.reason = trimmed

  try {
    // retry: 0 — exactly one PATCH per confirm
    await api<AdminView>(`/admins/${encodeURIComponent(admin.id)}`, { method: 'PATCH', body, retry: 0 })
    open.value = false
    toast.add({
      title: isBan.value ? 'Admin banned' : 'Admin unbanned',
      description: admin.username,
      color: 'success'
    })
    emit('done')
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    error.value = err.data?.error ?? err.message ?? 'Unexpected error'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isBan ? 'Ban admin' : 'Unban admin'"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-default" data-testid="adm-ban-text">
          <template v-if="isBan">
            Ban {{ admin?.username }}? They are logged out immediately and cannot log in until unbanned.
          </template>
          <template v-else>
            Unban {{ admin?.username }}? They can log in again.
          </template>
        </p>

        <UFormField
          v-if="isBan"
          label="Reason"
          name="reason"
          help="Optional — recorded in the audit log only, never stored on the admin."
        >
          <template #hint>
            <span data-testid="adm-ban-reason-count">{{ reason.length }}/{{ REASON_MAX }}</span>
          </template>

          <UTextarea
            v-model="reason"
            :rows="2"
            :maxlength="REASON_MAX"
            placeholder="left the company"
            class="w-full"
            :disabled="submitting"
            data-testid="adm-ban-reason"
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
          role="alert"
          data-testid="adm-ban-error"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="adm-ban-cancel"
          @click="open = false"
        />
        <UButton
          :label="isBan ? 'Ban' : 'Unban'"
          :icon="isBan ? 'i-lucide-ban' : 'i-lucide-circle-check'"
          :color="isBan ? 'error' : 'primary'"
          :loading="submitting"
          data-testid="adm-ban-confirm"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
