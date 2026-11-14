<script setup lang="ts">
/**
 * FEAT-101 M3 — editor step 3 "Page decoration · หน้าตาเว็บ" (AC-27, AC-29; contract §3.2 `page.update` theme, §3.3;
 * design step 3). For the selected page: background colour (picker + hex; "ใช้ตามธีม" = `null`) and background image
 * (the B2 upload control; "ลบรูป" = `null`), each emitted as `page.update { theme: { page: { … } } }` (folded by the
 * draft). An invalid hex stays in the field with its Thai message and is never sent.
 * v1.6 (B3r, contract §3.4, AC-43, AC-44):
 * v1.11 (BUG-099): the API writes a preset expanded (colours replace the page's), so the preview theme carries `#rrggbbaa`
 *   colours; the hex field shows them, the apply-all/edit send only API-valid 6 digits.
 * - preset tiles = the 18 `colorId` values with Apollo's own display swatches (one rule line under the tiles, v1.11 D21 h); choosing
 *   one still sends `page.update { theme: { colorId } }` (no `backgroundColor`), `autoTheme` also `light` / `dark` (two selects of the other 17,
 *   defaults `lightTheme` / `darkTheme`);
 * - font select: "ค่าเริ่มต้น" (`null`) + the 38 families grouped google / websafe → `theme.page.font { family, provider }`;
 * - "ใช้กับทุกหน้า" = one `page.update` per page with this page's background colour + image, preset (+ pair) and font.
 * Server messages (draft 400 / apply `mssgValidation`, `pages.<id>.theme.<key>`) arrive as `errors` with a target.
 *
 * Test ids: `me-sheet-3`, `me-look-page` (page select), `me-look-color` (picker), `me-look-hex` (+ `me-look-hex-error`),
 * `me-look-use-theme`, `me-look-bg-label`, `me-upload-Page.backgroundImage(-input|-pick|-remove|-error)`,
 * `me-look-apply-all`, `me-look-apply-all-done`, `me-look-themes` (`data-selected` = colorId), `me-look-theme-<colorId>`
 * (`data-selected`, `data-color-id`), `me-look-auto` / `me-look-auto-light` / `me-look-auto-dark` (native selects),
 * `me-look-theme-rule`, `me-look-theme-error`, `me-look-fonts`, `me-look-font` (native select, value = family or ""),
 * `me-look-font-default` (button), `me-look-font-error`, `me-look-style` (read-only styleId).
 */
import type { MssgFieldError } from '~/utils/mssg-sites'
import type { MssgOp, MssgPageFont, MssgPageProjection, MssgSiteProjection } from '#shared/types/mssg-sites'

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
  if ((c ?? '') !== hex.value && (hex.value === '' || MSSG_HEX_DISPLAY_RE.test(hex.value))) hex.value = c ?? ''
})

const hexInvalid = computed(() => mssgBgColorSchema.safeParse(hex.value).error?.issues[0]?.message ?? null)
function serverError(key: string): string | null {
  const p = page.value
  if (!p) return null
  return props.errors.find(e => e.target.pageId === p.id && e.target.field === `theme.page.${key}`)?.message ?? null
}
const hexError = computed(() => hexInvalid.value ?? serverError('backgroundColor'))
const imageError = computed(() => serverError('backgroundImage'))
function themeServerError(...keys: string[]): string | null {
  const p = page.value
  if (!p) return null
  return props.errors.find(e => e.target.pageId === p.id && keys.includes(e.target.field))?.message ?? null
}
const themeError = computed(() => themeServerError('theme.colorId', 'theme.light', 'theme.dark'))
const fontError = computed(() => themeServerError('theme.page.font', 'theme.page.font.family', 'theme.page.font.provider'))

const pickerValue = computed(() => (MSSG_HEX_DISPLAY_RE.test(hex.value) ? hex.value.slice(0, 7) : '#FFFFFF'))

