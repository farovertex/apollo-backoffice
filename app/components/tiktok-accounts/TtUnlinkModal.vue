<script setup lang="ts">
/**
 * FEAT-098 (spec "UI behaviour" 2–5) — unlink one TikTok account from one Business Center org. Four views in one
 * modal: confirm → running → success or failure.
 *
 * This modal only makes the POST (one per click, `retry: 0`). The page owns the poll of `…/unlink/latest`, because
 * the job goes on after this closes, and hands the state back in as `follow`. So closing here cancels nothing, and
 * the footer says "ปิด", never "ยกเลิก", which would read like the action itself.
 *
 * A 404/409 stays in here, inline and as a toast. On `duplicate` the job already exists: the page starts following
 * it, so the row shows it as pending, and this stays on the confirm view with the API's sentence.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type {
  BcOrganization,
  BcTikTokAccount,
  BcTtUnlinkAccepted,
  BcTtUnlinkConflictBody,
  BcTtUnlinkFollow,
  TikTokAccount
} from '#shared/types/tiktok-accounts'

const props = defineProps<{
  account: TikTokAccount | null
  org: BcOrganization | null
  tt: BcTikTokAccount | null
  /** the page's state of this account + org + asset; `null` = nothing ordered since the button was pressed */
  follow: BcTtUnlinkFollow | null
}>()

