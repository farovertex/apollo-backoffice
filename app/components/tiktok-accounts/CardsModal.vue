<script setup lang="ts">
/**
 * FEAT-051 (AC-35, api-contract §7) — the cards a TikTok account remembers.
 *
 * There is no "add card" screen on purpose (D11): a card is created by the **first payment** of that account, so
 * this is a read + two mutations, nothing else:
 *   `GET    /tiktok-accounts/:id/payment-cards`                    one read per open
 *   `POST   /tiktok-accounts/:id/payment-cards/:cardId/default`    200 → the whole new list
 *   `DELETE /tiktok-accounts/:id/payment-cards/:cardId`            200 → re-read (409 when a round is using it)
 *
 * Every one of those routes is **GOD + Payment only** (AS-4): the page hides the opener for anybody else instead
 * of firing a request that would 403. The view carries no secret (brand / `****last4` / holder / MM/YY / status),
 * and the empty state says where a card comes from.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { PaymentCardStatus, PaymentCardView, PaymentCardsResponse } from '#shared/types/payment-cards'
import type { TikTokAccount } from '#shared/types/tiktok-accounts'

const props = defineProps<{
  /** null while the modal is closed */
  account: TikTokAccount | null
}>()

const open = defineModel<boolean>('open', { default: false })

const api = useApi()
const toast = useToast()

const modalContent = { 'data-testid': 'ta-cards-modal' } as ModalProps['content']

const CARD_STATUS: Record<PaymentCardStatus, { label: string, color: 'neutral' | 'success' | 'warning' | 'error' }> = {
  pending: { label: 'ยังไม่เคยจ่าย', color: 'neutral' },
  bound: { label: 'ใช้งานได้', color: 'success' },
  expired: { label: 'หมดอายุ', color: 'warning' },
  removed: { label: 'ถูกลบ', color: 'error' }
}

const cards = ref<PaymentCardView[]>([])
const pending = ref(false)
const loaded = ref(false)
const errorText = ref<string | null>(null)
/** cardId with a request in flight (one spinner per row, no double click) */
const busyId = ref<string | null>(null)
let session = 0

const accountName = computed(() => props.account?.bcOrgName || props.account?.label || props.account?.loginEmail || '')

async function load() {
  const id = props.account?.id
  if (!id) return
  const s = ++session
  pending.value = true
  errorText.value = null
  try {
    // retry: 0 — one read per open / per mutation
    const res = await api<PaymentCardsResponse>(`/tiktok-accounts/${encodeURIComponent(id)}/payment-cards`, { retry: 0 })
    if (s !== session) return
    cards.value = res.cards ?? []
    loaded.value = true
  } catch (e) {
    if (s !== session) return
    const err = e as FetchError<Partial<ApiErrorBody>>
    cards.value = []
    errorText.value = err.data?.error ?? err.message ?? 'อ่านรายการบัตรไม่สำเร็จ'
  } finally {
    if (s === session) pending.value = false
  }
}

watch(open, (isOpen) => {
  if (isOpen) {
    cards.value = []
    loaded.value = false
    busyId.value = null
    void load()
  } else {
    session++
  }
})

function fail(title: string, e: unknown) {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const status = err.response?.status ?? err.statusCode
  toast.add({
    title,
    'description': err.data?.error ?? err.message ?? 'ทำรายการไม่สำเร็จ',
    'color': status === 409 || status === 403 ? 'warning' : 'error',
    'data-testid': 'ta-toast'
  } as Parameters<typeof toast.add>[0])
}

async function setDefault(card: PaymentCardView) {
  const id = props.account?.id
  if (!id || busyId.value) return
  busyId.value = card.cardId
  try {
    const res = await api<PaymentCardsResponse>(
      `/tiktok-accounts/${encodeURIComponent(id)}/payment-cards/${encodeURIComponent(card.cardId)}/default`,
      { method: 'POST', retry: 0 }
    )
    cards.value = res.cards ?? cards.value
  } catch (e) {
    fail('ตั้งเป็นบัตรเริ่มต้นไม่สำเร็จ', e)
  } finally {
    busyId.value = null
  }
}

