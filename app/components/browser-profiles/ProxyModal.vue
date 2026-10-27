<script setup lang="ts">
/**
 * TASK-profile-proxy (functions 2.13, contract §1) — change the proxy of an **existing** browser profile.
 * Opened from the `bp-proxy-edit` row action of `/browser-profiles` for a profile that is created in AdsPower and
 * `closed` / `error` (AdsPower only applies `user_proxy_config` on the next launch). A **bound** profile is allowed —
 * re-pointing a profile whose proxy died is the main use case.
 * On every open: exactly one `GET /backend/proxies?free=1&limit=100&sort=label`
 * (`useProfileSettings({ loadOptions: false, loadDefaults: false })` — neither the fingerprint options nor the
 * admin's Default settings say anything about an existing profile). The field is the shared FEAT-028 radio
 * (`BrowserProfilesProxyModeField`, prefix `bp-proxy` → `bp-proxy-proxy-mode` / `bp-proxy-proxy`) and starts on
 * "Pick a free proxy" with an empty picker; Pick with nothing chosen is a form error (`PROXY_PICK_REQUIRED`) and
 * sends nothing.
 * Submit → **one** `POST /backend/browser-profiles/:id/proxy` with **exactly one** key (`proxyId` for Pick,
 * `proxyMode: 'auto' | 'none'`; sending `proxyId: null` next to a `proxyMode` is a 400) → 202
 * `{ jobId, proxyId, proxyRef }`: close + info toast + `requested` (the page watches the row until its
 * `proxyUpdating` is false again). Every error stays in the modal (`bp-proxy-error`): a 400 is the standard zod
 * envelope, so `issues[0].message` is shown, 404 / 409 / 500 carry their text in `error`; a 409 also asks the page
 * for a background re-read, because the state we based the button on is stale by then.
 * `bp-proxy-current` reads `proxyRef` before the provider `proxy` snapshot on purpose: from the 202 on, the API
 * already answers the **new** `proxyRef` while the snapshot is still the old one until the worker confirms.
 * FEAT-070 — also opened from the `ta-proxy-edit` action of `/tiktok-accounts` with the account's
 * `browserProfile`: the prop is the minimal `ProxyModalProfile` (`id, name, providerProfileId, proxyRef, proxy` —
 * the only fields read here), nothing else of the modal changed.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type {
  ProxyModalProfile,
  SetProfileProxyBody,
  SetProfileProxyErrorBody,
  SetProfileProxyResponse
} from '#shared/types/browser-profiles'

const props = defineProps<{
  /** the row the admin clicked; `null` while the modal was never opened */
  profile: ProxyModalProfile | null
}>()

