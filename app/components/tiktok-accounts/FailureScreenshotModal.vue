<script setup lang="ts">
/**
 * FEAT-071 (api-contract §4/§5) — the screenshot a failed login / sync / top-up job left for one account.
 *
 * Opened from the Session status cell (`ta-fail-shot`) with the account row, whose `failureScreenshot` is the
 * newest entry. On open, exactly:
 *   `GET /backend/tiktok-accounts/:id/failure-screenshots`          once  → the history list (≥ 2 entries to render it)
 *   `GET /backend/tiktok-accounts/:id/failure-screenshots/:jobId`   once per entry per open (selection swap)
 * A `url` body (presigned, 15 min) is reused until `expiresAt − 60 s`; a `base64` body never refetches. Nothing polls.
 * `data-state` on the dialog (`ta-fail-shot-modal`): loading · ready · error · expired (image 404, retention 30 d).
 * A failing list request is silent: the summary entry's image is still shown, just no list.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import {
  FAILURE_SCREENSHOT_TYPE_LABEL,
  isFailureScreenshotUrl
} from '#shared/types/tiktok-accounts'
import type {
  FailureScreenshotImage,
  FailureScreenshotView,
  FailureScreenshotsResponse,
  TikTokAccount
} from '#shared/types/tiktok-accounts'

const props = defineProps<{
  /** null while the modal is closed */
  account: TikTokAccount | null
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()

type ShotState = 'loading' | 'ready' | 'error' | 'expired'

interface CachedImage {
  src: string
  /** `null` for a data URI (never expires); epoch ms for a presigned URL */
  expiresAt: number | null
}

/** a `url` body is treated as stale this long before its real `expiresAt` */
const STALE_MARGIN_MS = 60_000
const ERR_FALLBACK = 'โหลดภาพไม่ได้'

const entries = ref<FailureScreenshotView[]>([])
const selectedId = ref<string | null>(null)
const images = reactive(new Map<string, CachedImage>())
const states = reactive(new Map<string, ShotState>())
const errors = reactive(new Map<string, string>())
// bumped on every open/close so a late response of a previous open is dropped
let session = 0

const accountName = computed(() => props.account?.label || props.account?.loginEmail || '')
const selected = computed<FailureScreenshotView | null>(
  () => entries.value.find(e => e.jobId === selectedId.value) ?? null
)
const state = computed<ShotState>(() => (selectedId.value ? (states.get(selectedId.value) ?? 'loading') : 'loading'))
const src = computed(() => (selectedId.value ? (images.get(selectedId.value)?.src ?? null) : null))
const errorText = computed(() => (selectedId.value ? (errors.get(selectedId.value) ?? ERR_FALLBACK) : ERR_FALLBACK))
const showList = computed(() => entries.value.length > 1)

const modalContent = computed(() => ({
  'data-testid': 'ta-fail-shot-modal',
  'data-state': state.value
}) as ModalProps['content'])

function isFresh(img: CachedImage): boolean {
  return img.expiresAt === null || img.expiresAt - STALE_MARGIN_MS > Date.now()
}

async function loadImage(jobId: string, force: boolean) {
  const accountId = props.account?.id
  if (!accountId) return
  const cached = images.get(jobId)
  if (!force && cached && isFresh(cached)) {
    states.set(jobId, 'ready')
    return
  }
  const s = session
  states.set(jobId, 'loading')
  images.delete(jobId)
  try {
    // retry: 0 — exactly one request per entry per open (per click on retry)
    const res = await api<FailureScreenshotImage>(
      `/tiktok-accounts/${encodeURIComponent(accountId)}/failure-screenshots/${encodeURIComponent(jobId)}`,
      { retry: 0 }
    )
    if (s !== session) return
    if (isFailureScreenshotUrl(res)) {
      images.set(jobId, { src: res.url, expiresAt: new Date(res.expiresAt).getTime() })
    } else if (res.base64) {
      images.set(jobId, { src: `data:${res.mimeType};base64,${res.base64}`, expiresAt: null })
    } else {
      throw new Error(ERR_FALLBACK)
    }
    states.set(jobId, 'ready')
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    if (err.statusCode === 404) {
      states.set(jobId, 'expired')
    } else {
      errors.set(jobId, err.data?.error ?? ERR_FALLBACK)
      states.set(jobId, 'error')
    }
  }
}

async function loadList() {
  const accountId = props.account?.id
  if (!accountId) return
  const s = session
  try {
    const res = await api<FailureScreenshotsResponse>(
      `/tiktok-accounts/${encodeURIComponent(accountId)}/failure-screenshots`,
      { retry: 0 }
    )
    if (s !== session) return
    // keep the summary entry when the list does not contain it (never leave the header without an entry)
    const list = res.screenshots ?? []
    if (list.length && selectedId.value && !list.some(e => e.jobId === selectedId.value) && selected.value) {
      entries.value = [selected.value, ...list]
    } else if (list.length) {
      entries.value = list
    }
  } catch {
    // the summary entry's image stays; no list
  }
}