const emit = defineEmits<{
  /** 202: the page starts following the job */
  requested: [job: BcTtUnlinkAccepted]
  /** 409 `duplicate`: the same, for the job that was already open */
  duplicate: [jobId: string]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so the test id goes on the rendered DialogContent (same as `ta-delete-modal`)
const modalContent = { 'data-testid': 'ta-tt-unlink-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const requesting = ref(false)
/** did this open order a job? Until then the view stays on confirm, whatever `follow` says (see `duplicate`) */
const ordered = ref(false)
const actionError = ref<string | null>(null)

watch(open, (isOpen) => {
  if (!isOpen) return
  ordered.value = false
  requesting.value = false
  actionError.value = null
})

const job = computed(() => props.follow?.job ?? null)

const view = computed<'confirm' | 'running' | 'success' | 'failed'>(() => {
  if (!ordered.value) return 'confirm'
  if (props.follow?.error) return 'failed'
  if (!job.value || bcTtUnlinkIsOpen(job.value)) return 'running'
  return bcTtUnlinkSucceeded(job.value) ? 'success' : 'failed'
})

const orgLabel = computed(() => {
  const org = props.org
  return org ? `${org.name || REPORT_DASH} (…${org.orgId.slice(-4)})` : REPORT_DASH
})
const ttName = computed(() => (props.tt ? bcTtAccountName(props.tt) : REPORT_DASH))
const description = computed(() => {
  if (view.value === 'confirm') return 'ระบบจะเปิด Business Center แล้วกดยกเลิกการเชื่อมโยงบนหน้าจริงให้'
  const handle = props.tt?.username ? ` (@${props.tt.username})` : ''
  return `${ttName.value}${handle} ภายใต้ ${orgLabel.value}`
})
const queueText = computed(() => (job.value?.queuePosition == null ? null : jobQueueText(job.value)))
const failureTitle = computed(() => bcTtUnlinkFailureTitle(job.value))
const failureText = computed(() => {
  if (props.follow?.error) return props.follow.error
  return job.value ? bcTtUnlinkFailureText(job.value) : 'ไม่ทราบสาเหตุ'
})

/** One POST per click, for both the confirm and the retry. `retry: 0`: ofetch must not order a second job on a 5xx. */
async function onSubmit() {
  const account = props.account
  const org = props.org
  const tt = props.tt
  if (!account || !org || !tt || requesting.value) return
  requesting.value = true
  actionError.value = null
  try {
    const res = await api<BcTtUnlinkAccepted>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/organizations/${encodeURIComponent(org.orgId)}/tiktok-accounts/${encodeURIComponent(tt.assetId)}/unlink`,
      { method: 'POST', retry: 0 }
    )
    ordered.value = true
    emit('requested', res)
  } catch (e) {
    const err = e as FetchError<Partial<BcTtUnlinkConflictBody>>
    const reason = err.data?.reason
    const text = err.data?.error ?? (reason ? BC_TT_UNLINK_REASON_TEXT[reason] : null) ?? err.message ?? 'Unexpected error'
    actionError.value = text
    toast.add({ title: 'ยกเลิกการเชื่อมโยงไม่ได้', description: text, color: 'error' })
    if (reason === 'duplicate' && err.data?.jobId) emit('duplicate', err.data.jobId)
  } finally {
    requesting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="ยกเลิกการเชื่อมโยงบัญชี TikTok"
    :description="description"
    :dismissible="!requesting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4 text-sm">
        <template v-if="view === 'confirm'">
          <p class="text-muted">
            ภายใต้:
            <span
              class="font-medium break-words text-highlighted"
              data-testid="ta-tt-unlink-org"
              :data-org-id="org?.orgId ?? ''"
            >{{ orgLabel }}</span>
          </p>
          <div
            class="flex items-center gap-2 rounded-md border border-default px-3 py-2"
            data-testid="ta-tt-unlink-account"
            :data-asset-id="tt?.assetId ?? ''"
          >
            <UAvatar
              :src="tt?.avatar ?? undefined"
              :alt="ttName"
              size="sm"
              class="shrink-0"
            />
            <span class="flex min-w-0 flex-col">
              <span class="font-medium break-words text-highlighted">{{ ttName }}</span>
              <span v-if="tt" class="text-xs break-words text-muted">{{ bcTtAccountHandle(tt) }}</span>
            </span>
          </div>
          <UAlert
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            title="โฆษณาที่กำลังทำงานและใช้บัญชีนี้อยู่จะถูกหยุดทั้งหมด"
            description="บัญชีอาจเข้า Business Suite ไม่ได้ และถ้าจะเชื่อมกลับ เจ้าของบัญชีต้องสแกน QR อีกครั้ง"
            data-testid="ta-tt-unlink-warning"
          />
        </template>

        <div
          v-else-if="view === 'running'"
          class="flex flex-col items-center gap-2 py-6 text-center"
          data-testid="ta-tt-unlink-running"
        >
          <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin text-primary" />
          <p class="text-highlighted">
            กำลังยกเลิกการเชื่อมโยงบน Business Center…
          </p>
          <p
            v-if="job?.lastLog"
            class="max-w-sm text-xs break-words text-muted"
            data-testid="ta-tt-unlink-log"
          >
            {{ job.lastLog }}
          </p>
          <p
            v-if="queueText"
            class="text-xs text-muted"
            data-testid="ta-tt-unlink-queue"
          >
            {{ queueText }}
          </p>
          <p class="text-xs text-dimmed">
            ปิดหน้านี้ได้ งานจะทำต่อ
          </p>
        </div>

        <div
          v-else-if="view === 'success'"
          class="flex flex-col items-center gap-2 py-6 text-center"
          data-testid="ta-tt-unlink-success"
        >
          <UIcon name="i-lucide-circle-check" class="size-8 text-success" />
          <p class="font-medium text-highlighted">
            ยกเลิกการเชื่อมโยงแล้ว
          </p>
          <p class="text-xs text-muted">
            ตรวจกับ Business Center แล้ว ไม่พบบัญชีนี้ใน org นี้อีก
          </p>
        </div>

        <template v-else>
          <UAlert
            color="error"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            :title="failureTitle"
            :description="failureText"
            role="alert"
            data-testid="ta-tt-unlink-failed"
            :data-error="job?.error ?? ''"
          />
          <p
            v-if="job?.error === 'notProven'"
            class="text-xs text-muted"
            data-testid="ta-tt-unlink-not-proven"
          >
            {{ BC_TT_UNLINK_NOT_PROVEN_HINT }}
          </p>
        </template>

        <UAlert
          v-if="actionError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="actionError"
          role="alert"
          data-testid="ta-tt-unlink-error"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton
          label="ปิด"
          color="neutral"
          variant="subtle"
          :disabled="requesting"
          data-testid="ta-tt-unlink-close"
          @click="open = false"
        />
        <UButton
          v-if="view === 'confirm'"
          label="ยืนยันยกเลิกการเชื่อมโยง"
          icon="i-lucide-unlink"
          color="error"
          :loading="requesting"
          :disabled="!!follow && !follow.error && (!job || bcTtUnlinkIsOpen(job))"
          data-testid="ta-tt-unlink-confirm"
          @click="onSubmit"
        />
        <UButton
          v-if="view === 'failed'"
          label="ลองใหม่"
          icon="i-lucide-refresh-cw"
          color="error"
          :loading="requesting"
          data-testid="ta-tt-unlink-retry"
          @click="onSubmit"
        />
      </div>
    </template>
  </UModal>
</template>
