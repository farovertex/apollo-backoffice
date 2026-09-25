<script setup lang="ts">
/**
 * FEAT-008 + FEAT-011 — Create / Edit ad group template (function 6.8; api-contract.md **v2**
 * `POST /ad-group-templates`, `PATCH /ad-group-templates/:id`).
 *
 * One component for both modes: `template === null` → create (`POST` with a **complete 19-key** config prefilled
 * from `options.systemDefault`, never `catalogVersion`), a row → edit (`PATCH` with **only the changed keys**; each
 * changed top-level `config` key is sent whole — assumption A3).
 *
 * Every select / radio / checkbox list is built from `options` (`{ value, label }`), so no enum label is
 * hard-coded in the BO (the six section headings and the min-budget wording are the only Thai strings here).
 * The form state mirrors the API body (`name`, `description`, `config.*`), which makes a zod issue path and an API
 * `issues[].path` land on the same `UFormField` name (`config.budget.amount`, `config.interests`, …).
 * `config.schedule.startMode` is the only UI-only key: it decides whether `startTime` is the literal `'now'` or
 * the ISO value of the `datetime-local` picker (assumption A9, browser-local time).
 *
 * FEAT-011 layout: six sections in the TikTok page order as an **accordion**. `adgroup` is always open and has no
 * toggle; `placement` / `audience` / `budget` / `bidding` / `advanced` sit behind `agt-sec-<id>-toggle`, are
 * collapsed while every control in them equals `options.systemDefault` (badge `agt-sec-<id>-default` = `Default`,
 * live) and auto-expand when one of their fields carries a client or API error.
 * The collapsed body is hidden with `v-show` (never unmounted) so every value is still submitted and an error can
 * be rendered the moment its section opens — `UCollapsible`'s `unmountOnHide: false` only sets
 * `hidden="until-found"`, which is not reliably "hidden" for a test runner, and unmounting would drop the field an
 * error has to land on.
 * The tri-state advanced-placement toggles map `inherit ↔ null`, `on ↔ true`, `off ↔ false` (A3); the four
 * free-text lists are `UInputTags` validated against `options.listLimits`.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormErrorEvent, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupAdvancedPlacement,
  AdGroupConfig,
  AdGroupDataConnection,
  AdGroupListLimits,
  AdGroupSavedAudience,
  AdGroupSchedule,
  AdGroupTemplate,
  AdGroupTemplateOptions,
  CreateAdGroupTemplateBody,
  OptionItem,
  PatchAdGroupTemplateBody,
  TriState
} from '#shared/types/ad-group-templates'

const props = defineProps<{
  /** null = create, a row = edit */
  template: AdGroupTemplate | null
  /** fetched once per page lifetime and passed down — the modal never re-fetches it */
  options: AdGroupTemplateOptions
}>()

const emit = defineEmits<{
  created: [template: AdGroupTemplate]
  updated: [template: AdGroupTemplate]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `agt-form-modal`).
