<script setup lang="ts">
/**
 * FEAT-101 M2 (AC-22, AC-23, AC-26; contract §3.3; design "generic form per kind" + the Link block editor) — the form
 * of one block kind, used both for a new block ("เพิ่ม block นี้ (Add)" / "ยกเลิก", design `gf.isDraft`) and for
 * editing an existing one.
 *
 * Rules: one zod schema per kind (`MSSG_BLOCK_SCHEMAS`, Thai messages), `UForm` validates on input only (BUG-091: `change`/blur
 * validation removed the error line on mousedown, the submit button shifted and the click was lost; submit validates all).
 * - new: `submit` fires only through `UForm` (valid), with the block `fields` and "แสดง block นี้ทันที" (`enabled`).
 * - edit: every change that leaves the whole form valid emits `change` with the keys changed since the form opened
 *   (a key once changed keeps being sent, so changing it back also reaches the draft); an invalid state sends nothing.
 * Server messages (draft 400, apply `mssgValidation`) arrive in `errors` keyed by field path (`title`, `items.0.title`).
 * v1.6 (B2r): proven shapes (Hat `title/subtitle/logoUrl/bgUrl`, Features `content` + icon glyph, Messengers platform /
 * type pairs, gallery image actions), the actions of §3.4 (`ActionFields`), the "รูปแบบ" section (`BlockStyle`, its
 * touched keys go out as `fields.theme.blocks.<kind>`).
 * v1.9 (B9, §3.5, AC-59 / AC-60): a Link block edits its links (`fields.items`, 1–30): title, action (`ActionFields`,
 * prefix `items.<j>.action`) and icon (`GlyphPicker`) per row; "+ เพิ่มลิงก์" adds a row **inside** the block; rows move
 * up / down and are removed (never the last); each item keeps its `id`, new rows have none; the card `image` is shown
 * read-only and never sent. Features items pick their icon with the same picker (emoji / icon, no image, required).
 * Errors / conflicts of a link land on its row (`items.<j>.<leaf>`, `j` = index in the list sent) or on the list (`items`).
 *
 * Test ids: `me-block-form` (`data-kind`, `data-mode`), fields `me-block-field-<path>` + `me-block-field-error-<path>`,
 * uploads `me-upload-<Kind>.<path>`, list rows `me-block-item-<i>` (`data-readonly` for a Messengers platform Apollo cannot
 * edit), `me-block-item-add`, `me-block-item-remove-<i>`, `me-block-link-action`, `me-block-link-page`, `me-block-image-action`,
 * `me-block-field-images.<i>.action.type`, the action inputs of `ActionFields`, the style section of `BlockStyle`,
 * `me-block-new-enabled`, `me-block-new-ok`, `me-block-new-cancel`, `me-block-form-close`;
 * Link (v1.9): `me-block-link-items` (`data-count`), rows `me-block-link-item-<j>` (`data-item-id`), `me-block-field-items.<j>.title`,
 * `me-block-field-items.<j>.action.type` + the `ActionFields` ids under `items.<j>.action`, `me-glyph-items.<j>` (picker),
 * `me-block-link-item-up-<j>` / `-down-<j>` / `-remove-<j>`, `me-block-link-item-image-<j>` (read-only card image),
 * `me-block-link-add`, `me-block-link-limit`, errors `me-block-field-error-items`, `me-block-field-error-items.<j>[.<leaf>]`,
 * conflicts `me-block-link-conflict` (list) / `me-block-link-item-conflict-<j>`; Features: `me-glyph-items.<i>`,
 * `me-block-field-error-items.<i>.glyph`.
 */
import type { MssgPageProjection } from '#shared/types/mssg-sites'

const props = withDefaults(defineProps<{
  kind: string
  /** the block's current fields (edit) or `{}` (new → defaults of the kind) */
  fields: Record<string, unknown>
  mode: 'new' | 'edit'
  siteId: string
  /** pages of the draft with their blocks (internal page / anchor targets) */
  pages: MssgPageProjection[]
  readOnly?: boolean
  /** server messages by field path */
  errors?: Record<string, string>
  /** v1.6: the page's style defaults of this kind (`mssgStyleDefaults`), `null` = nothing to adjust */
  styleDefaults?: Record<string, unknown> | null
  /** v1.9: conflict items of this block by field path (`items`, `items.1.title` …) */
  conflicts?: Record<string, { kind: 'changed' | 'gone' }>
}>(), { readOnly: false, errors: () => ({}), styleDefaults: null, conflicts: () => ({}) })

