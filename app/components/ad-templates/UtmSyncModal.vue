<script setup lang="ts">
/**
 * FEAT-045 — "Sync UTM to existing orders" (function 6.9; api-contract.md v1 §1 + §3.2).
 *
 * The UTM of an ad template is a **snapshot**: `campaignOrders.adConfig.utm`, `builds.utm` and `ads.utm` are
 * written once, when the order / build / ad is created, and nothing updates them later. Changing the UTM in the
 * template therefore leaves every older campaign of that template reporting under the old key. This modal
 * pushes the template's current UTM into those rows.
 *
 * Two requests on the **same** route, so the preview can never disagree with the write (spec AS-8):
 * - on every open: `POST /backend/ad-templates/:id/utm/sync { dryRun: true }` → counts only, no write, no audit;
 * - on confirm: `POST …/utm/sync {}` → the three `updateMany` → close + success toast + `synced` (the page
 *   re-reads the list once).
 *
 * `prompted` is `true` when the page opened this modal by itself right after a save that changed the UTM key
 * (§3.4): the extra first line explains why it appeared, and `data-prompted` tells QA which path opened it.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { AdTemplate, UtmSyncBody, UtmSyncResponse } from '#shared/types/ad-templates'

const props = defineProps<{
  template: AdTemplate | null
  /** opened by the page's after-save prompt (§3.4) instead of the row button */
  prompted?: boolean
}>()

const emit = defineEmits<{
  /** the row was (or may have been) touched → the page re-reads the current page once; `null` = 409/404 */
  synced: [result: UtmSyncResponse | null]
}>()

const open = defineModel<boolean>('open', { default: false })
/** the page disables that row's Sync button while the real run is in flight (§3.1) */
const posting = defineModel<boolean>('posting', { default: false })

const api = useApi()
const toast = useToast()

/** the dry run is in flight */
const loading = ref(false)
const preview = ref<UtmSyncResponse | null>(null)
/** inline message of a failed preview or of a failed confirm that keeps the modal open */
const errorText = ref<string | null>(null)
/** the preview itself failed → there is no plan to confirm */
const previewFailed = ref(false)

// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `adt-utm-sync-modal`).
const modalContent = computed(() => ({
  'data-testid': 'adt-utm-sync-modal',
  'data-prompted': props.prompted ? 'true' : 'false'
}) as ModalProps['content'])

const utm = computed(() => props.template?.config?.utm ?? null)

/** `<name> · <prefix> · <source> / <medium> / <campaign>` of the row the modal was opened for (§3.2) */
const description = computed(() => {
  const template = props.template
  if (!template) return ''
  const ref = utm.value
  if (!ref) return template.name
  return `${template.name} · ${ref.prefix} · ${ref.source} / ${ref.medium} / ${ref.campaign}`
})

const unlinked = computed(() => preview.value?.ads.unlinked ?? 0)
/** every collection already carries this UTM → nothing to confirm */
const nothingToDo = computed(() => {
  const plan = preview.value
  if (!plan) return false
  return plan.orders.updated + plan.builds.updated + plan.ads.updated === 0
})
const confirmDisabled = computed(() =>
  loading.value || previewFailed.value || !preview.value || nothingToDo.value
)

function syncPath(id: string): string {
  return `/ad-templates/${encodeURIComponent(id)}/utm/sync`
}

function reset() {
  preview.value = null
  errorText.value = null
  previewFailed.value = false
  loading.value = false
  posting.value = false
}

/** one dry run per open — re-opening re-counts (§3.2) */
async function countRows() {
  const template = props.template
  reset()
  if (!template) return
  loading.value = true
  try {
    // retry: 0 — exactly one POST per open
    preview.value = await api<UtmSyncResponse>(syncPath(template.id), {
      method: 'POST',
      body: { dryRun: true } satisfies UtmSyncBody,
      retry: 0
    })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    // 409 (template unbound) / 404 (gone) / 5xx — the API text is shown verbatim, confirm stays disabled
    errorText.value = err.data?.error ?? err.message ?? 'Unexpected error'
    previewFailed.value = true
  } finally {
    loading.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) void countRows()
  else reset()
})

