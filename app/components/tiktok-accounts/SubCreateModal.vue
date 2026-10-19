<script setup lang="ts">
/**
 * TASK-bc-sub-create round 2 (brief `.ai/features/_queue/bc-sub-create-ui.prompt.md` → "BO agent — deliverables").
 * Create one **sub Business Center** under the account's root BC. Opened by the row action `ta-sub-create-<id>`
 * of /tiktok-accounts, which already fetched `GET …/bc-sub-create/suggest` and passes the answer in — the modal
 * issues no GET of its own, so every open is exactly one suggest request made by the page.
 * Fields: **ชื่อ** (prefilled with `suggest.name` = `<bcOrgName> NNN` with the lowest unused number, editable,
 * 1..100) and **สกุลเงิน** (THB / USD, default `suggest.currency`). The timezone is fixed to Asia/Bangkok
 * (decision D2) and is a hint, not a field — it cannot be changed after the Business Center exists.
 * `suggest.canCreate === false` → the reason is shown inline (`ta-sub-create-blocked`) and สร้าง is disabled; a
 * name that is already in `suggest.taken` is an inline field error (no request is made for it — the API would
 * answer 409 `nameTaken`, which is handled too in case the list went stale).
 * Submit → `POST …/bc-sub-create` (202 `{ jobId, name, currency }`) → `created`, the page closes the modal and
 * follows the job. 409 → the API's own Thai text as a toast **and** inline (`ta-sub-create-error`), the modal
 * stays open so the name can be changed; 400 / 404 / 5xx are rendered the same way.
 * BUG-045: `validate-on` is `['input']` only — see AddModal.vue for why `blur`/`change` must not come back.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  BcSubCreateBody,
  BcSubCreateConflictBody,
  BcSubCreateJobResponse,
  BcSubCreateSuggest,
  BcSubCurrency,
  TikTokAccount
} from '#shared/types/tiktok-accounts'

const props = defineProps<{
  account: TikTokAccount | null
  /** the answer of `GET …/bc-sub-create/suggest`, fetched by the page right before it opened this modal */
  suggest: BcSubCreateSuggest | null
}>()

const emit = defineEmits<{
  created: [job: BcSubCreateJobResponse]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-sub-create-modal`).
const modalContent = { 'data-testid': 'ta-sub-create-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const CURRENCIES: BcSubCurrency[] = ['THB', 'USD']
const TIMEZONE_HINT = 'เขตเวลา: กรุงเทพ (UTC+07:00) — เปลี่ยนไม่ได้หลังสร้าง'

interface FormState {
  name: string
  currency: BcSubCurrency
}

const state = reactive<FormState>({ name: '', currency: 'THB' })
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

const taken = computed<string[]>(() => props.suggest?.taken ?? [])
/** `canCreate === false` → the reason sentence, shown inline; สร้าง stays disabled while it is set */
const blockedText = computed<string | null>(() =>
  props.suggest && !props.suggest.canCreate ? bcSubCreateReasonText(props.suggest.reason) : null
)
const nameTaken = computed(() => isBcSubNameTaken(state.name, taken.value))
/**
 * The inline error is bound on the field itself instead of being left to the schema: `UForm`'s `validate-on`
 * only surfaces zod issues once the form was submitted (same in `EditModal`), and "the name you typed is
 * already used" has to be visible **while** typing. The superRefine below stays as the submit-time guard.
 */
const nameError = computed<string | undefined>(() => nameTaken.value ? BC_SUB_CREATE_REASON_TEXT.nameTaken : undefined)

const schema = z.object({
  name: z.string({ error: 'ต้องใส่ชื่อ' })
    .transform(normalizeBcSubName)
    .pipe(z.string().min(1, 'ต้องใส่ชื่อ').max(100, 'ชื่อยาวได้ไม่เกิน 100 ตัวอักษร')),
  currency: z.enum(['THB', 'USD'])
}).superRefine((data, ctx) => {
  // the suggest already listed every used name — refuse it here instead of spending a 409 on it
  if (isBcSubNameTaken(data.name, taken.value)) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: BC_SUB_CREATE_REASON_TEXT.nameTaken })
  }
})

type Schema = z.output<typeof schema>

/** every open starts from the fresh suggest (the page re-fetches it on every click of the row action) */
function resetForm() {
  state.name = props.suggest?.name ?? ''
  state.currency = props.suggest?.currency ?? 'THB'
  submitting.value = false
  submitError.value = null
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})
// the page sets `suggest` and `open` in the same tick; a later suggest (re-open of another row) must win
watch(() => props.suggest, () => {
  if (open.value) resetForm()
})

function errorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<BcSubCreateConflictBody & ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  const reason = err.data?.reason
  return {
    title: err.data?.error ?? err.message ?? 'สร้าง Sub BC ไม่สำเร็จ',
    description: issues && issues.length ? issues.join(' · ') : (reason ? bcSubCreateReasonText(reason) : undefined)
  }
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const account = props.account
  if (!account || submitting.value || blockedText.value) return
  submitting.value = true
  submitError.value = null
  const body: BcSubCreateBody = { name: event.data.name, currency: event.data.currency }
  try {
    // retry: 0 — exactly one POST per click (ofetch would otherwise re-issue it on 5xx and queue two jobs)
    const res = await api<BcSubCreateJobResponse>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/bc-sub-create`,
      { method: 'POST', retry: 0, body }
    )
    open.value = false
    emit('created', res)
  } catch (e) {
    const shown = errorState(e)
    submitError.value = shown
    // 409 (and anything else) also toasts: the brief asks for the Thai reason text on a conflict
    toast.add({ title: shown.title, description: shown.description, color: 'error' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="สร้าง Sub Business Center"
    description="สร้างบัญชีศูนย์ธุรกิจย่อยใต้ Business Center หลักของบัญชีนี้"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        :validate-on="['input']"
        class="space-y-4"
        @submit="onSubmit"
      >
        <p class="text-sm text-muted">
          ภายใต้:
          <span class="font-medium text-highlighted" data-testid="ta-sub-create-parent">
            {{ suggest?.bcOrgName || '—' }}
          </span>
        </p>

        <UAlert
          v-if="blockedText"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="สร้างไม่ได้ตอนนี้"
          :description="blockedText"
          role="alert"
          data-testid="ta-sub-create-blocked"
        />

        <UFormField
          label="ชื่อ"
          name="name"
          required
          :error="nameError"
        >
          <UInput
            v-model="state.name"
            autocomplete="off"
            placeholder="ชื่อศูนย์ธุรกิจย่อย"
            class="w-full"
            :disabled="submitting || !!blockedText"
            data-testid="ta-sub-create-name"
          />
          <template #error="{ error }">
            <span data-testid="ta-sub-create-name-error">{{ error }}</span>
          </template>
        </UFormField>

        <UFormField
          label="สกุลเงิน"
          name="currency"
          required
        >
          <USelect
            v-model="state.currency"
            :items="CURRENCIES"
            class="w-full"
            :disabled="submitting || !!blockedText"
            aria-label="สกุลเงิน"
            data-testid="ta-sub-create-currency"
            :data-currency="state.currency"
          />
          <template #help>
            <span data-testid="ta-sub-create-timezone">{{ TIMEZONE_HINT }}</span>
          </template>
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="ta-sub-create-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-sub-create-cancel"
            @click="open = false"
          />
          <UButton
            label="สร้าง"
            icon="i-lucide-building-2"
            color="primary"
            variant="solid"
            type="submit"
            :disabled="!!blockedText || nameTaken || !state.name.trim()"
            :loading="submitting"
            data-testid="ta-sub-create-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
