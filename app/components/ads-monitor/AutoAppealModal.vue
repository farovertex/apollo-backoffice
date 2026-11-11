<script setup lang="ts">
/**
 * `am-auto-appeal-modal`: the confirm step in front of the auto-appeal. Shows the ticked ads, the fixed reason and
 * the fixed description that will be typed into TikTok's appeal form; the page sends one `POST /ads-monitor/appeal`
 * per ad after `confirm`. This component only asks.
 */
import type { ModalProps } from '@nuxt/ui'
import type { MonitorRow } from '#shared/types/ads-monitor'
import { APPEAL_REASONS } from '#shared/types/ads-monitor'
import { AUTO_APPEAL_DESCRIPTION, AUTO_APPEAL_REASON } from '~/utils/auto-appeal'

const props = defineProps<{
  rows: MonitorRow[]
  /** true while the page is sending — locks the modal */
  sending: boolean
}>()

const emit = defineEmits<{ confirm: [rows: MonitorRow[]] }>()

const open = defineModel<boolean>('open', { default: false })

const modalContent = { 'data-testid': 'am-auto-appeal-modal' } as ModalProps['content']
const count = computed(() => props.rows.length)
const reasonText = APPEAL_REASONS[AUTO_APPEAL_REASON]
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`ยื่นอุทธรณ์ ${count} รายการ`"
    :dismissible="!sending"
    :ui="{ content: 'max-w-xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <ul
          class="flex max-h-40 flex-col gap-1 overflow-auto rounded-md border border-default bg-elevated/40 p-2 text-sm"
          data-testid="am-auto-appeal-list"
        >
          <li v-for="row in rows" :key="row.id" class="truncate px-1 py-0.5 text-default">
            {{ row.name || row.id }}
          </li>
        </ul>

        <div class="flex flex-col gap-1">
          <span class="text-sm font-semibold text-highlighted">เหตุผลในการอุทธรณ์</span>
          <span class="text-sm text-default" data-testid="am-auto-appeal-reason">• {{ reasonText }}</span>
        </div>

        <div class="flex flex-col gap-1">
          <span class="text-sm font-semibold text-highlighted">คำอธิบาย</span>
          <p
            class="max-h-64 overflow-auto whitespace-pre-line rounded-md border border-default bg-elevated/40 p-2 text-sm text-default"
            data-testid="am-auto-appeal-description"
          >
            {{ AUTO_APPEAL_DESCRIPTION }}
          </p>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="sending"
            data-testid="am-auto-appeal-cancel"
            @click="open = false"
          />
          <UButton
            :label="`ยื่นอุทธรณ์ ${count} รายการ`"
            icon="i-lucide-send"
            color="primary"
            variant="solid"
            :loading="sending"
            :disabled="sending || count === 0"
            data-testid="am-auto-appeal-confirm"
            @click="emit('confirm', [...rows])"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
