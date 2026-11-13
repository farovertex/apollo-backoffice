<script setup lang="ts">
/**
 * FEAT-101 — one text field of a page / block form inside a `UForm` (zod path `name`, Thai message under it).
 * Test ids: `<testid>-<name>` on the input, `<testid>-error-<name>` on the message (rendered only with a message).
 */
const props = withDefaults(defineProps<{
  name: string
  label: string
  /** test-id prefix, e.g. `me-block-field` → `me-block-field-title` / `me-block-field-error-title` */
  testid: string
  textarea?: boolean
  rows?: number
  maxlength?: number
  placeholder?: string
  description?: string
  type?: string
  required?: boolean
  /** a server message for this field (overrides the form's own) */
  error?: string | null
  /** `n/max` counter under the field (`max` = `limit`, else `maxlength`) */
  counter?: boolean
  /** a soft limit for the counter and its red state — no native `maxlength`, so the Thai message can show (M3) */
  limit?: number
  mono?: boolean
  /** M4: virtual keyboard hint (`decimal` for a price) — a text input, so a decimal never trips the native step check */
  inputmode?: 'text' | 'decimal' | 'numeric'
}>(), { textarea: false, rows: 3, maxlength: undefined, placeholder: '', description: undefined, type: 'text', required: false, error: null, counter: false, limit: undefined, mono: false, inputmode: undefined })

const model = defineModel<string>({ default: '' })
const errorTestid = computed(() => `${props.testid}-error-${props.name}`)
const max = computed(() => props.limit ?? props.maxlength)
</script>

<template>
  <UFormField
    :label="label"
    :name="name"
    :required="required"
    :description="description"
    :error="error || undefined"
    eager-validation
    :ui="{ label: 'break-words', description: 'break-words' }"
  >
    <UTextarea
      v-if="textarea"
      v-model="model"
      :rows="rows"
      autoresize
      :maxrows="12"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :class="['w-full', mono ? 'font-mono' : '']"
      :data-testid="`${testid}-${name}`"
    />
    <UInput
      v-else
      v-model="model"
      :type="type"
      :maxlength="maxlength"
      :placeholder="placeholder"
      :inputmode="inputmode"
      class="w-full"
      :data-testid="`${testid}-${name}`"
    />
    <template v-if="counter && max" #hint>
      <span
        class="text-xs tabular-nums"
        :class="model.length > max ? 'text-error' : 'text-muted'"
        :data-testid="`${testid}-counter-${name}`"
      >{{ model.length }}/{{ max }}</span>
    </template>
    <template #error="{ error: e }">
      <span v-if="e" :data-testid="errorTestid">{{ e }}</span>
    </template>
  </UFormField>
</template>
