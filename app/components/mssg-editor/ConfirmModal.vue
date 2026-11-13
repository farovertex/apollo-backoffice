<script setup lang="ts">
/**
 * FEAT-101 — one confirm dialog for the editor: the destructive-save confirm (lists the destructive ops, AC-15),
 * "ทิ้งร่าง" and turning the publish switch off. The modal itself sends nothing — the parent does on `confirm`.
 * Test ids: `<testid>` on the dialog content, `<testid>-ok`, `<testid>-cancel`, `<testid>-item` per listed line.
 */
import type { ModalProps } from '@nuxt/ui'

const props = withDefaults(defineProps<{
  title: string
  description?: string
  items?: string[]
  confirmLabel: string
  color?: 'error' | 'warning' | 'primary'
  busy?: boolean
  testid: string
}>(), { description: '', items: () => [], color: 'error', busy: false })

const emit = defineEmits<{ confirm: [] }>()
const open = defineModel<boolean>('open', { default: false })

// UModal's root is renderless: the test id goes on the rendered dialog content
const modalContent = computed(() => ({ 'data-testid': props.testid }) as ModalProps['content'])
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :dismissible="!busy"
    :close="!busy"
    :ui="{ content: 'max-w-md', header: 'min-w-0', wrapper: 'min-w-0', title: 'wrap-anywhere' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3 text-sm">
        <p v-if="description" class="break-words text-toned">
          {{ description }}
        </p>
        <ul v-if="items.length" class="flex list-disc flex-col gap-1 ps-5 text-highlighted">
          <li
            v-for="(item, i) in items"
            :key="i"
            class="break-words"
            :data-testid="`${testid}-item`"
          >
            {{ item }}
          </li>
        </ul>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="ยกเลิก"
          color="neutral"
          variant="subtle"
          :disabled="busy"
          :data-testid="`${testid}-cancel`"
          @click="open = false"
        />
        <UButton
          :label="confirmLabel"
          :color="color"
          :loading="busy"
          :data-testid="`${testid}-ok`"
          @click="emit('confirm')"
        />
      </div>
    </template>
  </UModal>
</template>
