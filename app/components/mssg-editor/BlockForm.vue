<script setup lang="ts">
/**
 * FEAT-101 M2 (AC-22, AC-23, AC-26; contract §3.3; design "generic form per kind" + the Link block editor) — the form
 * of one block kind, used both for a new block ("เพิ่ม block นี้ (Add)" / "ยกเลิก", design `gf.isDraft`) and for
 * editing an existing one.
 *
 * Rules: one zod schema per kind (`MSSG_BLOCK_SCHEMAS`, Thai messages), `UForm` validates on input.
 * - new: `submit` fires only through `UForm` (valid), with the block `fields` and "แสดง block นี้ทันที" (`enabled`).
 * - edit: every change that leaves the whole form valid emits `change` with the keys changed since the form opened
 *   (a key once changed keeps being sent, so changing it back also reaches the draft); an invalid state sends nothing.
 * Server messages (draft 400, apply `mssgValidation`) arrive in `errors` keyed by field path (`title`, `items.0.title`).
 * Not in FEAT-101 (spec scope/out) and rendered disabled "เร็ว ๆ นี้" with no handler: Link icon / emoji / custom
 * icon image, Link actions other than open-link / internal page, Feature emoji, per-block style controls.
 *
 * Test ids: `me-block-form` (`data-kind`, `data-mode`), fields `me-block-field-<path>` + `me-block-field-error-<path>`,
 * uploads `me-upload-<Kind>.<path>`, list rows `me-block-item-<i>`, `me-block-item-add`, `me-block-item-remove-<i>`,
 * `me-block-link-action`, `me-block-link-page`, `me-block-link-icon-soon`, `me-block-link-add`, `me-block-style-soon`,
 * `me-block-new-enabled`, `me-block-new-ok`, `me-block-new-cancel`, `me-block-form-close`.
 */
import type { MssgPageProjection } from '#shared/types/mssg-sites'

const props = withDefaults(defineProps<{
  kind: string
  /** the block's current fields (edit) or `{}` (new → defaults of the kind) */
  fields: Record<string, unknown>
  mode: 'new' | 'edit'
  siteId: string
  /** pages of the draft (Link → "เปิดหน้าภายใน") */
  pages: Pick<MssgPageProjection, 'id' | 'name'>[]
  readOnly?: boolean
  /** server messages by field path */
  errors?: Record<string, string>
}>(), { readOnly: false, errors: () => ({}) })

const emit = defineEmits<{
  change: [fields: Record<string, unknown>]
  submit: [payload: { fields: Record<string, unknown>, enabled: boolean }]
  cancel: []
  close: []
  addLink: []
}>()

const def = computed(() => MSSG_BLOCK_KINDS.find(k => k.kind === props.kind))
const schema = computed(() => MSSG_BLOCK_SCHEMAS[props.kind] ?? null)

const original = props.mode === 'new' ? mssgBlockDefaults(props.kind) : JSON.parse(JSON.stringify(props.fields ?? {})) as Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the state's shape depends on the kind (zod checks it)
const state = reactive<Record<string, any>>(mssgBlockToForm(props.kind, original))
/** what the untouched form would send — the base of "changed" */
const baseline = mssgFormToBlock(props.kind, mssgBlockToForm(props.kind, original), original)
const touched = new Set<string>()
const showNow = ref(true)

function err(path: string): string | null {
  return props.errors?.[path] ?? null
}

watch(state, () => {
  if (props.mode !== 'edit' || props.readOnly || !schema.value) return
  if (!schema.value.safeParse(state).success) return
  const next = mssgFormToBlock(props.kind, state, original)
  for (const k of Object.keys(mssgChangedKeys(next, baseline))) touched.add(k)
  if (!touched.size) return
  emit('change', Object.fromEntries([...touched].map(k => [k, next[k]])))
}, { deep: true })

function onSubmit() {
  emit('submit', { fields: mssgFormToBlock(props.kind, state, original), enabled: showNow.value })
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
  const first = (mssgBlockDefaults(props.kind)[key] as unknown[] | undefined)?.[0] ?? {}
  const row = JSON.parse(JSON.stringify(first)) as Record<string, unknown>
  if (props.kind === 'SubscriptionForm') Object.assign(row, { type: 'text', label: '', required: false })
  if (props.kind === 'Features') Object.assign(row, { title: '', text: '' })
  state[key] = [...rows.value, row]
}
function removeRow(i: number) {
  const key = listKey.value
  if (!key) return
  state[key] = rows.value.filter((_, k) => k !== i)
}

