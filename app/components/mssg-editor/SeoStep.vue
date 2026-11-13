<script setup lang="ts">
/**
 * FEAT-101 M3 — editor step 4 "SEO, Tracking & Embed code" (AC-28, AC-29; contract §3.2 `site.update` seo / tracking /
 * embeddedCode, §3.3; design step 4). Website SEO (favicon + OG image uploads, title `n/80`, description `n/200`, indexing
 * switch "ปิดอยู่ = ไม่แสดงในผลค้นหา"), Pixel ids (TikTok / Facebook / Google, trimmed, ≤ 100, not validated further, as
 * mssg), Embed HTML code (`n/30000`, "Insert into HEAD tag", "Run code after page content load").
 *
 * Each control emits a `site.update` patch only when its value passes the contract's client rule (zod, Thai messages,
 * `UForm` validate-on-input); an invalid value stays in the form with its message and is never sent. Counters turn red
 * over the limit (no native `maxlength`, so the message can show). Server messages (draft 400, apply `mssgValidation`,
 * `site.seo.title` …) arrive as `errors` keyed by the field path and bind to each `UFormField :error`.
 *
 * Test ids: `me-sheet-4`, `me-field-<path>` / `me-field-error-<path>` / `me-field-counter-<path>` for `seo.title`,
 * `seo.description`, `tracking.tiktok|facebook|google`, `embeddedCode.content`; switches `me-field-seo.indexing`,
 * `me-field-embeddedCode.inHead`, `me-field-embeddedCode.onLoad` (+ `me-field-error-<path>`); uploads
 * `me-upload-seo.faviconUrl` / `me-upload-seo.ogImageUrl` (`-input|-pick|-remove|-error`); `me-seo-ready-hint`.
 */
import type { Form } from '@nuxt/ui'
import type { MssgSiteProjection, MssgSiteUpdateFields } from '#shared/types/mssg-sites'
import type { MssgSeoStepForm } from '~/utils/mssg-sites'

const props = defineProps<{
  siteId: string
  site: MssgSiteProjection | null
  readOnly: boolean
  /** server messages per site field path (`seo.title`, `tracking.tiktok` …) */
  errors: Record<string, string>
  resetToken: number
}>()

const emit = defineEmits<{ update: [patch: MssgSiteUpdateFields] }>()

const state = reactive<MssgSeoStepForm>({
  seo: { title: '', description: '' },
  tracking: { tiktok: '', facebook: '', google: '' },
  embeddedCode: { content: '' }
})
const indexing = ref(true)
const inHead = ref(false)
const onLoad = ref(false)
const favicon = ref<string | null>(null)
const ogImage = ref<string | null>(null)
const form = useTemplateRef<Form<MssgSeoStepForm>>('form')

function fromSite() {
  const s = props.site
  if (!s) return
  state.seo.title = s.seo?.title ?? ''
  state.seo.description = s.seo?.description ?? ''
  state.tracking.tiktok = s.tracking?.tiktok ?? ''
  state.tracking.facebook = s.tracking?.facebook ?? ''
  state.tracking.google = s.tracking?.google ?? ''
  state.embeddedCode.content = s.embeddedCode?.content ?? ''
  indexing.value = s.seo?.indexing !== false
  inHead.value = !!s.embeddedCode?.inHead
  onLoad.value = !!s.embeddedCode?.onLoad
  favicon.value = s.seo?.faviconUrl || null
  ogImage.value = s.seo?.ogImageUrl || null
  form.value?.clear()
}
// first view, and every time the draft is replaced from the server (load, discard, resolve, job end)
watch([() => props.resetToken, () => !!props.site], fromSite, { immediate: true })

const shape = mssgSeoStepSchema.shape
function valid(schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown): boolean {
  return schema.safeParse(v).success
}

