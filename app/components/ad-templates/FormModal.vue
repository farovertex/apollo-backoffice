<script setup lang="ts">
/**
 * FEAT-012 — Create / Edit ad template (function 6.9; api-contract.md **v1**
 * `POST /ad-templates`, `PATCH /ad-templates/:id`).
 *
 * One component for both modes: `template === null` → create (`POST` with a **complete 6-key** config prefilled
 * from `options.systemDefault`, never `catalogVersion`), a row → edit (`PATCH` with **only the changed keys**;
 * each changed top-level `config` key is sent whole — the API replaces it wholesale, it never deep-merges).
 *
 * Every radio group is built from `options` (`{ value, label }`) — including the single-valued `identityMode`,
 * `identitySource` and `destinationMode` lists (spec A3) — so no enum label is hard-coded in the BO. The five
 * section headings are the only Thai strings in this file; the long consent sentence comes from
 * `options.allowOnTiktokPlatformsLabel` (spec A4).
 *
 * The form state mirrors the API body (`name`, `description`, `config.*`) **exactly**, which makes a zod issue
 * path and an API `issues[].path` land on the same `UFormField` name (`config.identity.post.text`,
 * `config.tracking.clickUrl`, …). The one deviation is `config.allowOnTiktokPlatforms`, which holds the radio
 * value (`inherit` / `on` / `off`) and is mapped to `null` / `true` / `false` when the body is built.
 *
 * **FEAT-017** (api-contract v1 §2, §8 · spec AC-28, AC-29): the two unions the build worker needs are the only
 * ones the form offers any more — `identity.post` is always `authCode` (the **secret** Spark authorization code)
 * and `destination.page` is always `create` (the instant page the build makes: button text, landing URL, tone,
 * language, hand cursor). The `first` / `named` variants stay valid on the API side for templates that were
 * saved earlier, but they can no longer be chosen here: such a template opens with `adt-legacy-notice`, an empty
 * code and the defaulted instant-page fields, and saving it converts it.
 * The ad-template view includes the stored Spark `code`. On edit the text input is prefilled with it and a
 * save sends that value back. A response that only has the older masked shape (`hasCode` / `codeLast4`) still
 * shows the hint: while the hint is shown the PATCH body sends `identity.post = { selection: 'authCode' }` and
 * the API keeps the stored code. The code is never logged and never put in a toast.
 *
 * **FEAT-038** (api-contract v1 §2, §6 · spec U1, AC-22…AC-26): a 6th section "UTM" records which UTM set the
 * ad's sign-up link counts under. The toggle `adt-utm-enabled` decides the whole block: off → the body sends
 * `config.utm: null`, on → prefix (from `options.utmPrefixes`, never a hard-coded list) + `utm_source` /
 * `utm_medium` / `utm_campaign`, all four required. The four fields are hidden with `v-show` (the convention of
 * the section bodies below), while the "ยังไม่ตั้งรายการ Prefix" line of an empty `utmPrefixes` list stays
 * readable either way — nothing can be bound until a GOD fills that list. The paste box only runs `parseUtm()` and
 * is never sent. The three ids (`sourceId` / `mediumId` / `campaignId`) are filled in by the API after it proved
 * the set exists in the 3rd-party system: they are shown read-only (`adt-utm-ids`) and never sent back.
 * **FEAT-042** (api-contract v1 §1.1, §2.2, §2.3 · spec §Behaviour — BO 1, AC-13): the section
 * "โพสต์ที่ผูกไว้" (`adt-post-info`) under the code field shows what TikTok says that code points at — chip,
 * cover, owner, caption, kind, validity window — and offers "ตรวจ" / "ตรวจอีกครั้ง"
 * (`POST /ad-templates/:id/post-info/verify`). Because the result arrives seconds **after** the save, a save
 * that carried a code (create, or edit after "Change code") no longer closes the modal (spec A-3): it switches
 * to edit mode on the API's answer, toasts and emits as before, and polls `GET /ad-templates/:id` every 2 s
 * for up to 2 min while the status is `verifying`. A save that kept the stored code closes the modal exactly
 * as it always did. The code is never part of the section, of a toast or of a log line.
 *
 * A `config.utm` issue is not a field — it is rendered under the section (`adt-utm-error`), and so is the
 * `{ error }` text of a **502** (which also raises a toast and keeps the modal open with the values intact).
 * A template saved before FEAT-038 has no `utm` key at all: it opens with the toggle off and a save leaves
 * `utm` out of the PATCH entirely.
 *
 * Layout: six sections in the TikTok page order as an **accordion** (UTM last — it is ours, not TikTok's).
 * `adname` is always open and has no toggle; `identity` / `destination` / `cta` / `tracking` / `utm` sit behind
 * `adt-sec-<id>-toggle`, are collapsed while every control in them equals `options.systemDefault` (badge
 * `adt-sec-<id>-default` = `Default`, live; the UTM section reads `ไม่ผูก` while the toggle is off, AS-8) and
 * auto-expand when one of their fields carries a client or API error.
 * The collapsed body is hidden with `v-show` (never unmounted) so every value is still submitted and an error can
 * be rendered the moment its section opens — `UCollapsible`'s `unmountOnHide: false` only sets
 * `hidden="until-found"`, which is not reliably "hidden" for a test runner, and unmounting would drop the field an
 * error has to land on.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormErrorEvent, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import { ctaValuesFrom } from '~/utils/ad-cta'
import { UTM_NAME_MAX_LENGTH, UTM_PREFIX_MAX_LENGTH, parseUtm } from '~/utils/utm'
import type {
  AdConfig,
  AdConfigRequest,
  AdCta,
  AdCtaValue,
  AdInstantPageLanguage,
  AdInstantPageTone,
  AdPageSelection,
  AdPostSelection,
  AdTemplate,
  AdTemplateLimits,
  AdTemplateOptions,
  AdTemplatePostInfo,
  AdTemplatePostInfoSummary,
  CreateAdTemplateBody,
  OptionItem,
  PatchAdTemplateBody,
  TriState,
  UtmRef,
  UtmRefBody,
  VerifyPostInfoResponse
} from '#shared/types/ad-templates'

const props = defineProps<{
  /** null = create, a row = edit */
  template: AdTemplate | null
  /** fetched once per page lifetime and passed down — the modal never re-fetches it */
  options: AdTemplateOptions
}>()

const emit = defineEmits<{
  created: [template: AdTemplate]
  updated: [template: AdTemplate]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `adt-form-modal`).
