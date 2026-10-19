<script setup lang="ts">
/**
 * TASK-campaign-delete-ui — `am-delete-modal`: the one confirm step in front of
 * `POST /ads-monitor/delete-campaign`. Presentational on purpose — the request, the optimistic override, the
 * 409 toast and the re-read all live in `pages/ads-monitor.vue` next to `toggle()`, so both write paths of
 * this page behave identically; this component only asks and emits `confirm`.
 *
 * `UModal`'s root is renderless, so a `data-testid` on the component lands nowhere: `content` is v-bound onto
 * the rendered DialogContent element (same trick as `ad-templates/DeleteModal.vue` and `am-covers-modal`).
 */
import type { ModalProps } from '@nuxt/ui'
import type { MonitorRow } from '#shared/types/ads-monitor'

const props = defineProps<{
  /** the campaign row the trash button was pressed on; null while the modal is closed */
  row: MonitorRow | null
  /** a POST of this row is in flight */
  deleting?: boolean
}>()

const emit = defineEmits<{ confirm: [row: MonitorRow] }>()

const open = defineModel<boolean>('open', { default: false })

const modalContent = { 'data-testid': 'am-delete-modal' } as ModalProps['content']

const campaignName = computed(() => props.row?.name || props.row?.id || REPORT_DASH)
const question = computed(() =>
  `ลบแคมเปญ "${campaignName.value}" บน TikTok ใช่ไหม? ลบแล้วกู้คืนไม่ได้ (ข้อมูลในระบบยังเก็บไว้และจะแสดงเป็น "ลบแล้ว")`
)

function confirm() {
  if (!props.row || props.deleting) return
  emit('confirm', props.row)
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="ลบแคมเปญ"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-default" data-testid="am-delete-question">
          {{ question }}
        </p>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="deleting"
            data-testid="am-delete-cancel"
            @click="open = false"
          />
          <UButton
            label="ลบแคมเปญ"
            icon="i-lucide-trash-2"
            color="error"
            variant="solid"
            :loading="deleting"
            data-testid="am-delete-confirm"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
