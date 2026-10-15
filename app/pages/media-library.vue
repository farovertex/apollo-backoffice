<script setup lang="ts">
/**
 * FEAT-049 — Media library (คลังรูปกลาง · functions 5.1 / 5.2 / 5.4; api-contract.md **v2** §5).
 *
 * One public library for every workspace and every role (`mediaAssets.workspaceId = null`, the API guards with
 * `AuthGuard` only), so this page has no role gate and no workspace filter — the sidebar shows it to everybody.
 *
 * Uploading happens in `MediaUploadModal` (2026-10-15), not on the page: `assetType` is written once and can
 * never be patched, so the type has to be an explicit choice in front of the file picker instead of a select
 * sitting next to a file button that works without it.
 *
 * Requests, all through `useApi()` → `/backend`:
 * - `GET /media/options` **once per page lifetime** (cached in `useMediaUpload` at module level, shared with the
 *   upload modal and a mounted `MediaPicker`): it decides the upload flow (`mode`) and carries every limit, so
 *   the page hard-codes no size, no mime list and no recommended ratio (which is per `assetType` since v2);
 * - exactly one `GET /media?scope=public&page=&limit=24[&search=][&assetType=]` per load / Refresh / page change /
 *   debounced search / type filter / finished upload batch / delete / presigned refresh (`useMediaList`);
 * - `PATCH /media/:id` from the inline rename (the row is patched in place, no list re-read) and
 *   `DELETE /media/:id` from the confirm modal (the card leaves at once, then one re-read).
 *
 * The only requests that do **not** go through the proxy are the presigned `PUT` of an upload and the `<img>`
 * loads of a storage-mode `url` — both are browser-to-bucket by design (contract §8).
 */
import type { MediaAssetType, MediaAssetView } from '#shared/types/media'
import { MEDIA_ASSET_TYPES, MEDIA_PAGE_SIZE, mediaAssetTypeLabel } from '~/utils/media'

useSeoMeta({ title: 'Media library' })

const list = useMediaList(MEDIA_PAGE_SIZE)
/** the page itself uploads nothing — it only needs `options.recommended` for the grid's per-type ratio chip */
const upload = useMediaUpload()

const FILTER_ITEMS: { label: string, value: MediaAssetType | 'all' }[] = [
  { label: 'ทุกประเภท', value: 'all' },
  ...MEDIA_ASSET_TYPES.map(value => ({ label: mediaAssetTypeLabel(value), value }))
]

const uploadOpen = ref(false)
const deleteOpen = ref(false)
const deleteTarget = ref<MediaAssetView | null>(null)

/**
 * what the upload modal starts on: the type the list is filtered to, or nothing — a type is never guessed for
 * the user, because `assetType` cannot be changed after the upload (contract §5.6 patches `name` only).
 */
const uploadDefaultType = computed<MediaAssetType | null>(() => {
  const filter = list.assetType.value
  return filter === 'all' ? null : filter
})

onMounted(() => {
  void list.load()
  void upload.loadOptions()
})

/** one finished batch inside the modal → the newest page, exactly one request (the modal stays open) */
function onUploaded() {
  list.reloadNewest()
}

function askDelete(asset: MediaAssetView) {
  deleteTarget.value = asset
  deleteOpen.value = true
}

function onDeleted(id: string) {
  list.removeLocally(id)
  // last card of a page → step back one page, otherwise re-read the current one silently (one request either way)
  if (list.items.value.length === 0 && list.page.value > 1) list.reload(list.page.value - 1)
  else list.reload(undefined, true)
}

/** a 409 `inUse` on a card the grid thought was free: the list is out of date, read it once */
function onStale() {
  list.reload(undefined, true)
}

function onRenamed(asset: MediaAssetView) {
  list.patchLocally(asset)
}

/** first `<img>` failure of a card (probably an expired presigned url) → one silent list re-read */
function onImgRefresh() {
  list.reload(undefined, true)
}

function clearFilters() {
  list.clearSearch()
  list.assetType.value = 'all'
}

const showGrid = computed(() => !list.error.value && !list.isEmpty.value && list.items.value.length > 0)
const showLoading = computed(() => list.pending.value && list.items.value.length === 0)
</script>