const modalContent = { 'data-testid': 'agt-form-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const isEdit = computed(() => props.template !== null)

// ── form state (mirrors the API body; every enum is a plain string so an unknown option value still renders) ─────────
interface ScheduleState {
  mode: string
  /** UI-only: `now` = send the literal 'now', `scheduled` = send `startTime` as ISO */
  startMode: string
  /** `datetime-local` value, browser-local time */
  startTime: string
  /** `datetime-local` value, browser-local time */
  endTime: string
}

interface ConfigState {
  adGroupNamePrefix: string
  placement: string
  dataConnection: { mode: string, name: string }
  optimizationEvent: string
  locations: string[]
  ageGroups: string[]
  gender: string
  budget: { type: string, amount: string, currency: string }
  schedule: ScheduleState
  timezone: string
  dayparting: string
  optimizationGoal: string
  costCap: string
  /** v2 — `name` is kept while `mode === 'none'` so switching back restores what was typed */
  savedAudience: { mode: string, name: string }
  audiences: { include: string[], exclude: string[] }
  interests: string[]
  languages: string[]
  spendingPower: string
  /** v2 — one `advancedPlacementState` value (`inherit` / `on` / `off`) per `advancedPlacementKey` */
  advancedPlacement: Record<string, string>
}

interface FormState {
  name: string
  description: string
  config: ConfigState
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO (UTC) → the `datetime-local` value in the browser's local time (A9) */
function isoToLocalInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** the `datetime-local` value (browser-local) → ISO (UTC) for the API (A9) */
function localInputToIso(local: string): string {
  const d = new Date(local)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

/**
 * BUG-008 — the picker only has minute resolution, so rebuilding an ISO from it drops the seconds/milliseconds a
 * stored value may carry (`new Date().toISOString()`). That made an untouched schedule look changed, which both
 * broke "changed keys only" (AC-9) and made a template with a past start time unsavable (the API re-checks
 * `startTime >= now` whenever `schedule` is sent).
 * The instant the value came from is therefore kept and re-emitted **unchanged** while the picker still shows the
 * same minute; only a real edit produces a new ISO.
 */
const originalTimes = reactive<{ startTime: string | null, endTime: string | null }>({ startTime: null, endTime: null })

function rememberTimes(config: AdGroupConfig) {
  const start = config.schedule?.startTime
  originalTimes.startTime = typeof start === 'string' && start !== 'now' ? start : null
  originalTimes.endTime = config.schedule?.mode === 'dateRange' ? config.schedule.endTime ?? null : null
}

/** the ISO to send for a picker value: the stored instant while the minute is unchanged, a fresh one otherwise */
function isoFromPicker(local: string, original: string | null): string {
  if (original && isoToLocalInput(original) === local) return original
  return localInputToIso(local)
}

// ── tri-state advanced placement (`inherit ↔ null`, `on ↔ true`, `off ↔ false` — A3) ─────────────────────────────────
/** the five `config.advancedPlacement` keys of the contract; the *order* on screen comes from `/options` */
const ADVANCED_KEYS = [
  'organicComments', 'comments', 'videoDownload', 'videoSharing', 'useBlockList'
] as const satisfies readonly (keyof AdGroupAdvancedPlacement)[]

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

/** the config part of the state, from any `AdGroupConfig` (the system default on create, the row on edit) */
function configStateFrom(config: AdGroupConfig): ConfigState {
  const named = config.dataConnection?.mode === 'named'
  const isScheduled = config.schedule?.startTime !== 'now'
  const endTime = config.schedule?.mode === 'dateRange' ? (config.schedule.endTime ?? '') : ''
  const saved = config.savedAudience
  const advanced = config.advancedPlacement
  return {
    adGroupNamePrefix: config.adGroupNamePrefix ?? '',
    placement: config.placement,
    dataConnection: {
      mode: config.dataConnection?.mode ?? 'first',
      name: named ? (config.dataConnection as { name?: string }).name ?? '' : ''
    },
    optimizationEvent: config.optimizationEvent,
    locations: [...(config.locations ?? [])],
    ageGroups: [...(config.ageGroups ?? [])],
    gender: config.gender,
    budget: {
      type: config.budget?.type ?? '',
      // money is always shown with 2 decimals ("300.00"); `Number()` on submit makes it 300 again
      amount: Number.isFinite(config.budget?.amount) ? config.budget.amount.toFixed(2) : '',
      currency: config.budget?.currency ?? ''
    },
    schedule: {
      mode: config.schedule?.mode ?? 'continuous',
      startMode: isScheduled ? 'scheduled' : 'now',
      startTime: isScheduled ? isoToLocalInput(String(config.schedule.startTime)) : '',
      endTime: endTime ? isoToLocalInput(endTime) : ''
    },
    timezone: config.timezone,
    dayparting: config.dayparting,
    optimizationGoal: config.optimizationGoal,
    costCap: config.costCap === null || config.costCap === undefined ? '' : String(config.costCap),
    savedAudience: {
      mode: saved?.mode ?? 'none',
      name: saved?.mode === 'named' ? (saved as { name?: string }).name ?? '' : ''
    },
    audiences: {
      include: [...(config.audiences?.include ?? [])],
      exclude: [...(config.audiences?.exclude ?? [])]
    },
    interests: [...(config.interests ?? [])],
    languages: [...(config.languages ?? [])],
    // a document written before FEAT-011 has no value — left empty so zod asks for one instead of inventing 'all'
    spendingPower: config.spendingPower ?? '',
    advancedPlacement: {
      organicComments: triToRadio(advanced?.organicComments),
      comments: triToRadio(advanced?.comments),
      videoDownload: triToRadio(advanced?.videoDownload),
      videoSharing: triToRadio(advanced?.videoSharing),
      useBlockList: triToRadio(advanced?.useBlockList)
    }
  }
}

function stateFrom(template: AdGroupTemplate | null): FormState {
  const config = template ? template.config : props.options.systemDefault
  rememberTimes(config)
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
 * keystroke in it and that debounced pass overwrites anything `setErrors()` put there (submitting inside the
 * window left the user with no message at all). Owning the state means no timing can drop it; it is cleared as
 * soon as the user edits anything, and before every submit.
 */
const serverErrors = ref<Record<string, string>>({})

/**
 * FEAT-011 — inline messages of the four tag inputs (a rejected tag never reaches `state`, so zod would have
 * nothing to complain about). Same binding as `serverErrors`, cleared per field on the next accepted change.
 */
const tagErrors = ref<Record<string, string>>({})

function clearServerErrors() {
  serverErrors.value = {}
}

// any edit invalidates what the server said about the form
watch(state, clearServerErrors, { deep: true })

/** the message to show on a field: what the API said, else what a rejected tag said */
function fieldError(name: string): string | undefined {
  return serverErrors.value[name] ?? tagErrors.value[name]
}

// the submit button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

// ── accordion (six sections in the TikTok page order) ────────────────────────────────────────────────────────────────
type SectionId = 'adgroup' | 'placement' | 'audience' | 'budget' | 'bidding' | 'advanced'

/**
 * The collapsible sections and the `config` keys each one owns. The Thai heading is the section's TikTok title —
 * together with the min-budget hint the only Thai text the BO spells out itself.
 */
const SECTIONS = [
  {
    id: 'placement' as const,
    heading: 'ตำแหน่งการเพิ่มประสิทธิภาพ',
    keys: ['placement', 'dataConnection', 'optimizationEvent'] as const
  },
  {
    id: 'audience' as const,
    heading: 'การกำหนดเป้าหมายผู้ชม',
    keys: [
      'savedAudience', 'locations', 'ageGroups', 'gender', 'audiences', 'interests', 'languages', 'spendingPower'
    ] as const
  },
  {
    id: 'budget' as const,
    heading: 'งบประมาณและกำหนดการ',
    keys: ['budget', 'schedule', 'timezone', 'dayparting'] as const
  },
  {
    id: 'bidding' as const,
    heading: 'การเสนอราคาและการเพิ่มประสิทธิภาพ',
    keys: ['optimizationGoal', 'costCap'] as const
  },
  {
    id: 'advanced' as const,
    heading: 'ตำแหน่งโฆษณาที่เข้าเกณฑ์ › การตั้งค่าขั้นสูง',
    keys: ['advancedPlacement'] as const
  }
] satisfies readonly { id: SectionId, heading: string, keys: readonly (keyof AdGroupConfig)[] }[]

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

/** `UFormField` name → section (`config.dataConnection.name` → `placement`); anything else belongs to `adgroup` */
function sectionOfField(name: string | undefined): SectionId | null {
  if (!name) return null
  if (!name.startsWith('config.')) return 'adgroup'
  const key = name.slice('config.'.length).split('.')[0] ?? ''
  return SECTION_OF_KEY[key] ?? null
}

function expandSectionsOf(names: (string | undefined)[]) {
  for (const name of names) {
    const id = sectionOfField(name)
    if (id && id !== 'adgroup') expanded[id] = true
  }
}

// ── conditional fields ───────────────────────────────────────────────────────────────────────────────────────────────
const showConnectionName = computed(() => state.config.dataConnection.mode === 'named')
const showStartTime = computed(() => state.config.schedule.startMode === 'scheduled')
const showEndTime = computed(() => state.config.schedule.mode === 'dateRange')
const isInstantPage = computed(() => state.config.placement === 'instantPage')
const isSavedNamed = computed(() => state.config.savedAudience.mode === 'named')
/** only for `named` — Lead ruling: an API issue at `config.savedAudience.name` while the control is hidden goes to
 *  the form alert (`agt-form-error`), it does not make the field appear */
const showSavedName = computed(() => isSavedNamed.value)

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
  tagErrors.value = {}
  formRef.value?.clear()
  syncExpanded()
  // a pre-FEAT-011 row cannot be saved key-by-key — say it before the user tries
  const missing = missingConfigKeys(props.template?.config)
  if (missing.length) {
    submitError.value = { title: LEGACY_CONFIG_HINT, description: missing.map(key => `config.${key}`).join(' · ') }
  }
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})

/** "Reset to TikTok defaults" — config controls only, name/description untouched, no request */
function resetToDefaults() {
  rememberTimes(props.options.systemDefault)
  state.config = configStateFrom(props.options.systemDefault)
  submitError.value = null
  clearServerErrors()
  tagErrors.value = {}
  formRef.value?.clear()
  syncExpanded()
}

// ── minimum budget hint (from `options.minBudget`, never hard-coded) ─────────────────────────────────────────────────
const minBudget = computed(() => props.options.minBudget?.[state.config.budget.currency] ?? null)
/** "ขั้นต่ำ <min> <currency>" — the number and the currency are what QA asserts on */
const minBudgetHint = computed(() =>
  minBudget.value === null ? '' : `ขั้นต่ำ ${minBudget.value} ${state.config.budget.currency}`
)

/** the label of an option value; falls back to the raw value so an unknown value still renders */
function labelOf(list: OptionItem[] | undefined, value: string): string {
  return list?.find(item => item.value === value)?.label ?? value
}

/** cost cap suffix: "<currency> / <optimization goal label>" */
const costCapSuffix = computed(() =>
  `${state.config.budget.currency} / ${labelOf(props.options.optimizationGoal, state.config.optimizationGoal)}`
)

// ── tag inputs (`audiences.include` / `audiences.exclude` / `interests` / `languages`) ───────────────────────────────
const DEFAULT_LIST_LIMITS: AdGroupListLimits = { maxItems: 50, maxLength: 100 }
/** the API's own numbers (A5) — never hard-coded when `/options` serves them */
const listLimits = computed<AdGroupListLimits>(() => ({
  maxItems: props.options.listLimits?.maxItems ?? DEFAULT_LIST_LIMITS.maxItems,
  maxLength: props.options.listLimits?.maxLength ?? DEFAULT_LIST_LIMITS.maxLength
}))

/**
 * The accepted list is assigned as a **new array**: `TagsInputRoot` keeps its own copy of the model (vueuse
 * `useVModel(..., { passive: true })`) and only re-syncs when the `model-value` *reference* changes, so mutating the
 * existing array in place would leave a rejected tag on screen.
 */
const LIST_FIELDS = {
  'config.audiences.include': (v: string[]) => { state.config.audiences.include = v },
  'config.audiences.exclude': (v: string[]) => { state.config.audiences.exclude = v },
  'config.interests': (v: string[]) => { state.config.interests = v },
  'config.languages': (v: string[]) => { state.config.languages = v }
} as const

type ListFieldName = keyof typeof LIST_FIELDS

/**
 * `UInputTags` is left permissive on purpose (`duplicate` allowed, no `max`, no `maxlength`) so every rejected
 * entry can be explained instead of silently swallowed: trims, drops empties and refuses a too-long / duplicate /
 * over-the-limit tag with an inline message. The accepted list replaces the model, so a rejected tag never appears.
 */
function onTagsUpdate(name: ListFieldName, next: string[] | null) {
  const limits = listLimits.value
  const accepted: string[] = []
  let message: string | null = null

  for (const raw of next ?? []) {
    const tag = raw.trim()
    if (tag === '') continue
    if (tag.length > limits.maxLength) {
      message = `Each entry must be at most ${limits.maxLength} characters`
      continue
    }
    if (accepted.includes(tag)) {
      message = `"${tag}" is already in the list`
      continue
    }
    if (accepted.length >= limits.maxItems) {
      message = `At most ${limits.maxItems} entries`
      continue
    }
    accepted.push(tag)
  }

  LIST_FIELDS[name](accepted)

  // the message of this list is replaced, or dropped when the change was fully accepted
  const kept = Object.entries(tagErrors.value).filter(([key]) => key !== name)
  tagErrors.value = Object.fromEntries(message ? [...kept, [name, message]] : kept)
}

// ── validation (mirrors api-contract.md; an invalid form never reaches the network) ──────────────────────────────────
const NUMBER_RE = /^-?\d+(\.\d+)?$/

function twoDecimals(n: number): boolean {
  return Math.round(n * 100) / 100 === n
}

function makeSchema(minBudget: Record<string, number>, limits: AdGroupListLimits) {
  return z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
    description: z.string().trim().max(500, 'Description must be at most 500 characters'),
    config: z.object({
      adGroupNamePrefix: z.string().trim().max(100, 'Prefix must be at most 100 characters'),
      placement: z.string().min(1, 'Placement is required'),
      dataConnection: z.object({
        mode: z.string().min(1, 'Data connection is required'),
        name: z.string().trim().max(100, 'Connection name must be at most 100 characters')
      }),
      optimizationEvent: z.string().min(1, 'Optimization event is required'),
      locations: z.array(z.string()).min(1, 'Select at least one location'),
      ageGroups: z.array(z.string()),
      gender: z.string().min(1, 'Gender is required'),
      budget: z.object({
        type: z.string().min(1, 'Budget type is required'),
        amount: z.string().trim(),
        currency: z.string().min(1, 'Currency is required')
      }),
      schedule: z.object({
        mode: z.string().min(1, 'Schedule is required'),
        startMode: z.string().min(1, 'Start is required'),
        startTime: z.string(),
        endTime: z.string()
      }),
      timezone: z.string().min(1, 'Timezone is required'),
      dayparting: z.string().min(1, 'Dayparting is required'),
      optimizationGoal: z.string().min(1, 'Optimization goal is required'),
      costCap: z.string().trim(),
      savedAudience: z.object({
        mode: z.string().min(1, 'Saved audience is required'),
        name: z.string().trim().max(limits.maxLength, `Name must be at most ${limits.maxLength} characters`)
      }),
      audiences: z.object({
        include: z.array(z.string()),
        exclude: z.array(z.string())
      }),
      interests: z.array(z.string()),
      languages: z.array(z.string()),
      spendingPower: z.string().min(1, 'Spending power is required'),
      advancedPlacement: z.record(z.string(), z.string())
    })
  }).superRefine((data, ctx) => {
    // budget amount — required, numeric, at most 2 decimals, >= the minimum of the selected currency
    const amount = data.config.budget.amount
    const amountPath = ['config', 'budget', 'amount']
    const min = minBudget[data.config.budget.currency] ?? 0
    if (amount === '') {
      ctx.addIssue({ code: 'custom', path: amountPath, message: 'Amount is required' })
    } else if (!NUMBER_RE.test(amount)) {
      ctx.addIssue({ code: 'custom', path: amountPath, message: 'Amount must be a number' })
    } else if (!twoDecimals(Number(amount))) {
      ctx.addIssue({ code: 'custom', path: amountPath, message: 'Amount can have at most 2 decimals' })
    } else if (Number(amount) < min) {
      ctx.addIssue({
        code: 'custom',
        path: amountPath,
        // same wording as the API's own message (api.md "Needs BO"), so the user sees one sentence either way
        message: `งบประมาณขั้นต่ำ ${min} ${data.config.budget.currency}`
      })
    }

    // cost cap — optional; when filled: numeric, at most 2 decimals, greater than 0
    const costCap = data.config.costCap
    const costCapPath = ['config', 'costCap']
    if (costCap !== '') {
      if (!NUMBER_RE.test(costCap)) {
        ctx.addIssue({ code: 'custom', path: costCapPath, message: 'Cost cap must be a number' })
      } else if (!twoDecimals(Number(costCap))) {
        ctx.addIssue({ code: 'custom', path: costCapPath, message: 'Cost cap can have at most 2 decimals' })
      } else if (Number(costCap) <= 0) {
        ctx.addIssue({ code: 'custom', path: costCapPath, message: 'Cost cap must be greater than 0' })
      }
    }

    // a named data connection needs a name
    if (data.config.dataConnection.mode === 'named' && data.config.dataConnection.name === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'dataConnection', 'name'],
        message: 'Connection name is required'
      })
    }

    // a scheduled start needs a datetime
    const startPath = ['config', 'schedule', 'startTime']
    let startMs = Date.now()
    if (data.config.schedule.startMode === 'scheduled') {
      if (data.config.schedule.startTime === '') {
        ctx.addIssue({ code: 'custom', path: startPath, message: 'Start time is required' })
      } else {
        startMs = new Date(data.config.schedule.startTime).getTime()
        if (Number.isNaN(startMs)) {
          ctx.addIssue({ code: 'custom', path: startPath, message: 'Start time is not a valid date' })
        }
      }
    }

    // a date range needs an end after the start
    if (data.config.schedule.mode === 'dateRange') {
      const endPath = ['config', 'schedule', 'endTime']
      if (data.config.schedule.endTime === '') {
        ctx.addIssue({ code: 'custom', path: endPath, message: 'End time is required' })
      } else {
        const endMs = new Date(data.config.schedule.endTime).getTime()
        if (Number.isNaN(endMs)) {
          ctx.addIssue({ code: 'custom', path: endPath, message: 'End time is not a valid date' })
        } else if (!Number.isNaN(startMs) && endMs <= startMs) {
          ctx.addIssue({ code: 'custom', path: endPath, message: 'End time must be after the start time' })
        }
      }
    }

    // FEAT-011 — a named saved audience needs a name
    if (data.config.savedAudience.mode === 'named' && data.config.savedAudience.name === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'savedAudience', 'name'],
        message: 'Saved audience name is required'
      })
    }

    // FEAT-011 — the four free-text lists (the tag inputs already refuse these; zod is the backstop)
    const lists: { path: string[], items: string[] }[] = [
      { path: ['config', 'audiences', 'include'], items: data.config.audiences.include },
      { path: ['config', 'audiences', 'exclude'], items: data.config.audiences.exclude },
      { path: ['config', 'interests'], items: data.config.interests },
      { path: ['config', 'languages'], items: data.config.languages }
    ]
    for (const { path, items } of lists) {
      if (items.length > limits.maxItems) {
        ctx.addIssue({ code: 'custom', path, message: `At most ${limits.maxItems} entries` })
      }
      if (items.some(item => item.trim().length > limits.maxLength)) {
        ctx.addIssue({ code: 'custom', path, message: `Each entry must be at most ${limits.maxLength} characters` })
      }
      if (new Set(items).size !== items.length) {
        ctx.addIssue({ code: 'custom', path, message: 'Entries must be unique' })
      }
    }

    // FEAT-011 — the same name cannot be included and excluded (API path: config.audiences.exclude)
    const included = new Set(data.config.audiences.include)
    const both = data.config.audiences.exclude.filter(item => included.has(item))
    if (both.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['config', 'audiences', 'exclude'],
        message: `${both.join(', ')} cannot be included and excluded at the same time`
      })
    }
  })
}