const modalContent = { 'data-testid': 'adt-form-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()
// display-only, like the sidebar: the link to the GOD-only prefix settings is hidden for everybody else
const { admin } = useAuth()
const isGod = computed(() => admin.value?.roles?.includes('GOD') === true)

/**
 * FEAT-042 — the template a save answered with, while the modal stays open on it (spec A-3). `null` in every
 * other situation; reset on every open. It wins over the prop, so after a create the modal is an edit of the
 * new row (title, "Save" button, PATCH body, post section) without the page having to re-open it.
 */
const savedTemplate = ref<AdTemplate | null>(null)

/** the row the form works on: the prop, or the answer of the save that kept the modal open */
const editing = computed<AdTemplate | null>(() => savedTemplate.value ?? props.template)

const isEdit = computed(() => editing.value !== null)

// ── FEAT-017 fixed selections and instant-page defaults (spec L-10; `/options` only supplies their labels) ───────────
const POST_AUTH_CODE = 'authCode'
const PAGE_CREATE = 'create'
/** the two variants that can still be stored but are not offered any more → `adt-legacy-notice` */
const LEGACY_SELECTIONS: ReadonlySet<string> = new Set(['first', 'named'])
const DEFAULT_TONE = 'dark'
const DEFAULT_LANGUAGE = 'th'
const DEFAULT_HAND_CURSOR = true
/** api-contract §2.1 — `code` trim 1..500; `/options.limits` does not serve this one (see bo.md) */
const CODE_MAX_LENGTH = 500

// ── FEAT-038 UTM (api-contract §2.1 `utmRefBodySchema`, §2.2 the 502 bodies) ─────────────────────────────────────────
/** the client texts mirror the API's own zod messages so a client and a server refusal read the same */
const UTM_MESSAGES = {
  prefixRequired: 'เลือก Prefix',
  required: 'ต้องไม่ว่าง',
  prefixTooLong: `prefix ยาวเกิน ${UTM_PREFIX_MAX_LENGTH} ตัว`,
  nameTooLong: (field: string) => `${field} ยาวเกิน ${UTM_NAME_MAX_LENGTH} ตัว`,
  /** 502 — the API could not reach / was refused by the 3rd-party UTM system; its `error` text is the detail */
  gatewayTitle: 'ตรวจ UTM ไม่ได้',
  gatewayFallback: 'ตรวจ UTM กับระบบปลายทางไม่ได้ — ลองใหม่อีกครั้ง'
} as const

// ── form state (mirrors the API body; every enum is a plain string so an unknown option value still renders) ─────────
interface ConfigState {
  adNamePrefix: string
  /** `post` is always `authCode`; `code` is empty unless the user typed one (create, or after "Change code") */
  identity: { mode: string, source: string, post: { selection: string, code: string } }
  /** `page` is always `create` — the five values of the instant page the build makes */
  destination: {
    mode: string
    page: {
      selection: string
      buttonText: string
      url: string
      tone: string
      language: string
      showHandCursor: boolean
    }
  }
  /** UI-only encoding of the tri-state: `inherit` ↔ null, `on` ↔ true, `off` ↔ false */
  allowOnTiktokPlatforms: string
  /** selected call-to-action keys, in dropdown order */
  cta: { values: string[] }
  tracking: { impressionUrl: string, clickUrl: string }
  /** FEAT-038 — `enabled` is the UI encoding of `utm !== null`; the ids are never part of the form state */
  utm: UtmState
}

interface UtmState {
  enabled: boolean
  prefix: string
  source: string
  medium: string
  campaign: string
}

interface FormState {
  name: string
  description: string
  config: ConfigState
}

// ── tri-state consent (`inherit ↔ null`, `on ↔ true`, `off ↔ false` — spec A4) ──────────────────────────────────────
const TRI_ON = 'on'
const TRI_OFF = 'off'
const TRI_INHERIT = 'inherit'

function triToRadio(value: TriState | undefined): string {
  if (value === true) return TRI_ON
  if (value === false) return TRI_OFF
  return TRI_INHERIT
}

function radioToTri(value: string | undefined): TriState {
  if (value === TRI_ON) return true
  if (value === TRI_OFF) return false
  return null
}

/**
 * The config part of the state, from any `AdConfig` (the system default on create, the row on edit).
 * The two selections are forced to `authCode` / `create`; a stored `create` page keeps its five values, anything
 * else (a legacy `first` / `named` page, or the system default) starts from the defaults of spec L-10.
 * The Spark code is seeded from the view when the template carries one.
 */
/**
 * FEAT-038 — the stored `config.utm` as the form holds it. A missing key (a template saved before the feature)
 * and an explicit `null` are the same thing here: the toggle starts off and the four inputs are empty.
 */
function utmStateFrom(utm: UtmRef | null | undefined): UtmState {
  return {
    enabled: !!utm,
    prefix: utm?.prefix ?? '',
    source: utm?.source ?? '',
    medium: utm?.medium ?? '',
    campaign: utm?.campaign ?? ''
  }
}

/** the four body strings of a stored `utm` (the ids are dropped — the API fills them in on every save) */
function utmBodyOf(utm: UtmRef | null | undefined): UtmRefBody | null {
  if (!utm) return null
  return { prefix: utm.prefix, source: utm.source, medium: utm.medium, campaign: utm.campaign }
}

function storedSparkCode(config: AdConfig | null | undefined): string {
  const post = config?.identity?.post
  if (post?.selection !== POST_AUTH_CODE || !('code' in post) || typeof post.code !== 'string') return ''
  return post.code
}

function configStateFrom(config: AdConfig): ConfigState {
  const page = config?.destination?.page
  const createPage = page?.selection === PAGE_CREATE ? page : null
  const cta = config?.cta
  return {
    adNamePrefix: config?.adNamePrefix ?? '',
    identity: {
      mode: config?.identity?.mode ?? '',
      source: config?.identity?.source ?? '',
      post: {
        selection: POST_AUTH_CODE,
        code: storedSparkCode(config)
      }
    },
    destination: {
      mode: config?.destination?.mode ?? '',
      page: {
        selection: PAGE_CREATE,
        buttonText: createPage?.buttonText ?? '',
        url: createPage?.url ?? '',
        tone: createPage?.tone ?? DEFAULT_TONE,
        language: createPage?.language ?? DEFAULT_LANGUAGE,
        showHandCursor: createPage?.showHandCursor ?? DEFAULT_HAND_CURSOR
      }
    },
    allowOnTiktokPlatforms: triToRadio(config?.allowOnTiktokPlatforms),
    cta: {
      values: [...ctaValuesFrom(cta, props.options.systemDefault?.cta?.values ?? [])]
    },
    tracking: {
      impressionUrl: config?.tracking?.impressionUrl ?? '',
      clickUrl: config?.tracking?.clickUrl ?? ''
    },
    utm: utmStateFrom(config?.utm)
  }
}

function stateFrom(template: AdTemplate | null): FormState {
  const config = template ? template.config : props.options.systemDefault
  return {
    name: template?.name ?? '',
    description: template?.description ?? '',
    config: configStateFrom(config)
  }
}

const state = reactive<FormState>(stateFrom(null))
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)

/**
 * BUG-007 — errors that came from the API, by `UFormField` name. They are bound to each field's `error` prop
 * instead of going through `UForm.setErrors()`, because `UForm` re-validates a field 300 ms after the last
 * keystroke in it and that debounced pass overwrites anything `setErrors()` put there. Owning the state means no
 * timing can drop it; it is cleared as soon as the user edits anything, and before every submit.
 */
const serverErrors = ref<Record<string, string>>({})

/**
 * FEAT-038 — what the API said about the UTM **set** rather than about one of its fields: a 400 whose issue
 * path is exactly `config.utm` ("ไม่พบ UTM นี้ในระบบปลายทาง …") and the `{ error }` text of a 502. It is not a
 * `UFormField` name, so it gets its own place under the section (`adt-utm-error`).
 */
const utmSectionError = ref<string | null>(null)

function clearServerErrors() {
  serverErrors.value = {}
  utmSectionError.value = null
}

// any edit invalidates what the server said about the form
watch(state, clearServerErrors, { deep: true })

// the submit button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

// ── accordion (five sections in the TikTok page order) ───────────────────────────────────────────────────────────────
type SectionId = 'adname' | 'identity' | 'destination' | 'cta' | 'tracking' | 'utm'

/**
 * The collapsible sections and the `config` keys each one owns. The heading is the section's TikTok title —
 * the only Thai text this file spells out itself (`Call to action` is English on TikTok too).
 */
const SECTIONS = [
  { id: 'identity' as const, heading: 'ตัวตน', keys: ['identity'] as const },
  {
    id: 'destination' as const,
    heading: 'จุดหมายปลายทาง',
    keys: ['destination', 'allowOnTiktokPlatforms'] as const
  },
  { id: 'cta' as const, heading: 'Call to action', keys: ['cta'] as const },
  { id: 'tracking' as const, heading: 'การตั้งค่าการติดตามของบริษัทอื่น', keys: ['tracking'] as const },
  { id: 'utm' as const, heading: 'UTM', keys: ['utm'] as const }
] satisfies readonly { id: SectionId, heading: string, keys: readonly (keyof AdConfig)[] }[]

const COLLAPSIBLE_IDS = SECTIONS.map(section => section.id)

/** which section a `config` key (and therefore a `UFormField` name) belongs to */
const SECTION_OF_KEY: Record<string, SectionId> = Object.fromEntries(
  SECTIONS.flatMap(section => section.keys.map(key => [key, section.id] as [string, SectionId]))
)

const expanded = reactive<Record<string, boolean>>(
  Object.fromEntries(COLLAPSIBLE_IDS.map(id => [id, false] as [string, boolean]))
)

function toggleSection(id: SectionId) {
  expanded[id] = !expanded[id]
}

