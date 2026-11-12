<script setup lang="ts">
/**
 * FEAT-101 M3 — editor step 3 "Page decoration · หน้าตาเว็บ" (AC-27, AC-29; contract §3.2 `page.update` theme, §3.3;
 * design step 3). For the selected page: background colour (picker + hex; "ใช้ตามธีม" = `null`) and background image
 * (the B2 upload control; "ลบรูป" = `null`), each emitted as `page.update { theme: { page: { … } } }` (folded by the
 * draft). "ใช้กับทุกหน้า" emits one `page.update` per page with this page's colour + image. An invalid hex stays in the
 * field with its Thai message and is never sent. Theme presets and fonts are **disabled "เร็ว ๆ นี้"** (scope/out: the
 * preset catalog and the font key were never observed) — no handler, no request.
 * Server messages (draft 400 / apply `mssgValidation`, `pages.<id>.theme.page.<key>`) arrive as `errors` with a target.
 *
 * Test ids: `me-sheet-3`, `me-look-page` (page select), `me-look-color` (picker), `me-look-hex` (+ `me-look-hex-error`),
 * `me-look-use-theme`, `me-look-bg-label`, `me-upload-Page.backgroundImage(-input|-pick|-remove|-error)`,
 * `me-look-apply-all`, `me-look-apply-all-done`, `me-look-themes` / `me-look-theme-<n>` / `me-look-fonts` /
 * `me-look-font` (disabled, `data-soon`), `me-look-style` (read-only styleId).
 */
import type { MssgFieldError } from '~/utils/mssg-sites'
import type { MssgOp, MssgPageProjection, MssgSiteProjection } from '#shared/types/mssg-sites'

type PageFields = Extract<MssgOp, { op: 'page.update' }>['fields']

const props = defineProps<{
  siteId: string
  site: MssgSiteProjection | null
  readOnly: boolean
  /** step-3 field errors (target page + `theme.page.<key>`) */
  errors: MssgFieldError[]
  resetToken: number
}>()

const emit = defineEmits<{ pageUpdate: [pageId: string, fields: PageFields] }>()
const selectedId = defineModel<string>('page', { default: '' })

const pages = computed(() => props.site?.pages ?? [])
const homeId = computed(() => props.site?.homePageId ?? pages.value[0]?.id ?? '')
const page = computed<MssgPageProjection | null>(() => pages.value.find(p => p.id === selectedId.value) ?? pages.value.find(p => p.id === homeId.value) ?? pages.value[0] ?? null)
watch(() => page.value?.id, (id) => {
  if (id && id !== selectedId.value) selectedId.value = id
}, { immediate: true })

const pageItems = computed(() => pages.value.map(p => ({ label: `${p.name}${p.id === homeId.value ? ' · หน้าแรก' : ''}`, value: p.id })))

const bgColor = computed(() => {
  const c = page.value?.theme?.page?.backgroundColor
  return typeof c === 'string' ? c : null
})
const bgImage = computed(() => {
  const i = page.value?.theme?.page?.backgroundImage
  return typeof i === 'string' && i ? i : null
})

// the hex field is a local string (an invalid value stays visible); it re-reads the draft on page change / reset
const hex = ref('')
function fromPage() {
  hex.value = bgColor.value ?? ''
}
watch([() => page.value?.id, () => props.resetToken], fromPage, { immediate: true })
// an upstream change of the colour (apply to all, discard…) that the field does not already show
watch(bgColor, (c) => {
  if ((c ?? '') !== hex.value && (hex.value === '' || MSSG_HEX_RE.test(hex.value))) hex.value = c ?? ''
})

const hexInvalid = computed(() => mssgBgColorSchema.safeParse(hex.value).error?.issues[0]?.message ?? null)
function serverError(key: string): string | null {
  const p = page.value
  if (!p) return null
  return props.errors.find(e => e.target.pageId === p.id && e.target.field === `theme.page.${key}`)?.message ?? null
}
const hexError = computed(() => hexInvalid.value ?? serverError('backgroundColor'))
const imageError = computed(() => serverError('backgroundImage'))

const pickerValue = computed(() => (MSSG_HEX_RE.test(hex.value) ? hex.value : '#FFFFFF'))

function setColor(value: string | null) {
  const p = page.value
  if (!p || props.readOnly) return
  emit('pageUpdate', p.id, { theme: { page: { backgroundColor: value } } })
}
function onHex(v: string) {
  const t = v.trim()
  hex.value = t
  if (t === '') setColor(null)
  else if (MSSG_HEX_RE.test(t)) setColor(t.toUpperCase())
}
function onPicker(v: string) {
  hex.value = v.toUpperCase()
  setColor(hex.value)
}
function useTheme() {
  hex.value = ''
  setColor(null)
}
function onImage(v: string | null) {
  const p = page.value
  if (!p || props.readOnly) return
  emit('pageUpdate', p.id, { theme: { page: { backgroundImage: v || null } } })
}

const applied = ref<number | null>(null)
watch([() => page.value?.id, () => props.resetToken], () => {
  applied.value = null
})
function applyAll() {
  const p = page.value
  if (!p || props.readOnly || hexInvalid.value) return
  const color = MSSG_HEX_RE.test(hex.value) ? hex.value.toUpperCase() : null
  for (const target of pages.value) {
    emit('pageUpdate', target.id, { theme: { page: { backgroundColor: color, backgroundImage: bgImage.value } } })
  }
  applied.value = pages.value.length
}

