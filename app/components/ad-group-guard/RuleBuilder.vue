<script setup lang="ts">
/**
 * FEAT-087 (spec "UI behaviour" §1, AC-10) — the ad group guard **rule builder**: an expression tree of conditions
 * `<metric> <op> <value>` joined by and/or, with nested groups ("วงเล็บ"). Replaces FEAT-086's `RuleFields.vue` on
 * the three edit places: `/settings/ad-group-guard` (`st-agg-rule`), the account Edit modal (`ta-edit-guard-rule`),
 * the Launch ads popover (`la-adgroup-guard-rule`). `testid` is the prefix `<p>` of every id below.
 *
 * - v-model: `AdGroupGuardDraft` (tree of strings, `utils/ad-group-guard.ts`); every edit assigns a fresh copy.
 * - Rows / groups / pills are rendered by `RuleBuilderItems.vue` (recursive) and talk to this component through the
 *   injected `AggBuilderContext` (edits by index path, error lookup by zod sub-path).
 * - Summary: `<p>-sentence` live (invalid numbers `…`), `<p>-error` (rule level), `<p>-spend-warn` (no spend
 *   condition — never blocks), `<p>-json-toggle` / `<p>-json` (the body the form would send).
 * - Errors: `serverErrors` is keyed by the sub-path below the rule prefix (`items.1.items.0.value`, `''` = the rule)
 *   and wins over the client message; a row's client message shows once that row was typed in or `showErrors`.
 * - Emits `valid` on every change (immediate) and `edited` when the user changes anything.
 */
import type { AdGroupGuardMetricKey, AdGroupGuardOp } from '#shared/types/ad-group-guard'
import type { AdGroupGuardDraft, AdGroupGuardDraftErrors, AdGroupGuardGroupDraft, AdGroupGuardNodeDraft } from '~/utils/ad-group-guard'
import { AGG_BUILDER_KEY, type AggBuilderContext } from '~/utils/ad-group-guard-builder'

const props = withDefaults(defineProps<{
  /** testid prefix */
  testid: string
  /** unit of the money metrics; `null` → "สกุลของบัญชี" */
  currency: string | null
  disabled?: boolean
  showErrors?: boolean
  serverErrors?: AdGroupGuardDraftErrors | null
}>(), { disabled: false, showErrors: false, serverErrors: null })

const emit = defineEmits<{ valid: [valid: boolean], edited: [] }>()

const draft = defineModel<AdGroupGuardDraft>({ required: true })

/** uids of the conditions the user typed in (their client message shows from then on) */
const touched = ref<Set<string>>(new Set())

const parsed = computed(() => parseAdGroupGuardDraft(draft.value))
const clientErrors = computed<AdGroupGuardDraftErrors>(() => parsed.value.errors ?? {})
const server = computed<AdGroupGuardDraftErrors>(() => props.serverErrors ?? {})

watch(() => parsed.value.rule !== null, valid => emit('valid', valid), { immediate: true })

// ── edits ────────────────────────────────────────────────────────────────────────────────────────────────────────────
function nodeAt(root: AdGroupGuardGroupDraft, indexes: readonly number[]): AdGroupGuardNodeDraft | null {
  let node: AdGroupGuardNodeDraft = root
  for (const i of indexes) {
    if (node.kind !== 'group') return null
    const next: AdGroupGuardNodeDraft | undefined = node.items[i]
    if (!next) return null
    node = next
  }
  return node
}

function mutate(fn: (root: AdGroupGuardDraft) => void) {
  if (props.disabled) return
  const copy = cloneAdGroupGuardDraft(draft.value)
  fn(copy)
  draft.value = copy
  emit('edited')
}

function groupAt(root: AdGroupGuardDraft, indexes: readonly number[]): AdGroupGuardGroupDraft | null {
  const node = nodeAt(root, indexes)
  return node?.kind === 'group' ? node : null
}

