<script setup lang="ts">
/**
 * FEAT-101 (D7, D19, AC-25, AC-63..69) — one 🖼 field: thumbnail of the current value, "อัปโหลด (Upload)" (hidden file input),
 * "ลบรูป" when the field is optional. A picked file is checked in the browser (type, ≤ 3 MB) — a rejected file sends
 * nothing — then `POST /mssg-sites/:id/uploads`; the returned `upload:<id>` becomes the field value. Reusable for M3
 * (favicon, OG image, page background) and M4 (product photos).
 * Test ids: `me-upload-<field>` (wrapper, `data-value` = the current value kind: `upload` | `url` | `none`),
 * `me-upload-<field>-input`, `-pick`, `-remove`, `-error`, `-hint`, `-shrinking` (only while a too-large image is shrunk),
 * `-shrunk` (the note after a shrunk upload; `data-from-bytes` / `data-to-bytes` / `data-from-size` / `data-to-size` / `data-mime`).
 * A JPEG / PNG / WebP above 3 MB is shrunk in the browser (`useMssgUpload`).
 */
import { mssgShrinkNote, type MssgShrunk } from '~/utils/mssg-image-shrink'

const props = withDefaults(defineProps<{
  siteId: string
  /** test-id suffix, e.g. `Image.url`, `ImageGallery.images.0.url` */
  field: string
  label?: string
  required?: boolean
  disabled?: boolean
  /** a validation / server message for this field */
  error?: string | null
}>(), { label: '', required: false, disabled: false, error: null })

const model = defineModel<string | null>({ default: null })

const { upload, shrinking } = useMssgUpload(() => props.siteId)
const shrunk = ref<MssgShrunk | null>(null)
const input = useTemplateRef<HTMLInputElement>('input')
const busy = ref(false)
const uploadError = ref<string | null>(null)

const kind = computed(() => (!model.value ? 'none' : model.value.startsWith('upload:') ? 'upload' : 'url'))

function pick() {
  if (props.disabled || busy.value) return
  input.value?.click()
}

async function onFile(e: Event) {
  const el = e.target as HTMLInputElement
  const file = el.files?.[0]
  el.value = ''
  if (!file) return
  uploadError.value = null
  shrunk.value = null
  busy.value = true
  try {
    const res = await upload(file)
    if (res.ok) {
      model.value = res.upload.ref
      shrunk.value = res.shrunk ?? null
    } else uploadError.value = res.message
  } finally {
    busy.value = false
  }
}

function remove() {
  uploadError.value = null
  shrunk.value = null
  model.value = null
}

const message = computed(() => uploadError.value ?? props.error ?? null)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1.5" :data-testid="`me-upload-${field}`" :data-value="kind">
    <span v-if="label" class="text-sm font-medium text-default">{{ label }}<span v-if="required" class="text-error"> *</span></span>
    <div class="flex min-w-0 flex-wrap items-center gap-3">
      <MssgEditorImage
        :site-id="siteId"
        :value="model"
        :alt="label"
        class="size-14 shrink-0 rounded-md border border-default"
      />
      <div class="flex flex-wrap gap-2">
        <UButton
          :label="model ? 'เปลี่ยนรูป' : 'อัปโหลด (Upload)'"
          icon="i-lucide-upload"
          color="neutral"
          variant="outline"
          size="sm"
          :loading="busy"
          :disabled="disabled"
          :data-testid="`me-upload-${field}-pick`"
          @click="pick"
        />
        <UButton
          v-if="model && !required"
          label="ลบรูป"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="sm"
          :disabled="disabled || busy"
          :data-testid="`me-upload-${field}-remove`"
          @click="remove"
        />
      </div>
      <input
        ref="input"
        type="file"
        class="hidden"
        :accept="MSSG_UPLOAD_ACCEPT"
        :disabled="disabled"
        :data-testid="`me-upload-${field}-input`"
        @change="onFile"
      >
    </div>
    <span class="text-xs break-words text-muted" :data-testid="`me-upload-${field}-hint`">{{ MSSG_UPLOAD_TEXT.hint }}</span>
    <span
      v-if="shrinking"
      class="text-xs break-words text-muted"
      role="status"
      :data-testid="`me-upload-${field}-shrinking`"
    >{{ MSSG_UPLOAD_TEXT.shrinking }}</span>
    <span
      v-if="shrunk && !message"
      class="text-xs break-words text-muted"
      :data-testid="`me-upload-${field}-shrunk`"
      :data-from-bytes="shrunk.fromBytes"
      :data-to-bytes="shrunk.toBytes"
      :data-from-size="`${shrunk.fromWidth}x${shrunk.fromHeight}`"
      :data-to-size="`${shrunk.toWidth}x${shrunk.toHeight}`"
      :data-mime="shrunk.mime"
    >{{ mssgShrinkNote(shrunk) }}</span>
    <span
      v-if="message"
      class="text-xs break-words text-error"
      role="alert"
      :data-testid="`me-upload-${field}-error`"
    >{{ message }}</span>
  </div>
</template>