function select(jobId: string) {
  if (jobId === selectedId.value) return
  selectedId.value = jobId
  void loadImage(jobId, false)
}

function retry() {
  if (selectedId.value) void loadImage(selectedId.value, true)
}

function onImgError() {
  const id = selectedId.value
  if (!id) return
  errors.set(id, ERR_FALLBACK)
  states.set(id, 'error')
}

function reset() {
  session++
  entries.value = []
  selectedId.value = null
  images.clear()
  states.clear()
  errors.clear()
}

watch(open, (isOpen) => {
  reset()
  if (!isOpen) return
  const first = props.account?.failureScreenshot
  if (!first) return
  entries.value = [first]
  selectedId.value = first.jobId
  void loadImage(first.jobId, false)
  void loadList()
})

onUnmounted(() => {
  session++
})
</script>

<template>
  <UModal
    v-model:open="open"
    title="ภาพหน้าจอตอน job ล้ม"
    :description="accountName || undefined"
    :ui="{ content: 'max-w-3xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="min-w-0 space-y-4">
        <div
          v-if="selected"
          class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
          data-testid="ta-fail-shot-header"
        >
          <UBadge color="neutral" variant="subtle" data-testid="ta-fail-shot-type">
            {{ FAILURE_SCREENSHOT_TYPE_LABEL[selected.jobType] ?? selected.jobType }}
          </UBadge>
          <span class="break-all font-medium text-highlighted" data-testid="ta-fail-shot-error">{{ selected.error }}</span>
          <span v-if="selected.stage" class="text-xs text-muted" data-testid="ta-fail-shot-stage">{{ selected.stage }}</span>
          <span class="text-xs text-muted" data-testid="ta-fail-shot-at">{{ formatDateTime(selected.at) }}</span>
        </div>

        <USkeleton v-if="state === 'loading'" class="h-64 w-full" data-testid="ta-fail-shot-loading" />
        <img
          v-else-if="state === 'ready' && src"
          :key="selectedId ?? ''"
          :src="src"
          alt="Screenshot at the moment the job failed"
          class="mx-auto block max-h-[70vh] max-w-full w-auto rounded-lg border border-default bg-elevated object-contain"
          data-testid="ta-fail-shot-img"
          @error="onImgError"
        >
        <UAlert
          v-else-if="state === 'expired'"
          color="neutral"
          variant="subtle"
          icon="i-lucide-image-off"
          title="ภาพหมดอายุแล้ว (เก็บไว้ 30 วัน)"
          data-testid="ta-fail-shot-expired"
        />
        <div
          v-else
          class="flex flex-wrap items-center gap-3 rounded-lg bg-error/10 p-3 text-error"
          role="alert"
          data-testid="ta-fail-shot-error-box"
        >
          <UIcon name="i-lucide-triangle-alert" class="size-5 shrink-0" />
          <p class="min-w-0 flex-1 text-sm" data-testid="ta-fail-shot-error-text">
            {{ errorText }}
          </p>
          <UButton
            label="ลองใหม่"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="subtle"
            size="xs"
            data-testid="ta-fail-shot-retry"
            @click="retry"
          />
        </div>

        <ul v-if="showList" class="space-y-1" data-testid="ta-fail-shot-list">
          <li v-for="e in entries" :key="e.jobId">
            <button
              type="button"
              class="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border px-2 py-1.5 text-left text-xs transition-colors"
              :class="e.jobId === selectedId ? 'border-primary bg-primary/10' : 'border-default hover:bg-elevated'"
              :aria-current="e.jobId === selectedId ? 'true' : undefined"
              data-testid="ta-fail-shot-item"
              :data-job-id="e.jobId"
              :data-selected="e.jobId === selectedId ? 'true' : 'false'"
              @click="select(e.jobId)"
            >
              <span class="font-medium text-highlighted">{{ FAILURE_SCREENSHOT_TYPE_LABEL[e.jobType] ?? e.jobType }}</span>
              <span class="min-w-0 break-all text-default">{{ e.error }}</span>
              <span v-if="e.stage" class="text-muted">{{ e.stage }}</span>
              <span class="text-muted sm:ml-auto">{{ formatDateTime(e.at) }}</span>
            </button>
          </li>
        </ul>

        <div class="flex justify-end">
          <UButton
            label="ปิด"
            color="neutral"
            variant="subtle"
            data-testid="ta-fail-shot-close"
            @click="open = false"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
