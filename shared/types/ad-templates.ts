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
 *
 * **FEAT-042** (api-contract v1 §1, §2) adds the 10th view key `postInfo`: what TikTok says the Spark post
 * code points at (owner, caption, video/images, validity window, cover). It is written by the API and the
 * worker only — the BO never sends it (a strict schema would answer 400) — and it is read in three places:
 * the post section of `FormModal.vue`, the "โพสต์" column of `pages/ad-templates.vue` and the ad-template
 * cards of `pages/launch-ads.vue`. The cover bytes come from `GET /ad-templates/:id/cover`
 * (`AdTemplateCover`), which the BO requests **only** while `postInfo.cover.ok === true`.
 *
 * **FEAT-054** (api-contract v1 §1, §2) — the instant page's own Call-to-Action button (`config.destination.
 * page.buttonImageId`, not to be confused with `config.cta` — the ad's own call-to-action) can be an image
 * from the media library instead of text. The view's 12th key `buttonImage` is the resolved image, the exact
 * same 5-key shape as `addOnImage`. `FormModal.vue`'s instant-page part offers a ข้อความ/รูปภาพ radio; the list
 * badge `adt-cta-image-badge` lives next to `adt-addon-badge` (`utils/ad-cta-image.ts`).
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
 * `config.identity.post` **as served by the API**.
 * Ad-template views and campaign-order detail include the stored Spark `code`.
 * The masked shape (`hasCode` / `codeLast4`) is only for an older response.
 */
export type AdPostSelectionView
  = | { selection: 'first' }
    | { selection: 'named', text: string }
    | { selection: 'authCode', code: string }
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
      /**
       * FEAT-054 (api-contract v1 §1.1) — the instant page's Call-to-Action button: `null` = text
       * (`buttonText`, unchanged), a 24-hex id = an image from the media library (`mediaAssets._id`,
       * `assetType: 'call-action'`). Stored as the string it was sent as, never cast to `ObjectId`.
       * **Optional**: a template saved before this feature has no such key at all (no migration) — every
       * reader treats absence the same as `null`.
       */
      buttonImageId?: string | null
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
 * FEAT-038 — `config.utm` **as sent to the API** (api-contract §2.1 `utmRefBodySchema`): the four strings the
 * admin picked/typed. The three ids are filled in by the API after it proved the set exists in the 3rd-party
 * UTM system, and are **never** sent back (the body is strict).
 */
export interface UtmRefBody {
  /** one of `options.utmPrefixes` (exact, case-sensitive) — becomes part of the 3rd-party host */
  prefix: string
  source: string
  medium: string
  campaign: string
}

/**
 * FEAT-038 — `config.utm` **as served by the API** (api-contract §1 `UtmRef`): the four strings plus the ids
 * the 3rd-party `utmList` answered with. Display-only in the BO (`adt-utm-ids`).
 * A template saved **before** this feature has no `utm` key at all (F2/AS-2) → read as `null`.
 */
export interface UtmRef extends UtmRefBody {
  sourceId: string
  mediumId: string
  campaignId: string
}

/**
 * FEAT-050 — the only interactive add-on v1 supports (`บัตรดิสเพลย์`, api-contract §1). The literal is part of
 * the stored blob, so a later add-on type is additive on both sides.
 */
export type AdAddOnType = 'displayCard'

/**
 * FEAT-050 — `config.addOn` (api-contract §1): `null` = no add-on, else **exactly** these four keys (the API is
 * strict and requires all four). `imageId` is an id of the FEAT-049 media library — never a URL — and is stored
 * and served as the string it was sent as, so the BO can PATCH the same blob back.
 * `zoomClicks`: int −5…5 (`+n` = press zoom-in n times, `−n` = zoom-out, `0` = do not press).
 * `displaySeconds`: int 2…10.
 */
export interface AdAddOn {
  type: AdAddOnType
  imageId: string
  zoomClicks: number
  displaySeconds: number
}

/**
 * FEAT-050 — `addOnImage` (api-contract §2): the resolved media row of `config.addOn.imageId`, **next to**
 * `config` and never part of it (the BO must never send it back — the API is strict). `null` whenever there is
 * no add-on, the media row is gone or the URL could not be signed; the endpoint still answers 200 in all three
 * cases. `url` follows FEAT-049's rule, so the `src` of an `<img>` always goes through `utils/media.ts#mediaSrc`.
 */
export interface AdAddOnImage {
  id: string
  name: string
  width: number
  height: number
  url: string
}

