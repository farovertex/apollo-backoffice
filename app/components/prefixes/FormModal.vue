<script setup lang="ts">
/**
 * FEAT-076 — GOD create / edit modal of `/settings/prefixes` (`st-prefix-modal`, `data-mode` = `create` | `edit`;
 * spec "UI behaviour", api-contract §3 / §7).
 *
 * Opened by a GOD only (the page renders `st-prefixes-add` / `st-prefix-edit` for a GOD), so the one
 * `GET /backend/admins` per open — a GOD-only endpoint — is never issued for an Admin. Items of the admins
 * multiselect are the non-deleted rows of that answer, label `displayName`.
 *
 * Create → `POST /prefixes { code, name?, adminIds? }` (trimmed; `name` omitted when blank, `adminIds` omitted when
 * empty) → 201 → `created` + toast `เพิ่ม prefix <code> แล้ว`. Edit → `PATCH /prefixes/:id` with **only the changed
 * keys** (`name` — `null` when cleared — / `adminIds` / `status`); nothing changed → Save disabled, no request →
 * 200 → `updated` + toast `บันทึก prefix <code> แล้ว`. The code is immutable (part of live UTM hosts) and shown
 * read-only in edit mode. Any API error (409 `code นี้มีอยู่แล้ว`, 404 `ไม่พบ admin`, 400 issues) renders in
 * `st-prefix-error`, the modal stays open, no toast.
 *
 * Client validation mirrors the API (the `UTM_SETTINGS_MESSAGES` texts of `code`, `nameTooLong` of `name`) and
 * blocks the submit without a request. `validate-on` is `['input']` (BUG-045, see the account AddModal).
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdminsResponse } from '#shared/types/admins'
import type { CreatePrefixBody, PatchPrefixBody, PrefixStatus, PrefixView } from '#shared/types/prefixes'

const props = defineProps<{
  /** `null` = create */
  prefix: PrefixView | null
}>()

const emit = defineEmits<{
  created: [prefix: PrefixView]
  updated: [prefix: PrefixView]
}>()

const open = defineModel<boolean>('open', { default: false })

const mode = computed<'create' | 'edit'>(() => (props.prefix ? 'edit' : 'create'))
// UModal's root is renderless — `content` is v-bound onto the rendered DialogContent element
const modalContent = computed(() => ({
  'data-testid': 'st-prefix-modal',
  'data-mode': mode.value
}) as ModalProps['content'])

const api = useApi()
const toast = useToast()

/** the API's texts (`UTM_SETTINGS_MESSAGES` for `code`, `PREFIX_MESSAGES.nameTooLong`) */
const MESSAGES = {
  empty: 'ต้องไม่ว่าง',
  tooLong: `prefix ยาวเกิน ${UTM_PREFIX_MAX_LENGTH} ตัว`,
  whitespace: 'prefix ต้องไม่มีช่องว่าง',
  nameTooLong: `name ยาวเกิน ${PREFIX_NAME_MAX_LENGTH} ตัว`
} as const

const schema = z.object({
  code: z.string()
    .trim()
    .min(1, MESSAGES.empty)
    .max(UTM_PREFIX_MAX_LENGTH, MESSAGES.tooLong)
    .regex(/^\S+$/, MESSAGES.whitespace),
  name: z.string().trim().max(PREFIX_NAME_MAX_LENGTH, MESSAGES.nameTooLong),
  adminIds: z.array(z.string()),
  status: z.enum(['active', 'archived'])
})
type Schema = z.output<typeof schema>

interface FormState {
  code: string
  name: string
  adminIds: string[]
  status: PrefixStatus
}

function stateOf(prefix: PrefixView | null): FormState {
  return {
    code: prefix?.code ?? '',
    name: prefix?.name ?? '',
    adminIds: [...(prefix?.adminIds ?? [])],
    status: prefix?.status ?? 'active'
  }
}

const state = reactive<FormState>(stateOf(null))
const submitting = ref(false)
const submitError = ref<string | null>(null)

// ── admins (GOD-only endpoint, once per open) ───────────────────────────────────────────────────────────────────────
interface AdminItem {
  id: string
  label: string
}
const adminItems = ref<AdminItem[]>([])
const adminsPending = ref(false)
const adminsError = ref<string | null>(null)
let adminsSeq = 0

async function loadAdmins() {
  const seq = ++adminsSeq
  adminsPending.value = true
  adminsError.value = null
  try {
    const res = await api<AdminsResponse>('/admins', { retry: 0 })
    if (seq !== adminsSeq) return
    adminItems.value = (res.admins ?? [])
      .filter(a => a.status !== 'deleted')
      .map(a => ({ id: a.id, label: a.displayName }))
  } catch (e) {
    if (seq !== adminsSeq) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    adminItems.value = []
    adminsError.value = err.data?.error ?? err.message ?? 'โหลดรายชื่อ admin ไม่สำเร็จ'
  } finally {
    if (seq === adminsSeq) adminsPending.value = false
  }
}

/**
 * the selectable items + every admin already on the prefix that `GET /admins` did not return (so a selected chip
 * never renders as a bare id): its `displayName` from the view, or the id when the admin row is gone
 */
const selectItems = computed<AdminItem[]>(() => {
  const known = new Set(adminItems.value.map(a => a.id))
  const extra = (props.prefix?.adminIds ?? [])
    .filter(id => !known.has(id))
    .map(id => ({ id, label: props.prefix?.admins.find(a => a.id === id)?.displayName ?? id }))
  return [...adminItems.value, ...extra]
})

watch(open, (isOpen) => {
  Object.assign(state, stateOf(props.prefix))
  submitting.value = false
  submitError.value = null
  if (isOpen) {
    void loadAdmins()
  } else {
    adminsSeq++
    adminItems.value = []
    adminsPending.value = false
    adminsError.value = null
  }
})

