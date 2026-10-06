<script setup lang="ts">
/**
 * FEAT-028 — the Proxy choice of every surface that creates a browser profile (spec.md "UI behaviour"):
 * a `URadioGroup` (`${testIdPrefix}-proxy-mode`, **default variant** so each `role=radio` is named by its label)
 * with two items (`Auto` / `No proxy` — Default settings) or three (`Auto` / `Pick a free proxy` / `No proxy` —
 * Create-profile modal, Add-account modal). While `pick` is selected the free-only picker
 * `${testIdPrefix}-proxy` is shown (items built by `useProfileSettings().proxyItems`: `<glyph> <label> ·
 * host:port`, grouped by workspace); when no free proxy is left, the muted line `${testIdPrefix}-proxy-empty`
 * explains it and the parent blocks submit with "Choose a proxy" (`error`).
 * The FEAT-027/BUG-030 `${testIdPrefix}-proxy-hint` and the picker's "No proxy" item are gone — the radio holds
 * that choice now.
 */
import type { SelectMenuItem } from '@nuxt/ui'
import type { ProxyModeChoice } from '~/composables/useProfileSettings'

const props = withDefaults(defineProps<{
  /** `bp-defaults`, `bp-create` or `ta-add` */
  testIdPrefix: string
  /** field label; "Proxy" everywhere but the Add-account modal ("Proxy for the new profile") */
  label?: string
  /** `true` → the three-item radio with "Pick a free proxy" + the picker; `false` → Auto / No proxy only */
  pick?: boolean
  /** free proxies as `USelectMenu` items (`useProfileSettings().proxyItems`); only read while `pick` */
  proxyItems?: SelectMenuItem[]
  /** muted helper line under the radio; omitted → no `-proxy-help` element */
  help?: string | null
  /** form error under the field ("Choose a proxy", or a failed defaults/proxies load) */
  error?: string | null
  disabled?: boolean
}>(), {
  label: 'Proxy',
  pick: false,
  proxyItems: () => [],
  help: null,
  error: null
})

const proxyMode = defineModel<ProxyModeChoice>('proxyMode', { required: true })
/** a `proxies._id`, or `''` while nothing is picked */
const proxyId = defineModel<string>('proxyId', { required: true })

/** exact option texts and values (QA matches them literally) */
const AUTO = { label: 'Auto', value: 'auto' }
const PICK = { label: 'Pick a free proxy', value: 'pick' }
const NONE = { label: 'No proxy', value: 'none' }

const items = computed(() => (props.pick ? [AUTO, PICK, NONE] : [AUTO, NONE]))

/** the group headers of `proxyItems` are `{ type: 'label' }` entries, not selectable proxies */
const hasFreeProxy = computed(() =>
  props.proxyItems.some(item => typeof item === 'object' && item !== null && !('type' in item && item.type))
)
</script>

<template>
  <UFormField
    :label="label"
    :name="`${testIdPrefix}-proxy-mode`"
    :error="error ?? undefined"
  >
    <!-- default variant on purpose: it renders `<label :for>` per option, so each `role=radio` keeps its label
         ("Auto" / "Pick a free proxy" / "No proxy") as its accessible name -->
    <URadioGroup
      v-model="proxyMode"
      :items="items"
      orientation="horizontal"
      :disabled="disabled"
      :ui="{ fieldset: 'flex-wrap gap-x-5 gap-y-2' }"
      :data-testid="`${testIdPrefix}-proxy-mode`"
    />

    <p v-if="help" class="mt-1 text-xs text-muted" :data-testid="`${testIdPrefix}-proxy-help`">
      {{ help }}
    </p>

    <template v-if="proxyMode === 'pick'">
      <USelectMenu
        v-model="proxyId"
        :items="proxyItems"
        value-key="value"
        :search-input="{ placeholder: 'Search label or host' }"
        placeholder="Select a free proxy"
        icon="i-lucide-network"
        class="mt-2 w-full"
        :disabled="disabled || !hasFreeProxy"
        :data-testid="`${testIdPrefix}-proxy`"
      />
      <p v-if="!hasFreeProxy" class="mt-1 text-xs text-muted" :data-testid="`${testIdPrefix}-proxy-empty`">
        {{ PROXY_PICK_EMPTY }}
      </p>
    </template>
  </UFormField>
</template>
