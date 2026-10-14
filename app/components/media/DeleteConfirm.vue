<script setup lang="ts">
/**
 * FEAT-049 — delete one image (api-contract §5.7). The modal owns its request, like every other delete modal
 * of the BO: confirm → `DELETE /backend/media/:id` → 204 (empty body) → close, toast, `deleted` (the page drops
 * the card and re-reads the list once).
 *
 * The in-use guard is enforced twice: the grid disables the button while `usedBy.count > 0` (no request at all),
 * and a 409 that still arrives — somebody bound the image to a template in another tab — is shown with the
 * template names the API returned (`{ error: 'inUse', templates: [...] }`, brief decision 2). A 502 means the
 * object storage did not answer; the row is kept and a retry can succeed, so the modal just reports it.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { MediaAssetView, MediaInUseError } from '#shared/types/media'
import { mediaUsedByTooltip } from '~/utils/media'

const props = defineProps<{
  asset: MediaAssetView | null
}>()

const emit = defineEmits<{
  deleted: [id: string]
  /** a 409 arrived although the grid thought the image was unused → the page re-reads the list */
  stale: []
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless: the testid has to go on the rendered dialog content
const modalContent = { 'data-testid': 'ml-delete-confirm' } as ModalProps['content']

const api = useApi()
const toast = useToast()
const deleting = ref(false)

async function confirm() {
  const asset = props.asset
  if (!asset || deleting.value) return
  deleting.value = true
  try {
    // retry: 0 — exactly one DELETE per click
    await api(`/media/${encodeURIComponent(asset.id)}`, { method: 'DELETE', retry: 0 })
    open.value = false
    toast.add({ title: 'ลบรูปแล้ว', description: asset.name, icon: 'i-lucide-trash-2', color: 'success' })
    emit('deleted', asset.id)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody & MediaInUseError>>
    const status = err.response?.status ?? err.statusCode
    open.value = false
    if (status === 409) {
      const names = (err.data?.templates ?? []).map(template => template.name)
      toast.add({
        title: 'ลบไม่ได้ เพราะมีเทมเพลตใช้รูปนี้อยู่',
        description: names.length > 0 ? mediaUsedByTooltip(names) : undefined,
        icon: 'i-lucide-shield-alert',
        color: 'warning'
      })
      emit('stale')
      return
    }
    toast.add({
      title: 'ลบรูปไม่ได้',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      icon: 'i-lucide-triangle-alert',
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
    :title="`ลบรูป ${asset?.name ?? ''}?`"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #description>
      <span data-testid="ml-delete-note">รูปจะถูกลบออกจากคลังและจากที่เก็บไฟล์ ย้อนกลับไม่ได้</span>
    </template>

    <template #body>
      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          label="ยกเลิก"
          color="neutral"
          variant="subtle"
          :disabled="deleting"
          data-testid="ml-delete-cancel"
          @click="open = false"
        />
        <UButton
          label="ลบ"
          icon="i-lucide-trash-2"
          color="error"
          variant="solid"
          :loading="deleting"
          data-testid="ml-delete-ok"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
