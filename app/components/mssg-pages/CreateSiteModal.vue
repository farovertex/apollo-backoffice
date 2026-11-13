<script setup lang="ts">
/**
 * FEAT-101 M5 (AC-33, AC-37; contract §4.1) — "+ สร้างเว็บ" = `POST /mssg-accounts/:id/sites { name? }`.
 *
 * The name is optional: empty → the body is `{}` (mssg names the new site itself); otherwise 3–250 characters after
 * trim (Thai message, nothing sent while invalid). 202 → the account view with the `mssgSiteCreate` job is handed to the
 * page (`requested`), which follows it like every account job; the dialog closes. 409 `quotaReached` /
 * `jobInProgress` / `notConnected` → Thai text in `mp-create-site-error` and the page re-reads the account
 * (`stale`); a 400 issue on `name` lands under the field.
 *
 * Test ids: `mp-create-site-dialog`, `mp-create-site-name`, `mp-create-site-error-name` (field), `mp-create-site-error`
 * (request), `mp-create-site-cancel`, `mp-create-site-submit`.
 */
import * as z from 'zod'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { MssgAccountView, MssgSiteCreateBody } from '#shared/types/mssg-accounts'

const props = defineProps<{
  account: MssgAccountView | null
}>()

const emit = defineEmits<{
  requested: [view: MssgAccountView]
  /** the server refused because the card was out of date (409 / 404): the page re-reads the account */
  stale: [accountId: string, status: number | undefined]
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'mp-create-site-dialog' } as ModalProps['content']

const api = useApi()

const NAME_TEXT = 'ชื่อเว็บต้องยาว 3–250 ตัวอักษร หรือเว้นว่างให้ mssg ตั้งชื่อให้'
const schema = z.object({
  name: z.string().refine((v) => {
    const t = v.trim()
    return t === '' || (t.length >= 3 && t.length <= 250)
  }, NAME_TEXT)
})
type Schema = z.output<typeof schema>

const state = reactive({ name: '' })
const saving = ref(false)
const error = ref<string | null>(null)
const serverErrors = ref<Record<string, string>>({})

watch(open, (isOpen) => {
  if (!isOpen) return
  state.name = ''
  saving.value = false
  error.value = null
  serverErrors.value = {}
})

watch(() => state.name, () => {
  serverErrors.value = {}
})

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const acc = props.account
  if (!acc || saving.value) return
  const name = event.data.name.trim()
  const body: MssgSiteCreateBody = name ? { name } : {}
  saving.value = true
  error.value = null
  try {
    const view = await api<MssgAccountView>(`/mssg-accounts/${encodeURIComponent(acc.id)}/sites`, { method: 'POST', body, retry: 0 })
    emit('requested', view)
    open.value = false
  } catch (e) {
    const failure = mssgFailure(e, 'สั่งสร้างเว็บไม่สำเร็จ')
    const issue = failure.body?.issues?.find(i => i.path === 'name')
    if (issue) serverErrors.value = { name: issue.message }
    else error.value = failure.message
    if (failure.status === 409 || failure.status === 404) emit('stale', acc.id, failure.status)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="สร้างเว็บใหม่"
    :description="account ? `ในบัญชี ${mssgAccountName(account)}` : ''"
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
          label="ชื่อเว็บ (ไม่บังคับ)"
          name="name"
          :error="serverErrors['name']"
          help="เว้นว่างได้ · mssg จะตั้งชื่อให้ แล้วเปลี่ยนชื่อภายหลังในตัวแก้ไขเว็บได้"
          data-testid="mp-create-site-field"
        >
          <UInput
            v-model="state.name"
            placeholder="เช่น ร้านหลัก โปรโมชันเดือนนี้"
            class="w-full"
            maxlength="250"
            :disabled="saving"
            data-testid="mp-create-site-name"
          />
          <template #error="{ error: msg }">
            <span v-if="msg" data-testid="mp-create-site-error-name">{{ msg }}</span>
          </template>
        </UFormField>
        <p class="text-xs text-muted">
          ระบบจะเปิดโปรไฟล์ของบัญชีนี้แล้วสร้างเว็บที่ mssg ให้ · ใช้เวลาสักครู่ เว็บใหม่จะขึ้นในรายการเมื่อเสร็จ
        </p>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="error"
          role="alert"
          data-testid="mp-create-site-error"
        />
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="saving"
            data-testid="mp-create-site-cancel"
            @click="open = false"
          />
          <UButton
            type="submit"
            label="สร้างเว็บ"
            icon="i-lucide-plus"
            :loading="saving"
            data-testid="mp-create-site-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
