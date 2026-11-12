<script setup lang="ts">
/**
 * FEAT-101 M2 reopen (B2r; contract v1.6 §3.4 "Actions", AC-46) — "กดแล้วทำอะไร" of a Link, an Image or one gallery image,
 * inside the block's `UForm` (zod paths `<prefix>.url`, `<prefix>.page`, `<prefix>.anchor.page`, `<prefix>.anchor.block`;
 * the rules are `mssgActionIssues` in the block schema).
 * - Link: `url` · `page` · `tel` · `email` · `sms` · `anchor`; Image / gallery (`image`): `nothing` (default) · `fullImage` + those.
 * - `tel` / `sms` / `email` carry the raw value in `url` (⚠K18, no scheme prefix); `anchor` = a page + a block **on that
 *   page** of the draft (temp ids allowed: they are replaced at apply).
 * - A type read from mssg that is none of these is shown and kept exactly as read (no input).
 * Test ids: the type select = `typeTestid`; `me-block-field-<prefix>.url` (+ `-error-`), the page select = `pageTestid`
 * (default `me-block-field-<prefix>.page`), `me-block-field-<prefix>.anchor.page`, `me-block-field-<prefix>.anchor.block`
 * (+ `me-block-field-error-<…>`), `me-block-field-<prefix>.unknown`.
 */
import type { MssgPageProjection } from '#shared/types/mssg-sites'
import type { MssgActionType } from '~/utils/mssg-actions'

const props = withDefaults(defineProps<{
  /** zod / test-id path of the action: `action`, `images.0.action` */
  prefix: string
  image?: boolean
  typeTestid: string
  pageTestid?: string
  pages: MssgPageProjection[]
  readOnly?: boolean
  /** server message per path below the prefix (`url`, `page`, `anchor.block` …) */
  errors?: Record<string, string>
}>(), { image: false, pageTestid: '', readOnly: false, errors: () => ({}) })

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an action read from mssg may carry any keys (kept as read)
const action = defineModel<Record<string, any>>({ required: true })

const ctx = computed(() => ({ pages: props.pages }))
const types = computed(() => (props.image ? MSSG_IMAGE_ACTION_TYPES : MSSG_LINK_ACTION_TYPES) as readonly MssgActionType[])
const known = computed(() => (props.image ? mssgIsImageActionType(action.value?.type) : mssgIsLinkActionType(action.value?.type)))
const typeItems = computed(() => types.value.map(t => ({ label: MSSG_ACTION_LABEL[t], value: t })))

function setType(type: string) {
  if (props.readOnly || type === action.value?.type) return
  action.value = mssgDefaultAction(type, ctx.value)
}

const valueDef = computed(() => {
  const t = String(action.value?.type ?? '')
  return t === 'url' || t === 'tel' || t === 'email' || t === 'sms' ? MSSG_ACTION_VALUE[t] : null
})
function setUrl(v: string) {
  action.value = { ...action.value, url: v }
}

const pageItems = computed(() => props.pages.map(p => ({ label: p.name || p.slug, value: p.id })))
function setPage(v: string) {
  action.value = { ...action.value, page: v }
}

const anchorPage = computed(() => String(action.value?.anchor?.page ?? ''))
const anchorBlockItems = computed(() => mssgAnchorBlocks(ctx.value, anchorPage.value).map((b, i) => {
  const page = props.pages.find(p => p.id === anchorPage.value)
  const block = page?.blocks.find(x => x.id === b.id)
  const sum = block ? mssgBlockSummary(block) : ''
  return { label: `${i + 1}. ${mssgBlockKindLabel(b.kind)}${sum ? ` · ${sum}` : ''}`, value: b.id }
}))
function setAnchorPage(v: string) {
  action.value = { ...action.value, anchor: { ...(action.value?.anchor ?? {}), page: v, block: mssgAnchorBlocks(ctx.value, v)[0]?.id ?? '' } }
}
function setAnchorBlock(v: string) {
  action.value = { ...action.value, anchor: { ...(action.value?.anchor ?? {}), block: v } }
}

