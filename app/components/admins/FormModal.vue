<script setup lang="ts">
/**
 * FEAT-009 — Create / Edit admin (api-contract.md v1 `POST /admins`, `PATCH /admins/:id`).
 *
 * One component for both modes: `admin === null` → create (username + display name + password block + roles,
 * `POST` with `{ username, displayName, password, roles }` — the confirm field never leaves the browser); an
 * admin → edit (username read-only, no password block, `PATCH` with **only the changed keys**; nothing changed
 * → no request at all).
 *
 * Roles are three checkboxes and are always emitted in the fixed order `Admin, GOD, Payment`, which is also the
 * order they are rendered in (api-contract.md accepts any order; a fixed one makes the body assertable).
 * A GOD editing themself cannot untick GOD (the API answers 409 — the checkbox is disabled and explains why).
 *
 * Server messages live in a component-owned `serverErrors` map bound to each `UFormField :error` (FEAT-008
 * BUG-007: `UForm.setErrors()` is wiped by the validate-on-input debounce 300 ms after the last keystroke).
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { AdminRole, ApiErrorBody } from '#shared/types/auth'
import type { AdminListItem, AdminView, CreateAdminBody, UpdateAdminBody } from '#shared/types/admins'

const props = defineProps<{
  /** null = create, a row = edit */
  admin: AdminListItem | null
  /** id of the logged-in admin — on their own row the GOD checkbox is locked */
  currentAdminId: string | null
}>()

const emit = defineEmits<{
  created: [admin: AdminView]
  updated: [admin: AdminView]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `adm-form-modal`).
const modalContent = { 'data-testid': 'adm-form-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const isEdit = computed(() => props.admin !== null)
/** a GOD editing their own row: the API refuses to remove GOD from the actor (409) */
const selfGodLocked = computed(() => isEdit.value && props.admin?.id === props.currentAdminId)

interface RolesState {
  admin: boolean
  god: boolean
  payment: boolean
}

interface FormState {
  username: string
  displayName: string
  password: string
  passwordConfirm: string
  roles: RolesState
}

function rolesStateFrom(roles: AdminRole[] | undefined): RolesState {
  return {
    // Admin is the default role of a new admin (api-contract.md `roles?` default `['Admin']`)
    admin: roles ? roles.includes('Admin') : true,
    god: roles?.includes('GOD') ?? false,
    payment: roles?.includes('Payment') ?? false
  }
}

function stateFrom(admin: AdminListItem | null): FormState {
  return {
    username: admin?.username ?? '',
    displayName: admin?.displayName ?? '',
    password: '',
    passwordConfirm: '',
    roles: rolesStateFrom(admin?.roles)
  }
}

const state = reactive<FormState>(stateFrom(null))
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)
const serverErrors = ref<Record<string, string>>({})
const passwordFields = useTemplateRef('passwordFields')

function clearServerErrors() {
  serverErrors.value = {}
}

// any edit invalidates what the server said about the form
watch(state, clearServerErrors, { deep: true })

// the submit button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

function resetForm() {
  Object.assign(state, stateFrom(props.admin))
  submitting.value = false
  submitError.value = null
  clearServerErrors()
  formRef.value?.clear()
  passwordFields.value?.reset()
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})

/** the roles as the API wants them — always in the fixed order Admin, GOD, Payment */
const selectedRoles = computed<AdminRole[]>(() => {
  const roles: AdminRole[] = []
  if (state.roles.admin) roles.push('Admin')
  if (state.roles.god) roles.push('GOD')
  if (state.roles.payment) roles.push('Payment')
  return roles
})

/** inline message under the checkbox row: the server's message wins, otherwise the "at least one" rule */
const rolesError = computed<string | undefined>(() =>
  serverErrors.value.roles ?? (selectedRoles.value.length === 0 ? 'Select at least one role' : undefined)
)

function lowercaseUsername() {
  state.username = state.username.trim().toLowerCase()
}

// ── validation (mirrors the API's usernameSchema / passwordSchema; an invalid form never reaches the network) ────────
const USERNAME_RE = /^[a-z0-9_.-]+$/

const usernameSchema = z.string()
  .trim()
  .min(1, 'Username is required')
  .min(3, 'Username must be at least 3 characters')
  .max(32, 'Username must be at most 32 characters')
  .regex(USERNAME_RE, 'Username can contain only a-z, 0-9, dot, underscore and hyphen')

const displayNameSchema = z.string()
  .trim()
  .min(1, 'Display name is required')
  .max(80, 'Display name must be at most 80 characters')

const passwordSchema = z.string()
  .min(1, 'Password is required')
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')

/** in edit mode the username is read-only and there is no password block — those fields are not validated */
function makeSchema(edit: boolean) {
  return z.object({
    username: edit ? z.string() : usernameSchema,
    displayName: displayNameSchema,
    password: edit ? z.string() : passwordSchema,
    passwordConfirm: z.string()
  }).superRefine((data, ctx) => {
    if (edit) return
    if (data.passwordConfirm === '') {
      ctx.addIssue({ code: 'custom', path: ['passwordConfirm'], message: 'Confirm the password' })
    } else if (data.passwordConfirm !== data.password) {
      ctx.addIssue({ code: 'custom', path: ['passwordConfirm'], message: 'Passwords do not match' })
    }
  })
}

type Schema = z.output<ReturnType<typeof makeSchema>>

const schema = computed(() => makeSchema(isEdit.value))

