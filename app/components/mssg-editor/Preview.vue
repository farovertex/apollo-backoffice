<script setup lang="ts">
/**
 * FEAT-101 — mobile preview (design aside "ตัวอย่างบนมือถือ"), rendered from the draft's preview (server `preview` +
 * local site fields). B1 renders the site name, the resulting URL and the home page's blocks in a simple form (kind +
 * one line of text, hidden blocks dimmed); B2 refines the rendering per block kind. Approximate, not pixel-exact.
 * Test ids: `me-preview` (`data-page-id`, `data-blocks`), `me-preview-block` (`data-kind`, `data-enabled`).
 */
import type { MssgSiteProjection } from '#shared/types/mssg-sites'

const props = defineProps<{
  site: MssgSiteProjection | null
  url: string
}>()

const home = computed(() => mssgHomePage(props.site))
const blocks = computed(() => home.value?.blocks ?? [])
const bg = computed(() => {
  const c = home.value?.theme?.page?.backgroundColor
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#FFFFFF'
})
/** dark text on a light background and vice versa */
const fg = computed(() => {
  const hex = bg.value.slice(1)
  const [r, g, b] = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? '#18181B' : '#FAFAFA'
})
</script>

<template>
  <aside
    aria-label="ตัวอย่างหน้าเว็บ"
    class="flex min-w-0 flex-col items-center gap-3 rounded-lg border border-default bg-elevated/40 p-4"
    data-testid="me-preview"
    :data-page-id="home?.id ?? ''"
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
      :style="{ background: bg, color: fg }"
    >
      <div class="flex flex-col gap-0.5 border-b border-current/10 px-4 py-2 text-center">
        <span class="text-sm font-semibold break-words" data-testid="me-preview-name">{{ site?.name || '—' }}</span>
        <span class="truncate text-[11px] opacity-70" data-testid="me-preview-url">{{ url }}</span>
      </div>
      <div class="flex flex-1 flex-col gap-2.5 p-4">
        <p v-if="!home" class="py-10 text-center text-xs opacity-70">
          เว็บนี้ยังไม่มีหน้า
        </p>
        <p v-else-if="!blocks.length" class="py-10 text-center text-xs opacity-70">
          หน้าแรกยังไม่มี block
        </p>
        <div
          v-for="block in blocks"
          :key="block.id"
          class="flex min-h-11 flex-col justify-center gap-0.5 rounded-lg border border-current/20 px-3 py-2"
          :class="block.enabled ? '' : 'opacity-40'"
          data-testid="me-preview-block"
          :data-kind="block.kind"
          :data-enabled="block.enabled ? 'true' : 'false'"
        >
          <span class="text-[11px] opacity-70">{{ mssgBlockKindLabel(block.kind) }}<template v-if="!block.enabled"> · ซ่อนอยู่</template></span>
          <span v-if="mssgBlockPreviewText(block.fields)" class="text-sm font-medium break-words">{{ mssgBlockPreviewText(block.fields) }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>
