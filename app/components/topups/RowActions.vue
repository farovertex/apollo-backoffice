<script setup lang="ts">
/**
 * FEAT-021 — the action buttons of one top-up round (api-contract v1.1 §C). One component for both surfaces:
 * the advertisers slide-over (`ta-adv-topup-pay` / `-open` / `-recheck` / `-release`) and the `/topups` table
 * (`tp-row-retry` / `tp-row-open` / `tp-row-recheck` / `tp-row-release`) — same semantics, same suffixes, the
 * "start a new round" trigger is the only id the contract spells differently.
 *
 * Which buttons exist is `topupRowActions()` (app/utils/topup.ts), so the two surfaces can never disagree:
 * Admin sees none of them (read-only, D17), `release` is GOD-only (AC-19).
 *
 * FEAT-051 (AC-34) adds the three controls of the card channel, again for every surface at once:
 *   `pendingApproval` → **จ่ายเงิน** (`<prefix>-approve`, the shared confirm dialog → `POST /topups/:id/approve`)
 *                     + **ยกเลิก** (`<prefix>-cancel` → `POST /topups/:id/cancel`)
 *                     + the rest of the 24 h clock (`<prefix>-approval-remain`)
 *   `awaitingOtp`     → **กรอก OTP** (`<prefix>-otp`) → `TopupsOtpModal`
 * Those three run their own request (`useTopupCard`) instead of going through the parent, so a surface only has
 * to listen to `@changed` and patch its row; `verifying` / `paid` / every QR state is rendered exactly as before.
 */
import type { TopupView } from '#shared/types/topups'
import type { TopupViewer } from '~/utils/topup'

const props = withDefaults(defineProps<{
  topup: TopupView | null
  tiktokAccountId: string
  /** null → an account-level (BC) round */
  advertiserId: string | null
  viewer: TopupViewer
  /** `ta-adv-topup` in the slide-over, `tp-row` in the `/topups` table, `ta-topup` on the accounts table (BC level) */
  prefix?: 'ta-adv-topup' | 'tp-row' | 'ta-topup'
  /** a request for this round is in flight */
  busy?: boolean
  size?: 'xs' | 'sm'
  /**
   * FEAT-051 — `balanceCurrency` of the account (`undefined` = this surface does not know it). Defaults to the
   * currency of the round shown, which is the account's currency for every round the API ever created.
   */
  balanceCurrency?: string | null
  /** FEAT-051 — advertiser / BC name for the card modal, the confirm dialog and the OTP modal */
  accountName?: string
}>(), {
  prefix: 'ta-adv-topup',
  busy: false,
  size: 'xs',
  balanceCurrency: undefined,
  accountName: ''
})

const emit = defineEmits<{
  /** `POST /topups` answered 201 — the row is `waitingQr` from now on */
  created: [topup: TopupView]
  /** "Ready to pay" / re-open my own round → the parent claims and opens the modal */
  open: [topup: TopupView]
  recheck: [topup: TopupView]
  release: [topup: TopupView]
  /** FEAT-051 — approve / cancel / OTP changed this round; the parent patches its row (SSE does the rest) */
  changed: [topup: TopupView]
}>()

const actions = computed(() => topupRowActions(props.topup, props.viewer))
const payTestid = computed(() => props.prefix === 'tp-row' ? 'tp-row-retry' : `${props.prefix}-pay`)
const defaultAmount = computed(() => actions.value.retry ? retryAmount(props.topup) : undefined)
/** a recheck job is already running for this round (409 "กำลังตรวจอยู่" is pending) */
const recheckDisabled = computed(() => props.busy)

// ── FEAT-051 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** a retry of a `cardFailed` round starts on the card channel again (spec "แถว cardFailed … ช่องทางบัตร") */
const defaultChannel = computed(() => actions.value.retry ? topupChannel(props.topup) : 'qr')
/** the surface's value wins; otherwise the round's own currency (the account's) */
const currency = computed(() => props.balanceCurrency !== undefined ? props.balanceCurrency : (props.topup?.currency ?? undefined))
const name = computed(() => props.accountName || topupTargetName(props.topup))

