/**
 * FEAT-012 — `/ad-templates` **v1** (apollo-api, function 6.9). Mirrors
 * mission-control/.ai/features/FEAT-012-ad-templates/api-contract.md v1
 * ("Data model", `GET /ad-templates/options`, `GET/POST/PATCH/DELETE /ad-templates`).
 *
 * An ad template records every choice the future auto-ad job (6.2) has to make on the TikTok
 * "โฆษณา" page: the ad name prefix, the Spark identity and which authorized post to pick, which
 * instant page to pick from the library, the platform-consent checkbox, the call to action and the
 * two third-party tracking URLs. Sibling of `ad-group-templates` (6.8) — own collection, own page,
 * same conventions — and completely independent of it (no `adGroupTemplateId`).
 *
 * The BO hard-codes **no** enum label: every human-readable string for a config value comes from
 * `GET /ad-templates/options` (`OptionItem { value, label }`), fetched once per page lifetime and
 * passed to the modals. `catalogVersion` is written by the API and never sent by the BO.
 */

/** One entry of an option list served by `GET /ad-templates/options`. */
export interface OptionItem {
  value: string
  label: string
}

/** Single-valued for now; `custom` may be added later without a migration (spec A3). */
export type AdIdentityMode = 'spark'
/** Single-valued for now; the only supported source is the "โพสต์ที่ได้รับอนุญาต" tab. */
export type AdIdentitySource = 'authorizedPosts'
/** Single-valued for now; a `url` destination may be added later (spec Q5/Q13/Q17). */
export type AdDestinationMode = 'instantPage'
/**
 * One call-to-action in the Ads Manager tree. Stored key is stable; the BO shows the Thai `label`
 * from `/options`. The runner clicks the tree node id that the key maps to.
 */
export type AdCtaValue =
  | 'applyNow'
  | 'interested'
  | 'visitStore'
  | 'watchNow'
  | 'register'
  | 'orderNow'
  | 'checkItOut'
  | 'viewNow'
  | 'readMore'
  | 'learnMore'
  | 'download'
  | 'shopNow'
  | 'contactUs'
  | 'bookNow'
  | 'playGame'
  | 'getQuote'
  | 'installNow'
  | 'getShowtimes'
  | 'listenNow'
  | 'subscribe'
  | 'getTickets'
  | 'experienceNow'
  | 'preorderNow'
  | 'donateNow'
export type AdSelectionMode = 'first' | 'named'

/** `allowOnTiktokPlatforms`: `null` = leave TikTok's own default (spec Q7, same shape as FEAT-011 A3). */
export type TriState = boolean | null

/** `config.identity.post` — discriminated union, strict on the API side; `text` trim 1..100. */
export type AdPostSelection
  = | { selection: 'first' }
    | { selection: 'named', text: string }

/** `config.destination.page` — discriminated union, strict on the API side; `name` trim 1..100. */
export type AdPageSelection
  = | { selection: 'first' }
    | { selection: 'named', name: string }

/** `config.identity` — Spark Ads on the authorized-posts tab, plus which post to pick. */
export interface AdIdentity {
  mode: AdIdentityMode
  source: AdIdentitySource
  post: AdPostSelection
}

/** `config.destination` — an instant page from the library, plus which page to pick. */
export interface AdDestination {
  mode: AdDestinationMode
  page: AdPageSelection
}

/** `config.cta` — the call-to-action texts to leave checked (at least one). */
export interface AdCta {
  values: AdCtaValue[]
}

/** `config.tracking` — both keys required; each `''` → null, else an `http(s)` URL ≤ 2048. */
export interface AdTracking {
  impressionUrl: string | null
  clickUrl: string | null
}

/** The 6 config keys of an ad template (strict on the API side, in `CONFIG_KEYS` order). */
export interface AdConfig {
  /** null = let TikTok auto-name the ad; the job appends the date to the prefix */
  adNamePrefix: string | null
  identity: AdIdentity
  destination: AdDestination
  /** tri-state platform consent: `null` = leave the TikTok checkbox as it is */
  allowOnTiktokPlatforms: TriState
  cta: AdCta
  tracking: AdTracking
}

/** Exact key set of the API's template view (`catalogVersion` after `config`). */
export interface AdTemplate {
  id: string
  name: string
  description: string | null
  config: AdConfig
  /**
   * The catalog version the template was authored against (`advertising/v1`), written by the API on
   * create and on every successful PATCH. `null` only for documents this API never wrote (direct
   * inserts) → the table shows the `Older catalog` badge.
   */
  catalogVersion: string | null
  /** `name` is null when the workspace row is gone */
  workspace: { id: string, name: string | null }
  /** `username` is null when the admin row is gone */
  createdBy: { id: string, username: string | null }
  createdAt: string
  updatedAt: string
}

/** `GET /ad-templates` 200 body — paginated envelope. */
export interface AdTemplatesResponse {
  templates: AdTemplate[]
  page: number
  limit: number
  total: number
}

/** `options.limits` — the API's own numbers, so the BO validates with the same maxima (spec A2). */
export interface AdTemplateLimits {
  /** `identity.post.text` and `destination.page.name` */
  textMaxLength: number
  /** `tracking.impressionUrl` and `tracking.clickUrl` */
  urlMaxLength: number
}

/**
 * `GET /ad-templates/options` 200 body — exactly 11 keys: the 7 label lists plus the BO helpers
 * (`allowOnTiktokPlatformsLabel`, `systemDefault`, `catalogVersion`, `limits`).
 */
export interface AdTemplateOptions {
  /** 1 item (`spark`) — rendered as a one-item radio group, never hard-coded (spec A3) */
  identityMode: OptionItem[]
  /** 1 item (`authorizedPosts`) */
  identitySource: OptionItem[]
  /** `first`, `named` */
  postSelection: OptionItem[]
  /** 1 item (`instantPage`) */
  destinationMode: OptionItem[]
  /** `first`, `named` */
  pageSelection: OptionItem[]
  /** `inherit` ↔ `null`, `on` ↔ `true`, `off` ↔ `false` (spec A4) */
  triState: OptionItem[]
  /** every call-to-action in the Ads Manager dropdown, Thai label, dropdown order */
  ctaValue: OptionItem[]
  /** the long TikTok consent sentence, served so the BO shows it without a Thai literal */
  allowOnTiktokPlatformsLabel: string
  /** TikTok's values on a fresh page — the create form's starting point, never stored */
  systemDefault: AdConfig
  /** the catalog version the API writes on every save (`advertising/v1`) */
  catalogVersion: string
  /** the maxima the BO validates the texts and the two URLs with */
  limits: AdTemplateLimits
}

/** `POST /ad-templates` body — `config` is complete (all 6 keys), never `catalogVersion`. */
export interface CreateAdTemplateBody {
  name: string
  description?: string | null
  config: AdConfig
}

/**
 * `PATCH /ad-templates/:id` body — **only the changed keys**. `config` is a partial at the top
 * level: each present key carries its complete value and replaces the stored one wholesale (no deep
 * merge). `catalogVersion` is never sent (the API rewrites it on every successful PATCH).
 */
export interface PatchAdTemplateBody {
  name?: string
  description?: string | null
  config?: Partial<AdConfig>
}

/** `DELETE /ad-templates/:id` 200 body. */
export interface DeleteAdTemplateResponse {
  ok: boolean
}