/** `UFormField` name → section (`config.identity.post.text` → `identity`); `adname` needs no expanding */
function sectionOfField(name: string | undefined): SectionId | null {
  if (!name) return null
  if (!name.startsWith('config.')) return null
  const key = name.slice('config.'.length).split('.')[0] ?? ''
  return SECTION_OF_KEY[key] ?? null
}

function expandSectionsOf(names: (string | undefined)[]) {
  for (const name of names) {
    const id = sectionOfField(name)
    if (id) expanded[id] = true
  }
}

// ── the Spark authorization code (write-only secret) ─────────────────────────────────────────────────────────────────
/** the label `/options` gives a fixed selection (`authCode` / `create`); the value itself if the list is older */
function labelOf(items: OptionItem[] | undefined, value: string): string {
  return items?.find(item => item.value === value)?.label ?? value
}

const postSelectionLabel = computed(() => labelOf(props.options.postSelection, POST_AUTH_CODE))
const pageSelectionLabel = computed(() => labelOf(props.options.pageSelection, PAGE_CREATE))

/** the loaded template already has a stored code (its masked view says so) → the hint can be offered */
const hasStoredCode = computed(() => {
  const post = editing.value?.config?.identity?.post
  return post?.selection === POST_AUTH_CODE && 'hasCode' in post && post.hasCode === true
})

/** `••••<last4>`, or `••••` when the stored code is shorter than 5 characters (spec L-11) */
const codeHint = computed(() => {
  const post = editing.value?.config?.identity?.post
  const last4 = post?.selection === POST_AUTH_CODE && 'codeLast4' in post ? post.codeLast4 : null
  return `••••${last4 ?? ''}`
})

/**
 * `keep` = the hint is shown and the body carries `{ selection: 'authCode' }` (the API keeps the stored code);
 * `new` = the text input is shown and its value is sent. Create and a legacy template always start at `new`.
 */
const codeMode = ref<'keep' | 'new'>('new')

function resetCodeMode() {
  codeMode.value = hasStoredCode.value ? 'keep' : 'new'
}

/** the input is shown (and therefore required) whenever the stored code is not being kept */
const codeIsRequired = computed(() => codeMode.value === 'new')

function changeCode() {
  state.config.identity.post.code = ''
  codeMode.value = 'new'
  clearServerErrors()
}

function keepCode() {
  state.config.identity.post.code = ''
  codeMode.value = 'keep'
  clearServerErrors()
}

/** a template stored before FEAT-017 (post or page still `first` / `named`) has to be completed before it builds */
const isLegacyTemplate = computed(() => {
  const config = editing.value?.config
  if (!config) return false
  return LEGACY_SELECTIONS.has(config.identity?.post?.selection ?? '')
    || LEGACY_SELECTIONS.has(config.destination?.page?.selection ?? '')
})

// ── the bound post (FEAT-042 · spec §Behaviour — BO 1, AC-13) ───────────────────────────────────────────────────────
/** `GET /ad-templates/:id` every 2 s, for at most 2 min, while the lookup is still `verifying` */
const POST_POLL_MS = 2000
const POST_POLL_MAX_MS = 120_000

/**
 * What the section renders. On open it starts as whatever the row carried (a list row has the 6-key summary),
 * and the first read upgrades it to the full view the card needs (caption, duration, image count).
 */
const postInfo = ref<AdTemplatePostInfo | AdTemplatePostInfoSummary | null>(null)
/** the verify request is in flight (the button spins; the poll is unaffected) */
const postVerifying = ref(false)
/** `data-polling` of the section */
const postPolling = ref(false)
/** the 2 min are over and the status is still `verifying` → display-only line, the table takes over */
const postGaveUp = ref(false)
let postTimer: ReturnType<typeof setInterval> | null = null
let postDeadline = 0
// bumped on every open/close and read so a late answer never lands in a closed (or re-opened) modal
let postSession = 0

const postTemplateId = computed(() => editing.value?.id ?? null)
const postCheckedAt = computed(() => postInfoCheckedAt(postInfo.value))
const postCaption = computed(() => (isFullPostInfo(postInfo.value) ? postInfo.value.caption : null))
const postKind = computed(() => postInfoKindLabel(postInfo.value))
const postUntil = computed(() => postInfoUntilLabel(postInfo.value))
const postReason = computed(() => postInfoReason(postInfo.value))
const postIsVerifying = computed(() => isPostInfoVerifying(postInfo.value))
const postIsVerified = computed(() => isPostInfoVerified(postInfo.value))

function stopPostPolling() {
  if (postTimer) {
    clearInterval(postTimer)
    postTimer = null
  }
  postPolling.value = false
}

function startPostPolling() {
  if (postTimer || !postTemplateId.value) return
  postDeadline = Date.now() + POST_POLL_MAX_MS
  postGaveUp.value = false
  postPolling.value = true
  postTimer = setInterval(() => {
    if (Date.now() >= postDeadline) {
      stopPostPolling()
      // the worker may still answer — the table shows the result, this modal stops asking
      postGaveUp.value = true
      return
    }
    void readPostInfo()
  }, POST_POLL_MS)
}

/** one read of the single-template view; a failed tick keeps the last known state and the next tick retries */
async function readPostInfo() {
  const id = postTemplateId.value
  if (!id) return
  const s = ++postSession
  try {
    // retry: 0 — exactly one request per tick
    const fresh = await api<AdTemplate>(`/ad-templates/${encodeURIComponent(id)}`, { retry: 0 })
    if (s !== postSession || !open.value) return
    postInfo.value = fresh.postInfo ?? null
  } catch {
    // display-only: nothing to tell the user about one missed poll tick
  }
}

/** on open (and after a save that kept the modal open): render what we have, then read the full view */
function initPostInfo() {
  postSession++
  postGaveUp.value = false
  postInfo.value = editing.value?.postInfo ?? null
  if (editing.value) void readPostInfo()
}

