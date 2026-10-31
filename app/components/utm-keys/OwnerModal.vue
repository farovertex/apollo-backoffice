<script setup lang="ts">
/**
 * FEAT-090 — "เปลี่ยนเจ้าของ" modal of `/settings/utm-keys` (`st-uk-modal`; api-contract v1 §3 / §7,
 * spec "UI behaviour" §3).
 *
 * GOD only (the page itself is). It shows the key read-only (prefix / source / medium / campaign) with its
 * current owner and sends exactly one `PATCH /utm-keys/:id { ownerAdminId }` per submit (`retry: 0`). Success →
 * `moved` (the page re-reads the list) + toast `ย้ายเจ้าของแล้ว`; any 404 / 400 renders verbatim in
 * `st-uk-modal-error` and the modal stays open. The admin items come from the page (one `GET /admins` per page
 * load) — this component issues no request of its own but the PATCH.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PatchUtmKeyBody, UtmKeyView } from '#shared/types/utm-keys'

const props = defineProps<{
  /** `null` = nothing to edit (the modal is closed) */
  utmKey: UtmKeyView | null
  /** `{ value: adminId, label: displayName }` of the non-deleted admins, from the page */
  admins: { value: string, label: string }[]
  /** the page could not load `GET /admins` — the select then only offers the current owner */
  adminsError?: string | null
}>()

const emit = defineEmits<{ moved: [key: UtmKeyView] }>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()

const FALLBACK = 'ย้ายเจ้าของไม่สำเร็จ'

const modalContent = { 'data-testid': 'st-uk-modal' } as ModalProps['content']

const ownerId = ref('')
const submitting = ref(false)
const submitError = ref<string | null>(null)

/** the page's admins + the current owner when `GET /admins` did not serve them (deleted admin, failed request) */
const items = computed(() => {
  const current = props.utmKey?.owner
  if (!current || props.admins.some(a => a.value === current.id)) return props.admins
  return [...props.admins, { value: current.id, label: current.displayName }]
})

const currentOwnerText = computed(() => props.utmKey?.owner?.displayName ?? REPORT_DASH)

/** nothing to send while the select still points at the current owner */
const dirty = computed(() => ownerId.value !== '' && ownerId.value !== (props.utmKey?.owner?.id ?? ''))

watch(open, (isOpen) => {
  submitting.value = false
  submitError.value = null
  ownerId.value = isOpen ? (props.utmKey?.owner?.id ?? '') : ''
})

async function submit() {
  const row = props.utmKey
  if (!row || submitting.value || !dirty.value) return
  const body: PatchUtmKeyBody = { ownerAdminId: ownerId.value }
  submitting.value = true
  submitError.value = null
  try {
    // retry: 0 — exactly one PATCH per click
    const moved = await api<UtmKeyView>(`/utm-keys/${encodeURIComponent(row.id)}`, { method: 'PATCH', body, retry: 0 })
    open.value = false
    toast.add({ title: 'ย้ายเจ้าของแล้ว', icon: 'i-lucide-check', color: 'success' })
    emit('moved', moved)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
    submitError.value = issues.length ? issues.join(' · ') : (err.data?.error ?? err.message ?? FALLBACK)
  } finally {
    submitting.value = false
  }
}

const LINES: { label: string, key: 'prefix' | 'source' | 'medium' | 'campaign' }[] = [
  { label: 'Prefix', key: 'prefix' },
  { label: 'Source', key: 'source' },
  { label: 'Medium', key: 'medium' },
  { label: 'Campaign', key: 'campaign' }
]
</script>

<template>
  <UModal
    v-model:open="open"
    title="เปลี่ยนเจ้าของ UTM key"
    description="รายงานของทุกหน้าคิดยอดสมัคร/ฝากของ key นี้ให้เจ้าของใหม่ทันที · template ที่ผูก key นี้ไม่ถูกแก้"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-md' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <dl class="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm" data-testid="st-uk-modal-key">
          <template v-for="line in LINES" :key="line.key">
            <dt class="text-muted">
              {{ line.label }}
            </dt>
            <dd class="font-mono break-all text-highlighted">
              {{ utmKey?.[line.key] || REPORT_DASH }}
            </dd>
          </template>
          <dt class="text-muted">
            เจ้าของ
          </dt>
          <dd class="break-words text-highlighted" data-testid="st-uk-modal-owner">
            {{ currentOwnerText }}
          </dd>
        </dl>

        <UFormField label="เจ้าของใหม่" name="ownerAdminId">
          <USelect
            v-model="ownerId"
            :items="items"
            value-key="value"
            placeholder="— เลือก admin —"
            icon="i-lucide-user"
            class="w-full"
            :disabled="submitting"
            data-testid="st-uk-owner-select"
          />
          <template v-if="adminsError" #hint>
            <span class="text-error">{{ adminsError }}</span>
          </template>
        </UFormField>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          role="alert"
          data-testid="st-uk-modal-error"
        >
          <template #description>
            <span class="break-words">{{ submitError }}</span>
          </template>
        </UAlert>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="st-uk-cancel"
            @click="open = false"
          />
          <UButton
            label="ย้ายเจ้าของ"
            icon="i-lucide-user-check"
            color="primary"
            :disabled="!dirty"
            :loading="submitting"
            data-testid="st-uk-submit"
            @click="submit()"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
