<script setup lang="ts">
/**
 * FEAT-008 + FEAT-011 + FEAT-013 + FEAT-057 + **FEAT-061** — Create / Duplicate / Edit / **Migrate** ad group
 * template (function 6.8; api-contract.md FEAT-061 **v1** `POST /ad-group-templates`,
 * `PATCH /ad-group-templates/:id`, `GET /ad-group-templates/:id/migration`,
 * `POST /ad-group-templates/:id/migrate`).
 *
 * One component for four modes:
 * - `template === null` → **create** (`POST` with a complete **15-key v3** config prefilled from
 *   `options.systemDefault`, never `catalogVersion`),
 * - a row + `mode: 'form'` → **edit** (`PATCH` with only the changed keys; each changed top-level `config` key is
 *   sent whole — assumption A3). Only a **Smart+** row can be edited: the API refuses a PATCH on a manual row
 *   with one issue at `config` (`agt-form-error` shows it if it ever arrives).
 * - **FEAT-057** `duplicateFrom` → **duplicate**: `template` stays `null`, so every create code path applies
 *   (`POST`, the `Create` button, system defaults for keys the source lacks), the state is pre-filled from that
 *   row through the same `stateFrom()` / `configStateFrom()` mapping, the name starts as `<source name> (copy)`
 *   and the body carries `duplicateOf: <source id>`.
 * - **FEAT-061** a row + `mode: 'migrate'` → **migrate** ("ปรับเป็น Smart+", opened from the list's
 *   `agt-migrate` on a manual row with `canEdit`): `GET /:id/migration` answers the v3 `draft` the API mapped
 *   from the stored manual config plus `required` / `dropped` / `renamed` / `notes`; the form is prefilled from
 *   the draft, the dropped keys are listed under "จะถูกตัดออก" (`agt-migrate-dropped`), name and description are
 *   read-only (AS-7) and the save button (`agt-form-submit`, "บันทึกเป็น Smart+") POSTs the **full** 15-key
 *   config to `/:id/migrate`. A **duplicate of a manual row** (AS-6) is the same draft on the create path:
 *   `GET /<source>/migration` → `POST /ad-group-templates` + `duplicateOf`, so the copy is born Smart+.
 *
 * Every select / radio / checkbox list is built from `options` (`{ value, label }`), so no enum label is
 * hard-coded in the BO (the section headings, the advanced sub-heading, the migrate texts and the min-budget
 * wording are the only Thai strings here; the campaign / targetCpa validation messages mirror the API's own,
 * api-contract §1.1, so a client and a server refusal read the same).
 * The form state mirrors the API body (`name`, `description`, `config.*`), which makes a zod issue path and an API
 * `issues[].path` land on the same `UFormField` name (`config.campaign.budget.amount`, `config.targetCpa`, …).
 * `config.schedule.startMode` is the only UI-only key: it decides whether `startTime` is the literal `'now'` or
 * the ISO value of the `datetime-local` picker (assumption A9, browser-local time).
 *
 * Layout (FEAT-061, TikTok's Smart+ order): **six** sections, the first two always open and without a toggle —
 * **`campaign`** (`agt-sec-campaign`: campaign name, budget strategy, campaign budget under `cbo`, bid strategy,
 * `targetCpa` under `costCap`) and `adgroup` — then the four collapsible ones behind `agt-sec-<id>-toggle`:
 * `placement` (the optimisation-location radio only), `audience` (locations / age / gender / languages),
 * `budget` (ad-group budget, schedule, timezone, dayparting) and `bidding` (the five tri-state
 * advanced-placement toggles under their TikTok sub-heading). A collapsed section is hidden with `v-show`
 * (never unmounted) so every value is still submitted and an error can be rendered the moment its section opens,
 * it shows the live badge `agt-sec-<id>-default` while every control in it equals `options.systemDefault`, and it
 * auto-expands when one of its fields carries a client or API error.
 *
 * What the form does **not** show (FEAT-013 A4/A5 + FEAT-061):
 * - `placement`: the `website` item of `options.placement` is filtered out (by **value**, never by index); a
 *   stored `website` row keeps its value with no radio selected and only PATCHes `placement` when the user picks
 *   the instant page. The migration draft always carries `instantPage`.
 * - **pass-through key** `audiences`: read from the row (edit) or `options.systemDefault` (create), sent
 *   unchanged in the POST, never in a PATCH unless `Reset to TikTok defaults` changed it (A8). No control edits
 *   it, it is not part of any section's badge keys, it has no client validation, and an API issue at
 *   `config.audiences.*` lands in `agt-form-error`. (`savedAudience` is gone from the shape altogether — v3.)
 *
 * **TASK-template-form-ux** (human request 2026-10-21, the same three changes as the ad-template form, same
 * pattern, no value / request / test id touched):
 * 1. **Width + two columns.** `max-w-3xl` → `lg:max-w-5xl` → `xl:max-w-6xl` (the unprefixed `max-w-3xl` stays so
 *    tailwind-merge still drops the theme's own `max-w-lg` below `sm`), and every section body is a
 *    `grid gap-4 xl:grid-cols-2`. Below `xl` it is a single column with the 1 rem rhythm `space-y-4` had, so
 *    tablet and mobile are the old layout exactly. `xl:col-span-2` goes to the controls that need the width: the
 *    description textarea, the placement radio, the age checkbox row, the advanced sub-heading, every nested
 *    `sm:grid-cols-*` row (campaign budget, ad-group budget, start/end time, timezone + dayparting) and the
 *    section-level `agt-form-error` / migration blocks.
 * 2. **`agt-form-expand-all`** above the first section opens / collapses the four collapsible sections at once
 *    and remembers it (`useLocalStorage('agt-form-expand-all', false)`). The default — nothing stored, `false` —
 *    keeps `syncExpanded()` **exactly** as it was (collapsed while the section equals `options.systemDefault`);
 *    the error paths (`expandSectionsOf`, `onFormError`, the API issues) are untouched and still win.
 * 3. **`agt-sec-<id>-summary`** — a muted one-liner next to the heading of a **collapsed** section, computed from
 *    the current state with the labels `/options` serves (never a hard-coded enum label). This form holds no
 *    secret, but the same rule applies: a summary only ever repeats what the controls themselves show.
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormErrorEvent, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupAdvancedPlacement,
  AdGroupBudget,
  AdGroupCampaign,
  AdGroupConfig,
  AdGroupListLimits,
  AdGroupSchedule,
  AdGroupTemplate,
  AdGroupTemplateKind,
  AdGroupTemplateOptions,
  CreateAdGroupTemplateBody,
  MigrateBody,
  MigrationDraft,
  MigrationResponse,
  OptionItem,
  PatchAdGroupTemplateBody,
  TriState
} from '#shared/types/ad-group-templates'

const props = withDefaults(defineProps<{
  /** null = create, a row = edit (`mode: 'form'`) or migrate (`mode: 'migrate'`) */
  template: AdGroupTemplate | null
  /** fetched once per page lifetime and passed down — the modal never re-fetches it */
  options: AdGroupTemplateOptions
  /**
   * FEAT-057 — **duplicate mode**: `template` stays `null` (so every create code path applies: `POST`, the
   * `Create` button, the system defaults for keys the source lacks) while the form is pre-filled from this row
   * and the POST carries `duplicateOf: <row.id>`. `null` = plain create / edit.
   * FEAT-061 (AS-6): when that source row is **manual**, the values come from its `/migration` draft instead,
   * so the copy is created as a Smart+ template.
   */
  duplicateFrom?: AdGroupTemplate | null
  /**
   * FEAT-061 — `'migrate'` turns the row in `template` into the migration lane (banner, draft from
   * `GET /:id/migration`, dropped-keys list, `POST /:id/migrate`, name/description read-only).
   */
  mode?: 'form' | 'migrate'
}>(), { duplicateFrom: null, mode: 'form' })

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

