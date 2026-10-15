<script setup lang="ts">
/**
 * FEAT-049 — the card grid of the media library (spec "UI behaviour" → card).
 * One component for both consumers, so the page proves the picker's internals:
 * - `pages/media-library.vue` uses it with `prefix="ml"` (rename + delete actions),
 * - `components/media/MediaPicker.vue` uses it with `prefix="mp"` and `selectable` (a click selects the image
 *   and the row actions are gone).
 *
 * Image `src` follows the consumer rule of api-contract §4: an absolute presigned URL is loaded from the bucket
 * host as-is, an API-relative `/media/<id>/content` (Mongo mode) goes through the BO's `/backend` proxy. A failed
 * `<img>` load is almost always an expired presigned URL, so the first failure asks the parent for **one** silent
 * list re-read (`refresh`) and only a second failure puts the card into `data-state="error"` — the same guard as
 * `ad-templates/PostCover.vue`.
 *
 * The inline rename owns its `PATCH /media/:id` (like every delete modal of the BO owns its `DELETE`) and hands
 * the fresh view to the parent, which patches the row in place — a rename never re-reads the list.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { MediaAssetView, MediaRecommended, MediaRecommendedSize } from '#shared/types/media'
import {
  MEDIA_IMG_MAX_RETRIES,
  formatMediaBytes,
  formatMediaDateTime,
  formatMediaDimensions,
  isMediaRatioOff,
  mediaAssetTypeLabel,
  mediaRatioWarning,
  mediaRecommendedFor,
  mediaSrc,
  mediaUsedByTooltip,
  mediaUsedLabel
} from '~/utils/media'

const props = withDefaults(defineProps<{
  items: MediaAssetView[]
  /**
   * `options.recommended` — the whole **per-type** map (contract v2), never one size: every card compares itself
   * against the size of its own `assetType`. The ±10 % chip is skipped while the options are not loaded yet.
   */
  recommended?: MediaRecommended | null
  /** testid namespace: `ml` on the page, `mp` inside the picker */
  prefix?: 'ml' | 'mp'
  /** picker mode: the whole card is a button, no rename and no delete */
  selectable?: boolean
  selectedId?: string | null
}>(), {
  recommended: null,
  prefix: 'ml',
  selectable: false,
  selectedId: null
})

const emit = defineEmits<{
  select: [asset: MediaAssetView]
  delete: [asset: MediaAssetView]
  renamed: [asset: MediaAssetView]
  /** one silent list re-read, asked for by the first `<img>` failure of a card */
  refresh: []
}>()

const api = useApi()
const toast = useToast()

const testid = (name: string) => `${props.prefix}-${name}`

// ── image load state ────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * `src` → it loaded; and per **card** how often its image failed. The counter is never reset, so a permanently
 * broken image costs exactly one extra list read for the whole page lifetime and can never loop.
 * After `MEDIA_IMG_MAX_RETRIES` failures the card shows the error box and stops requesting bytes.
 */
const imgLoaded = ref<Record<string, boolean>>({})
const imgFails = ref<Record<string, number>>({})

/**
 * A storage-mode `url` is signed: the retry has to come from the list re-read (a new signature), appending
 * anything would make the signature invalid. A Mongo-mode url (`/media/<id>/content` through `/backend`) never
 * changes, so the retry carries `_retry=<n>` to force the browser to request the bytes again.
 */
function imgSrc(asset: MediaAssetView): string {
  const base = mediaSrc(asset.url)
  const fails = imgFails.value[asset.id] ?? 0
  if (fails === 0 || !asset.url.startsWith('/')) return base
  return `${base}${base.includes('?') ? '&' : '?'}_retry=${fails}`
}

function hardFailed(asset: MediaAssetView): boolean {
  return (imgFails.value[asset.id] ?? 0) > MEDIA_IMG_MAX_RETRIES
}

