<script setup lang="ts">
/**
 * FEAT-003 — Add account modal (function 3.1). zod schema mirrors the API's `createTikTokAccountSchema`
 * (api-contract.md v1): email trim / lowercase / valid / ≤ 254, password 1..128, label ≤ 100 optional,
 * browserProfileId required. On every open: exactly one `GET /backend/browser-profiles/available` (no query, the API
 * syncs AdsPower + applies visibility) → picker of `status === 'free'` profiles. Submit → `POST /backend/tiktok-accounts`
 * → 201 → close + toast + `created`; 4xx → `UAlert` under the form with the API `error`, modal stays open.
 * The form (and the fetched list) is reset on close so the next open starts clean and refetches.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { AvailableProfile, AvailableResponse, ProviderErrorBody } from '#shared/types/browser-profiles'
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
  password: z.string({ error: 'Password is required' })
    .min(1, 'Password is required')
    .max(128, 'Password must be at most 128 characters'),
  label: z.string()
    .trim()
    .max(100, 'Label must be at most 100 characters')
    .optional(),
  browserProfileId: z.string({ error: 'Browser profile is required' })
    .min(1, 'Browser profile is required')
})

type Schema = z.output<typeof schema>

interface FormState {
  loginEmail: string
  password: string
  label: string
  browserProfileId: string | undefined
}

function emptyState(): FormState {
  return { loginEmail: '', password: '', label: '', browserProfileId: undefined }
}

const state = reactive<FormState>(emptyState())
const showPassword = ref(false)
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

function resetForm() {
  Object.assign(state, emptyState())
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
    .map(p => ({ id: p.id, label: p.name, description: `${p.providerProfileId} · ${p.groupName ?? '—'}` }))
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
async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  submitting.value = true
  submitError.value = null
  const body: CreateAccountBody = {
    loginEmail: event.data.loginEmail,
    password: event.data.password,
    browserProfileId: event.data.browserProfileId
  }
  if (event.data.label) body.label = event.data.label
  try {
    const account = await api<TikTokAccount>('/tiktok-accounts', { method: 'POST', body, retry: 0 })
    open.value = false
    toast.add({ title: 'Account added', description: account.loginEmail, color: 'success' })
    emit('created', account)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const apiError = err.data?.error
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
    submitError.value = {
      title: apiError ?? err.message ?? 'Could not add the account',
      description: issues && issues.length ? issues.join(' · ') : undefined
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

        <UFormField label="Password" name="password" required>
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
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
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

        <UFormField label="Browser profile" name="browserProfileId" required>
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