// ── Link / Image actions ────────────────────────────────────────────────────────────────────────────────────────────
const linkActionItems = MSSG_LINK_ACTIONS.map(a => ({ label: a.soon ? `${a.label} · ${MSSG_SOON}` : a.label, value: a.value, disabled: a.soon }))
function setLinkAction(type: string) {
  if (type === state.action?.type) return
  if (type === 'url') state.action = { type: 'url', url: '' }
  else if (type === 'page') state.action = { type: 'page', page: props.pages[0]?.id ?? '' }
}
const pageItems = computed(() => props.pages.map(p => ({ label: p.name, value: p.id })))
const imageActionItems = [
  { label: 'ไม่ทำอะไร (No action)', value: 'none' },
  { label: 'เปิดลิงก์ (Open link)', value: 'url' },
  { label: `เปิดหน้าภายใน · ${MSSG_SOON}`, value: 'page', disabled: true },
  { label: `เปิดรูปเต็ม · ${MSSG_SOON}`, value: 'image', disabled: true }
]
function setImageAction(type: string) {
  if (type === state.action?.type) return
  state.action = type === 'url' ? { type: 'url', url: '' } : { type: 'none' }
}
const messengerItems = computed(() => {
  const known = new Set(MSSG_MESSENGER_PLATFORMS)
  const extra = rows.value.map(r => String(r.platform ?? '')).filter(p => p && !known.has(p))
  return [...MSSG_MESSENGER_PLATFORMS, ...new Set(extra)].map(p => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p }))
})

const textHasFormatting = computed(() => props.kind === 'TextRich' && mssgHtmlHasFormatting(String(original.html ?? '')))
const T = 'me-block-field'
</script>

