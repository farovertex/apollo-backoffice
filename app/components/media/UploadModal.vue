<script setup lang="ts">
/**
 * Upload into the media library, in a modal (2026-10-15 — replaces the inline file input of `/media-library`).
 *
 * Why a modal at all: `assetType` is written **once, at upload** and `PATCH /media/:id` cannot change it
 * (api-contract §5.6 takes `name` only), so a wrong type can only be repaired by deleting the image — which the
 * API refuses with 409 `inUse` as soon as a template references it. The inline form made that mistake the
 * default: the select was pre-filled with `add-on` and the file button next to it worked without ever touching
 * it. Here the dropzone stays **disabled until a type is chosen**, so no batch can be uploaded by accident.
 *
 * It owns no request of its own: `useMediaUpload` (shared with the page and `MediaPicker`) runs the same
 * `queued → … → done` state machine, `MediaUploadList` renders it, and every limit still comes from
 * `GET /media/options` — including the recommended size, which since contract **v2** is per `assetType`.
 *
 * The parent gets `uploaded` with the assets that were created (one per batch) and re-reads its list; the modal
 * stays open so several batches can follow each other.
 */
import type { ModalProps } from '@nuxt/ui'
import type { MediaAssetType, MediaAssetView } from '#shared/types/media'
import {
  MEDIA_ASSET_TYPES,
  formatMediaBytes,
  formatMediaDimensions,
  mediaAssetTypeHint,
  mediaAssetTypeLabel,
  mediaMimeLabels,
  mediaRecommendedFor
} from '~/utils/media'

const props = withDefaults(defineProps<{
  /**
   * preselected type — the page passes its current type filter, so "filter to Call-Action, then upload" needs no
   * second decision. `null` (no filter) means nothing is selected and the dropzone starts locked.
   */
  defaultType?: MediaAssetType | null
}>(), {
  defaultType: null
})

const emit = defineEmits<{
  /** one batch finished and created these assets (never empty — a batch that created nothing emits nothing) */
  uploaded: [assets: MediaAssetView[]]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless: the testid has to go on the rendered dialog content
const modalContent = { 'data-testid': 'ml-upload-modal' } as ModalProps['content']

const upload = useMediaUpload()

const assetType = ref<MediaAssetType | null>(props.defaultType)
/** set when the locked dropzone was clicked — the reason is shown instead of silently doing nothing */
const typeMissing = ref(false)
const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
/** how many images this modal created since it was opened (decides the closing button's label) */
const createdCount = ref(0)

const accept = computed(() => upload.options.value?.mimeTypes.join(',') ?? 'image/*')
const ready = computed(() => Boolean(upload.options.value) && !upload.busy.value)
const canPick = computed(() => ready.value && assetType.value !== null)

/** `แนะนำ 750×421` of the chosen type — the one place the per-type size reaches the upload UI */
function recommendedLabel(type: MediaAssetType): string {
  const size = mediaRecommendedFor(upload.options.value?.recommended, type)
  return size ? `แนะนำ ${formatMediaDimensions(size.width, size.height)}` : ''
}

const limitsHint = computed(() => {
  const options = upload.options.value
  if (!options) return 'กำลังโหลดค่าตั้ง…'
  const parts = [mediaMimeLabels(options.mimeTypes), `ไม่เกิน ${formatMediaBytes(options.maxBytes)}`]
  if (assetType.value) parts.push(recommendedLabel(assetType.value))
  return parts.filter(Boolean).join(' · ')
})

watch(open, (isOpen) => {
  if (!isOpen) return
  // a fresh modal: the previous batch's rows never belong to this one
  upload.clear()
  assetType.value = props.defaultType
  typeMissing.value = false
  dragging.value = false
  createdCount.value = 0
  void upload.loadOptions()
})

watch(assetType, (type) => {
  if (type) typeMissing.value = false
})

function pick() {
  if (!canPick.value) {
    typeMissing.value = assetType.value === null
    return
  }
  fileInput.value?.click()
}

async function run(files: File[]) {
  const type = assetType.value
  if (!type || files.length === 0) return
  const created = await upload.uploadFiles(files, type)
  if (created.length === 0) return
  createdCount.value += created.length
  emit('uploaded', created)
}

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  // the same file can be picked again right after (change only fires on a different value)
  input.value = ''
  await run(files)
}

async function onDrop(event: DragEvent) {
  dragging.value = false
  if (!canPick.value) {
    typeMissing.value = assetType.value === null
    return
  }
  await run(Array.from(event.dataTransfer?.files ?? []))
}