/**
 * FEAT-061 — the row's kind: the API's own `kind` when it serves one, else the FEAT-011 catalog comparison
 * (an API that predates the feature). `manual` = cannot be edited, only migrated.
 */
function kindOf(template: AdGroupTemplate | null): AdGroupTemplateKind | null {
  if (!template) return null
  if (template.kind) return template.kind
  const current = props.options.catalogVersion
  if (!current) return null
  return template.catalogVersion === current ? 'smartPlus' : 'manual'
}

/** FEAT-061 — the manual row this modal converts (`agt-migrate` on the list) */
const isMigrate = computed(() => props.mode === 'migrate' && props.template !== null)
/** FEAT-057 — create, pre-filled from another row (`duplicateOf` travels in the POST) */
const isDuplicate = computed(() => props.template === null && props.duplicateFrom !== null)
/** FEAT-061 AS-6 — duplicate of a **manual** row: the draft rules of migrate mode on the create path */
const isMigrateCreate = computed(() => isDuplicate.value && kindOf(props.duplicateFrom) === 'manual')
const isEdit = computed(() => props.template !== null && !isMigrate.value)
/** both modes that start from `GET /:id/migration` */
const needsMigration = computed(() => isMigrate.value || isMigrateCreate.value)
/** the row the `/migration` draft is read from (the migrated row, or the duplicate source) */
const migrationSource = computed(() => (isMigrate.value ? props.template : props.duplicateFrom))

const modalTitle = computed(() => {
  if (isMigrate.value) return 'ปรับเป็น Smart+'
  if (isEdit.value) return 'Edit ad group template'
  return isDuplicate.value ? 'Duplicate ad group template' : 'Create ad group template'
})

const modalDescription = computed(() => {
  if (isMigrate.value) return `${props.template?.name ?? ''} — ปรับเฉพาะ config เป็นแบบ Smart+ (ชื่อและคำอธิบายไม่เปลี่ยน)`
  if (isEdit.value) return 'Changes apply to future orders only.'
  if (isDuplicate.value) return `Starts from “${props.duplicateFrom?.name ?? ''}”. Saved as a new template of yours.`
  return 'Starts from the TikTok system defaults.'
})

/** FEAT-061 — the banner above the form in both migration modes (spec "UI behaviour → Migrate mode") */
const MIGRATE_BANNER = 'template นี้เป็นแบบ manual ใช้สร้าง order ไม่ได้แล้ว — กรอกช่องที่ขาดแล้วบันทึกเพื่อปรับเป็น Smart+'
const MIGRATE_COPY_BANNER = 'template ต้นทางเป็นแบบ manual — สำเนานี้จะถูกสร้างเป็น Smart+ (กรอกช่องที่ขาดก่อนบันทึก)'
const MIGRATE_DROPPED_HEADING = 'จะถูกตัดออก'

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

interface MoneyState {
  type: string
  amount: string
  currency: string
}

/** FEAT-061 — `config.campaign`; `budget` is only sent while `budgetStrategy === 'cbo'` */
interface CampaignState {
  name: string
  budgetStrategy: string
  budget: MoneyState
  bidStrategy: string
}

