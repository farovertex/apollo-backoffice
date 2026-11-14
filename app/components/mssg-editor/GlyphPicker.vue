<script setup lang="ts">
/**
 * FEAT-101 B9 (spec D18, AC-59, AC-60; contract v1.9 §3.5) — the icon of one Link item or Features item.
 * The trigger shows the current glyph (icon / emoji / tiny image / "ไม่มีไอคอน" / "ไอคอนที่ไม่รู้จัก" + raw name) and opens a
 * picker: emoji input (`{ type: "emoticon", text }`, applied as typed), "ไอคอนทั่วไป" (12) and "ไอคอนโซเชียล" (54, contract §3.5 list)
 * (`{ type: "icon", icon }`), image upload (`{ type: "image", url: "upload:<id>" }`, Link only, `POST …/uploads` through
 * `UploadField`) and "ไม่มีไอคอน" (`null`, Link only). A glyph read from mssg that Apollo does not know stays exactly as
 * read until the user picks another. Icons are the BO's own (Lucide / Simple Icons) — nothing is loaded from mssg.
 * Test ids: trigger `me-glyph-<scope>` (`data-glyph-type` = icon|emoticon|image|none|unknown, `data-glyph-value`),
 * `me-glyph-unknown` (inside the trigger), picker `me-glyph-picker`, `me-glyph-group-general`, `me-glyph-group-social`,
 * `me-glyph-icon-<name>`, `me-glyph-emoji` (input), `me-glyph-image` (upload wrapper; inner ids `me-upload-glyph.<scope>-…`),
 * `me-glyph-none`.
 */
import type { MssgGlyphRules } from '~/utils/mssg-glyphs'

const props = withDefaults(defineProps<{
  /** test-id scope, e.g. `items.0` */
  scope: string
  siteId: string
  rules: MssgGlyphRules
  readOnly?: boolean
}>(), { readOnly: false })

const glyph = defineModel<unknown>()

const open = ref(false)
const info = computed(() => mssgGlyphInfo(glyph.value))
const emoji = ref('')
watch(open, (o) => {
  if (o) emoji.value = info.value.type === 'emoticon' ? info.value.value : ''
})

function pick(next: unknown, close = true) {
  if (props.readOnly) return
  glyph.value = next
  if (close) open.value = false
}
function onEmoji(v: string) {
  emoji.value = v
  if (v.trim()) pick({ type: 'emoticon', text: v.trim() }, false)
}
const imageUrl = computed<string | null>({
  get: () => (info.value.type === 'image' ? info.value.value : null),
  set: (v) => {
    if (v) pick({ type: 'image', url: v })
  }
})

