<script setup lang="ts">
/**
 * FEAT-003 — Password cell of the accounts table. Masked by default: the DOM holds only the literal mask, never the
 * value (no hidden input). `shown` is owned by the page (keyed by account id) so a filtered / re-sorted table can
 * never reuse a revealed cell for another account. Copy reads the value from the row data via the Clipboard API.
 */
const props = defineProps<{
  value: string
  shown: boolean
}>()

const emit = defineEmits<{
  toggle: []
}>()

const MASK = '••••••••'
const toast = useToast()

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    toast.add({ title: 'Password copied', color: 'success' })
  } catch {
    toast.add({ title: 'Could not copy the password', description: 'Clipboard access was denied by the browser.', color: 'error' })
  }
}
</script>

<template>
  <div class="flex items-center gap-1 whitespace-nowrap">
    <span
      class="font-mono text-sm"
      :class="shown ? 'text-highlighted' : 'text-muted'"
      data-testid="ta-password"
      :data-shown="shown ? 'true' : 'false'"
    >{{ shown ? value : MASK }}</span>
    <UButton
      :icon="shown ? 'i-lucide-eye-off' : 'i-lucide-eye'"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="shown ? 'Hide password' : 'Show password'"
      :aria-pressed="shown"
      data-testid="ta-password-toggle"
      @click="emit('toggle')"
    />
    <UButton
      icon="i-lucide-copy"
      color="neutral"
      variant="ghost"
      size="xs"
      aria-label="Copy password"
      data-testid="ta-password-copy"
      @click="copy"
    />
  </div>
</template>