function setColor(value: string | null) {
  const p = page.value
  if (!p || props.readOnly) return
  emit('pageUpdate', p.id, { theme: { page: { backgroundColor: value } } })
}
function onHex(v: string) {
  const t = v.trim()
  hex.value = t
  if (t === '') setColor(null)
  else if (mssgSendableColor(t)) setColor(mssgSendableColor(t))
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
  // v1.11: the field may show the preset's 8-digit colour; a translucent one cannot be sent (API: 6 digits) and the
  // copied preset gives every page that colour anyway, so the key is left out then (never `null`)
  const color = mssgSendableColor(hex.value)
  const keepColor = color !== null || hex.value === ''
  // v1.6: preset (+ autoTheme pair) and font travel with the background colour + image
  const theme = mssgApplyAllTheme(p.theme)
  theme.page = { ...theme.page, ...(keepColor ? { backgroundColor: color } : {}), backgroundImage: bgImage.value }
  if (!keepColor) delete theme.page.backgroundColor
  for (const target of pages.value) {
    emit('pageUpdate', target.id, { theme: theme as PageFields['theme'] })
  }
  applied.value = pages.value.length
}

// ── v1.6 presets ────────────────────────────────────────────────────────────────────────────────────────────────────
const colorId = computed(() => (typeof page.value?.theme?.colorId === 'string' ? page.value.theme.colorId : ''))
const isAuto = computed(() => colorId.value === MSSG_AUTO_THEME)
const autoLight = computed(() => (typeof page.value?.theme?.light === 'string' && MSSG_AUTO_PAIR_IDS.includes(page.value.theme.light) ? page.value.theme.light : MSSG_AUTO_DEFAULT.light))
const autoDark = computed(() => (typeof page.value?.theme?.dark === 'string' && MSSG_AUTO_PAIR_IDS.includes(page.value.theme.dark) ? page.value.theme.dark : MSSG_AUTO_DEFAULT.dark))
function choosePreset(id: string) {
  const p = page.value
  if (!p || props.readOnly) return
  if (id === colorId.value && id !== MSSG_AUTO_THEME) return
  emit('pageUpdate', p.id, { theme: mssgPresetPatch(id, { light: autoLight.value, dark: autoDark.value }) as PageFields['theme'] })
}
function setPair(which: 'light' | 'dark', id: string) {
  const p = page.value
  if (!p || props.readOnly || !MSSG_AUTO_PAIR_IDS.includes(id)) return
  const pair = { light: autoLight.value, dark: autoDark.value, [which]: id }
  emit('pageUpdate', p.id, { theme: mssgPresetPatch(MSSG_AUTO_THEME, pair) as PageFields['theme'] })
}
function presetName(id: string): string {
  const d = mssgPreset(id)
  return d ? `${d.th} (${d.en})` : id
}

