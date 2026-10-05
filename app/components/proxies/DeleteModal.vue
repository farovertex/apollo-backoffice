<script setup lang="ts">
/**
 * FEAT-006 — Delete proxy (function 2.9; api-contract.md v1 `DELETE /proxies/:id`).
 * The confirmation names what the delete will clear, straight from the row's `usage` counts. Confirm →
 * `DELETE /backend/proxies/:id` → 200 `{ ok, defaultsCleared, profilesCleared }` → toast with those counts and
 * `deleted` (the page re-requests the list). API error → toast, the modal stays open.
 *
 * FEAT-027 §7 — when `proxy.boundProfile` is set the confirm button is disabled and a line names the profile
 * (`px-delete-bound`): the API would answer 409 anyway, but the UI never lets the click happen. A free proxy is
 * unchanged. The 409 branch below stays as a defensive toast for the race where the bind happens after the modal
 * opened but before the (otherwise disabled) click — it cannot be reached through the UI alone.
 */
import type { ModalProps } from '@nuxt/ui'
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type { DeleteProxyResponse, Proxy, ProxyBoundConflictBody } from '#shared/types/proxies'

const props = defineProps<{
  proxy: Proxy | null
}>()

const emit = defineEmits<{
  deleted: [result: DeleteProxyResponse]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `px-delete-modal`).
const modalContent = { 'data-testid': 'px-delete-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()
const deleting = ref(false)

const isBound = computed(() => props.proxy?.boundProfile != null)

const usageLine = computed(() => {
  const usage = props.proxy?.usage
  if (!usage || (usage.defaults === 0 && usage.profiles === 0)) return 'Not used anywhere'
  return `Used as default by ${usage.defaults} admin(s) · set on ${usage.profiles} profile(s) — they will be set to no proxy`
})

async function confirm() {
  const proxy = props.proxy
  if (!proxy || deleting.value || isBound.value) return
  deleting.value = true
  try {
    // retry: 0 — exactly one DELETE per click
    const res = await api<DeleteProxyResponse>(`/proxies/${encodeURIComponent(proxy.id)}`, { method: 'DELETE', retry: 0 })
    open.value = false
    toast.add({
      title: `Proxy deleted · ${res.defaultsCleared} default(s), ${res.profilesCleared} profile(s) cleared`,
      description: proxy.label,
      color: 'success'
    })
    emit('deleted', res)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody> & Partial<ProxyBoundConflictBody>>
    toast.add({
      title: 'Could not delete the proxy',
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
    :title="`Delete proxy ${proxy?.label ?? ''}?`"
    :dismissible="!deleting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #description>
      <span data-testid="px-delete-usage">{{ usageLine }}</span>
    </template>

    <template #body>
      <UAlert
        v-if="isBound"
        color="warning"
        variant="subtle"
        icon="i-lucide-lock"
        :title="`Profile ${proxy?.boundProfile?.name ?? '(unknown)'} is using this proxy — delete that profile first`"
        class="mb-3"
        data-testid="px-delete-bound"
      />

      <div class="flex flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="deleting"
          data-testid="px-delete-cancel"
          @click="open = false"
        />
        <UButton
          label="Delete"
          icon="i-lucide-trash-2"
          color="error"
          variant="solid"
          :loading="deleting"
          :disabled="isBound"
          data-testid="px-delete-confirm"
          @click="confirm"
        />
      </div>
    </template>
  </UModal>
</template>
