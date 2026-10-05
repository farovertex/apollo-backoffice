<script setup lang="ts">
/**
 * FEAT-021 (AC-17, api-contract v1.1 §C) — the pay modal, used by the advertisers slide-over **and** by
 * `/topups` (one component, one set of test ids).
 *
 * It never opens on its own: the parent claims the round (`POST /topups/:id/claim`) and passes the `qrImage`
 * of that very answer. While it is open it shows the QR, the amount, the 5-minute lease countdown and the
 * 24-hour QR countdown.
 *
 *   "สำเร็จ"  → `confirm` (parent) → `verifying`
 *   "Cancel" → `cancel` (parent)  → back to `readyToPay`
 *   X / Esc / backdrop → confirm dialog "ยังไม่ได้โอนใช่ไหม" → yes = cancel, no = stay (spec D7)
 *   the lease reaching 0 → the modal closes itself and the parent shows "หมดเวลาจอง"
 *
 * `:close="false"` + `:dismissible="false"`: Nuxt UI then prevents Esc/backdrop and emits `close:prevent`,
 * which is exactly the hook the confirm dialog needs, and the X in the header is ours.
 */
import type { ModalProps } from '@nuxt/ui'
import type { TopupView } from '#shared/types/topups'

const props = withDefaults(defineProps<{
  topup: TopupView | null
  qrImage: string | null
  /** a cancel/confirm request is in flight */
  busy?: boolean
}>(), {
  busy: false
})

const emit = defineEmits<{
  /** "สำเร็จ" → POST confirm */
  confirm: [topup: TopupView]
  /** "Cancel" or "ยังไม่ได้โอน → ใช่" → POST cancel */
  cancel: [topup: TopupView]
  /** the 5-minute lease ran out while the modal was open — the API released the round on its own */
  expired: [topup: TopupView]
}>()

const open = defineModel<boolean>('open', { default: false })

const modalContent = computed(() => ({
  'data-testid': 'ta-adv-topup-modal',
  'data-status': props.topup?.status ?? ''
}) as ModalProps['content'])
const confirmContent = { 'data-testid': 'ta-adv-topup-cancel-confirm' } as ModalProps['content']

const confirmOpen = ref(false)
const { now, pause, resume } = useNow({ interval: 1000, controls: true })
const nowMs = computed(() => now.value.getTime())

const leaseMs = computed(() => leaseRemainingMs(props.topup, nowMs.value))
const qrMs = computed(() => qrRemainingMs(props.topup, nowMs.value))
const title = computed(() => props.topup ? `จ่ายเงิน — ${topupTargetName(props.topup)}` : 'จ่ายเงิน')

watch(open, (isOpen) => {
  if (isOpen) {
    resume()
  } else {
    pause()
    confirmOpen.value = false
  }
}, { immediate: true })

// the lease is the API's clock; when it reaches 0 the round is `readyToPay` again for everybody
watch(leaseMs, (ms, before) => {
  if (!open.value || !props.topup) return
  if (ms === 0 && (before ?? 0) > 0) {
    confirmOpen.value = false
    open.value = false
    emit('expired', props.topup)
  }
})

/** X / Esc / backdrop (D7): never cancel silently — ask first */
function requestClose() {
  if (!props.topup) {
    open.value = false
    return
  }
  confirmOpen.value = true
}

function onConfirmPayment() {
  if (props.topup) emit('confirm', props.topup)
}

function onCancelPayment() {
  if (props.topup) emit('cancel', props.topup)
}

function onCancelYes() {
  confirmOpen.value = false
  onCancelPayment()
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="title"
    :close="false"
    :dismissible="false"
    :content="modalContent"
    @close:prevent="requestClose"
  >
    <template #actions>
      <UButton
        icon="i-lucide-x"
        color="neutral"
        variant="ghost"
        aria-label="ปิด"
        data-testid="ta-adv-topup-modal-close"
        @click="requestClose"
      />
    </template>

    <template #body>
      <div class="flex flex-col items-center gap-3 text-sm">
        <img
          v-if="qrImage"
          :src="qrImage"
          alt="QR code"
          class="size-56 max-w-full object-contain"
          data-testid="ta-adv-topup-qr"
        >
        <p v-else class="text-muted" data-testid="ta-adv-topup-qr-missing">
          ไม่มีรูป QR
        </p>

        <p class="text-lg font-semibold tabular-nums text-highlighted" data-testid="ta-adv-topup-modal-amount">
          {{ formatInt(topup?.amount ?? null) }} {{ topup?.currency ?? 'THB' }}
        </p>

        <div class="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted">
          <span class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-timer" class="size-3.5 shrink-0" />
            จองไว้อีก
            <b class="tabular-nums text-highlighted" data-testid="ta-adv-topup-lease-remain">{{ formatRemain(leaseMs) }}</b>
          </span>
          <span class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-qr-code" class="size-3.5 shrink-0" />
            QR หมดอายุใน
            <b class="tabular-nums text-highlighted" data-testid="ta-adv-topup-modal-qr-remain">{{ formatRemainLong(qrMs) }}</b>
          </span>
        </div>

        <p v-if="topup?.error" class="text-xs text-error" data-testid="ta-adv-topup-modal-error">
          {{ topup.error }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="busy"
          data-testid="ta-adv-topup-cancel"
          @click="onCancelPayment"
        />
        <UButton
          label="สำเร็จ"
          color="primary"
          icon="i-lucide-check"
          :loading="busy"
          data-testid="ta-adv-topup-success"
          @click="onConfirmPayment"
        />
      </div>
    </template>
  </UModal>

  <UModal
    v-model:open="confirmOpen"
    title="ยังไม่ได้โอนใช่ไหม"
    description="ปิดหน้านี้จะคืนรอบให้คนอื่นจ่ายต่อได้"
    :close="false"
    :content="confirmContent"
  >
    <template #footer>
      <div class="flex w-full flex-wrap justify-end gap-2">
        <UButton
          label="ไม่ใช่ อยู่ต่อ"
          color="neutral"
          variant="subtle"
          data-testid="ta-adv-topup-cancel-no"
          @click="confirmOpen = false"
        />
        <UButton
          label="ใช่ ยังไม่ได้โอน"
          color="error"
          :loading="busy"
          data-testid="ta-adv-topup-cancel-yes"
          @click="onCancelYes"
        />
      </div>
    </template>
  </UModal>
</template>