<template>
  <UDashboardPanel id="media-library">
    <template #header>
      <UDashboardNavbar title="Media library">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>

        <template #right>
          <UButton
            label="Refresh"
            aria-label="Refresh"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="outline"
            :loading="list.pending.value"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="ml-refresh"
            @click="list.reload()"
          />

          <UButton
            label="อัปโหลดรูป"
            aria-label="อัปโหลดรูป"
            icon="i-lucide-upload"
            color="primary"
            variant="solid"
            :ui="{ label: 'hidden sm:inline' }"
            data-testid="ml-upload-open"
            @click="uploadOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        data-testid="ml-page"
        :data-pending="list.pending.value ? 'true' : 'false'"
        :data-mode="upload.options.value?.mode ?? ''"
        class="flex flex-1 flex-col gap-4"
      >
        <!-- search + filter stack vertically on mobile (spec "viewports"); uploading lives in its own modal -->
        <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
          <UInput
            v-model="list.search.value"
            class="w-full sm:max-w-sm"
            icon="i-lucide-search"
            placeholder="ค้นหาชื่อรูป"
            data-testid="ml-search"
          />

          <USelect
            v-model="list.assetType.value"
            :items="FILTER_ITEMS"
            class="w-full sm:w-44"
            aria-label="กรองตามประเภท"
            data-testid="ml-filter-type"
          />
        </div>

        <UAlert
          v-if="list.error.value"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="โหลดคลังรูปไม่ได้"
          :description="list.error.value"
          data-testid="ml-error"
        >
          <template #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              :loading="list.pending.value"
              data-testid="ml-retry"
              @click="list.load()"
            />
          </template>
        </UAlert>

        <div
          v-else-if="showLoading"
          class="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
          data-testid="ml-loading"
        >
          <USkeleton v-for="n in 8" :key="n" class="h-48 w-full rounded-lg" />
        </div>

        <UEmpty
          v-else-if="list.isEmpty.value && !list.hasSearch.value && !list.hasTypeFilter.value"
          icon="i-lucide-images"
          title="ยังไม่มีรูปในคลัง"
          description="กดอัปโหลดรูป แล้วเลือกประเภทกับไฟล์ในหน้าต่างที่เปิดขึ้น"
          data-testid="ml-empty"
        >
          <template #actions>
            <UButton
              label="อัปโหลดรูป"
              icon="i-lucide-upload"
              color="primary"
              variant="solid"
              data-testid="ml-empty-upload"
              @click="uploadOpen = true"
            />
          </template>
        </UEmpty>

        <UEmpty
          v-else-if="list.isEmpty.value"
          icon="i-lucide-search-x"
          title="ไม่พบรูปตามตัวกรอง"
          data-testid="ml-no-match"
        >
          <template #actions>
            <UButton
              label="ล้างตัวกรอง"
              icon="i-lucide-x"
              color="neutral"
              variant="outline"
              data-testid="ml-clear-search"
              @click="clearFilters()"
            />
          </template>
        </UEmpty>

        <MediaGrid
          v-if="showGrid"
          :items="list.items.value"
          :recommended="upload.options.value?.recommended ?? null"
          prefix="ml"
          @delete="askDelete"
          @renamed="onRenamed"
          @refresh="onImgRefresh"
        />

        <div
          v-if="!list.error.value"
          class="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-default pt-4 text-sm text-muted"
        >
          <span data-testid="ml-count">{{ list.total.value }} รูป</span>

          <UPagination
            v-if="list.total.value > list.limit"
            :page="list.page.value"
            :items-per-page="list.limit"
            :total="list.total.value"
            data-testid="ml-pagination"
            @update:page="(p: number) => list.page.value = p"
          />
        </div>
      </div>

      <MediaUploadModal
        v-model:open="uploadOpen"
        :default-type="uploadDefaultType"
        @uploaded="onUploaded"
      />

      <MediaDeleteConfirm
        v-model:open="deleteOpen"
        :asset="deleteTarget"
        @deleted="onDeleted"
        @stale="onStale"
      />
    </template>
  </UDashboardPanel>
</template>
