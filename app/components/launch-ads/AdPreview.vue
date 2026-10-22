<script setup lang="ts">
/**
 * FEAT-062 — "ตัวอย่างโฆษณา": what the ad that `/launch-ads` is about to build looks like. Rendered twice with
 * different `testid` prefixes: in the Summary aside on steps 1–2 (`la-preview`) and under "What will be built"
 * on step 3 · Review (`la-review-preview`).
 *
 * Everything comes from the **ad-template list row** the page already loaded (api-contract §1): `postInfo`
 * summary (cover flag, owner, status, validity), `config.adTexts`, `config.cta`, `config.destination.page`
 * (+ `buttonImage`), `config.addOn` (+ `addOnImage`). The only request of its own is the cover, through
 * `AdTemplatesPostCover` → `useCoverImage`, keyed `<id>|<checkedAt>` — **the same key as the row thumb and the
 * form modal** (BUG-061), so a re-verify replaces the image instead of keeping the previous post's cover.
 * No enum label is hard-coded: CTA, tone and language read `/ad-templates/options` (raw value as fallback).
 *
 * Image failure (spec AS-9 / AC-9): `buttonImage.url` / `addOnImage.url` may be a 15-minute presigned URL with
 * no `expiresAt` in this view, so a page left open can outlive it. The **first** `<img>` error of either image
 * for the current template id triggies exactly one `GET /ad-templates/:id` (`retry: 0`); the fresh view is
 * emitted as `updated` (the page swaps the row, both preview instances and the row thumb use the new URL) and
 * the `<img>` reloads from it. A second error, a failed re-read or a 404 shows the placeholder with
 * `data-state="error"` and title "โหลดรูปไม่ได้" — silently: no toast, no console error, no further request.
 * The guard resets when the template id changes. Mirrors `ad-templates/PostCover.vue`'s guard pattern.
 */
import type {
  AdAddOnImage,
  AdTemplate,
  AdTemplateOptions,
  OptionItem
} from '#shared/types/ad-templates'
import { adAddOnSummaryText, readAdAddOn } from '~/utils/ad-add-on'
import { ctaValuesFrom } from '~/utils/ad-cta'
import { hasButtonImage } from '~/utils/ad-cta-image'
import { formatMediaDimensions, mediaSrc } from '~/utils/media'
import { formatPostInfoDate, hasPostCover, postInfoCheckedAt, postInfoKindLabel } from '~/utils/post-info'

const props = withDefaults(defineProps<{
  /** the selected ad-template **list row** (`null` = nothing picked yet → the empty state) */
  template: AdTemplate | null
  /** `GET /ad-templates/options` as the page loaded it — the source of every label */
  options: AdTemplateOptions | null
  /** testid prefix; every testid below is `<testid>` + suffix */
  testid?: string
}>(), {
  testid: 'la-preview'
})

/** the one-shot re-read of AS-9: the page replaces that row in its list with this fresh view */
const emit = defineEmits<{ updated: [template: AdTemplate] }>()

const api = useApi()

const templateId = computed(() => props.template?.id ?? '')
const state = computed(() => (props.template ? 'ready' : 'empty'))
const postInfo = computed(() => props.template?.postInfo ?? null)
const kindLabel = computed(() => postInfoKindLabel(postInfo.value))
const untilLabel = computed(() => {
  const formatted = formatPostInfoDate(postInfo.value?.authEndAt)
  return formatted ? `ใช้ได้ถึง ${formatted}` : null
})

/** the label of an option value; falls back to the raw value so an unknown value still renders */
function labelOf(list: OptionItem[] | undefined, value: string | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return list?.find(item => item.value === value)?.label ?? value
}

// ── โพสต์ ────────────────────────────────────────────────────────────────────────────────────────────────────
/** the text `/launch-ads` shows for the bound post today (`postCell` of the page) */
const postText = computed(() => {
  const post = props.template?.config?.identity?.post
  if (!post) return ''
  if (post.selection === 'authCode') return 'code' in post && post.code ? post.code : ''
  return post.selection === 'named' ? post.text : 'First authorized post'
})
const ownerText = computed(() => postInfo.value?.ownerName || postText.value || '—')

// ── ข้อความ ──────────────────────────────────────────────────────────────────────────────────────────────────
const adTexts = computed(() => props.template?.config?.adTexts ?? [])

// ── CTA ──────────────────────────────────────────────────────────────────────────────────────────────────────
const ctaValues = computed(() =>
  ctaValuesFrom(props.template?.config?.cta, props.options?.systemDefault?.cta?.values ?? [])
)
function ctaLabel(value: string): string {
  return labelOf(props.options?.ctaValue, value)
}

