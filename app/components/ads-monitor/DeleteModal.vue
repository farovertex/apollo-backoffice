<script setup lang="ts">
/**
 * `am-delete-modal`: the one confirm step in front of a delete.
 *
 * TASK-campaign-delete-ui — campaign tab: `POST /ads-monitor/delete-campaign`, one row, the sentence embeds the
 * campaign name and the confirm label stays "ลบแคมเปญ".
 *
 * FEAT-093 — ad-group / ad tabs: the same modal, extended for **multi-select** (api-contract.md v1 §6). It now
 * takes a `level` and a `rows[]` (one or many), shows a per-level title with the count, lists the names
 * (+ `…last4` id), groups the list by advertiser when the selection spans more than one, warns that the ads in
 * an ad group go with it, and its confirm label is "ลบ N รายการ".
 *
 * Presentational on purpose — the request, the optimistic override, the 409 toast and the re-read all live in
 * `pages/ads-monitor.vue`; this component only asks and emits `confirm(rows)`.
 *
 * `UModal`'s root is renderless, so a `data-testid` on the component lands nowhere: `content` is v-bound onto
 * the rendered DialogContent element (same trick as `ad-templates/DeleteModal.vue` and `am-covers-modal`).
 */
import type { ModalProps } from '@nuxt/ui'
import type { MonitorLevel, MonitorRow } from '#shared/types/ads-monitor'

const props = defineProps<{
  /** which tab opened the modal; drives the title / warning / confirm label */
  level: MonitorLevel
  /** the rows to delete (one on the campaign tab and the single-row path, many from the selection bar) */
  rows: MonitorRow[]
  /** a request of this modal is in flight */
  deleting?: boolean
}>()

const emit = defineEmits<{ confirm: [rows: MonitorRow[]] }>()

const open = defineModel<boolean>('open', { default: false })

const modalContent = { 'data-testid': 'am-delete-modal' } as ModalProps['content']

const count = computed(() => props.rows.length)
const isCampaign = computed(() => props.level === 'campaign')

/** campaign tab keeps its own wording (single row, name embedded); the other two levels get a per-level title */
const campaignName = computed(() => props.rows[0]?.name || props.rows[0]?.id || REPORT_DASH)
const title = computed(() => {
  if (isCampaign.value) return 'ลบแคมเปญ'
  if (props.level === 'adGroup') return `ลบกลุ่มโฆษณา ${count.value} กลุ่ม?`
  return `ลบโฆษณา ${count.value} ชิ้น?`
})

/** `am-delete-question` — the "ลบแล้วกู้คืนไม่ได้ …" sentence (campaign tab embeds the name, as before) */
const question = computed(() =>
  isCampaign.value
    ? `ลบแคมเปญ "${campaignName.value}" บน TikTok ใช่ไหม? ลบแล้วกู้คืนไม่ได้ (ข้อมูลในระบบยังเก็บไว้และจะแสดงเป็น "ลบแล้ว")`
    : 'ลบแล้วกู้คืนไม่ได้ (ข้อมูลในระบบยังเก็บไว้และจะแสดงเป็น "ลบแล้ว")'
)

/** ad-group only: deleting a group deletes every ad inside it (TikTok warns the same) */
const showWarning = computed(() => props.level === 'adGroup')

/** the list (never shown on the campaign tab — its one name is already in the question) */
const showList = computed(() => !isCampaign.value && count.value > 0)

/** group the rows by advertiser, keeping the table order; headers are shown only when > 1 advertiser */
interface AdvGroup { id: string, name: string, rows: MonitorRow[] }
const groups = computed<AdvGroup[]>(() => {
  const map = new Map<string, AdvGroup>()
  for (const row of props.rows) {
    const id = row.advertiser.id
    const group = map.get(id)
    if (group) group.rows.push(row)
    else map.set(id, { id, name: row.advertiser.name || REPORT_DASH, rows: [row] })
  }
  return [...map.values()]
})
const multiAdvertiser = computed(() => groups.value.length > 1)

const confirmLabel = computed(() => (isCampaign.value ? 'ลบแคมเปญ' : `ลบ ${count.value} รายการ`))

function confirm() {
  if (count.value === 0 || props.deleting) return
  emit('confirm', [...props.rows])
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="text-sm text-default" data-testid="am-delete-question">
          {{ question }}
        </p>

        <p
          v-if="showWarning"
          class="flex items-start gap-1.5 text-sm text-warning"
          data-testid="am-delete-warning"
        >
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
          <span>โฆษณาทุกชิ้นในกลุ่มจะถูกลบด้วย</span>
        </p>

        <ul
          v-if="showList"
          class="flex max-h-64 flex-col gap-1 overflow-auto rounded-md border border-default bg-elevated/40 p-2 text-sm"
          data-testid="am-delete-modal-list"
        >
          <template v-for="group in groups" :key="group.id">
            <li
              v-if="multiAdvertiser"
              class="px-1 pt-1 text-xs font-semibold text-muted"
              :data-testid="`am-delete-modal-group-${group.id}`"
            >
              {{ group.name }}
            </li>
            <li
              v-for="row in group.rows"
              :key="row.id"
              class="truncate px-1 py-0.5 text-default"
              :class="multiAdvertiser ? 'ps-3' : ''"
              :title="`${row.name || REPORT_DASH} ${last4(row.id)}`"
              :data-testid="`am-delete-modal-item-${row.id}`"
            >
              {{ row.name || REPORT_DASH }} <span class="text-muted">{{ last4(row.id) }}</span>
            </li>
          </template>
        </ul>

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
            :label="confirmLabel"
            icon="i-lucide-trash-2"
            color="error"
            variant="solid"
            :loading="deleting"
            :disabled="deleting || count === 0"
            data-testid="am-delete-confirm"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
