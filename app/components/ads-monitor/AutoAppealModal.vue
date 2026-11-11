<script setup lang="ts">
/**
 * `am-auto-appeal-modal`: the form in front of the auto-appeal. The same reason radios + description box as the single
 * appeal of `ReviewDrawer.vue` (starts empty every time it opens), plus the list of ticked ads. `confirm` hands the one
 * reason + description back; the page sends one `POST /ads-monitor/appeal` per ad with it. This component only asks.
 */
import type { ModalProps } from '@nuxt/ui'
import type { AppealReason, MonitorRow } from '#shared/types/ads-monitor'
import { APPEAL_REASON_ITEMS } from '#shared/types/ads-monitor'

/** same cap as the single appeal (`ReviewDrawer.vue`) and the API's `description ≤ 2000` */
const DESCRIPTION_MAX = 2000

export interface AutoAppealForm {
  reason: AppealReason
  description: string
}

const props = defineProps<{
  rows: MonitorRow[]
  /** true while the page is sending — locks the modal */
  sending: boolean
}>()

const emit = defineEmits<{ confirm: [rows: MonitorRow[], form: AutoAppealForm] }>()

const open = defineModel<boolean>('open', { default: false })

const modalContent = { 'data-testid': 'am-auto-appeal-modal' } as ModalProps['content']
const count = computed(() => props.rows.length)

const reason = ref<AppealReason | null>(null)
const description = ref('')

// empty form on every open, like the single appeal
watch(open, (value) => {
  if (!value) return
  reason.value = null
  description.value = ''
})

const canSubmit = computed(() =>
  !props.sending && count.value > 0 && reason.value !== null && description.value.trim() !== ''
)

function submit() {
  if (!canSubmit.value || reason.value === null) return
  emit('confirm', [...props.rows], { reason: reason.value, description: description.value.trim() })
}
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

        <p class="font-medium text-highlighted">
          คำร้องเกี่ยวกับโฆษณา
        </p>

        <fieldset class="flex min-w-0 flex-col gap-2" :disabled="sending">
          <legend class="mb-1 text-sm text-muted">
            เหตุผลในการอุทธรณ์
          </legend>
          <label
            v-for="item in APPEAL_REASON_ITEMS"
            :key="item.value"
            class="flex min-w-0 cursor-pointer items-start gap-2 text-sm"
          >
            <input
              v-model="reason"
              type="radio"
              name="am-auto-appeal-reason"
              class="mt-0.5 size-4 shrink-0 accent-primary"
              :value="item.value"
              :data-testid="`am-auto-appeal-reason-${item.value}`"
            >
            <span class="min-w-0">{{ item.label }}</span>
          </label>
        </fieldset>

        <div class="flex min-w-0 flex-col gap-1">
          <label class="text-sm text-muted" for="am-auto-appeal-description-input">คำอธิบาย</label>
          <UTextarea
            id="am-auto-appeal-description-input"
            v-model="description"
            :rows="4"
            :maxlength="DESCRIPTION_MAX"
            :disabled="sending"
            placeholder="อธิบายเหตุผลของการอุทธรณ์ที่นี่"
            :ui="{ base: 'resize-y' }"
            data-testid="am-auto-appeal-description"
          />
          <span
            class="self-end text-xs text-muted tabular-nums"
            data-testid="am-auto-appeal-counter"
          >{{ description.length }}/{{ DESCRIPTION_MAX }}</span>
        </div>

        <p class="text-xs text-muted">
          เหตุผลและคำอธิบายนี้จะใช้กับทุกโฆษณาในรายการ
        </p>

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
            :disabled="!canSubmit"
            data-testid="am-auto-appeal-confirm"
            @click="submit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
