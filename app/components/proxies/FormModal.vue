<script setup lang="ts">
/**
 * FEAT-006 — Add / Edit proxy (function 2.9; api-contract.md v1 `POST /proxies`, `PATCH /proxies/:id`).
 * One component for both modes: `proxy === null` → create (`POST`, full body, empty optionals omitted),
 * `proxy` set → edit (`PATCH` with **only the changed keys**).
 * The password field always starts empty: in edit mode it is only sent when something was typed (placeholder
 * "Unchanged"), and the "Clear password" checkbox sends `password: null`. The zod schema mirrors the API's
 * `createProxySchema`, so an invalid label / host / port / country never reaches the network.
 * API errors (409 duplicate label, 400 validation, 404) are shown in `px-form-error`; the modal stays open with
 * every typed value intact.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { CreateProxyBody, PatchProxyBody, Proxy, ProxyType } from '#shared/types/proxies'

const props = defineProps<{
  /** null = create, a row = edit */
  proxy: Proxy | null
}>()

const emit = defineEmits<{
  created: [proxy: Proxy]
  updated: [proxy: Proxy]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `px-form-modal`).
const modalContent = { 'data-testid': 'px-form-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const isEdit = computed(() => props.proxy !== null)

// ── form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const TYPE_ITEMS: { label: string, value: ProxyType }[] = [
  { label: 'http', value: 'http' },
  { label: 'https', value: 'https' },
  { label: 'socks5', value: 'socks5' }
]

const schema = z.object({
  label: z.string({ error: 'Label is required' })
    .trim()
    .min(1, 'Label is required')
    .max(60, 'Label must be at most 60 characters'),
  type: z.enum(['http', 'https', 'socks5'], { error: 'Type is required' }),
  host: z.string({ error: 'Host is required' })
    .trim()
    .min(1, 'Host is required')
    .max(253, 'Host must be at most 253 characters')
    .refine(v => !/\s/.test(v), 'Host must not contain spaces'),
  port: z.preprocess(
    (v) => {
      if (typeof v === 'number') return v
      const text = String(v ?? '').trim()
      if (text === '') return undefined
      const n = Number(text)
      return Number.isFinite(n) ? n : text
    },
    z.number({ error: issue => issue.input === undefined ? 'Port is required' : 'Port must be a number' })
      .int('Port must be a whole number')
      .min(1, 'Port must be between 1 and 65535')
      .max(65535, 'Port must be between 1 and 65535')
  ),
  username: z.string().trim().max(128, 'Username must be at most 128 characters'),
  password: z.string().max(256, 'Password must be at most 256 characters'),
  country: z.string()
    .trim()
    .transform(v => v.toUpperCase())
    .refine(v => v === '' || /^[A-Z]{2}$/.test(v), 'Country must be 2 letters (e.g. TH)'),
  note: z.string().trim().max(500, 'Note must be at most 500 characters')
})

type Schema = z.output<typeof schema>

interface FormState {
  label: string
  type: ProxyType
  host: string
  port: string
  username: string
  password: string
  country: string
  note: string
}

function emptyState(): FormState {
  return { label: '', type: 'http', host: '', port: '', username: '', password: '', country: '', note: '' }
}

function stateFrom(proxy: Proxy | null): FormState {
  if (!proxy) return emptyState()
  return {
    label: proxy.label,
    type: proxy.type,
    host: proxy.host,
    port: String(proxy.port),
    username: proxy.username ?? '',
    // never prefilled — an untouched field means "leave the stored password alone"
    password: '',
    country: proxy.country ?? '',
    note: proxy.note ?? ''
  }
}

// the submit button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

const state = reactive<FormState>(emptyState())
const showPassword = ref(false)
const clearPassword = ref(false)
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

function resetForm() {
  Object.assign(state, stateFrom(props.proxy))
  showPassword.value = false
  clearPassword.value = false
  submitting.value = false
  submitError.value = null
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})

// "Clear password" and typing a new one are mutually exclusive
watch(clearPassword, (on) => {
  if (on) {
    state.password = ''
    showPassword.value = false
  }
})

function upperCaseCountry() {
  state.country = state.country.trim().toUpperCase()
}

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/** '' → null (the API stores empty optional fields as null) */
function orNull(value: string): string | null {
  const text = value.trim()
  return text === '' ? null : text
}

function createBody(data: Schema): CreateProxyBody {
  const body: CreateProxyBody = { label: data.label, type: data.type, host: data.host, port: data.port }
  // empty optional fields are omitted on create
  if (data.username) body.username = data.username
  if (data.password) body.password = data.password
  if (data.country) body.country = data.country
  if (data.note) body.note = data.note
  return body
}

