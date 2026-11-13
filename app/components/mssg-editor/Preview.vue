<script setup lang="ts">
/**
 * FEAT-101 — mobile preview (design aside "ตัวอย่างบนมือถือ"), rendered from the draft (server `preview` + the local
 * ops not yet saved), so it follows every edit at once. Shows the page selected in step 2 (else the home page).
 * B2: each block kind is drawn recognisably — Profile (image + title), Link (button), Text (paragraphs), Image /
 * Gallery (pictures), Video / Music / Map / Giphy / Code (labelled boxes), FAQ / Features / Form / Socials /
 * Messengers (their items), Timer (countdown), Divider (line); **hidden blocks are omitted**. Text is rendered as
 * text (never `v-html`). Approximate, not pixel-exact.
 * Test ids: `me-preview` (`data-page-id`, `data-blocks` = shown blocks), `me-preview-name`, `me-preview-url`,
 * `me-preview-page`, `me-preview-block` (`data-kind`, `data-block-id`), `me-preview-empty`, `me-preview-screen` (M3: `data-bg` = background colour, `data-bg-image`).
 * v1.6 (B2r / B3r): Hat `title / subtitle / logoUrl / bgUrl`, Features icon names, every action type of §3.4; a block's
 * style override (colours, radius, border, width, mode — approximate) with `data-style-mode` / `data-styled` on
 * `me-preview-block`; the menu bar `me-preview-menu` (shown items, when the menu is on); the page font
 * (`data-font`, applied when the browser has it — nothing is loaded) and the preset swatch as background only when the
 * page has no own background colour (`data-color-id`; K16: mssg's real colours may differ).
 */
import type { MssgBlockProjection, MssgSiteProjection } from '#shared/types/mssg-sites'

const props = withDefaults(defineProps<{
  site: MssgSiteProjection | null
  url: string
  siteId: string
  /** the page to show (step 2 selection); empty → the home page */
  pageId?: string
}>(), { pageId: '' })

const home = computed(() => mssgHomePage(props.site))
const page = computed(() => (props.pageId && props.site?.pages.find(p => p.id === props.pageId)) || home.value)
const blocks = computed(() => (page.value?.blocks ?? []).filter(b => b.enabled))
const ownBg = computed(() => {
  const c = page.value?.theme?.page?.backgroundColor
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : null
})
/** v1.6: the preset's display swatch (Apollo's colours) when the page has no background colour of its own */
const swatch = computed(() => mssgThemeSwatch(page.value?.theme))
const bg = computed(() => ownBg.value ?? swatch.value?.bg ?? '#FFFFFF')
const colorId = computed(() => (typeof page.value?.theme?.colorId === 'string' ? page.value.theme.colorId : ''))
const font = computed(() => page.value?.theme?.page?.font ?? null)
const fontCss = computed(() => mssgFontCss(font.value))
const menuItems = computed(() => {
  const m = props.site?.menu
  if (!m?.enabled) return []
  return m.items.filter(it => it.enabled && props.site?.pages.some(p => p.id === it.page)).slice(0, 6)
})
/** M3: page background image (`upload:<id>` through the API client, or an http(s) URL) over the colour */
const bgImageValue = computed(() => {
  const i = page.value?.theme?.page?.backgroundImage
  return typeof i === 'string' && i ? i : null
})
const { src: bgImageSrc } = useMssgImageSrc(() => props.siteId, bgImageValue)
const bgStyle = computed(() => ({
  'background-color': bg.value,
  'color': fg.value,
  ...(fontCss.value ? { 'font-family': fontCss.value } : {}),
  ...(bgImageSrc.value ? { 'background-image': `url(${JSON.stringify(bgImageSrc.value)})`, 'background-size': 'cover', 'background-position': 'center' } : {})
}))
/** dark text on a light background and vice versa */
const fg = computed(() => {
  const hex = bg.value.slice(1)
  const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#18181B' : '#FAFAFA'
})

