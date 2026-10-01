<script setup lang="ts">
/**
 * Password cell of a table. Masked by default: the DOM holds only the literal mask, never the value (no hidden
 * input). `shown` is owned by the page (keyed by row id) so a filtered / re-sorted table can never reuse a revealed
 * cell for another row. Copy reads the value from the row data via the Clipboard API.
 *
 * FEAT-003 — TikTok accounts (`ta-password*`, the default prefix).
 * FEAT-006 — generalised with `testIdPrefix` and reused by `/proxies` (`px-password*`); moved from
 * `components/tiktok-accounts/PasswordCell.vue` (the FEAT-003 test ids are unchanged).
 * FEAT-023 — `name` distinguishes the two password columns of `/tiktok-accounts` for screen readers and in the
 * copy toast; its default keeps the FEAT-003/006 wording byte-identical.
 */
const props = withDefaults(defineProps<{
  value: string
  shown: boolean
  /** test-id prefix: `<prefix>-password`, `<prefix>-password-toggle`, `<prefix>-password-copy` */
  testIdPrefix?: string
  /** lower-case name used in the aria-labels and the copy toast ("email password" → "Show email password") */
  name?: string
}>(), {
  testIdPrefix: 'ta',
  name: 'password'
})

const emit = defineEmits<{
  toggle: []
}>()

const MASK = '••••••••'
const toast = useToast()

/** "password" → "Password" (the toast title starts with it) */
const Name = computed(() => props.name.charAt(0).toUpperCase() + props.name.slice(1))

async function copy() {
  try {
    await navigator.clipboard.writeText(props.value)
    toast.add({ title: `${Name.value} copied`, color: 'success' })
  } catch {
    toast.add({ title: `Could not copy the ${props.name}`, description: 'Clipboard access was denied by the browser.', color: 'error' })
  }
}
</script>

<template>
  <div class="flex items-center gap-1 whitespace-nowrap">
    <span
      class="font-mono text-sm"
      :class="shown ? 'text-highlighted' : 'text-muted'"
      :data-testid="`${testIdPrefix}-password`"
      :data-shown="shown ? 'true' : 'false'"
    >{{ shown ? value : MASK }}</span>
    <UButton
      :icon="shown ? 'i-lucide-eye-off' : 'i-lucide-eye'"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="shown ? `Hide ${name}` : `Show ${name}`"
      :aria-pressed="shown"
      :data-testid="`${testIdPrefix}-password-toggle`"
      @click="emit('toggle')"
    />
    <UButton
      icon="i-lucide-copy"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="`Copy ${name}`"
      :data-testid="`${testIdPrefix}-password-copy`"
      @click="copy"
    />
  </div>
</template>
