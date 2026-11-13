<script setup lang="ts">
/**
 * FEAT-101 M2 reopen (B2r; contract v1.6 §3.4 "Per-block style override", AC-45) — the "รูปแบบ" section of a block form.
 *
 * Keys = the page's `theme.blocks.<kind>` defaults (the parent passes them, `mssgStyleDefaults`), minus `units`. Each key
 * shows the block's override or, greyed, the page's value; colour → picker + hex, number → number input, `linkMode` /
 * `messengersMode` → select, other text → text, boolean → switch; "ใช้ค่าตามหน้า" sets the key to `null` (= removed).
 * Emits `update` with the keys touched in this form (value or `null`) and whether every touched key is valid — an
 * invalid value stays in its field with its message and the block form sends nothing while it is there.
 * No defaults for the kind on this page → "ไม่มีรูปแบบให้ปรับ".
 * Test ids: `me-block-style` (wrapper, `data-kind` = lower camel kind, `data-keys`), `me-block-style-<key>` (the input /
 * select / switch; `data-overridden`), `me-block-style-reset-<key>`, `me-block-style-error-<key>`, `me-block-style-empty`.
 */
import type { MssgStyleKeyDef } from '~/utils/mssg-style'

const props = withDefaults(defineProps<{
  kind: string
  /** the page's defaults of the kind (without `units`), `null` = none */
  defaults: Record<string, unknown> | null
  /** the block's `fields` when the form opened (its current override) */
  fields: Record<string, unknown>
  readOnly?: boolean
  /** server messages by style key */
  errors?: Record<string, string>
}>(), { readOnly: false, errors: () => ({}) })

const emit = defineEmits<{ update: [payload: { touched: Record<string, unknown>, valid: boolean }] }>()

const defs = computed(() => mssgStyleKeys(props.defaults))
const initial = mssgStyleOverride(props.fields, props.kind)
/** current override per key (`undefined` / `null` = the page's value) */
const values = reactive<Record<string, unknown>>({ ...initial })
/** what the colour / number inputs show (an invalid text stays visible) */
const texts = reactive<Record<string, string>>({})
const touched = reactive<Record<string, true>>({})
const localErrors = reactive<Record<string, string>>({})

function textOf(key: string): string {
  if (key in texts) return texts[key]!
  const v = values[key]
  return v === null || v === undefined ? '' : String(v)
}
function overridden(key: string): boolean {
  return values[key] !== null && values[key] !== undefined
}
function shown(def: MssgStyleKeyDef): unknown {
  return overridden(def.key) ? values[def.key] : def.default
}

function publish() {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(touched)) out[key] = values[key] ?? null
  emit('update', { touched: out, valid: !Object.keys(localErrors).length })
}

function set(def: MssgStyleKeyDef, value: unknown, text?: string) {
  if (props.readOnly) return
  touched[def.key] = true
  if (text !== undefined) texts[def.key] = text
  const issue = mssgStyleValueIssue(def, value)
  if (issue) {
    localErrors[def.key] = issue
  } else {
    Reflect.deleteProperty(localErrors, def.key)
    values[def.key] = value
  }
  publish()
}

function onColorText(def: MssgStyleKeyDef, raw: string) {
  const t = raw.trim()
  if (t === '') return reset(def)
  set(def, t.toUpperCase(), t)
}
function onColorPick(def: MssgStyleKeyDef, v: string) {
  set(def, v.toUpperCase(), v.toUpperCase())
}
function onNumber(def: MssgStyleKeyDef, raw: string) {
  const t = raw.trim()
  if (t === '') return reset(def)
  set(def, /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : Number.NaN, t)
}
function reset(def: MssgStyleKeyDef) {
  if (props.readOnly) return
  touched[def.key] = true
  Reflect.deleteProperty(texts, def.key)
  Reflect.deleteProperty(localErrors, def.key)
  values[def.key] = null
  publish()
}

function pickerValue(def: MssgStyleKeyDef): string {
  const v = shown(def)
  return typeof v === 'string' && /^#[0-9A-Fa-f]{6}/.test(v) ? v.slice(0, 7) : '#000000'
}
function modeItems(def: MssgStyleKeyDef) {
  return (def.options ?? []).map(o => ({ label: MSSG_MODE_LABEL[o] ?? o, value: o }))
}
const message = (key: string) => localErrors[key] ?? props.errors?.[key] ?? null
const kindKey = computed(() => mssgStyleKindKey(props.kind))
</script>