// ── อินสแตนท์เพจ ─────────────────────────────────────────────────────────────────────────────────────────────
const destinationPage = computed(() => props.template?.config?.destination?.page ?? null)
const buttonMode = computed<'text' | 'image' | 'library'>(() => {
  const page = destinationPage.value
  if (page?.selection !== 'create') return 'library'
  return hasButtonImage(page) ? 'image' : 'text'
})
/** the text `/launch-ads` shows for a legacy page selection today (`pageCell` of the page) */
const pageText = computed(() => {
  const page = destinationPage.value
  return page?.selection === 'named' ? page.name : 'First in library'
})
const buttonText = computed(() => (destinationPage.value?.selection === 'create' ? destinationPage.value.buttonText : ''))
const buttonImage = computed<AdAddOnImage | null>(() => props.template?.buttonImage ?? null)
const pageUrl = computed(() => (destinationPage.value?.selection === 'create' ? destinationPage.value.url : ''))
/** the host of the instant page's link; the raw value when it is not a parsable URL */
const pageHost = computed(() => {
  const url = pageUrl.value
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
})
const toneLabel = computed(() =>
  destinationPage.value?.selection === 'create'
    ? labelOf(props.options?.instantPageTone, destinationPage.value.tone)
    : ''
)
const languageLabel = computed(() =>
  destinationPage.value?.selection === 'create'
    ? labelOf(props.options?.instantPageLanguage, destinationPage.value.language)
    : ''
)

// ── Add-on ───────────────────────────────────────────────────────────────────────────────────────────────────
const addOn = computed(() => readAdAddOn(props.template?.config?.addOn))
const addOnImage = computed<AdAddOnImage | null>(() => props.template?.addOnImage ?? null)
const addOnText = computed(() => (addOn.value ? adAddOnSummaryText(addOn.value) : ''))

// ── image failure (AS-9) ─────────────────────────────────────────────────────────────────────────────────────
const buttonImgFailed = ref(false)
const addOnImgFailed = ref(false)
/** at most one `GET /ad-templates/:id` per template id, for either image (the guard of PostCover.vue) */
const rereadDone = ref(false)

watch(templateId, () => {
  buttonImgFailed.value = false
  addOnImgFailed.value = false
  rereadDone.value = false
})

async function onImageError(which: 'button' | 'addon') {
  if (!rereadDone.value) {
    rereadDone.value = true
    const id = templateId.value
    if (id) {
      try {
        // retry: 0 — exactly one re-read; its failure is swallowed (the placeholder is the answer)
        const fresh = await api<AdTemplate>(`/ad-templates/${encodeURIComponent(id)}`, { retry: 0 })
        emit('updated', fresh)
        return
      } catch {
        // 404 = the image is gone, anything else = not readable right now; both end on the placeholder,
        // silently (the image is decoration, never an error the user must act on)
      }
    }
  }
  if (which === 'button') buttonImgFailed.value = true
  else addOnImgFailed.value = true
}

const buttonImageState = computed(() => {
  if (buttonImgFailed.value) return 'error'
  return buttonImage.value?.url ? 'ready' : 'none'
})
const addOnImageState = computed(() => {
  if (addOnImgFailed.value) return 'error'
  return addOnImage.value?.url ? 'ready' : 'none'
})
const buttonImageSrc = computed(() =>
  buttonImageState.value === 'ready' && buttonImage.value ? mediaSrc(buttonImage.value.url) : null
)
const addOnImageSrc = computed(() =>
  addOnImageState.value === 'ready' && addOnImage.value ? mediaSrc(addOnImage.value.url) : null
)
const IMAGE_ERROR_TITLE = 'โหลดรูปไม่ได้'
</script>

