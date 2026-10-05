<script setup lang="ts">
/**
 * FEAT-006 — Default settings per admin (function 2.10; api-contract.md v1 `/browser-profile-defaults/me`).
 * On every open: exactly one `GET /backend/browser-profiles/options`, one `GET /backend/browser-profile-defaults/me`
 * and one `GET /backend/proxies?limit=100&sort=label`, issued concurrently (`useProfileSettings().load()`), skeleton
 * until all three resolved.
 * Save → `PUT …/me` with the full body → 200 → toast + badge "Saved" (the slideover stays open).
 * Reset to system default → `DELETE …/me` → 204 → one re-`GET …/me` → the form shows the system values again.
 * A 400 / 404 on save is shown in `bp-defaults-error` and every typed value is kept.
 * FEAT-027 v1.2 (BUG-030) — the saved default's proxy can be bound to another profile; the field then shows it by
 * label (never a raw id) with an "in use" hint (`bp-defaults-proxy-hint`), and Save keeps sending the unchanged id
 * (api-contract.md v1.2 §6: a 409 only fires when the id actually changed to a bound one).
 */
import type { SlideoverProps } from '@nuxt/ui'
import type { ProfileDefaults } from '#shared/types/browser-profiles'

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()
const settings = useProfileSettings()
const { options, defaults, form, loading, loaded, loadError, proxyItems, proxyDefaultHint } = settings

// FEAT-027 v1.2 (BUG-030) — shown under the Proxy field while it still holds a bound default
const proxyHint = computed(() => (proxyDefaultHint.value ? 'Default proxy in use by another profile.' : null))

const saving = ref(false)
const resetting = ref(false)
/** error of a Save / Reset call (the load error lives in `loadError`) */
const actionError = ref<string | null>(null)

const busy = computed(() => saving.value || resetting.value)
const sourceLabel = computed(() => defaults.value?.source === 'saved' ? 'Saved' : 'System default')
const errorText = computed(() => actionError.value ?? loadError.value)

// USlideover's root is renderless: `content` is v-bound onto the DialogContent element QA locates as
// `bp-defaults-slideover` (same trick as the FEAT-005 advertisers slideover).
const slideoverContent = computed(() => ({
  'data-testid': 'bp-defaults-slideover',
  'data-state': loading.value ? 'loading' : loadError.value ? 'error' : 'ready'
}) as SlideoverProps['content'])

watch(open, (isOpen) => {
  settings.reset()
  actionError.value = null
  saving.value = false
  resetting.value = false
  if (isOpen) void settings.load()
})

async function save() {
  if (busy.value || !loaded.value) return
  saving.value = true
  actionError.value = null
  try {
    // retry: 0 — exactly one PUT per click
    const view = await api<ProfileDefaults>('/browser-profile-defaults/me', { method: 'PUT', body: settings.settings(), retry: 0 })
    defaults.value = view
    settings.apply(view)
    toast.add({ title: 'Default settings saved', color: 'success' })
  } catch (e) {
    actionError.value = settings.messageOf(e, 'Could not save the default settings')
  } finally {
    saving.value = false
  }
}

async function resetToSystem() {
  if (busy.value || !loaded.value) return
  resetting.value = true
  actionError.value = null
  try {
    // retry: 0 — one DELETE, then exactly one re-GET of the defaults (not of options / proxies)
    await api('/browser-profile-defaults/me', { method: 'DELETE', retry: 0 })
    await settings.reloadDefaults()
    toast.add({ title: 'Reset to system default', color: 'success' })
  } catch (e) {
    actionError.value = settings.messageOf(e, 'Could not reset the default settings')
  } finally {
    resetting.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    title="Default settings"
    description="Prefilled into every profile you create"
    :dismissible="!busy"
    :ui="{ content: 'sm:max-w-xl', body: 'flex flex-col gap-4' }"
    :content="slideoverContent"
  >
    <template #body>
      <div v-if="loading" class="space-y-3" data-testid="bp-defaults-loading">
        <USkeleton v-for="n in 6" :key="n" class="h-12 w-full" />
      </div>

      <template v-else>
        <div v-if="loaded" class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="defaults?.source === 'saved' ? 'primary' : 'neutral'"
            variant="subtle"
            class="whitespace-nowrap"
            data-testid="bp-defaults-source"
            :data-source="defaults?.source ?? ''"
          >
            {{ sourceLabel }}
          </UBadge>
          <span v-if="defaults?.updatedAt" class="text-xs text-muted" :title="defaults.updatedAt">
            saved {{ new Date(defaults.updatedAt).toLocaleString() }}
          </span>
        </div>

        <UAlert
          v-if="errorText"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="errorText"
          role="alert"
          data-testid="bp-defaults-error"
        >
          <template v-if="loadError" #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="loading"
              data-testid="bp-defaults-retry"
              @click="settings.load()"
            />
          </template>
        </UAlert>

        <BrowserProfilesFingerprintFields
          v-if="loaded"
          v-model="form"
          test-id-prefix="bp-defaults"
          :options="options"
          :proxy-items="proxyItems"
          :proxy-hint="proxyHint"
          :group="defaults?.group ?? null"
          :disabled="busy"
        />
      </template>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton
          label="Close"
          color="neutral"
          variant="ghost"
          class="me-auto"
          :disabled="busy"
          data-testid="bp-defaults-close"
          @click="open = false"
        />
        <UButton
          label="Reset to system default"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="outline"
          :disabled="!loaded || saving"
          :loading="resetting"
          data-testid="bp-defaults-reset"
          @click="resetToSystem"
        />
        <UButton
          label="Save"
          icon="i-lucide-check"
          color="primary"
          :disabled="!loaded || resetting"
          :loading="saving"
          data-testid="bp-defaults-save"
          @click="save"
        />
      </div>
    </template>
  </USlideover>
</template>