const triggerLabel = computed(() => {
  switch (info.value.type) {
    case 'icon': return info.value.value
    case 'emoticon': return 'อีโมจิ'
    case 'image': return 'รูปไอคอน'
    case 'none': return MSSG_GLYPH_TEXT.none
    default: return ''
  }
})
const groups = [
  { id: 'general', label: MSSG_GLYPH_TEXT.general, icons: MSSG_GLYPH_ICONS_GENERAL as readonly string[] },
  { id: 'social', label: MSSG_GLYPH_TEXT.social, icons: MSSG_GLYPH_ICONS_SOCIAL as readonly string[] }
]
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'start', side: 'bottom', collisionPadding: 8 }"
    :ui="{ content: 'w-[min(22rem,calc(100vw-1rem))]' }"
  >
    <UButton
      color="neutral"
      variant="outline"
      size="sm"
      class="max-w-full min-w-0 self-start"
      :disabled="readOnly"
      :aria-label="`${MSSG_GLYPH_TEXT.label}: ${info.type === 'unknown' ? MSSG_GLYPH_TEXT.unknown : triggerLabel} · ${MSSG_GLYPH_TEXT.change}`"
      :data-testid="`me-glyph-${scope}`"
      :data-glyph-type="info.type"
      :data-glyph-value="info.value"
    >
      <span class="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
        <UIcon v-if="info.type === 'icon'" :name="info.ui!" class="size-4" />
        <span v-else-if="info.type === 'emoticon'" class="text-base leading-none">{{ info.value }}</span>
        <MssgEditorImage
          v-else-if="info.type === 'image'"
          :site-id="siteId"
          :value="info.value"
          class="size-5 rounded"
        />
        <UIcon v-else-if="info.type === 'none'" name="i-lucide-circle-slash" class="size-4 opacity-50" />
        <UIcon v-else name="i-lucide-circle-help" class="size-4 text-warning" />
      </span>
      <span v-if="info.type === 'unknown'" class="min-w-0 truncate text-warning" data-testid="me-glyph-unknown">
        {{ MSSG_GLYPH_TEXT.unknown }} ({{ info.value }})
      </span>
      <span v-else class="min-w-0 truncate">{{ triggerLabel }}</span>
      <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 opacity-60" aria-hidden="true" />
    </UButton>

    <template #content>
      <div
        class="flex max-h-[min(30rem,70vh)] flex-col gap-3 overflow-y-auto p-3"
        role="dialog"
        :aria-label="MSSG_GLYPH_TEXT.label"
        data-testid="me-glyph-picker"
      >
        <p v-if="info.type === 'unknown'" class="text-xs break-words text-muted">
          {{ MSSG_GLYPH_TEXT.unknown }} ({{ info.value }}) · {{ MSSG_GLYPH_TEXT.unknownNote }}
        </p>

        <div class="flex flex-col gap-1.5">
          <span class="text-xs font-medium text-toned">{{ MSSG_GLYPH_TEXT.emoji }}</span>
          <div class="flex min-w-0 gap-2">
            <UInput
              :model-value="emoji"
              :maxlength="MSSG_GLYPH_EMOJI_MAX"
              :placeholder="MSSG_GLYPH_TEXT.emojiPlaceholder"
              class="min-w-0 flex-1"
              data-testid="me-glyph-emoji"
              @update:model-value="onEmoji(String($event))"
              @keydown.enter.prevent="open = false"
            />
            <UButton
              :label="MSSG_GLYPH_TEXT.emojiApply"
              size="sm"
              color="primary"
              variant="soft"
              :disabled="!emoji.trim()"
              data-testid="me-glyph-emoji-apply"
              @click="open = false"
            />
          </div>
        </div>

        <div
          v-for="g in groups"
          :key="g.id"
          class="flex flex-col gap-1.5"
          role="group"
          :aria-label="g.label"
          :data-testid="`me-glyph-group-${g.id}`"
        >
          <span class="text-xs font-medium text-toned">{{ g.label }}</span>
          <div class="flex flex-wrap gap-1">
            <UButton
              v-for="name in g.icons"
              :key="name"
              :icon="MSSG_GLYPH_ICON_UI[name]"
              size="sm"
              square
              :color="info.type === 'icon' && info.value === name ? 'primary' : 'neutral'"
              :variant="info.type === 'icon' && info.value === name ? 'soft' : 'ghost'"
              :title="name"
              :aria-label="name"
              :aria-pressed="info.type === 'icon' && info.value === name"
              :data-testid="`me-glyph-icon-${name}`"
              @click="pick({ type: 'icon', icon: name })"
            />
          </div>
        </div>

        <div v-if="rules.allowImage" class="flex flex-col gap-1.5" data-testid="me-glyph-image">
          <span class="text-xs font-medium text-toned">{{ MSSG_GLYPH_TEXT.image }}</span>
          <MssgEditorUploadField
            v-model="imageUrl"
            :site-id="siteId"
            :field="`glyph.${scope}`"
            required
            :disabled="readOnly"
          />
        </div>

        <UButton
          v-if="rules.allowNone"
          :label="MSSG_GLYPH_TEXT.none"
          icon="i-lucide-circle-slash"
          size="sm"
          :color="info.type === 'none' ? 'primary' : 'neutral'"
          :variant="info.type === 'none' ? 'soft' : 'outline'"
          class="self-start"
          data-testid="me-glyph-none"
          @click="pick(null)"
        />
      </div>
    </template>
  </UPopover>
</template>