/** "ตรวจ" / "ตรวจอีกครั้ง" — 202 starts a new lookup, 409 means one is already running (api-contract §2.2) */
async function verifyPost() {
  const id = postTemplateId.value
  if (!id || postVerifying.value) return
  postVerifying.value = true
  try {
    // retry: 0 — exactly one POST per click
    const res = await api<VerifyPostInfoResponse>(
      `/ad-templates/${encodeURIComponent(id)}/post-info/verify`,
      { method: 'POST', retry: 0 }
    )
    postInfo.value = res.postInfo ?? null
    postGaveUp.value = false
    if (isPostInfoVerifying(postInfo.value)) startPostPolling()
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const status = err.response?.status ?? err.statusCode
    if (status === 409) {
      toast.add({
        title: 'กำลังตรวจอยู่แล้ว',
        description: err.data?.error,
        icon: 'i-lucide-loader-circle',
        color: 'info'
      })
      // the row is `waiting|claimed` (or the feature is off) — the fresh read decides whether to poll
      await readPostInfo()
      postGaveUp.value = false
      if (isPostInfoVerifying(postInfo.value)) startPostPolling()
      return
    }
    toast.add({
      title: 'สั่งตรวจโพสต์ไม่ได้',
      description: err.data?.error ?? err.message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
  } finally {
    postVerifying.value = false
  }
}

// the poll follows the status: it starts when a lookup is running and stops the moment a result lands
watch(postIsVerifying, (running) => {
  if (running && open.value) startPostPolling()
  else if (!running) stopPostPolling()
})

onUnmounted(stopPostPolling)

// ── the UTM section (FEAT-038 · spec U1) ─────────────────────────────────────────────────────────────────────────────
/**
 * The prefixes offered by the select: the settings list from `/options`, plus the prefix this template is bound
 * to when a GOD has meanwhile removed it from the list (settings `inUse`). Without that the value would
 * disappear from the control and an unrelated save would wipe the binding.
 */
const utmPrefixItems = computed<string[]>(() => {
  const listed = props.options.utmPrefixes ?? []
  const bound = editing.value?.config?.utm?.prefix ?? ''
  return bound && !listed.includes(bound) ? [...listed, bound] : [...listed]
})

/** no prefix has been set up yet → the select has nothing to offer (GOD gets the link to the settings page) */
const noUtmPrefixes = computed(() => utmPrefixItems.value.length === 0)

/** the three ids the API answered with, display-only; absent for a create and for an unbound / old template */
const utmIds = computed(() => {
  const utm = editing.value?.config?.utm
  if (!utm?.sourceId && !utm?.mediumId && !utm?.campaignId) return null
  return `id: source ${utm?.sourceId ?? '—'} · medium ${utm?.mediumId ?? '—'} · campaign ${utm?.campaignId ?? '—'}`
})

/** the paste box is a helper, not a value: it never enters `state` and therefore never reaches the API */
const utmPaste = ref('')

function onUtmPaste(text: string) {
  utmPaste.value = text
  const found = parseUtm(text)
  // only the keys that were really found are overwritten — the others keep what the user typed
  if (found.utm_source !== undefined) state.config.utm.source = found.utm_source
  if (found.utm_medium !== undefined) state.config.utm.medium = found.utm_medium
  if (found.utm_campaign !== undefined) state.config.utm.campaign = found.utm_campaign
}

// ── "Default" badges (live) ──────────────────────────────────────────────────────────────────────────────────────────
/** the config the current state would send — the single source for the badges and for the POST/PATCH bodies */
const currentConfig = computed(() => configFromState())

const sectionIsDefault = computed<Record<string, boolean>>(() => {
  const next = currentConfig.value
  const base = props.options.systemDefault
  return Object.fromEntries(
    SECTIONS.map(section =>
      [
        section.id,
        // UTM is not a TikTok setting: "unbound" is its default, whatever `systemDefault` says (badge "ไม่ผูก")
        section.id === 'utm'
          ? !state.config.utm.enabled
          : section.keys.every(key => deepEqual(next[key], base?.[key]))
      ] as [string, boolean]
    )
  )
})

/** collapse every section that is at the system default, expand the others (open, reset, reset-to-defaults) */
function syncExpanded() {
  const byDefault = sectionIsDefault.value
  for (const id of COLLAPSIBLE_IDS) expanded[id] = !byDefault[id]
}

function resetForm() {
  Object.assign(state, stateFrom(editing.value))
  resetCodeMode()
  utmPaste.value = ''
  submitting.value = false
  submitError.value = null
  clearServerErrors()
  formRef.value?.clear()
  syncExpanded()
}

watch(open, (isOpen) => {
  if (isOpen) {
    // a previous save must not leak into the next open (FEAT-042 stay-open rule)
    savedTemplate.value = null
    resetForm()
    initPostInfo()
    return
  }
  stopPostPolling()
  postSession++
  postInfo.value = null
  postGaveUp.value = false
})

/**
 * "Reset to TikTok defaults" — config controls only, name/description untouched, no request.
 * The stored Spark code is **not** a TikTok default: an edit puts that code back in the field. A masked
 * template (no `code` in the view) goes back to the hint. A create / legacy template keeps the empty input.
 * FEAT-038: the UTM binding is ours, not TikTok's — it is restored the same way, so this button never silently
 * unbinds a template.
 */
function resetToDefaults() {
  state.config = configStateFrom(props.options.systemDefault)
  state.config.identity.post.code = storedSparkCode(editing.value?.config)
  state.config.utm = utmStateFrom(editing.value?.config?.utm)
  resetCodeMode()
  submitError.value = null
  clearServerErrors()
  formRef.value?.clear()
  syncExpanded()
}

// ── validation (mirrors api-contract.md; an invalid form never reaches the network) ──────────────────────────────────
const DEFAULT_LIMITS: AdTemplateLimits = { textMaxLength: 100, urlMaxLength: 2048 }
/** the API's own numbers (spec A2) — never hard-coded when `/options` serves them */
const limits = computed<AdTemplateLimits>(() => ({
  textMaxLength: props.options.limits?.textMaxLength ?? DEFAULT_LIMITS.textMaxLength,
  urlMaxLength: props.options.limits?.urlMaxLength ?? DEFAULT_LIMITS.urlMaxLength
}))

const HTTP_URL_RE = /^https?:\/\//i

/** api-contract §2.2 — the landing URL must parse **and** use `https:` (`ต้องเป็น URL ที่ขึ้นต้นด้วย https://`) */
function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function makeSchema(max: AdTemplateLimits, requireCode: boolean) {
  return z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
    description: z.string().trim().max(500, 'Description must be at most 500 characters'),
    config: z.object({
      adNamePrefix: z.string().trim().max(100, 'Prefix must be at most 100 characters'),
      identity: z.object({
        mode: z.string().min(1, 'Identity is required'),
        source: z.string().min(1, 'Identity source is required'),
        post: z.object({
          selection: z.string().min(1, 'Post selection is required'),
          code: z.string().trim().max(
            CODE_MAX_LENGTH,
            `Code must be at most ${CODE_MAX_LENGTH} characters`
          )
        })
      }),
      destination: z.object({
        mode: z.string().min(1, 'Destination is required'),
        page: z.object({
          selection: z.string().min(1, 'Page selection is required'),
          buttonText: z.string().trim().max(
            max.textMaxLength,
            `Button text must be at most ${max.textMaxLength} characters`
          ),
          url: z.string().trim().max(
            max.urlMaxLength,
            `URL must be at most ${max.urlMaxLength} characters`
          ),
          tone: z.string().min(1, 'Tone is required'),
          language: z.string().min(1, 'Language is required'),
          showHandCursor: z.boolean()
        })
      }),
      allowOnTiktokPlatforms: z.string().min(1, 'Consent is required'),
      cta: z.object({
        values: z.array(z.string())
      }),
      tracking: z.object({
        impressionUrl: z.string().trim(),
        clickUrl: z.string().trim()
      }),
      utm: z.object({
        enabled: z.boolean(),
        prefix: z.string().trim().max(UTM_PREFIX_MAX_LENGTH, UTM_MESSAGES.prefixTooLong),
        source: z.string().trim().max(UTM_NAME_MAX_LENGTH, UTM_MESSAGES.nameTooLong('source')),
        medium: z.string().trim().max(UTM_NAME_MAX_LENGTH, UTM_MESSAGES.nameTooLong('medium')),
        campaign: z.string().trim().max(UTM_NAME_MAX_LENGTH, UTM_MESSAGES.nameTooLong('campaign'))
      })
    })
  }).superRefine((data, ctx) => {
    // the Spark code is required whenever the input is on screen (create, legacy template, or "Change code")
    if (requireCode && data.config.identity.post.code === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'identity', 'post', 'code'],
        message: 'Spark post code is required'
      })
    }

    // the new instant page needs a button text and an https landing URL (api-contract §2.2)
    if (data.config.destination.page.buttonText === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'destination', 'page', 'buttonText'],
        message: 'Button text is required'
      })
    }

    const pageUrl = data.config.destination.page.url
    if (pageUrl === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'destination', 'page', 'url'],
        message: 'Landing page URL is required'
      })
    } else if (pageUrl.length <= max.urlMaxLength && !isHttpsUrl(pageUrl)) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'destination', 'page', 'url'],
        message: 'URL must start with https://'
      })
    }

    if (data.config.cta.values.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'cta', 'values'],
        message: 'Select at least one call to action'
      })
    }

    // both tracking URLs are optional; when filled they must be an http(s) URL within the API's limit
    const urls = [
      { key: 'impressionUrl', value: data.config.tracking.impressionUrl },
      { key: 'clickUrl', value: data.config.tracking.clickUrl }
    ] as const
    for (const { key, value } of urls) {
      if (value === '') continue
      const path = ['config', 'tracking', key]
      if (value.length > max.urlMaxLength) {
        ctx.addIssue({ code: 'custom', path, message: `URL must be at most ${max.urlMaxLength} characters` })
      } else if (!HTTP_URL_RE.test(value)) {
        ctx.addIssue({ code: 'custom', path, message: 'URL must start with http:// or https://' })
      }
    }

    // FEAT-038 — all four values are required while the toggle is on; off means `utm: null` and no check at all
    if (data.config.utm.enabled) {
      if (data.config.utm.prefix === '') {
        ctx.addIssue({ code: 'custom', path: ['config', 'utm', 'prefix'], message: UTM_MESSAGES.prefixRequired })
      }
      for (const key of ['source', 'medium', 'campaign'] as const) {
        if (data.config.utm[key] === '') {
          ctx.addIssue({ code: 'custom', path: ['config', 'utm', key], message: UTM_MESSAGES.required })
        }
      }
    }
  })
}