const emit = defineEmits<{
  change: [fields: Record<string, unknown>]
  submit: [payload: { fields: Record<string, unknown>, enabled: boolean }]
  cancel: []
  close: []
}>()

const def = computed(() => MSSG_BLOCK_KINDS.find(k => k.kind === props.kind))
/** the kind's rules with the draft's pages, so an internal page / anchor must exist in the preview (contract §3.4) */
const schema = computed(() => mssgBlockSchema(props.kind, { pages: props.pages }))

function newDefaults(): Record<string, unknown> {
  return mssgBlockDefaults(props.kind)
}
const original = props.mode === 'new' ? newDefaults() : JSON.parse(JSON.stringify(props.fields ?? {})) as Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the state's shape depends on the kind (zod checks it)
const state = reactive<Record<string, any>>(mssgBlockToForm(props.kind, original))
/** what the untouched form would send — the base of "changed" */
const baseline = mssgFormToBlock(props.kind, mssgBlockToForm(props.kind, original), original)
const touched = new Set<string>()
const showNow = ref(true)

function err(path: string): string | null {
  return props.errors?.[path] ?? null
}

// v1.6 style override: the keys touched in `BlockStyle` (value or `null`) and whether they are all valid
const styleTouched = shallowRef<Record<string, unknown>>({})
const styleValid = ref(true)
function onStyle(p: { touched: Record<string, unknown>, valid: boolean }) {
  styleTouched.value = p.touched
  styleValid.value = p.valid
}

watch([state, styleTouched, styleValid], () => {
  if (props.mode !== 'edit' || props.readOnly || !schema.value) return
  if (!styleValid.value || !schema.value.safeParse(state).success) return
  const next = mssgFormToBlock(props.kind, state, original)
  for (const k of Object.keys(mssgChangedKeys(next, baseline))) touched.add(k)
  const out: Record<string, unknown> = Object.fromEntries([...touched].map(k => [k, next[k]]))
  const theme = mssgStylePatch(props.kind, styleTouched.value)
  if (theme) out.theme = theme
  if (!Object.keys(out).length) return
  emit('change', out)
}, { deep: true })

function onSubmit() {
  if (!styleValid.value) return
  const fields = mssgCreateFields(props.kind, mssgFormToBlock(props.kind, state, original))
  const theme = mssgStylePatch(props.kind, styleTouched.value, true)
  if (theme) fields.theme = theme
  emit('submit', { fields, enabled: showNow.value })
}

// ── lists ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const LIST_KEY: Record<string, string> = {
  ImageGallery: 'images',
  VideoGallery: 'videos',
  Accordion: 'items',
  Features: 'items',
  Messengers: 'messengers',
  Socials: 'items',
  SubscriptionForm: 'items'
}
const LIST_MAX: Record<string, number> = { ImageGallery: 20, VideoGallery: 20, Accordion: 50, Features: 20, Messengers: 10, Socials: 30, SubscriptionForm: 10 }
const ADD_LABEL: Record<string, string> = {
  ImageGallery: '+ เพิ่มรูป (Add image)',
  VideoGallery: '+ เพิ่มวิดีโอ (Add video)',
  Accordion: '+ เพิ่มคำถาม (Add question)',
  Features: '+ เพิ่มจุดเด่น (Add feature)',
  Messengers: '+ เพิ่มปุ่มแชท (Add messenger)',
  Socials: '+ เพิ่มลิงก์โซเชียล (Add social network link)',
  SubscriptionForm: '+ เพิ่มช่อง (Add one more field)'
}
const listKey = computed(() => LIST_KEY[props.kind] ?? null)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows keep the keys read from mssg
const rows = computed<any[]>(() => (listKey.value && Array.isArray(state[listKey.value]) ? state[listKey.value] : []))

function addRow() {
  const key = listKey.value
  if (!key) return
  const first = (newDefaults()[key] as unknown[] | undefined)?.[0] ?? {}
  const row = JSON.parse(JSON.stringify(first)) as Record<string, unknown>
  row._key = mssgRowKey()
  if (props.kind === 'SubscriptionForm') Object.assign(row, { type: 'text', label: '', required: false })
  state[key] = [...rows.value, row]
}
function removeRow(i: number) {
  const key = listKey.value
  if (!key) return
  state[key] = rows.value.filter((_, k) => k !== i)
}