/**
 * The 9 config keys of an ad template **as served by the API** (strict, in `CONFIG_KEYS` order).
 * `identity.post` of an `authCode` template includes the stored Spark `code`.
 * FEAT-038: `utm` is the 7th key — optional in this type because a document saved before that feature has no
 * such key (F2); every reader treats a missing key as `null`. FEAT-050 adds `addOn` as the 8th key under the
 * same rule (api-contract §1 rule 1), FEAT-061 `adTexts` as the 9th (absent = `[]`).
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
  /** FEAT-038 — the UTM set the ad's sign-up link counts under; `null` / absent = not bound */
  utm?: UtmRef | null
  /** FEAT-050 — the interactive add-on of the ad; `null` / absent = none */
  addOn?: AdAddOn | null
  /**
   * FEAT-061 (api-contract §1.3) — the ad texts the Smart+ ad page offers ("ข้อความ (n/5)"): 0..
   * `options.limits.adTextsMax` trimmed, unique, non-empty strings of at most `limits.textMaxLength`
   * characters. Additive (`.default([])`): a template saved before the feature has no such key at all —
   * every reader treats absence the same as `[]`, and `[]` means the worker never touches the control.
   */
  adTexts?: string[]
}

/**
 * The same 9 keys **as sent to the API** (`identity.post` carries the code, never `hasCode`/`codeLast4`;
 * `utm` carries the four body strings, never the ids; `addOn` is the same four-key blob that is served).
 */
export interface AdConfigRequest extends Omit<AdConfig, 'identity' | 'utm'> {
  identity: AdIdentityRequest
  utm?: UtmRefBody | null
}

/**
 * FEAT-042 — the state of the post-info lookup of an `authCode` template (api-contract §1.1 `status`).
 * `verifying` = the worker has not answered yet · `verified` = TikTok described the post · `invalid` = TikTok
 * refused the code · `failed` = we could not ask. A template that was never checked has **no** `postInfo`
 * (`null`) — the BO renders that as "ยังไม่ได้ตรวจ".
 */
export type AdTemplatePostInfoStatus = 'verifying' | 'verified' | 'invalid' | 'failed' | 'deleted'

/**
 * FEAT-042 — why a lookup did not end in `verified` (api-contract §1.1 `error`):
 * `tiktok` = TikTok answered `code !== 0` (then `code` / `msg` carry its raw answer) · `noLiveSession` = no
 * logged-in TikTok profile was open · `fetch` = every attempt failed on the request itself · `timeout` = the
 * lookup did not finish inside `POST_INFO_LOOKUP_TIMEOUT_MS`.
 */
export type AdTemplatePostInfoErrorKind = 'tiktok' | 'noLiveSession' | 'fetch' | 'timeout'

export interface AdTemplatePostInfoError {
  kind: AdTemplatePostInfoErrorKind
  /** `tiktok` only — TikTok's own numeric code */
  code?: number
  /** `tiktok` only — TikTok's own message (≤ 200 characters) */
  msg?: string
}

/**
 * FEAT-042 — what the worker actually stored in `adTemplateCovers` (api-contract §1.1 `cover`).
 * `ok: true` ⇔ `GET /ad-templates/:id/cover` answers 200 — **the only case in which the BO may request it**.
 * `ok: false` = TikTok served a cover but it was rejected (size cap / not an image); the whole key is `null`
 * when no cover was attempted or the download failed.
 */
export interface AdTemplatePostCover {
  ok: boolean
  mimeType: string | null
  bytes: number | null
  width: number | null
  height: number | null
}

/**
 * FEAT-042 — `postInfo` of a **list row** (api-contract §1.2 `PostInfoSummaryView`): exactly these 7 keys.
 * It is also the common denominator of the full view below, so every reader that only needs the chip, the
 * thumbnail flag, the owner, the validity date or the reason can accept this type and be handed either shape.
 *
 * **BUG-061** — `checkedAt` is one of them since 2026-10-21. It is the cover cache key of `useCoverImage`, so
 * without it every list row asked for the bytes under the constant key `<id>|` and kept showing the cover of
 * the **previous** post after a re-verify (while the form modal, which gets the full view, showed the new one).
 * It stays optional on the wire: an older API that does not serve it falls back to that old behaviour instead
 * of breaking the page.
 */
export interface AdTemplatePostInfoSummary {
  status: AdTemplatePostInfoStatus
  /** set on every terminal state (`verified`, `invalid`, `failed`) · part of the cover cache key */
  checkedAt?: string | null
  /** `0` video · `1` images · other values are passed through by the API */
  itemType: number | null
  ownerName: string | null
  /** only `ok` is served in a list row; `null` = nothing stored */
  cover: { ok: boolean } | null
  authEndAt: string | null
  error: AdTemplatePostInfoError | null
}

