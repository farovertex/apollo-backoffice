<script setup lang="ts">
/**
 * FEAT-099 (spec "UI behaviour → Account card", AC-25, AC-30, AC-36; contract v2) — the confirm step of
 * "ยกเลิกการเชื่อม". One `DELETE /mssg-accounts/:id` per click (`retry: 0`):
 *   - **202** + view (`status: disconnecting`, `job.type: mssgLogout`): a job logs out of mssg inside the browser
 *     profile, then the account is unbound and deleted → `disconnecting` (the page polls until the 404);
 *   - **200** `{ ok: true }`: the account had no profile and is already gone → `unlinked` (the card goes at once);
 *   - 409 `jobInProgress` and every other failure stay in here as `mp-unlink-error`.
 * The browser profile itself is never deleted or edited; it becomes free for the next connect of this area.
 */
import type { ModalProps } from '@nuxt/ui'
import type { MssgAccountView, MssgUnlinkedBody } from '#shared/types/mssg-accounts'

const props = defineProps<{
  account: MssgAccountView | null
}>()

const emit = defineEmits<{
  /** 200 (no profile) or an earlier 404: the account is gone already */
  unlinked: [id: string]
  /** 202: the logout job runs, the page follows the account until it answers 404 */
  disconnecting: [view: MssgAccountView]
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
    const res = await api<MssgAccountView | MssgUnlinkedBody>(`/mssg-accounts/${encodeURIComponent(acc.id)}`, { method: 'DELETE', retry: 0 })
    if ('id' in res) {
      emit('disconnecting', res)
      toast.add({ title: 'กำลังออกจากระบบ mssg', description: `${mssgAccountName(acc)} · การ์ดจะหายไปเมื่อเสร็จ`, color: 'info' })
    } else {
      emit('unlinked', acc.id)
      toast.add({ title: 'ยกเลิกการเชื่อมแล้ว', description: mssgAccountName(acc), color: 'success' })
    }
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
    error.value = failure.status === 409 && failure.body?.reason === 'jobInProgress' ? MSSG_UNLINK_BUSY_TEXT : failure.message
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
    :ui="{ content: 'max-w-md', header: 'min-w-0', wrapper: 'min-w-0', title: 'wrap-anywhere', description: 'wrap-anywhere' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3 text-sm">
        <p class="break-words text-toned">
          ยกเลิกการเชื่อม <span class="font-medium break-all text-highlighted">{{ account?.email }}</span> ออกจากพื้นที่นี้?
        </p>
        <p class="text-muted" data-testid="mp-unlink-text">
          ระบบจะออกจากระบบ mssg ภายในโปรไฟล์เบราว์เซอร์
          <span v-if="account?.browserProfile" class="font-medium break-all text-toned">{{ account.browserProfile.name }}</span>
          ให้ก่อน แล้วปลดโปรไฟล์ให้ว่าง เพื่อใช้กับบัญชี mssg ถัดไปของพื้นที่นี้ · โปรไฟล์จะไม่ถูกลบหรือแก้ไข · เชื่อมอีเมลนี้ใหม่ได้ภายหลัง
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
