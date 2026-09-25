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
 * Layout: five sections in the TikTok page order as an **accordion**. `adname` is always open and has no toggle;
 * `identity` / `destination` / `cta` / `tracking` sit behind `adt-sec-<id>-toggle`, are collapsed while every
 * control in them equals `options.systemDefault` (badge `adt-sec-<id>-default` = `Default`, live) and auto-expand
 * when one of their fields carries a client or API error.
 * The collapsed body is hidden with `v-show` (never unmounted) so every value is still submitted and an error can
 * be rendered the moment its section opens — `UCollapsible`'s `unmountOnHide: false` only sets
 * `hidden="until-found"`, which is not reliably "hidden" for a test runner, and unmounting would drop the field an
 * error has to land on.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormErrorEvent, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdConfig,
  AdCta,
  AdCtaValue,
  AdPageSelection,
  AdPostSelection,
  AdTemplate,
  AdTemplateLimits,
  AdTemplateOptions,
  CreateAdTemplateBody,
  PatchAdTemplateBody,
  TriState
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

const isEdit = computed(() => props.template !== null)

// ── form state (mirrors the API body; every enum is a plain string so an unknown option value still renders) ─────────
interface ConfigState {
  adNamePrefix: string
  /** `post.text` is kept while `post.selection === 'first'` so switching back restores what was typed */
  identity: { mode: string, source: string, post: { selection: string, text: string } }
  destination: { mode: string, page: { selection: string, name: string } }
  /** UI-only encoding of the tri-state: `inherit` ↔ null, `on` ↔ true, `off` ↔ false */
  allowOnTiktokPlatforms: string
  /** `value` is kept while `mode === 'dynamic'`; empty means "nothing picked yet" */
  cta: { mode: string, value: string }
  tracking: { impressionUrl: string, clickUrl: string }
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

/** the config part of the state, from any `AdConfig` (the system default on create, the row on edit) */
function configStateFrom(config: AdConfig): ConfigState {
  const post = config?.identity?.post
  const page = config?.destination?.page
  const cta = config?.cta
  return {
    adNamePrefix: config?.adNamePrefix ?? '',
    identity: {
      mode: config?.identity?.mode ?? '',
      source: config?.identity?.source ?? '',
      post: {
        selection: post?.selection ?? 'first',
        text: post?.selection === 'named' ? post.text ?? '' : ''
      }
    },
    destination: {
      mode: config?.destination?.mode ?? '',
      page: {
        selection: page?.selection ?? 'first',
        name: page?.selection === 'named' ? page.name ?? '' : ''
      }
    },
    allowOnTiktokPlatforms: triToRadio(config?.allowOnTiktokPlatforms),
    cta: {
      mode: cta?.mode ?? 'dynamic',
      value: cta?.mode === 'standard' ? cta.value ?? '' : ''
    },
    tracking: {
      impressionUrl: config?.tracking?.impressionUrl ?? '',
      clickUrl: config?.tracking?.clickUrl ?? ''
    }
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

function clearServerErrors() {
  serverErrors.value = {}
}

// any edit invalidates what the server said about the form
watch(state, clearServerErrors, { deep: true })

// the submit button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

// ── accordion (five sections in the TikTok page order) ───────────────────────────────────────────────────────────────
type SectionId = 'adname' | 'identity' | 'destination' | 'cta' | 'tracking'

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
  { id: 'tracking' as const, heading: 'การตั้งค่าการติดตามของบริษัทอื่น', keys: ['tracking'] as const }
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

// ── conditional controls ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * A conditional control is also rendered while the API complained about it: a message has to be readable, and the
 * control is what the user has to fix. Editing anything clears the server errors, so it disappears again as soon
 * as the selection really says `first` / `dynamic`.
 */
const showPostText = computed(() =>
  state.config.identity.post.selection === 'named' || serverErrors.value['config.identity.post.text'] !== undefined
)
const showPageName = computed(() =>
  state.config.destination.page.selection === 'named' || serverErrors.value['config.destination.page.name'] !== undefined
)
const showCtaValue = computed(() =>
  state.config.cta.mode === 'standard' || serverErrors.value['config.cta.value'] !== undefined
)

// ── "Default" badges (live) ──────────────────────────────────────────────────────────────────────────────────────────
/** the config the current state would send — the single source for the badges and for the POST/PATCH bodies */
const currentConfig = computed(() => configFromState())

const sectionIsDefault = computed<Record<string, boolean>>(() => {
  const next = currentConfig.value
  const base = props.options.systemDefault
  return Object.fromEntries(
    SECTIONS.map(section =>
      [section.id, section.keys.every(key => deepEqual(next[key], base?.[key]))] as [string, boolean]
    )
  )
})

/** collapse every section that is at the system default, expand the others (open, reset, reset-to-defaults) */
function syncExpanded() {
  const byDefault = sectionIsDefault.value
  for (const id of COLLAPSIBLE_IDS) expanded[id] = !byDefault[id]
}

function resetForm() {
  Object.assign(state, stateFrom(props.template))
  submitting.value = false
  submitError.value = null
  clearServerErrors()
  formRef.value?.clear()
  syncExpanded()
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})

/** "Reset to TikTok defaults" — config controls only, name/description untouched, no request */
function resetToDefaults() {
  state.config = configStateFrom(props.options.systemDefault)
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

function makeSchema(max: AdTemplateLimits) {
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
          text: z.string().trim().max(
            max.textMaxLength,
            `Post text must be at most ${max.textMaxLength} characters`
          )
        })
      }),
      destination: z.object({
        mode: z.string().min(1, 'Destination is required'),
        page: z.object({
          selection: z.string().min(1, 'Page selection is required'),
          name: z.string().trim().max(
            max.textMaxLength,
            `Page name must be at most ${max.textMaxLength} characters`
          )
        })
      }),
      allowOnTiktokPlatforms: z.string().min(1, 'Consent is required'),
      cta: z.object({
        mode: z.string().min(1, 'Call to action is required'),
        value: z.string()
      }),
      tracking: z.object({
        impressionUrl: z.string().trim(),
        clickUrl: z.string().trim()
      })
    })
  }).superRefine((data, ctx) => {
    // a named post needs its caption text
    if (data.config.identity.post.selection === 'named' && data.config.identity.post.text === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'identity', 'post', 'text'],
        message: 'Post text is required'
      })
    }

    // a named instant page needs its name
    if (data.config.destination.page.selection === 'named' && data.config.destination.page.name === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'destination', 'page', 'name'],
        message: 'Page name is required'
      })
    }

    // a standard CTA needs a value
    if (data.config.cta.mode === 'standard' && data.config.cta.value === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'cta', 'value'],
        message: 'Select a call to action'
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
  })
}

