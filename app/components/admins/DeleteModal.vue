<script setup lang="ts">
/**
 * FEAT-009 — Soft-delete an admin (api-contract.md v1 `DELETE /admins/:id` → 200
 * `{ ok, deletedAt, revokedWorkspaceIds, revokedSessions }`).
 * Terminal action: the confirm button stays disabled until the typed text equals the username exactly
 * (case-sensitive — usernames are lowercase already). A 409 (self / last active GOD) keeps the modal open.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdminListItem, DeleteAdminResponse } from '#shared/types/admins'

const props = defineProps<{
  admin: AdminListItem | null
}>()

const emit = defineEmits<{
  deleted: [result: DeleteAdminResponse]
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'adm-delete-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const confirmText = ref('')
const deleting = ref(false)
const error = ref<string | null>(null)

const canDelete = computed(() => props.admin !== null && confirmText.value === props.admin.username)

watch(open, (isOpen) => {
  if (!isOpen) return
  confirmText.value = ''
  deleting.value = false
  error.value = null
})

async function confirm() {
  const admin = props.admin
  if (!admin || !canDelete.value || deleting.value) return

  deleting.value = true
  error.value = null

  try {
    // retry: 0 — exactly one DELETE per confirm
    const res = await api<DeleteAdminResponse>(`/admins/${encodeURIComponent(admin.id)}`, {
      method: 'DELETE',
      retry: 0
    })
    open.value = false
    toast.add({ title: 'Admin deleted', description: admin.username, color: 'success' })
    emit('deleted', res)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    error.value = err.data?.error ?? err.message ?? 'Unexpected error'
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Delete admin"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-default" data-testid="adm-delete-text">
          Delete {{ admin?.username }}? This cannot be undone. Their sessions end now, every shared-workspace
          access is revoked, their own workspace is kept. Type the username to confirm.
        </p>

        <UFormField :label="`Type ${admin?.username ?? ''}`" name="confirm">
          <UInput
            v-model="confirmText"
            class="w-full font-mono"
            autocomplete="off"
            :placeholder="admin?.username"
            :disabled="deleting"
            data-testid="adm-delete-confirm-input"
          />
        </UFormField>

        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
          role="alert"
          data-testid="adm-delete-error"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="deleting"
          data-testid="adm-delete-cancel"
          @click="open = false"
        />
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          :disabled="!canDelete"
          :loading="deleting"
          data-testid="adm-delete-confirm"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