<template>
  <section
    class="flex flex-col gap-2 border-t border-default pt-2"
    :data-testid="testid"
    :data-state="state"
    :data-template-id="templateId"
  >
    <div class="flex items-baseline gap-2">
      <span class="text-sm font-semibold text-highlighted">ตัวอย่างโฆษณา</span>
      <span class="min-w-0 truncate text-xs text-muted" :title="template?.name" :data-testid="`${testid}-name`">
        {{ template?.name ?? '' }}
      </span>
    </div>

    <p
      v-if="!template"
      class="rounded-lg border border-dashed border-default px-3 py-4 text-xs text-muted"
      :data-testid="`${testid}-empty`"
    >
      เลือก ad template แล้วจะเห็นโพสต์ อินสแตนท์เพจ และ add-on ที่จะถูกสร้าง
    </p>

    <div v-else class="grid grid-cols-[80px_1fr] items-start gap-3">
      <!-- cover + kind tag; the same cache key as the row thumb (BUG-061) -->
      <div class="relative">
        <AdTemplatesPostCover
          :template-id="template.id"
          :checked-at="postInfoCheckedAt(postInfo)"
          :ok="hasPostCover(postInfo)"
          size="card"
          :testid="`${testid}-cover`"
        />
        <span
          v-if="kindLabel"
          class="absolute inset-x-0 bottom-0 truncate rounded-b bg-inverted/70 px-1 py-0.5 text-center text-[10px]
            text-inverted"
          :data-testid="`${testid}-kind`"
        >{{ kindLabel }}</span>
      </div>

      <dl class="grid min-w-0 grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1 text-xs">
        <dt class="text-muted">
          โพสต์
        </dt>
        <dd class="flex min-w-0 flex-wrap items-center gap-1">
          <span class="min-w-0 truncate text-highlighted" :title="ownerText" :data-testid="`${testid}-owner`">
            {{ ownerText }}
          </span>
          <AdTemplatesPostStatus :post-info="postInfo" :testid="`${testid}-status`" />
          <span v-if="untilLabel" class="text-dimmed" :data-testid="`${testid}-until`">{{ untilLabel }}</span>
        </dd>

        <dt class="text-muted">
          ข้อความ
        </dt>
        <dd class="flex min-w-0 flex-col gap-0.5" :data-testid="`${testid}-texts`">
          <template v-if="adTexts.length > 0">
            <span
              v-for="(text, i) in adTexts"
              :key="`${i}-${text}`"
              class="truncate text-highlighted"
              :title="text"
              :data-testid="`${testid}-text`"
            >“{{ text }}”</span>
          </template>
          <span v-else class="text-dimmed">ไม่ได้ตั้ง (TikTok เลือกเอง)</span>
        </dd>

        <dt class="text-muted">
          CTA
        </dt>
        <dd class="flex min-w-0 flex-wrap gap-1" :data-testid="`${testid}-cta`">
          <UBadge
            v-for="value in ctaValues"
            :key="value"
            color="neutral"
            variant="subtle"
            size="sm"
            class="max-w-full truncate"
            :data-testid="`${testid}-cta-item`"
            :data-value="value"
          >
            {{ ctaLabel(value) }}
          </UBadge>
          <span v-if="ctaValues.length === 0" class="text-dimmed">—</span>
        </dd>

        <dt class="text-muted">
          อินสแตนท์เพจ
        </dt>
        <dd class="flex min-w-0 flex-col gap-0.5" :data-testid="`${testid}-page`" :data-button="buttonMode">
          <span v-if="buttonMode === 'image'" class="flex items-center gap-1">
            <img
              v-if="buttonImageSrc"
              :src="buttonImageSrc"
              :alt="buttonImage?.name ?? ''"
              class="h-5 w-auto max-w-16 rounded-full border border-default object-contain"
              :data-testid="`${testid}-page-image`"
              :data-state="buttonImageState"
              @error="onImageError('button')"
            >
            <span
              v-else
              class="flex h-5 w-10 items-center justify-center rounded-full border border-dashed border-default"
              :data-testid="`${testid}-page-image-placeholder`"
              :data-state="buttonImageState"
              :title="buttonImageState === 'error' ? IMAGE_ERROR_TITLE : undefined"
            >
              <UIcon name="i-lucide-image" class="size-3 text-dimmed" />
            </span>
            <span class="text-dimmed">ปุ่มรูป</span>
          </span>
          <UBadge
            v-else-if="buttonMode === 'text'"
            color="primary"
            variant="subtle"
            size="sm"
            class="max-w-full self-start truncate"
            :data-testid="`${testid}-page-button`"
          >
            {{ buttonText }}
          </UBadge>
          <span v-else class="truncate text-highlighted" :title="pageText">{{ pageText }}</span>
          <span v-if="buttonMode !== 'library'" class="break-all text-dimmed">
            {{ pageHost }} · {{ toneLabel }} · {{ languageLabel }}
          </span>
        </dd>

        <dt class="text-muted">
          Add-on
        </dt>
        <dd
          class="flex min-w-0 items-start gap-2"
          :data-testid="`${testid}-addon`"
          :data-addon="addOn ? 'true' : 'false'"
        >
          <template v-if="addOn">
            <img
              v-if="addOnImageSrc"
              :src="addOnImageSrc"
              :alt="addOnImage?.name ?? ''"
              class="h-10 w-auto max-w-16 rounded border border-default object-contain"
              :data-testid="`${testid}-addon-image`"
              :data-state="addOnImageState"
              @error="onImageError('addon')"
            >
            <span
              v-else
              class="flex h-10 w-16 shrink-0 items-center justify-center rounded border border-dashed
                border-default"
              :data-testid="`${testid}-addon-image-placeholder`"
              :data-state="addOnImageState"
              :title="addOnImageState === 'error' ? IMAGE_ERROR_TITLE : undefined"
            >
              <UIcon name="i-lucide-image" class="size-4 text-dimmed" />
            </span>
            <span class="flex min-w-0 flex-col gap-0.5">
              <span class="truncate text-highlighted" :title="addOnText">{{ addOnText }}</span>
              <span v-if="addOnImage" class="truncate text-dimmed" :title="addOnImage.name">
                {{ addOnImage.name }} · {{ formatMediaDimensions(addOnImage.width, addOnImage.height) }}
              </span>
            </span>
          </template>
          <span v-else class="text-dimmed">ไม่มี</span>
        </dd>
      </dl>
    </div>
  </section>
</template>