function onTitle(v: string) {
  state.seo.title = v
  if (valid(shape.seo.shape.title, v)) emit('update', { seo: { title: v.trim() } })
}
function onDescription(v: string) {
  state.seo.description = v
  if (valid(shape.seo.shape.description, v)) emit('update', { seo: { description: v.trim() } })
}
function onTracking(key: 'tiktok' | 'facebook' | 'google', v: string) {
  state.tracking[key] = v
  if (valid(shape.tracking.shape[key], v)) emit('update', { tracking: { [key]: v.trim() } })
}
function onEmbed(v: string) {
  state.embeddedCode.content = v
  if (valid(shape.embeddedCode.shape.content, v)) emit('update', { embeddedCode: { content: v } })
}
function onIndexing(v: boolean) {
  indexing.value = v
  emit('update', { seo: { indexing: v } })
}
function onInHead(v: boolean) {
  inHead.value = v
  emit('update', { embeddedCode: { inHead: v } })
}
function onOnLoad(v: boolean) {
  onLoad.value = v
  emit('update', { embeddedCode: { onLoad: v } })
}
function onFavicon(v: string | null) {
  favicon.value = v || null
  emit('update', { seo: { faviconUrl: v || null } })
}
function onOgImage(v: string | null) {
  ogImage.value = v || null
  emit('update', { seo: { ogImageUrl: v || null } })
}
</script>