// ── API errors → the right field ─────────────────────────────────────────────────────────────────────────────────────
const FIELD_NAMES = new Set(['username', 'displayName', 'password', 'roles'])

function showApiError(e: unknown, fallback: string, usernameConflict: boolean) {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const status = err.response?.status ?? err.statusCode
  const data = err.data

  // create: a 409 is always "username already used" → show it on the username field
  if (status === 409 && usernameConflict) {
    serverErrors.value.username = data?.error ?? 'Username already used'
    return
  }

  const issues = data?.issues ?? []
  if (issues.length) {
    const unmatched: { path: string, message: string }[] = []
    for (const issue of issues) {
      if (FIELD_NAMES.has(issue.path)) serverErrors.value[issue.path] = issue.message
      else unmatched.push(issue)
    }
    if (unmatched.length) {
      submitError.value = {
        title: data?.error ?? fallback,
        description: unmatched.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ')
      }
    }
    return
  }

  submitError.value = { title: data?.error ?? err.message ?? fallback }
}

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function sameRoles(a: AdminRole[], b: AdminRole[]): boolean {
  if (a.length !== b.length) return false
  const sorted = [...b].sort()
  return [...a].sort().every((role, index) => role === sorted[index])
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  // the roles rule lives outside the zod schema (its message renders under the checkbox row, not in a UFormField)
  if (selectedRoles.value.length === 0) return

  submitError.value = null
  clearServerErrors()

  const original = props.admin
  const displayName = event.data.displayName.trim()

  if (original) {
    const body: UpdateAdminBody = {}
    if (displayName !== original.displayName) body.displayName = displayName
    if (!sameRoles(selectedRoles.value, original.roles)) body.roles = selectedRoles.value

    if (Object.keys(body).length === 0) {
      // nothing to send — the API would answer 400 on an empty body
      open.value = false
      return
    }

    submitting.value = true
    try {
      // retry: 0 — exactly one PATCH per submit
      const updated = await api<AdminView>(`/admins/${encodeURIComponent(original.id)}`, {
        method: 'PATCH',
        body,
        retry: 0
      })
      open.value = false
      toast.add({ title: 'Admin updated', description: original.username, color: 'success' })
      emit('updated', updated)
    } catch (e) {
      showApiError(e, 'Could not update the admin', false)
    } finally {
      submitting.value = false
    }
    return
  }

  const body: CreateAdminBody = {
    username: event.data.username.trim().toLowerCase(),
    displayName,
    password: event.data.password,
    roles: selectedRoles.value
  }

  submitting.value = true
  try {
    // retry: 0 — exactly one POST per submit
    const created = await api<AdminView>('/admins', { method: 'POST', body, retry: 0 })
    open.value = false
    toast.add({ title: 'Admin created', description: body.username, color: 'success' })
    emit('created', created)
  } catch (e) {
    showApiError(e, 'Could not create the admin', true)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? 'Edit admin' : 'Create admin'"
    :description="isEdit ? 'The username cannot be changed.' : 'The password is shown only while this dialog is open.'"
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
        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="adm-form-error"
        />

        <UFormField
          label="Username"
          name="username"
          required
          :error="serverErrors['username']"
          :help="isEdit ? 'The username cannot be changed.' : 'Lowercase letters, digits, dot, underscore and hyphen.'"
        >
          <UInput
            v-model="state.username"
            placeholder="qa.new.admin"
            class="w-full font-mono"
            autocomplete="off"
            :disabled="isEdit || submitting"
            data-testid="adm-form-username"
            @blur="lowercaseUsername"
          />
        </UFormField>

        <UFormField
          label="Display name"
          name="displayName"
          required
          :error="serverErrors['displayName']"
        >
          <UInput
            v-model="state.displayName"
            placeholder="QA New"
            class="w-full"
            :disabled="submitting"
            data-testid="adm-form-display-name"
          />
        </UFormField>

        <AdminsPasswordFields
          v-if="!isEdit"
          ref="passwordFields"
          v-model:password="state.password"
          v-model:confirm="state.passwordConfirm"
          prefix="adm-form"
          :disabled="submitting"
          :password-error="serverErrors['password']"
        />

        <div class="space-y-1.5">
          <p class="text-sm font-medium text-default">
            Roles <span class="text-error">*</span>
          </p>
          <div class="flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="adm-form-roles">
            <UCheckbox
              v-model="state.roles.admin"
              label="Admin"
              :disabled="submitting"
              data-testid="adm-form-role-admin"
            />
            <UCheckbox
              v-model="state.roles.god"
              label="GOD"
              :disabled="submitting || selfGodLocked"
              :aria-disabled="selfGodLocked ? 'true' : undefined"
              data-testid="adm-form-role-god"
            />
            <UCheckbox
              v-model="state.roles.payment"
              label="Payment"
              :disabled="submitting"
              data-testid="adm-form-role-payment"
            />
          </div>
          <p
            v-if="selfGodLocked"
            class="text-xs text-muted"
            data-testid="adm-form-self-god-hint"
          >
            You cannot remove your own GOD role
          </p>
          <p
            v-if="rolesError"
            class="text-xs text-error"
            data-testid="adm-form-roles-error"
          >
            {{ rolesError }}
          </p>
        </div>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="adm-form-cancel"
          @click="open = false"
        />
        <UButton
          :label="isEdit ? 'Save' : 'Create'"
          color="primary"
          :loading="submitting"
          data-testid="adm-form-submit"
          @click="formRef?.submit()"
        />
      </div>
    </template>
  </UModal>
</template>
