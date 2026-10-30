<script setup lang="ts">
/**
 * FEAT-088 (spec "UI behaviour", api-contract.md v1 §2/§7) — GOD-only editor for a provider node's `lightSlots`
 * override, opened from the `bp-node-light-slots-edit` pencil of the `/browser-profiles` provider-nodes block.
 * "ใช้ค่าจาก env" on → the number input is disabled and the request sends `{ lightSlots: null }`; off → the
 * integer (0..64) is sent as-is. Submit is **one** `PATCH /backend/provider-nodes/:id` with exactly
 * `{ lightSlots }` (contract §7 — never `humanOpensAllowed` / `maxOpenProfiles` from here). 200 → toast
 * "บันทึกแล้ว", close, emit `saved` so the page re-reads the block (`loadNodes()`); 400 → `issues[0].message`
 * inline (`bp-node-light-slots-error`), modal stays open; 403 → toast "สิทธิ์ไม่พอ", modal stays open (a non-GOD
 * should never reach this component — the page only renders the pencil for a GOD — but the API is the
 * authority); other errors → a toast in the same shape as the rest of the page (title + `error`/message).
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ProviderNodeView, UpdateProviderNodeBody, UpdateProviderNodeErrorBody, UpdateProviderNodeResponse } from '#shared/types/provider-nodes'

const LIGHT_SLOTS_MIN = 0
const LIGHT_SLOTS_MAX = 64

const props = defineProps<{
  /** the node the pencil was clicked on; null while the modal was never opened */
  node: ProviderNodeView | null
}>()

const emit = defineEmits<{
  /** 200 — the page re-reads the block (`loadNodes()`) */
  saved: []
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless → the testid goes on the rendered DialogContent (same trick as ProxyModal.vue)
const modalContent = { 'data-testid': 'bp-node-light-slots-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const useEnv = ref(true)
const value = ref<number | null>(0)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

/** reset to the node's current override every time the modal opens (possibly on a different node) */
watch(open, (isOpen) => {
  if (!isOpen) return
  errorMessage.value = null
  saving.value = false
  const n = props.node
  useEnv.value = (n?.lightSlots ?? null) === null
  value.value = n?.lightSlots ?? n?.effectiveLightSlots ?? 0
})

const description = computed(() => {
  const n = props.node
  if (!n) return ''
  return `${n.name} · มีผลตอนนี้ ${n.effectiveLightSlots}`
})

const invalidValue = computed(() => {
  if (useEnv.value) return false
  return value.value == null || !Number.isInteger(value.value) || value.value < LIGHT_SLOTS_MIN || value.value > LIGHT_SLOTS_MAX
})

const unchanged = computed(() => {
  const n = props.node
  if (!n) return false
  if (useEnv.value) return n.lightSlots === null
  return n.lightSlots === value.value
})

const saveDisabled = computed(() => invalidValue.value || unchanged.value)

async function save() {
  const n = props.node
  if (!n || saving.value || saveDisabled.value) return
  saving.value = true
  errorMessage.value = null
  const body: UpdateProviderNodeBody = { lightSlots: useEnv.value ? null : (value.value as number) }
  try {
    // retry: 0 — one PATCH per click; a retry would write a second audit row
    await api<UpdateProviderNodeResponse>(`/provider-nodes/${encodeURIComponent(n.id)}`, {
      method: 'PATCH',
      body,
      retry: 0
    })
    open.value = false
    toast.add({ title: 'บันทึกแล้ว', color: 'success' })
    emit('saved')
  } catch (e) {
    const err = e as FetchError<Partial<UpdateProviderNodeErrorBody>>
    const status = err.response?.status ?? err.statusCode
    if (status === 400) {
      errorMessage.value = err.data?.issues?.map(i => i.message).find(Boolean) ?? err.data?.error ?? 'ค่าไม่ถูกต้อง'
    } else if (status === 403) {
      toast.add({ title: 'สิทธิ์ไม่พอ', color: 'error' })
    } else {
      toast.add({ title: 'บันทึกไม่สำเร็จ', description: err.data?.error ?? err.message, color: 'error' })
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="แท็บเบาของ node"
    :description="description"
    :dismissible="!saving"
    :ui="{ content: 'max-w-sm' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <UFormField label="จำนวนแท็บเบา (lightSlots)">
          <UInputNumber
            v-model="value"
            :min="LIGHT_SLOTS_MIN"
            :max="LIGHT_SLOTS_MAX"
            :step="1"
            :disabled="saving || useEnv"
            class="w-full"
            data-testid="bp-node-light-slots-input"
          />
        </UFormField>

        <USwitch
          v-model="useEnv"
          label="ใช้ค่าจาก env"
          :disabled="saving"
          data-testid="bp-node-light-slots-env"
        />

        <p
          v-if="errorMessage"
          class="text-xs text-error"
          role="alert"
          data-testid="bp-node-light-slots-error"
        >
          {{ errorMessage }}
        </p>

        <p v-else-if="!invalidValue && unchanged" class="text-xs text-muted" data-testid="bp-node-light-slots-unchanged">
          ค่าเดิม
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="ยกเลิก"
          color="neutral"
          variant="subtle"
          :disabled="saving"
          data-testid="bp-node-light-slots-cancel"
          @click="open = false"
        />
        <UButton
          label="บันทึก"
          color="primary"
          variant="solid"
          :loading="saving"
          :disabled="saveDisabled"
          data-testid="bp-node-light-slots-save"
          @click="save"
        />
      </div>
    </template>
  </UModal>
</template>