/**
 * FEAT-042 — `postInfo` of a **single** template (api-contract §1.1 `PostInfoView`), served by
 * `GET /ad-templates/:id`, `POST`/`PATCH /ad-templates*` and `POST /ad-templates/:id/post-info/verify`.
 * Exact key set (20 keys, `status` first, `error` last); `raw` is never served and no value ever carries a
 * signed TikTok URL. Every mapped field is `null` while the status is `verifying` and on both failure states.
 */
export interface AdTemplatePostInfo extends Omit<AdTemplatePostInfoSummary, 'cover'> {
  requestedAt: string
  /** set on every terminal state (`verified`, `invalid`, `failed`) */
  checkedAt: string | null
  /** debug only; `profileLast4 = "fake"` on the fake driver */
  checkedBy: { node: string, profileLast4: string } | null
  /** 19-digit TikTok ids stay strings */
  itemId: string | null
  authCodeStatus: number | null
  authStartAt: string | null
  ownerName: string | null
  caption: string | null
  /** video only (`itemType === 0`) */
  durationSec: number | null
  width: number | null
  height: number | null
  /** images only (`itemType === 1`) */
  imageCount: number | null
  /** permanent TikTok paths, never the signed URL — display/debug only */
  coverUri: string | null
  avatarUri: string | null
  cover: AdTemplatePostCover | null
}

/**
 * FEAT-042/FEAT-048 — `GET /ad-templates/:id/cover` 200 body (FEAT-048 api-contract.md v1 §3), like the build
 * screenshots. Storage on + the row migrated to object storage → the `url` shape (a presigned GET valid 15
 * minutes on `STORAGE_PUBLIC_ENDPOINT`, loaded by the browser directly, no auth header, no CORS); a legacy row
 * that still has bytes in Mongo → the `base64` shape, storage on or off. Consumer rule:
 * `isAdTemplateCoverUrl(cover) ? <img src=cover.url> : data:<mimeType>;base64,<base64>`. Treat a `url` body as
 * stale 60 s before `expiresAt` (`useCoverImage`).
 */
export interface AdTemplateCoverUrl {
  mimeType: string
  url: string
  /** ISO — presign TTL is fixed at 900 s server-side, not configurable from the BO */
  expiresAt: string
}
export interface AdTemplateCoverInline {
  mimeType: string
  base64: string
}
export type AdTemplateCover = AdTemplateCoverUrl | AdTemplateCoverInline

export function isAdTemplateCoverUrl(cover: AdTemplateCover): cover is AdTemplateCoverUrl {
  return 'url' in cover
}

/** FEAT-042 — `POST /ad-templates/:id/post-info/verify` 202 body (api-contract §2.2). */
export interface VerifyPostInfoResponse {
  status: AdTemplatePostInfoStatus
  postInfo: AdTemplatePostInfo
}

/** Exact key set of the API's template view (11 keys; `postInfo` after `catalogVersion`, then `addOnImage`). */
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
  /**
   * FEAT-042 — the last post-info lookup of the Spark code, or `null` when the template was never checked
   * (documents saved before the feature, `POST_INFO_ENABLED=false`). **Optional** in this type because an
   * older API does not serve the key at all. List rows carry the 6-key summary, single-template responses the
   * full view — readers of the shared keys accept the union, the post card narrows with `isFullPostInfo()`.
   */
  postInfo?: AdTemplatePostInfo | AdTemplatePostInfoSummary | null
  /**
   * FEAT-050 (api-contract §2) — the resolved image of `config.addOn.imageId`, or `null` when there is no
   * add-on, the media row is gone or its URL could not be signed. **Optional** in this type for the same reason
   * as `postInfo`: an older API does not serve the key at all, and a reader must not tell "no add-on image" from
   * "this API does not know about add-ons" by the key's presence — both render as "no thumbnail".
   */
  addOnImage?: AdAddOnImage | null
  /**
   * FEAT-054 (api-contract §2) — the resolved image of `config.destination.page.buttonImageId`, **same
   * 5-key shape as `addOnImage`**. `null` when the button is text, the media row is gone or its URL could
   * not be signed — the line never fails. **Optional** for the same "older API" reason as `addOnImage` /
   * `postInfo`: a reader must not tell "text button" from "this API does not know about button images" by
   * the key's presence — both render as "no thumbnail" / text mode.
   */
  buttonImage?: AdAddOnImage | null
  /** `name` is null when the workspace row is gone */
  workspace: { id: string, name: string | null }
  /** `username` is null when the admin row is gone */
  createdBy: { id: string, username: string | null }
  /**
   * FEAT-057 (api-contract v1 §1.2) — may the **caller of this request** edit / delete / UTM-sync / verify this
   * template (`isGod(ctx) || createdBy === ctx.adminId`)? Computed per request, never stored. The page renders
   * Edit, Sync UTM and Delete only for a row that carries `true`; every row can be duplicated.
   */
  canEdit: boolean
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