// ── v1.6 fonts ──────────────────────────────────────────────────────────────────────────────────────────────────────
const font = computed<MssgPageFont | null>(() => {
  const f = page.value?.theme?.page?.font
  return mssgFontValid(f) ? f as MssgPageFont : null
})
/** a font read from mssg that is not in the contract's list: shown, kept until the user picks another */
const unknownFont = computed(() => {
  const f = page.value?.theme?.page?.font as { family?: unknown } | null | undefined
  return f && !mssgFontValid(f) && typeof f.family === 'string' ? f.family : null
})
function setFont(family: string) {
  const p = page.value
  if (!p || props.readOnly) return
  const next = family ? mssgFontByFamily(family) : null
  if (family && !next) return
  emit('pageUpdate', p.id, { theme: { page: { font: next ? { ...next } : null } } })
}
const selectClass = 'w-full rounded-md border-0 bg-default px-2.5 py-1.5 text-sm text-highlighted ring ring-inset ring-accented focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-75'

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

      <section class="flex min-w-0 flex-col gap-2.5" data-testid="me-look-themes" :data-selected="colorId">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <span class="text-sm text-default">{{ MSSG_STEP3_TEXT.themes }}</span>
          <span class="text-[11px] text-dimmed">{{ colorId ? `ใช้อยู่: ${presetName(colorId)}` : 'ยังไม่ได้เลือกธีม' }}</span>
        </div>
        <div class="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2" role="radiogroup" aria-label="ธีม">
          <button
            v-for="t in MSSG_PRESETS"
            :key="t.id"
            type="button"
            role="radio"
            :aria-checked="colorId === t.id"
            :disabled="readOnly"
            :title="`${t.en} · ${t.id}`"
            class="flex min-w-0 flex-col gap-1.5 rounded-lg border p-1.5 pb-2 text-center hover:border-primary/60 disabled:cursor-not-allowed disabled:opacity-60"
            :class="colorId === t.id ? 'border-primary ring-2 ring-primary/30' : 'border-default bg-elevated/40'"
            :data-testid="`me-look-theme-${t.id}`"
            :data-color-id="t.id"
            :data-selected="colorId === t.id ? 'true' : 'false'"
            @click="choosePreset(t.id)"
          >
            <span
              aria-hidden="true"
              class="relative flex h-12 items-center justify-center overflow-hidden rounded-md border border-black/5 text-sm font-semibold"
              :style="t.id === MSSG_AUTO_THEME
                ? { background: `linear-gradient(135deg, ${mssgPreset(autoLight)?.bg} 50%, ${mssgPreset(autoDark)?.bg} 50%)`, color: mssgPreset(autoLight)?.fg }
                : { background: t.bg, color: t.fg }"
            >
              Aa
              <span class="absolute inset-x-2 bottom-1.5 h-1 rounded-full" :style="{ background: t.accent }" />
            </span>
            <span class="truncate text-xs text-default">{{ t.th }}</span>
          </button>
        </div>
        <div v-if="isAuto" class="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="me-look-auto">
          <label class="flex min-w-0 flex-col gap-1 text-sm text-default">
            ตอนสว่าง (Light)
            <select
              :value="autoLight"
              :disabled="readOnly"
              :class="selectClass"
              data-testid="me-look-auto-light"
              @change="setPair('light', ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="id in MSSG_AUTO_PAIR_IDS" :key="id" :value="id">{{ presetName(id) }}</option>
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-sm text-default">
            ตอนมืด (Dark)
            <select
              :value="autoDark"
              :disabled="readOnly"
              :class="selectClass"
              data-testid="me-look-auto-dark"
              @change="setPair('dark', ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="id in MSSG_AUTO_PAIR_IDS" :key="id" :value="id">{{ presetName(id) }}</option>
            </select>
          </label>
        </div>
        <span v-if="themeError" class="text-xs text-error" data-testid="me-look-theme-error">{{ themeError }}</span>
        <p class="text-xs text-muted" data-testid="me-look-theme-rule">
          {{ MSSG_STEP3_TEXT.themeRule }}
        </p>
        <span v-if="styleId" class="text-xs break-all text-muted" data-testid="me-look-style">รูปแบบใน mssg: {{ styleId }}</span>
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
                maxlength="9"
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

      <div class="flex min-w-0 flex-col gap-1.5" data-testid="me-look-fonts">
        <label for="me-look-font" class="text-sm text-default">{{ MSSG_STEP3_TEXT.fonts }}</label>
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <select
            id="me-look-font"
            :value="font?.family ?? ''"
            :disabled="readOnly"
            :class="[selectClass, 'sm:max-w-80']"
            :style="font ? { fontFamily: mssgFontCss(font) ?? undefined } : undefined"
            data-testid="me-look-font"
            :data-value="font?.family ?? ''"
            @change="setFont(($event.target as HTMLSelectElement).value)"
          >
            <option value="">
              ค่าเริ่มต้น (Default)
            </option>
            <option v-if="unknownFont" :value="unknownFont" disabled>
              {{ unknownFont }} (ตั้งไว้บน mssg)
            </option>
            <optgroup label="Google fonts">
              <option v-for="f in MSSG_GOOGLE_FONTS" :key="f" :value="f">
                {{ f }}
              </option>
            </optgroup>
            <optgroup label="Web safe">
              <option v-for="f in MSSG_WEBSAFE_FONTS" :key="f" :value="f">
                {{ f }}
              </option>
            </optgroup>
          </select>
          <UButton
            label="ใช้ฟอนต์ค่าเริ่มต้น"
            color="primary"
            variant="link"
            size="xs"
            :disabled="readOnly || (!font && !unknownFont)"
            data-testid="me-look-font-default"
            @click="setFont('')"
          />
        </div>
        <span class="text-xs text-muted">ตัวอย่างใช้ฟอนต์นี้เมื่อเครื่องนี้มีฟอนต์ · หน้าเว็บจริงโหลดฟอนต์จาก mssg</span>
        <span v-if="fontError" class="text-xs text-error" data-testid="me-look-font-error">{{ fontError }}</span>
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