<template>
  <UForm
    ref="form"
    :schema="mssgSeoStepSchema"
    :state="state"
    :validate-on="['input']"
    :disabled="readOnly"
    class="flex flex-col gap-5"
    data-testid="me-sheet-4"
  >
    <p class="text-sm text-muted">
      ให้ Google หาเจอ และวัดผลโฆษณา TikTok ได้
    </p>
    <p class="text-xs text-muted" data-testid="me-seo-ready-hint">
      ขั้นนี้ถือว่าพร้อมเมื่อมี SEO title หรือ Pixel ID อย่างน้อยหนึ่งอย่าง (ระบบคำนวณให้ที่แถบด้านซ้าย)
    </p>

    <section class="flex flex-col gap-3.5 rounded-lg border border-default bg-elevated/40 p-3.5">
      <h3 class="text-sm font-medium text-highlighted">
        Website SEO
      </h3>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <MssgEditorUploadField
          :model-value="favicon"
          :site-id="siteId"
          field="seo.faviconUrl"
          label="Favicon"
          :disabled="readOnly"
          :error="errors['seo.faviconUrl'] || null"
          @update:model-value="onFavicon"
        />
        <MssgEditorUploadField
          :model-value="ogImage"
          :site-id="siteId"
          field="seo.ogImageUrl"
          label="Open Graph Image · รูปตอนแชร์ลิงก์"
          :disabled="readOnly"
          :error="errors['seo.ogImageUrl'] || null"
          @update:model-value="onOgImage"
        />
      </div>
      <MssgEditorFormText
        :model-value="state.seo.title"
        name="seo.title"
        label="ชื่อที่แสดงบน Google (Title)"
        testid="me-field"
        placeholder="เช่น ของดี – สมัครผ่าน LINE ได้ทันที"
        counter
        :limit="MSSG_SEO_TITLE_MAX"
        :error="errors['seo.title'] || null"
        @update:model-value="onTitle(String($event ?? ''))"
      />
      <MssgEditorFormText
        :model-value="state.seo.description"
        name="seo.description"
        label="คำอธิบาย (Description)"
        testid="me-field"
        textarea
        :rows="3"
        placeholder="อธิบายสั้น ๆ 1–2 ประโยค"
        counter
        :limit="MSSG_SEO_DESC_MAX"
        :error="errors['seo.description'] || null"
        @update:model-value="onDescription(String($event ?? ''))"
      />
      <div class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated/60 px-3 py-2.5">
        <div class="flex items-center justify-between gap-4">
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm text-highlighted">ให้ Google เก็บหน้าเว็บ (Search Engine Indexing)</span>
            <span class="text-xs text-muted">{{ indexing ? 'เปิดอยู่ = แสดงในผลค้นหา' : 'ปิดอยู่ = ไม่แสดงในผลค้นหา' }}</span>
          </span>
          <USwitch
            :model-value="indexing"
            :disabled="readOnly"
            aria-label="Search Engine Indexing"
            data-testid="me-field-seo.indexing"
            @update:model-value="onIndexing(!!$event)"
          />
        </div>
        <span v-if="errors['seo.indexing']" class="text-xs text-error" data-testid="me-field-error-seo.indexing">{{ errors['seo.indexing'] }}</span>
      </div>
    </section>

    <section class="flex flex-col gap-3.5 rounded-lg border border-default bg-elevated/40 p-3.5">
      <h3 class="text-sm font-medium text-highlighted">
        Pixel และการติดตาม
      </h3>
      <div class="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <MssgEditorFormText
          :model-value="state.tracking.tiktok"
          name="tracking.tiktok"
          label="TikTok Pixel ID"
          testid="me-field"
          :error="errors['tracking.tiktok'] || null"
          @update:model-value="onTracking('tiktok', String($event ?? ''))"
        />
        <MssgEditorFormText
          :model-value="state.tracking.facebook"
          name="tracking.facebook"
          label="Facebook Pixel ID"
          testid="me-field"
          :error="errors['tracking.facebook'] || null"
          @update:model-value="onTracking('facebook', String($event ?? ''))"
        />
        <MssgEditorFormText
          :model-value="state.tracking.google"
          name="tracking.google"
          label="Google Analytics ID"
          testid="me-field"
          placeholder="G-XXXXXXX"
          :error="errors['tracking.google'] || null"
          @update:model-value="onTracking('google', String($event ?? ''))"
        />
      </div>
    </section>

    <section class="flex flex-col gap-3 rounded-lg border border-default bg-elevated/40 p-3.5">
      <h3 class="text-sm font-medium text-highlighted">
        Embed HTML code
      </h3>
      <MssgEditorFormText
        :model-value="state.embeddedCode.content"
        name="embeddedCode.content"
        label="โค้ดที่จะฝังในทุกหน้า"
        testid="me-field"
        textarea
        mono
        :rows="5"
        placeholder="Enter HTML code"
        counter
        :limit="MSSG_EMBED_MAX"
        :error="errors['embeddedCode.content'] || null"
        @update:model-value="onEmbed(String($event ?? ''))"
      />
      <div class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated/60 px-3 py-2.5">
        <div class="flex items-center justify-between gap-4">
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm text-highlighted">Insert into HEAD tag</span>
            <span class="text-xs text-muted">เปิด = ใส่ใน HEAD · ปิด = ใส่ก่อนปิด /body</span>
          </span>
          <USwitch
            :model-value="inHead"
            :disabled="readOnly"
            aria-label="Insert into HEAD tag"
            data-testid="me-field-embeddedCode.inHead"
            @update:model-value="onInHead(!!$event)"
          />
        </div>
        <span v-if="errors['embeddedCode.inHead']" class="text-xs text-error" data-testid="me-field-error-embeddedCode.inHead">{{ errors['embeddedCode.inHead'] }}</span>
      </div>
      <div class="flex flex-col gap-1.5 rounded-md border border-default bg-elevated/60 px-3 py-2.5">
        <div class="flex items-center justify-between gap-4">
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-sm text-highlighted">Run code after page content load</span>
            <span class="text-xs text-muted">รันโค้ดหลังเนื้อหาหน้าโหลดเสร็จ</span>
          </span>
          <USwitch
            :model-value="onLoad"
            :disabled="readOnly"
            aria-label="Run code after page content load"
            data-testid="me-field-embeddedCode.onLoad"
            @update:model-value="onOnLoad(!!$event)"
          />
        </div>
        <span v-if="errors['embeddedCode.onLoad']" class="text-xs text-error" data-testid="me-field-error-embeddedCode.onLoad">{{ errors['embeddedCode.onLoad'] }}</span>
      </div>
    </section>
  </UForm>
</template>