type Schema = z.output<ReturnType<typeof makeSchema>>

// rebuilt when `minBudget` / `listLimits` change; the currency is read inside the refinement
const schema = computed(() => makeSchema(props.options.minBudget ?? {}, listLimits.value))

// ── body building ────────────────────────────────────────────────────────────────────────────────────────────────────
/** the complete 19-key `AdGroupConfig` the API expects, from the current state */
function configFromState(): AdGroupConfig {
  const c = state.config
  const prefix = c.adGroupNamePrefix.trim()

  const dataConnection: AdGroupDataConnection = c.dataConnection.mode === 'named'
    ? { mode: 'named', name: c.dataConnection.name.trim() }
    : { mode: 'first' }

  // BUG-008: an untouched picker re-emits the instant it was filled from, seconds included
  const startTime = c.schedule.startMode === 'scheduled'
    ? isoFromPicker(c.schedule.startTime, originalTimes.startTime)
    : 'now'
  const schedule: AdGroupSchedule = c.schedule.mode === 'dateRange'
    ? { mode: 'dateRange', startTime, endTime: isoFromPicker(c.schedule.endTime, originalTimes.endTime) }
    : { mode: 'continuous', startTime }

  const costCap = c.costCap.trim()

  // hidden is not cleared: an `instantPage` placement / a named saved audience still sends the values below (A: the
  // job decides what to use)
  const savedAudience: AdGroupSavedAudience = c.savedAudience.mode === 'named'
    ? { mode: 'named', name: c.savedAudience.name.trim() }
    : { mode: 'none' }

  return {
    adGroupNamePrefix: prefix === '' ? null : prefix,
    placement: c.placement as AdGroupConfig['placement'],
    dataConnection,
    optimizationEvent: c.optimizationEvent as AdGroupConfig['optimizationEvent'],
    locations: [...c.locations],
    ageGroups: [...c.ageGroups] as AdGroupConfig['ageGroups'],
    gender: c.gender as AdGroupConfig['gender'],
    budget: {
      type: c.budget.type as AdGroupConfig['budget']['type'],
      amount: Number(c.budget.amount.trim()),
      currency: c.budget.currency as AdGroupConfig['budget']['currency']
    },
    schedule,
    timezone: c.timezone as AdGroupConfig['timezone'],
    dayparting: c.dayparting as AdGroupConfig['dayparting'],
    optimizationGoal: c.optimizationGoal as AdGroupConfig['optimizationGoal'],
    costCap: costCap === '' ? null : Number(costCap),
    savedAudience,
    audiences: { include: [...c.audiences.include], exclude: [...c.audiences.exclude] },
    interests: [...c.interests],
    languages: [...c.languages],
    spendingPower: c.spendingPower as AdGroupConfig['spendingPower'],
    advancedPlacement: {
      organicComments: radioToTri(c.advancedPlacement.organicComments),
      comments: radioToTri(c.advancedPlacement.comments),
      videoDownload: radioToTri(c.advancedPlacement.videoDownload),
      videoSharing: radioToTri(c.advancedPlacement.videoSharing),
      useBlockList: radioToTri(c.advancedPlacement.useBlockList)
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

/** the 19 top-level `config` keys, in `CONFIG_KEYS` order (api-contract.md v2) */
const CONFIG_KEYS = [
  'adGroupNamePrefix', 'placement', 'dataConnection', 'optimizationEvent', 'locations', 'ageGroups',
  'gender', 'budget', 'schedule', 'timezone', 'dayparting', 'optimizationGoal', 'costCap',
  'savedAudience', 'audiences', 'interests', 'languages', 'spendingPower', 'advancedPlacement'
] as const satisfies readonly (keyof AdGroupConfig)[]

/**
 * A document written before FEAT-011 stores only the 13 v1 keys. There is no compatibility code (human decision):
 * the API validates the merged config and answers 400 with one path per missing key for **any** save — so the modal
 * says so in one line instead of leaving the user with six unexplained field errors.
 */
const LEGACY_CONFIG_HINT = 'This template predates the current form; re-save every section or delete it'
/** the v2 keys that a pre-FEAT-011 document does not have */
const V2_ONLY_KEYS = [
  'savedAudience', 'audiences', 'interests', 'languages', 'spendingPower', 'advancedPlacement'
] as const satisfies readonly (keyof AdGroupConfig)[]

/** `config` keys the stored document does not carry at all (empty for every template written since FEAT-011) */
function missingConfigKeys(config: AdGroupConfig | undefined): string[] {
  if (!config) return []
  return CONFIG_KEYS.filter(key => !(key in config))
}

/** only the keys whose value really changed; each changed `config` key is sent whole (A3) */
function patchBodyFrom(original: AdGroupTemplate, name: string, description: string | null): PatchAdGroupTemplateBody {
  const body: PatchAdGroupTemplateBody = {}
  if (name !== original.name) body.name = name
  if (description !== original.description) body.description = description

  const next = configFromState()
  const changed: Partial<AdGroupConfig> = {}
  let hasConfigChange = false
  for (const key of CONFIG_KEYS) {
    if (!deepEqual(next[key], original.config[key])) {
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
 * `UFormField` names an API issue can land on. Everything a collapsed section holds counts: the section is
 * expanded before the message is shown (a collapsed body is hidden, not unmounted). Only fields that do not exist at
 * all (`v-if`: connection name, start/end time, saved audience name) are left out, so their issue goes to the form
 * alert.
 */
const visibleFieldNames = computed(() => {
  const names = [
    'name', 'description',
    'config.adGroupNamePrefix', 'config.placement', 'config.dataConnection.mode',
    'config.optimizationEvent', 'config.locations', 'config.ageGroups', 'config.gender',
    'config.budget.type', 'config.budget.amount', 'config.budget.currency',
    'config.schedule.mode', 'config.schedule.startMode',
    'config.timezone', 'config.dayparting', 'config.optimizationGoal', 'config.costCap',
    'config.savedAudience.mode',
    'config.audiences.include', 'config.audiences.exclude', 'config.interests', 'config.languages',
    'config.spendingPower',
    ...ADVANCED_KEYS.map(key => `config.advancedPlacement.${key}`)
  ]
  // rendered with `v-if`: while it does not exist, its issue belongs in the form alert (Lead ruling 2026-09-25)
  if (showSavedName.value) names.push('config.savedAudience.name')
  if (showConnectionName.value) names.push('config.dataConnection.name')
  if (showStartTime.value) names.push('config.schedule.startTime')
  if (showEndTime.value) names.push('config.schedule.endTime')
  return new Set(names)
})

/**
 * The `UFormField` an API issue belongs to, or `null` for the form-level alert.
 * Array-item paths are folded onto their field (`config.locations.0` → `config.locations`,
 * `config.interests.3` → `config.interests`, `config.audiences.include.0` → `config.audiences.include`), so an item
 * error lands on the control that owns the array. `catalogVersion` matches nothing (the BO never sends it) and goes
 * to `agt-form-error`, as does an empty path (empty PATCH body).
 */
function resolveFieldName(path: string): string | null {
  let candidate = path
  while (candidate !== '') {
    if (visibleFieldNames.value.has(candidate)) return candidate
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
    for (const issue of issues) {
      const name = resolveFieldName(issue.path)
      if (name) {
        serverErrors.value[name] = issue.message
        matched.push(name)
      } else unmatched.push(issue)
    }
    // the field has to be on screen for its message to be read
    expandSectionsOf(matched)
    // a pre-FEAT-011 document: the API repeats the six missing keys whatever the body was
    const paths = new Set(issues.map(issue => issue.path))
    const legacy = V2_ONLY_KEYS.filter(key => paths.has(`config.${key}`)).length >= 3
    if (legacy || unmatched.length) {
      submitError.value = {
        title: legacy ? LEGACY_CONFIG_HINT : (data?.error ?? fallback),
        description: unmatched.length
          ? unmatched.map(i => (i.path ? `${i.path}: ${i.message}` : i.message)).join(' · ')
          : undefined
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
      const updated = await api<AdGroupTemplate>(`/ad-group-templates/${encodeURIComponent(original.id)}`, {
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

  // create always sends the complete 19-key config and never `catalogVersion` (the API stamps it)
  const body: CreateAdGroupTemplateBody = { name, description, config: configFromState() }
  submitting.value = true
  try {
    // retry: 0 — exactly one POST per submit
    const created = await api<AdGroupTemplate>('/ad-group-templates', { method: 'POST', body, retry: 0 })
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
    :title="isEdit ? 'Edit ad group template' : 'Create ad group template'"
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
        <!-- 1. ad group — always open, no toggle -->
        <section class="space-y-4" data-testid="agt-sec-adgroup">
          <h3 class="text-sm font-semibold text-highlighted">
            กลุ่มโฆษณา
          </h3>

          <UFormField
            label="Name"
            name="name"
            required
            :error="serverErrors['name']"
          >
            <UInput
              v-model="state.name"
              placeholder="Sales TH default"
              class="w-full"
              :disabled="submitting"
              data-testid="agt-form-name"
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
              data-testid="agt-form-description"
            />
          </UFormField>

          <UFormField
            label="Ad group name prefix"
            name="config.adGroupNamePrefix"
            hint="Optional"
            help="Leave empty to let TikTok name the ad group automatically."
            :error="serverErrors['config.adGroupNamePrefix']"
          >
            <UInput
              v-model="state.config.adGroupNamePrefix"
              placeholder="TH-"
              class="w-full"
              :disabled="submitting"
              data-testid="agt-form-prefix"
            />
          </UFormField>
        </section>

        <!-- 2. placement / optimization location -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.placement"
              aria-controls="agt-sec-placement"
              data-testid="agt-sec-placement-toggle"
              @click="toggleSection('placement')"
            >
              <UIcon
                :name="expanded.placement ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>ตำแหน่งการเพิ่มประสิทธิภาพ</span>
              <UBadge
                v-if="sectionIsDefault.placement"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="agt-sec-placement-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.placement"
            id="agt-sec-placement"
            class="mt-4 space-y-4"
            data-testid="agt-sec-placement"
          >
            <UFormField
              label="Placement"
              name="config.placement"
              required
              :error="serverErrors['config.placement']"
            >
              <URadioGroup
                v-model="state.config.placement"
                :items="options.placement"
                value-key="value"
                :disabled="submitting"
                data-testid="agt-form-placement"
              />
            </UFormField>

            <!-- instantPage: TikTok asks for the data connection and the event on its own page (kept and still sent) -->
            <p
              v-if="isInstantPage"
              class="text-sm text-muted"
              data-testid="agt-form-instant-hint"
            >
              Data connection and optimization event are chosen on TikTok for Instant Page
            </p>

            <div v-show="!isInstantPage" class="space-y-4" data-testid="agt-form-website-only">
              <UFormField
                label="Data connection"
                name="config.dataConnection.mode"
                required
                :error="serverErrors['config.dataConnection.mode']"
              >
                <URadioGroup
                  v-model="state.config.dataConnection.mode"
                  :items="options.dataConnectionMode"
                  value-key="value"
                  orientation="horizontal"
                  :disabled="submitting"
                  data-testid="agt-form-dc-mode"
                />
              </UFormField>

              <UFormField
                v-if="showConnectionName"
                label="Connection name"
                name="config.dataConnection.name"
                required
                :error="serverErrors['config.dataConnection.name']"
              >
                <UInput
                  v-model="state.config.dataConnection.name"
                  placeholder="tiktok capi"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-dc-name"
                />
              </UFormField>

              <UFormField
                label="Optimization event"
                name="config.optimizationEvent"
                required
                :error="serverErrors['config.optimizationEvent']"
              >
                <USelect
                  v-model="state.config.optimizationEvent"
                  :items="options.optimizationEvent"
                  value-key="value"
                  class="w-full sm:max-w-xs"
                  :disabled="submitting"
                  data-testid="agt-form-event"
                />
              </UFormField>
            </div>
          </div>
        </section>

        <!-- 3. audience targeting -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.audience"
              aria-controls="agt-sec-audience"
              data-testid="agt-sec-audience-toggle"
              @click="toggleSection('audience')"
            >
              <UIcon
                :name="expanded.audience ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>การกำหนดเป้าหมายผู้ชม</span>
              <UBadge
                v-if="sectionIsDefault.audience"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="agt-sec-audience-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.audience"
            id="agt-sec-audience"
            class="mt-4 space-y-4"
            data-testid="agt-sec-audience"
          >
            <UFormField
              label="Saved audience"
              name="config.savedAudience.mode"
              required
              :error="serverErrors['config.savedAudience.mode']"
            >
              <URadioGroup
                v-model="state.config.savedAudience.mode"
                :items="options.savedAudienceMode"
                value-key="value"
                orientation="horizontal"
                :disabled="submitting"
                data-testid="agt-form-saved-mode"
              />
            </UFormField>

            <UFormField
              v-if="showSavedName"
              label="Saved audience name"
              name="config.savedAudience.name"
              required
              :error="fieldError('config.savedAudience.name')"
            >
              <UInput
                v-model="state.config.savedAudience.name"
                placeholder="VIP buyers"
                class="w-full"
                :disabled="submitting"
                data-testid="agt-form-saved-name"
              />
            </UFormField>

            <!-- a named saved audience wins on TikTok; the targeting below is kept and still sent -->
            <p
              v-if="isSavedNamed"
              class="text-sm text-muted"
              data-testid="agt-form-saved-hint"
            >
              The saved audience replaces the targeting below when the job runs
            </p>

            <div v-show="!isSavedNamed" class="space-y-4" data-testid="agt-form-targeting">
              <UFormField
                label="Locations"
                name="config.locations"
                required
                :error="serverErrors['config.locations']"
              >
                <USelectMenu
                  v-model="state.config.locations"
                  multiple
                  :items="options.locations"
                  value-key="value"
                  placeholder="Select at least one location"
                  class="w-full sm:max-w-xs"
                  :disabled="submitting"
                  data-testid="agt-form-locations"
                />
              </UFormField>

              <UFormField
                label="Age"
                name="config.ageGroups"
                :help="state.config.ageGroups.length === 0 ? options.ageGroupsUnlimitedLabel : undefined"
                :error="serverErrors['config.ageGroups']"
              >
                <UCheckboxGroup
                  v-model="state.config.ageGroups"
                  :items="options.ageGroups"
                  value-key="value"
                  orientation="horizontal"
                  :disabled="submitting"
                  data-testid="agt-form-ages"
                />
              </UFormField>

              <UFormField
                label="Gender"
                name="config.gender"
                required
                :error="serverErrors['config.gender']"
              >
                <URadioGroup
                  v-model="state.config.gender"
                  :items="options.gender"
                  value-key="value"
                  orientation="horizontal"
                  :disabled="submitting"
                  data-testid="agt-form-gender"
                />
              </UFormField>

              <div class="grid gap-4 sm:grid-cols-2">
                <UFormField
                  label="Include audiences"
                  name="config.audiences.include"
                  hint="Optional"
                  :error="fieldError('config.audiences.include')"
                >
                  <!-- the test id lands on the inner `<input data-slot="input">` (UInputTags has
                       inheritAttrs: false); the tags are `[data-slot="item"]` of its parent `[data-slot="root"]` -->
                  <UInputTags
                    :model-value="state.config.audiences.include"
                    :duplicate="true"
                    placeholder="Add a name, press Enter"
                    class="w-full"
                    :disabled="submitting"
                    data-testid="agt-form-aud-include"
                    @update:model-value="(v: string[]) => onTagsUpdate('config.audiences.include', v)"
                  />
                </UFormField>

                <UFormField
                  label="Exclude audiences"
                  name="config.audiences.exclude"
                  hint="Optional"
                  :error="fieldError('config.audiences.exclude')"
                >
                  <UInputTags
                    :model-value="state.config.audiences.exclude"
                    :duplicate="true"
                    placeholder="Add a name, press Enter"
                    class="w-full"
                    :disabled="submitting"
                    data-testid="agt-form-aud-exclude"
                    @update:model-value="(v: string[]) => onTagsUpdate('config.audiences.exclude', v)"
                  />
                </UFormField>
              </div>

              <UFormField
                label="Interests & behaviors"
                name="config.interests"
                hint="Optional"
                :error="fieldError('config.interests')"
              >
                <UInputTags
                  :model-value="state.config.interests"
                  :duplicate="true"
                  placeholder="Add a category, press Enter"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-interests"
                  @update:model-value="(v: string[]) => onTagsUpdate('config.interests', v)"
                />
              </UFormField>

              <UFormField
                label="Languages"
                name="config.languages"
                hint="Optional"
                :help="state.config.languages.length === 0 ? options.unlimitedLabel : undefined"
                :error="fieldError('config.languages')"
              >
                <UInputTags
                  :model-value="state.config.languages"
                  :duplicate="true"
                  placeholder="Add a language, press Enter"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-languages"
                  @update:model-value="(v: string[]) => onTagsUpdate('config.languages', v)"
                />
              </UFormField>

              <UFormField
                label="Spending power"
                name="config.spendingPower"
                required
                :error="serverErrors['config.spendingPower']"
              >
                <URadioGroup
                  v-model="state.config.spendingPower"
                  :items="options.spendingPower"
                  value-key="value"
                  orientation="horizontal"
                  :disabled="submitting"
                  data-testid="agt-form-spending"
                />
              </UFormField>
            </div>
          </div>
        </section>

        <!-- 4. budget and schedule -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.budget"
              aria-controls="agt-sec-budget"
              data-testid="agt-sec-budget-toggle"
              @click="toggleSection('budget')"
            >
              <UIcon
                :name="expanded.budget ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>งบประมาณและกำหนดการ</span>
              <UBadge
                v-if="sectionIsDefault.budget"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="agt-sec-budget-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.budget"
            id="agt-sec-budget"
            class="mt-4 space-y-4"
            data-testid="agt-sec-budget"
          >
            <div class="grid gap-4 sm:grid-cols-3">
              <UFormField
                label="Budget type"
                name="config.budget.type"
                required
                :error="serverErrors['config.budget.type']"
              >
                <USelect
                  v-model="state.config.budget.type"
                  :items="options.budgetType"
                  value-key="value"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-budget-type"
                />
              </UFormField>

              <UFormField
                label="Amount"
                name="config.budget.amount"
                required
                :error="serverErrors['config.budget.amount']"
              >
                <!-- text + inputmode instead of type="number": `1,5x` must reach the zod schema so the
                     "Amount must be a number" message can be shown -->
                <UInput
                  v-model="state.config.budget.amount"
                  type="text"
                  inputmode="decimal"
                  placeholder="300"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-budget-amount"
                />
                <template #help>
                  <span data-testid="agt-form-min-budget">{{ minBudgetHint }}</span>
                </template>
              </UFormField>

              <UFormField
                label="Currency"
                name="config.budget.currency"
                required
                :error="serverErrors['config.budget.currency']"
              >
                <USelect
                  v-model="state.config.budget.currency"
                  :items="options.currency"
                  value-key="value"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-budget-currency"
                />
              </UFormField>
            </div>

            <UFormField
              label="Schedule"
              name="config.schedule.mode"
              required
              :error="serverErrors['config.schedule.mode']"
            >
              <URadioGroup
                v-model="state.config.schedule.mode"
                :items="options.scheduleMode"
                value-key="value"
                :disabled="submitting"
                data-testid="agt-form-schedule-mode"
              />
            </UFormField>

            <UFormField
              label="Start"
              name="config.schedule.startMode"
              required
              :error="serverErrors['config.schedule.startMode']"
            >
              <URadioGroup
                v-model="state.config.schedule.startMode"
                :items="options.startTimeMode"
                value-key="value"
                orientation="horizontal"
                :disabled="submitting"
                data-testid="agt-form-start-mode"
              />
            </UFormField>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                v-if="showStartTime"
                label="Start time"
                name="config.schedule.startTime"
                required
                :error="serverErrors['config.schedule.startTime']"
              >
                <UInput
                  v-model="state.config.schedule.startTime"
                  type="datetime-local"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-start-time"
                />
              </UFormField>

              <UFormField
                v-if="showEndTime"
                label="End time"
                name="config.schedule.endTime"
                required
                :error="serverErrors['config.schedule.endTime']"
              >
                <UInput
                  v-model="state.config.schedule.endTime"
                  type="datetime-local"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-end-time"
                />
              </UFormField>
            </div>

            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Timezone"
                name="config.timezone"
                required
                :error="serverErrors['config.timezone']"
              >
                <USelect
                  v-model="state.config.timezone"
                  :items="options.timezone"
                  value-key="value"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-timezone"
                />
              </UFormField>

              <UFormField
                label="Dayparting"
                name="config.dayparting"
                required
                :error="serverErrors['config.dayparting']"
              >
                <URadioGroup
                  v-model="state.config.dayparting"
                  :items="options.dayparting"
                  value-key="value"
                  orientation="horizontal"
                  :disabled="submitting"
                  data-testid="agt-form-dayparting"
                />
              </UFormField>
            </div>
          </div>
        </section>

        <!-- 5. bidding and optimization -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.bidding"
              aria-controls="agt-sec-bidding"
              data-testid="agt-sec-bidding-toggle"
              @click="toggleSection('bidding')"
            >
              <UIcon
                :name="expanded.bidding ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>การเสนอราคาและการเพิ่มประสิทธิภาพ</span>
              <UBadge
                v-if="sectionIsDefault.bidding"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="agt-sec-bidding-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.bidding"
            id="agt-sec-bidding"
            class="mt-4 space-y-4"
            data-testid="agt-sec-bidding"
          >
            <div class="grid gap-4 sm:grid-cols-2">
              <UFormField
                label="Optimization goal"
                name="config.optimizationGoal"
                required
                :error="serverErrors['config.optimizationGoal']"
              >
                <USelect
                  v-model="state.config.optimizationGoal"
                  :items="options.optimizationGoal"
                  value-key="value"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-goal"
                />
              </UFormField>

              <UFormField
                label="Cost cap"
                name="config.costCap"
                hint="Optional"
                :help="costCapSuffix"
                :error="serverErrors['config.costCap']"
              >
                <UInput
                  v-model="state.config.costCap"
                  type="text"
                  inputmode="decimal"
                  placeholder="No cost cap"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-form-cost-cap"
                />
              </UFormField>
            </div>
          </div>
        </section>

        <!-- 6. eligible placements › advanced settings (five tri-state toggles) -->
        <section class="border-t border-default pt-4">
          <h3 class="text-sm font-semibold text-highlighted">
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 py-1 text-left"
              :aria-expanded="expanded.advanced"
              aria-controls="agt-sec-advanced"
              data-testid="agt-sec-advanced-toggle"
              @click="toggleSection('advanced')"
            >
              <UIcon
                :name="expanded.advanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="size-4 shrink-0 text-muted"
              />
              <span>ตำแหน่งโฆษณาที่เข้าเกณฑ์ › การตั้งค่าขั้นสูง</span>
              <UBadge
                v-if="sectionIsDefault.advanced"
                color="neutral"
                variant="subtle"
                size="sm"
                data-testid="agt-sec-advanced-default"
              >
                Default
              </UBadge>
            </button>
          </h3>

          <div
            v-show="expanded.advanced"
            id="agt-sec-advanced"
            class="mt-4 space-y-4"
            data-testid="agt-sec-advanced"
          >
            <UFormField
              v-for="item in options.advancedPlacementKey"
              :key="item.value"
              :label="item.label"
              :name="`config.advancedPlacement.${item.value}`"
              :error="serverErrors[`config.advancedPlacement.${item.value}`]"
            >
              <URadioGroup
                v-model="state.config.advancedPlacement[item.value]"
                :items="options.advancedPlacementState"
                value-key="value"
                orientation="horizontal"
                :ui="{ fieldset: 'flex-wrap' }"
                :disabled="submitting"
                :data-testid="`agt-form-adv-${item.value}`"
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
          data-testid="agt-form-error"
        />
      </UForm>
    </template>

    <!-- actions in the footer so they stay reachable while the 6 sections scroll (390x844) -->
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <UButton
          label="Reset to TikTok defaults"
          icon="i-lucide-rotate-ccw"
          color="neutral"
          variant="outline"
          class="me-auto"
          :disabled="submitting"
          data-testid="agt-form-reset"
          @click="resetToDefaults"
        />
        <UButton
          label="Cancel"
          color="neutral"
          variant="subtle"
          :disabled="submitting"
          data-testid="agt-form-cancel"
          @click="open = false"
        />
        <UButton
          :label="isEdit ? 'Save' : 'Create'"
          :icon="isEdit ? 'i-lucide-check' : 'i-lucide-plus'"
          color="primary"
          variant="solid"
          :loading="submitting"
          data-testid="agt-form-submit"
          @click="formRef?.submit()"
        />
      </div>
    </template>
  </UModal>
</template>