/** only the keys whose value really changed (AC-4: no `password` key when the field was not touched) */
function patchBody(data: Schema, original: Proxy): PatchProxyBody {
  const body: PatchProxyBody = {}
  if (data.label !== original.label) body.label = data.label
  if (data.type !== original.type) body.type = data.type
  if (data.host !== original.host) body.host = data.host
  if (data.port !== original.port) body.port = data.port
  const username = orNull(data.username)
  if (username !== original.username) body.username = username
  const country = orNull(data.country)
  if (country !== original.country) body.country = country
  const note = orNull(data.note)
  if (note !== original.note) body.note = note
  if (clearPassword.value) body.password = null
  else if (data.password) body.password = data.password
  return body
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  const original = props.proxy
  submitError.value = null

  if (original) {
    const body = patchBody(event.data, original)
    if (Object.keys(body).length === 0) {
      // nothing to send — the API would answer 400 on an empty body
      open.value = false
      toast.add({ title: 'Nothing changed', description: original.label, color: 'info' })
      return
    }
    submitting.value = true
    try {
      // retry: 0 — exactly one PATCH per submit
      const updated = await api<Proxy>(`/proxies/${encodeURIComponent(original.id)}`, { method: 'PATCH', body, retry: 0 })
      open.value = false
      toast.add({ title: 'Proxy updated', description: updated.label, color: 'success' })
      emit('updated', updated)
    } catch (e) {
      submitError.value = errorState(e, 'Could not update the proxy')
    } finally {
      submitting.value = false
    }
    return
  }

  submitting.value = true
  try {
    // retry: 0 — exactly one POST per submit
    const created = await api<Proxy>('/proxies', { method: 'POST', body: createBody(event.data), retry: 0 })
    open.value = false
    toast.add({ title: 'Proxy added', description: created.label, color: 'success' })
    emit('created', created)
  } catch (e) {
    submitError.value = errorState(e, 'Could not add the proxy')
  } finally {
    submitting.value = false
  }
}

function errorState(e: unknown, fallback: string): { title: string, description?: string } {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  return {
    title: err.data?.error ?? err.message ?? fallback,
    description: issues && issues.length ? issues.join(' · ') : undefined
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? 'Edit proxy' : 'Add proxy'"
    :description="isEdit ? 'Changing a proxy does not touch profiles already created with it.' : 'Reusable on every browser profile of this workspace.'"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        ref="formRef"
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Label" name="label" required>
          <UInput
            v-model="state.label"
            placeholder="TH residential 1"
            class="w-full"
            :disabled="submitting"
            data-testid="px-form-label"
          />
        </UFormField>

        <div class="grid gap-4 sm:grid-cols-3">
          <UFormField label="Type" name="type" required>
            <USelect
              v-model="state.type"
              :items="TYPE_ITEMS"
              value-key="value"
              class="w-full"
              :disabled="submitting"
              data-testid="px-form-type"
            />
          </UFormField>

          <UFormField
            class="sm:col-span-2"
            label="Host"
            name="host"
            required
          >
            <UInput
              v-model="state.host"
              placeholder="10.0.0.9"
              autocomplete="off"
              class="w-full"
              :disabled="submitting"
              data-testid="px-form-host"
            />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Port" name="port" required>
            <!-- text + inputmode instead of type="number": a non-numeric value must reach the zod schema
                 (an `input[type=number]` silently drops it) so "Port must be a number" can be shown -->
            <UInput
              v-model="state.port"
              type="text"
              inputmode="numeric"
              placeholder="8080"
              class="w-full"
              :disabled="submitting"
              data-testid="px-form-port"
            />
          </UFormField>

          <UFormField label="Country" name="country" hint="Optional">
            <!-- no maxlength: a 3-letter value must reach the schema so "Country must be 2 letters" can be shown -->
            <UInput
              v-model="state.country"
              placeholder="TH"
              autocomplete="off"
              class="w-full"
              :disabled="submitting"
              data-testid="px-form-country"
              @blur="upperCaseCountry"
            />
          </UFormField>
        </div>

        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField label="Username" name="username" hint="Optional">
            <UInput
              v-model="state.username"
              autocomplete="off"
              placeholder="proxy user"
              class="w-full"
              :disabled="submitting"
              data-testid="px-form-username"
            />
          </UFormField>

          <UFormField label="Password" name="password" hint="Optional">
            <UInput
              v-model="state.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              :placeholder="isEdit ? 'Unchanged' : 'proxy password'"
              class="w-full"
              :ui="{ trailing: 'pe-1' }"
              :disabled="submitting || clearPassword"
              data-testid="px-form-password"
            >
              <template #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  :aria-pressed="showPassword"
                  :disabled="clearPassword"
                  data-testid="px-form-password-toggle"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>
        </div>

        <UCheckbox
          v-if="isEdit"
          v-model="clearPassword"
          label="Clear password"
          description="Send the proxy without credentials from now on."
          :disabled="submitting"
          data-testid="px-form-password-clear"
        />

        <UFormField label="Note" name="note" hint="Optional">
          <UTextarea
            v-model="state.note"
            :rows="2"
            placeholder="Where this proxy comes from, renewal date, …"
            class="w-full"
            :disabled="submitting"
            data-testid="px-form-note"
          />
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="px-form-error"
        />
      </UForm>
    </template>

    <!-- actions in the footer so they stay reachable while the body scrolls (390x844 with an error alert) -->
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="px-form-cancel"
          @click="open = false"
        />
        <UButton
          :label="isEdit ? 'Save changes' : 'Add proxy'"
          :icon="isEdit ? 'i-lucide-check' : 'i-lucide-plus'"
          color="primary"
          variant="solid"
          :loading="submitting"
          data-testid="px-form-submit"
          @click="formRef?.submit()"
        />
      </div>
    </template>
  </UModal>
</template>