<template>
  <UForm
    :schema="schema ?? undefined"
    :state="state"
    :validate-on="['input', 'change']"
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
      <MssgEditorUploadField
        v-model="state.image"
        :site-id="siteId"
        field="Hat.image"
        label="รูปโปรไฟล์ / ภาพปก (Image)"
        :disabled="readOnly"
        :error="err('image')"
      />
      <MssgEditorFormText
        v-model="state.header"
        name="header"
        label="ชื่อ (Title)"
        :testid="T"
        :maxlength="250"
        counter
        :error="err('header')"
      />
      <MssgEditorFormText
        v-model="state.subheader"
        name="subheader"
        label="คำอธิบายสั้น (Subtitle)"
        :testid="T"
        textarea
        :rows="2"
        :maxlength="500"
        counter
        :error="err('subheader')"
      />
    </template>

    <!-- Link -->
    <template v-else-if="kind === 'Link'">
      <MssgEditorFormText
        v-model="state.title"
        name="title"
        label="ชื่อปุ่ม (Link title)"
        placeholder="Enter title"
        :testid="T"
        :maxlength="250"
        required
        :error="err('title')"
      />
      <div class="flex min-w-0 flex-col gap-1.5" data-testid="me-block-link-icon-soon" data-soon="true">
        <span class="text-sm font-medium text-default">ไอคอน (Icon)</span>
        <div role="group" aria-label="ประเภทไอคอน" class="flex flex-wrap gap-1.5">
          <UButton
            v-for="t in ['ไม่มี', 'Icons', 'Emoji', 'Custom image']"
            :key="t"
            :label="t"
            color="neutral"
            variant="outline"
            size="xs"
            disabled
            :title="MSSG_SOON"
          />
        </div>
        <span class="text-xs text-muted">เลือกไอคอน emoji หรือรูปไอคอนเอง · {{ MSSG_SOON }}</span>
      </div>
      <UFormField label="กดแล้วทำอะไร (Action)" name="action" :error="err('action') || undefined">
        <USelect
          :model-value="state.action?.type"
          :items="linkActionItems"
          class="w-full"
          data-testid="me-block-link-action"
          @update:model-value="setLinkAction(String($event))"
        />
      </UFormField>
      <MssgEditorFormText
        v-if="state.action?.type === 'url'"
        v-model="state.action.url"
        name="action.url"
        label="ปลายทาง"
        placeholder="https://..."
        :testid="T"
        required
        :error="err('action.url')"
      />
      <UFormField
        v-else-if="state.action?.type === 'page'"
        label="หน้าปลายทาง"
        name="action.page"
        required
        :error="err('action.page') || undefined"
      >
        <USelect
          v-model="state.action.page"
          :items="pageItems"
          class="w-full"
          placeholder="เลือกหน้า"
          data-testid="me-block-link-page"
        />
        <template #error="{ error: e }">
          <span v-if="e" data-testid="me-block-field-error-action.page">{{ e }}</span>
        </template>
      </UFormField>
      <p v-else class="text-xs text-muted">
        การกดแบบนี้แก้ใน Apollo ไม่ได้ ({{ MSSG_SOON }}) · ค่าเดิมบน mssg ยังอยู่
      </p>
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
      <UFormField label="กดแล้วทำอะไร (Action)" name="action">
        <USelect
          :model-value="state.action?.type"
          :items="imageActionItems"
          class="w-full"
          data-testid="me-block-image-action"
          @update:model-value="setImageAction(String($event))"
        />
      </UFormField>
      <MssgEditorFormText
        v-if="state.action?.type === 'url'"
        v-model="state.action.url"
        name="action.url"
        label="ปลายทาง"
        placeholder="https://..."
        :testid="T"
        required
        :error="err('action.url')"
      />
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
        :key="i"
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
          </UFormField>
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
          <div class="flex items-center gap-2 text-xs text-muted" data-soon="true">
            <span class="text-lg" aria-hidden="true">{{ row.glyph?.value ?? '⭐' }}</span>
            <span>emoji ของจุดเด่น · เปลี่ยนได้ {{ MSSG_SOON }}</span>
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
            v-model="row.text"
            :name="`items.${i}.text`"
            label="คำอธิบาย"
            :testid="T"
            textarea
            :rows="2"
            :maxlength="1000"
            :error="err(`items.${i}.text`)"
          />
        </template>
        <template v-else-if="kind === 'Messengers'">
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-[10rem_1fr]">
            <UFormField label="แอปแชท" :name="`messengers.${i}.platform`">
              <USelect
                v-model="row.platform"
                :items="messengerItems"
                class="w-full"
                :data-testid="`me-block-field-messengers.${i}.platform`"
              />
            </UFormField>
            <MssgEditorFormText
              v-model="row.value"
              :name="`messengers.${i}.value`"
              label="ช่องทางติดต่อ"
              placeholder="เบอร์ / @username / ลิงก์"
              :testid="T"
              :maxlength="250"
              required
              :error="err(`messengers.${i}.value`)"
            />
          </div>
          <USwitch
            v-model="row.enabled"
            label="แสดงปุ่มนี้"
            :data-testid="`me-block-field-messengers.${i}.enabled`"
          />
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

    <UButton
      v-if="kind === 'Link' && mode === 'edit'"
      label="+ เพิ่มลิงก์ (Add one more link)"
      color="primary"
      variant="outline"
      size="sm"
      class="self-start"
      :disabled="readOnly"
      title="เพิ่ม block ลิงก์ใหม่ต่อจาก block นี้"
      data-testid="me-block-link-add"
      @click="emit('addLink')"
    />

    <!-- per-block style controls: not in FEAT-101 (spec scope/out) -->
    <fieldset
      disabled
      class="flex min-w-0 flex-col gap-2 rounded-md border border-dashed border-default p-2.5 opacity-70"
      data-testid="me-block-style-soon"
      data-soon="true"
    >
      <legend class="px-1 text-xs text-muted">
        การตกแต่ง block · {{ MSSG_SOON }}
      </legend>
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="s in ['รูปแบบ (Template)', 'สีพื้น', 'สีตัวอักษร', 'ความกว้าง', 'มุมโค้ง', 'เส้นขอบ', 'ระยะห่าง']"
          :key="s"
          :label="s"
          color="neutral"
          variant="outline"
          size="xs"
          disabled
          :title="MSSG_SOON"
        />
      </div>
    </fieldset>

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
