<script setup lang="ts">
/**
 * FEAT-099 (spec "UI behaviour → Account card", AC-25, AC-30) — the confirm step of "ยกเลิกการเชื่อม".
 * One `DELETE /mssg-accounts/:id` per click (`retry: 0`). The account document goes, the browser profile stays
 * (the user removes it on Browser profiles if wanted). 409 `jobInProgress` (a job is `active`) and every other
 * failure stay in here as `mp-unlink-error`.
 */
import type { ModalProps } from '@nuxt/ui'
import type { MssgAccountView } from '#shared/types/mssg-accounts'

const props = defineProps<{
  account: MssgAccountView | null
}>()

const emit = defineEmits<{
  unlinked: [id: string]
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'mp-unlink-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const deleting = ref(false)
const error = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  deleting.value = false
  error.value = null
})

async function onConfirm() {
  const acc = props.account
  if (!acc || deleting.value) return
  deleting.value = true
  error.value = null
  try {
    await api(`/mssg-accounts/${encodeURIComponent(acc.id)}`, { method: 'DELETE', retry: 0 })
    emit('unlinked', acc.id)
    toast.add({ title: 'ยกเลิกการเชื่อมแล้ว', description: mssgAccountName(acc), color: 'success' })
    open.value = false
  } catch (e) {
    const failure = mssgFailure(e, 'ยกเลิกการเชื่อมไม่สำเร็จ')
    // 404: already gone — the list should drop it as well
    if (failure.status === 404) {
      emit('unlinked', acc.id)
      open.value = false
      toast.add({ title: 'บัญชีนี้ถูกยกเลิกการเชื่อมไปแล้ว', description: mssgAccountName(acc), color: 'info' })
      return
    }
    error.value = failure.message
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="ยกเลิกการเชื่อมบัญชี mssg"
    :description="account ? mssgAccountName(account) : ''"
    :dismissible="!deleting"
    :close="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3 text-sm">
        <p class="break-words text-toned">
          ยกเลิกการเชื่อม <span class="font-medium break-all text-highlighted">{{ account?.email }}</span> ออกจากพื้นที่นี้?
        </p>
        <p class="text-muted">
          โปรไฟล์เบราว์เซอร์
          <span v-if="account?.browserProfile" class="font-medium text-toned">{{ account.browserProfile.name }}</span>
          จะไม่ถูกลบหรือแก้ไข ยังอยู่ในหน้า Browser profiles · เชื่อมอีเมลนี้ใหม่ได้ภายหลัง
        </p>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="error"
          role="alert"
          data-testid="mp-unlink-error"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="ไม่ใช่ตอนนี้"
          color="neutral"
          variant="subtle"
          :disabled="deleting"
          data-testid="mp-unlink-cancel"
          @click="open = false"
        />
        <UButton
          label="ยืนยันยกเลิกการเชื่อม"
          icon="i-lucide-unlink"
          color="error"
          :loading="deleting"
          data-testid="mp-unlink-confirm"
          @click="onConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
