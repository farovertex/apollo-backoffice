<script setup lang="ts">
/**
 * FEAT-102 — step 2 "ติดตั้งบนเว็บ" (spec "UI behaviour → Panel" 2, AC-24; api-contract §3.6, §7.4 install ids).
 * `bpx-install` → exactly one `POST /bc-pixels/:id/install` (`retry: 0`) → 202 `{ pixel }` handed to the panel,
 * which polls while the apply job runs. Blocked texts (`bpx-install-blocked`): the site is gone / not published
 * (known from the view before the press), or the API's 409 `error` verbatim — `siteDraftPending` adds the link to
 * the site editor (`bpx-install-editor-link`), the mssg apply path's own conflicts (e.g. `jobInProgress`, a mssg
 * job of the account runs) come through the same way. When the site already carries another TikTok id it is
 * shown before the press (`bpx-install-overwrite`, last 4), since install overwrites it (A10).
 */
import type { PixelView, PixelViewResponse } from '#shared/types/bc-pixels'

const props = defineProps<{
  pixel: PixelView
}>()

const emit = defineEmits<{
  updated: [view: PixelView]
  /** the 409 said the view is stale (e.g. `alreadyInstalled`) — re-read it */
  reload: []
}>()

const api = useApi()
const toast = useToast()

const posting = ref(false)
const conflict = ref<{ reason: string | null, message: string } | null>(null)

// a fresh pixel or a new state of it clears an old refusal
watch(() => props.pixel.id, () => {
  conflict.value = null
})

const job = computed(() => props.pixel.jobs.install)
const jobOpen = computed(() => isPixelJobOpen(job.value))
const showJob = computed(() => {
  const j = job.value
  if (!j) return false
  return isPixelJobOpen(j) || isPixelJobFailed(j) || !props.pixel.installed
})

const otherTracking = computed(() => {
  const t = props.pixel.siteTrackingTiktok
  return t && t !== props.pixel.pixelCode ? t : null
})

/** blocked before any press, from the view itself */
const viewBlocked = computed<{ reason: string, message: string } | null>(() => {
  if (props.pixel.siteGone) return { reason: 'siteGone', message: BC_PIXEL_CONFLICT_TEXT.siteGone }
  if (props.pixel.siteStatus !== 'published') return { reason: 'siteUnpublished', message: BC_PIXEL_CONFLICT_TEXT.siteUnpublished }
  return null
})
const blocked = computed(() => conflict.value ?? viewBlocked.value)

const disabled = computed(() =>
  props.pixel.superseded || !!viewBlocked.value || jobOpen.value || posting.value
)

async function install() {
  if (posting.value) return
  posting.value = true
  conflict.value = null
  try {
    const res = await api<PixelViewResponse>(`/bc-pixels/${encodeURIComponent(props.pixel.id)}/install`, { method: 'POST', retry: 0 })
    toast.add({ title: BC_PIXEL_TOAST.installStarted, description: props.pixel.site.domain, color: 'info' })
    emit('updated', res.pixel)
  } catch (e) {
    const f = bcPixelFailure(e, 'ใส่โค้ด pixel ไม่สำเร็จ')
    conflict.value = { reason: f.reason, message: f.message }
    toast.add({ title: 'ใส่โค้ด pixel ไม่ได้', description: f.message, color: 'error' })
    if (f.status === 409 && (f.reason === 'alreadyInstalled' || f.reason === 'superseded' || f.reason === 'siteGone')) emit('reload')
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <div class="space-y-3">
    <p v-if="pixel.installed" class="flex flex-wrap items-center gap-1 text-muted">
      <UIcon name="i-lucide-check" class="size-4 text-success" />
      ใส่โค้ด pixel บนเว็บแล้ว
      <span class="font-mono">(…{{ bcPixelTail(pixel.pixelCode) }})</span>
    </p>

    <template v-else>
      <p class="text-muted">
        เขียนโค้ด pixel ลงในช่อง TikTok tracking id ของเว็บ แล้วบันทึกเว็บ (ใช้งานบันทึกเว็บของ mssg)
      </p>

      <p
        v-if="otherTracking"
        class="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs text-warning"
        data-testid="bpx-install-overwrite"
        :data-old="bcPixelTail(otherTracking)"
      >
        <UIcon name="i-lucide-replace" class="mt-0.5 size-3.5 shrink-0" />
        <span>เว็บนี้ตั้ง TikTok pixel อื่นไว้ (…{{ bcPixelTail(otherTracking) }}) — กดแล้วจะถูกแทนที่ด้วย pixel นี้</span>
      </p>

      <div
        v-if="blocked"
        class="flex flex-wrap items-start gap-x-2 gap-y-1 rounded-md bg-error/10 px-2 py-1.5 text-xs text-error"
        role="alert"
        data-testid="bpx-install-blocked"
        :data-reason="blocked.reason ?? ''"
      >
        <UIcon name="i-lucide-ban" class="mt-0.5 size-3.5 shrink-0" />
        <span class="min-w-0 flex-1 break-words">{{ blocked.message }}</span>
        <NuxtLink
          v-if="blocked.reason === 'siteDraftPending'"
          :to="`/mssg-pages/sites/${encodeURIComponent(pixel.site.id)}`"
          class="font-medium whitespace-nowrap underline"
          data-testid="bpx-install-editor-link"
        >
          เปิดตัวแก้ไขเว็บ
        </NuxtLink>
      </div>

      <UButton
        v-if="!jobOpen"
        :label="BC_PIXEL_TEXT.install"
        icon="i-lucide-code-xml"
        color="primary"
        size="sm"
        :loading="posting"
        :disabled="disabled"
        data-testid="bpx-install"
        @click="install"
      />
    </template>

    <BcPixelsJobCard
      v-if="job && showJob"
      kind="install"
      :job="job"
      :error-text="bcPixelInstallErrorText"
      :retryable="!pixel.superseded && !pixel.installed && !viewBlocked"
      :retrying="posting"
      @retry="install"
    />
  </div>
</template>