// ── actions (ActionFields) · server messages below an action path ───────────────────────────────────────────────────
function actionErrors(prefix: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(props.errors ?? {})) {
    if (k.startsWith(`${prefix}.`)) out[k.slice(prefix.length + 1)] = v
  }
  return out
}

// ── Messengers (contract §3.4 pairs; a platform Apollo does not know is read-only) ──────────────────────────────────
const platformItems = MSSG_MESSENGER_PLATFORMS.map(p => ({ label: MSSG_MESSENGER_PLATFORM_LABEL[p] ?? p, value: p }))
function typeItems(platform: unknown) {
  return (MSSG_MESSENGER_TYPES[String(platform)] ?? []).map(t => ({ label: MSSG_MESSENGER_TYPE_LABEL[t] ?? t, value: t }))
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows keep the keys read from mssg
function setPlatform(row: any, platform: string) {
  row.platform = platform
  row.type = mssgMessengerTypeFor(platform, row.type)
}

// ── Link items (v1.9 §3.5) ──────────────────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows keep the keys read from mssg
const linkRows = computed<any[]>(() => (props.kind === 'Link' && Array.isArray(state.items) ? state.items : []))
const linkFull = computed(() => !mssgLinkCanAdd(linkRows.value.length))
function addLink() {
  if (props.readOnly || linkFull.value) return
  state.items = [...linkRows.value, { _key: mssgRowKey(), title: '', action: { type: 'url', url: '' }, glyph: null, _glyph0: null }]
}
function moveLink(j: number, dir: -1 | 1) {
  if (!props.readOnly) state.items = mssgRowsMove(linkRows.value, j, dir)
}
function removeLink(j: number) {
  if (!props.readOnly) state.items = mssgRowsRemove(linkRows.value, j)
}
/** the card picture of an item (`image.url`, read-only, ⚠K29) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- rows keep the keys read from mssg
function cardImage(row: any): string | null {
  const url = row?.image?.url
  return typeof url === 'string' && url ? url : null
}
/** server messages of row `j` that have no input of their own (`items.<j>`, `items.<j>.id`, `items.<j>.image` …) */
function rowOtherErrors(j: number): [string, string][] {
  const p = `items.${j}`
  return Object.entries(props.errors ?? {}).filter(([k]) => {
    if (k !== p && !k.startsWith(`${p}.`)) return false
    const rest = k.slice(p.length + 1)
    return !(rest === 'title' || rest === 'glyph' || rest.startsWith('glyph.') || rest.startsWith('action.'))
  })
}
/** server messages below a glyph (`items.<j>.glyph.type` …) — shown beside the picker with their own path */
function glyphSubErrors(j: number): [string, string][] {
  return Object.entries(props.errors ?? {}).filter(([k]) => k.startsWith(`items.${j}.glyph.`))
}
function conflictText(c: { kind: 'changed' | 'gone' } | undefined, list = false): string {
  if (!c) return ''
  if (c.kind === 'gone') return 'ลิงก์นี้ถูกลบบน mssg ระหว่างที่คุณแก้ร่าง · ดูกล่องค่าที่เปลี่ยนด้านบน'
  return list
    ? 'รายการลิงก์บน mssg เปลี่ยนระหว่างที่คุณแก้ร่าง · ดูกล่องค่าที่เปลี่ยนด้านบน'
    : 'ลิงก์นี้ถูกแก้บน mssg ระหว่างที่คุณแก้ร่าง · ดูกล่องค่าที่เปลี่ยนด้านบน'
}
function rowConflict(j: number) {
  const p = `items.${j}`
  const hit = Object.entries(props.conflicts ?? {}).find(([k]) => k === p || k.startsWith(`${p}.`))
  return hit?.[1]
}

// ── style (BlockStyle): server messages of `theme.blocks.<kind>.<key>` by key ──────────────────────────────────────
const styleErrors = computed(() => {
  const prefix = `theme.blocks.${mssgStyleKindKey(props.kind)}.`
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(props.errors ?? {})) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
  }
  return out
})

const textHasFormatting = computed(() => props.kind === 'TextRich' && mssgHtmlHasFormatting(String(original.html ?? '')))
const T = 'me-block-field'
</script>