type Schema = z.output<ReturnType<typeof makeSchema>>

// rebuilt when `/options` announces other limits, and when the code input appears / disappears
const schema = computed(() => makeSchema(limits.value, codeIsRequired.value))

// ── body building ────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The complete 6-key config the API expects, from the current state (api-contract §8 "Request rules").
 * `post` carries the code only while the input is on screen — keeping the hint sends the bare
 * `{ selection: 'authCode' }` and never the view's `hasCode` / `codeLast4`.
 */
function configFromState(): AdConfigRequest {
  const c = state.config
  const prefix = c.adNamePrefix.trim()

  const post: AdPostSelection = codeIsRequired.value
    ? { selection: 'authCode', code: c.identity.post.code.trim() }
    : { selection: 'authCode' }

  const page: AdPageSelection = {
    selection: 'create',
    buttonText: c.destination.page.buttonText.trim(),
    url: c.destination.page.url.trim(),
    tone: c.destination.page.tone as AdInstantPageTone,
    language: c.destination.page.language as AdInstantPageLanguage,
    showHandCursor: c.destination.page.showHandCursor
  }

  // dropdown order, only keys the options list still knows
  const picked = new Set(c.cta.values)
  const cta: AdCta = {
    values: props.options.ctaValue
      .map(item => item.value)
      .filter((value): value is AdCtaValue => picked.has(value))
  }

  const impressionUrl = c.tracking.impressionUrl.trim()
  const clickUrl = c.tracking.clickUrl.trim()

  // FEAT-038 — the four strings while the toggle is on, `null` while it is off; never the three ids
  const utm: UtmRefBody | null = c.utm.enabled
    ? {
        prefix: c.utm.prefix.trim(),
        source: c.utm.source.trim(),
        medium: c.utm.medium.trim(),
        campaign: c.utm.campaign.trim()
      }
    : null

  return {
    adNamePrefix: prefix === '' ? null : prefix,
    identity: {
      mode: c.identity.mode as AdConfigRequest['identity']['mode'],
      source: c.identity.source as AdConfigRequest['identity']['source'],
      post
    },
    destination: {
      mode: c.destination.mode as AdConfigRequest['destination']['mode'],
      page
    },
    allowOnTiktokPlatforms: radioToTri(c.allowOnTiktokPlatforms),
    cta,
    tracking: {
      impressionUrl: impressionUrl === '' ? null : impressionUrl,
      clickUrl: clickUrl === '' ? null : clickUrl
    },
    utm
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
  }
  const ra = a as Record<string, unknown>
  const rb = b as Record<string, unknown>
  const keys = new Set([...Object.keys(ra), ...Object.keys(rb)])
  for (const key of keys) {
    if (!deepEqual(ra[key], rb[key])) return false
  }
  return true
}

/** the 7 top-level `config` keys, in `CONFIG_KEYS` order (FEAT-038 api-contract.md v1 §2.1) */
const CONFIG_KEYS = [
  'adNamePrefix', 'identity', 'destination', 'allowOnTiktokPlatforms', 'cta', 'tracking', 'utm'
] as const satisfies readonly (keyof AdConfig)[]

/**
 * The stored config in the shape the form would send it back, so the diff below does not report a change that
 * is not one. A view that includes `code` is compared with that code. A masked view (`hasCode` / `codeLast4`)
 * becomes `{ selection: 'authCode' }`, which is what `configFromState()` builds while the hint is shown.
 * FEAT-038: `utm` is compared **without** the ids (the form never holds them) and a **missing** key counts as
 * `null`, so an old template that is left unbound sends no `utm` in the PATCH at all (spec U1).
 */
function diffBaseFrom(original: AdTemplate): Partial<AdConfigRequest> {
  const config = original.config
  if (!config) return {}
  const base = {
    ...config,
    utm: utmBodyOf(config.utm)
  } as unknown as Partial<AdConfigRequest>
  const post = config.identity?.post
  if (post?.selection !== POST_AUTH_CODE) return base
  const code = storedSparkCode(config).trim()
  const requestPost: AdPostSelection = code
    ? { selection: POST_AUTH_CODE, code }
    : { selection: POST_AUTH_CODE }
  return {
    ...base,
    identity: { ...config.identity, post: requestPost }
  }
}

/**
 * Only the keys whose value really changed; each changed `config` key is sent whole.
 * One addition for FEAT-017 (spec AC-28): as soon as the save carries **anything**, `config.identity` travels
 * with it, even when nothing in it changed — so every real save of an `authCode` template states the post
 * explicitly (`{ selection: 'authCode' }` while the hint is shown, `{ selection: 'authCode', code }` after
 * "Change code") and the API's keep-code rule (§2.4) decides. A save with no change at all still sends nothing
 * ("Nothing changed", FEAT-012).
 */
function patchBodyFrom(original: AdTemplate, name: string, description: string | null): PatchAdTemplateBody {
  const body: PatchAdTemplateBody = {}
  if (name !== original.name) body.name = name
  if (description !== original.description) body.description = description

  const next = configFromState()
  const base = diffBaseFrom(original)
  const changed: Partial<AdConfigRequest> = {}
  let hasConfigChange = false
  for (const key of CONFIG_KEYS) {
    if (!deepEqual(next[key], base[key])) {
      // each key carries its complete value — the API replaces it wholesale
      Object.assign(changed, { [key]: next[key] })
      hasConfigChange = true
    }
  }

  const touched = hasConfigChange || body.name !== undefined || body.description !== undefined
  if (touched && changed.identity === undefined) {
    changed.identity = next.identity
    hasConfigChange = true
  }

  if (hasConfigChange) body.config = changed
  return body
}

// ── API errors → the right field ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Every `UFormField` name an API issue can land on. A collapsed section counts: it is expanded before the message
 * is shown (a collapsed body is hidden, not unmounted); an issue on `config.identity.post.code` additionally
 * brings the password input back (see `showApiError`).
 */
const FIELD_NAMES: ReadonlySet<string> = new Set([
  'name', 'description',
  'config.adNamePrefix',
  'config.identity.mode', 'config.identity.source',
  'config.identity.post.selection', 'config.identity.post.code',
  'config.destination.mode',
  'config.destination.page.selection',
  'config.destination.page.buttonText', 'config.destination.page.url',
  'config.destination.page.tone', 'config.destination.page.language',
  'config.destination.page.showHandCursor',
  'config.allowOnTiktokPlatforms',
  'config.cta.values',
  'config.tracking.impressionUrl', 'config.tracking.clickUrl',
  'config.utm.prefix', 'config.utm.source', 'config.utm.medium', 'config.utm.campaign'
])

/**
 * FEAT-038 — `config.utm` itself (and any deeper path that is not one of the four inputs, e.g. the strict-key
 * refusal `config.utm.sourceId`, which the BO never provokes) belongs to the whole set: it is shown under the
 * section as `adt-utm-error`, not on a field.
 */
function isUtmSectionPath(path: string): boolean {
  if (path === 'config.utm') return true
  return path.startsWith('config.utm.') && !FIELD_NAMES.has(path)
}

/**
 * Issue paths that are not a field themselves, folded onto the control that owns them
 * (api-contract.md "BO-side surfaces" → issue folding).
 */
const ISSUE_FOLD: Readonly<Record<string, string>> = {
  'config.identity': 'config.identity.mode',
  'config.identity.post': 'config.identity.post.selection',
  'config.destination': 'config.destination.mode',
  'config.destination.page': 'config.destination.page.selection',
  'config.cta': 'config.cta.values',
  'config.tracking': 'config.tracking.impressionUrl'
}

/**
 * The `UFormField` an API issue belongs to, or `null` for the form-level alert. An unmatched deeper path is
 * folded segment by segment onto its owner; `catalogVersion`, `config` alone and an empty path match nothing and
 * go to `adt-form-error` (the BO never sends `catalogVersion`).
 */
function resolveFieldName(path: string): string | null {
  let candidate = path
  while (candidate !== '') {
    if (FIELD_NAMES.has(candidate)) return candidate
    const folded = ISSUE_FOLD[candidate]
    if (folded) return folded
    const cut = candidate.lastIndexOf('.')
    if (cut === -1) return null
    candidate = candidate.slice(0, cut)
  }
  return null
}