// ── diff (edit) ─────────────────────────────────────────────────────────────────────────────────────────────────────
function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function changedBody(data: Schema, prefix: PrefixView): PatchPrefixBody {
  const body: PatchPrefixBody = {}
  const name = data.name || null
  if (name !== (prefix.name ?? null)) body.name = name
  if (!sameIds(data.adminIds, prefix.adminIds)) body.adminIds = [...data.adminIds]
  if (data.status !== prefix.status) body.status = data.status
  return body
}

const dirty = computed(() => {
  const p = props.prefix
  if (!p) return true
  return state.name.trim() !== (p.name ?? '')
    || !sameIds(state.adminIds, p.adminIds)
    || state.status !== p.status
})

// ── submit ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function errorText(e: unknown): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
  if (issues.length) return issues.join(' · ')
  return err.data?.error ?? err.message ?? 'บันทึก prefix ไม่สำเร็จ'
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  const prefix = props.prefix
  const data = event.data
  submitError.value = null

  if (!prefix) {
    const body: CreatePrefixBody = { code: data.code }
    if (data.name) body.name = data.name
    if (data.adminIds.length) body.adminIds = [...data.adminIds]
    submitting.value = true
    try {
      // retry: 0 — exactly one POST per click
      const created = await api<PrefixView>('/prefixes', { method: 'POST', body, retry: 0 })
      open.value = false
      toast.add({ title: `เพิ่ม prefix ${created.code} แล้ว`, icon: 'i-lucide-check', color: 'success' })
      emit('created', created)
    } catch (e) {
      submitError.value = errorText(e)
    } finally {
      submitting.value = false
    }
    return
  }

  const body = changedBody(data, prefix)
  if (Object.keys(body).length === 0) {
    open.value = false
    return
  }
  submitting.value = true
  try {
    // retry: 0 — exactly one PATCH per click
    const updated = await api<PrefixView>(`/prefixes/${encodeURIComponent(prefix.id)}`, { method: 'PATCH', body, retry: 0 })
    open.value = false
    toast.add({ title: `บันทึก prefix ${updated.code} แล้ว`, icon: 'i-lucide-check', color: 'success' })
    emit('updated', updated)
  } catch (e) {
    submitError.value = errorText(e)
  } finally {
    submitting.value = false
  }
}

const statusActive = computed({
  get: () => state.status === 'active',
  set: (on: boolean) => {
    state.status = on ? 'active' : 'archived'
  }
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="mode === 'create' ? 'เพิ่ม prefix' : `แก้ไข prefix ${prefix?.code ?? ''}`"
    description="Prefix ใช้กำหนดเส้นทาง (UTM / แจ้งเตือน) ของบัญชี ไม่ใช่สิทธิ์การเข้าถึงบัญชี"
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
        <UFormField
          v-if="mode === 'create'"
          label="Code"
          name="code"
          required
          hint="แก้ไขภายหลังไม่ได้"
          description="ตัวพิมพ์ใหญ่-เล็กต่างกัน · ไม่มีช่องว่าง · เป็นส่วนหนึ่งของ host UTM"
        >
          <UInput
            v-model="state.code"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="web-A"
            class="w-full"
            :disabled="submitting"
            data-testid="st-prefix-code-input"
          />
        </UFormField>
        <UFormField
          v-else
          label="Code"
          name="code"
          hint="แก้ไขไม่ได้"
        >
          <p
            class="rounded-md border border-default bg-elevated/50 px-2.5 py-1.5 font-mono text-sm break-all text-highlighted"
            data-testid="st-prefix-code-readonly"
          >
            {{ state.code }}
          </p>
        </UFormField>

        <UFormField label="Name" name="name" hint="ไม่บังคับ">
          <UInput
            v-model="state.name"
            autocomplete="off"
            placeholder="Site A"
            class="w-full"
            :disabled="submitting"
            data-testid="st-prefix-name-input"
          />
        </UFormField>

        <UFormField label="Admin ที่ดูแล" name="adminIds" description="Admin ที่ดูแลเลือก prefix นี้ตอนเพิ่มบัญชีได้">
          <USelectMenu
            v-model="state.adminIds"
            multiple
            :items="selectItems"
            value-key="id"
            :search-input="{ placeholder: 'ค้นหา admin' }"
            :loading="adminsPending"
            :disabled="submitting || adminsPending"
            :placeholder="adminsPending ? 'กำลังโหลด admin…' : 'เลือก admin'"
            icon="i-lucide-users"
            class="w-full"
            data-testid="st-prefix-admins-select"
          />
          <template v-if="adminsError" #error>
            <span data-testid="st-prefix-admins-error">{{ adminsError }}</span>
          </template>
        </UFormField>

        <UFormField
          v-if="mode === 'edit'"
          label="สถานะ"
          name="status"
          description="เก็บถาวร = ไม่ให้เลือกตอนเพิ่มบัญชี และไม่อยู่ในรายการ UTM · บัญชีเดิมยังผูกอยู่"
        >
          <USwitch
            v-model="statusActive"
            :label="statusActive ? 'ใช้งาน' : 'เก็บถาวร'"
            :disabled="submitting"
            :data-status="state.status"
            data-testid="st-prefix-status-toggle"
          />
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          role="alert"
          data-testid="st-prefix-error"
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
            data-testid="st-prefix-cancel"
            @click="open = false"
          />
          <UButton
            :label="mode === 'create' ? 'เพิ่ม' : 'บันทึก'"
            :icon="mode === 'create' ? 'i-lucide-plus' : 'i-lucide-save'"
            color="primary"
            type="submit"
            :disabled="!dirty"
            :loading="submitting"
            data-testid="st-prefix-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