const ctx: AggBuilderContext = {
  testid: computed(() => props.testid),
  currency: computed(() => props.currency),
  disabled: computed(() => props.disabled),
  toggleCombine(groupIndexes) {
    mutate((root) => {
      const g = groupAt(root, groupIndexes)
      if (g) g.combine = g.combine === 'and' ? 'or' : 'and'
    })
  },
  setMetric(indexes, metric: AdGroupGuardMetricKey) {
    mutate((root) => {
      const c = nodeAt(root, indexes)
      if (c?.kind !== 'condition' || c.metric === metric) return
      c.metric = metric
      c.value = ''
      c.value2 = ''
    })
  },
  setOp(indexes, op: AdGroupGuardOp) {
    mutate((root) => {
      const c = nodeAt(root, indexes)
      if (c?.kind !== 'condition' || c.op === op) return
      c.op = op
      if (op !== 'between') c.value2 = ''
    })
  },
  setValue(indexes, field, value) {
    mutate((root) => {
      const c = nodeAt(root, indexes)
      if (c?.kind !== 'condition') return
      c[field] = String(value ?? '')
      touched.value = new Set(touched.value).add(c.uid)
    })
  },
  remove(indexes) {
    mutate((root) => {
      const parent = groupAt(root, indexes.slice(0, -1))
      parent?.items.splice(indexes[indexes.length - 1]!, 1)
    })
  },
  addCondition(groupIndexes) {
    mutate((root) => {
      groupAt(root, groupIndexes)?.items.push(newAdGroupGuardCondition())
    })
  },
  addGroup(groupIndexes) {
    mutate((root) => {
      groupAt(root, groupIndexes)?.items.push(newAdGroupGuardGroup())
    })
  },
  rowError(indexes, uid) {
    const sub = aggSubPath(indexes)
    const fromServer = Object.entries(server.value).find(([k]) => k === sub || k.startsWith(`${sub}.`))
    if (fromServer) return fromServer[1]
    if (!touched.value.has(uid) && !props.showErrors) return undefined
    const e = clientErrors.value
    return e[`${sub}.value`] ?? e[`${sub}.value2`] ?? e[`${sub}.metric`] ?? e[`${sub}.op`]
  },
  groupError(indexes) {
    const sub = aggSubPath(indexes)
    const s = server.value
    const own = s[sub] ?? s[`${sub}.combine`] ?? s[`${sub}.items`]
    if (own) return own
    return clientErrors.value[sub]
  }
}
provide(AGG_BUILDER_KEY, ctx)

// ── summary ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const sentence = computed(() => `ปิด ad group เมื่อ ${formatAdGroupGuardDraft(draft.value, props.currency)}`)

const ruleError = computed(() => {
  const s = server.value
  const fromServer = s[''] ?? s.items ?? s.combine
  if (fromServer) return fromServer
  if (parsed.value.rule) return undefined
  if (!draft.value.items.length) return AGG_MESSAGES.items
  if (clientErrors.value['']) return clientErrors.value['']
  return AGG_MESSAGES.incomplete
})

const spendWarn = computed(() => draft.value.items.length > 0 && !adGroupGuardDraftUsesSpend(draft.value))

const jsonOpen = ref(false)
const json = computed(() => JSON.stringify(parsed.value.rule ?? adGroupGuardDraftPreview(draft.value), null, 2))
</script>

<template>
  <div class="@container flex min-w-0 flex-col gap-3" :data-testid="`${testid}-builder`">
    <AdGroupGuardRuleBuilderItems :group="draft" :indexes="[]" :depth="1" />

    <div class="flex flex-wrap gap-2 pl-16">
      <UButton
        label="+ เงื่อนไข"
        color="neutral"
        variant="outline"
        size="xs"
        class="border-dashed"
        :disabled="disabled"
        :data-testid="`${testid}-add`"
        @click="ctx.addCondition([])"
      />
      <UButton
        label="+ วงเล็บ ( )"
        color="neutral"
        variant="outline"
        size="xs"
        class="border-dashed"
        :disabled="disabled"
        :data-testid="`${testid}-add-group`"
        @click="ctx.addGroup([])"
      />
    </div>

    <USeparator />

    <div class="flex flex-col gap-1.5">
      <p class="text-sm break-words text-highlighted" :data-testid="`${testid}-sentence`">
        {{ sentence }}
      </p>
      <p
        v-if="ruleError"
        class="text-xs text-error"
        role="alert"
        :data-testid="`${testid}-error`"
      >
        {{ ruleError }}
      </p>
      <p v-if="spendWarn" class="text-xs text-warning" :data-testid="`${testid}-spend-warn`">
        {{ AGG_MESSAGES.spendWarn }}
      </p>
      <div>
        <UButton
          :label="jsonOpen ? 'ซ่อน JSON' : 'ดู JSON'"
          color="neutral"
          variant="link"
          size="xs"
          class="px-0"
          :aria-expanded="jsonOpen"
          :data-testid="`${testid}-json-toggle`"
          @click="jsonOpen = !jsonOpen"
        />
        <pre
          v-if="jsonOpen"
          class="mt-1 max-h-64 overflow-auto rounded-md bg-elevated p-2 font-mono text-xs text-muted"
          :data-testid="`${testid}-json`"
        >{{ json }}</pre>
      </div>
    </div>
  </div>
</template>
