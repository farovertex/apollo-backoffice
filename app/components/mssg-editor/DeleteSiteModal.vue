<script setup lang="ts">
/**
 * FEAT-101 M5 (D6, AC-35, AC-37; contract §4.3) — "ลบเว็บ" dialog: names the site, the user types its exact name and
 * the delete button enables only on an exact (case-sensitive, trimmed) match. The dialog itself sends nothing: on
 * confirm the page sends `DELETE /mssg-sites/:id { confirmName }` and passes back `busy` / `error` (400
 * `confirmMismatch`, 403 `ownAreaOnly`, 409 … as Thai text). Pasting is allowed; the text field is cleared every time
 * the dialog opens.
 *
 * Test ids: `me-delete-dialog`, `me-delete-site-name`, `me-delete-name`, `me-delete-mismatch`, `me-delete-error`,
 * `me-delete-cancel`, `me-delete-confirm`.
 */
import type { ModalProps } from '@nuxt/ui'

const props = withDefaults(defineProps<{
  siteName: string
  busy?: boolean
  error?: string | null
}>(), { busy: false, error: null })

const emit = defineEmits<{ confirm: [name: string] }>()
const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'me-delete-dialog' } as ModalProps['content']

const typed = ref('')
watch(open, (isOpen) => {
  if (isOpen) typed.value = ''
})

const matches = computed(() => mssgDeleteNameMatches(typed.value, props.siteName))

function onConfirm() {
  if (!matches.value || props.busy) return
  emit('confirm', typed.value.trim())
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="MSSG_LIFECYCLE_TEXT.deleteTitle"
    :dismissible="!busy"
    :close="!busy"
    :ui="{ content: 'max-w-md', header: 'min-w-0', wrapper: 'min-w-0', title: 'wrap-anywhere' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3 text-sm">
        <p class="break-words text-toned">
          {{ MSSG_LIFECYCLE_TEXT.deleteWarn }}
        </p>
        <p class="rounded-md border border-error/40 bg-error/10 px-3 py-2 font-semibold break-words text-highlighted" data-testid="me-delete-site-name">
          {{ siteName }}
        </p>
        <label class="flex flex-col gap-1.5">
          <span class="text-toned">{{ MSSG_LIFECYCLE_TEXT.deleteType }}</span>
          <UInput
            v-model="typed"
            class="w-full"
            autocomplete="off"
            spellcheck="false"
            :disabled="busy"
            placeholder="พิมพ์ชื่อเว็บที่นี่"
            data-testid="me-delete-name"
            @keydown.enter.prevent="onConfirm"
          />
        </label>
        <span v-if="typed.trim() && !matches" class="text-xs text-muted" data-testid="me-delete-mismatch">{{ MSSG_LIFECYCLE_TEXT.deleteMismatch }}</span>
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="error"
          role="alert"
          data-testid="me-delete-error"
        />
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="ยกเลิก"
          color="neutral"
          variant="subtle"
          :disabled="busy"
          data-testid="me-delete-cancel"
          @click="open = false"
        />
        <UButton
          label="ลบเว็บถาวร"
          icon="i-lucide-trash-2"
          color="error"
          :loading="busy"
          :disabled="!matches"
          data-testid="me-delete-confirm"
          @click="onConfirm"
        />
      </div>
    </template>
  </UModal>
</template>