const T = 'me-block-field'
const err = (sub: string) => props.errors?.[sub] ?? undefined
</script>

<template>
  <div class="flex min-w-0 flex-col gap-3">
    <UFormField label="กดแล้วทำอะไร (Action)" :name="`${prefix}.type`" :error="err('type')">
      <USelect
        :model-value="known ? action?.type : undefined"
        :items="typeItems"
        :placeholder="known ? undefined : String(action?.type ?? 'เลือก')"
        :disabled="readOnly"
        class="w-full"
        :data-testid="typeTestid"
        :data-value="action?.type ?? ''"
        @update:model-value="setType(String($event))"
      />
    </UFormField>

    <MssgEditorFormText
      v-if="valueDef"
      :model-value="String(action.url ?? '')"
      :name="`${prefix}.url`"
      :label="valueDef.label"
      :placeholder="valueDef.placeholder"
      :type="valueDef.inputmode === 'tel' ? 'tel' : 'text'"
      :testid="T"
      :maxlength="action.type === 'url' ? 2000 : action.type === 'email' ? 254 : 30"
      required
      :error="err('url')"
      @update:model-value="setUrl"
    />

    <UFormField
      v-else-if="action?.type === 'page'"
      label="หน้าปลายทาง"
      :name="`${prefix}.page`"
      required
      :error="err('page')"
    >
      <USelect
        :model-value="action.page || undefined"
        :items="pageItems"
        class="w-full"
        placeholder="เลือกหน้า"
        :disabled="readOnly"
        :data-testid="pageTestid || `${T}-${prefix}.page`"
        @update:model-value="setPage(String($event))"
      />
      <template #error="{ error: e }">
        <span v-if="e" :data-testid="`${T}-error-${prefix}.page`">{{ e }}</span>
      </template>
    </UFormField>

    <div v-else-if="action?.type === 'anchor'" class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <UFormField
        label="หน้าของ block ปลายทาง"
        :name="`${prefix}.anchor.page`"
        required
        :error="err('anchor.page')"
      >
        <USelect
          :model-value="anchorPage || undefined"
          :items="pageItems"
          class="w-full"
          placeholder="เลือกหน้า"
          :disabled="readOnly"
          :data-testid="`${T}-${prefix}.anchor.page`"
          @update:model-value="setAnchorPage(String($event))"
        />
        <template #error="{ error: e }">
          <span v-if="e" :data-testid="`${T}-error-${prefix}.anchor.page`">{{ e }}</span>
        </template>
      </UFormField>
      <UFormField
        label="block ปลายทาง"
        :name="`${prefix}.anchor.block`"
        required
        :error="err('anchor.block')"
        :description="anchorPage && !anchorBlockItems.length ? 'หน้านี้ยังไม่มี block ให้เลือก' : undefined"
      >
        <USelect
          :model-value="action.anchor?.block || undefined"
          :items="anchorBlockItems"
          class="w-full"
          placeholder="เลือก block"
          :disabled="readOnly || !anchorBlockItems.length"
          :data-testid="`${T}-${prefix}.anchor.block`"
          @update:model-value="setAnchorBlock(String($event))"
        />
        <template #error="{ error: e }">
          <span v-if="e" :data-testid="`${T}-error-${prefix}.anchor.block`">{{ e }}</span>
        </template>
      </UFormField>
    </div>

    <p v-else-if="!known" class="text-xs break-words text-muted" :data-testid="`${T}-${prefix}.unknown`">
      การกดแบบ "{{ action?.type }}" ตั้งไว้บน mssg และแก้ใน Apollo ไม่ได้ · ค่าเดิมยังอยู่ (เลือกแบบอื่นเพื่อเปลี่ยน)
    </p>
  </div>
</template>
