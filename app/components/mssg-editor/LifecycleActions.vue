<script setup lang="ts">
/**
 * FEAT-101 M5 (AC-37, design step 1 rows "ทำสำเนาเว็บ (Duplicate website)" with badge "ธุรกิจ (Business)" and
 * "ลบเว็บ (Delete website)"). Emits only; the page asks for confirmation and starts the job. Each row is disabled with
 * its reason (`title`, `data-reason`, the visible line under the label): delete has its own reason (a GOD outside
 * their own area → `ownAreaOnly`, D6).
 *
 * Test ids: `me-duplicate` (`data-reason`, `data-running`), `me-duplicate-reason`, `me-delete` (`data-reason`,
 * `data-running`), `me-delete-reason`.
 */
const props = defineProps<{
  duplicateReason: string | null
  deleteReason: string | null
  /** which lifecycle job of this site is open (progress shown in its row) */
  runningType: string | null
  progress: string
}>()

const emit = defineEmits<{ duplicate: [], delete: [] }>()

const dupRunning = computed(() => props.runningType === 'mssgSiteDuplicate')
const delRunning = computed(() => props.runningType === 'mssgSiteDelete')
</script>

<template>
  <div class="flex flex-col overflow-hidden rounded-lg border border-default bg-elevated/40">
    <button
      type="button"
      :disabled="!!duplicateReason"
      :title="duplicateReason ?? 'สร้างสำเนาของเว็บนี้ในบัญชีเดียวกัน'"
      :data-reason="duplicateReason ?? ''"
      :data-running="dupRunning ? 'true' : 'false'"
      class="flex min-h-11.5 items-center justify-between gap-3 border-b border-default px-3.5 py-2 text-start text-sm text-highlighted hover:bg-elevated disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent"
      data-testid="me-duplicate"
      @click="emit('duplicate')"
    >
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="flex min-w-0 flex-wrap items-center gap-2">
          {{ MSSG_LIFECYCLE_TEXT.duplicate }}
          <UBadge
            label="ธุรกิจ (Business)"
            color="warning"
            variant="subtle"
            size="sm"
            data-testid="me-duplicate-badge"
          />
        </span>
        <span v-if="dupRunning" class="text-xs text-warning">{{ progress }}</span>
        <span v-else-if="duplicateReason" class="text-xs break-words text-muted" data-testid="me-duplicate-reason">{{ duplicateReason }}</span>
      </span>
      <UIcon :name="dupRunning ? 'i-lucide-loader-circle' : 'i-lucide-copy'" class="size-4 shrink-0" :class="dupRunning ? 'animate-spin' : ''" />
    </button>
    <button
      type="button"
      :disabled="!!deleteReason"
      :title="deleteReason ?? 'ลบเว็บนี้ถาวร (ต้องพิมพ์ชื่อเว็บยืนยัน)'"
      :data-reason="deleteReason ?? ''"
      :data-running="delRunning ? 'true' : 'false'"
      class="flex min-h-11.5 items-center justify-between gap-3 px-3.5 py-2 text-start text-sm text-error hover:bg-error/10 disabled:cursor-not-allowed disabled:text-error/50 disabled:hover:bg-transparent"
      data-testid="me-delete"
      @click="emit('delete')"
    >
      <span class="flex min-w-0 flex-col gap-0.5">
        <span class="min-w-0">{{ MSSG_LIFECYCLE_TEXT.delete }}</span>
        <span v-if="delRunning" class="text-xs text-warning">{{ progress }}</span>
        <span v-else-if="deleteReason" class="text-xs break-words text-muted" data-testid="me-delete-reason">{{ deleteReason }}</span>
      </span>
      <UIcon :name="delRunning ? 'i-lucide-loader-circle' : 'i-lucide-trash-2'" class="size-4 shrink-0" :class="delRunning ? 'animate-spin' : ''" />
    </button>
  </div>
</template>
