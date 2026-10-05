<script setup lang="ts">
/**
 * FEAT-006 — Create profile (function 2.3; api-contract.md v1 `POST /browser-profiles/create`).
 * On every open: exactly one `GET /backend/browser-profiles/options`, one `GET /backend/browser-profile-defaults/me`
 * and one `GET /backend/proxies?limit=100&sort=label`, concurrently; the fields are prefilled from the defaults and
 * can be overridden for this one profile (the admin's saved defaults are not touched).
 * Submit → `POST /backend/browser-profiles/create` with the **full body**
 * `{ name, browser: { kernel: 'chrome', version }, os, webrtc, hardwareNoise, proxyId }` → 201 → close + toast +
 * `created` (the page re-requests `/browser-profiles/available` once).
 * 400 / 404 / 422 / 429 / 502 / 500 → `bp-create-error` with the API `error` text (500 also shows the
 * `providerProfileId` the provider created), the modal stays open and every typed value is kept.
 * FEAT-007 — the description (`bp-create-description`, rendered through UModal's `#description` slot so QA has a
 * precise locator) names the one configured AdsPower group (or "ungrouped") and the tag the API will derive
 * server-side (`ADMINS.username`); the create body never carries a group or a tag key.
 * FEAT-027 — the proxy picker (`useProfileSettings`) now only lists **free** proxies (`?free=1`); an explicit bound
 * `proxyId` cannot reach this form, but the caller's *default* proxy can still be bound to another profile meanwhile
 * (AS-1) — the 201 body then carries `proxyWarning`, shown as a separate warning toast after the success toast.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { CreatedProfile, CreateProfileBody, CreateProfileErrorBody } from '#shared/types/browser-profiles'

const emit = defineEmits<{
  created: [profile: CreatedProfile]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `bp-create-modal`).
const modalContent = { 'data-testid': 'bp-create-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()
const settings = useProfileSettings()
const { options, defaults, form, loading, loaded, loadError, proxyItems } = settings

const schema = z.object({
  name: z.string({ error: 'Name is required' })
    .trim()
    .min(1, 'Name is required')
    .max(100, 'Name must be at most 100 characters')
})

type Schema = z.output<typeof schema>

// the Create button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

const state = reactive<{ name: string }>({ name: '' })
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

const groupName = computed(() => defaults.value?.group.name ?? null)
const tag = computed(() => defaults.value?.group.tag ?? '')
const description = computed(() =>
  groupName.value
    ? `Created in AdsPower group ${groupName.value} · tagged ${tag.value}`
    : `Created ungrouped in AdsPower · tagged ${tag.value}`
)

watch(open, (isOpen) => {
  settings.reset()
  state.name = ''
  submitError.value = null
  submitting.value = false
  if (isOpen) void settings.load()
})

function errorState(e: unknown): { title: string, description?: string } {
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

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value || !loaded.value) return
  submitting.value = true
  submitError.value = null
  const body: CreateProfileBody = { name: event.data.name, ...settings.settings() }
  try {
    // retry: 0 — exactly one POST per click (a retry would create a second profile in the provider)
    const profile = await api<CreatedProfile>('/browser-profiles/create', { method: 'POST', body, retry: 0 })
    open.value = false
    toast.add({ title: 'Profile created', description: profile.name, color: 'success' })
    // FEAT-027 AS-1: the default proxy was bound to another profile — created without one, surfaced as a warning
    if (profile.proxyWarning) toast.add({ title: profile.proxyWarning, color: 'warning', icon: 'i-lucide-triangle-alert' })
    emit('created', profile)
  } catch (e) {
    submitError.value = errorState(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Create profile"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-xl' }"
    :content="modalContent"
  >
    <template #description>
      <span data-testid="bp-create-description">{{ description }}</span>
    </template>

    <template #body>
      <div v-if="loading" class="space-y-3" data-testid="bp-create-loading">
        <USkeleton v-for="n in 6" :key="n" class="h-12 w-full" />
      </div>

      <UForm
        v-else
        ref="formRef"
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
      >
        <UFormField label="Name" name="name" required>
          <UInput
            v-model="state.name"
            autofocus
            autocomplete="off"
            placeholder="shop-03"
            class="w-full"
            :disabled="submitting"
            data-testid="bp-create-name"
          />
        </UFormField>

        <BrowserProfilesFingerprintFields
          v-if="loaded"
          v-model="form"
          test-id-prefix="bp-create"
          :options="options"
          :proxy-items="proxyItems"
          :group="defaults?.group ?? null"
          :disabled="submitting"
        />

        <UAlert
          v-if="submitError || loadError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError?.title ?? loadError ?? ''"
          :description="submitError?.description"
          role="alert"
          data-testid="bp-create-error"
        >
          <template v-if="!submitError && loadError" #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="loading"
              data-testid="bp-create-retry"
              @click="settings.load()"
            />
          </template>
        </UAlert>
      </UForm>
    </template>

    <!-- the form is long: the actions live in the modal footer so they stay reachable while the body scrolls
         (390x844 shows ~2/3 of the field set) -->
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="bp-create-cancel"
          @click="open = false"
        />
        <UButton
          label="Create"
          icon="i-lucide-plus"
          color="primary"
          variant="solid"
          :disabled="!loaded"
          :loading="submitting"
          data-testid="bp-create-submit"
          @click="formRef?.submit()"
        />
      </div>
    </template>
  </UModal>
</template>
