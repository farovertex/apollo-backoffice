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
  submitting: boolean
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
const capText = computed(() => formatBudgetCap(props.budget, props.copies, props.accounts))
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
        </dl>

        <div class="flex items-center justify-between gap-3 rounded-lg bg-elevated/50 px-3 py-2">
          <span class="text-sm text-muted">Budget cap</span>
          <span class="text-base font-semibold text-highlighted" data-testid="la-confirm-cap">{{ capText }}</span>
        </div>

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