async function confirm() {
  const template = props.template
  if (!template || posting.value || confirmDisabled.value) return
  posting.value = true
  errorText.value = null
  try {
    // retry: 0 — exactly one write POST per click; `{}` resolves to `dryRun: false` on the API
    const res = await api<UtmSyncResponse>(syncPath(template.id), { method: 'POST', body: {}, retry: 0 })
    open.value = false
    const tail = res.ads.unlinked > 0 ? ` · ${res.ads.unlinked} ads not linked yet` : ''
    toast.add({
      title: 'UTM synced',
      description: `${template.name} · orders ${res.orders.updated} · builds ${res.builds.updated} · ads ${res.ads.updated}${tail}`,
      icon: 'i-lucide-refresh-cw',
      color: 'success'
    })
    emit('synced', res)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    const message = err.data?.error ?? err.message ?? 'Unexpected error'
    if (status === 409 || status === 404) {
      // the template lost its UTM or is gone — retrying cannot help; one read shows the current row
      open.value = false
      toast.add({
        title: 'Could not sync',
        description: message,
        icon: 'i-lucide-triangle-alert',
        color: status === 409 ? 'warning' : 'error'
      })
      emit('synced', null)
      return
    }
    // 5xx / network — the plan is still valid, stay open so the user can retry
    errorText.value = message
    toast.add({
      title: 'Could not sync',
      description: message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    posting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Sync UTM to existing orders?"
    :description="description"
    :dismissible="!posting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3 text-sm">
        <p v-if="prompted" class="text-toned" data-testid="adt-utm-sync-prompt">
          The UTM of this template just changed. Orders created before still carry the old UTM.
        </p>

        <p class="text-muted">
          Every order already created from this template, its builds and the ads linked to them get this UTM.
          Reports → UTM then counts them under it. This does not change anything on TikTok.
        </p>

        <p v-if="loading" class="text-muted" data-testid="adt-utm-sync-loading">
          Counting…
        </p>

        <div
          v-else-if="preview"
          class="flex flex-col gap-1 rounded-md bg-elevated/50 px-3 py-2 text-highlighted"
          :data-orders="preview.orders.updated"
          :data-builds="preview.builds.updated"
          :data-ads="preview.ads.updated"
          :data-unlinked="preview.ads.unlinked"
          data-testid="adt-utm-sync-preview"
        >
          <span>Orders {{ preview.orders.updated }} of {{ preview.orders.total }}</span>
          <span>Builds {{ preview.builds.updated }} of {{ preview.builds.total }}</span>
          <span>Ads {{ preview.ads.updated }} of {{ preview.ads.total }}</span>
        </div>

        <p v-if="unlinked > 0" class="text-warning" data-testid="adt-utm-sync-unlinked">
          {{ unlinked }} ads of these campaigns are not linked yet — run Sync again after the next KPI round
        </p>

        <p v-if="nothingToDo" class="text-muted" data-testid="adt-utm-sync-nothing">
          Everything already carries this UTM
        </p>

        <div
          v-if="errorText"
          class="flex items-start gap-2 rounded-md bg-error/10 px-3 py-2 text-error"
          data-testid="adt-utm-sync-error"
        >
          <UIcon name="i-lucide-triangle-alert" class="mt-0.5 size-4 shrink-0" />
          <span>{{ errorText }}</span>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="subtle"
            :disabled="posting"
            data-testid="adt-utm-sync-cancel"
            @click="open = false"
          />
          <UButton
            label="Sync now"
            icon="i-lucide-refresh-cw"
            color="primary"
            variant="solid"
            :loading="posting"
            :disabled="confirmDisabled"
            data-testid="adt-utm-sync-confirm"
            @click="confirm"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