function showApiError(e: unknown, fallback: string) {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const status = err.response?.status ?? err.statusCode
  const data = err.data

  // 409 duplicate name → always at the name field
  if (status === 409) {
    serverErrors.value.name = data?.error ?? 'Name already used in this workspace'
    return
  }

  // 502 — the API reached the check but the 3rd-party UTM system refused / did not answer (api-contract §2.2).
  // The values stay in the form, the modal stays open, and the reason is readable in both places.
  if (status === 502) {
    const message = data?.error ?? err.message ?? UTM_MESSAGES.gatewayFallback
    utmSectionError.value = message
    expanded.utm = true
    toast.add({
      title: UTM_MESSAGES.gatewayTitle,
      description: message,
      icon: 'i-lucide-triangle-alert',
      color: 'error'
    })
    return
  }

  const issues = data?.issues ?? []
  if (issues.length) {
    const unmatched: { path: string, message: string }[] = []
    const matched: string[] = []
    const next: Record<string, string> = {}
    let utmSection: string | null = null
    for (const issue of issues) {
      // the UTM set as a whole ("ไม่พบ UTM นี้ในระบบปลายทาง …") — under the section, never on a field
      if (isUtmSectionPath(issue.path)) {
        utmSection = issue.message
        matched.push('config.utm')
        continue
      }
      const name = resolveFieldName(issue.path)
      if (name) {
        next[name] = issue.message
        matched.push(name)
      } else unmatched.push(issue)
    }
    serverErrors.value = next
    utmSectionError.value = utmSection
    // the field has to be on screen for its message to be read
    expandSectionsOf(matched)
    // the API refused the code (e.g. the stored post was not `authCode` after all) → the input has to come back
    if (next['config.identity.post.code'] !== undefined) codeMode.value = 'new'
    if (unmatched.length) {
      submitError.value = {
        title: data?.error ?? fallback,
        description: unmatched.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ')
      }
    }
    return
  }

  submitError.value = { title: data?.error ?? err.message ?? fallback }
}

/** client validation failed — open every section that holds an errored field before the messages are read */
function onFormError(event: FormErrorEvent) {
  expandSectionsOf((event.errors ?? []).map(issue => issue.name))
}

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * FEAT-042 — the body really carried a Spark code, so the API started a lookup (api-contract §2.1): a create,
 * or an edit saved while the input was on screen ("Change code"). Keeping the stored code sends the bare
 * `{ selection: 'authCode' }` and changes nothing about the post.
 */
function bodyCarriesCode(config: Partial<AdConfigRequest> | undefined): boolean {
  const post = config?.identity?.post
  if (post?.selection !== POST_AUTH_CODE) return false
  return 'code' in post && typeof post.code === 'string' && post.code !== ''
}

/**
 * FEAT-042 spec A-3 — the save that started a lookup keeps the modal open on the API's answer: edit mode on
 * the saved row (title, "Save", PATCH on the next submit), the post section on its fresh `postInfo`, and the
 * poll while that is `verifying`. The form is re-seeded from the answer so a following save diffs against it.
 */
function stayOpenOn(saved: AdTemplate) {
  savedTemplate.value = saved
  Object.assign(state, stateFrom(saved))
  resetCodeMode()
  submitError.value = null
  clearServerErrors()
  formRef.value?.clear()
  postSession++
  postGaveUp.value = false
  postInfo.value = saved.postInfo ?? null
  if (isPostInfoVerifying(postInfo.value)) startPostPolling()
}

