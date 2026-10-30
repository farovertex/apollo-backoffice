<script setup lang="ts">
/**
 * FEAT-087 (spec "UI behaviour" §1) — the items of one group of the rule builder, rendered recursively: a condition
 * row `<p>-row[data-path]` or a group box `<p>-group[data-path]` per item. The left column (64px at the root, 56px
 * inside a group) holds `เมื่อ` (`<p>-first`, first root item only), nothing (first item of a nested group) or the
 * connector pill `<p>-conn[data-path][data-value]` of **this** group — clicking any pill flips the group's combine.
 * Every edit goes to the owning `RuleBuilder.vue` through the injected context.
 */
import type { AdGroupGuardMetricKey, AdGroupGuardOp } from '#shared/types/ad-group-guard'
import type { AdGroupGuardGroupDraft } from '~/utils/ad-group-guard'
import { AGG_BUILDER_KEY } from '~/utils/ad-group-guard-builder'

const props = defineProps<{
  group: AdGroupGuardGroupDraft
  /** index path of `group` from the root (`[]` = root) */
  indexes: number[]
  /** level of `group` (root = 1) */
  depth: number
}>()

const ctx = inject(AGG_BUILDER_KEY)!
const p = computed(() => ctx.testid.value)
const isRoot = computed(() => props.depth === 1)

const metricItems = AGG_METRICS.map(m => ({ label: m.label, value: m.key }))
const opItems = AGG_OPS.map(o => ({ label: o.label, value: o.key }))

function at(i: number): number[] {
  return [...props.indexes, i]
}

function unit(metric: AdGroupGuardMetricKey): string {
  return adGroupGuardUnitLabel(metric, ctx.currency.value)
}

/** `สกุลของบัญชี` (no / mixed currency) does not fit the default trailing padding — widen the input and its padding */
function longUnit(metric: AdGroupGuardMetricKey): boolean {
  return unit(metric).length > 4
}

function valueUi(metric: AdGroupGuardMetricKey) {
  return longUnit(metric) ? { base: 'pe-20' } : undefined
}

function inputMode(metric: AdGroupGuardMetricKey): 'numeric' | 'decimal' {
  return AGG_METRIC_BY_KEY[metric]?.kind === 'integer' ? 'numeric' : 'decimal'
}
</script>

