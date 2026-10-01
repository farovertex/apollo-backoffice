<script setup lang="ts">
/**
 * FEAT-003 — Add account modal (function 3.1). zod schema mirrors the API's `createTikTokAccountSchema`
 * (api-contract.md v1): email trim / lowercase / valid / ≤ 254, password 1..128, label ≤ 100 optional.
 * Browser profile: pick a free profile, or check "Create new profile automatically". That path sends
 * `POST /browser-profiles/create` with only `{ name }` — omitted fingerprint and proxy fields use the caller's
 * saved defaults — then binds the new id. On every open: exactly one `GET /backend/browser-profiles/available`
 * (no query, the API syncs AdsPower + applies visibility) → picker of `status === 'free'` profiles, shown only
 * while automatic create is off. Submit → `POST /backend/tiktok-accounts` → 201 → close + toast + `created`;
 * 4xx → `UAlert` under the form with the API `error`, modal stays open. If the profile was created but the
 * account request failed, automatic create turns off and that profile is selected so a retry does not create
 * a second one. The form (and the fetched list) is reset on close so the next open starts clean and refetches.
 * FEAT-023 (api-contract.md v1 §4): two passwords — **Email password** (`emailPassword`, the mailbox) and
 * **TikTok password** (`password`) — plus the **Auto first login** checkbox (`pendingFirstLogin`, default true).
 * The flag only marks the account; the create call never enqueues a login, the scheduler picks it up.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { AvailableProfile, AvailableResponse, CreatedProfile, CreateProfileErrorBody, ProviderErrorBody } from '#shared/types/browser-profiles'
import type { ApiErrorBody } from '#shared/types/auth'
import type { CreateAccountBody, TikTokAccount } from '#shared/types/tiktok-accounts'

const emit = defineEmits<{
  created: [account: TikTokAccount]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-add-modal`).
const modalContent = { 'data-testid': 'ta-add-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

// ── form ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const schema = z.object({
  loginEmail: z.string({ error: 'Login email is required' })
    .trim()
    .toLowerCase()
    .min(1, 'Login email is required')
    .max(254, 'Login email must be at most 254 characters')
    .pipe(z.email('Enter a valid email address')),
  emailPassword: z.string({ error: 'Email password is required' })
    .min(1, 'Email password is required')
    .max(128, 'Email password must be at most 128 characters'),
  password: z.string({ error: 'TikTok password is required' })
    .min(1, 'TikTok password is required')
    .max(128, 'TikTok password must be at most 128 characters'),
  label: z.string()
    .trim()
    .max(100, 'Label must be at most 100 characters')
    .optional(),
  pendingFirstLogin: z.boolean(),
  createProfile: z.boolean(),
  browserProfileId: z.string().optional()
}).superRefine((data, ctx) => {
  if (!data.createProfile && !data.browserProfileId) {
    ctx.addIssue({
      code: 'custom',
      path: ['browserProfileId'],
      message: 'Browser profile is required'
    })
  }
})

type Schema = z.output<typeof schema>

interface FormState {
  loginEmail: string
  emailPassword: string
  password: string
  label: string
  pendingFirstLogin: boolean
  createProfile: boolean
  browserProfileId: string | undefined
}

function emptyState(): FormState {
  return {
    loginEmail: '',
    emailPassword: '',
    password: '',
    label: '',
    pendingFirstLogin: true,
    createProfile: true,
    browserProfileId: undefined
  }
}

const state = reactive<FormState>(emptyState())
// one toggle per password field; both start masked on every open
const showEmailPassword = ref(false)
const showPassword = ref(false)
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

function resetForm() {
  Object.assign(state, emptyState())
  showEmailPassword.value = false
  showPassword.value = false
  submitting.value = false
  submitError.value = null
}

// ── free-profile picker ──────────────────────────────────────────────────────────────────────────────────────────────
interface ProfileItem {
  id: string
  label: string
  description: string
}

const profiles = ref<AvailableProfile[]>([])
const profilesPending = ref(false)
const profilesError = ref<{ title: string, description?: string } | null>(null)
const profilesLoaded = ref(false)
// guards against a slow response from a previous open landing after close / reopen
let loadSeq = 0

const freeProfiles = computed<ProfileItem[]>(() =>
  profiles.value
    .filter(p => p.status === 'free')
    // FEAT-024: a free profile may still be reserved (`providerProfileId: null`) — it is bindable, just not created yet
    .map(p => ({ id: p.id, label: p.name, description: `${p.providerProfileId ?? '—'} · ${p.groupName ?? '—'}` }))
)
const noFreeProfile = computed(() => profilesLoaded.value && !profilesError.value && freeProfiles.value.length === 0)
const pickerDisabled = computed(() => profilesPending.value || !!profilesError.value || noFreeProfile.value)

// Same mapping as /browser-profiles (FEAT-002): 503 unreachable · 429 busy · 502 provider error (+ body text).
function providerErrorState(err: FetchError<Partial<ProviderErrorBody>>): { title: string, description?: string } {
  switch (err.statusCode) {
    case 503:
      return { title: 'AdsPower is not reachable. Is the AdsPower app running?' }
    case 429:
      return { title: 'AdsPower is busy, try again in a moment' }
    case 502:
      return { title: 'AdsPower returned an error', description: err.data?.error }
    default:
      return { title: 'Could not load browser profiles', description: err.data?.error }
  }
}

async function loadProfiles() {
  const seq = ++loadSeq
  profilesPending.value = true
  profilesError.value = null
  try {
    // retry: 0 — one request per open (ofetch would otherwise re-issue the GET on 429/502/503)
    const res = await api<AvailableResponse>('/browser-profiles/available', { retry: 0 })
    if (seq !== loadSeq) return
    profiles.value = res.profiles ?? []
    profilesLoaded.value = true
  } catch (e) {
    if (seq !== loadSeq) return
    profiles.value = []
    profilesLoaded.value = false
    profilesError.value = providerErrorState(e as FetchError<Partial<ProviderErrorBody>>)
  } finally {
    if (seq === loadSeq) profilesPending.value = false
  }
}

function resetProfiles() {
  loadSeq++
  profiles.value = []
  profilesPending.value = false
  profilesError.value = null
  profilesLoaded.value = false
}

watch(open, (isOpen) => {
  if (isOpen) {
    resetForm()
    loadProfiles()
  } else {
    resetForm()
    resetProfiles()
  }
})

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
function accountErrorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  return {
    title: err.data?.error ?? err.message ?? 'Could not add the account',
    description: issues && issues.length ? issues.join(' · ') : undefined
  }
}

function profileErrorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<CreateProfileErrorBody>>
  const body = err.data
  const issues = body?.issues?.map(i => i.message).filter(Boolean)
  const parts: string[] = []
  if (issues && issues.length) parts.push(issues.join(' · '))
  if (body?.providerProfileId) parts.push(`providerProfileId: ${body.providerProfileId}`)
  return {
    title: body?.error ?? err.message ?? 'Could not create the profile',
    description: parts.length ? parts.join(' — ') : undefined
  }
}

/** AdsPower name limit. The login email is the profile name so the new profile is findable next to the account. */
function profileNameFromEmail(loginEmail: string): string {
  return loginEmail.slice(0, 100)
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  submitting.value = true
  submitError.value = null

  let browserProfileId = event.data.browserProfileId
  let createdProfile: CreatedProfile | null = null
  if (event.data.createProfile) {
    const name = profileNameFromEmail(event.data.loginEmail)
    try {
      // retry: 0 — exactly one POST (a retry would create a second profile in the provider)
      createdProfile = await api<CreatedProfile>('/browser-profiles/create', {
        method: 'POST',
        body: { name },
        retry: 0
      })
      browserProfileId = createdProfile.id
    } catch (e) {
      submitError.value = profileErrorState(e)
      submitting.value = false
      return
    }
  }
  if (!browserProfileId) {
    submitting.value = false
    return
  }

  const body: CreateAccountBody = {
    loginEmail: event.data.loginEmail,
    password: event.data.password,
    emailPassword: event.data.emailPassword,
    browserProfileId,
    pendingFirstLogin: event.data.pendingFirstLogin
  }
  if (event.data.label) body.label = event.data.label
  try {
    const account = await api<TikTokAccount>('/tiktok-accounts', { method: 'POST', body, retry: 0 })
    open.value = false
    toast.add({ title: 'Account added', description: account.loginEmail, color: 'success' })
    emit('created', account)
  } catch (e) {
    const accountError = accountErrorState(e)
    if (createdProfile) {
      const profile = createdProfile
      profiles.value = [profile, ...profiles.value.filter(p => p.id !== profile.id)]
      profilesLoaded.value = true
      state.createProfile = false
      state.browserProfileId = profile.id
      const kept = `Profile "${profile.name}" was created and is selected below. Submit again to bind it.`
      submitError.value = {
        title: accountError.title,
        description: accountError.description ? `${accountError.description} · ${kept}` : kept
      }
    } else {
      submitError.value = accountError
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Add TikTok account"
    description="Bind a TikTok Ads login to a free AdsPower browser profile."
    :dismissible="!submitting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Login email" name="loginEmail" required>
          <UInput
            v-model="state.loginEmail"
            type="email"
            autocomplete="off"
            placeholder="ads@example.com"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-add-email"
          />
        </UFormField>

        <UFormField label="Email password" name="emailPassword" required>
          <UInput
            v-model="state.emailPassword"
            :type="showEmailPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="Mailbox password of the login email"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
            :disabled="submitting"
            data-testid="ta-add-email-password"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showEmailPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showEmailPassword ? 'Hide email password' : 'Show email password'"
                :aria-pressed="showEmailPassword"
                data-testid="ta-add-email-password-toggle"
                @click="showEmailPassword = !showEmailPassword"
              />
            </template>
          </UInput>
        </UFormField>

        <UFormField label="TikTok password" name="password" required>
          <UInput
            v-model="state.password"
            :type="showPassword ? 'text' : 'password'"
            autocomplete="new-password"
            placeholder="TikTok Ads password"
            class="w-full"
            :ui="{ trailing: 'pe-1' }"
            :disabled="submitting"
            data-testid="ta-add-password"
          >
            <template #trailing>
              <UButton
                color="neutral"
                variant="link"
                size="sm"
                :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                :aria-label="showPassword ? 'Hide TikTok password' : 'Show TikTok password'"
                :aria-pressed="showPassword"
                data-testid="ta-add-password-toggle"
                @click="showPassword = !showPassword"
              />
            </template>
          </UInput>
        </UFormField>

        <UFormField label="Label" name="label" hint="Optional">
          <UInput
            v-model="state.label"
            placeholder="Shop A"
            class="w-full"
            :disabled="submitting"
            data-testid="ta-add-label"
          />
        </UFormField>

        <UCheckbox
          v-model="state.pendingFirstLogin"
          label="Auto first login"
          :disabled="submitting"
          data-testid="ta-add-pending"
        >
          <template #description>
            <span data-testid="ta-add-pending-helper">{{ AUTO_FIRST_LOGIN_HELP }}</span>
          </template>
        </UCheckbox>

        <UCheckbox
          v-model="state.createProfile"
          label="Create new profile automatically"
          description="Uses your saved browser profile defaults. The profile is named after the login email."
          :disabled="submitting"
          data-testid="ta-add-create-profile"
        />

        <UFormField
          v-if="!state.createProfile"
          label="Browser profile"
          name="browserProfileId"
          required
        >
          <USelectMenu
            v-model="state.browserProfileId"
            :items="freeProfiles"
            value-key="id"
            :filter-fields="['label', 'description']"
            :search-input="{ placeholder: 'Search name, profile id or group' }"
            :loading="profilesPending"
            :disabled="pickerDisabled || submitting"
            :placeholder="profilesPending ? 'Loading free profiles…' : 'Select a free profile'"
            icon="i-lucide-app-window"
            class="w-full"
            data-testid="ta-add-profile"
          />
        </UFormField>

        <template v-if="!state.createProfile">
          <UAlert
            v-if="profilesError"
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="profilesError.title"
            :description="profilesError.description"
            data-testid="ta-add-profile-error"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="error"
                variant="solid"
                size="xs"
                :loading="profilesPending"
                data-testid="ta-add-profile-retry"
                @click="loadProfiles"
              />
            </template>
          </UAlert>

          <UAlert
            v-else-if="noFreeProfile"
            color="warning"
            variant="subtle"
            icon="i-lucide-app-window"
            title="No free browser profile. Create one in AdsPower and retry."
            data-testid="ta-add-profile-empty"
          >
            <template #actions>
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="warning"
                variant="solid"
                size="xs"
                :loading="profilesPending"
                data-testid="ta-add-profile-retry"
                @click="loadProfiles"
              />
            </template>
          </UAlert>
        </template>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="ta-add-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-add-cancel"
            @click="open = false"
          />
          <UButton
            label="Add account"
            icon="i-lucide-plus"
            color="primary"
            variant="solid"
            type="submit"
            :loading="submitting"
            data-testid="ta-add-submit"
          />
        </div>
      </UForm>
    </template>
  </UModal>
</template>
