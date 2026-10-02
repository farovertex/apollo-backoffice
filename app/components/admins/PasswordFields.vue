<script setup lang="ts">
/**
 * FEAT-009 — the password block shared by the Create modal (`prefix="adm-form"`) and the Reset password modal
 * (`prefix="adm-reset"`): password + confirm, one reveal toggle, Generate (16 chars `[A-Za-z0-9]` from
 * `crypto.getRandomValues`, fills both fields and reveals them) and Copy (clipboard + "Copied" toast).
 *
 * Every `data-testid` is built from `prefix`, so the same component serves both modals
 * (`<prefix>-password`, `-password-confirm`, `-password-toggle`, `-generate`, `-copy`).
 * The plaintext is visible only while the modal is open; it is never written to a toast, a log or a URL.
 */

const props = withDefaults(defineProps<{
  /** `adm-form` | `adm-reset` — every testid of this block is prefixed with it */
  prefix: string
  /** `UFormField` names, so a zod issue and an API `issues[].path` land on the same field */
  passwordName?: string
  confirmName?: string
  label?: string
  confirmLabel?: string
  disabled?: boolean
  /** server-side messages, owned by the parent (they must survive the validate-on-input debounce) */
  passwordError?: string
  confirmError?: string
}>(), {
  passwordName: 'password',
  confirmName: 'passwordConfirm',
  label: 'Password',
  confirmLabel: 'Confirm password',
  disabled: false,
  passwordError: undefined,
  confirmError: undefined
})

const password = defineModel<string>('password', { default: '' })
const confirm = defineModel<string>('confirm', { default: '' })

const toast = useToast()

const revealed = ref(false)
/** Copy appears once a password was generated — it exists to hand over that generated value */
const generated = ref(false)

const inputType = computed(() => (revealed.value ? 'text' : 'password'))

/** called by the parent when the modal (re)opens */
function reset() {
  revealed.value = false
  generated.value = false
}

defineExpose({ reset })

function generate() {
  const value = generatePassword(16)
  password.value = value
  confirm.value = value
  revealed.value = true
  generated.value = true
}

async function copy() {
  try {
    await navigator.clipboard.writeText(password.value)
    // never echo the password itself
    toast.add({ title: 'Copied', description: 'Password copied to the clipboard', color: 'success' })
  } catch {
    toast.add({
      title: 'Could not copy',
      description: 'Clipboard access was denied — select the field and copy manually',
      color: 'error'
    })
  }
}
</script>

<template>
  <div class="space-y-4">
    <UFormField
      :label="props.label"
      :name="props.passwordName"
      required
      :error="props.passwordError"
    >
      <UInput
        v-model="password"
        :type="inputType"
        autocomplete="new-password"
        class="w-full"
        :disabled="props.disabled"
        :data-testid="`${props.prefix}-password`"
      >
        <template #trailing>
          <UButton
            :icon="revealed ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :aria-label="revealed ? 'Hide password' : 'Show password'"
            color="neutral"
            variant="link"
            size="xs"
            :disabled="props.disabled"
            :data-testid="`${props.prefix}-password-toggle`"
            @click="revealed = !revealed"
          />
        </template>
      </UInput>
    </UFormField>

    <UFormField
      :label="props.confirmLabel"
      :name="props.confirmName"
      required
      :error="props.confirmError"
    >
      <UInput
        v-model="confirm"
        :type="inputType"
        autocomplete="new-password"
        class="w-full"
        :disabled="props.disabled"
        :data-testid="`${props.prefix}-password-confirm`"
      />
    </UFormField>

    <div class="flex flex-wrap items-center gap-2">
      <UButton
        label="Generate"
        icon="i-lucide-dice-5"
        color="neutral"
        variant="outline"
        size="xs"
        :disabled="props.disabled"
        :data-testid="`${props.prefix}-generate`"
        @click="generate"
      />
      <UButton
        v-if="generated"
        label="Copy"
        icon="i-lucide-clipboard"
        color="neutral"
        variant="subtle"
        size="xs"
        :disabled="props.disabled"
        :data-testid="`${props.prefix}-copy`"
        @click="copy"
      />
      <span class="text-xs text-muted">8–128 characters. Shown only while this dialog is open.</span>
    </div>
  </div>
</template>
