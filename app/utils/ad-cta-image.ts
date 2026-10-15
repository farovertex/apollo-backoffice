/**
 * FEAT-054 — `config.destination.page.buttonImageId` helpers (api-contract v1 §1, §2 · spec "UI behaviour").
 * Mirrors `utils/ad-add-on.ts`'s role (list badge + form-section client text), scaled down to the single id
 * this feature stores: there is no separate blob to parse like `readAdAddOn()` — `buttonImageId` lives inside
 * the `create` page that already carries `buttonText` etc., so the only two pieces the two consumers
 * (`FormModal.vue`, `pages/ad-templates.vue`) need are here.
 *
 * ★ Not to be confused with `utils/ad-cta.ts` (`config.cta` — the call-to-action **of the ad**). This file is
 * the Call-to-Action button **of the instant page** — completely different feature, completely different key.
 */
import type { AdPageSelection } from '#shared/types/ad-templates'

/** the human name of this feature, used by the list badge next to `AD_ADD_ON_LABEL` */
export const BUTTON_IMAGE_LABEL = 'ปุ่มรูปภาพ'

/**
 * Client-side text; the API's own message (contract §1.2 `BUTTON_IMAGE_MESSAGES.*`) replaces it whenever the
 * server answers instead (same precedent as `AD_ADD_ON_MESSAGES`).
 */
export const BUTTON_IMAGE_MESSAGES = {
  /** the radio is on "รูปภาพ" but no image has been picked yet */
  imageRequired: 'เลือกรูปจากคลังก่อน'
} as const

/**
 * `true` ⇔ the stored `create` page has a non-empty `buttonImageId` — read defensively (a `page` of any other
 * selection, or a document saved before this feature, is never "has a button image").
 */
export function hasButtonImage(page: AdPageSelection | null | undefined): boolean {
  if (!page || page.selection !== 'create') return false
  const row = page as Partial<{ buttonImageId: string | null }>
  return typeof row.buttonImageId === 'string' && row.buttonImageId !== ''
}
