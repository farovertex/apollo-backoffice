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
export type AdCtaValue
  = | 'applyNow'
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

/** FEAT-017 — `destination.page.tone` of the new instant page (labels from `/options.instantPageTone`). */
export type AdInstantPageTone = 'light' | 'dark' | 'custom'
/** FEAT-017 — `destination.page.language` of the new instant page (labels from `/options.instantPageLanguage`). */
export type AdInstantPageLanguage = 'th' | 'en'

/** `allowOnTiktokPlatforms`: `null` = leave TikTok's own default (spec Q7, same shape as FEAT-011 A3). */
export type TriState = boolean | null

/**
 * `config.identity.post` **as sent to the API** (FEAT-017 api-contract §2.1, §2.4) — discriminated union,
 * strict on the API side.
 * - `first` / `named` are legacy: still storable, still returned for existing templates, but the form no
 *   longer offers them (a build with them fails at `checking`).
 * - `authCode` carries the **secret** Spark authorization code (trim 1..500). On `POST` the `code` is
 *   required; on `PATCH` sending `{ selection: 'authCode' }` **without** `code` keeps the stored one.
 *   The masked view keys (`hasCode`, `codeLast4`) are never sent back (the API is strict).
 */
export type AdPostSelection
  = | { selection: 'first' }
    | { selection: 'named', text: string }
    | { selection: 'authCode', code?: string }

/**
 * `config.identity.post` **as served by the API** (FEAT-017 api-contract §2.3): the code itself never leaves
 * the API. `codeLast4` = last 4 characters of the stored code, `null` when it is shorter than 5 characters.
 */
export type AdPostSelectionView
  = | { selection: 'first' }
    | { selection: 'named', text: string }
    | { selection: 'authCode', hasCode: boolean, codeLast4: string | null }

/**
 * `config.destination.page` — discriminated union, strict on the API side; `name` trim 1..100.
 * `create` (FEAT-017 api-contract §2.2) describes the instant page the build **creates**: `buttonText`
 * trim 1..`limits.textMaxLength`, `url` `https://` only ≤ `limits.urlMaxLength`.
 * `first` / `named` are legacy (see `AdPostSelection`).
 */
export type AdPageSelection
  = | { selection: 'first' }
    | { selection: 'named', name: string }
    | {
      selection: 'create'
      buttonText: string
      url: string
      tone: AdInstantPageTone
      language: AdInstantPageLanguage
      showHandCursor: boolean
    }

/** `config.identity` as served by the API — Spark Ads on the authorized-posts tab, plus which post to pick. */
export interface AdIdentity {
  mode: AdIdentityMode
  source: AdIdentitySource
  post: AdPostSelectionView
}

/** `config.identity` as sent to the API (the `authCode` request shape instead of the masked view). */
export interface AdIdentityRequest {
  mode: AdIdentityMode
  source: AdIdentitySource
  post: AdPostSelection
}

/** `config.destination` — the instant page the ad points at (library page or a newly created one). */
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

/**
 * The 6 config keys of an ad template **as served by the API** (strict, in `CONFIG_KEYS` order).
 * `identity.post` is the masked view (`AdPostSelectionView`) — the Spark code is never in a response.
 */
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

/** The same 6 keys **as sent to the API** (`identity.post` carries the code, never `hasCode`/`codeLast4`). */
export interface AdConfigRequest extends Omit<AdConfig, 'identity'> {
  identity: AdIdentityRequest
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
  /** `identity.post.text`, `destination.page.name` and `destination.page.buttonText` */
  textMaxLength: number
  /** `tracking.impressionUrl`, `tracking.clickUrl` and `destination.page.url` */
  urlMaxLength: number
}

/**
 * `GET /ad-templates/options` 200 body — exactly 13 keys (FEAT-017 api-contract §2.5): the 9 label lists plus
 * the BO helpers (`allowOnTiktokPlatformsLabel`, `systemDefault`, `catalogVersion`, `limits`).
 */
export interface AdTemplateOptions {
  /** 1 item (`spark`) — rendered as a one-item radio group, never hard-coded (spec A3) */
  identityMode: OptionItem[]
  /** 1 item (`authorizedPosts`) */
  identitySource: OptionItem[]
  /** `first`, `named`, `authCode` (FEAT-017; only `authCode` is offered by the form) */
  postSelection: OptionItem[]
  /** 1 item (`instantPage`) */
  destinationMode: OptionItem[]
  /** `first`, `named`, `create` (FEAT-017; only `create` is offered by the form) */
  pageSelection: OptionItem[]
  /** FEAT-017 — `light`, `dark`, `custom` (the same label rows the build worker clicks in the editor) */
  instantPageTone: OptionItem[]
  /** FEAT-017 — `th`, `en` */
  instantPageLanguage: OptionItem[]
  /** `inherit` ↔ `null`, `on` ↔ `true`, `off` ↔ `false` (spec A4) */
  triState: OptionItem[]
  /** every call-to-action in the Ads Manager dropdown, Thai label, dropdown order */
  ctaValue: OptionItem[]
  /** the long TikTok consent sentence, served so the BO shows it without a Thai literal */
  allowOnTiktokPlatformsLabel: string
  /**
   * TikTok's values on a fresh page — the starting point for everything except the two FEAT-017 unions:
   * it stays `post: first` / `page: first` (spec L-10, a valid shape is required and `authCode` needs a
   * code), and the form seeds `post = authCode` (empty code) + `page = create` (tone `dark`, language `th`,
   * hand cursor on) itself. Never stored.
   */
  systemDefault: AdConfig
  /** the catalog version the API writes on every save (`advertising/v1`) */
  catalogVersion: string
  /** the maxima the BO validates the texts and the two URLs with */
  limits: AdTemplateLimits
}

/**
 * `POST /ad-templates` body — `config` is complete (all 6 keys), never `catalogVersion`.
 * `config.identity.post.code` is required here (FEAT-017 §2.4 "POST always requires `code`").
 */
export interface CreateAdTemplateBody {
  name: string
  description?: string | null
  config: AdConfigRequest
}

/**
 * `PATCH /ad-templates/:id` body — **only the changed keys**. `config` is a partial at the top
 * level: each present key carries its complete value and replaces the stored one wholesale (no deep
 * merge). `catalogVersion` is never sent (the API rewrites it on every successful PATCH).
 * FEAT-017: when `config.identity` is sent for an `authCode` template whose code was **not** retyped, its
 * `post` is `{ selection: 'authCode' }` (no `code`) and the API keeps the stored code (§2.4).
 */
export interface PatchAdTemplateBody {
  name?: string
  description?: string | null
  config?: Partial<AdConfigRequest>
}

/** `DELETE /ad-templates/:id` 200 body. */
export interface DeleteAdTemplateResponse {
  ok: boolean
}
