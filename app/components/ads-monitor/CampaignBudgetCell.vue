<script setup lang="ts">
/**
 * FEAT-091 — `am-cbudget`: the campaign tab's "งบประมาณ" column gains a pencil next to the value
 * (api-contract.md v1 §1/§6, spec "UI behaviour (BO)"). Campaign tab only — `Table.vue` keeps the plain
 * `am-row-budget` span for the ad-group tab and renders this component for `level === 'campaign'`, with the
 * same `am-row-budget` value text/format/`title` kept **inside** this component so the FEAT-056/060 specs that
 * look for it still find it.
 *
 * Five mutually exclusive states (`data-state`), driven only by what the API sent — the BO never re-derives
 * `campaignBudgetEditable`, same rule as `deletable`/`settable`:
 * 1. **none** — `budget.amount === null` (the "-" rows), `campaignBudgetEditable.reason === 'noBudget'`, or a
 *    row from an older API/stub that carries none of the three FEAT-091 keys at all: value only, no pencil.
 * 2. **pending** (`campaignBudgetPending`, from the API or our own accepted 202): spinner + "กำลังแก้งบ… → <amount>
 *    <currency>" (`am-cbudget-pending-<id>`), no pencil. Reload-safe — a row that arrives with the pending key
 *    looks the same.
 * 3. **error** (`campaignBudgetError`, no pending): red "แก้งบไม่สำเร็จ: <reason>" + a retry icon
 *    (`am-cbudget-retry-<id>`) that reopens the modal prefilled with the **failed** amount.
 * 4. **ok** — the pencil `am-cbudget-edit-<id>` (enabled) → opens the modal prefilled with the current amount.
 * 5. **blocked** — the same pencil, disabled, tooltip **and** `title` = `campaignBudgetEditable.reason`
 *    (contract v1.1 — the API sends the Thai sentence directly, exactly like `deletable.reason`).
 *    `CAMPAIGN_BUDGET_REASON_TEXT` is only a fallback for a stub/older-API row whose `reason` is still one of
 *    the six bare codes of contract §0 (mirrors the API's own `CAMPAIGN_BUDGET_CONFLICT` table).
 *
 * `data-state` ( none · ok · blocked · pending · error ) is the one attribute QA needs to assert on, same
 * spirit as `am-delete`'s `data-state`.
 */
import type { CampaignBudgetBlockedReason, MonitorRow } from '#shared/types/ads-monitor'
import type { MoneyMode } from '~/utils/money'

/**
 * Contract v1.1 — `campaignBudgetEditable.reason` is the Thai sentence itself (like `deletable.reason`), so
 * the normal path renders it directly. This map is only a **fallback** for a stub/older-API row whose
 * `reason` is still one of the six bare codes of contract §0 — it mirrors the API's own
 * `CAMPAIGN_BUDGET_CONFLICT` table (cross-repo, not importable here) so such a row still reads in Thai rather
 * than showing a raw code.
 */
const CAMPAIGN_BUDGET_REASON_TEXT: Record<CampaignBudgetBlockedReason, string> = {
  duplicate: 'กำลังรอ job ของแคมเปญนี้อยู่',
  banned: 'บัญชีโฆษณาถูกระงับ',
  notLoggedIn: 'บัญชียังไม่ได้ login',
  deleted: 'แคมเปญถูกลบแล้ว',
  missing: 'ไม่พบบน TikTok แล้ว',
  noBudget: 'แคมเปญนี้ไม่มีงบรายวันให้แก้'
}

const props = withDefaults(defineProps<{ row: MonitorRow, mode?: MoneyMode }>(), { mode: 'thb' })
/** `amount` = the value to prefill the modal with: current for ok/blocked, the failed amount for retry. */
const emit = defineEmits<{ ask: [row: MonitorRow, amount: number] }>()

