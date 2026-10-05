<script setup lang="ts">
/**
 * FEAT-021 — the action buttons of one top-up round (api-contract v1.1 §C). One component for both surfaces:
 * the advertisers slide-over (`ta-adv-topup-pay` / `-open` / `-recheck` / `-release`) and the `/topups` table
 * (`tp-row-retry` / `tp-row-open` / `tp-row-recheck` / `tp-row-release`) — same semantics, same suffixes, the
 * "start a new round" trigger is the only id the contract spells differently.
 *
 * Which buttons exist is `topupRowActions()` (app/utils/topup.ts), so the two surfaces can never disagree:
 * Admin sees none of them (read-only, D17), `release` is GOD-only (AC-19).
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
}>(), {
  prefix: 'ta-adv-topup',
  busy: false,
  size: 'xs'
})

const emit = defineEmits<{
  /** `POST /topups` answered 201 — the row is `waitingQr` from now on */
  created: [topup: TopupView]
  /** "Ready to pay" / re-open my own round → the parent claims and opens the modal */
  open: [topup: TopupView]
  recheck: [topup: TopupView]
  release: [topup: TopupView]
}>()

const actions = computed(() => topupRowActions(props.topup, props.viewer))
const payTestid = computed(() => props.prefix === 'tp-row' ? 'tp-row-retry' : `${props.prefix}-pay`)
const defaultAmount = computed(() => actions.value.retry ? retryAmount(props.topup) : undefined)
/** a recheck job is already running for this round (409 "กำลังตรวจอยู่" is pending) */
const recheckDisabled = computed(() => props.busy)
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
  </span>
</template>
