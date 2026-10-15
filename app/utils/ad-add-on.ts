/**
 * FEAT-050 — `config.addOn` helpers (api-contract v1 §1, spec "UI behaviour").
 *
 * Three surfaces read an add-on: the form (`ad-templates/FormModal.vue`), the template list
 * (`pages/ad-templates.vue`) and the order detail (`pages/orders/[id].vue`, from the order's own **snapshot**,
 * which is a Mixed blob written by an earlier catalog version). They all go through `readAdAddOn()`, so
 * "what counts as an add-on" is decided once and in the same way the API's `planAd()` decides it: the four keys,
 * the literal type, an id string, both numbers integral and inside their range. Anything else — `null`, absent,
 * a half-written blob — is "no add-on", never a crash and never a half-rendered row.
 *
 * The range texts mirror the API's own messages (`ADD_ON_MESSAGES` of `ad-templates.dto.ts`, contract §1), so a
 * client refusal and a server refusal read the same; the API's text wins whenever it answers.
 */
import type { AdAddOn } from '#shared/types/ad-templates'

/** the only add-on type in v1 (contract §1) */
export const AD_ADD_ON_TYPE = 'displayCard'

/** `zoomClicks` int −5…5 · `+n` = zoom in n times, `−n` = zoom out, `0` = do not press */
export const AD_ADD_ON_ZOOM_MIN = -5
export const AD_ADD_ON_ZOOM_MAX = 5

/** `displaySeconds` int 2…10 */
export const AD_ADD_ON_SECONDS_MIN = 2
export const AD_ADD_ON_SECONDS_MAX = 10

/** the form's starting values once the switch goes on (spec "Data": form default `0` / `2`) */
export const AD_ADD_ON_ZOOM_DEFAULT = 0
export const AD_ADD_ON_SECONDS_DEFAULT = AD_ADD_ON_SECONDS_MIN

/** client-side texts; the API's own message replaces them whenever the server answers (spec "UI behaviour") */
export const AD_ADD_ON_MESSAGES = {
  /** the switch is on but no image has been picked yet */
  imageRequired: 'เลือกรูปจากคลังก่อน',
  zoomRange: `zoomClicks ต้องเป็นจำนวนเต็มระหว่าง ${AD_ADD_ON_ZOOM_MIN} ถึง ${AD_ADD_ON_ZOOM_MAX}`,
  secondsRange: `displaySeconds ต้องเป็นจำนวนเต็มระหว่าง ${AD_ADD_ON_SECONDS_MIN} ถึง ${AD_ADD_ON_SECONDS_MAX}`
} as const

/** the human name of the add-on, used by the list badge and the order-detail row */
export const AD_ADD_ON_LABEL = 'บัตรดิสเพลย์'

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * The add-on a reader may rely on, or `null`. Same defensive rule as the API's `planAd()` (contract §4): a blob
 * that does not pass every check is treated as "no add-on" instead of being rendered half-way.
 */
export function readAdAddOn(value: unknown): AdAddOn | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<AdAddOn>
  if (row.type !== AD_ADD_ON_TYPE) return null
  if (typeof row.imageId !== 'string' || row.imageId === '') return null
  if (!isIntInRange(row.zoomClicks, AD_ADD_ON_ZOOM_MIN, AD_ADD_ON_ZOOM_MAX)) return null
  if (!isIntInRange(row.displaySeconds, AD_ADD_ON_SECONDS_MIN, AD_ADD_ON_SECONDS_MAX)) return null
  return {
    type: row.type,
    imageId: row.imageId,
    zoomClicks: row.zoomClicks,
    displaySeconds: row.displaySeconds
  }
}

/** `ไม่ซูม` · `zoom +2` · `zoom −2` (U+2212, spec "Order detail") */
export function adAddOnZoomText(zoomClicks: number): string {
  if (!Number.isFinite(zoomClicks) || zoomClicks === 0) return 'ไม่ซูม'
  return zoomClicks > 0 ? `zoom +${zoomClicks}` : `zoom −${Math.abs(zoomClicks)}`
}

/** `บัตรดิสเพลย์ · 5 วิ · zoom +1` — the one line the order detail shows next to the thumbnail */
export function adAddOnSummaryText(addOn: AdAddOn): string {
  return `${AD_ADD_ON_LABEL} · ${addOn.displaySeconds} วิ · ${adAddOnZoomText(addOn.zoomClicks)}`
}
