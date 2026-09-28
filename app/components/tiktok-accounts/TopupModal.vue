<script setup lang="ts">
/**
 * ฝากเงินของ advertiser หนึ่งแถว.
 * Processing ปิดได้โดยไม่เริ่ม poll · เห็น QR แล้วกดปิดจึงเป็น Pending และเริ่มเช็ค.
 * รูปมาจาก GET .../topup (ไม่อยู่ในรายการ)
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { Advertiser, AdvertiserTopup } from '#shared/types/advertisers'
import { clockRemainingMs, formatRemain, showTopupRefresh } from '~/utils/topup'

const props = defineProps<{
  accountId: string
  advertiser: Advertiser | null
}>()

const emit = defineEmits<{
  changed: []
}>()

const open = defineModel<boolean>('open', { default: false })
const modalContent = { 'data-testid': 'ta-adv-topup-modal' } as ModalProps['content']

const api = useApi()
const amount = ref<number | undefined>(undefined)
const submitting = ref(false)
const formError = ref<string | null>(null)
const qrImage = ref<string | null>(null)
const now = ref(Date.now())
let tick: ReturnType<typeof setInterval> | undefined

const topup = computed(() => props.advertiser?.topup ?? null)
const remain = computed(() => clockRemainingMs(topup.value?.qrSavedAt ?? null, now.value))
const showImage = computed(() => {
  const phase = topup.value?.phase
  return phase === 'ready' || phase === 'pending' || phase === 'expired' || (phase === 'ready' && remain.value === 0)
})
const showForm = computed(() => {
  const phase = topup.value?.phase
  if (!phase || phase === 'expired') return true
  if ((phase === 'ready' || phase === 'pending') && remain.value === 0) return true
  return false
})
const canSubmit = computed(() => Number.isInteger(amount.value) && (amount.value ?? 0) >= 400 && !submitting.value)
const showRefresh = computed(() => showTopupRefresh(topup.value, now.value))

watch(open, (isOpen) => {
  if (tick) clearInterval(tick)
  if (!isOpen) {
    amount.value = undefined
    formError.value = null
    qrImage.value = null
    return
  }
  now.value = Date.now()
  tick = setInterval(() => { now.value = Date.now() }, 1000)
  formError.value = topup.value?.error ?? null
  void loadImage()
})

watch(() => topup.value?.phase, () => {
  if (open.value) void loadImage()
})

onUnmounted(() => {
  if (tick) clearInterval(tick)
})

function messageOf(e: unknown, fallback: string) {
  const err = e as FetchError<ApiErrorBody>
  const body = err.data
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error
  return fallback
}

async function loadImage() {
  if (!props.advertiser || !showImage.value) {
    qrImage.value = null
    return
  }
  try {
    const res = await api<{ qrImage: string | null }>(`/tiktok-accounts/${props.accountId}/advertisers/${props.advertiser.id}/topup`)
    qrImage.value = res.qrImage
  } catch {
    qrImage.value = null
  }
}

async function submit() {
  if (!props.advertiser || !canSubmit.value) return
  submitting.value = true
  formError.value = null
  try {
    await api(`/tiktok-accounts/${props.accountId}/advertisers/${props.advertiser.id}/topup`, {
      method: 'POST',
      body: { amount: amount.value }
    })
    emit('changed')
  } catch (e) {
    formError.value = messageOf(e, 'ทำรายการไม่สำเร็จ')
  } finally {
    submitting.value = false
  }
}

async function closeModal() {
  const phase = topup.value?.phase
  if (phase === 'ready' && props.advertiser) {
    try {
      await api(`/tiktok-accounts/${props.accountId}/advertisers/${props.advertiser.id}/topup/close`, { method: 'POST' })
      emit('changed')
    } catch (e) {
      formError.value = messageOf(e, 'ทำรายการไม่สำเร็จ')
      return
    }
  }
  open.value = false
}

async function refresh() {
  if (!props.advertiser) return
  submitting.value = true
  formError.value = null
  try {
    await api(`/tiktok-accounts/${props.accountId}/advertisers/${props.advertiser.id}/topup/refresh`, { method: 'POST' })
    emit('changed')
  } catch (e) {
    formError.value = messageOf(e, 'ทำรายการไม่สำเร็จ')
  } finally {
    submitting.value = false
  }
}

function balanceText(t: AdvertiserTopup) {
  if (!t.balanceAmount) return ''
  return t.balanceCurrency ? `${t.balanceAmount} ${t.balanceCurrency}` : t.balanceAmount
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="advertiser ? `Pay — ${advertiser.name}` : 'Pay'"
    :close="false"
    :content="modalContent"
  >
    <template #body>
      <div class="flex flex-col gap-3 text-sm">
        <p v-if="topup?.phase === 'processing'" data-testid="ta-adv-topup-processing">
          Processing
        </p>
        <p v-else-if="topup?.phase === 'paid'" class="text-lg font-medium" data-testid="ta-adv-topup-paid">
          {{ topup ? balanceText(topup) : '' }}
        </p>
        <template v-else>
          <img
            v-if="qrImage"
            :src="qrImage"
            alt="QR"
            class="mx-auto max-h-64 max-w-full"
            data-testid="ta-adv-topup-qr"
          >
          <p v-if="topup?.qrSavedAt && (topup.phase === 'ready' || topup.phase === 'pending' || topup.phase === 'expired')" data-testid="ta-adv-topup-modal-remain">
            {{ formatRemain(remain) }}
          </p>
          <form v-if="showForm" class="flex flex-col gap-2" @submit.prevent="submit">
            <label class="text-xs text-muted" for="ta-adv-topup-amount">บาท</label>
            <UInput
              id="ta-adv-topup-amount"
              v-model.number="amount"
              type="number"
              inputmode="numeric"
              :min="400"
              step="1"
              placeholder="400"
              data-testid="ta-adv-topup-amount"
            />
            <UButton
              type="submit"
              label="Pay"
              color="primary"
              :disabled="!canSubmit"
              :loading="submitting"
              data-testid="ta-adv-topup-submit"
            />
          </form>
        </template>
        <p v-if="formError || (topup?.error && topup.phase !== 'processing')" class="text-error" data-testid="ta-adv-topup-modal-error">
          {{ formError || topup?.error }}
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          v-if="showRefresh"
          label="Refresh"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="submitting || topup?.checking"
          data-testid="ta-adv-topup-modal-refresh"
          @click="refresh"
        />
        <UButton
          label="Close"
          color="neutral"
          variant="subtle"
          data-testid="ta-adv-topup-close"
          @click="closeModal"
        />
      </div>
    </template>
  </UModal>
</template>