function cardState(asset: MediaAssetView): 'loading' | 'ready' | 'error' {
  if (hardFailed(asset)) return 'error'
  return imgLoaded.value[imgSrc(asset)] ? 'ready' : 'loading'
}

function onImgLoad(asset: MediaAssetView) {
  imgLoaded.value = { ...imgLoaded.value, [imgSrc(asset)]: true }
}

function onImgError(asset: MediaAssetView) {
  const fails = (imgFails.value[asset.id] ?? 0) + 1
  imgFails.value = { ...imgFails.value, [asset.id]: fails }
  // most likely an expired presigned URL — one silent re-read, then this card is an error
  if (fails <= MEDIA_IMG_MAX_RETRIES) emit('refresh')
}

// ── inline rename (page mode only) ──────────────────────────────────────────────────────────────────────────────────
const editingId = ref<string | null>(null)
const draft = ref('')
const renameError = ref<string | null>(null)
const saving = ref(false)

function startRename(asset: MediaAssetView) {
  if (props.selectable || saving.value) return
  editingId.value = asset.id
  draft.value = asset.name
  renameError.value = null
}

function cancelRename() {
  editingId.value = null
  draft.value = ''
  renameError.value = null
}

async function saveRename(asset: MediaAssetView) {
  if (saving.value) return
  const name = draft.value.trim()
  if (!name) {
    renameError.value = 'ใส่ชื่อ'
    return
  }
  if (name === asset.name) {
    cancelRename()
    return
  }
  saving.value = true
  try {
    // retry: 0 — exactly one PATCH per save
    const updated = await api<MediaAssetView>(`/media/${encodeURIComponent(asset.id)}`, {
      method: 'PATCH',
      retry: 0,
      body: { name }
    })
    emit('renamed', updated)
    cancelRename()
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    toast.add({
      title: 'เปลี่ยนชื่อไม่ได้',
      description: err.data?.error ?? err.data?.issues?.[0]?.message ?? err.message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    saving.value = false
  }
}

// ── presentation ────────────────────────────────────────────────────────────────────────────────────────────────────
/** the recommended size of **this card's** type (`null` → no chip: nothing to compare against) */
function recommendedOf(asset: MediaAssetView): MediaRecommendedSize | null {
  return mediaRecommendedFor(props.recommended, asset.assetType)
}

function ratioOff(asset: MediaAssetView): boolean {
  return isMediaRatioOff(asset.width, asset.height, recommendedOf(asset))
}

function usedNames(asset: MediaAssetView): string {
  return mediaUsedByTooltip(asset.usedBy?.templates?.map(template => template.name) ?? [])
}

function onCardClick(asset: MediaAssetView) {
  if (props.selectable) emit('select', asset)
}
</script>

<template>
  <div
    class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
    :data-testid="testid('grid')"
  >
    <div
      v-for="asset in items"
      :key="asset.id"
      :data-id="asset.id"
      :data-testid="testid('card')"
      :data-state="cardState(asset)"
      :data-selected="selectedId === asset.id ? 'true' : 'false'"
      class="flex flex-col overflow-hidden rounded-lg border border-default bg-default"
      :class="[
        selectable ? 'cursor-pointer hover:border-primary focus-visible:outline-2' : '',
        selectedId === asset.id ? 'border-primary ring-2 ring-primary' : ''
      ]"
      :role="selectable ? 'button' : undefined"
      :tabindex="selectable ? 0 : undefined"
      @click="onCardClick(asset)"
      @keydown.enter="onCardClick(asset)"
    >
      <div class="relative flex aspect-video items-center justify-center overflow-hidden bg-elevated">
        <img
          v-if="cardState(asset) !== 'error'"
          :src="imgSrc(asset)"
          :alt="asset.name"
          loading="lazy"
          decoding="async"
          class="size-full object-contain"
          :data-testid="testid('img')"
          @load="onImgLoad(asset)"
          @error="onImgError(asset)"
        >
        <UIcon
          v-else
          name="i-lucide-image-off"
          class="size-6 text-dimmed"
          title="โหลดรูปไม่ได้"
        />
      </div>

      <div class="flex flex-1 flex-col gap-1.5 p-2.5 text-sm">
        <!-- name: click (or the pencil) opens the inline editor; Enter saves, Esc cancels -->
        <div v-if="editingId === asset.id" class="flex flex-col gap-1">
          <div class="flex items-center gap-1">
            <UInput
              v-model="draft"
              size="xs"
              autofocus
              class="min-w-0 flex-1"
              :disabled="saving"
              :data-testid="testid('rename-input')"
              @keydown.enter.stop.prevent="saveRename(asset)"
              @keydown.esc.stop.prevent="cancelRename"
              @click.stop
            />
            <UButton
              icon="i-lucide-check"
              color="primary"
              variant="solid"
              size="xs"
              aria-label="Save name"
              :loading="saving"
              :data-testid="testid('rename-save')"
              @click.stop="saveRename(asset)"
            />
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="Cancel rename"
              :disabled="saving"
              :data-testid="testid('rename-cancel')"
              @click.stop="cancelRename"
            />
          </div>
          <span
            v-if="renameError"
            class="text-xs text-error"
            :data-testid="testid('rename-error')"
          >{{ renameError }}</span>
        </div>
        <div v-else class="flex items-start gap-1">
          <span
            class="line-clamp-2 min-w-0 flex-1 font-medium break-all text-highlighted"
            :title="asset.name"
            :data-testid="testid('name')"
            @click.stop="startRename(asset)"
          >{{ asset.name }}</span>
          <UButton
            v-if="!selectable"
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Rename"
            title="เปลี่ยนชื่อ"
            :data-testid="testid('rename')"
            @click.stop="startRename(asset)"
          />
        </div>

        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <UBadge
            color="neutral"
            variant="subtle"
            size="sm"
            class="w-fit"
            :data-testid="testid('type')"
            :data-type="asset.assetType ?? ''"
          >
            {{ mediaAssetTypeLabel(asset.assetType) }}
          </UBadge>
          <span :data-testid="testid('dims')">{{ formatMediaDimensions(asset.width, asset.height) }}</span>
          <span :data-testid="testid('bytes')">{{ formatMediaBytes(asset.bytes) }}</span>
        </div>

        <div class="flex flex-col gap-0.5 text-xs text-muted">
          <span :data-testid="testid('created-at')">{{ formatMediaDateTime(asset.createdAt) }}</span>
          <span :data-testid="testid('created-by')">โดย {{ asset.uploadedBy?.username ?? '—' }}</span>
        </div>

        <span class="text-xs text-muted" :data-testid="testid('used')">{{ mediaUsedLabel(asset.usedBy?.count ?? 0) }}</span>

        <UBadge
          v-if="ratioOff(asset)"
          color="warning"
          variant="subtle"
          size="sm"
          icon="i-lucide-triangle-alert"
          class="w-fit"
          :data-testid="testid('ratio-warn')"
        >
          {{ mediaRatioWarning(recommendedOf(asset)) }}
        </UBadge>

        <div v-if="!selectable" class="mt-auto flex justify-end pt-1">
          <!-- an image a template still references cannot be deleted: disabled + the template names (no request) -->
          <span :title="(asset.usedBy?.count ?? 0) > 0 ? usedNames(asset) : undefined">
            <UTooltip
              :text="usedNames(asset)"
              :disabled="(asset.usedBy?.count ?? 0) === 0"
            >
              <UButton
                icon="i-lucide-trash-2"
                color="error"
                variant="subtle"
                size="xs"
                label="ลบ"
                :disabled="(asset.usedBy?.count ?? 0) > 0"
                :title="(asset.usedBy?.count ?? 0) > 0 ? usedNames(asset) : 'ลบรูป'"
                :data-testid="testid('delete')"
                @click.stop="emit('delete', asset)"
              />
            </UTooltip>
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
