<script setup lang="ts">
/**
 * FEAT-016 — confirm dialog of **Create & publish** (spec AC-15, human decision 8, api-contract.md v1 §8
 * `la-confirm*`). Shows how many accounts are launched, the copies per account, the budget type and the
 * **budget cap** = `budget.amount × copies × accounts` (`#,##0.00 <currency>`, plus ` / day` for a daily
 * budget). The acknowledgement checkbox gates the confirm button; ticking it is reset on every open, so a
 * second publish always has to be acknowledged again.
 *
 * The dialog never calls the API itself: it emits `confirm` and the page runs the single POST (the button
 * stays in its loading state through `submitting`, so a double submit is impossible).
 *
 * FEAT-066 (spec "UI behaviour") — when `pauseAfterPublish` is true, one extra line (`la-confirm-pause`)
 * repeats the checkbox's intent under the budget cap; absent when false. `la-confirm-ack` is unchanged.
 *
 * TASK-theme-cbo-cap — under CBO the page passes the **campaign** budget as `budget` and `cbo: true`: the cap is
 * then `budget.amount × accounts` (one campaign per account; its copies share that budget, so they do not
 * multiply it) and one extra row (`la-confirm-cbo`) says so. The copies row itself is unchanged.
 *
 * FEAT-086 (spec §3) — `adGroupGuardText`: the page's `la-adgroup-guard-text` when a rule applies to at least one
 * target, else `null`; rendered as `la-confirm-adgroup-guard` iff non-null.
 */
import type { ModalProps } from '@nuxt/ui'
import type { AdGroupBudget } from '#shared/types/ad-group-templates'

const props = defineProps<{
  /** number of TikTok accounts (= builds) of the order */
  accounts: number
  copies: number
  /** `config.budget` of the chosen ad group template; null only when the template has none */
  budget: AdGroupBudget | null
  /** label of `budget.type` from `GET /ad-group-templates/options` — never invented here */
  budgetTypeLabel: string
  /** TASK-theme-cbo-cap — `budget` is the campaign (CBO) budget: counted once per account, not per copy */
  cbo?: boolean
  submitting: boolean
  /** FEAT-066 — mirrors the `la-pause-after-publish` checkbox of the page */
  pauseAfterPublish: boolean
  /** FEAT-086 — the ad group guard summary; `null` = no target is guarded (off / no rule anywhere) */
  adGroupGuardText?: string | null
}>()

const emit = defineEmits<{ confirm: [] }>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless — `content` is v-bound onto the rendered dialog element
const modalContent = { 'data-testid': 'la-confirm' } as ModalProps['content']

const acknowledged = ref(false)

watch(open, (isOpen) => {
  // every open starts unacknowledged (AC-15)
  if (isOpen) acknowledged.value = false
})

/** `#,##0.00 THB` (+ ` / day` for a daily budget) — fixed grouping, never locale-dependent */
const capText = computed(() => formatBudgetCap(props.budget, props.cbo ? 1 : props.copies, props.accounts))
</script>

<template>
  <UModal
    v-model:open="open"
    title="Create and publish this order?"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-lg' }"
    :content="modalContent"
  >
    <template #description>
      <span>The build jobs are queued right away; money starts moving as soon as TikTok approves the ads.</span>
    </template>

    <template #body>
      <div class="flex flex-col gap-4">
        <dl class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt class="text-muted">
            Accounts
          </dt>
          <dd class="text-right font-medium text-highlighted" data-testid="la-confirm-accounts">
            {{ accounts }}
          </dd>
          <dt class="text-muted">
            Ad group copies
          </dt>
          <dd class="text-right font-medium text-highlighted" data-testid="la-confirm-copies">
            {{ copies }}
          </dd>
          <dt class="text-muted">
            Budget type
          </dt>
          <dd class="text-right font-medium text-highlighted" data-testid="la-confirm-budget-type">
            {{ budgetTypeLabel }}
          </dd>
          <template v-if="cbo">
            <dt class="text-muted">
              Budget strategy
            </dt>
            <dd class="text-right font-medium text-highlighted" data-testid="la-confirm-cbo">
              CBO · campaign budget × accounts
            </dd>
          </template>
        </dl>

        <div class="flex items-center justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2">
          <span class="text-sm text-muted">Budget cap</span>
          <span class="text-base font-semibold text-highlighted" data-testid="la-confirm-cap">{{ capText }}</span>
        </div>

        <p
          v-if="pauseAfterPublish"
          class="flex items-center gap-1.5 text-sm text-muted"
          data-testid="la-confirm-pause"
        >
          <UIcon name="i-lucide-info" class="size-4 shrink-0" />
          หลังเผยแพร่ ระบบจะปิด campaign ให้ (หลังรอบ KPI ถัดไป)
        </p>

        <p
          v-if="adGroupGuardText"
          class="flex items-start gap-1.5 text-sm text-muted"
          data-testid="la-confirm-adgroup-guard"
        >
          <UIcon name="i-lucide-shield-alert" class="mt-0.5 size-4 shrink-0" />
          <span class="min-w-0 break-words">{{ adGroupGuardText }}</span>
        </p>

        <UCheckbox
          v-model="acknowledged"
          label="I understand that money starts moving as soon as TikTok approves the ads"
          :disabled="submitting"
          data-testid="la-confirm-ack"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="Cancel"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="la-confirm-cancel"
            @click="open = false"
          />
          <UButton
            label="Create & publish"
            icon="i-lucide-rocket"
            color="primary"
            :disabled="!acknowledged"
            :loading="submitting"
            data-testid="la-confirm-ok"
            @click="emit('confirm')"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
