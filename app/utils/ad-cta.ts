/**
 * Call to action stored on an ad template.
 * The BO shows Thai labels from `/ad-templates/options`. The stored keys are stable.
 * Templates saved before the multi-select (`{ mode: 'dynamic' }` / `{ mode: 'standard', value }`)
 * still list and edit: dynamic means TikTok's pre-checked set, and the old four values map onto
 * the node they always meant (`signUp` was สมัครเลย, `learnMore` was ดูเพิ่มเติม).
 */
import type { OptionItem } from '#shared/types/ad-templates'

/** old `cta.value` → current key */
const LEGACY_CTA_VALUE: Record<string, string> = {
  learnMore: 'viewNow',
  signUp: 'applyNow',
  experienceNow: 'experienceNow',
  interested: 'interested'
}

/** keys to show / edit, from either the current `{ values }` shape or a template saved with `mode` */
export function ctaValuesFrom(cta: unknown, dynamicFallback: readonly string[] = []): string[] {
  if (!cta || typeof cta !== 'object') return []
  const row = cta as { values?: unknown, mode?: unknown, value?: unknown }
  if (Array.isArray(row.values)) return row.values.filter((v): v is string => typeof v === 'string')
  if (row.mode === 'standard' && typeof row.value === 'string') return [LEGACY_CTA_VALUE[row.value] ?? row.value]
  if (row.mode === 'dynamic') return [...dynamicFallback]
  return []
}

/** Thai labels of the selected keys, in the order the keys are stored */
export function ctaSummary(values: readonly string[], items: OptionItem[] | undefined): string {
  return values.map(value => items?.find(item => item.value === value)?.label ?? value).join(', ')
}