interface ConfigState {
  adGroupNamePrefix: string
  /** FEAT-061 */
  campaign: CampaignState
  /** FEAT-061 — only sent while `campaign.bidStrategy === 'costCap'` */
  targetCpa: string
  placement: string
  locations: string[]
  ageGroups: string[]
  gender: string
  budget: MoneyState
  schedule: ScheduleState
  timezone: string
  dayparting: string
  /** FEAT-013 pass-through: no control edits it, kept as read so the POST/PATCH round-trip is lossless */
  audiences: { include: string[], exclude: string[] }
  interests: string[]
  languages: string[]
  /** one `advancedPlacementState` value (`inherit` / `on` / `off`) per `advancedPlacementKey` */
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

/** the config shapes the form can be filled from: a stored/default v3 config or a migration draft */
type FillableConfig = AdGroupConfig | MigrationDraft

function rememberTimes(config: FillableConfig) {
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

/** money as the form shows it: always two decimals ("300.00"); `Number()` on submit makes it 300 again */
function moneyToInput(amount: number | null | undefined): string {
  return Number.isFinite(amount) ? (amount as number).toFixed(2) : ''
}

/** the config part of the state, from a v3 config (system default / row) or a migration draft */
function configStateFrom(config: FillableConfig): ConfigState {
  const isScheduled = config.schedule?.startTime !== 'now'
  const endTime = config.schedule?.mode === 'dateRange' ? (config.schedule.endTime ?? '') : ''
  const advanced = config.advancedPlacement
  const campaign = config.campaign
  const campaignBudget = campaign?.budget
  return {
    adGroupNamePrefix: config.adGroupNamePrefix ?? '',
    campaign: {
      name: campaign?.name ?? '',
      // a migration draft leaves it `null` → no radio selected until the admin picks one (spec "required")
      budgetStrategy: campaign?.budgetStrategy ?? '',
      budget: {
        // the type/currency of the campaign budget are prefilled from the ad group's own budget when the
        // campaign has none yet, so only the amount is really missing
        type: campaignBudget?.type ?? config.budget?.type ?? '',
        amount: moneyToInput(campaignBudget?.amount),
        currency: campaignBudget?.currency ?? config.budget?.currency ?? ''
      },
      bidStrategy: campaign?.bidStrategy ?? ''
    },
    targetCpa: config.targetCpa === null || config.targetCpa === undefined ? '' : String(config.targetCpa),
    placement: config.placement,
    locations: [...(config.locations ?? [])],
    ageGroups: [...(config.ageGroups ?? [])],
    gender: config.gender,
    budget: {
      type: config.budget?.type ?? '',
      amount: moneyToInput(config.budget?.amount),
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
    audiences: {
      include: [...(config.audiences?.include ?? [])],
      exclude: [...(config.audiences?.exclude ?? [])]
    },
    interests: [...(config.interests ?? [])],
    languages: [...(config.languages ?? [])],
    advancedPlacement: {
      organicComments: triToRadio(advanced?.organicComments),
      comments: triToRadio(advanced?.comments),
      videoDownload: triToRadio(advanced?.videoDownload),
      videoSharing: triToRadio(advanced?.videoSharing),
      useBlockList: triToRadio(advanced?.useBlockList)
    }
  }
}

/**
 * The whole form state from a row: the edited/migrated one, or — FEAT-057 — the duplicate source, which goes
 * through exactly the same `configStateFrom()` mapping (so every key the source carries is pre-filled and the
 * keys it lacks fall back to the system defaults, as in a plain create). A duplicate starts with
 * `<source> (copy)` as its name; nothing else is renamed. In a migration mode the config values are replaced by
 * the API's `draft` as soon as `GET /:id/migration` answers (`applyDraft`).
 */
function stateFrom(template: AdGroupTemplate | null): FormState {
  const source = template ?? props.duplicateFrom
  const config = source && !needsMigration.value ? source.config : props.options.systemDefault
  rememberTimes(config)
  const duplicate = template === null && source !== null
  return {
    name: source ? (duplicate ? `${source.name} (copy)` : source.name) : '',
    description: source?.description ?? '',
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
 * FEAT-011 — inline messages of the tag inputs (a rejected tag never reaches `state`, so zod would have
 * nothing to complain about). Same binding as `serverErrors`, cleared per field on the next accepted change.
 */
const tagErrors = ref<Record<string, string>>({})

function clearServerErrors() {
  serverErrors.value = {}
}

// any edit invalidates what the server said about the form
watch(state, clearServerErrors, { deep: true })

// the submit button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

// ── FEAT-061 · migration draft (`GET /ad-group-templates/:id/migration`) ─────────────────────────────────────────────
const migration = ref<MigrationResponse | null>(null)
const migrationState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
/** the form controls are replaced by the skeleton while the draft is on its way, and hidden when it failed */
const migrateBusy = computed(() => migrationState.value === 'loading' || migrationState.value === 'error')

function applyDraft(draft: MigrationDraft) {
  rememberTimes(draft)
  state.config = configStateFrom(draft)
  clearServerErrors()
  tagErrors.value = {}
  formRef.value?.clear()
  syncExpanded()
}

async function loadMigration() {
  const id = migrationSource.value?.id
  if (!id) return
  migrationState.value = 'loading'
  migration.value = null
  submitError.value = null
  try {
    // retry: 0 — one GET per open / retry click; it never writes anything (api-contract §2.1)
    const res = await api<MigrationResponse>(
      `/ad-group-templates/${encodeURIComponent(id)}/migration`,
      { retry: 0 }
    )
    migration.value = res
    migrationState.value = 'ready'
    applyDraft(res.draft)
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    migration.value = null
    migrationState.value = 'error'
    submitError.value = { title: err.data?.error ?? err.message ?? 'โหลดข้อมูลสำหรับปรับเป็น Smart+ ไม่ได้' }
  }
}

/**
 * The dropped v2 keys of `GET /:id/migration`, with the label `/options` has for the key when there is one
 * (v3 does not serve a list for the removed keys any more, so this is usually the key itself) and the stored
 * value as JSON text — so the admin sees exactly what is being thrown away.
 */
const droppedRows = computed(() =>
  (migration.value?.dropped ?? []).map(entry => ({
    key: entry.key,
    label: labelOfKey(entry.key),
    value: jsonText(entry.value)
  }))
)

/** every option list of `/options` that labels a *key* (e.g. `advancedPlacementKey`); else the key itself */
function labelOfKey(key: string): string {
  const lists: (OptionItem[] | undefined)[] = [
    props.options.advancedPlacementKey,
    props.options.placement,
    props.options.budgetStrategy,
    props.options.bidStrategy
  ]
  for (const list of lists) {
    const hit = list?.find(item => item.value === key)
    if (hit) return hit.label
  }
  return key
}

function jsonText(value: unknown): string {
  if (value === undefined) return '—'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * `required[]` of the migration response (contract §2.1 rule 5) mapped onto the `UFormField` that owns the
 * value, so an empty required control already carries its message before the first submit attempt. The BO adds
 * `campaign.budget` itself as soon as the admin picks `cbo` (the draft never carries a campaign budget).
 */
const MIGRATE_REQUIRED_FIELD: Readonly<Record<string, string>> = {
  'campaign.budgetStrategy': 'config.campaign.budgetStrategy',
  'campaign.bidStrategy': 'config.campaign.bidStrategy',
  'campaign.budget': 'config.campaign.budget.amount',
  'targetCpa': 'config.targetCpa'
}

const migrateRequiredErrors = computed<Record<string, string>>(() => {
  if (!needsMigration.value || migrationState.value !== 'ready') return {}
  const paths = new Set(migration.value?.required ?? [])
  if (showCampaignBudget.value) paths.add('campaign.budget')
  if (showTargetCpa.value) paths.add('targetCpa')
  const out: Record<string, string> = {}
  for (const path of paths) {
    const field = MIGRATE_REQUIRED_FIELD[path] ?? `config.${path}`
    const message = REQUIRED_MESSAGES[field]
    if (!message || !isEmptyField(field)) continue
    out[field] = message
  }
  return out
})

/** is the control behind a `UFormField` name still empty? (only the paths `required[]` can name) */
function isEmptyField(field: string): boolean {
  switch (field) {
    case 'config.campaign.budgetStrategy': return state.config.campaign.budgetStrategy === ''
    case 'config.campaign.bidStrategy': return state.config.campaign.bidStrategy === ''
    case 'config.campaign.budget.amount': return state.config.campaign.budget.amount.trim() === ''
    case 'config.targetCpa': return state.config.targetCpa.trim() === ''
    default: return false
  }
}

// ── accordion (four collapsible sections; `campaign` and `adgroup` are always open) ──────────────────────────────────
type SectionId = 'campaign' | 'adgroup' | 'placement' | 'audience' | 'budget' | 'bidding'

/**
 * The collapsible sections and the `config` keys each one owns. The Thai heading is the section's TikTok title.
 * FEAT-061: `campaign` + `targetCpa` live in the always-open campaign section (no badge, no toggle) and the
 * removed v2 keys took their controls with them — `placement` is the optimisation location alone, `audience`
 * lost `spendingPower` and `bidding` is the five advanced toggles only.
 * `audiences` belongs to no section (pass-through, never edited → never a badge reason).
 */
const SECTIONS = [
  {
    id: 'placement' as const,
    heading: 'ตำแหน่งการเพิ่มประสิทธิภาพ',
    keys: ['placement'] as const
  },
  {
    id: 'audience' as const,
    heading: 'การกำหนดเป้าหมายผู้ชม',
    keys: ['locations', 'ageGroups', 'gender', 'interests', 'languages'] as const
  },
  {
    id: 'budget' as const,
    heading: 'งบประมาณและกำหนดการ',
    keys: ['budget', 'schedule', 'timezone', 'dayparting'] as const
  },
  {
    id: 'bidding' as const,
    heading: 'การเสนอราคาและการเพิ่มประสิทธิภาพ',
    keys: ['advancedPlacement'] as const
  }
] satisfies readonly { id: SectionId, heading: string, keys: readonly (keyof AdGroupConfig)[] }[]

/** FEAT-061 — the campaign section's TikTok title (always open, like `adgroup`) */
const CAMPAIGN_HEADING = 'แผนการโฆษณา'
/** FEAT-013 — the removed section's TikTok title, kept as the sub-heading of the toggles inside `bidding` (A9) */
const ADVANCED_HEADING = 'ตำแหน่งโฆษณาที่เข้าเกณฑ์ › การตั้งค่าขั้นสูง'

const COLLAPSIBLE_IDS = SECTIONS.map(section => section.id)

/** which section a `config` key (and therefore a `UFormField` name) belongs to */
const SECTION_OF_KEY: Record<string, SectionId> = {
  ...Object.fromEntries(
    SECTIONS.flatMap(section => section.keys.map(key => [key, section.id] as [string, SectionId]))
  ),
  campaign: 'campaign',
  targetCpa: 'campaign'
}

const expanded = reactive<Record<string, boolean>>(
  Object.fromEntries(COLLAPSIBLE_IDS.map(id => [id, false] as [string, boolean]))
)

function toggleSection(id: SectionId) {
  expanded[id] = !expanded[id]
}

/** `UFormField` name → section (`config.campaign.budget.amount` → `campaign`); anything else is `adgroup` */
function sectionOfField(name: string | undefined): SectionId | null {
  if (!name) return null
  if (!name.startsWith('config.')) return 'adgroup'
  const key = name.slice('config.'.length).split('.')[0] ?? ''
  return SECTION_OF_KEY[key] ?? null
}

/** open every collapsible section that holds one of these fields (`campaign` / `adgroup` are always open) */
function expandSectionsOf(names: (string | undefined)[]) {
  for (const name of names) {
    const id = sectionOfField(name)
    if (id && COLLAPSIBLE_IDS.includes(id as typeof COLLAPSIBLE_IDS[number])) expanded[id] = true
  }
}

// ── conditional fields ───────────────────────────────────────────────────────────────────────────────────────────────
const showStartTime = computed(() => state.config.schedule.startMode === 'scheduled')
const showEndTime = computed(() => state.config.schedule.mode === 'dateRange')
/** FEAT-061 — the campaign budget exists only under CBO; `adGroup` sends `campaign.budget: null` */
const showCampaignBudget = computed(() => state.config.campaign.budgetStrategy === 'cbo')
/** FEAT-061 — `targetCpa` exists only for `costCap`; `maxResults` sends `targetCpa: null` */
const showTargetCpa = computed(() => state.config.campaign.bidStrategy === 'costCap')
/**
 * FEAT-013 — the `website` choice is hidden in the BO (the API still accepts and stores it, A4/A5). Filtered by
 * **value**, never by index, so any other item `/options` serves still renders. A stored `website` row therefore
 * shows no selected radio; its value is kept and only leaves the form when the user picks the instant page.
 */
const placementOptions = computed(() => (props.options.placement ?? []).filter(item => item.value !== 'website'))

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

/**
 * Collapse every section that is at the system default, expand the others (open, reset, reset-to-defaults) —
 * unless the admin asked for everything to be open (`agt-form-expand-all`, remembered in `localStorage`).
 * **The default (`false`, nothing stored) is the original behaviour, unchanged.**
 */
function syncExpanded() {
  if (expandAllPref.value) {
    setAllSections(true)
    return
  }
  const byDefault = sectionIsDefault.value
  for (const id of COLLAPSIBLE_IDS) expanded[id] = !byDefault[id]
}

// ── "กางทั้งหมด / ยุบทั้งหมด" (TASK-template-form-ux) ───────────────────────────────────────────────────────────────
/**
 * Whether the admin wants every collapsible section open when the modal opens. `false` is both the initial value
 * and what "ยุบทั้งหมด" stores, so a browser that never pressed the button behaves exactly as before.
 */
const expandAllPref = useLocalStorage('agt-form-expand-all', false)

function setAllSections(open: boolean) {
  for (const id of COLLAPSIBLE_IDS) expanded[id] = open
}

/** what the button offers: the label / icon follow the **current** state, not the stored preference */
const allSectionsExpanded = computed(() => COLLAPSIBLE_IDS.every(id => expanded[id] === true))

function toggleExpandAll() {
  const next = !allSectionsExpanded.value
  expandAllPref.value = next
  setAllSections(next)
}

// ── the one-line summary of a collapsed section (TASK-template-form-ux) ──────────────────────────────────────────────
/** the label `/options` gives a value; the value itself when the list does not know it (an older API) */
function labelOf(items: OptionItem[] | undefined, value: string): string {
  if (value === '') return ''
  return items?.find(item => item.value === value)?.label ?? value
}

/** `a · b · c` of the parts that have something to say, `null` when none of them does (then nothing is rendered) */
function joinSummary(parts: (string | null | undefined)[]): string | null {
  const kept = parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '')
  return kept.length ? kept.join(' · ') : null
}

/** at most `max` labels, the rest as `+n` — a summary is one line, never a full list */
function someLabels(items: OptionItem[] | undefined, values: string[], max = 2): string {
  if (values.length === 0) return ''
  const labels = values.slice(0, max).map(value => labelOf(items, value))
  const rest = values.length - labels.length
  return rest > 0 ? `${labels.join(', ')} +${rest}` : labels.join(', ')
}

/** the words around the `/options` labels (the only Thai this feature adds) */
const SUMMARY_TEXT = {
  languages: (n: number) => `${n} ภาษา`,
  advancedDefault: 'ตามค่าเริ่มต้น',
  advancedSet: (n: number) => `ตั้งเอง ${n} รายการ`
} as const

/** by section id, for the collapsed header. `null` = nothing worth saying → no `<span>` at all */
const sectionSummary = computed<Record<string, string | null>>(() => {
  const c = state.config
  const budget = joinSummary([
    labelOf(props.options.budgetType, c.budget.type),
    c.budget.amount.trim() === '' ? '' : `${c.budget.amount} ${c.budget.currency}`.trim()
  ])
  const customAdvanced = ADVANCED_KEYS.filter(key => (c.advancedPlacement[key] ?? TRI_INHERIT) !== TRI_INHERIT)
  return {
    placement: joinSummary([labelOf(props.options.placement, c.placement)]),
    audience: joinSummary([
      someLabels(props.options.locations, c.locations),
      c.ageGroups.length === 0
        ? props.options.ageGroupsUnlimitedLabel
        : someLabels(props.options.ageGroups, c.ageGroups, 3),
      labelOf(props.options.gender, c.gender),
      c.languages.length === 0 ? '' : SUMMARY_TEXT.languages(c.languages.length)
    ]),
    budget: joinSummary([
      budget,
      labelOf(props.options.scheduleMode, c.schedule.mode),
      labelOf(props.options.dayparting, c.dayparting)
    ]),
    bidding: customAdvanced.length === 0
      ? SUMMARY_TEXT.advancedDefault
      : SUMMARY_TEXT.advancedSet(customAdvanced.length)
  }
})

function resetForm() {
  Object.assign(state, stateFrom(props.template))
  submitting.value = false
  submitError.value = null
  clearServerErrors()
  tagErrors.value = {}
  formRef.value?.clear()
  syncExpanded()
  migration.value = null
  migrationState.value = 'idle'
  // FEAT-061 — a migration mode starts from the API's draft, not from the stored (manual) config
  if (needsMigration.value) void loadMigration()
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

// ── minimum budgets (from `options.minBudget` / `options.campaignMinBudget`, never hard-coded) ───────────────────────
const minBudget = computed(() => props.options.minBudget?.[state.config.budget.currency] ?? null)
/** "ขั้นต่ำ <min> <currency>" — the number and the currency are what QA asserts on */
const minBudgetHint = computed(() =>
  minBudget.value === null ? '' : `ขั้นต่ำ ${minBudget.value} ${state.config.budget.currency}`
)

/** FEAT-061 — the campaign (CBO) minimum of the campaign budget's currency; `null` without the key (older API) */
const campaignMinBudget = computed(() =>
  props.options.campaignMinBudget?.[state.config.campaign.budget.currency] ?? null
)
const campaignMinBudgetHint = computed(() =>
  campaignMinBudget.value === null ? '' : `ขั้นต่ำ ${campaignMinBudget.value} ${state.config.campaign.budget.currency}`
)

/** FEAT-061 — `targetCpa` is money in the ad group's currency */
const targetCpaSuffix = computed(() => state.config.budget.currency)

// ── tag inputs (`interests` / `languages` — FEAT-013 removed the two `audiences` lists) ──────────────────────────────
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
  'config.interests': (v: string[]) => { state.config.interests = v },
  'config.languages': (v: string[]) => { state.config.languages = v }
} as const

type ListFieldName = keyof typeof LIST_FIELDS

const AGE_UNLIMITED = '__unlimited__'

const ageItems = computed(() => [
  { value: AGE_UNLIMITED, label: props.options.ageGroupsUnlimitedLabel },
  ...props.options.ageGroups.map(item => ({ value: item.value, label: item.label }))
])

const ageSelection = computed(() =>
  state.config.ageGroups.length === 0 ? [AGE_UNLIMITED] : state.config.ageGroups
)

function onAgeGroups(next: string[] | undefined) {
  const values = next ?? []
  const ranges = values.filter(value => value !== AGE_UNLIMITED)
  const pickedUnlimited = values.includes(AGE_UNLIMITED)
  const hadUnlimited = state.config.ageGroups.length === 0
  if (pickedUnlimited && ranges.length > 0 && hadUnlimited) {
    state.config.ageGroups = ranges
    return
  }
  if (pickedUnlimited) {
    state.config.ageGroups = []
    return
  }
  state.config.ageGroups = ranges
}

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

/**
 * FEAT-061 — the campaign / targetCpa messages are the API's own (api-contract §1.1 and the `money()` family of
 * `ad-group-templates.dto.ts`), so a client refusal and a 400 read the same sentence.
 */
const MSG = {
  budgetStrategy: 'budgetStrategy ต้องเป็น cbo หรือ adGroup',
  bidStrategy: 'bidStrategy ต้องเป็น maxResults หรือ costCap',
  campaignBudgetRequired: 'กรอกงบประมาณแผนการโฆษณา (CBO)',
  campaignBudgetType: 'budget.type ต้องเป็น daily หรือ lifetime',
  targetCpaRequired: 'กรอกค่าใช้จ่ายต่อผลลัพธ์เป้าหมาย',
  campaignName: 'ชื่อแผนการโฆษณายาวเกิน 100 ตัว',
  money: (label: string) => ({
    number: `${label}ต้องเป็นตัวเลข`,
    positive: `${label}ต้องมากกว่า 0`,
    decimals: `${label}มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง`
  })
} as const

const CAMPAIGN_MONEY = MSG.money('งบประมาณ')
const TARGET_CPA_MONEY = MSG.money('ค่าใช้จ่ายต่อผลลัพธ์เป้าหมาย')

/** the "still empty" message of a `required[]` path of the migration draft */
const REQUIRED_MESSAGES: Readonly<Record<string, string>> = {
  'config.campaign.budgetStrategy': MSG.budgetStrategy,
  'config.campaign.bidStrategy': MSG.bidStrategy,
  'config.campaign.budget.amount': MSG.campaignBudgetRequired,
  'config.targetCpa': MSG.targetCpaRequired
}

/** money typed into a text input: the issue to add, or `null` when the value is fine */
function moneyIssue(
  value: string,
  messages: { number: string, positive: string, decimals: string },
  min: number | null,
  currency: string
): string | null {
  if (!NUMBER_RE.test(value)) return messages.number
  const n = Number(value)
  if (!twoDecimals(n)) return messages.decimals
  if (n <= 0) return messages.positive
  if (min !== null && n < min) return `งบประมาณขั้นต่ำ ${min} ${currency}`
  return null
}

function makeSchema(minBudget: Record<string, number>, limits: AdGroupListLimits, campaignMin: Record<string, number> | null) {
  return z.object({
    name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be at most 100 characters'),
    description: z.string().trim().max(500, 'Description must be at most 500 characters'),
    config: z.object({
      adGroupNamePrefix: z.string().trim().max(100, 'Prefix must be at most 100 characters'),
      campaign: z.object({
        name: z.string().trim().max(100, MSG.campaignName),
        budgetStrategy: z.string(),
        budget: z.object({
          type: z.string(),
          amount: z.string().trim(),
          currency: z.string()
        }),
        bidStrategy: z.string()
      }),
      targetCpa: z.string().trim(),
      placement: z.string().min(1, 'Placement is required'),
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
      // FEAT-013 pass-through: no control can produce a value, so nothing is validated client-side (an API issue
      // at `config.audiences.*` goes to `agt-form-error`)
      audiences: z.object({ include: z.array(z.string()), exclude: z.array(z.string()) }),
      interests: z.array(z.string()),
      languages: z.array(z.string()),
      advancedPlacement: z.record(z.string(), z.string())
    })
  }).superRefine((data, ctx) => {
    // ── FEAT-061 campaign section ────────────────────────────────────────────────────────────────────────────
    const campaign = data.config.campaign
    if (campaign.budgetStrategy === '') {
      ctx.addIssue({ code: 'custom', path: ['config', 'campaign', 'budgetStrategy'], message: MSG.budgetStrategy })
    }
    if (campaign.bidStrategy === '') {
      ctx.addIssue({ code: 'custom', path: ['config', 'campaign', 'bidStrategy'], message: MSG.bidStrategy })
    }
    if (campaign.budgetStrategy === 'cbo') {
      const amountPath = ['config', 'campaign', 'budget', 'amount']
      if (campaign.budget.type === '') {
        ctx.addIssue({ code: 'custom', path: ['config', 'campaign', 'budget', 'type'], message: MSG.campaignBudgetType })
      }
      if (campaign.budget.amount === '') {
        ctx.addIssue({ code: 'custom', path: amountPath, message: MSG.campaignBudgetRequired })
      } else {
        const min = campaignMin?.[campaign.budget.currency] ?? null
        const issue = moneyIssue(campaign.budget.amount, CAMPAIGN_MONEY, min, campaign.budget.currency)
        if (issue) ctx.addIssue({ code: 'custom', path: amountPath, message: issue })
      }
    }
    if (campaign.bidStrategy === 'costCap') {
      const path = ['config', 'targetCpa']
      if (data.config.targetCpa === '') {
        ctx.addIssue({ code: 'custom', path, message: MSG.targetCpaRequired })
      } else {
        const issue = moneyIssue(data.config.targetCpa, TARGET_CPA_MONEY, null, '')
        if (issue) ctx.addIssue({ code: 'custom', path, message: issue })
      }
    }

    // ── ad group budget amount — required, numeric, at most 2 decimals, >= the minimum of its currency ────────
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

    // FEAT-011 — the two free-text lists (the tag inputs already refuse these; zod is the backstop)
    const lists: { path: string[], items: string[] }[] = [
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
  })
}

type Schema = z.output<ReturnType<typeof makeSchema>>

// rebuilt when the limits change; the currencies are read inside the refinement
const schema = computed(() => makeSchema(
  props.options.minBudget ?? {},
  listLimits.value,
  props.options.campaignMinBudget ?? null
))

// ── body building ────────────────────────────────────────────────────────────────────────────────────────────────────
/** the complete 15-key v3 `AdGroupConfig` the API expects, from the current state */
function configFromState(): AdGroupConfig {
  const c = state.config
  const prefix = c.adGroupNamePrefix.trim()

  // BUG-008: an untouched picker re-emits the instant it was filled from, seconds included
  const startTime = c.schedule.startMode === 'scheduled'
    ? isoFromPicker(c.schedule.startTime, originalTimes.startTime)
    : 'now'
  const schedule: AdGroupSchedule = c.schedule.mode === 'dateRange'
    ? { mode: 'dateRange', startTime, endTime: isoFromPicker(c.schedule.endTime, originalTimes.endTime) }
    : { mode: 'continuous', startTime }

  // FEAT-061 — a hidden campaign budget / targetCpa is sent as `null`, whatever the form still holds
  const campaignName = c.campaign.name.trim()
  const campaignAmount = c.campaign.budget.amount.trim()
  const campaignBudget: AdGroupBudget | null = c.campaign.budgetStrategy === 'cbo'
    ? {
        type: c.campaign.budget.type as AdGroupBudget['type'],
        amount: Number(campaignAmount),
        currency: c.campaign.budget.currency as AdGroupBudget['currency']
      }
    : null
  const campaign: AdGroupCampaign = {
    name: campaignName === '' ? null : campaignName,
    budgetStrategy: c.campaign.budgetStrategy as AdGroupCampaign['budgetStrategy'],
    budget: campaignBudget,
    bidStrategy: c.campaign.bidStrategy as AdGroupCampaign['bidStrategy']
  }
  const targetCpaText = c.targetCpa.trim()
  const targetCpa = c.campaign.bidStrategy === 'costCap' && targetCpaText !== '' ? Number(targetCpaText) : null

  // hidden is not cleared: an `instantPage` placement still sends the website-only values below (the job decides
  // what to use). FEAT-013 — `audiences` is pass-through: rebuilt exactly as it was read, so the diff never marks
  // it changed unless `Reset to TikTok defaults` replaced it (A8).
  return {
    adGroupNamePrefix: prefix === '' ? null : prefix,
    campaign,
    targetCpa,
    placement: c.placement as AdGroupConfig['placement'],
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
    audiences: { include: [...c.audiences.include], exclude: [...c.audiences.exclude] },
    interests: [...c.interests],
    languages: [...c.languages],
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

/** the 15 top-level `config` keys, in `CONFIG_KEYS` order (FEAT-061 api-contract §1.1) */
const CONFIG_KEYS = [
  'adGroupNamePrefix', 'campaign', 'targetCpa', 'placement', 'locations', 'ageGroups', 'gender', 'budget',
  'schedule', 'timezone', 'dayparting', 'audiences', 'interests', 'languages', 'advancedPlacement'
] as const satisfies readonly (keyof AdGroupConfig)[]

/** only the keys whose value really changed; each changed `config` key is sent whole (A3) */
function patchBodyFrom(original: AdGroupTemplate, name: string, description: string | null): PatchAdGroupTemplateBody {
  const body: PatchAdGroupTemplateBody = {}
  if (name !== original.name) body.name = name
  if (description !== original.description) body.description = description

  const next = configFromState()
  const changed: Partial<AdGroupConfig> = {}
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
 * `UFormField` names an API issue can land on. Everything a collapsed section holds counts: the section is
 * expanded before the message is shown (a collapsed body is hidden, not unmounted). Fields that do not exist at
 * all are left out, so their issue goes to the form alert: the `v-if` ones (start/end time, the campaign budget
 * under `adGroup`, `targetCpa` under `maxResults`) and every path under the pass-through key `config.audiences`.
 */
const visibleFieldNames = computed(() => {
  const names = [
    'name', 'description',
    'config.adGroupNamePrefix',
    'config.campaign.name', 'config.campaign.budgetStrategy', 'config.campaign.bidStrategy',
    'config.placement',
    'config.locations', 'config.ageGroups', 'config.gender',
    'config.budget.type', 'config.budget.amount', 'config.budget.currency',
    'config.schedule.mode', 'config.schedule.startMode',
    'config.timezone', 'config.dayparting',
    'config.interests', 'config.languages',
    ...ADVANCED_KEYS.map(key => `config.advancedPlacement.${key}`)
  ]
  // rendered with `v-if`: while it does not exist, its issue belongs in the form alert (Lead ruling 2026-09-25)
  if (showCampaignBudget.value) names.push('config.campaign.budget.type', 'config.campaign.budget.amount')
  if (showTargetCpa.value) names.push('config.targetCpa')
  if (showStartTime.value) names.push('config.schedule.startTime')
  if (showEndTime.value) names.push('config.schedule.endTime')
  return new Set(names)
})

/**
 * The `UFormField` an API issue belongs to, or `null` for the form-level alert.
 * Array-item paths are folded onto their field (`config.locations.0` → `config.locations`,
 * `config.interests.3` → `config.interests`), so an item error lands on the control that owns the array; the
 * same folding puts `config.campaign.budget` on the amount input when the whole budget is refused.
 * `catalogVersion` matches nothing (the BO never sends it) and goes to `agt-form-error`, as do the pass-through
 * paths `config.audiences.include.0`, the manual-template refusal at `config` (api-contract §2.3) and an empty
 * path (empty PATCH body).
 */
function resolveFieldName(path: string): string | null {
  if (path === 'config.campaign.budget' && showCampaignBudget.value) return 'config.campaign.budget.amount'
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

  // 409 duplicate name → always at the name field (a migrate never changes the name — AS-7 — so its 409
  // `alreadySmartPlus` has no `issues` and lands in the form alert below)
  if (status === 409 && data?.reason !== 'alreadySmartPlus') {
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

  // FEAT-061 — migrate: the **full** 15-key config replaces the stored manual one; name/description are not sent
  if (isMigrate.value && original) {
    const body: MigrateBody = { config: configFromState() }
    submitting.value = true
    try {
      // retry: 0 — exactly one POST per submit
      const updated = await api<AdGroupTemplate>(
        `/ad-group-templates/${encodeURIComponent(original.id)}/migrate`,
        { method: 'POST', body, retry: 0 }
      )
      open.value = false
      toast.add({ title: 'Template migrated to Smart+', description: updated.name, color: 'success' })
      emit('updated', updated)
    } catch (e) {
      showApiError(e, 'ปรับเป็น Smart+ ไม่สำเร็จ')
    } finally {
      submitting.value = false
    }
    return
  }

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

  // create always sends the complete 15-key config and never `catalogVersion` (the API stamps it)
  const body: CreateAdGroupTemplateBody = { name, description, config: configFromState() }
  // FEAT-057 — one single POST for a duplicate too; `duplicateOf` is the only extra key (api-contract §5)
  const duplicate = isDuplicate.value
  const source = props.duplicateFrom
  if (duplicate && source) body.duplicateOf = source.id
  submitting.value = true
  try {
    // retry: 0 — exactly one POST per submit
    const created = await api<AdGroupTemplate>('/ad-group-templates', { method: 'POST', body, retry: 0 })
    open.value = false
    toast.add({
      title: duplicate ? 'Template duplicated' : 'Template created',
      description: created.name,
      color: 'success'
    })
    emit('created', created)
  } catch (e) {
    showApiError(e, duplicate ? 'Could not duplicate the template' : 'Could not create the template')
  } finally {
    submitting.value = false
  }
}

/** the message to show on a field: what the API said, what a rejected tag said, else a missing required value */
function fieldError(name: string): string | undefined {
  return serverErrors.value[name] ?? tagErrors.value[name] ?? migrateRequiredErrors.value[name]
}

const submitLabel = computed(() => {
  if (isMigrate.value) return 'บันทึกเป็น Smart+'
  return isEdit.value ? 'Save' : 'Create'
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="modalTitle"
    :description="modalDescription"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-3xl sm:max-w-3xl lg:max-w-5xl xl:max-w-6xl' }"
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
        <!-- FEAT-061 — migration banner (migrate, and the duplicate of a manual row) -->
        <UAlert
          v-if="needsMigration"
          color="warning"
          variant="subtle"
          icon="i-lucide-wand-sparkles"
          :title="isMigrate ? MIGRATE_BANNER : MIGRATE_COPY_BANNER"
          role="status"
          data-testid="agt-migrate-banner"
        />

        <!-- FEAT-061 — the draft is on its way: skeleton instead of the controls -->
        <div v-if="migrationState === 'loading'" class="space-y-3" data-testid="agt-migrate-loading">
          <USkeleton v-for="n in 6" :key="n" class="h-10 w-full" />
        </div>

        <template v-if="!migrateBusy">
          <!--
            TASK-template-form-ux — one button for the whole accordion, remembered in `localStorage`. It sits
            above the first section and never touches `campaign` / `adgroup` (they have no toggle at all).
          -->
          <div class="flex justify-end">
            <UButton
              :label="allSectionsExpanded ? 'ยุบทั้งหมด' : 'กางทั้งหมด'"
              :icon="allSectionsExpanded ? 'i-lucide-chevrons-down-up' : 'i-lucide-chevrons-up-down'"
              color="neutral"
              variant="ghost"
              size="xs"
              :aria-pressed="allSectionsExpanded"
              data-testid="agt-form-expand-all"
              @click="toggleExpandAll"
            />
          </div>

          <!-- 1. campaign (FEAT-061) — always open, no toggle -->
          <section class="grid gap-4 xl:grid-cols-2" data-testid="agt-sec-campaign">
            <h3 class="text-sm font-semibold text-highlighted xl:col-span-2">
              {{ CAMPAIGN_HEADING }}
            </h3>

            <UFormField
              label="Campaign name"
              name="config.campaign.name"
              hint="Optional"
              :error="fieldError('config.campaign.name')"
            >
              <UInput
                v-model="state.config.campaign.name"
                placeholder="ให้ TikTok ตั้งชื่อ"
                class="w-full"
                :disabled="submitting"
                data-testid="agt-campaign-name"
              />
            </UFormField>

            <UFormField
              label="Budget strategy"
              name="config.campaign.budgetStrategy"
              required
              :error="fieldError('config.campaign.budgetStrategy')"
            >
              <URadioGroup
                v-model="state.config.campaign.budgetStrategy"
                :items="options.budgetStrategy"
                value-key="value"
                :disabled="submitting"
                data-testid="agt-campaign-budget-strategy"
              />
            </UFormField>

            <!-- CBO only: the campaign budget (sent as `null` for `adGroup`); its own two columns at `sm` -->
            <div v-if="showCampaignBudget" class="grid gap-4 sm:grid-cols-2 xl:col-span-2">
              <UFormField
                label="Campaign budget type"
                name="config.campaign.budget.type"
                required
                :error="fieldError('config.campaign.budget.type')"
              >
                <USelect
                  v-model="state.config.campaign.budget.type"
                  :items="options.budgetType"
                  value-key="value"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-campaign-budget-type"
                />
              </UFormField>

              <UFormField
                label="Campaign budget"
                name="config.campaign.budget.amount"
                required
                :error="fieldError('config.campaign.budget.amount')"
              >
                <!-- text + inputmode instead of type="number": `1,5x` must reach the zod schema so the
                     "ต้องเป็นตัวเลข" message can be shown -->
                <UInput
                  v-model="state.config.campaign.budget.amount"
                  type="text"
                  inputmode="decimal"
                  placeholder="600"
                  class="w-full"
                  :disabled="submitting"
                  data-testid="agt-campaign-budget-amount"
                />
                <template #help>
                  <span data-testid="agt-campaign-min-budget">{{ campaignMinBudgetHint }}</span>
                </template>
              </UFormField>
            </div>

            <UFormField
              label="Bid strategy"
              name="config.campaign.bidStrategy"
              required
              :error="fieldError('config.campaign.bidStrategy')"
            >
              <URadioGroup
                v-model="state.config.campaign.bidStrategy"
                :items="options.bidStrategy"
                value-key="value"
                :disabled="submitting"
                data-testid="agt-campaign-bid-strategy"
              />
            </UFormField>

            <!-- costCap only: the target cost per result (sent as `null` for `maxResults`) -->
            <UFormField
              v-if="showTargetCpa"
              label="Target cost per result"
              name="config.targetCpa"
              required
              :help="targetCpaSuffix"
              :error="fieldError('config.targetCpa')"
            >
              <UInput
                v-model="state.config.targetCpa"
                type="text"
                inputmode="decimal"
                placeholder="120"
                class="w-full sm:max-w-xs"
                :disabled="submitting"
                data-testid="agt-target-cpa"
              />
            </UFormField>
          </section>

          <!-- 2. ad group — always open, no toggle -->
          <section class="grid gap-4 border-t border-default pt-4 xl:grid-cols-2" data-testid="agt-sec-adgroup">
            <h3 class="text-sm font-semibold text-highlighted xl:col-span-2">
              กลุ่มโฆษณา
            </h3>

            <UFormField
              label="Name"
              name="name"
              required
              :hint="isMigrate ? 'แก้ไม่ได้ในโหมดนี้' : undefined"
              :error="serverErrors['name']"
            >
              <UInput
                v-model="state.name"
                placeholder="Sales TH default"
                class="w-full"
                :disabled="submitting || isMigrate"
                data-testid="agt-form-name"
              />
            </UFormField>

            <!-- the only multi-line control of this section → full width on a wide screen -->
            <UFormField
              label="Description"
              name="description"
              class="xl:col-span-2"
              :hint="isMigrate ? 'แก้ไม่ได้ในโหมดนี้' : 'Optional'"
              :error="serverErrors['description']"
            >
              <UTextarea
                v-model="state.description"
                :rows="2"
                placeholder="What this template is for"
                class="w-full"
                :disabled="submitting || isMigrate"
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

          <!-- 3. placement / optimization location -->
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
                <span
                  v-if="!expanded.placement && sectionSummary.placement"
                  class="min-w-0 flex-1 truncate text-xs font-normal text-muted"
                  data-testid="agt-sec-placement-summary"
                >{{ sectionSummary.placement }}</span>
              </button>
            </h3>

            <div
              v-show="expanded.placement"
              id="agt-sec-placement"
              class="mt-4 grid gap-4 xl:grid-cols-2"
              data-testid="agt-sec-placement"
            >
              <!-- the only control of this section, and its labels are long → full width -->
              <UFormField
                label="Placement"
                name="config.placement"
                required
                class="xl:col-span-2"
                :error="serverErrors['config.placement']"
              >
                <!-- FEAT-013: `website` is filtered out; a stored `website` value shows no selected radio -->
                <URadioGroup
                  v-model="state.config.placement"
                  :items="placementOptions"
                  value-key="value"
                  :disabled="submitting"
                  data-testid="agt-form-placement"
                />
              </UFormField>
            </div>
          </section>

          <!-- 4. audience targeting -->
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
                <span
                  v-if="!expanded.audience && sectionSummary.audience"
                  class="min-w-0 flex-1 truncate text-xs font-normal text-muted"
                  data-testid="agt-sec-audience-summary"
                >{{ sectionSummary.audience }}</span>
              </button>
            </h3>

            <div
              v-show="expanded.audience"
              id="agt-sec-audience"
              class="mt-4 grid gap-4 xl:grid-cols-2"
              data-testid="agt-sec-audience"
            >
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

              <!-- a horizontal row of seven checkboxes → full width on a wide screen -->
              <UFormField
                label="Age"
                name="config.ageGroups"
                class="xl:col-span-2"
                :error="serverErrors['config.ageGroups']"
              >
                <UCheckboxGroup
                  :model-value="ageSelection"
                  :items="ageItems"
                  value-key="value"
                  orientation="horizontal"
                  :disabled="submitting"
                  data-testid="agt-form-ages"
                  @update:model-value="onAgeGroups"
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
            </div>
          </section>

          <!-- 5. budget and schedule -->
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
                <span
                  v-if="!expanded.budget && sectionSummary.budget"
                  class="min-w-0 flex-1 truncate text-xs font-normal text-muted"
                  data-testid="agt-sec-budget-summary"
                >{{ sectionSummary.budget }}</span>
              </button>
            </h3>

            <div
              v-show="expanded.budget"
              id="agt-sec-budget"
              class="mt-4 grid gap-4 xl:grid-cols-2"
              data-testid="agt-sec-budget"
            >
              <!-- type + amount + currency keep their own three columns → they span the section grid -->
              <div class="grid gap-4 sm:grid-cols-3 xl:col-span-2">
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

              <!-- start / end time keep their own two columns → they span the section grid -->
              <div class="grid gap-4 sm:grid-cols-2 xl:col-span-2">
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

              <!-- timezone + dayparting keep their own two columns → they span the section grid -->
              <div class="grid gap-4 sm:grid-cols-2 xl:col-span-2">
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

          <!-- 6. bidding and optimization — FEAT-061: the five advanced-placement toggles only -->
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
                <span
                  v-if="!expanded.bidding && sectionSummary.bidding"
                  class="min-w-0 flex-1 truncate text-xs font-normal text-muted"
                  data-testid="agt-sec-bidding-summary"
                >{{ sectionSummary.bidding }}</span>
              </button>
            </h3>

            <div
              v-show="expanded.bidding"
              id="agt-sec-bidding"
              class="mt-4 grid gap-4 xl:grid-cols-2"
              data-testid="agt-sec-bidding"
            >
              <!-- FEAT-013: the former `advanced` section — five tri-state toggles under their TikTok sub-heading -->
              <h4
                class="text-sm font-semibold text-highlighted xl:col-span-2"
                data-testid="agt-form-advanced-heading"
              >
                {{ ADVANCED_HEADING }}
              </h4>

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

          <!-- FEAT-061 — what the migration throws away (dropped / renamed / notes of `GET /:id/migration`) -->
          <section
            v-if="needsMigration && migrationState === 'ready'"
            class="space-y-2 border-t border-default pt-4"
            data-testid="agt-migrate-dropped"
          >
            <h3 class="text-sm font-semibold text-highlighted">
              {{ MIGRATE_DROPPED_HEADING }}
            </h3>
            <p v-if="droppedRows.length === 0 && (migration?.renamed?.length ?? 0) === 0 && (migration?.notes?.length ?? 0) === 0" class="text-sm text-muted">
              —
            </p>
            <ul v-if="droppedRows.length" class="space-y-1 text-sm">
              <li
                v-for="row in droppedRows"
                :key="row.key"
                class="flex flex-wrap items-baseline gap-2"
                :data-key="row.key"
                data-testid="agt-migrate-dropped-row"
              >
                <span class="font-medium text-highlighted">{{ row.label }}</span>
                <code class="rounded bg-elevated px-1.5 py-0.5 text-xs break-all text-muted">{{ row.value }}</code>
              </li>
            </ul>
            <ul v-if="migration?.renamed?.length" class="space-y-1 text-sm text-muted">
              <li
                v-for="rename in migration.renamed"
                :key="`${rename.from}-${rename.to}`"
                data-testid="agt-migrate-renamed"
              >
                {{ rename.from }} → {{ rename.to }}
              </li>
            </ul>
            <ul v-if="migration?.notes?.length" class="space-y-1 text-xs text-muted">
              <li v-for="note in migration.notes" :key="note" data-testid="agt-migrate-note">
                {{ note }}
              </li>
            </ul>
          </section>
        </template>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="agt-form-error"
        >
          <template v-if="migrationState === 'error'" #actions>
            <UButton
              label="Retry"
              icon="i-lucide-refresh-cw"
              color="error"
              variant="solid"
              size="xs"
              data-testid="agt-migrate-retry"
              @click="loadMigration()"
            />
          </template>
        </UAlert>
      </UForm>
    </template>

    <!-- actions in the footer so they stay reachable while the sections scroll (390x844) -->
    <template #footer>
      <div class="flex w-full flex-wrap items-center justify-end gap-2">
        <!-- FEAT-061 — hidden in a migration mode: it would throw the API's draft away -->
        <UButton
          v-if="!needsMigration"
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
          :label="submitLabel"
          :icon="isEdit ? 'i-lucide-check' : (isMigrate ? 'i-lucide-wand-sparkles' : 'i-lucide-plus')"
          color="primary"
          variant="solid"
          :loading="submitting"
          :disabled="migrateBusy"
          data-testid="agt-form-submit"
          @click="formRef?.submit()"
        />
      </div>
    </template>
  </UModal>
</template>