const nowDate = useNow({ interval: 1000 })
const approvalMs = computed(() => approvalRemainingMs(props.topup, nowDate.value.getTime()))

const { busy: cardBusy, approve, cancel } = useTopupCard()
const approveOpen = ref(false)
const otpOpen = ref(false)

async function onApprove() {
  if (!props.topup) return
  const updated = await approve(props.topup)
  if (!updated) return
  approveOpen.value = false
  emit('changed', updated)
}

async function onCancel() {
  if (!props.topup) return
  const updated = await cancel(props.topup)
  if (updated) emit('changed', updated)
}
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1">
    <TopupsPayPopover
      v-if="actions.pay"
      :tiktok-account-id="tiktokAccountId"
      :advertiser-id="advertiserId"
      :default-amount="defaultAmount"
      :retry="actions.retry"
      :trigger-testid="payTestid"
      :size="size"
      :disabled="busy"
      :balance-currency="currency"
      :default-channel="defaultChannel"
      :account-name="name"
      @created="emit('created', $event)"
    />

    <UButton
      v-if="actions.open && topup"
      label="Ready to pay"
      icon="i-lucide-qr-code"
      color="primary"
      :size="size"
      :loading="busy"
      :data-testid="`${prefix}-open`"
      @click="emit('open', topup)"
    />

    <!-- FEAT-051 — a round somebody left for approval: pay it (same confirm dialog) or cancel it -->
    <UButton
      v-if="actions.approve && topup"
      label="จ่ายเงิน"
      icon="i-lucide-credit-card"
      color="primary"
      :size="size"
      :disabled="cardBusy"
      :data-testid="`${prefix}-approve`"
      @click="approveOpen = true"
    />
    <UButton
      v-if="actions.cancel && topup"
      label="ยกเลิก"
      icon="i-lucide-x"
      color="neutral"
      variant="outline"
      :size="size"
      :loading="cardBusy"
      :data-testid="`${prefix}-cancel`"
      @click="onCancel"
    />
    <span
      v-if="actions.approve && topup"
      class="text-xs tabular-nums whitespace-nowrap text-muted"
      :data-testid="`${prefix}-approval-remain`"
      :data-expires-at="topup.approvalExpiresAt ?? ''"
    >
      เหลือ {{ formatRemainLong(approvalMs) }}
    </span>

    <UButton
      v-if="actions.otp && topup"
      label="กรอก OTP"
      icon="i-lucide-key-round"
      color="warning"
      :size="size"
      :data-testid="`${prefix}-otp`"
      @click="otpOpen = true"
    />

    <UButton
      v-if="actions.recheck && topup"
      label="ตรวจอีกครั้ง"
      icon="i-lucide-search-check"
      color="neutral"
      variant="outline"
      :size="size"
      :loading="busy"
      :disabled="recheckDisabled"
      :data-testid="`${prefix}-recheck`"
      @click="emit('recheck', topup)"
    />

    <UButton
      v-if="actions.release && topup"
      label="ปลดการจอง"
      icon="i-lucide-unlock"
      color="warning"
      variant="outline"
      :size="size"
      :loading="busy"
      :data-testid="`${prefix}-release`"
      @click="emit('release', topup)"
    />

    <TopupsCardConfirmDialog
      v-if="actions.approve && topup"
      v-model:open="approveOpen"
      :amount="topup.amount"
      :currency="topup.currency"
      :account-name="name"
      :last4="topup.card?.last4 ?? ''"
      :card-summary-text="cardSummary(topupCard(topup))"
      :busy="cardBusy"
      @confirm="onApprove"
    />

    <TopupsOtpModal
      v-if="actions.otp"
      v-model:open="otpOpen"
      :topup="topup"
      @resolved="emit('changed', $event)"
    />
  </span>
</template>