/**
 * FEAT-058 — one row of `GET /ad-templates/creators` (api-contract.md v1 §1, §3), the option list of
 * the BO's **Created by** select. `me` is `workspaceId === ctx.homeWorkspaceId`; exactly one row carries it.
 */
export interface Creator {
  workspaceId: string
  workspaceName: string | null
  adminId: string | null
  username: string | null
  me: boolean
}

/** `GET /ad-templates/creators` 200 body — exactly one top-level key. */
export interface CreatorsResponse {
  creators: Creator[]
}

/** `options.limits` — the API's own numbers, so the BO validates with the same maxima (spec A2). */
export interface AdTemplateLimits {
  /** `identity.post.text`, `destination.page.name` and `destination.page.buttonText` */
  textMaxLength: number
  /** `tracking.impressionUrl`, `tracking.clickUrl` and `destination.page.url` */
  urlMaxLength: number
  /**
   * FEAT-061 — how many `config.adTexts` entries the API accepts (5). Optional in this type only so the form
   * still renders against an API that predates the feature (then the BO falls back to 5).
   */
  adTextsMax?: number
}

/**
 * `GET /ad-templates/options` 200 body (FEAT-038 api-contract §2.4, FEAT-061 §1.3): the 9 label lists plus the
 * BO helpers (`allowOnTiktokPlatformsLabel`, `systemDefault`, `catalogVersion`, `limits`, `utmPrefixes`,
 * `smartPlusCtaValues`).
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
  /**
   * FEAT-038 — the allowed UTM prefixes (`systemSettings.utm.prefixes`, same order; `[]` while a GOD has not
   * set any). An older API that does not serve the key yet behaves like `[]`.
   */
  utmPrefixes?: string[]
  /**
   * FEAT-061 (api-contract §1.3) — the subset of `ctaValue` the **Smart+ ad page** really offers (10 values,
   * combobox order). A selected value outside this set makes the build fail at `checking`, so the form marks
   * it. Absent (an API that predates the feature) = no hints at all, never a wrong warning.
   */
  smartPlusCtaValues?: string[]
}

/**
 * `POST /ad-templates` body — `config` is complete (all 6 keys), never `catalogVersion`.
 * `config.identity.post.code` is required here (FEAT-017 §2.4 "POST always requires `code`").
 */
export interface CreateAdTemplateBody {
  name: string
  description?: string | null
  config: AdConfigRequest
  /**
   * FEAT-057 (api-contract v1 §5, §5.1) — the id of the template this one was duplicated from. Only sent by the
   * Duplicate flow; it lets the API copy the **secret** Spark code of the source when `config.identity.post` is
   * the bare `{ selection: 'authCode' }` (the BO never sees that code), and it is written into the audit detail
   * as `duplicatedFrom`. Unknown id → 404 `ไม่พบ template`, nothing created.
   */
  duplicateOf?: string
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

/**
 * FEAT-045 — `POST /ad-templates/:id/utm/sync` body (api-contract §1.1): `dryRun: true` only counts the rows
 * that would change (no write, no audit), the real run is the same route with `{}` / `{ dryRun: false }`.
 * The object is strict on the API side — never send another key.
 */
export interface UtmSyncBody {
  dryRun?: boolean
}

/**
 * FEAT-045 — how many rows of one collection carry the template's UTM (api-contract §1.2):
 * `total` = rows that belong to this template, `updated` = rows whose UTM differs from the template's current
 * one (on a real run: the rows actually written).
 */
export interface UtmSyncCounts {
  total: number
  updated: number
}

/**
 * FEAT-045 — the ad counts (api-contract §1.2): same two numbers plus `unlinked` = ads of the same published
 * campaigns that are not linked to a build yet (`buildId: null`), which the sync never touches — the next KPI
 * link stamps them from the now-updated build (spec AS-5).
 */
export interface UtmSyncAdCounts extends UtmSyncCounts {
  unlinked: number
}

/**
 * FEAT-045 — `POST /ad-templates/:id/utm/sync` 200 body (api-contract §1.2), identical for both modes:
 * the 7-string `utm` that was (or would be) written into `campaignOrders.adConfig.utm`, `builds.utm` and
 * `ads.utm` (4 ids only there), plus the counts per collection. `syncedAt` is `null` on a dry run.
 */
export interface UtmSyncResponse {
  templateId: string
  dryRun: boolean
  utm: UtmRef
  orders: UtmSyncCounts
  builds: UtmSyncCounts
  ads: UtmSyncAdCounts
  syncedAt: string | null
}