<template>
  <div class="flex min-w-0 flex-col gap-2">
    <template v-for="(item, i) in group.items" :key="item.uid">
      <!-- ── condition row ─────────────────────────────────────────────────────────── -->
      <div
        v-if="item.kind === 'condition'"
        class="flex min-w-0 items-start gap-2"
        :data-testid="`${p}-row`"
        :data-path="aggDataPath(at(i))"
        :data-metric="item.metric"
        :data-op="item.op"
      >
        <div class="flex shrink-0 justify-start pt-1" :class="isRoot ? 'w-16' : 'w-14'">
          <span v-if="i === 0 && isRoot" class="pt-0.5 text-sm font-medium text-muted" :data-testid="`${p}-first`">เมื่อ</span>
          <UButton
            v-else-if="i > 0"
            :label="AGG_COMBINE_LABEL[group.combine]"
            :color="group.combine === 'and' ? 'primary' : 'warning'"
            variant="solid"
            size="xs"
            class="rounded-full px-2.5"
            role="switch"
            :aria-checked="group.combine === 'and'"
            :aria-label="`เชื่อมด้วย ${AGG_COMBINE_LABEL[group.combine]} — กดเพื่อสลับ`"
            :disabled="ctx.disabled.value"
            :data-testid="`${p}-conn`"
            :data-path="aggDataPath(at(i))"
            :data-value="group.combine"
            @click="ctx.toggleCombine(indexes)"
          />
        </div>
        <div class="@container flex min-w-0 flex-1 flex-col gap-1">
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <USelect
              :model-value="item.metric"
              :items="metricItems"
              aria-label="ตัวแปร"
              class="w-full @sm:w-32 @md:w-40 @lg:w-52"
              :disabled="ctx.disabled.value"
              :data-testid="`${p}-metric`"
              @update:model-value="ctx.setMetric(at(i), $event as AdGroupGuardMetricKey)"
            />
            <USelect
              :model-value="item.op"
              :items="opItems"
              aria-label="เงื่อนไข"
              class="w-full shrink-0 @min-[13.5rem]:w-30 @lg:w-32"
              :disabled="ctx.disabled.value"
              :data-testid="`${p}-op`"
              @update:model-value="ctx.setOp(at(i), $event as AdGroupGuardOp)"
            />
            <UInput
              :model-value="item.value"
              type="text"
              :inputmode="inputMode(item.metric)"
              autocomplete="off"
              placeholder="0"
              aria-label="ค่า"
              class="flex-1"
              :class="longUnit(item.metric) ? 'min-w-36 basis-36 @sm:max-w-52' : 'min-w-16 basis-16 @sm:max-w-40'"
              :ui="valueUi(item.metric)"
              :disabled="ctx.disabled.value"
              :data-testid="`${p}-value`"
              @update:model-value="ctx.setValue(at(i), 'value', $event)"
            >
              <template v-if="unit(item.metric)" #trailing>
                <span class="text-xs text-muted" :data-testid="`${p}-unit`">{{ unit(item.metric) }}</span>
              </template>
            </UInput>
            <div
              v-if="item.op === 'between'"
              class="flex min-w-0 flex-1 items-center gap-2"
              :class="longUnit(item.metric) ? 'basis-44 @sm:max-w-60' : 'basis-32 @sm:max-w-48'"
            >
              <span class="shrink-0 text-sm text-muted">ถึง</span>
              <UInput
                :model-value="item.value2"
                type="text"
                :inputmode="inputMode(item.metric)"
                autocomplete="off"
                placeholder="0"
                aria-label="ค่าที่สอง"
                class="flex-1"
                :class="longUnit(item.metric) ? 'min-w-36' : 'min-w-16'"
                :ui="valueUi(item.metric)"
                :disabled="ctx.disabled.value"
                :data-testid="`${p}-value2`"
                @update:model-value="ctx.setValue(at(i), 'value2', $event)"
              >
                <template v-if="unit(item.metric)" #trailing>
                  <span class="text-xs text-muted" :data-testid="`${p}-unit2`">{{ unit(item.metric) }}</span>
                </template>
              </UInput>
            </div>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              class="shrink-0"
              aria-label="ลบเงื่อนไข"
              :disabled="ctx.disabled.value"
              :data-testid="`${p}-remove`"
              @click="ctx.remove(at(i))"
            />
          </div>
          <p
            v-if="ctx.rowError(at(i), item.uid)"
            class="text-xs text-error"
            role="alert"
            :data-testid="`${p}-row-error`"
          >
            {{ ctx.rowError(at(i), item.uid) }}
          </p>
        </div>
      </div>

      <!-- ── group box ( … ) ───────────────────────────────────────────────────────── -->
      <div
        v-else
        class="flex min-w-0 items-start gap-2"
        :data-testid="`${p}-group`"
        :data-path="aggDataPath(at(i))"
        :data-combine="item.combine"
      >
        <div class="flex shrink-0 justify-start pt-1" :class="isRoot ? 'w-16' : 'w-14'">
          <span v-if="i === 0 && isRoot" class="pt-0.5 text-sm font-medium text-muted" :data-testid="`${p}-first`">เมื่อ</span>
          <UButton
            v-else-if="i > 0"
            :label="AGG_COMBINE_LABEL[group.combine]"
            :color="group.combine === 'and' ? 'primary' : 'warning'"
            variant="solid"
            size="xs"
            class="rounded-full px-2.5"
            role="switch"
            :aria-checked="group.combine === 'and'"
            :aria-label="`เชื่อมด้วย ${AGG_COMBINE_LABEL[group.combine]} — กดเพื่อสลับ`"
            :disabled="ctx.disabled.value"
            :data-testid="`${p}-conn`"
            :data-path="aggDataPath(at(i))"
            :data-value="group.combine"
            @click="ctx.toggleCombine(indexes)"
          />
        </div>
        <div class="flex min-w-0 flex-1 flex-col gap-2 rounded-md border-l-4 border-primary bg-elevated/50 p-2">
          <div class="flex items-center justify-between gap-2">
            <span class="text-xs font-medium text-muted">วงเล็บ ( … )</span>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              size="xs"
              aria-label="ลบวงเล็บ"
              :disabled="ctx.disabled.value"
              :data-testid="`${p}-group-remove`"
              @click="ctx.remove(at(i))"
            />
          </div>
          <AdGroupGuardRuleBuilderItems
            v-if="item.items.length"
            :group="item"
            :indexes="at(i)"
            :depth="depth + 1"
          />
          <p v-else class="text-xs text-error" :data-testid="`${p}-group-empty`">
            {{ AGG_MESSAGES.groupEmpty }}
          </p>
          <p
            v-if="ctx.groupError(at(i)) && ctx.groupError(at(i)) !== AGG_MESSAGES.items"
            class="text-xs text-error"
            role="alert"
            :data-testid="`${p}-group-error`"
          >
            {{ ctx.groupError(at(i)) }}
          </p>
          <div class="flex flex-wrap gap-2">
            <UButton
              label="+ เงื่อนไข"
              color="neutral"
              variant="outline"
              size="xs"
              class="border-dashed"
              :disabled="ctx.disabled.value"
              :data-testid="`${p}-group-add`"
              @click="ctx.addCondition(at(i))"
            />
            <UButton
              v-if="depth + 1 < AGG_MAX_DEPTH"
              label="+ วงเล็บ ( )"
              color="neutral"
              variant="outline"
              size="xs"
              class="border-dashed"
              :disabled="ctx.disabled.value"
              :data-testid="`${p}-group-add-group`"
              @click="ctx.addGroup(at(i))"
            />
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
