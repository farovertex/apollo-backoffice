<script setup lang="ts">
/**
 * FEAT-049 — per-file progress of an upload batch (spec "Upload flow": one row per selected file with
 * `data-state` = `queued | validating | uploading | confirming | done | rejected | error`).
 *
 * Shared by the page and the picker, so the testids are the same in both places (`ml-upload-*`): the state
 * machine lives in `useMediaUpload`, this component only renders it. `rejected` is a client-side refusal
 * (wrong type, too large, undecodable) that never produced a request; `error` is an API or storage failure
 * and carries the server's own message verbatim. A `done` row may still carry the non-blocking ratio note.
 */
import type { MediaUploadItem, MediaUploadState } from '~/composables/useMediaUpload'

defineProps<{
  items: MediaUploadItem[]
}>()

const ICONS: Record<MediaUploadState, string> = {
  queued: 'i-lucide-clock',
  validating: 'i-lucide-loader-circle',
  uploading: 'i-lucide-upload',
  confirming: 'i-lucide-loader-circle',
  done: 'i-lucide-check',
  rejected: 'i-lucide-ban',
  error: 'i-lucide-triangle-alert'
}

const COLORS: Record<MediaUploadState, string> = {
  queued: 'text-muted',
  validating: 'text-muted',
  uploading: 'text-info',
  confirming: 'text-info',
  done: 'text-success',
  rejected: 'text-warning',
  error: 'text-error'
}

const SPINNING: MediaUploadState[] = ['validating', 'confirming']

const LABELS: Record<MediaUploadState, string> = {
  queued: 'รอคิว',
  validating: 'ตรวจไฟล์',
  uploading: 'กำลังอัปโหลด',
  confirming: 'กำลังบันทึก',
  done: 'สำเร็จ',
  rejected: 'ไม่รับไฟล์นี้',
  error: 'ผิดพลาด'
}
</script>

<template>
  <ul
    v-if="items.length > 0"
    class="flex flex-col gap-1 rounded-lg border border-default bg-elevated/40 p-2 text-sm"
    data-testid="ml-upload-list"
  >
    <li
      v-for="item in items"
      :key="item.uid"
      :data-state="item.state"
      data-testid="ml-upload-item"
      class="flex flex-wrap items-center gap-x-2 gap-y-0.5"
    >
      <UIcon
        :name="ICONS[item.state]"
        class="size-4 shrink-0"
        :class="[COLORS[item.state], SPINNING.includes(item.state) ? 'animate-spin' : '']"
      />
      <span class="min-w-0 max-w-full truncate font-medium text-highlighted" data-testid="ml-upload-name">{{ item.filename }}</span>
      <span class="text-xs text-muted">{{ LABELS[item.state] }}</span>
      <span
        v-if="item.message"
        class="w-full text-xs sm:w-auto"
        :class="COLORS[item.state]"
        data-testid="ml-upload-msg"
      >{{ item.message }}</span>
    </li>
  </ul>
</template>
