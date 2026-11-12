/**
 * FEAT-101 — mssg site editor (`/mssg-pages/sites/[siteId]`). Mirrors api-contract.md v1 §2 (`MssgSiteView`,
 * `SiteProjection`, readiness, conflict, lastApply), §3 (draft routes and op shapes) and §5 (job types, steps, error
 * codes). The projection never holds a token, a cookie or a payment key (D5, D10); `conflict.items[].live/mine` are
 * the user's own site content.
 */
import type { MssgAccountStatus, MssgAccountView, MssgJobStatus } from './mssg-accounts'

// ── site projection (contract §2.1) ─────────────────────────────────────────────────────────────────────────────────
export type MssgApexDomain = 'mssg.me' | 'stick.ws' | 'linksbio.site' | 'lnkbio.site' | 'shopbio.site'
export type MssgSiteLang = 'en' | 'uk' | 'ru' | 'pt' | 'th' | 'es' | 'ru-kz'

export interface MssgSiteSeo {
  title: string
  description: string
  indexing: boolean
  faviconUrl: string | null
  ogImageUrl: string | null
}

export interface MssgSiteTracking {
  google: string
  facebook: string
  facebookCapi?: string
  tiktok: string
}

export interface MssgSiteEmbeddedCode {
  content: string
  inHead: boolean
  onLoad: boolean
}

export interface MssgPageTheme {
  styleId?: string | null
  page?: {
    backgroundColor?: string | null
    backgroundGradient?: unknown
    backgroundImage?: string | null
    backgroundImageOpacity?: number | null
    alignment?: string | null
  } | null
  blocks?: Record<string, unknown>
  [key: string]: unknown
}

export interface MssgBlockProjection {
  id: string
  /** one of the 19 kinds of contract §3.3, or an unknown kind read from mssg (shown read-only) */
  kind: string
  enabled: boolean
  /** every key of the block except `id`, `kind`, `enabled` — kept as read for the whole-object PUT */
  fields: Record<string, unknown>
}

export interface MssgPageProjection {
  id: string
  name: string
  slug: string
  enabled: boolean
  seo: { title: string, description: string }
  theme: MssgPageTheme | null
  blocks: MssgBlockProjection[]
}

/** `crm` keys are ⚠ (envelope seen, inner keys not); the projector drops every payment-provider key in the page */
export interface MssgSiteCrm {
  shopcart?: { enabled: boolean, successMessage: string, successUrl: string }
  productOptions?: unknown[]
  currency?: string
  messengers?: Record<string, boolean>
  payments?: Record<string, { enabled: boolean }>
}

export interface MssgSiteProjection {
  id: string
  name: string
  enabled: boolean
  subdomain: string
  apexDomain: MssgApexDomain | string
  domain: { name: string | null } | null
  finalUrl: string
  branding: boolean
  localization: { lang: MssgSiteLang | string }
  seo: MssgSiteSeo
  tracking: MssgSiteTracking
  embeddedCode: MssgSiteEmbeddedCode
  homePageId: string | null
  crm: MssgSiteCrm | null
  pages: MssgPageProjection[]
}

// ── operations (contract §3.2) ──────────────────────────────────────────────────────────────────────────────────────
export interface MssgSiteUpdateFields {
  name?: string
  subdomain?: string
  apexDomain?: MssgApexDomain
  enabled?: boolean
  branding?: boolean
  localization?: { lang: MssgSiteLang }
  seo?: Partial<MssgSiteSeo>
  tracking?: Partial<Pick<MssgSiteTracking, 'google' | 'facebook' | 'tiktok'>>
  embeddedCode?: Partial<MssgSiteEmbeddedCode>
}

export interface MssgOpSiteUpdate { op: 'site.update', fields: MssgSiteUpdateFields }

export interface MssgOpPageCreate { op: 'page.create', tempId: string, name: string, slug: string, enabled?: boolean }
export interface MssgOpPageUpdate {
  op: 'page.update'
  pageId: string
  fields: {
    name?: string
    slug?: string
    enabled?: boolean
    seo?: { title?: string, description?: string }
    theme?: { page?: { backgroundColor?: string | null, backgroundImage?: string | null } }
  }
}
export interface MssgOpPageClone { op: 'page.clone', pageId: string, tempId: string }
export interface MssgOpPageDelete { op: 'page.delete', pageId: string }
export interface MssgOpPageSetHome { op: 'page.setHome', pageId: string }

