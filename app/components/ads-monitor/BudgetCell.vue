<script setup lang="ts">
/**
 * FEAT-060 — `am-budget`: the campaign tab's "งบ advertiser" column. Driven only by `row.advertiserBudget`
 * (the BO never re-derives `settable`, same rule as `am-delete`'s `deletable`). The budget is per
 * **advertiser** (spec A1), not per campaign: every row of the same advertiser renders the same state
 * because the page merges one override, keyed by `advertiser.id`, into every row's `advertiserBudget`
 * (`ads-monitor.vue` → `advertiserOverrides`), so this component never has to know about other rows.
 *
 * Four mutually exclusive renderings:
 * 1. **blocked (no data)**: `row.advertiserBudget` is absent (an older API or a test stub) — `—` + a disabled
 *    button, no tooltip.
 * 2. **pending** (`advertiserBudget.pending`, from the API or our own accepted 202): spinner + "กำลังตั้งงบ
 *    ไม่จำกัด…" / "กำลังตั้งงบ 1,000.00 THB…", no button.
 * 3. **error** (`advertiserBudget.error`, no pending): the idle value stays, plus a red "ตั้งงบไม่สำเร็จ:
 *    <reason>" and a retry icon button that reopens the modal (prefilled from the current value).
 * 4. **idle**: the value text + a wallet button, disabled with a tooltip + `title` when
 *    `settable.ok === false` (`data-state="blocked"`).
 *
 * A deleted campaign row (`deletedAt` set) keeps this cell active — the budget belongs to the advertiser, not
 * the campaign (spec A1), so `deletedAt` is never consulted here.
 */
import type { MonitorRow } from '#shared/types/ads-monitor'

const props = defineProps<{ row: MonitorRow }>()
const emit = defineEmits<{ ask: [] }>()

const budget = computed(() => props.row.advertiserBudget ?? null)
const blocked = computed(() => budget.value === null)
const pending = computed(() => (blocked.value ? null : budget.value!.pending))
const failure = computed(() => (blocked.value || pending.value ? null : budget.value!.error))
const settable = computed(() => budget.value?.settable ?? { ok: false, reason: null })

const state = computed(() => {
  if (blocked.value) return 'blocked'
  if (pending.value) return 'pending'
  if (failure.value) return 'error'
  return settable.value.ok ? 'idle' : 'blocked'
})

/** `1,000.00 THB/วัน` · `1,000.00/วัน` when `currency` is null · `—` when `amount` is null/invalid */
function amountText(amount: number | null, currency: string | null): string {
  const value = formatDecimal(amount)
  if (value === REPORT_DASH) return value
  return currency ? `${value} ${currency}/วัน` : `${value}/วัน`
}

const valueText = computed(() => {
  const b = budget.value
  if (!b || b.mode === null) return REPORT_DASH
  if (b.mode === 'unlimited') return 'ไม่จำกัด'
  return amountText(b.amount, b.currency)
})

const valueTitle = computed(() => {
  const b = budget.value
  if (!b) return ''
  if (b.setAt) return `ตั้งล่าสุด ${formatDateTime(b.setAt)}`
  if (b.readAt) return `อ่านล่าสุด ${formatDateTime(b.readAt)}`
  return ''
})

const pendingText = computed(() => {
  const p = pending.value
  if (!p) return ''
  return p.mode === 'unlimited' ? 'กำลังตั้งงบ ไม่จำกัด…' : `กำลังตั้งงบ ${formatDecimal(p.amount)}…`
})

/** only shown next to the enabled/disabled wallet button — the "blocked (no data)" case has no tooltip */
const blockedReason = computed(() => (blocked.value ? null : settable.value.reason))

const ariaLabel = computed(() => `ตั้งงบ advertiser ${props.row.advertiser.name ?? props.row.advertiser.id}`)
</script>

<template>
  <div
    class="flex min-w-0 flex-col items-start gap-1"
    data-testid="am-budget"
    :data-advertiser="row.advertiser.id"
    :data-state="state"
  >
    <template v-if="blocked">
      <span data-testid="am-budget-value">{{ REPORT_DASH }}</span>
      <UButton
        icon="i-lucide-wallet"
        color="neutral"
        variant="ghost"
        size="xs"
        disabled
        :aria-label="ariaLabel"
        :data-testid="`am-budget-${row.advertiser.id}`"
      />
    </template>

    <span
      v-else-if="pending"
      class="flex items-center gap-1 text-xs whitespace-nowrap text-muted"
      :data-testid="`am-budget-pending-${row.advertiser.id}`"
    >
      <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
      {{ pendingText }}
    </span>

    <template v-else>
      <span data-testid="am-budget-value" :title="valueTitle || undefined">{{ valueText }}</span>

      <template v-if="failure">
        <span
          class="w-44 text-xs leading-tight text-error"
          :data-testid="`am-budget-error-${row.advertiser.id}`"
        >ตั้งงบไม่สำเร็จ: {{ failure }}</span>
        <UButton
          icon="i-lucide-rotate-ccw"
          color="error"
          variant="subtle"
          size="xs"
          aria-label="ลองตั้งงบอีกครั้ง"
          title="กดเพื่อลองใหม่"
          :data-testid="`am-budget-retry-${row.advertiser.id}`"
          @click="emit('ask')"
        />
      </template>

      <UTooltip v-else :text="blockedReason ?? ''" :disabled="!blockedReason">
        <span class="inline-flex" :title="blockedReason ?? undefined">
          <UButton
            icon="i-lucide-wallet"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="ariaLabel"
            :disabled="!settable.ok"
            :data-testid="`am-budget-${row.advertiser.id}`"
            @click="emit('ask')"
          />
        </span>
      </UTooltip>
    </template>
  </div>
</template>