function onDragOver() {
  if (canPick.value) dragging.value = true
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="อัปโหลดรูปเข้าคลัง"
    description="เลือกประเภทของรูป แล้วลากไฟล์มาวางหรือเลือกไฟล์"
    :dismissible="!upload.busy.value"
    :ui="{ content: 'max-w-2xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <!-- 1. ประเภท — ไม่มีค่าตั้งต้นเมื่อไม่ได้กรองไว้ (เลือกผิดแล้วแก้ไม่ได้) -->
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium text-highlighted">1 · รูปนี้ใช้ทำอะไร</span>

          <div
            role="radiogroup"
            aria-label="ประเภทของรูปที่จะอัปโหลด"
            class="grid gap-2 sm:grid-cols-2"
            data-testid="ml-upload-type"
          >
            <label
              v-for="type in MEDIA_ASSET_TYPES"
              :key="type"
              class="flex cursor-pointer flex-col gap-0.5 rounded-lg border p-3 transition-colors
                has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60
                has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40"
              :class="assetType === type
                ? 'border-primary bg-primary/5'
                : 'border-default hover:border-primary/60'"
              :data-testid="`ml-upload-type-${type}`"
              :data-checked="assetType === type ? 'true' : 'false'"
            >
              <input
                v-model="assetType"
                type="radio"
                name="ml-upload-type"
                :value="type"
                :disabled="upload.busy.value"
                class="sr-only"
              >
              <span class="flex items-center gap-2 text-sm font-medium text-highlighted">
                <UIcon
                  :name="assetType === type ? 'i-lucide-circle-check' : 'i-lucide-circle'"
                  class="size-4 shrink-0"
                  :class="assetType === type ? 'text-primary' : 'text-muted'"
                />
                {{ mediaAssetTypeLabel(type) }}
              </span>
              <span class="text-xs text-muted">{{ mediaAssetTypeHint(type) }}</span>
              <span class="text-xs text-muted">{{ recommendedLabel(type) }}</span>
            </label>
          </div>

          <span
            v-if="typeMissing"
            class="text-xs text-error"
            data-testid="ml-upload-type-missing"
          >เลือกประเภทก่อนจึงจะเลือกไฟล์ได้ (เปลี่ยนประเภทภายหลังไม่ได้)</span>
        </div>

        <!-- 2. ไฟล์ — ล็อกจนกว่าจะเลือกประเภท -->
        <div class="flex flex-col gap-2">
          <span class="text-sm font-medium text-highlighted">2 · เลือกไฟล์</span>

          <!--
            never `disabled` / `aria-disabled` while no type is chosen: the click is what explains the lock
            ("เลือกประเภทก่อน…"). A disabled button would swallow it and the user would be left guessing.
          -->
          <button
            type="button"
            class="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed p-6 text-center transition-colors"
            :class="[
              canPick ? 'cursor-pointer' : 'cursor-not-allowed opacity-70',
              dragging ? 'border-primary bg-primary/5' : 'border-default',
              canPick && !dragging ? 'hover:border-primary/60 hover:bg-elevated/40' : ''
            ]"
            :data-dragging="dragging ? 'true' : 'false'"
            :data-locked="canPick ? 'false' : 'true'"
            data-testid="ml-upload-dropzone"
            @click="pick"
            @dragover.prevent="onDragOver"
            @dragenter.prevent="onDragOver"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
          >
            <UIcon name="i-lucide-upload-cloud" class="size-7 text-muted" />
            <span class="text-sm text-default">ลากไฟล์มาวาง หรือ <span class="font-medium text-primary">เลือกไฟล์</span></span>
            <span class="text-xs text-muted" data-testid="ml-upload-hint">{{ limitsHint }}</span>
          </button>

          <!-- the real input: visually hidden, but a test still sets its files directly -->
          <input
            ref="fileInput"
            type="file"
            multiple
            :accept="accept"
            :disabled="!canPick"
            class="sr-only"
            data-testid="ml-upload-input"
            @change="onFiles"
          >
        </div>

        <UAlert
          v-if="upload.optionsError.value"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="โหลดค่าตั้งคลังรูปไม่ได้"
          :description="upload.optionsError.value"
          data-testid="ml-options-error"
        />

        <MediaUploadList :items="upload.items.value" />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end">
        <UButton
          :label="createdCount > 0 ? 'เสร็จสิ้น' : 'ปิด'"
          :color="createdCount > 0 ? 'primary' : 'neutral'"
          :variant="createdCount > 0 ? 'solid' : 'subtle'"
          :disabled="upload.busy.value"
          data-testid="ml-upload-done"
          @click="open = false"
        />
      </div>
    </template>
  </UModal>
</template>