const emit = defineEmits<{
  /** 202 — the page adds the id to `proxyChanging`, re-reads once and re-opens the `proxy` poll window */
  requested: [profileId: string]
  /** 409 — a precondition we could not see; the page re-reads in the background so the row state is current */
  refresh: []
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless → the testid goes on the rendered DialogContent (what QA locates as `bp-proxy-modal`)
const modalContent = { 'data-testid': 'bp-proxy-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()
// only the free-proxy list: no `/browser-profiles/options`, no `/browser-profile-defaults/me`
const settings = useProfileSettings({ loadOptions: false, loadDefaults: false })
const { form, loading, loaded, loadError, proxyItems, proxyPickMissing } = settings

const submitting = ref(false)
const submitError = ref<string | null>(null)
/** set by a submit attempt with "Pick a free proxy" selected and nothing picked; clears as soon as that is fixed */
const proxySubmitted = ref(false)
const proxyError = computed(() => (proxySubmitted.value && proxyPickMissing.value ? PROXY_PICK_REQUIRED : null))

const description = computed(() => {
  const p = props.profile
  if (!p) return ''
  return `${p.name} · ${p.providerProfileId ?? 'not created in AdsPower yet'}`
})

/** `bp-proxy-current`: the proxy row chosen in the BO wins over the provider snapshot, as in the table's Proxy column */
const currentProxy = computed(() => {
  const p = props.profile
  const picked = p?.proxyRef
  if (picked) return `Current: ${picked.label} (${picked.type} ${picked.host}:${picked.port})`
  const snapshot = formatProxySnapshot(p?.proxy ?? null)
  return `Current: ${snapshot ?? 'No proxy'}`
})

watch(open, (isOpen) => {
  settings.reset()
  submitError.value = null
  submitting.value = false
  proxySubmitted.value = false
  // the modal is about an existing profile: start on Pick with an empty picker (no default to prefill from)
  form.value.proxyMode = 'pick'
  form.value.proxyId = ''
  if (isOpen) void settings.load()
})

/**
 * The API text verbatim, plus the two pieces of a structured 409 that are not already in it.
 * A 400 is the standard zod envelope (`error: 'validation'` + `issues`) — show the first issue message instead of
 * the useless word "validation"; 404 / 409 / 500 carry a human text in `error`.
 */
function errorText(e: unknown): string {
  const err = e as FetchError<Partial<SetProfileProxyErrorBody>>
  const body = err.data
  const issue = body?.issues?.map(i => i.message).find(Boolean)
  let text = issue ?? body?.error ?? err.message ?? 'Could not change the proxy'
  if (body?.boundProfileName) text += ` · used by ${body.boundProfileName}`
  if (typeof body?.tried === 'number' && !text.includes(`tried ${body.tried}`)) text += ` (tried ${body.tried})`
  return text
}

async function onSubmit() {
  const p = props.profile
  if (!p || submitting.value || !loaded.value) return
  // "Pick a free proxy" without a proxy is a form error, not a request
  if (proxyPickMissing.value) {
    proxySubmitted.value = true
    return
  }
  submitting.value = true
  submitError.value = null
  // exactly one key — `proxyId` for Pick, `proxyMode` for Auto / No proxy (same helper as the create forms)
  const body: SetProfileProxyBody = settings.proxyChoice()
  try {
    // retry: 0 — one POST per click; a retry would queue a second `provider{setProxy}` job (the API 409s on it)
    await api<SetProfileProxyResponse>(`/browser-profiles/${encodeURIComponent(p.id)}/proxy`, {
      method: 'POST',
      body,
      retry: 0
    })
    open.value = false
    toast.add({
      title: 'Proxy change requested',
      description: `${p.name} · the node applies it in a moment`,
      color: 'info'
    })
    emit('requested', p.id)
  } catch (e) {
    const err = e as FetchError<Partial<SetProfileProxyErrorBody>>
    submitError.value = errorText(e)
    // 409 = a precondition the row we clicked did not show (lock, a job that just started, a proxy just claimed)
    if ((err.response?.status ?? err.statusCode) === 409) emit('refresh')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Change proxy"
    :description="description"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm break-words text-muted" data-testid="bp-proxy-current">
          {{ currentProxy }}
        </p>

        <div v-if="loading" class="space-y-3" data-testid="bp-proxy-loading">
          <USkeleton v-for="n in 2" :key="n" class="h-10 w-full" />
        </div>

        <BrowserProfilesProxyModeField
          v-else-if="loaded"
          v-model:proxy-mode="form.proxyMode"
          v-model:proxy-id="form.proxyId"
          test-id-prefix="bp-proxy"
          :pick="true"
          :proxy-items="proxyItems"
          :error="proxyError"
          :disabled="submitting"
        />

        <p class="text-xs text-muted">
          AdsPower applies the new proxy the next time this profile is opened.
        </p>

        <UAlert
          v-if="submitError || loadError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError ?? loadError ?? ''"
          role="alert"
          data-testid="bp-proxy-error"
        >
          <template v-if="!submitError && loadError" #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="loading"
              data-testid="bp-proxy-retry"
              @click="settings.load()"
            />
          </template>
        </UAlert>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="bp-proxy-cancel"
          @click="open = false"
        />
        <UButton
          label="Apply"
          icon="i-lucide-network"
          color="primary"
          variant="solid"
          :disabled="!loaded"
          :loading="submitting"
          data-testid="bp-proxy-submit"
          @click="onSubmit"
        />
      </div>
    </template>
  </UModal>
</template>