const soonTiles = [1, 2, 3, 4, 5, 6]
const styleId = computed(() => (typeof page.value?.theme?.styleId === 'string' ? page.value.theme.styleId : ''))
</script>

<template>
  <div class="flex flex-col gap-5" data-testid="me-sheet-3">
    <p class="text-sm text-muted">
      หน้าตาของแต่ละหน้า · ดูผลได้ทันทีที่ตัวอย่างด้านขวา
    </p>

    <p v-if="!page" class="rounded-lg border border-dashed border-default px-4 py-8 text-center text-sm text-muted" data-testid="me-look-empty">
      เว็บนี้ยังไม่มีหน้า
    </p>
    <template v-else>
      <UFormField label="หน้าที่จะแก้" name="page">
        <USelect
          v-model="selectedId"
          :items="pageItems"
          class="w-full sm:max-w-80"
          data-testid="me-look-page"
        />
      </UFormField>

      <section class="flex flex-col gap-2.5" data-testid="me-look-themes" data-soon="true">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="text-sm text-default">{{ MSSG_STEP3_TEXT.themes }}</span>
          <span class="text-[11px] text-dimmed">{{ MSSG_SOON }}</span>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2.5">
          <button
            v-for="n in soonTiles"
            :key="n"
            type="button"
            disabled
            :title="MSSG_SOON"
            class="flex cursor-not-allowed flex-col gap-1.5 rounded-lg border border-default bg-elevated/40 p-1.5 pb-2 text-center opacity-60"
            :data-testid="`me-look-theme-${n}`"
          >
            <span aria-hidden="true" class="flex h-14 items-center justify-center rounded-md bg-accented/60">
              <UIcon name="i-lucide-lock" class="size-4 text-dimmed" />
            </span>
            <span class="text-xs text-muted">ธีม {{ n }}</span>
          </button>
        </div>
        <span v-if="styleId" class="text-xs break-all text-muted" data-testid="me-look-style">เลือกอยู่ใน mssg: {{ styleId }}</span>
      </section>

      <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div class="flex min-w-0 flex-col gap-2" data-testid="me-look-bg">
          <UFormField
            label="สีพื้นหลัง (Background color)"
            name="backgroundColor"
            :error="hexError || undefined"
          >
            <div class="flex min-w-0 items-center gap-2">
              <input
                type="color"
                :value="pickerValue"
                :disabled="readOnly"
                aria-label="เลือกสีพื้นหลัง"
                class="h-9.5 w-11 shrink-0 cursor-pointer rounded-md border border-default bg-default p-0.5 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="me-look-color"
                @input="onPicker(($event.target as HTMLInputElement).value)"
              >
              <UInput
                :model-value="hex"
                placeholder="#RRGGBB"
                maxlength="7"
                autocomplete="off"
                spellcheck="false"
                :disabled="readOnly"
                class="min-w-0 flex-1"
                data-testid="me-look-hex"
                @update:model-value="onHex(String($event ?? ''))"
              />
            </div>
            <template #error="{ error }">
              <span v-if="error" data-testid="me-look-hex-error">{{ error }}</span>
            </template>
          </UFormField>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-xs text-muted" data-testid="me-look-bg-label">{{ bgColor ?? 'ตามธีม' }}</span>
            <UButton
              :label="MSSG_STEP3_TEXT.useTheme"
              color="primary"
              variant="link"
              size="xs"
              :disabled="readOnly || (bgColor === null && hex === '')"
              data-testid="me-look-use-theme"
              @click="useTheme"
            />
          </div>
        </div>

        <div class="flex min-w-0 flex-col gap-2">
          <MssgEditorUploadField
            :model-value="bgImage"
            :site-id="siteId"
            field="Page.backgroundImage"
            label="รูปพื้นหลัง (Background image)"
            :disabled="readOnly"
            :error="imageError"
            @update:model-value="onImage"
          />
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-2" data-testid="me-look-fonts" data-soon="true">
        <span class="flex flex-wrap items-baseline justify-between gap-2 text-sm text-default">
          {{ MSSG_STEP3_TEXT.fonts }}
          <span class="text-[11px] text-dimmed">{{ MSSG_SOON }}</span>
        </span>
        <USelect
          :model-value="undefined"
          :items="[]"
          placeholder="เลือกฟอนต์"
          disabled
          class="w-full sm:max-w-80"
          :title="MSSG_SOON"
          data-testid="me-look-font"
        />
      </div>

      <div class="flex flex-col gap-1.5 border-t border-default pt-4">
        <div class="flex flex-wrap items-center gap-3">
          <UButton
            :label="MSSG_STEP3_TEXT.applyAll"
            icon="i-lucide-copy-check"
            color="neutral"
            variant="outline"
            :disabled="readOnly || !!hexInvalid || pages.length < 1"
            data-testid="me-look-apply-all"
            @click="applyAll"
          />
          <span class="min-w-0 text-xs break-words text-muted">{{ MSSG_STEP3_TEXT.applyAllHint }}</span>
        </div>
        <span
          v-if="applied !== null"
          class="text-xs text-success"
          role="status"
          data-testid="me-look-apply-all-done"
        >{{ MSSG_STEP3_TEXT.applyAllDone(applied) }}</span>
      </div>
    </template>
  </div>
</template>
