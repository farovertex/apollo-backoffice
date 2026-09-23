<script setup lang="ts">
/**
 * FEAT-008 — Delete ad group template (function 6.8; api-contract.md v1 `DELETE /ad-group-templates/:id`).
 * Confirm → `DELETE /backend/ad-group-templates/:id` → 200 `{ ok: true }` → close, toast, `deleted` (the page
 * re-requests the list). An API error (404 = already gone) shows a toast and still emits `deleted` so the page
 * refreshes either way.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdGroupTemplate, DeleteAdGroupTemplateResponse } from '#shared/types/ad-group-templates'

const props = defineProps<{
  template: AdGroupTemplate | null
}>()

const emit = defineEmits<{
  deleted: [result: DeleteAdGroupTemplateResponse | null]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `agt-delete-modal`).
const modalContent = { 'data-testid': 'agt-delete-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()
const deleting = ref(false)

async function confirm() {
  const template = props.template
  if (!template || deleting.value) return
  deleting.value = true
  try {
    // retry: 0 — exactly one DELETE per click
    const res = await api<DeleteAdGroupTemplateResponse>(
      `/ad-group-templates/${encodeURIComponent(template.id)}`,
      { method: 'DELETE', retry: 0 }
    )
    open.value = false
    toast.add({ title: 'Template deleted', description: template.name, color: 'success' })
    emit('deleted', res)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    open.value = false
    toast.add({
      title: 'Could not delete the template',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
    // the row may already be gone — refresh the list anyway
    emit('deleted', null)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Delete template ${template?.name ?? ''}?`"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #description>
      <span data-testid="agt-delete-note">The template is not used by any order yet; this cannot be undone.</span>
    </template>

    <template #body>
      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="deleting"
          data-testid="agt-delete-cancel"
          @click="open = false"
        />
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="solid"
          :loading="deleting"
          data-testid="agt-delete-confirm"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
