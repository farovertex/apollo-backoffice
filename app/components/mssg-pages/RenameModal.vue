<script setup lang="ts">
/**
 * FEAT-099 (spec "UI behaviour → Account card", AC-30) — rename = `PATCH /mssg-accounts/:id { nickname }`.
 * ≤60 after trim, `''` clears it (sent as `null`). Unchanged → no request. 400 issues land on the field through a
 * component-owned `serverErrors` map (FEAT-008 BUG-007), anything else in `mp-rename-error`.
 */
import * as z from 'zod'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { MssgAccountView, MssgRenameBody } from '#shared/types/mssg-accounts'

const props = defineProps<{
  account: MssgAccountView | null
}>()

const emit = defineEmits<{
  renamed: [view: MssgAccountView]
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'mp-rename-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const schema = z.object({
  nickname: z.string().trim().max(60, 'ชื่อเรียกยาวได้ไม่เกิน 60 ตัวอักษร')
})
type Schema = z.output<typeof schema>

const state = reactive({ nickname: '' })
const saving = ref(false)
const error = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

watch(open, (isOpen) => {
  if (!isOpen) return
  state.nickname = props.account?.nickname ?? ''
  saving.value = false
  error.value = null
  serverErrors.value = {}
})

watch(() => state.nickname, () => {
  serverErrors.value = {}
})

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const acc = props.account
  if (!acc || saving.value) return
  const next = event.data.nickname === '' ? null : event.data.nickname
  if (next === (acc.nickname ?? null)) {
    open.value = false
    return
  }
  saving.value = true
  error.value = null
  try {
    const body: MssgRenameBody = { nickname: next }
    const view = await api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(acc.id)}`, { method: 'PATCH', body, retry: 0 })
    emit('renamed', view)
    toast.add({ title: 'บันทึกชื่อเรียกแล้ว', description: mssgAccountName(view), color: 'success' })
    open.value = false
  } catch (e) {
    const failure = mssgFailure(e, 'บันทึกชื่อเรียกไม่สำเร็จ')
    const issue = failure.body?.issues?.find(i => i.path === 'nickname')
    if (issue) serverErrors.value = { nickname: issue.message }
    else error.value = failure.message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="ตั้งชื่อเรียกบัญชี"
    :description="account?.email ?? ''"
    :dismissible="!saving"
    :ui="{ content: 'max-w-md', header: 'min-w-0', wrapper: 'min-w-0', title: 'wrap-anywhere', description: 'wrap-anywhere' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        :validate-on="['input']"
        class="flex flex-col gap-4"
        @submit="onSubmit"
      >
        <UFormField
          label="ชื่อเรียก (ไม่บังคับ)"
          name="nickname"
          :error="serverErrors['nickname']"
          help="เว้นว่างเพื่อลบชื่อเรียก"
          data-testid="mp-rename-field"
        >
          <UInput
            v-model="state.nickname"
            placeholder="เช่น ร้านหลัก, แบรนด์ที่ 2"
            class="w-full"
            :disabled="saving"
            data-testid="mp-rename-input"
          />
        </UFormField>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="error"
          role="alert"
          data-testid="mp-rename-error"
        />
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="saving"
            data-testid="mp-rename-cancel"
            @click="open = false"
          />
          <UButton
            type="submit"
            label="บันทึก"
            :loading="saving"
            data-testid="mp-rename-save"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
