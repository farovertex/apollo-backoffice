/**
 * FEAT-104 — Lead generation template and order (api-contract v1 §1.1, §2.1, §3).
 *
 * The one place the BO decides "is this a Sales or a Lead generation thing?" for an ad group template, an ad
 * template, an order and a launch advertiser. The API owns every label of a config value (`/options`); the texts
 * here are page chrome (badges, reasons, the campaign line that used to be the hard-coded "Sales cashback").
 */
import type { AdGroupConfig, AdGroupObjective, AdGroupTemplate } from '#shared/types/ad-group-templates'
import type { AdConfig, AdDestinationMode, AdTemplate } from '#shared/types/ad-templates'
import type { CampaignPreset, LaunchPixel } from '#shared/types/campaign-orders'

export const OBJECTIVE_SALES = 'sales'
export const OBJECTIVE_LEAD = 'leadGeneration'
export const DESTINATION_INSTANT_PAGE = 'instantPage'
export const DESTINATION_URL = 'url'

/**
 * The contract's `objectiveOf(config)`: `leadGeneration` when `config.campaign.objective === 'leadGeneration'`,
 * `sales` for everything else (missing key, missing block, an old row).
 */
export function objectiveOfConfig(config: Partial<AdGroupConfig> | null | undefined): AdGroupObjective {
  return config?.campaign?.objective === OBJECTIVE_LEAD ? OBJECTIVE_LEAD : OBJECTIVE_SALES
}

/** the view's own `objective` when the API serves it, else derived from the config (an older API) */
export function objectiveOfTemplate(template: Pick<AdGroupTemplate, 'objective' | 'config'> | null | undefined): AdGroupObjective {
  if (!template) return OBJECTIVE_SALES
  if (template.objective === OBJECTIVE_LEAD || template.objective === OBJECTIVE_SALES) return template.objective
  return objectiveOfConfig(template.config)
}

/** `config.destination.mode` of an ad template; anything but `url` reads as `instantPage` */
export function destinationOfConfig(config: Partial<AdConfig> | null | undefined): AdDestinationMode {
  return config?.destination?.mode === DESTINATION_URL ? DESTINATION_URL : DESTINATION_INSTANT_PAGE
}

export function destinationOfTemplate(template: Pick<AdTemplate, 'config'> | null | undefined): AdDestinationMode {
  return destinationOfConfig(template?.config)
}

/** the destination an ad group objective pairs with (decision 3: lead ↔ url, sales ↔ instantPage) */
export function destinationFor(objective: AdGroupObjective): AdDestinationMode {
  return objective === OBJECTIVE_LEAD ? DESTINATION_URL : DESTINATION_INSTANT_PAGE
}

// ── badges (page chrome — the long Thai labels of `/options` stay in the forms and filters) ─────────────────────
export const OBJECTIVE_BADGE: Readonly<Record<AdGroupObjective, string>> = {
  sales: 'Sales',
  leadGeneration: 'Lead generation'
}

export const DESTINATION_BADGE: Readonly<Record<AdDestinationMode, string>> = {
  instantPage: 'Instant Page',
  url: 'Website URL'
}

export function objectiveBadgeColor(objective: AdGroupObjective): 'info' | 'success' {
  return objective === OBJECTIVE_LEAD ? 'success' : 'info'
}

export function destinationBadgeColor(mode: AdDestinationMode): 'info' | 'success' {
  return mode === DESTINATION_URL ? 'success' : 'info'
}

/** the ad-templates list's "Destination" text of a `url` template (brief: "ลิงก์ของ pixel") */
export const URL_DESTINATION_TEXT = 'ลิงก์ของ pixel'

// ── launch pairing reasons (mock "ล้อ BO จริง", `agtWhy` / `adtWhy`) ──────────────────────────────────────────────
export const PAIRING_REASON = {
  /** an ad group card, when the selected ad template is of the other kind */
  agtNeedsSales: 'ad template ที่เลือกเป็นอินสแตนท์เพจ ใช้กับ Sales เท่านั้น',
  agtNeedsLead: 'ad template ที่เลือกเป็นเว็บไซต์ ใช้กับ Lead generation เท่านั้น',
  /** an ad template card, when the selected ad group template is of the other kind */
  adtNeedsUrl: 'ad group แบบ Lead generation ใช้ได้กับ ad template แบบเว็บไซต์เท่านั้น',
  adtNeedsInstantPage: 'ad group แบบ Sales ใช้ได้กับ ad template แบบอินสแตนท์เพจเท่านั้น',
  /** a lead ad group card, when a selected advertiser has no linked pixel */
  noPixel: (names: string[]) =>
    `advertiser ${names.join(', ')} ยังไม่ได้ link กับ pixel ตัวไหนเลย — link ที่หน้า Pixel ก่อน หรือเอาบัญชีนั้นออก`
} as const

// ── the campaign line (Summary / Review / orders) ────────────────────────────────────────────────────────────────
/** what used to be the hard-coded "Sales cashback → Website conversions" */
export const CAMPAIGN_LINE: Readonly<Record<AdGroupObjective, string>> = {
  sales: 'Sales cashback → Website conversions',
  leadGeneration: 'Lead generation → Website engagements'
}

/** the order's objective, from `campaignPreset.objective` (never from the config snapshot) */
export function objectiveOfPreset(preset: CampaignPreset | { objective?: string } | null | undefined): AdGroupObjective {
  return preset?.objective === OBJECTIVE_LEAD ? OBJECTIVE_LEAD : OBJECTIVE_SALES
}

export function campaignLineOfPreset(preset: CampaignPreset | { objective?: string } | null | undefined): string {
  return CAMPAIGN_LINE[objectiveOfPreset(preset)]
}

/** decision 18 — shown in Review before a Lead generation order is created */
export const LEAD_BUILD_WARNING
  = 'order แบบ Lead generation: จนกว่า worker ทาง Lead (FEAT-B) จะเสร็จ build จะจบทันทีด้วย "lead generation build is not supported yet" (สถานะ Failed) — สร้าง order ได้ตามปกติ'

// ── pixels ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** `name …AB12` — never the full pixel code (the API does not serve it) */
export function pixelLabel(pixel: { name: string, pixelCodeLast4: string | null | undefined }): string {
  const last4 = pixel.pixelCodeLast4 ? ` …${pixel.pixelCodeLast4}` : ''
  return `${pixel.name}${last4}`
}

/** step 1's label per advertiser: none / the name / "n pixels"; `null` = the API served no list (older API) */
export function pixelCountLabel(pixels: LaunchPixel[] | undefined): string | null {
  if (!pixels) return null
  if (pixels.length === 0) return 'ยังไม่ link pixel'
  if (pixels.length === 1) return `pixel ${pixels[0]!.name}`
  return `${pixels.length} pixels`
}

/** the default pixel of an advertiser (`isDefault`, else the first — the list is already sorted by the API) */
export function defaultPixelOf(pixels: LaunchPixel[] | undefined): LaunchPixel | null {
  if (!pixels?.length) return null
  return pixels.find(pixel => pixel.isDefault) ?? pixels[0] ?? null
}