async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  submitError.value = null
  clearServerErrors()

  const name = event.data.name
  const description = event.data.description === '' ? null : event.data.description
  const original = editing.value

  if (original) {
    const body = patchBodyFrom(original, name, description)
    if (Object.keys(body).length === 0) {
      // nothing to send — the API would answer 400 on an empty body
      open.value = false
      toast.add({ title: 'Nothing changed', description: original.name, color: 'info' })
      return
    }
    submitting.value = true
    try {
      // retry: 0 — exactly one PATCH per submit
      const updated = await api<AdTemplate>(`/ad-templates/${encodeURIComponent(original.id)}`, {
        method: 'PATCH',
        body,
        retry: 0
      })
      // a new code started a lookup → stay open and watch it; anything else closes as it always did
      const keepOpen = bodyCarriesCode(body.config)
      if (!keepOpen) open.value = false
      toast.add({ title: 'Template updated', description: updated.name, color: 'success' })
      emit('updated', updated)
      if (keepOpen) stayOpenOn(updated)
    } catch (e) {
      showApiError(e, 'Could not update the template')
    } finally {
      submitting.value = false
    }
    return
  }

  // create always sends the complete 6-key config and never `catalogVersion` (the API stamps it)
  const body: CreateAdTemplateBody = { name, description, config: configFromState() }
  submitting.value = true
  try {
    // retry: 0 — exactly one POST per submit
    const created = await api<AdTemplate>('/ad-templates', { method: 'POST', body, retry: 0 })
    // a create always carries the code, so the modal normally stays open on the new row (FEAT-042 A-3)
    const keepOpen = bodyCarriesCode(body.config)
    if (!keepOpen) open.value = false
    toast.add({ title: 'Template created', description: created.name, color: 'success' })
    emit('created', created)
    if (keepOpen) stayOpenOn(created)
  } catch (e) {
    showApiError(e, 'Could not create the template')
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="isEdit ? 'Edit ad template' : 'Create ad template'"
    :description="isEdit ? 'Changes apply to future orders only.' : 'Starts from the TikTok system defaults.'"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-3xl' }"
    :content="modalContent"
  >
    <template #body>
      <UForm
        ref="formRef"
        :schema="schema"
        :state="state"
        class="space-y-4"
        @submit="onSubmit"
        @error="onFormError"
      >
        <!-- a template saved before FEAT-017 still points at a library post / page → it cannot build yet -->
        <UAlert
          v-if="isLegacyTemplate"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="This template was saved with the old post and page settings"
          description="Builds need a Spark post code and the values of the instant page they create. Fill in the code and the instant page fields below, then save — the old settings are replaced."
          data-testid="adt-legacy-notice"
        />

        <!-- 1. ad name — always open, no toggle -->
        <section class="space-y-4" data-testid="adt-sec-adname">
          <h3 class="text-sm font-semibold text-highlighted">
            ชื่อโฆษณา
          </h3>

          <UFormField
            label="Name"
            name="name"
            required
            :error="serverErrors['name']"
          >
            <UInput
              v-model="state.name"
              placeholder="Spark promo"
              class="w-full"
              :disabled="submitting"
              data-testid="adt-form-name"
            />
          </UFormField>

          <UFormField
            label="Description"
            name="description"
            hint="Optional"
            :error="serverErrors['description']"
          >
            <UTextarea
              v-model="state.description"
              :rows="2"
              placeholder="What this template is for"
              class="w-full"
              :disabled="submitting"
              data-testid="adt-form-description"
            />
          </UFormField>

          <UFormField
            label="Ad name prefix"
            name="config.adNamePrefix"
            hint="Optional"
            help="Leave empty to let TikTok name the ad automatically."
            :error="serverErrors['config.adNamePrefix']"
          >
            <UInput
              v-model="state.config.adNamePrefix"
              placeholder="TH-"
              class="w-full"
              :disabled="submitting"
              data-testid="adt-form-prefix"
            />
          </UFormField>
        </section>

        <!-- 2. identity (Spark Ads › authorized posts) -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.identity"
              aria-controls="adt-sec-identity"
              data-testid="adt-sec-identity-toggle"
              @click="toggleSection('identity')"
            >
              <UIcon
                :name="expanded.identity ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>ตัวตน</span>
              <UBadge
                v-if="sectionIsDefault.identity"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="adt-sec-identity-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.identity"
            id="adt-sec-identity"
            class="mt-4 space-y-4"
            data-testid="adt-sec-identity"
          >
            <UFormField
              label="Identity"
              name="config.identity.mode"
              required
              :error="serverErrors['config.identity.mode']"
            >
              <URadioGroup
                v-model="state.config.identity.mode"
                :items="options.identityMode"
                value-key="value"
                :disabled="submitting"
                data-testid="adt-form-identity-mode"
              />
            </UFormField>

            <UFormField
              label="Source"
              name="config.identity.source"
              required
              :error="serverErrors['config.identity.source']"
            >
              <URadioGroup
                v-model="state.config.identity.source"
                :items="options.identitySource"
                value-key="value"
                :disabled="submitting"
                data-testid="adt-form-identity-source"
              />
            </UFormField>

            <!-- the post source is fixed (`authCode`); only its label comes from `/options` -->
            <UFormField
              label="Post"
              name="config.identity.post.selection"
              :error="serverErrors['config.identity.post.selection']"
            >
              <p class="text-sm text-highlighted" data-testid="adt-form-post-selection">
                {{ postSelectionLabel }}
              </p>
            </UFormField>

            <UFormField
              v-if="codeIsRequired"
              label="Spark post code"
              name="config.identity.post.code"
              required
              help="The authorization code of the TikTok post. Shown again when you edit this template."
              :error="serverErrors['config.identity.post.code']"
            >
              <UInput
                v-model="state.config.identity.post.code"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="Paste the code"
                class="w-full"
                :maxlength="500"
                :disabled="submitting"
                data-testid="adt-post-code"
              />
              <template v-if="hasStoredCode" #hint>
                <UButton
                  label="Keep the saved code"
                  color="neutral"
                  variant="link"
                  size="xs"
                  class="p-0"
                  :disabled="submitting"
                  data-testid="adt-post-code-keep"
                  @click="keepCode"
                />
              </template>
            </UFormField>

            <UFormField
              v-else
              label="Spark post code"
              name="config.identity.post.code"
              :error="serverErrors['config.identity.post.code']"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="font-mono text-sm text-highlighted"
                  data-testid="adt-post-code-hint"
                >{{ codeHint }}</span>
                <UButton
                  label="Change code"
                  icon="i-lucide-key-round"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  :disabled="submitting"
                  data-testid="adt-post-code-change"
                  @click="changeCode"
                />
              </div>
              <template #help>
                The saved code is kept unless you change it.
              </template>
            </UFormField>

            <!--
              FEAT-042 — what TikTok says the saved code points at. Rendered for every template that exists
              (including one that was never checked) and right after a save that started a lookup; never for a
              create that has not been saved yet. The code itself is not part of it.
            -->
            <div
              v-if="isEdit"
              class="space-y-2 rounded-lg border border-default bg-elevated/30 p-3"
              data-testid="adt-post-info"
              :data-polling="postPolling ? 'true' : 'false'"
              :data-status="postInfoStatusAttr(postInfo)"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-medium text-highlighted">โพสต์ที่ผูกไว้</span>
                <AdTemplatesPostStatus :post-info="postInfo" />
                <UButton
                  v-if="!postIsVerifying"
                  :label="postIsVerified ? 'ตรวจอีกครั้ง' : 'ตรวจ'"
                  :icon="postIsVerified ? 'i-lucide-refresh-cw' : 'i-lucide-search-check'"
                  color="neutral"
                  variant="outline"
                  size="xs"
                  class="ms-auto"
                  :loading="postVerifying"
                  :disabled="submitting"
                  data-testid="adt-post-verify"
                  @click="verifyPost"
                />
              </div>

              <div v-if="postIsVerified" class="flex items-start gap-3" data-testid="adt-post-card">
                <AdTemplatesPostCover
                  :template-id="postTemplateId"
                  :checked-at="postCheckedAt"
                  :ok="hasPostCover(postInfo)"
                  size="card"
                />
                <div class="min-w-0 flex-1 space-y-1">
                  <p class="truncate text-sm font-medium text-highlighted" data-testid="adt-post-owner">
                    {{ postInfo?.ownerName ?? '—' }}
                  </p>
                  <p
                    v-if="postCaption"
                    class="line-clamp-2 text-xs break-words text-muted"
                    data-testid="adt-post-caption"
                  >
                    {{ postCaption }}
                  </p>
                  <div class="flex flex-wrap items-center gap-2">
                    <UBadge
                      v-if="postKind"
                      color="neutral"
                      variant="subtle"
                      size="sm"
                      class="whitespace-nowrap"
                      data-testid="adt-post-kind"
                    >
                      {{ postKind }}
                    </UBadge>
                    <span v-if="postUntil" class="text-xs text-muted" data-testid="adt-post-until">
                      {{ postUntil }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- `invalid`: TikTok's own answer · `failed`: why we could not ask -->
              <p
                v-if="postReason"
                class="text-xs break-words"
                :class="postInfo?.status === 'invalid' ? 'text-error' : 'text-warning'"
                data-testid="adt-post-reason"
              >
                {{ postReason }}
              </p>

              <p v-if="postGaveUp" class="text-xs text-muted" data-testid="adt-post-timeout">
                ยังไม่ได้ผล — ปิดแล้วดูในตารางได้
              </p>
            </div>
          </div>
        </section>

        <!-- 3. destination (instant page) + platform consent -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.destination"
              aria-controls="adt-sec-destination"
              data-testid="adt-sec-destination-toggle"
              @click="toggleSection('destination')"
            >
              <UIcon
                :name="expanded.destination ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>จุดหมายปลายทาง</span>
              <UBadge
                v-if="sectionIsDefault.destination"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="adt-sec-destination-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.destination"
            id="adt-sec-destination"
            class="mt-4 space-y-4"
            data-testid="adt-sec-destination"
          >
            <UFormField
              label="Destination"
              name="config.destination.mode"
              required
              :error="serverErrors['config.destination.mode']"
            >
              <URadioGroup
                v-model="state.config.destination.mode"
                :items="options.destinationMode"
                value-key="value"
                :disabled="submitting"
                data-testid="adt-form-destination-mode"
              />
            </UFormField>

            <!-- the destination is fixed (`create`); only its label comes from `/options` -->
            <UFormField
              label="Instant page"
              name="config.destination.page.selection"
              :error="serverErrors['config.destination.page.selection']"
            >
              <p class="text-sm text-highlighted" data-testid="adt-form-page-selection">
                {{ pageSelectionLabel }}
              </p>
            </UFormField>

            <UFormField
              label="Button text"
              name="config.destination.page.buttonText"
              required
              help="The call-to-action button on the instant page the build creates."
              :error="serverErrors['config.destination.page.buttonText']"
            >
              <UInput
                v-model="state.config.destination.page.buttonText"
                placeholder="Shop now"
                class="w-full"
                :maxlength="limits.textMaxLength"
                :disabled="submitting"
                data-testid="adt-page-button-text"
              />
            </UFormField>

            <UFormField
              label="Landing page URL"
              name="config.destination.page.url"
              required
              help="Where the button sends the viewer. https:// only."
              :error="serverErrors['config.destination.page.url']"
            >
              <UInput
                v-model="state.config.destination.page.url"
                type="text"
                inputmode="url"
                placeholder="https://shop.example/promo"
                class="w-full"
                :disabled="submitting"
                data-testid="adt-page-url"
              />
            </UFormField>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Tone"
                name="config.destination.page.tone"
                required
                :error="serverErrors['config.destination.page.tone']"
              >
                <USelect
                  v-model="state.config.destination.page.tone"
                  :items="options.instantPageTone"
                  value-key="value"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="adt-page-tone"
                />
              </UFormField>

              <UFormField
                label="Language"
                name="config.destination.page.language"
                required
                :error="serverErrors['config.destination.page.language']"
              >
                <USelect
                  v-model="state.config.destination.page.language"
                  :items="options.instantPageLanguage"
                  value-key="value"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="adt-page-language"
                />
              </UFormField>
            </div>

            <UFormField
              name="config.destination.page.showHandCursor"
              :error="serverErrors['config.destination.page.showHandCursor']"
            >
              <UCheckbox
                v-model="state.config.destination.page.showHandCursor"
                label="Show hand cursor"
                description="The animated hand pointing at the button."
                :disabled="submitting"
                data-testid="adt-page-hand-cursor"
              />
            </UFormField>

            <UFormField
              label="TikTok platforms consent"
              name="config.allowOnTiktokPlatforms"
              required
              :error="serverErrors['config.allowOnTiktokPlatforms']"
            >
              <URadioGroup
                v-model="state.config.allowOnTiktokPlatforms"
                :items="options.triState"
                value-key="value"
                orientation="horizontal"
                :ui="{ fieldset: 'flex-wrap' }"
                :disabled="submitting"
                data-testid="adt-form-consent"
              />
              <template #help>
                <span data-testid="adt-form-consent-label">{{ options.allowOnTiktokPlatformsLabel }}</span>
              </template>
            </UFormField>
          </div>
        </section>

        <!-- 4. call to action -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.cta"
              aria-controls="adt-sec-cta"
              data-testid="adt-sec-cta-toggle"
              @click="toggleSection('cta')"
            >
              <UIcon
                :name="expanded.cta ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>Call to action</span>
              <UBadge
                v-if="sectionIsDefault.cta"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="adt-sec-cta-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.cta"
            id="adt-sec-cta"
            class="mt-4 space-y-4"
            data-testid="adt-sec-cta"
          >
            <UFormField
              label="Call to action"
              name="config.cta.values"
              required
              :error="serverErrors['config.cta.values']"
            >
              <USelectMenu
                v-model="state.config.cta.values"
                multiple
                :items="options.ctaValue"
                value-key="value"
                placeholder="Select call to action"
                class="w-full"
                :disabled="submitting"
                data-testid="adt-form-cta"
              />
            </UFormField>
          </div>
        </section>

        <!-- 5. third-party tracking -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.tracking"
              aria-controls="adt-sec-tracking"
              data-testid="adt-sec-tracking-toggle"
              @click="toggleSection('tracking')"
            >
              <UIcon
                :name="expanded.tracking ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>การตั้งค่าการติดตามของบริษัทอื่น</span>
              <UBadge
                v-if="sectionIsDefault.tracking"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="adt-sec-tracking-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.tracking"
            id="adt-sec-tracking"
            class="mt-4 space-y-4"
            data-testid="adt-sec-tracking"
          >
            <UFormField
              label="Impression tracking URL"
              name="config.tracking.impressionUrl"
              hint="Optional"
              :error="serverErrors['config.tracking.impressionUrl']"
            >
              <UInput
                v-model="state.config.tracking.impressionUrl"
                type="text"
                inputmode="url"
                placeholder="https://tracker.example/impression"
                class="w-full"
                :disabled="submitting"
                data-testid="adt-form-impression-url"
              />
            </UFormField>

            <UFormField
              label="Click tracking URL"
              name="config.tracking.clickUrl"
              hint="Optional"
              :error="serverErrors['config.tracking.clickUrl']"
            >
              <UInput
                v-model="state.config.tracking.clickUrl"
                type="text"
                inputmode="url"
                placeholder="https://tracker.example/click"
                class="w-full"
                :disabled="submitting"
                data-testid="adt-form-click-url"
              />
            </UFormField>
          </div>
        </section>

        <!-- 6. UTM (FEAT-038) — ours, not TikTok's: which UTM set the ad's sign-up link counts under -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.utm"
              aria-controls="adt-sec-utm"
              data-testid="adt-sec-utm-toggle"
              @click="toggleSection('utm')"
            >
              <UIcon
                :name="expanded.utm ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>UTM</span>
              <UBadge
                v-if="sectionIsDefault.utm"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="adt-sec-utm-default"
              >
                ไม่ผูก
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.utm"
            id="adt-sec-utm"
            class="mt-4 space-y-4"
            data-testid="adt-sec-utm"
          >
            <p class="text-xs text-muted" data-testid="adt-sec-utm-hint">
              ต้องสร้างในระบบปลายทางไว้ก่อน และชื่อต้องตรงทุกตัวอักษร
            </p>

            <USwitch
              v-model="state.config.utm.enabled"
              label="ผูก UTM"
              :disabled="submitting"
              data-testid="adt-utm-enabled"
            />

            <!--
              The list is a GOD setting: while it is empty nothing can be bound, so the line stays readable
              whether or not the toggle is on (the select below is disabled for the same reason).
            -->
            <p
              v-if="noUtmPrefixes"
              class="flex flex-wrap items-center gap-1 text-xs text-muted"
              data-testid="adt-utm-no-prefixes"
            >
              <span>ยังไม่ตั้งรายการ Prefix</span>
              <!-- only a GOD can maintain the list (the page itself is GOD-only, spec AS-9) -->
              <NuxtLink
                v-if="isGod"
                to="/settings/utm"
                class="text-primary hover:underline"
                data-testid="adt-utm-settings-link"
              >
                ตั้งค่าที่ Settings
              </NuxtLink>
            </p>

            <!-- `v-show`, like the section bodies themselves: the four fields are hidden while the toggle is off -->
            <div v-show="state.config.utm.enabled" class="space-y-4">
              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  label="Prefix"
                  name="config.utm.prefix"
                  required
                  :error="serverErrors['config.utm.prefix']"
                >
                  <USelect
                    v-model="state.config.utm.prefix"
                    :items="utmPrefixItems"
                    placeholder="— เลือก Prefix —"
                    class="w-full"
                    :disabled="submitting || noUtmPrefixes"
                    data-testid="adt-utm-prefix"
                  />
                </UFormField>

                <!-- helper only: `parseUtm` fills the three inputs; the text itself is never sent -->
                <UFormField label="วาง URL หรือ query เพื่อแยกค่าให้">
                  <UInput
                    :model-value="utmPaste"
                    placeholder="utm_source=facebook&amp;utm_medium=ads&amp;utm_campaign=vip"
                    class="w-full"
                    autocomplete="off"
                    spellcheck="false"
                    :disabled="submitting"
                    data-testid="adt-utm-paste"
                    @update:model-value="onUtmPaste(String($event))"
                  />
                </UFormField>
              </div>

              <div class="grid gap-4 sm:grid-cols-3">
                <UFormField
                  label="utm_source"
                  name="config.utm.source"
                  required
                  :error="serverErrors['config.utm.source']"
                >
                  <UInput
                    v-model="state.config.utm.source"
                    placeholder="facebook"
                    class="w-full"
                    :maxlength="UTM_NAME_MAX_LENGTH"
                    :disabled="submitting"
                    data-testid="adt-utm-source"
                  />
                </UFormField>

                <UFormField
                  label="utm_medium"
                  name="config.utm.medium"
                  required
                  :error="serverErrors['config.utm.medium']"
                >
                  <UInput
                    v-model="state.config.utm.medium"
                    placeholder="ads"
                    class="w-full"
                    :maxlength="UTM_NAME_MAX_LENGTH"
                    :disabled="submitting"
                    data-testid="adt-utm-medium"
                  />
                </UFormField>

                <UFormField
                  label="utm_campaign"
                  name="config.utm.campaign"
                  required
                  :error="serverErrors['config.utm.campaign']"
                >
                  <UInput
                    v-model="state.config.utm.campaign"
                    placeholder="vip"
                    class="w-full"
                    :maxlength="UTM_NAME_MAX_LENGTH"
                    :disabled="submitting"
                    data-testid="adt-utm-campaign"
                  />
                </UFormField>
              </div>

              <!-- display-only: the ids the API got from the UTM system on the last successful save -->
              <p v-if="utmIds" class="text-xs break-all text-muted" data-testid="adt-utm-ids">
                {{ utmIds }}
              </p>
            </div>

            <!-- the set as a whole was refused (400 `config.utm`) or could not be checked (502) -->
            <p
              v-if="utmSectionError"
              class="text-sm break-words text-error"
              role="alert"
              data-testid="adt-utm-error"
            >
              {{ utmSectionError }}
            </p>
          </div>
        </section>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="adt-form-error"
        />
      </UForm>
    </template>

    <!-- actions in the footer so they stay reachable while the 5 sections scroll (390x844) -->
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton
          label="Reset to TikTok defaults"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="outline"
          class="me-auto"
          :disabled="submitting"
          data-testid="adt-form-reset"
          @click="resetToDefaults"
        />
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="adt-form-cancel"
          @click="open = false"
        />
        <UButton
          :label="isEdit ? 'Save' : 'Create'"
          :icon="isEdit ? 'i-lucide-check' : 'i-lucide-plus'"
          color="primary"
          variant="solid"
          :loading="submitting"
          data-testid="adt-form-submit"
          @click="formRef?.submit()"
        />
      </div>
    </template>
  </UModal>
</template>