export interface MssgOpBlockCreate {
  op: 'block.create'
  pageId: string
  tempId: string
  kind: string
  fields: Record<string, unknown>
  enabled: boolean
  index?: number
}
export interface MssgOpBlockUpdate { op: 'block.update', pageId: string, blockId: string, fields?: Record<string, unknown>, enabled?: boolean }
export interface MssgOpBlockMove { op: 'block.move', pageId: string, blockId: string, toIndex: number }
export interface MssgOpBlockClone { op: 'block.clone', pageId: string, blockId: string, tempId: string }
export interface MssgOpBlockDelete { op: 'block.delete', pageId: string, blockId: string }

export interface MssgProductFields {
  name?: string
  photos?: string[]
  price?: { amount: number, currency: string }
  discount?: number | null
  description?: string
  notes?: string
  active?: boolean
}
export interface MssgOpProductCreate { op: 'product.create', tempId: string, fields: MssgProductFields }
export interface MssgOpProductUpdate { op: 'product.update', productId: string, fields: MssgProductFields }
export interface MssgOpProductDelete { op: 'product.delete', productId: string }

export type MssgOp
  = | MssgOpSiteUpdate
    | MssgOpPageCreate
    | MssgOpPageUpdate
    | MssgOpPageClone
    | MssgOpPageDelete
    | MssgOpPageSetHome
    | MssgOpBlockCreate
    | MssgOpBlockUpdate
    | MssgOpBlockMove
    | MssgOpBlockClone
    | MssgOpBlockDelete
    | MssgOpProductCreate
    | MssgOpProductUpdate
    | MssgOpProductDelete

export type MssgOpType = MssgOp['op']

// ── view (contract §2) ──────────────────────────────────────────────────────────────────────────────────────────────
export interface MssgActorRef {
  id: string
  name: string
}

export interface MssgDraftView {
  rev: number
  ops: MssgOp[]
  updatedAt: string
  updatedBy: MssgActorRef | null
}

export type MssgStepNo = 1 | 2 | 3 | 4 | 5

export interface MssgReadiness {
  percent: number
  steps: Record<'1' | '2' | '3' | '4' | '5', boolean>
  missing: MssgStepNo[]
}

export interface MssgConflictItem {
  opIndex: number
  /** e.g. `site.seo.title`, `pages.<id>.order` */
  path: string
  kind: 'changed' | 'gone'
  live: unknown
  mine: unknown
}

export interface MssgConflict {
  at: string
  items: MssgConflictItem[]
}

export type MssgLastApplyStatus = 'ok' | 'partial' | 'conflict' | 'failed'

export interface MssgApplyFieldError {
  opIndex: number
  path: string
  message: string
}

export interface MssgLastApply {
  jobId: string
  status: MssgLastApplyStatus
  at: string
  by: MssgActorRef | null
  appliedCount: number
  error: { code: string, message: string, fields?: MssgApplyFieldError[] } | null
}

/** contract §5 — site-scoped job types (connect / sync / logout stay on the account) */
export type MssgSiteJobType
  = | 'mssgApply'
    | 'mssgSiteCreate'
    | 'mssgSiteDuplicate'
    | 'mssgSiteDelete'
    | 'mssgDomain'
    | 'mssgStoreRead'
    | 'mssgAnalytics'

export interface MssgSiteJobView {
  id: string
  type: MssgSiteJobType | string
  status: MssgJobStatus
  /** `queued` · `openingProfile` · `checkingSession` · `reading` · `checkingConflicts` · `uploading` · `writing` · `creating` · `deleting` · `done` */
  step: string | null
  queuedAt: string
  finishedAt: string | null
}

export interface MssgSiteDomain {
  name: string | null
  state: 'none' | 'pending' | 'active' | 'error'
  records: { type: string, host: string, value: string }[]
  checkedAt: string | null
}