async function remove(card: PaymentCardView) {
  const id = props.account?.id
  if (!id || busyId.value) return
  busyId.value = card.cardId
  try {
    await api(
      `/tiktok-accounts/${encodeURIComponent(id)}/payment-cards/${encodeURIComponent(card.cardId)}`,
      { method: 'DELETE', retry: 0 }
    )
    toast.add({
      'title': 'ลบบัตรแล้ว',
      'description': cardSummary(card),
      'color': 'success',
      'data-testid': 'ta-toast'
    } as Parameters<typeof toast.add>[0])
    await load()
  } catch (e) {
    // 409 "บัตรใบนี้กำลังถูกใช้ในรอบที่ยังไม่จบ" — the API's own text, the list stays as it is
    fail('ลบบัตรไม่สำเร็จ', e)
  } finally {
    busyId.value = null
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="บัตรที่จำไว้"
    :description="accountName || undefined"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <USkeleton v-if="pending && !loaded" class="h-16 w-full" data-testid="ta-cards-loading" />

        <UAlert
          v-else-if="errorText"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="อ่านรายการบัตรไม่สำเร็จ"
          :description="errorText"
          data-testid="ta-cards-error"
        />

        <UAlert
          v-else-if="cards.length === 0"
          color="neutral"
          variant="subtle"
          icon="i-lucide-credit-card"
          title="ยังไม่มีบัตรที่จำไว้"
          description="กรอกบัตรตอนจ่ายครั้งแรกของบัญชีนี้ แล้วระบบจะจำไว้ให้เอง"
          data-testid="ta-cards-empty"
        />

        <template v-else>
          <div
            v-for="card in cards"
            :key="card.cardId"
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-default px-3 py-2"
            data-testid="ta-card-row"
            :data-card-id="card.cardId"
            :data-status="card.status"
            :data-default="card.isDefault ? 'true' : 'false'"
          >
            <div class="flex min-w-0 flex-col gap-0.5">
              <span class="flex min-w-0 flex-wrap items-center gap-1.5 text-sm font-medium text-highlighted">
                <UIcon name="i-lucide-credit-card" class="size-4 shrink-0 text-muted" />
                <span class="break-words" data-testid="ta-card-line">{{ cardSummary(card) }}</span>
                <UBadge
                  v-if="card.isDefault"
                  label="ค่าเริ่มต้น"
                  color="primary"
                  variant="subtle"
                  size="sm"
                  class="whitespace-nowrap"
                  data-testid="ta-card-default-badge"
                />
              </span>
              <span class="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <UBadge
                  :label="CARD_STATUS[card.status].label"
                  :color="CARD_STATUS[card.status].color"
                  variant="subtle"
                  size="sm"
                  class="whitespace-nowrap"
                  data-testid="ta-card-status"
                />
                <span v-if="card.lastUsedAt">ใช้ล่าสุด {{ formatDateTime(card.lastUsedAt) }}</span>
                <span v-if="card.lastError" class="break-words text-error" data-testid="ta-card-error">{{ card.lastError }}</span>
              </span>
            </div>

            <div class="flex flex-wrap items-center gap-1">
              <UButton
                v-if="!card.isDefault"
                label="ตั้งเป็นค่าเริ่มต้น"
                icon="i-lucide-star"
                color="neutral"
                variant="outline"
                size="xs"
                :loading="busyId === card.cardId"
                :disabled="!!busyId || card.status === 'removed' || card.status === 'expired'"
                data-testid="ta-card-default"
                @click="setDefault(card)"
              />
              <UButton
                label="ลบ"
                icon="i-lucide-trash-2"
                color="error"
                variant="outline"
                size="xs"
                :loading="busyId === card.cardId"
                :disabled="!!busyId"
                data-testid="ta-card-delete"
                @click="remove(card)"
              />
            </div>
          </div>
        </template>

        <p class="text-xs text-muted">
          แก้บัตรไม่ได้ที่นี่ — กรอกบัตรใบใหม่ตอนจ่ายเงินครั้งถัดไป ระบบจะอัปเดตใบเดิมให้ถ้าเป็นบัตรเดียวกัน
        </p>

        <div class="flex justify-end">
          <UButton
            label="ปิด"
            color="neutral"
            variant="subtle"
            data-testid="ta-cards-close"
            @click="open = false"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
