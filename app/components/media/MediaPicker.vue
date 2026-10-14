<script setup lang="ts">
/**
 * FEAT-049 — reusable image picker for the media library (spec "MediaPicker", AC-21).
 * Mounted nowhere in this feature on purpose: brief B (`ad-template-display-card`) is the first call site —
 *
 *   <MediaPicker v-model:open="pickerOpen" :selected-id="form.imageId" @select="onImage" />
 *
 * It reuses the page's own pieces (`MediaGrid` with `selectable` + `prefix="mp"`, `MediaUploadList`,
 * `useMediaList`, `useMediaUpload`), so the library behaviour is proven once by `/media-library` and the picker
 * cannot drift from it. `GET /media/options` is the module-level cached one — a picker on a page that already
 * loaded the options issues no second request.
 *
 * The list is read when the modal opens (one request), and again per debounced search or after an upload batch.
 * Choosing an image — by clicking its card or by finishing an upload inside the picker — emits `select` with
 * `{ id, name, url, width, height }` and closes the modal; the parent decides what to do with it. There is no
 * pagination here: the search is the way to reach an older image (the grid shows the newest 24).
 */
import type { ModalProps } from '@nuxt/ui'
import type { MediaAssetView, MediaPickerSelection } from '#shared/types/media'
import { MEDIA_PAGE_SIZE, formatMediaBytes, mediaMimeLabels } from '~/utils/media'

const props = withDefaults(defineProps<{
  /** the image the parent currently has selected (highlighted in the grid) */
  selectedId?: string | null
  title?: string
}>(), {
  selectedId: null,
  title: 'เลือกรูปจากคลัง'
})

const emit = defineEmits<{
  select: [selection: MediaPickerSelection]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless: the testid has to go on the rendered dialog content
const modalContent = { 'data-testid': 'mp-modal' } as ModalProps['content']

const list = useMediaList(MEDIA_PAGE_SIZE)
const upload = useMediaUpload()

const chosenId = ref<string | null>(props.selectedId)
watch(() => props.selectedId, (id) => {
  chosenId.value = id
})

const accept = computed(() => upload.options.value?.mimeTypes.join(',') ?? 'image/*')
const uploadHint = computed(() => {
  const options = upload.options.value
  if (!options) return 'กำลังโหลดค่าตั้ง…'
  return `${mediaMimeLabels(options.mimeTypes)} · ไม่เกิน ${formatMediaBytes(options.maxBytes)}`
})

watch(open, (isOpen) => {
  if (!isOpen) return
  upload.clear()
  void list.load()
  void upload.loadOptions()
})

function choose(asset: MediaAssetView) {
  chosenId.value = asset.id
  emit('select', {
    id: asset.id,
    name: asset.name,
    url: asset.url,
    width: asset.width,
    height: asset.height
  })
  open.value = false
}

async function onFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  const created = await upload.uploadFiles(files)
  if (created.length === 0) return
  list.reloadNewest()
  // the image the user just uploaded is the one they wanted (spec: "an upload inside selects the new image")
  const newest = created[created.length - 1]
  if (newest) choose(newest)
}

const showGrid = computed(() => !list.error.value && list.items.value.length > 0)
const showLoading = computed(() => list.pending.value && list.items.value.length === 0)
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :ui="{ content: 'max-w-3xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <UInput
            v-model="list.search.value"
            class="w-full sm:max-w-xs"
            icon="i-lucide-search"
            placeholder="ค้นหาชื่อรูป"
            data-testid="mp-search"
          />

          <div
            class="flex min-w-0 flex-1 flex-col gap-1 rounded-lg border border-dashed border-default p-2"
            data-testid="mp-upload"
          >
            <input
              type="file"
              multiple
              :accept="accept"
              :disabled="!upload.options.value || upload.busy.value"
              class="w-full cursor-pointer rounded-md border border-default bg-default p-1.5 text-sm text-default
                file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-elevated file:px-2 file:py-1
                file:text-sm file:font-medium file:text-default"
              @change="onFiles"
            >
            <span class="text-xs text-muted">{{ uploadHint }}</span>
          </div>
        </div>

        <MediaUploadList :items="upload.items.value" />

        <UAlert
          v-if="list.error.value"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="โหลดคลังรูปไม่ได้"
          :description="list.error.value"
          data-testid="mp-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="list.pending.value"
              data-testid="mp-retry"
              @click="list.load()"
            />
          </template>
        </UAlert>

        <div
          v-else-if="showLoading"
          class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
          data-testid="mp-loading"
        >
          <USkeleton v-for="n in 4" :key="n" class="h-40 w-full rounded-lg" />
        </div>

        <UEmpty
          v-else-if="list.isEmpty.value"
          icon="i-lucide-images"
          :title="list.hasSearch.value ? 'ไม่พบรูปที่ค้นหา' : 'ยังไม่มีรูปในคลัง'"
          description="อัปโหลดไฟล์ด้านบนเพื่อใช้รูปใหม่"
          data-testid="mp-empty"
        />

        <MediaGrid
          v-if="showGrid"
          :items="list.items.value"
          :recommended="upload.options.value?.recommended ?? null"
          prefix="mp"
          selectable
          :selected-id="chosenId"
          @select="choose"
          @refresh="list.reload(undefined, true)"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          label="ยกเลิก"
          color="neutral"
          variant="subtle"
          data-testid="mp-cancel"
          @click="open = false"
        />
      </div>
    </template>
  </UModal>
</template>