/** `GET /mssg-sites/:id` and every 2xx of a site route */
export interface MssgSiteView {
  id: string
  accountId: string
  workspaceId: string
  mssgId: string
  account: {
    id: string
    email: string
    nickname: string | null
    status: MssgAccountStatus
    plan: { name: string } | null
    /** v1.1 — as the account view */
    quota?: MssgAccountView['quota']
    /**
     * v1.1/v1.2 — the account's current / last mssg job of **any** type (FEAT-100 job shape, `null` when none); the
     * BO's account-wide busy state (AC-19). The type may be any FEAT-100 / FEAT-101 type, unknown ones are generic.
     */
    job?: MssgSiteJobView | null
  }
  owner: MssgActorRef
  name: string
  url: string
  status: 'published' | 'unpublished'
  gone: boolean
  live: MssgSiteProjection
  liveReadAt: string | null
  draft: MssgDraftView | null
  /** `draft.base` + `draft.ops` when a draft exists, else `live` */
  preview: MssgSiteProjection
  readiness: MssgReadiness
  conflict: MssgConflict | null
  lastApply: MssgLastApply | null
  /** v1.1 — the last apply with status `ok` or `partial` ("แก้ไขล่าสุดโดย", AC-16); kept when a later apply fails */
  lastSuccessfulApply?: { at: string, by: MssgActorRef | null } | null
  /** M4 (section 4.4): `null` = never read ("ดึงข้อมูลร้านค้า") */
  store: MssgStore | null
  /** M5 (section 4.6) */
  domain: MssgSiteDomain | null
  job: MssgSiteJobView | null
  /** contract §5: last failed site job other than apply; cleared by the next successful site job */
  lastError?: { code: string, message: string, at: string } | null
}

// ── store (contract §4.4, M4) ───────────────────────────────────────────────────────────────────────────────────────
/** products of a store read; `price.currency` = the store currency */
export interface MssgStoreProduct {
  id: string
  name: string
  photos: string[]
  price: { amount: number, currency: string }
  discount: number | null
  description: string
  notes: string
  active: boolean
}

/** read-only projection of mssg's `crm` (D5): no payment key, only `payments.<provider>.enabled` */
export interface MssgStoreSettings {
  shopcart?: { enabled?: boolean, successMessage?: string, successUrl?: string } | null
  productOptions?: unknown[]
  currency?: string
  messengers?: Record<string, boolean>
  payments?: Record<string, { enabled?: boolean }>
}

/** contacts are masked by the API before they are stored (D8): `so***@gmail.com`, `08******12` */
export interface MssgStoreAudienceRow {
  id: string
  createdAt: string
  name?: string | null
  email?: string | null
  phone?: string | null
  fields?: { label: string, value: string }[]
}

export interface MssgStoreRequestRow {
  id: string
  createdAt: string
  title?: string | null
  email?: string | null
  phone?: string | null
  total?: { amount: number, currency: string } | null
}

export type MssgRequestStatus = 'new' | 'inProgress' | 'done' | 'canceled'

export interface MssgStore {
  readAt: string
  settings: MssgStoreSettings | null
  products: MssgStoreProduct[]
  productsTotal?: number
  collectionsCount?: number
  audience?: { total: number, rows: MssgStoreAudienceRow[] } | null
  requests?: {
    counts: Record<MssgRequestStatus, number>
    rows: Record<MssgRequestStatus, MssgStoreRequestRow[]>
  } | null
}

// ── bodies ──────────────────────────────────────────────────────────────────────────────────────────────────────────
/** `PUT /mssg-sites/:id/draft` */
export interface MssgDraftPutBody {
  /** the view's `draft.rev`, `null` when there is no draft */
  rev: number | null
  ops: MssgOp[]
}

/** `POST /mssg-sites/:id/apply` */
export interface MssgApplyBody {
  rev: number
  confirmDestructive?: boolean
}

/** `POST /mssg-sites/:id/draft/resolve` */
export interface MssgResolveBody {
  take: 'live' | 'mine'
}

/** 409 reasons of the site routes (contract §3.1, §4) */
export type MssgSiteConflictReason
  = | 'draftChanged'
    | 'jobInProgress'
    | 'siteGone'
    | 'notConnected'
    | 'noDraft'
    | 'confirmRequired'
    | 'conflictPending'
    | 'noConflict'
    | 'quotaReached'

// ── uploads (contract §3.1, D7) ─────────────────────────────────────────────────────────────────────────────────────
/** `POST /mssg-sites/:id/uploads` */
export interface MssgUploadBody {
  filename: string
  mime: string
  /** base64 without the data-URI prefix */
  data: string
}

/** 201 of `POST /mssg-sites/:id/uploads` */
export interface MssgUploadView {
  uploadId: string
  /** `upload:<id>` — what goes into a 🖼 field of an op */
  ref: string
  mime: string
  size: number
  width: number | null
  height: number | null
  /** `/mssg-sites/:id/uploads/<id>` — relative to the API, read through `useApi()` (auth + area) */
  previewUrl: string
}