<template>
  <UForm
    :schema="schema ?? undefined"
    :state="state"
    :validate-on="['input']"
    :disabled="readOnly"
    class="flex min-w-0 flex-col gap-4 rounded-lg border border-primary/40 bg-default p-3 sm:p-4"
    data-testid="me-block-form"
    :data-kind="kind"
    :data-mode="mode"
    @submit="onSubmit"
  >
    <div class="flex flex-wrap items-center gap-2">
      <UBadge :label="def?.en ?? kind" color="primary" variant="subtle" />
      <span class="min-w-0 flex-1 text-sm font-medium break-words text-highlighted">
        {{ mode === 'new' ? `เพิ่ม block ${def?.th ?? kind}` : `แก้ block ${def?.th ?? kind}` }}
      </span>
      <UButton
        v-if="mode === 'edit'"
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        size="sm"
        aria-label="ปิดตั้งค่า block"
        data-testid="me-block-form-close"
        @click="emit('close')"
      />
    </div>

    <!-- Hat -->
    <template v-if="kind === 'Hat'">
      <div class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <UFormField name="logoUrl" :error="err('logoUrl') || undefined">
          <MssgEditorUploadField
            v-model="state.logoUrl"
            :site-id="siteId"
            field="Hat.logoUrl"
            label="รูปโปรไฟล์ (Logo)"
            :disabled="readOnly"
          />
          <template #error="{ error: e }">
            <span v-if="e" data-testid="me-block-field-error-logoUrl">{{ e }}</span>
          </template>
        </UFormField>
        <UFormField name="bgUrl" :error="err('bgUrl') || undefined">
          <MssgEditorUploadField
            v-model="state.bgUrl"
            :site-id="siteId"
            field="Hat.bgUrl"
            label="ภาพปก (Cover)"
            :disabled="readOnly"
          />
          <template #error="{ error: e }">
            <span v-if="e" data-testid="me-block-field-error-bgUrl">{{ e }}</span>
          </template>
        </UFormField>
      </div>
      <MssgEditorFormText
        v-model="state.title"
        name="title"
        label="ชื่อ (Title)"
        :testid="T"
        :maxlength="250"
        counter
        :error="err('title')"
      />
      <MssgEditorFormText
        v-model="state.subtitle"
        name="subtitle"
        label="คำอธิบายสั้น (Subtitle)"
        :testid="T"
        textarea
        :rows="2"
        :maxlength="500"
        counter
        :error="err('subtitle')"
      />
    </template>

    <!-- Link (v1.9: the block's links) -->
    <template v-else-if="kind === 'Link'">
      <div class="flex min-w-0 flex-col gap-2" data-testid="me-block-link-items" :data-count="linkRows.length">
        <UFormField name="items" :error="err('items') || undefined">
          <template #error="{ error: e }">
            <span v-if="e" data-testid="me-block-field-error-items">{{ e }}</span>
          </template>
        </UFormField>
        <p
          v-if="conflicts.items"
          class="rounded-md bg-warning/10 px-2 py-1 text-xs break-words text-warning"
          data-testid="me-block-link-conflict"
        >
          {{ conflictText(conflicts.items, true) }}
        </p>
        <div
          v-for="(row, j) in linkRows"
          :key="row._key ?? j"
          class="flex min-w-0 flex-col gap-2.5 rounded-md border bg-elevated/40 p-2.5"
          :class="rowConflict(j) ? 'border-warning/60' : 'border-default'"
          :data-testid="`me-block-link-item-${j}`"
          :data-item-id="row.id ?? ''"
        >
          <div class="flex min-w-0 items-center justify-between gap-2">
            <span class="text-xs font-medium text-muted">ลิงก์ที่ {{ j + 1 }}</span>
            <div class="flex shrink-0 items-center gap-0.5">
              <UButton
                icon="i-lucide-arrow-up"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="เลื่อนลิงก์ขึ้น"
                :disabled="readOnly || j === 0"
                :data-testid="`me-block-link-item-up-${j}`"
                @click="moveLink(j, -1)"
              />
              <UButton
                icon="i-lucide-arrow-down"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="เลื่อนลิงก์ลง"
                :disabled="readOnly || j === linkRows.length - 1"
                :data-testid="`me-block-link-item-down-${j}`"
                @click="moveLink(j, 1)"
              />
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                aria-label="ลบลิงก์"
                :disabled="readOnly || linkRows.length <= 1"
                :title="linkRows.length <= 1 ? 'block ลิงก์ต้องมีอย่างน้อย 1 ลิงก์' : undefined"
                :data-testid="`me-block-link-item-remove-${j}`"
                @click="removeLink(j)"
              />
            </div>
          </div>
          <p
            v-if="rowConflict(j)"
            class="rounded-md bg-warning/10 px-2 py-1 text-xs break-words text-warning"
            :data-testid="`me-block-link-item-conflict-${j}`"
          >
            {{ conflictText(rowConflict(j)) }}
          </p>
          <span
            v-for="[k, m] in rowOtherErrors(j)"
            :key="k"
            class="text-xs break-words text-error"
            :data-testid="`me-block-field-error-${k}`"
          >{{ m }}</span>
          <div class="flex min-w-0 flex-col gap-1.5">
            <span class="text-sm font-medium text-default">{{ MSSG_GLYPH_TEXT.label }}</span>
            <UFormField :name="`items.${j}.glyph`" :error="err(`items.${j}.glyph`) || undefined">
              <MssgEditorGlyphPicker
                v-model="row.glyph"
                :scope="`items.${j}`"
                :site-id="siteId"
                :rules="MSSG_GLYPH_LINK"
                :read-only="readOnly"
              />
              <template #error="{ error: e }">
                <span v-if="e" :data-testid="`me-block-field-error-items.${j}.glyph`">{{ e }}</span>
              </template>
            </UFormField>
            <span
              v-for="[k, m] in glyphSubErrors(j)"
              :key="k"
              class="text-xs break-words text-error"
              :data-testid="`me-block-field-error-${k}`"
            >{{ m }}</span>
          </div>
          <MssgEditorFormText
            v-model="row.title"
            :name="`items.${j}.title`"
            label="ชื่อลิงก์ (Link title)"
            placeholder="Enter title"
            :testid="T"
            :maxlength="250"
            required
            :error="err(`items.${j}.title`)"
          />
          <MssgEditorActionFields
            v-model="row.action"
            :prefix="`items.${j}.action`"
            :type-testid="`me-block-field-items.${j}.action.type`"
            :pages="pages"
            :read-only="readOnly"
            :errors="actionErrors(`items.${j}.action`)"
          />
          <span v-if="err(`items.${j}.action`)" class="text-xs text-error" :data-testid="`me-block-field-error-items.${j}.action`">{{ err(`items.${j}.action`) }}</span>
          <div
            v-if="cardImage(row)"
            class="flex min-w-0 items-center gap-2 text-xs text-muted"
            :data-testid="`me-block-link-item-image-${j}`"
          >
            <MssgEditorImage
              :site-id="siteId"
              :value="cardImage(row)"
              alt="รูปการ์ด"
              class="size-10 shrink-0 rounded border border-default"
            />
            <span class="min-w-0 break-words">รูปการ์ดจาก mssg · แก้ที่ mssg</span>
          </div>
        </div>
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <UButton
            label="+ เพิ่มลิงก์ (Add one more link)"
            color="primary"
            variant="soft"
            size="sm"
            :disabled="readOnly || linkFull"
            :title="linkFull ? `ลิงก์ใน block เดียวได้ไม่เกิน ${MSSG_LINK_ITEMS_MAX} ลิงก์` : undefined"
            data-testid="me-block-link-add"
            @click="addLink"
          />
          <span v-if="linkFull" class="text-xs text-muted" data-testid="me-block-link-limit">
            ครบ {{ MSSG_LINK_ITEMS_MAX }} ลิงก์แล้ว · เพิ่ม block ลิงก์ใหม่ถ้าต้องการมากกว่านี้
          </span>
        </div>
      </div>
    </template>

    <!-- TextRich -->
    <template v-else-if="kind === 'TextRich'">
      <MssgEditorFormText
        v-model="state.text"
        name="text"
        label="ข้อความ (Text)"
        placeholder="Enter text"
        :testid="T"
        textarea
        :rows="5"
        :maxlength="20000"
        required
        :error="err('html') || err('text')"
      />
      <span v-if="textHasFormatting" class="text-xs text-warning" data-testid="me-block-text-formatting">
        ข้อความนี้มีรูปแบบ (ตัวหนา ลิงก์ รายการ ฯลฯ) ที่ตั้งไว้บน mssg · ถ้าแก้ที่นี่ จะเหลือเป็นข้อความธรรมดา
      </span>
    </template>

    <!-- Image -->
    <template v-else-if="kind === 'Image'">
      <UFormField name="url" :error="err('url') || undefined">
        <MssgEditorUploadField
          v-model="state.url"
          :site-id="siteId"
          field="Image.url"
          label="รูปภาพ (Image)"
          required
          :disabled="readOnly"
        />
        <template #error="{ error: e }">
          <span v-if="e" data-testid="me-block-field-error-url">{{ e }}</span>
        </template>
      </UFormField>
      <MssgEditorActionFields
        v-model="state.action"
        prefix="action"
        image
        type-testid="me-block-image-action"
        :pages="pages"
        :read-only="readOnly"
        :errors="actionErrors('action')"
      />
      <span v-if="err('action')" class="text-xs text-error" data-testid="me-block-field-error-action">{{ err('action') }}</span>
    </template>

    <!-- single URL kinds -->
    <MssgEditorFormText
      v-else-if="kind === 'Video'"
      v-model="state.url"
      name="url"
      label="ลิงก์วิดีโอ (Video URL)"
      placeholder="Enter video URL"
      :testid="T"
      required
      :error="err('url')"
    />
    <MssgEditorFormText
      v-else-if="kind === 'AudioEmbed'"
      v-model="state.url"
      name="url"
      label="ลิงก์เพลง (Music URL)"
      placeholder="Enter URL"
      description="รองรับ YouTube Music, Spotify, Apple Music, SoundCloud, Mixcloud"
      :testid="T"
      required
      :error="err('url')"
    />
    <MssgEditorFormText
      v-else-if="kind === 'Giphy'"
      v-model="state.giphyId"
      name="giphyId"
      label="รหัส GIF (Giphy ID)"
      placeholder="เช่น 3o7aD2saalBwwftBIY"
      description="ส่วนท้ายของลิงก์ giphy.com/gifs/…"
      :testid="T"
      :maxlength="100"
      required
      :error="err('giphyId')"
    />
    <MssgEditorFormText
      v-else-if="kind === 'Map'"
      v-model="state.address"
      name="address"
      label="ที่อยู่ (Address)"
      placeholder="Enter address"
      description="ใส่เป็นที่อยู่ หรือพิกัด เช่น 13.7563,100.5018 · 10–300 ตัวอักษร"
      :testid="T"
      textarea
      :rows="2"
      :maxlength="300"
      required
      :error="err('address')"
    />
    <MssgEditorFormText
      v-else-if="kind === 'Timer'"
      v-model="state.local"
      name="local"
      type="datetime-local"
      label="วันเวลาสิ้นสุด (Timer countdown date & time)"
      :testid="T"
      required
      :error="err('expireDate')"
    />
    <MssgEditorFormText
      v-else-if="kind === 'CustomCode'"
      v-model="state.content"
      name="content"
      label="โค้ด HTML"
      placeholder="Fill in custom HTML-code"
      :testid="T"
      textarea
      :rows="6"
      :maxlength="30000"
      counter
      required
      :error="err('content')"
    />
    <p v-else-if="kind === 'Divider' || kind === 'Products'" class="text-sm text-muted" data-testid="me-block-no-fields">
      {{ kind === 'Products' ? 'แสดงสินค้าของร้าน (แก้สินค้าในขั้นที่ 5)' : 'เส้นคั่นระหว่าง block' }} · block นี้ไม่มีช่องให้กรอก
    </p>

    <!-- list kinds -->
    <div v-if="listKey" class="flex min-w-0 flex-col gap-2">
      <UFormField :name="listKey" :error="err(listKey) || undefined">
        <template #error="{ error: e }">
          <span v-if="e" :data-testid="`me-block-field-error-${listKey}`">{{ e }}</span>
        </template>
      </UFormField>
      <div
        v-for="(row, i) in rows"
        :key="row._key ?? i"
        class="flex min-w-0 flex-col gap-2 rounded-md border border-default bg-elevated/40 p-2.5"
        :data-testid="`me-block-item-${i}`"
      >
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs font-medium text-muted">รายการที่ {{ i + 1 }}</span>
          <UButton
            icon="i-lucide-trash-2"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="ลบรายการ"
            :disabled="readOnly || rows.length <= 1"
            :title="rows.length <= 1 ? 'ต้องมีอย่างน้อย 1 รายการ' : undefined"
            :data-testid="`me-block-item-remove-${i}`"
            @click="removeRow(i)"
          />
        </div>
        <template v-if="kind === 'ImageGallery'">
          <UFormField :name="`images.${i}.url`" :error="err(`images.${i}.url`) || undefined">
            <MssgEditorUploadField
              v-model="row.url"
              :site-id="siteId"
              :field="`ImageGallery.images.${i}.url`"
              required
              :disabled="readOnly"
            />
            <template #error="{ error: e }">
              <span v-if="e" :data-testid="`me-block-field-error-images.${i}.url`">{{ e }}</span>
            </template>
          </UFormField>
          <MssgEditorActionFields
            v-model="row.action"
            :prefix="`images.${i}.action`"
            image
            :type-testid="`me-block-field-images.${i}.action.type`"
            :pages="pages"
            :read-only="readOnly"
            :errors="actionErrors(`images.${i}.action`)"
          />
        </template>
        <MssgEditorFormText
          v-else-if="kind === 'VideoGallery' || kind === 'Socials'"
          v-model="row.url"
          :name="`${listKey}.${i}.url`"
          :label="kind === 'Socials' ? 'ลิงก์โซเชียล' : 'ลิงก์วิดีโอ'"
          :placeholder="kind === 'Socials' ? 'https://instagram.com/...' : 'Enter video URL'"
          :testid="T"
          required
          :error="err(`${listKey}.${i}.url`)"
        />
        <template v-else-if="kind === 'Accordion'">
          <MssgEditorFormText
            v-model="row.title"
            :name="`items.${i}.title`"
            label="คำถาม (Question)"
            :testid="T"
            :maxlength="250"
            required
            :error="err(`items.${i}.title`)"
          />
          <MssgEditorFormText
            v-model="row.content"
            :name="`items.${i}.content`"
            label="คำตอบ"
            :testid="T"
            textarea
            :rows="2"
            :maxlength="20000"
            required
            :error="err(`items.${i}.content`)"
          />
        </template>
        <template v-else-if="kind === 'Features'">
          <div class="flex min-w-0 flex-col gap-1.5">
            <span class="text-sm font-medium text-default">{{ MSSG_GLYPH_TEXT.label }} <span class="text-error">*</span></span>
            <UFormField :name="`items.${i}.glyph`" :error="err(`items.${i}.glyph`) || undefined">
              <MssgEditorGlyphPicker
                v-model="row.glyph"
                :scope="`items.${i}`"
                :site-id="siteId"
                :rules="MSSG_GLYPH_FEATURES"
                :read-only="readOnly"
              />
              <template #error="{ error: e }">
                <span v-if="e" :data-testid="`me-block-field-error-items.${i}.glyph`">{{ e }}</span>
              </template>
            </UFormField>
            <span
              v-for="[k, m] in glyphSubErrors(i)"
              :key="k"
              class="text-xs break-words text-error"
              :data-testid="`me-block-field-error-${k}`"
            >{{ m }}</span>
          </div>
          <MssgEditorFormText
            v-model="row.title"
            :name="`items.${i}.title`"
            label="หัวข้อ (Header)"
            :testid="T"
            :maxlength="250"
            required
            :error="err(`items.${i}.title`)"
          />
          <MssgEditorFormText
            v-model="row.content"
            :name="`items.${i}.content`"
            label="คำอธิบาย (Content)"
            :testid="T"
            textarea
            :rows="2"
            :maxlength="1000"
            :error="err(`items.${i}.content`)"
          />
        </template>
        <template v-else-if="kind === 'Messengers'">
          <div
            v-if="row.platform && !mssgMessengerEditable(row.platform)"
            class="flex min-w-0 flex-col gap-0.5 text-sm"
            :data-testid="`me-block-field-messengers.${i}.platform`"
            data-readonly="true"
          >
            <span class="font-medium break-words text-highlighted">{{ row.platform }} · {{ row.value }}</span>
            <span class="text-xs text-muted">แอปนี้ Apollo ยังแก้ไม่ได้ · ส่งกลับตามค่าเดิมบน mssg</span>
          </div>
          <template v-else>
            <div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
              <UFormField label="แอปแชท (Platform)" :name="`messengers.${i}.platform`" :error="err(`messengers.${i}.platform`) || undefined">
                <USelect
                  :model-value="row.platform || undefined"
                  :items="platformItems"
                  class="w-full"
                  placeholder="เลือกแอป"
                  :disabled="readOnly"
                  :data-testid="`me-block-field-messengers.${i}.platform`"
                  @update:model-value="setPlatform(row, String($event))"
                />
              </UFormField>
              <UFormField label="แบบของปุ่ม (Type)" :name="`messengers.${i}.type`" :error="err(`messengers.${i}.type`) || undefined">
                <USelect
                  v-model="row.type"
                  :items="typeItems(row.platform)"
                  class="w-full"
                  :disabled="readOnly || !row.platform"
                  :data-testid="`me-block-field-messengers.${i}.type`"
                />
                <template #error="{ error: e }">
                  <span v-if="e" :data-testid="`me-block-field-error-messengers.${i}.type`">{{ e }}</span>
                </template>
              </UFormField>
            </div>
            <MssgEditorFormText
              v-model="row.value"
              :name="`messengers.${i}.value`"
              label="ช่องทางติดต่อ (Value)"
              placeholder="เบอร์ / @username / ลิงก์"
              :testid="T"
              :maxlength="250"
              required
              :error="err(`messengers.${i}.value`)"
            />
            <USwitch
              v-model="row.enabled"
              label="แสดงปุ่มนี้"
              :disabled="readOnly"
              :data-testid="`me-block-field-messengers.${i}.enabled`"
            />
          </template>
        </template>
        <template v-else-if="kind === 'SubscriptionForm'">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
            <UFormField label="ชนิดช่อง" :name="`items.${i}.type`">
              <USelect
                v-model="row.type"
                :items="MSSG_FORM_ITEM_TYPES"
                class="w-full"
                :data-testid="`me-block-field-items.${i}.type`"
              />
            </UFormField>
            <MssgEditorFormText
              v-model="row.label"
              :name="`items.${i}.label`"
              label="ชื่อช่อง"
              placeholder="เช่น Email"
              :testid="T"
              :maxlength="100"
              required
              :error="err(`items.${i}.label`)"
            />
          </div>
          <UCheckbox
            v-model="row.required"
            label="ต้องกรอก (Required)"
            :data-testid="`me-block-field-items.${i}.required`"
          />
        </template>
      </div>
      <UButton
        :label="ADD_LABEL[kind]"
        color="primary"
        variant="soft"
        size="sm"
        class="self-start"
        :disabled="readOnly || rows.length >= (LIST_MAX[kind] ?? 0)"
        data-testid="me-block-item-add"
        @click="addRow"
      />
      <MssgEditorFormText
        v-if="kind === 'ImageGallery' || kind === 'VideoGallery'"
        :model-value="String(state.autoplay ?? 0)"
        name="autoplay"
        type="number"
        label="เล่นสไลด์อัตโนมัติ (Autoplay)"
        description="0 = ไม่เล่นเอง"
        :testid="T"
        :error="err('autoplay')"
        @update:model-value="state.autoplay = $event === '' ? 0 : Number($event)"
      />
      <template v-if="kind === 'SubscriptionForm'">
        <MssgEditorFormText
          v-model="state.sendLabel"
          name="sendLabel"
          label="ข้อความบนปุ่มส่ง (Send button label)"
          :testid="T"
          :maxlength="50"
          required
          :error="err('sendLabel')"
        />
        <MssgEditorFormText
          v-model="state.sentText"
          name="sentText"
          label="ข้อความหลังส่งสำเร็จ (Text after submission)"
          :testid="T"
          textarea
          :rows="2"
          :maxlength="500"
          required
          :error="err('sentText')"
        />
      </template>
    </div>

    <!-- v1.6 per-block style override -->
    <MssgEditorBlockStyle
      :kind="kind"
      :defaults="styleDefaults"
      :fields="original"
      :read-only="readOnly"
      :errors="styleErrors"
      @update="onStyle"
    />

    <div v-if="mode === 'new'" class="flex flex-wrap items-center justify-between gap-3 border-t border-default pt-3">
      <USwitch v-model="showNow" label="แสดง block นี้ทันที" data-testid="me-block-new-enabled" />
      <div class="flex flex-wrap gap-2">
        <UButton
          label="ยกเลิก"
          color="neutral"
          variant="outline"
          data-testid="me-block-new-cancel"
          @click="emit('cancel')"
        />
        <UButton
          type="submit"
          label="เพิ่ม block นี้ (Add)"
          :disabled="readOnly"
          data-testid="me-block-new-ok"
        />
      </div>
    </div>
  </UForm>
</template>
