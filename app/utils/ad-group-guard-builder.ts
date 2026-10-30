/**
 * FEAT-087 — the contract between `RuleBuilder.vue` (owns the draft) and the recursive `RuleBuilderItems.vue`
 * (renders rows / groups). Nodes are addressed by their index path from the root (`[1, 0]`).
 */
import type { ComputedRef, InjectionKey } from 'vue'
import type { AdGroupGuardMetricKey, AdGroupGuardOp } from '#shared/types/ad-group-guard'

export interface AggBuilderContext {
  testid: ComputedRef<string>
  currency: ComputedRef<string | null>
  disabled: ComputedRef<boolean>
  /** flip the `combine` of the group at `groupIndexes` (`[]` = root) — every pill of that group flips */
  toggleCombine: (groupIndexes: readonly number[]) => void
  /** changing the metric clears `value` / `value2` */
  setMetric: (indexes: readonly number[], metric: AdGroupGuardMetricKey) => void
  /** leaving `between` clears `value2` */
  setOp: (indexes: readonly number[], op: AdGroupGuardOp) => void
  setValue: (indexes: readonly number[], field: 'value' | 'value2', value: string | number) => void
  remove: (indexes: readonly number[]) => void
  addCondition: (groupIndexes: readonly number[]) => void
  addGroup: (groupIndexes: readonly number[]) => void
  /** the message under a condition row (server first, then client once touched / showErrors) */
  rowError: (indexes: readonly number[], uid: string) => string | undefined
  /** a message about a nested group itself (server, or the client depth rule) */
  groupError: (indexes: readonly number[]) => string | undefined
}

export const AGG_BUILDER_KEY: InjectionKey<AggBuilderContext> = Symbol('agg-builder')
