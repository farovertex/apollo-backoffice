<script setup lang="ts">
/**
 * FEAT-076 — GOD bulk bind of `/tiktok-accounts` (`ta-bulk-prefix-modal`, spec "UI behaviour", AC-19,
 * api-contract §5.3 / §7).
 *
 * Opened from the toolbar button `ta-bulk-prefix` with the selected account ids. One
 * `GET /backend/prefixes?status=active` per open fills `ta-bulk-prefix-select` (the active prefixes + `ถอด prefix`
 * = detach). Submit → one `POST /backend/tiktok-accounts/prefix-bulk { accountIds, prefixId }` (`null` for
 * `ถอด prefix`) → toast `ผูก prefix ให้ N บัญชี` / `ถอด prefix จาก N บัญชี` (N = `updated`) → `done` (the page clears the
 * selection and re-reads the list). An API error (404 archived/unknown, 403, 400) renders in `ta-bulk-prefix-error`,
 * the modal stays open. GOD only — the page never renders the trigger for anybody else.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PrefixBulkBody, PrefixBulkResult } from '#shared/types/prefixes'

const props = defineProps<{
  accountIds: string[]
}>()

const emit = defineEmits<{
  done: [result: PrefixBulkResult]
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'ta-bulk-prefix-modal' } as ModalProps['content']

/** `ถอด prefix` — USelectMenu needs a non-null value per item; this one maps to `prefixId: null` */
const DETACH = '__detach__'

const api = useApi()
const toast = useToast()
const prefixOptions = usePrefixOptions()
const { pending: prefixesPending, error: prefixesError } = prefixOptions

const items = computed(() => [
  ...prefixOptions.prefixes.value.map(p => ({ id: p.id, label: prefixLabel(p) })),
  { id: DETACH, label: 'ถอด prefix', icon: 'i-lucide-unlink' }
])

const choice = ref<string | undefined>(undefined)
const submitting = ref(false)
const submitError = ref<string | null>(null)

watch(open, (isOpen) => {
  choice.value = undefined
  submitting.value = false
  submitError.value = null
  if (isOpen) void prefixOptions.load()
  else prefixOptions.reset()
})

const canSubmit = computed(() => !!choice.value && props.accountIds.length > 0 && !submitting.value)

function errorText(e: unknown): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
  if (issues.length) return issues.join(' · ')
  return err.data?.error ?? err.message ?? 'ผูก prefix ไม่สำเร็จ'
}

async function onSubmit() {
  if (!canSubmit.value || !choice.value) return
  const prefixId = choice.value === DETACH ? null : choice.value
  const body: PrefixBulkBody = { accountIds: [...props.accountIds], prefixId }
  submitting.value = true
  submitError.value = null
  try {
    // retry: 0 — exactly one POST per click
    const res = await api<PrefixBulkResult>('/tiktok-accounts/prefix-bulk', { method: 'POST', body, retry: 0 })
    open.value = false
    const skipped = res.skipped?.length ?? 0
    toast.add({
      title: prefixId === null ? `ถอด prefix จาก ${res.updated} บัญชี` : `ผูก prefix ให้ ${res.updated} บัญชี`,
      description: skipped ? `ข้าม ${skipped} บัญชี (ไม่พบ หรือไม่มีอะไรเปลี่ยน)` : undefined,
      icon: 'i-lucide-check',
      color: 'success'
    })
    emit('done', res)
  } catch (e) {
    submitError.value = errorText(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`ผูก prefix ให้ ${accountIds.length} บัญชี`"
    description="Prefix ใช้กำหนดเส้นทางของบัญชีเท่านั้น ไม่เปลี่ยนสิทธิ์การเข้าถึงบัญชี"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="Prefix" name="prefixId" required>
          <USelectMenu
            v-model="choice"
            :items="items"
            value-key="id"
            :search-input="{ placeholder: 'Search prefix' }"
            :loading="prefixesPending"
            :disabled="prefixesPending || submitting"
            :placeholder="prefixesPending ? 'Loading prefixes…' : 'เลือก prefix'"
            icon="i-lucide-tag"
            class="w-full"
            data-testid="ta-bulk-prefix-select"
          />
          <template v-if="prefixesError" #error>
            <span data-testid="ta-bulk-prefix-load-error">{{ prefixesError }}</span>
          </template>
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          role="alert"
          data-testid="ta-bulk-prefix-error"
        >
          <template #description>
            <span class="break-words">{{ submitError }}</span>
          </template>
        </UAlert>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-bulk-prefix-cancel"
            @click="open = false"
          />
          <UButton
            label="บันทึก"
            icon="i-lucide-save"
            color="primary"
            :disabled="!canSubmit"
            :loading="submitting"
            data-testid="ta-bulk-prefix-submit"
            @click="onSubmit()"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