type Schema = z.output<ReturnType<typeof makeSchema>>

// rebuilt when `/options` announces other limits
const schema = computed(() => makeSchema(limits.value))

// ── body building ────────────────────────────────────────────────────────────────────────────────────────────────────
/** the complete 6-key `AdConfig` the API expects, from the current state */
function configFromState(): AdConfig {
  const c = state.config
  const prefix = c.adNamePrefix.trim()

  const post: AdPostSelection = c.identity.post.selection === 'named'
    ? { selection: 'named', text: c.identity.post.text.trim() }
    : { selection: 'first' }

  const page: AdPageSelection = c.destination.page.selection === 'named'
    ? { selection: 'named', name: c.destination.page.name.trim() }
    : { selection: 'first' }

  // `dynamic` never carries a value (the API rejects it as an unknown key)
  const cta: AdCta = c.cta.mode === 'standard'
    ? { mode: 'standard', value: c.cta.value as AdCtaValue }
    : { mode: 'dynamic' }

  const impressionUrl = c.tracking.impressionUrl.trim()
  const clickUrl = c.tracking.clickUrl.trim()

  return {
    adNamePrefix: prefix === '' ? null : prefix,
    identity: {
      mode: c.identity.mode as AdConfig['identity']['mode'],
      source: c.identity.source as AdConfig['identity']['source'],
      post
    },
    destination: {
      mode: c.destination.mode as AdConfig['destination']['mode'],
      page
    },
    allowOnTiktokPlatforms: radioToTri(c.allowOnTiktokPlatforms),
    cta,
    tracking: {
      impressionUrl: impressionUrl === '' ? null : impressionUrl,
      clickUrl: clickUrl === '' ? null : clickUrl
    }
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

/** the 6 top-level `config` keys, in `CONFIG_KEYS` order (api-contract.md v1) */
const CONFIG_KEYS = [
  'adNamePrefix', 'identity', 'destination', 'allowOnTiktokPlatforms', 'cta', 'tracking'
] as const satisfies readonly (keyof AdConfig)[]

/** only the keys whose value really changed; each changed `config` key is sent whole */
function patchBodyFrom(original: AdTemplate, name: string, description: string | null): PatchAdTemplateBody {
  const body: PatchAdTemplateBody = {}
  if (name !== original.name) body.name = name
  if (description !== original.description) body.description = description

  const next = configFromState()
  const changed: Partial<AdConfig> = {}
  let hasConfigChange = false
  for (const key of CONFIG_KEYS) {
    if (!deepEqual(next[key], original.config?.[key])) {
      // each key carries its complete value — the API replaces it wholesale
      Object.assign(changed, { [key]: next[key] })
      hasConfigChange = true
    }
  }
  if (hasConfigChange) body.config = changed
  return body
}

// ── API errors → the right field ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Every `UFormField` name an API issue can land on. A collapsed section counts: it is expanded before the message
 * is shown (a collapsed body is hidden, not unmounted), and a conditional control is rendered while it carries a
 * server error.
 */
const FIELD_NAMES: ReadonlySet<string> = new Set([
  'name', 'description',
  'config.adNamePrefix',
  'config.identity.mode', 'config.identity.source',
  'config.identity.post.selection', 'config.identity.post.text',
  'config.destination.mode',
  'config.destination.page.selection', 'config.destination.page.name',
  'config.allowOnTiktokPlatforms',
  'config.cta.mode', 'config.cta.value',
  'config.tracking.impressionUrl', 'config.tracking.clickUrl'
])

/**
 * Issue paths that are not a field themselves, folded onto the control that owns them
 * (api-contract.md "BO-side surfaces" → issue folding).
 */
const ISSUE_FOLD: Readonly<Record<string, string>> = {
  'config.identity': 'config.identity.mode',
  'config.identity.post': 'config.identity.post.selection',
  'config.destination': 'config.destination.mode',
  'config.destination.page': 'config.destination.page.selection',
  'config.cta': 'config.cta.mode',
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

  const issues = data?.issues ?? []
  if (issues.length) {
    const unmatched: { path: string, message: string }[] = []
    const matched: string[] = []
    const next: Record<string, string> = {}
    for (const issue of issues) {
      const name = resolveFieldName(issue.path)
      if (name) {
        next[name] = issue.message
        matched.push(name)
      } else unmatched.push(issue)
    }
    serverErrors.value = next
    // the field has to be on screen for its message to be read
    expandSectionsOf(matched)
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
async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  submitError.value = null
  clearServerErrors()

  const name = event.data.name
  const description = event.data.description === '' ? null : event.data.description
  const original = props.template

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
      open.value = false
      toast.add({ title: 'Template updated', description: updated.name, color: 'success' })
      emit('updated', updated)
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
    open.value = false
    toast.add({ title: 'Template created', description: created.name, color: 'success' })
    emit('created', created)
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

            <UFormField
              label="Post"
              name="config.identity.post.selection"
              required
              :error="serverErrors['config.identity.post.selection']"
            >
              <URadioGroup
                v-model="state.config.identity.post.selection"
                :items="options.postSelection"
                value-key="value"
                orientation="horizontal"
                :ui="{ fieldset: 'flex-wrap' }"
                :disabled="submitting"
                data-testid="adt-form-post-selection"
              />
            </UFormField>

            <UFormField
              v-if="showPostText"
              label="Post text"
              name="config.identity.post.text"
              required
              help="The caption or hashtag the job matches in the authorized posts list."
              :error="serverErrors['config.identity.post.text']"
            >
              <UInput
                v-model="state.config.identity.post.text"
                placeholder="#fyp"
                class="w-full"
                :disabled="submitting"
                data-testid="adt-form-post-text"
              />
            </UFormField>
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

            <UFormField
              label="Instant page"
              name="config.destination.page.selection"
              required
              :error="serverErrors['config.destination.page.selection']"
            >
              <URadioGroup
                v-model="state.config.destination.page.selection"
                :items="options.pageSelection"
                value-key="value"
                orientation="horizontal"
                :ui="{ fieldset: 'flex-wrap' }"
                :disabled="submitting"
                data-testid="adt-form-page-selection"
              />
            </UFormField>

            <UFormField
              v-if="showPageName"
              label="Instant page name"
              name="config.destination.page.name"
              required
              help="The job picks the library page whose name contains this text."
              :error="serverErrors['config.destination.page.name']"
            >
              <UInput
                v-model="state.config.destination.page.name"
                placeholder="Promo page"
                class="w-full"
                :disabled="submitting"
                data-testid="adt-form-page-name"
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
              name="config.cta.mode"
              required
              :error="serverErrors['config.cta.mode']"
            >
              <URadioGroup
                v-model="state.config.cta.mode"
                :items="options.ctaMode"
                value-key="value"
                orientation="horizontal"
                :ui="{ fieldset: 'flex-wrap' }"
                :disabled="submitting"
                data-testid="adt-form-cta-mode"
              />
            </UFormField>

            <UFormField
              v-if="showCtaValue"
              label="Call to action text"
              name="config.cta.value"
              required
              :error="serverErrors['config.cta.value']"
            >
              <URadioGroup
                v-model="state.config.cta.value"
                :items="options.ctaValue"
                value-key="value"
                orientation="horizontal"
                :ui="{ fieldset: 'flex-wrap' }"
                :disabled="submitting"
                data-testid="adt-form-cta-value"
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
