<script setup lang="ts">
/**
 * FEAT-071 (AC-15) — the screenshot of the login job that just failed, inline in the Login modal's `error`
 * state (`ta-login-fail-shot`, `data-state` = loading · ready · error). The parent mounts it only when the
 * account's `failureScreenshot` is that very login job, so it fetches exactly once on mount:
 * `GET /backend/tiktok-accounts/:id/failure-screenshots/:jobId` (`url` or `base64` body, same branching as
 * `FailureScreenshotModal`). A 404 (expired) renders nothing — the error text above stays the whole story.
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import { isFailureScreenshotUrl } from '#shared/types/tiktok-accounts'
import type { FailureScreenshotImage } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  accountId: string
  jobId: string
}>()

const api = useApi()

type FailState = 'loading' | 'ready' | 'error' | 'none'
const state = ref<FailState>('loading')
const src = ref<string | null>(null)
const errorText = ref('โหลดภาพไม่ได้')
let session = 0

async function load() {
  const s = ++session
  state.value = 'loading'
  src.value = null
  try {
    const res = await api<FailureScreenshotImage>(
      `/tiktok-accounts/${encodeURIComponent(props.accountId)}/failure-screenshots/${encodeURIComponent(props.jobId)}`,
      { retry: 0 }
    )
    if (s !== session) return
    const next = isFailureScreenshotUrl(res) ? res.url : res.base64 ? `data:${res.mimeType};base64,${res.base64}` : null
    if (!next) throw new Error('empty')
    src.value = next
    state.value = 'ready'
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    if (err.statusCode === 404) {
      state.value = 'none'
    } else {
      errorText.value = err.data?.error ?? 'โหลดภาพไม่ได้'
      state.value = 'error'
    }
  }
}

function onImgError() {
  errorText.value = 'โหลดภาพไม่ได้'
  state.value = 'error'
}

onMounted(load)
onUnmounted(() => {
  session++
})
</script>

<template>
  <div
    v-if="state !== 'none'"
    data-testid="ta-login-fail-shot"
    :data-state="state"
    :data-job-id="jobId"
  >
    <USkeleton v-if="state === 'loading'" class="h-40 w-full" data-testid="ta-login-fail-shot-loading" />
    <img
      v-else-if="state === 'ready' && src"
      :src="src"
      alt="Screenshot at the moment the job failed"
      class="mx-auto block max-h-[45vh] max-w-full w-auto rounded-lg border border-default bg-elevated object-contain"
      data-testid="ta-login-fail-shot-img"
      @error="onImgError"
    >
    <div v-else class="flex flex-wrap items-center gap-2 text-xs text-muted" data-testid="ta-login-fail-shot-error">
      <UIcon name="i-lucide-image-off" class="size-4 shrink-0" />
      <span class="min-w-0 flex-1">{{ errorText }}</span>
      <UButton
        label="ลองใหม่"
        color="neutral"
        variant="subtle"
        size="xs"
        data-testid="ta-login-fail-shot-retry"
        @click="load"
      />
    </div>
  </div>
</template>
