<script setup lang="ts">
/**
 * FEAT-006 — the fingerprint field set shared by the Default settings slideover (`bp-defaults-*`) and the Create
 * profile modal (`bp-create-*`); the prefix comes from `testIdPrefix`.
 * Every list is rendered from `GET /browser-profiles/options` — the BO hard-codes no browser version, OS, WebRTC
 * mode, CPU or RAM value. While "Hardware noise" is off, Audio / CPU / RAM are disabled but keep their values
 * (the API stores them so re-enabling the switch restores the choice — spec assumption A4).
 * FEAT-007 — the "AdsPower group" field is now two read-only values: Group (= `group.name`, or the literal
 * "Ungrouped" when null) and Tag (= `group.tag`, the caller's username, rendered as a badge). The FEAT-006
 * "Will be created on first profile" / "Exists" badge is removed — there is no per-admin group left to create.
 * FEAT-027 v1.2 (BUG-030) — `proxyHint` (built by the caller from `useProfileSettings().proxyDefaultHint`) renders
 * under the Proxy field as `${testIdPrefix}-proxy-hint` while it still holds a bound default; null hides it.
 */
import type { SelectMenuItem } from '@nuxt/ui'
import type { ProfileDefaultsGroup, ProfileOptions } from '#shared/types/browser-profiles'
import type { FingerprintForm } from '~/composables/useProfileSettings'

const props = defineProps<{
  /** `bp-defaults` or `bp-create` */
  testIdPrefix: string
  options: ProfileOptions | null
  /** "No proxy" + the proxies grouped by workspace (built by `useProfileSettings`) */
  proxyItems: SelectMenuItem[]
  /** FEAT-027 v1.2 (BUG-030) — "in use" hint while the field holds a bound default; null = no hint */
  proxyHint?: string | null
  /** the one configured AdsPower group (or null = Ungrouped) + the caller's display-only tag */
  group: ProfileDefaultsGroup | null
  disabled?: boolean
}>()

const model = defineModel<FingerprintForm>({ required: true })

/** writable computed per key so the child never mutates the parent's object in place */
function field<K extends keyof FingerprintForm>(key: K) {
  return computed<FingerprintForm[K]>({
    get: () => model.value[key],
    set: value => (model.value = { ...model.value, [key]: value })
  })
}

const version = field('version')
const os = field('os')
const webrtc = field('webrtc')
const noise = field('noise')
const audio = field('audio')
const cpu = field('cpu')
const ram = field('ram')
const proxyId = field('proxyId')

/** `ua_auto` is the only value with a friendlier label; every other version is shown exactly as the API sends it */
const versionItems = computed(() =>
  (props.options?.browserVersions ?? []).map(v => ({ label: v === 'ua_auto' ? 'Auto (latest)' : v, value: v }))
)

const noiseOff = computed(() => !model.value.noise)
const subDisabled = computed(() => props.disabled || noiseOff.value)
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="Browser version" :name="`${testIdPrefix}-version`">
        <USelect
          v-model="version"
          :items="versionItems"
          value-key="value"
          class="w-full"
          :disabled="disabled"
          :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
          :data-testid="`${testIdPrefix}-version`"
        />
      </UFormField>

      <UFormField label="WebRTC" :name="`${testIdPrefix}-webrtc`">
        <USelect
          v-model="webrtc"
          :items="options?.webrtc ?? []"
          class="w-full"
          :disabled="disabled"
          :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
          :data-testid="`${testIdPrefix}-webrtc`"
        />
      </UFormField>
    </div>

    <UFormField label="Operating system" :name="`${testIdPrefix}-os`">
      <!-- default variant on purpose: it renders `<label :for>` per option, so each `role=radio` keeps the option
           value ("Windows" / "Mac OS X" / "Linux") as its accessible name -->
      <URadioGroup
        v-model="os"
        :items="options?.os ?? []"
        orientation="horizontal"
        :disabled="disabled"
        :ui="{ fieldset: 'flex-wrap gap-x-5 gap-y-2' }"
        :data-testid="`${testIdPrefix}-os`"
      />
    </UFormField>

    <div class="flex flex-col gap-3 rounded-lg border border-default p-3">
      <USwitch
        v-model="noise"
        label="Hardware noise"
        description="Randomises canvas, WebGL, client rects, media devices and the MAC address."
        :disabled="disabled"
        :data-testid="`${testIdPrefix}-noise`"
      />

      <USwitch
        v-model="audio"
        label="Audio noise"
        :disabled="subDisabled"
        :data-testid="`${testIdPrefix}-audio`"
      />

      <div class="grid gap-4 sm:grid-cols-2">
        <UFormField label="CPU cores" :name="`${testIdPrefix}-cpu`">
          <USelect
            v-model="cpu"
            :items="options?.cpu ?? []"
            class="w-full"
            :disabled="subDisabled"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            :data-testid="`${testIdPrefix}-cpu`"
          />
        </UFormField>

        <UFormField label="Memory (GB)" :name="`${testIdPrefix}-ram`">
          <USelect
            v-model="ram"
            :items="options?.ram ?? []"
            class="w-full"
            :disabled="subDisabled"
            :ui="{ trailingIcon: 'group-data-[state=open]:rotate-180 transition-transform duration-200' }"
            :data-testid="`${testIdPrefix}-ram`"
          />
        </UFormField>
      </div>

      <p v-if="noiseOff" class="text-xs text-muted">
        Audio, CPU and memory follow the computer's real values while hardware noise is off; your choices are kept.
      </p>
    </div>

    <UFormField label="Proxy" :name="`${testIdPrefix}-proxy`">
      <USelectMenu
        v-model="proxyId"
        :items="proxyItems"
        value-key="value"
        :search-input="{ placeholder: 'Search label or host' }"
        icon="i-lucide-network"
        class="w-full"
        :disabled="disabled"
        :data-testid="`${testIdPrefix}-proxy`"
      />
      <p v-if="proxyHint" class="mt-1 text-xs text-muted" :data-testid="`${testIdPrefix}-proxy-hint`">
        {{ proxyHint }}
      </p>
    </UFormField>

    <UFormField label="AdsPower group" :name="`${testIdPrefix}-group`">
      <div class="flex flex-wrap items-center gap-2">
        <span
          class="font-medium"
          :class="group?.name ? 'text-highlighted' : 'text-muted'"
          :data-testid="`${testIdPrefix}-group`"
        >{{ group?.name ?? 'Ungrouped' }}</span>
        <UBadge
          color="neutral"
          variant="subtle"
          icon="i-lucide-tag"
          class="whitespace-nowrap"
          :data-testid="`${testIdPrefix}-tag`"
          :data-tag="group?.tag ?? ''"
        >
          {{ group?.tag ?? '—' }}
        </UBadge>
      </div>
    </UFormField>
  </div>
</template>