<template>
  <fieldset
    class="flex min-w-0 flex-col gap-3 rounded-md border border-default p-2.5"
    data-testid="me-block-style"
    :data-kind="kindKey"
    :data-keys="defs.map(d => d.key).join(',')"
    :disabled="readOnly"
  >
    <legend class="px-1 text-xs font-medium text-default">
      รูปแบบ (Style) · ต่างจากหน้านี้ได้เฉพาะ block นี้
    </legend>
    <p v-if="!defs.length" class="text-xs text-muted" data-testid="me-block-style-empty">
      ไม่มีรูปแบบให้ปรับ · หน้านี้ไม่มีค่าตั้งต้นของ block ชนิดนี้จาก mssg
    </p>
    <div v-else class="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <div v-for="def in defs" :key="def.key" class="flex min-w-0 flex-col gap-1">
        <div class="flex flex-wrap items-baseline justify-between gap-x-2">
          <span class="text-sm text-default">{{ def.label }}</span>
          <span class="text-[11px] text-dimmed">{{ overridden(def.key) ? 'ตั้งเฉพาะ block นี้' : `ตามหน้า: ${mssgValueText(def.default)}` }}</span>
        </div>
        <div class="flex min-w-0 items-center gap-2">
          <template v-if="def.control === 'color'">
            <input
              type="color"
              :value="pickerValue(def)"
              :disabled="readOnly"
              :aria-label="`เลือก${def.label}`"
              class="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-default bg-default p-0.5 disabled:cursor-not-allowed disabled:opacity-60"
              :data-testid="`me-block-style-${def.key}-picker`"
              @input="onColorPick(def, ($event.target as HTMLInputElement).value)"
            >
            <UInput
              :model-value="textOf(def.key)"
              :placeholder="typeof def.default === 'string' ? def.default : '#RRGGBB'"
              maxlength="9"
              autocomplete="off"
              spellcheck="false"
              :disabled="readOnly"
              class="min-w-0 flex-1"
              :data-testid="`me-block-style-${def.key}`"
              :data-overridden="overridden(def.key) ? 'true' : 'false'"
              @update:model-value="onColorText(def, String($event ?? ''))"
            />
          </template>
          <UInput
            v-else-if="def.control === 'number'"
            :model-value="textOf(def.key)"
            type="text"
            inputmode="decimal"
            :placeholder="String(def.default ?? '')"
            :disabled="readOnly"
            class="min-w-0 flex-1"
            :data-testid="`me-block-style-${def.key}`"
            :data-overridden="overridden(def.key) ? 'true' : 'false'"
            @update:model-value="onNumber(def, String($event ?? ''))"
          />
          <USelect
            v-else-if="def.control === 'mode'"
            :model-value="overridden(def.key) ? String(values[def.key]) : undefined"
            :items="modeItems(def)"
            :placeholder="`ตามหน้า (${MSSG_MODE_LABEL[String(def.default)] ?? def.default})`"
            :disabled="readOnly"
            class="min-w-0 flex-1"
            :data-testid="`me-block-style-${def.key}`"
            :data-overridden="overridden(def.key) ? 'true' : 'false'"
            @update:model-value="set(def, String($event))"
          />
          <USwitch
            v-else-if="def.control === 'boolean'"
            :model-value="!!shown(def)"
            :disabled="readOnly"
            :aria-label="def.label"
            :data-testid="`me-block-style-${def.key}`"
            :data-overridden="overridden(def.key) ? 'true' : 'false'"
            @update:model-value="set(def, !!$event)"
          />
          <UInput
            v-else
            :model-value="textOf(def.key)"
            :placeholder="String(def.default ?? '')"
            maxlength="100"
            :disabled="readOnly"
            class="min-w-0 flex-1"
            :data-testid="`me-block-style-${def.key}`"
            :data-overridden="overridden(def.key) ? 'true' : 'false'"
            @update:model-value="set(def, String($event ?? ''), String($event ?? ''))"
          />
          <UButton
            label="ใช้ค่าตามหน้า"
            color="neutral"
            variant="link"
            size="xs"
            class="shrink-0"
            :disabled="readOnly || (!overridden(def.key) && !(def.key in texts))"
            :data-testid="`me-block-style-reset-${def.key}`"
            @click="reset(def)"
          />
        </div>
        <span v-if="message(def.key)" class="text-xs text-error" :data-testid="`me-block-style-error-${def.key}`">{{ message(def.key) }}</span>
      </div>
    </div>
  </fieldset>
</template>