const amountNull = computed(() => props.row.budget?.amount == null)
/** an older API / test stub without the FEAT-091 keys at all never renders a pencil (spec "UI behaviour") */
const noKeys = computed(() => props.row.campaignBudgetEditable === undefined)
const editable = computed(() => props.row.campaignBudgetEditable ?? { ok: false, reason: null })
const pending = computed(() => props.row.campaignBudgetPending ?? null)
const failure = computed(() => (pending.value ? null : props.row.campaignBudgetError ?? null))

const state = computed(() => {
  if (amountNull.value || noKeys.value || editable.value.reason === 'noBudget') return 'none'
  if (pending.value) return 'pending'
  if (failure.value) return 'error'
  return editable.value.ok ? 'ok' : 'blocked'
})

/** contract v1.1: `reason` is already the Thai sentence — the code map only covers the six bare codes, for a
 * stub/older-API row that still sends one of those instead of the sentence. */
const blockedReason = computed(() => {
  const reason = editable.value.reason
  if (!reason) return null
  return (CAMPAIGN_BUDGET_REASON_TEXT as Record<string, string>)[reason] ?? reason
})

const currency = computed(() => props.row.budget?.currency ?? props.row.advertiserBudget?.currency ?? '')

function amountText(amount: number): string {
  const text = formatDecimal(amount)
  return currency.value ? `${text} ${currency.value}` : text
}

const pendingText = computed(() => {
  const p = pending.value
  return p ? `กำลังแก้งบ… → ${amountText(p.amount)}` : ''
})

const ariaLabel = computed(() => `แก้ไขงบประมาณรายวัน ${props.row.name ?? props.row.id}`)

function ask() {
  const current = props.row.budget?.amount
  emit('ask', props.row, typeof current === 'number' ? current : 0)
}

function retry() {
  const amount = failure.value?.amount
  emit('ask', props.row, typeof amount === 'number' ? amount : 0)
}

function budgetText(row: MonitorRow): string {
  return formatDecimal(row.budget?.amount ?? null)
}
</script>

<template>
  <div
    class="flex min-w-0 flex-col items-end gap-1"
    data-testid="am-cbudget"
    :data-id="row.id"
    :data-state="state"
  >
    <div class="flex items-center gap-1">
      <span
        class="whitespace-nowrap"
        :title="row.budget?.mode ?? ''"
        data-testid="am-row-budget"
      >
        <MoneyCell
          v-if="row.budget?.amount != null && row.budget.currency"
          :native="{ amount: row.budget.amount, currency: row.budget.currency }"
          :thb="row.budget.thb?.amount ?? null"
          :estimated="row.budget.thb?.estimated"
          :rate="row.budget.thb?.rate"
          :day="row.budget.thb?.day"
          :mode="mode"
        />
        <template v-else>{{ budgetText(row) }}</template>
      </span>

      <UTooltip v-if="state === 'ok' || state === 'blocked'" :text="blockedReason ?? ''" :disabled="!blockedReason">
        <span class="inline-flex" :title="blockedReason ?? undefined">
          <UButton
            icon="i-lucide-pencil"
            color="neutral"
            variant="ghost"
            size="xs"
            :aria-label="ariaLabel"
            :disabled="state === 'blocked'"
            :data-testid="`am-cbudget-edit-${row.id}`"
            @click="ask"
          />
        </span>
      </UTooltip>
    </div>

    <span
      v-if="state === 'pending'"
      class="flex items-center gap-1 text-xs whitespace-nowrap text-muted"
      :data-testid="`am-cbudget-pending-${row.id}`"
    >
      <UIcon name="i-lucide-loader-circle" class="size-3 animate-spin" />
      {{ pendingText }}
    </span>

    <template v-else-if="state === 'error'">
      <span
        class="w-44 text-xs leading-tight text-error"
        :data-testid="`am-cbudget-error-${row.id}`"
      >แก้งบไม่สำเร็จ: {{ failure?.reason }}</span>
      <UButton
        icon="i-lucide-rotate-ccw"
        color="error"
        variant="subtle"
        size="xs"
        aria-label="ลองแก้งบอีกครั้ง"
        title="กดเพื่อลองใหม่"
        :data-testid="`am-cbudget-retry-${row.id}`"
        @click="retry"
      />
    </template>
  </div>
</template>