// ── per-kind helpers (fields are mssg's, so every read is defensive) ────────────────────────────────────────────────
function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter(x => x && typeof x === 'object') as Record<string, unknown>[] : []
}
function host(url: unknown): string {
  try {
    return new URL(str(url)).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
function paragraphs(b: MssgBlockProjection): string[] {
  return mssgHtmlToText(str(b.fields.html)).split(/\n+/).filter(Boolean).slice(0, 6)
}
function linkTarget(b: MssgBlockProjection): string {
  return mssgActionText(b.fields.action, props.site)
}
/** v1.6: the block's style override (approximate) */
function blockStyle(b: MssgBlockProjection) {
  return mssgPreviewStyle(b.fields, b.kind)
}
function glyphText(it: Record<string, unknown>): string {
  const g = (it.glyph ?? {}) as Record<string, unknown>
  if (g.type === 'icon' && typeof g.icon === 'string') return g.icon
  return str(g.value) || '•'
}
function countdown(b: MssgBlockProjection): string {
  const t = new Date(str(b.fields.expireDate)).getTime()
  if (Number.isNaN(t)) return '--:--:--'
  const s = Math.max(0, Math.floor((t - Date.now()) / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${d} วัน ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
</script>

<template>
  <aside
    aria-label="ตัวอย่างหน้าเว็บ"
    class="flex min-w-0 flex-col items-center gap-3 rounded-lg border border-default bg-elevated/40 p-4"
    data-testid="me-preview"
    :data-page-id="page?.id ?? ''"
    :data-blocks="blocks.length"
  >
    <div class="flex w-full items-center justify-between gap-2">
      <UBadge
        label="ร่าง"
        color="primary"
        variant="subtle"
        size="sm"
      />
      <span class="text-sm text-toned">ตัวอย่างบนมือถือ</span>
    </div>
    <div
      class="flex min-h-120 w-full max-w-80 flex-col overflow-hidden rounded-[28px] border-8 border-accented"
      :style="bgStyle"
      data-testid="me-preview-screen"
      :data-bg="bg"
      :data-bg-image="bgImageValue ? 'true' : 'false'"
      :data-color-id="colorId"
      :data-font="font?.family ?? ''"
    >
      <div class="flex flex-col gap-0.5 border-b border-current/10 px-4 py-2 text-center">
        <span class="text-sm font-semibold break-words" data-testid="me-preview-name">{{ site?.name || '—' }}</span>
        <span class="truncate text-[11px] opacity-70" data-testid="me-preview-url">{{ url }}</span>
        <span v-if="page && page.id !== home?.id" class="truncate text-[11px] opacity-70" data-testid="me-preview-page">หน้า: {{ page.name }} (/{{ page.slug }})</span>
      </div>
      <nav
        v-if="menuItems.length > 1"
        aria-label="เมนูของเว็บ (ตัวอย่าง)"
        class="flex gap-1 overflow-x-auto border-b border-current/10 px-3 py-1.5"
        data-testid="me-preview-menu"
        :data-count="menuItems.length"
      >
        <span
          v-for="it in menuItems"
          :key="it.page"
          class="shrink-0 rounded-full px-2 py-0.5 text-[11px]"
          :class="it.page === page?.id ? 'bg-current/15 font-medium' : 'opacity-75'"
        >{{ it.label }}</span>
      </nav>
      <div class="flex flex-1 flex-col gap-2.5 p-4">
        <p v-if="!page" class="py-10 text-center text-xs opacity-70" data-testid="me-preview-empty">
          เว็บนี้ยังไม่มีหน้า
        </p>
        <p v-else-if="!blocks.length" class="py-10 text-center text-xs opacity-70" data-testid="me-preview-empty">
          หน้านี้ยังไม่มี block ที่แสดงอยู่
        </p>
        <div
          v-for="b in blocks"
          :key="b.id"
          class="min-w-0"
          data-testid="me-preview-block"
          :data-kind="b.kind"
          :data-block-id="b.id"
          :data-styled="Object.keys(blockStyle(b).style).length ? 'true' : 'false'"
          :data-style-mode="blockStyle(b).mode ?? ''"
        >
          <!-- Profile -->
          <div v-if="b.kind === 'Hat'" class="flex flex-col items-center gap-1.5 py-1 text-center">
            <MssgEditorImage
              v-if="str(b.fields.bgUrl)"
              :site-id="siteId"
              :value="str(b.fields.bgUrl)"
              alt=""
              class="h-20 w-full rounded-lg"
            />
            <MssgEditorImage
              v-if="str(b.fields.logoUrl)"
              :site-id="siteId"
              :value="str(b.fields.logoUrl)"
              alt=""
              class="size-16 rounded-full"
              :class="str(b.fields.bgUrl) ? '-mt-8 ring-2 ring-current/20' : ''"
            />
            <span v-if="str(b.fields.title)" class="text-base font-semibold break-words">{{ b.fields.title }}</span>
            <span v-if="str(b.fields.subtitle)" class="text-xs break-words opacity-75">{{ b.fields.subtitle }}</span>
          </div>
          <!-- Link -->
          <div
            v-else-if="b.kind === 'Link'"
            class="mx-auto flex min-h-11 w-full flex-col items-center justify-center rounded-xl bg-current/10 px-3 py-2 text-center"
            :class="{ 'shadow-md': blockStyle(b).mode === 'card', 'aspect-square max-w-[50%]': blockStyle(b).mode === 'square' || blockStyle(b).mode === 'grid', 'min-h-20': blockStyle(b).mode === 'tall' }"
            :style="blockStyle(b).style"
          >
            <span class="text-sm font-medium break-words">{{ str(b.fields.title) || 'ลิงก์' }}</span>
            <span v-if="linkTarget(b)" class="max-w-full truncate text-[10px] opacity-60">{{ linkTarget(b) }}</span>
          </div>
          <!-- Text -->
          <div v-else-if="b.kind === 'TextRich'" class="flex flex-col gap-1 text-sm">
            <p v-for="(t, k) in paragraphs(b)" :key="k" class="break-words">
              {{ t }}
            </p>
          </div>
          <!-- Image -->
          <MssgEditorImage
            v-else-if="b.kind === 'Image'"
            :site-id="siteId"
            :value="str(b.fields.url)"
            alt=""
            class="aspect-video w-full rounded-lg"
          />
          <!-- Gallery -->
          <div v-else-if="b.kind === 'ImageGallery'" class="grid grid-cols-3 gap-1">
            <MssgEditorImage
              v-for="(img, k) in arr(b.fields.images).slice(0, 6)"
              :key="k"
              :site-id="siteId"
              :value="str(img.url)"
              alt=""
              class="aspect-square w-full rounded"
            />
          </div>
          <!-- Video / Video gallery / Music / Giphy / Map / Code / Products -->
          <div
            v-else-if="['Video', 'VideoGallery', 'AudioEmbed', 'Giphy', 'Map', 'CustomCode', 'Products'].includes(b.kind)"
            class="flex items-center gap-2 rounded-lg bg-current/10 px-3 py-2.5"
            :class="b.kind === 'Video' || b.kind === 'VideoGallery' ? 'aspect-video justify-center' : ''"
          >
            <UIcon
              :name="{ Video: 'i-lucide-play', VideoGallery: 'i-lucide-film', AudioEmbed: 'i-lucide-music', Giphy: 'i-lucide-sticker', Map: 'i-lucide-map-pin', CustomCode: 'i-lucide-code', Products: 'i-lucide-shopping-bag' }[b.kind]"
              class="size-5 shrink-0 opacity-70"
            />
            <span class="min-w-0 text-xs break-words opacity-80">
              <template v-if="b.kind === 'Map'">{{ str(b.fields.address) }}</template>
              <template v-else-if="b.kind === 'VideoGallery'">{{ arr(b.fields.videos).length }} วิดีโอ</template>
              <template v-else-if="b.kind === 'Products'">สินค้าของร้าน</template>
              <template v-else-if="b.kind === 'CustomCode'">โค้ด HTML</template>
              <template v-else-if="b.kind === 'Giphy'">GIF · {{ str(b.fields.giphyId) }}</template>
              <template v-else>{{ host(b.fields.url) || mssgBlockKindLabel(b.kind) }}</template>
            </span>
          </div>
          <!-- Timer -->
          <div v-else-if="b.kind === 'Timer'" class="rounded-lg bg-current/10 px-3 py-2 text-center font-mono text-lg tabular-nums">
            {{ countdown(b) }}
          </div>
          <!-- Divider -->
          <hr v-else-if="b.kind === 'Divider'" class="my-1 border-current/30">
          <!-- FAQ -->
          <div v-else-if="b.kind === 'Accordion'" class="flex flex-col divide-y divide-current/15 rounded-lg border border-current/20">
            <div v-for="(it, k) in arr(b.fields.items).slice(0, 5)" :key="k" class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span class="min-w-0 break-words">{{ str(it.title) }}</span>
              <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0 opacity-60" />
            </div>
          </div>
          <!-- Features -->
          <div v-else-if="b.kind === 'Features'" class="flex flex-col gap-1.5">
            <div v-for="(it, k) in arr(b.fields.items).slice(0, 5)" :key="k" class="flex gap-2 text-sm">
              <span class="shrink-0 rounded bg-current/10 px-1 text-[10px] leading-5 opacity-80" aria-hidden="true">{{ glyphText(it) }}</span>
              <span class="flex min-w-0 flex-col">
                <span class="font-medium break-words">{{ str(it.title) }}</span>
                <span v-if="str(it.content)" class="text-xs break-words opacity-75">{{ str(it.content) }}</span>
              </span>
            </div>
          </div>
          <!-- Messengers / Socials -->
          <div
            v-else-if="b.kind === 'Messengers' || b.kind === 'Socials'"
            class="flex flex-wrap justify-center gap-1.5"
            :class="{ 'flex-col items-stretch': blockStyle(b).mode === 'list' }"
          >
            <span
              v-for="(it, k) in arr(b.kind === 'Messengers' ? b.fields.messengers : b.fields.items).filter(x => x.enabled !== false).slice(0, 8)"
              :key="k"
              class="rounded-full bg-current/10 px-2.5 py-1 text-center text-[11px]"
              :class="{ 'px-4 py-2 text-xs': blockStyle(b).mode === 'beefy' }"
              :style="blockStyle(b).style"
            >{{ b.kind === 'Messengers' ? (MSSG_MESSENGER_PLATFORM_LABEL[str(it.platform)] ?? str(it.platform)) : (host(it.url) || 'link') }}</span>
          </div>
          <!-- Form -->
          <div v-else-if="b.kind === 'SubscriptionForm'" class="flex flex-col gap-1.5 rounded-lg border border-current/20 p-2.5">
            <span v-for="(it, k) in arr(b.fields.items).slice(0, 5)" :key="k" class="rounded border border-current/20 px-2 py-1 text-xs opacity-70">{{ str(it.label) }}{{ it.required ? ' *' : '' }}</span>
            <span class="rounded bg-current/15 px-2 py-1.5 text-center text-xs font-medium">{{ str(b.fields.sendLabel) || 'Send' }}</span>
          </div>
          <!-- unknown kind -->
          <div v-else class="rounded-lg border border-dashed border-current/30 px-3 py-2 text-xs opacity-70">
            {{ mssgBlockKindLabel(b.kind) }}
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
