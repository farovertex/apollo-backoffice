<script setup lang="ts">
/**
 * FEAT-003 — Delete confirmation (delete part of function 3.2). Confirm → `DELETE /backend/tiktok-accounts/:id`
 * (204) → toast "Account deleted" + `deleted` (the page refreshes the list). API error → toast, modal stays open.
 * BUG-029: checkbox "Also delete the browser profile" (`ta-delete-profile`, on by default) adds `?deleteProfile=1`:
 * the API queues a `provider/delete` job that removes the profile from AdsPower and from the list (the modal does not
 * wait for it; a failed job leaves the profile on /browser-profiles with an error). Unchecked = the profile is only freed.
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
// BUG-029: default on — reset on every open so one unchecked delete does not change the next one
const deleteProfile = ref(true)
watch(open, (isOpen) => {
  if (isOpen) deleteProfile.value = true
})
const description = computed(() =>
  deleteProfile.value
    ? 'The browser profile will be deleted from AdsPower as well.'
    : 'The browser profile will become free again.'
)

async function confirm() {
  const account = props.account
  if (!account || deleting.value) return
  deleting.value = true
  try {
    const withProfile = deleteProfile.value
    await api(`/tiktok-accounts/${encodeURIComponent(account.id)}`, {
      method: 'DELETE',
      retry: 0,
      ...(withProfile ? { query: { deleteProfile: '1' } } : {})
    })
    open.value = false
    toast.add({
      title: withProfile ? 'Account deleted, profile deletion queued' : 'Account deleted',
      description: account.loginEmail,
      color: 'success'
    })
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
    :description="description"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <UCheckbox
        v-model="deleteProfile"
        label="Also delete the browser profile"
        :disabled="deleting"
        class="mb-4"
        data-testid="ta-delete-profile"
      >
        <template #description>
          <span data-testid="ta-delete-profile-helper">{{ account?.browserProfile?.name ?? 'The profile' }} is removed from AdsPower by a background job. Uncheck to keep it.</span>
        </template>
      </UCheckbox>
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
