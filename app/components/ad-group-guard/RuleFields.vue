<script setup lang="ts">
/**
 * FEAT-086 (spec "UI behaviour" §1 "Shared pieces") — the three inputs of an ad group guard rule + the combine radio,
 * reused by `/settings/ad-group-guard` (`st-agg-*`), the account Edit modal (`ta-edit-guard-*`) and the Launch ads
 * popover (`la-adgroup-guard-*`). `testid` is the prefix: `<testid>-min-spend`, `<testid>-max-cpm`,
 * `<testid>-min-conv`, `<testid>-combine` (+ `-or` / `-and` radios) and `<testid>-error` for the rule-level message.
 *
 * v-model = an `AdGroupGuardRuleDraft` (text inputs, so an empty field is a value: `null` on the wire). The combine
 * radio is rendered **only when both** maxCpm and minConversions are typed (A4); the parent always sends an explicit
 * `combine` (`parseAdGroupGuardDraft()`). Client validity mirrors contract §1.1 with the API's own messages and is
 * emitted as `valid`; a message shows once its field was touched or when the parent sets `showErrors` (Save pressed).
 * `serverErrors` (keyed `minSpend` / `maxCpm` / `minConversions` / `rule`) carries the API's 400 issues per path and
 * wins over the client message.
 */
import type { AdGroupGuardCombine } from '#shared/types/ad-group-guard'
import type { AdGroupGuardDraftErrors, AdGroupGuardRuleDraft } from '~/utils/ad-group-guard'

const props = withDefaults(defineProps<{
  /** testid prefix */
  testid: string
  /** suffix of the money inputs; `null` → "สกุลของบัญชี" */
  currency: string | null
  disabled?: boolean
  showErrors?: boolean
  serverErrors?: AdGroupGuardDraftErrors | null
}>(), { disabled: false, showErrors: false, serverErrors: null })

/** `edited` — the user typed / picked something (the parent drops its stale `serverErrors` then) */
const emit = defineEmits<{ valid: [valid: boolean], edited: [] }>()

const draft = defineModel<AdGroupGuardRuleDraft>({ required: true })

const touched = reactive({ minSpend: false, maxCpm: false, minConversions: false })

const parsed = computed(() => parseAdGroupGuardDraft(draft.value))
const clientErrors = computed<AdGroupGuardDraftErrors>(() => parsed.value.errors ?? {})
const both = computed(() => adGroupGuardDraftHasBoth(draft.value))
const suffix = computed(() => props.currency || AGG_ACCOUNT_CURRENCY)

watch(() => parsed.value.rule !== null, valid => emit('valid', valid), { immediate: true })

function errorOf(key: 'minSpend' | 'maxCpm' | 'minConversions'): string | undefined {
  const server = props.serverErrors?.[key]
  if (server) return server
  return touched[key] || props.showErrors ? clientErrors.value[key] : undefined
}

const ruleError = computed(() => {
  if (props.serverErrors?.rule) return props.serverErrors.rule
  const anyTouched = touched.minSpend || touched.maxCpm || touched.minConversions
  return (anyTouched || props.showErrors) ? clientErrors.value.rule : undefined
})

function update(key: 'minSpend' | 'maxCpm' | 'minConversions', value: string | number) {
  touched[key] = true
  draft.value = { ...draft.value, [key]: String(value ?? '') }
  emit('edited')
}

function setCombine(value: AdGroupGuardCombine) {
  draft.value = { ...draft.value, combine: value }
  emit('edited')
}

const combineItems: { value: AdGroupGuardCombine, label: string }[] = [
  { value: 'or', label: AGG_COMBINE_LABEL.or },
  { value: 'and', label: AGG_COMBINE_LABEL.and }
]
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="grid gap-3 sm:grid-cols-3">
      <UFormField label="ใช้จ่ายถึง" :error="errorOf('minSpend')">
        <UInput
          :model-value="draft.minSpend"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="1500"
          class="w-full"
          :disabled="disabled"
          :data-testid="`${testid}-min-spend`"
          @update:model-value="update('minSpend', $event)"
        >
          <template #trailing>
            <span class="text-xs text-muted" :data-testid="`${testid}-currency`">{{ suffix }}</span>
          </template>
        </UInput>
      </UFormField>
      <UFormField label="CPM เกิน" :error="errorOf('maxCpm')">
        <UInput
          :model-value="draft.maxCpm"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          placeholder="200"
          class="w-full"
          :disabled="disabled"
          :data-testid="`${testid}-max-cpm`"
          @update:model-value="update('maxCpm', $event)"
        >
          <template #trailing>
            <span class="text-xs text-muted">{{ suffix }}</span>
          </template>
        </UInput>
      </UFormField>
      <UFormField label="conversions ต่ำกว่า" :error="errorOf('minConversions')">
        <UInput
          :model-value="draft.minConversions"
          type="text"
          inputmode="numeric"
          autocomplete="off"
          placeholder="60"
          class="w-full"
          :disabled="disabled"
          :data-testid="`${testid}-min-conv`"
          @update:model-value="update('minConversions', $event)"
        />
      </UFormField>
    </div>

    <p class="text-xs text-muted">
      เริ่มตัดสินเมื่อใช้จ่ายถึงยอดนี้ · เว้น CPM หรือ conversions ว่าง = ไม่ใช้เงื่อนไขนั้น (ต้องมีอย่างน้อยหนึ่ง)
    </p>

    <div v-if="both" class="flex flex-col gap-1">
      <span class="text-xs text-muted">ปิดเมื่อ</span>
      <div
        class="flex flex-wrap items-center gap-1"
        role="radiogroup"
        aria-label="วิธีรวมเงื่อนไข"
        :data-testid="`${testid}-combine`"
        :data-value="draft.combine"
      >
        <UButton
          v-for="item in combineItems"
          :key="item.value"
          :label="item.label"
          :color="draft.combine === item.value ? 'primary' : 'neutral'"
          :variant="draft.combine === item.value ? 'solid' : 'outline'"
          size="xs"
          role="radio"
          :aria-checked="draft.combine === item.value"
          :disabled="disabled"
          :data-testid="`${testid}-combine-${item.value}`"
          @click="setCombine(item.value)"
        />
      </div>
    </div>

    <p
      v-if="ruleError"
      class="text-xs text-error"
      role="alert"
      :data-testid="`${testid}-error`"
    >
      {{ ruleError }}
    </p>
  </div>
</template>
