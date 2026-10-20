<script setup lang="ts">
/**
 * TASK-bc-adv-create round 2 (brief `.ai/features/_queue/bc-adv-create-ui.prompt.md` → "BO agent — deliverables").
 * Create one **advertiser (ad account)** under one Business Center org. Opened by the per-org button
 * `ta-adv-create-<orgId>` of the FEAT-059 drill-down on /tiktok-accounts, which already fetched
 * `GET …/organizations/<orgId>/bc-adv-create/suggest` and passes the answer in — the modal issues no GET of its
 * own, so every open is exactly one suggest request made by the page.
 * Sibling of `SubCreateModal.vue`, with two differences: the target is an **org**, not the account (the parent
 * line names the org and its last 4 digits), and the name is the only field — the timezone is fixed to
 * Asia/Bangkok (decision D2) and there is no currency (an advertiser inherits it from its Business Center).
 * `suggest.canCreate === false` → the reason is shown inline (`ta-adv-create-blocked`) and สร้าง is disabled; a
 * name already in `suggest.taken` is an inline field error (no request is spent on it — the API would answer 409
 * `nameTaken`, which is handled too in case the list went stale).
 * Submit → `POST …/organizations/<orgId>/bc-adv-create` (202 `{ jobId, name, orgId }`) → `created`, the page
 * closes the modal and follows the job on the org row. 409 → the API's own Thai text as a toast **and** inline
 * (`ta-adv-create-error`), the modal stays open so the name can be changed; 400 / 404 / 5xx render the same way.
 * BUG-045: `validate-on` is `['input']` only — see AddModal.vue for why `blur`/`change` must not come back.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  BcAdvConflictBody,
  BcAdvCreateAccepted,
  BcAdvCreateBody,
  BcAdvSuggest,
  TikTokAccount
} from '#shared/types/tiktok-accounts'

const props = defineProps<{
  account: TikTokAccount | null
  /** the answer of `GET …/organizations/:orgId/bc-adv-create/suggest`, fetched by the page before it opened this */
  suggest: BcAdvSuggest | null
}>()

const emit = defineEmits<{
  created: [job: BcAdvCreateAccepted]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-adv-create-modal`).
const modalContent = { 'data-testid': 'ta-adv-create-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const TIMEZONE_HINT = 'เขตเวลา: กรุงเทพ (UTC+07:00) — เปลี่ยนไม่ได้หลังสร้าง'

const state = reactive<{ name: string }>({ name: '' })
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

const taken = computed<string[]>(() => props.suggest?.taken ?? [])
/** "ภายใต้: <orgName> (…1234)" — the org this advertiser is created under, never the account */
const parentText = computed<string>(() => {
  const suggest = props.suggest
  if (!suggest) return '—'
  const tail = suggest.orgId ? ` (…${suggest.orgId.slice(-4)})` : ''
  return `${suggest.orgName || '—'}${tail}`
})
/** `canCreate === false` → the reason sentence, shown inline; สร้าง stays disabled while it is set */
const blockedText = computed<string | null>(() =>
  props.suggest && !props.suggest.canCreate ? bcAdvCreateReasonText(props.suggest.reason) : null
)
const nameTaken = computed(() => isBcAdvNameTaken(state.name, taken.value))
/**
 * The inline error is bound on the field itself instead of being left to the schema: `UForm`'s `validate-on`
 * only surfaces zod issues once the form was submitted (same in `SubCreateModal`), and "the name you typed is
 * already used" has to be visible **while** typing. The superRefine below stays as the submit-time guard.
 */
const nameError = computed<string | undefined>(() => nameTaken.value ? BC_ADV_CREATE_REASON_TEXT.nameTaken : undefined)

const schema = z.object({
  name: z.string({ error: 'ต้องใส่ชื่อ' })
    .transform(normalizeBcAdvName)
    .pipe(z.string().min(1, 'ต้องใส่ชื่อ').max(100, 'ชื่อยาวได้ไม่เกิน 100 ตัวอักษร'))
}).superRefine((data, ctx) => {
  // the suggest already listed every used name — refuse it here instead of spending a 409 on it
  if (isBcAdvNameTaken(data.name, taken.value)) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: BC_ADV_CREATE_REASON_TEXT.nameTaken })
  }
})

type Schema = z.output<typeof schema>

/** every open starts from the fresh suggest (the page re-fetches it on every click of the org button) */
function resetForm() {
  state.name = props.suggest?.name ?? ''
  submitting.value = false
  submitError.value = null
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})
// the page sets `suggest` and `open` in the same tick; a later suggest (another org's button) must win
watch(() => props.suggest, () => {
  if (open.value) resetForm()
})

function errorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<BcAdvConflictBody & ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  const reason = err.data?.reason
  const title = err.data?.error ?? err.message ?? 'สร้างบัญชีโฆษณาไม่สำเร็จ'
  const description = issues && issues.length ? issues.join(' · ') : (reason ? bcAdvCreateReasonText(reason) : undefined)
  // our Thai texts are copied from the API's `BC_ADV_CONFLICT`, so on a 409 the reason sentence usually **is**
  // the `error` the API already sent — printing it twice (alert title + description) reads like a stutter
  return { title, description: description === title ? undefined : description }
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  const account = props.account
  const orgId = props.suggest?.orgId
  if (!account || !orgId || submitting.value || blockedText.value) return
  submitting.value = true
  submitError.value = null
  const body: BcAdvCreateBody = { name: event.data.name }
  try {
    // retry: 0 — exactly one POST per click (ofetch would otherwise re-issue it on 5xx and queue two jobs)
    const res = await api<BcAdvCreateAccepted>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/organizations/${encodeURIComponent(orgId)}/bc-adv-create`,
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
    title="สร้างบัญชีโฆษณา"
    description="สร้างบัญชีโฆษณา (advertiser) ใหม่ใต้ Business Center org นี้"
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
          <span
            class="font-medium text-highlighted"
            data-testid="ta-adv-create-parent"
            :data-org-id="suggest?.orgId ?? ''"
          >
            {{ parentText }}
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
          data-testid="ta-adv-create-blocked"
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
            placeholder="ชื่อบัญชีโฆษณา"
            class="w-full"
            :disabled="submitting || !!blockedText"
            data-testid="ta-adv-create-name"
          />
          <template #error="{ error }">
            <span data-testid="ta-adv-create-name-error">{{ error }}</span>
          </template>
        </UFormField>

        <!--
          The hint is a paragraph of its own, not the field's `#help` slot: `UFormField` renders help in a
          `v-else-if` after the error block, and that block exists as soon as an `#error` slot is passed (which
          this field needs for `ta-adv-create-name-error`) — the hint would never be rendered. Verified in the
          browser: it was invisible until it moved out here.
        -->
        <p class="text-xs text-muted" data-testid="ta-adv-create-timezone">
          {{ TIMEZONE_HINT }}
        </p>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="ta-adv-create-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-adv-create-cancel"
            @click="open = false"
          />
          <UButton
            label="สร้าง"
            icon="i-lucide-plus"
            color="primary"
            variant="solid"
            type="submit"
            :disabled="!!blockedText || nameTaken || !state.name.trim()"
            :loading="submitting"
            data-testid="ta-adv-create-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
