<script setup lang="ts">
/**
 * FEAT-003 — Delete confirmation (delete part of function 3.2). Confirm → `DELETE /backend/tiktok-accounts/:id`
 * (204) → toast "Account deleted" + `deleted` (the page refreshes the list). API error → toast, modal stays open.
 * FEAT-081 (api-contract §1/§6) — the delete is a **soft delete that always cascades**, so the BUG-029 checkbox
 * ("Also delete the browser profile", `ta-delete-profile`) and the `?deleteProfile` query are gone: one confirm
 * always deletes the account row (kept for history, never listed again), cancels every pending job of the account
 * and deletes its browser profile in AdsPower. Two states in one modal:
 *  - **confirm** (`ta-delete-confirm`) → `DELETE /backend/tiktok-accounts/<id>` with **no query**;
 *  - **jobs-running warning** (`ta-delete-jobs-warning`) when that answers 409 `reason: 'jobsRunning'`: the jobs
 *    the delete would cancel are listed and "Cancel jobs and delete" (`ta-delete-force`) repeats the request with
 *    `?force=1`. Reset to the confirm state on every open.
 * Any other 409 / 4xx / 5xx → error toast with the API's text, modal stays open, no force request.
 * The 204 only means "the delete job is queued": the **page** follows the profile deletion (`GET
 * /backend/browser-profiles/:id` every 2 s) and toasts its real outcome.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { DeleteAccountConflict, PendingAccountJob, TikTokAccount } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  account: TikTokAccount | null
}>()

const emit = defineEmits<{
  deleted: [account: TikTokAccount]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-delete-modal`).
const modalContent = { 'data-testid': 'ta-delete-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()
const deleting = ref(false)
/** FEAT-081 — `null` = confirm state; an array = the jobs-running warning state (the 409's `jobs`) */
const pendingJobs = ref<PendingAccountJob[] | null>(null)
// one unconfirmed warning must never leak into the next delete
watch(open, (isOpen) => {
  if (isOpen) pendingJobs.value = null
})

const accountLabel = computed(() => props.account?.label ?? props.account?.loginEmail ?? '')
const profileName = computed(() => props.account?.browserProfile?.name ?? null)
const description = computed(() =>
  `The browser profile ${profileName.value ?? 'of this account'} is deleted from AdsPower as well and its jobs are cancelled. This cannot be undone.`
)

/** `<type> · <status> · <step ?? '–'> · <id last 6>` — enough to recognise a job without a jobs page */
function jobText(job: PendingAccountJob): string {
  return `${job.type} · ${job.status} · ${job.step ?? '–'} · ${job.id.slice(-6)}`
}

/**
 * One `DELETE` per click, `retry: 0` (a destructive call is never re-issued by ofetch). `force` only adds the
 * query — the request is otherwise identical, and a 409 `jobsRunning` on the **forced** call (the API should not
 * answer one) is treated as a plain error instead of re-opening the warning, so the modal can never loop.
 */
async function run(force: boolean) {
  const account = props.account
  if (!account || deleting.value) return
  deleting.value = true
  try {
    await api(`/tiktok-accounts/${encodeURIComponent(account.id)}`, {
      method: 'DELETE',
      retry: 0,
      ...(force ? { query: { force: '1' } } : {})
    })
    open.value = false
    toast.add({
      title: 'Account deleted',
      description: profileName.value
        ? `${accountLabel.value} · profile ${profileName.value} is being deleted`
        : accountLabel.value,
      color: 'success'
    })
    emit('deleted', account)
  } catch (e) {
    const err = e as FetchError<Partial<DeleteAccountConflict>>
    const status = err.response?.status ?? err.statusCode
    if (!force && status === 409 && err.data?.reason === 'jobsRunning') {
      pendingJobs.value = err.data.jobs ?? []
      return
    }
    toast.add({
      title: 'Could not delete the account',
      description: err.data?.error ?? err.message ?? 'Unexpected error',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="`Delete account ${accountLabel}?`"
    :description="pendingJobs ? undefined : description"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div
        v-if="pendingJobs"
        data-testid="ta-delete-jobs-warning"
        class="mb-4 flex flex-col gap-2"
      >
        <p class="text-sm text-warning">
          This account still has {{ pendingJobs.length }} job(s) waiting or running. Deleting it cancels all of them:
        </p>
        <ul class="max-h-40 overflow-y-auto rounded-md border border-default divide-y divide-default">
          <li
            v-for="job in pendingJobs"
            :key="job.id"
            data-testid="ta-delete-job"
            class="px-2 py-1.5 font-mono text-xs break-all text-muted"
          >
            {{ jobText(job) }}
          </li>
        </ul>
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          :label="pendingJobs ? 'Keep account' : 'Cancel'"
          color="neutral"
          variant="subtle"
          :disabled="deleting"
          data-testid="ta-delete-cancel"
          @click="open = false"
        />
        <UButton
          v-if="pendingJobs"
          label="Cancel jobs and delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="solid"
          :loading="deleting"
          data-testid="ta-delete-force"
          @click="run(true)"
        />
        <UButton
          v-else
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="solid"
          :loading="deleting"
          data-testid="ta-delete-confirm"
          @click="run(false)"
        />
      </div>
    </template>
  </UModal>
</template>
