<script setup lang="ts">
/**
 * FEAT-003 — Delete confirmation (delete part of function 3.2). Confirm → `DELETE /backend/tiktok-accounts/:id`
 * (204) → toast "Account deleted" + `deleted` (the page refreshes the list). API error → toast, modal stays open.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  account: TikTokAccount | null
}>()

const emit = defineEmits<{
  deleted: [account: TikTokAccount]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-delete-modal`).
const modalContent = { 'data-testid': 'ta-delete-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()
const deleting = ref(false)

async function confirm() {
  const account = props.account
  if (!account || deleting.value) return
  deleting.value = true
  try {
    await api(`/tiktok-accounts/${encodeURIComponent(account.id)}`, { method: 'DELETE', retry: 0 })
    open.value = false
    toast.add({ title: 'Account deleted', description: account.loginEmail, color: 'success' })
    emit('deleted', account)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: 'Could not delete the account',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Delete account ${account?.loginEmail ?? ''}?`"
    description="The browser profile will become free again."
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="deleting"
          data-testid="ta-delete-cancel"
          @click="open = false"
        />
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="solid"
          :loading="deleting"
          data-testid="ta-delete-confirm"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
