<script setup lang="ts">
/**
 * FEAT-008 — Create / Edit ad group template (function 6.8; api-contract.md v1 `POST /ad-group-templates`,
 * `PATCH /ad-group-templates/:id`).
 *
 * One component for both modes: `template === null` → create (`POST` with a **complete** config prefilled from
 * `options.systemDefault`), a row → edit (`PATCH` with **only the changed keys**; each changed top-level `config`
 * key is sent whole — assumption A3).
 *
 * Every select / radio / checkbox list is built from `options` (`{ value, label }`), so no enum label is
 * hard-coded in the BO. The form state mirrors the API body (`name`, `description`, `config.*`), which makes a
 * zod issue path and an API `issues[].path` land on the same `UFormField` name (`config.budget.amount`, …).
 * `config.schedule.startMode` is the only UI-only key: it decides whether `startTime` is the literal `'now'` or
 * the ISO value of the `datetime-local` picker (assumption A9, browser-local time).
 */
import * as z from 'zod'
import type { FetchError } from 'ofetch'
import type { Form, FormSubmitEvent, ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupConfig,
  AdGroupDataConnection,
  AdGroupSchedule,
  AdGroupTemplate,
  AdGroupTemplateOptions,
  CreateAdGroupTemplateBody,
  OptionItem,
  PatchAdGroupTemplateBody
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

/** the config part of the state, from any `AdGroupConfig` (the system default on create, the row on edit) */
function configStateFrom(config: AdGroupConfig): ConfigState {
  const named = config.dataConnection?.mode === 'named'
  const isScheduled = config.schedule?.startTime !== 'now'
  const endTime = config.schedule?.mode === 'dateRange' ? (config.schedule.endTime ?? '') : ''
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
    costCap: config.costCap === null || config.costCap === undefined ? '' : String(config.costCap)
  }
}

function stateFrom(template: AdGroupTemplate | null): FormState {
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

// the submit button sits in the modal footer, outside the <form> → submit through the exposed api
const formRef = useTemplateRef<Form<Schema>>('formRef')

function resetForm() {
  Object.assign(state, stateFrom(props.template))
  submitting.value = false
  submitError.value = null
  formRef.value?.clear()
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})

/** "Reset to TikTok defaults" — config controls only, name/description untouched, no request */
function resetToDefaults() {
  state.config = configStateFrom(props.options.systemDefault)
  submitError.value = null
  formRef.value?.clear()
}

// ── conditional fields ───────────────────────────────────────────────────────────────────────────────────────────────
const showConnectionName = computed(() => state.config.dataConnection.mode === 'named')
const showStartTime = computed(() => state.config.schedule.startMode === 'scheduled')
const showEndTime = computed(() => state.config.schedule.mode === 'dateRange')

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

// ── validation (mirrors api-contract.md; an invalid form never reaches the network) ──────────────────────────────────
const NUMBER_RE = /^-?\d+(\.\d+)?$/

function twoDecimals(n: number): boolean {
  return Math.round(n * 100) / 100 === n
}

function makeSchema(minBudget: Record<string, number>) {
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
      costCap: z.string().trim()
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
  })
}

type Schema = z.output<ReturnType<typeof makeSchema>>

// rebuilt when `minBudget` changes; the currency is read inside the refinement
const schema = computed(() => makeSchema(props.options.minBudget ?? {}))

// ── body building ────────────────────────────────────────────────────────────────────────────────────────────────────
/** the complete `AdGroupConfig` the API expects, from the current state */
function configFromState(): AdGroupConfig {
  const c = state.config
  const prefix = c.adGroupNamePrefix.trim()

  const dataConnection: AdGroupDataConnection = c.dataConnection.mode === 'named'
    ? { mode: 'named', name: c.dataConnection.name.trim() }
    : { mode: 'first' }

  const startTime = c.schedule.startMode === 'scheduled' ? localInputToIso(c.schedule.startTime) : 'now'
  const schedule: AdGroupSchedule = c.schedule.mode === 'dateRange'
    ? { mode: 'dateRange', startTime, endTime: localInputToIso(c.schedule.endTime) }
    : { mode: 'continuous', startTime }

  const costCap = c.costCap.trim()

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
    costCap: costCap === '' ? null : Number(costCap)
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

const CONFIG_KEYS = [
  'adGroupNamePrefix', 'placement', 'dataConnection', 'optimizationEvent', 'locations', 'ageGroups',
  'gender', 'budget', 'schedule', 'timezone', 'dayparting', 'optimizationGoal', 'costCap'
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
/** `UFormField` names that are visible right now — an issue for any other path goes to the form alert */
const visibleFieldNames = computed(() => {
  const names = [
    'name', 'description',
    'config.adGroupNamePrefix', 'config.placement', 'config.dataConnection.mode',
    'config.optimizationEvent', 'config.locations', 'config.ageGroups', 'config.gender',
    'config.budget.type', 'config.budget.amount', 'config.budget.currency',
    'config.schedule.mode', 'config.schedule.startMode',
    'config.timezone', 'config.dayparting', 'config.optimizationGoal', 'config.costCap'
  ]
  if (showConnectionName.value) names.push('config.dataConnection.name')
  if (showStartTime.value) names.push('config.schedule.startTime')
  if (showEndTime.value) names.push('config.schedule.endTime')
  return new Set(names)
})

/**
 * The visible `UFormField` an API issue belongs to, or `null` for the form-level alert.
 * Array-item paths are folded onto their field (`config.locations.0` → `config.locations`,
 * `config.ageGroups.1` → `config.ageGroups`), so an item error lands on the control that owns the array.
 * An empty path (empty PATCH body) never matches and goes to `agt-form-error`.
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
    formRef.value?.setErrors([{ name: 'name', message: data?.error ?? 'Name already used in this workspace' }])
    return
  }

  const issues = data?.issues ?? []
  if (issues.length) {
    const matched: { name: string, message: string }[] = []
    const unmatched: { path: string, message: string }[] = []
    for (const issue of issues) {
      const name = resolveFieldName(issue.path)
      if (name) matched.push({ name, message: issue.message })
      else unmatched.push(issue)
    }
    if (matched.length) {
      formRef.value?.setErrors(matched)
    }
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

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────────
async function onSubmit(event: FormSubmitEvent<Schema>) {
  if (submitting.value) return
  submitError.value = null

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
        class="space-y-6"
        @submit="onSubmit"
      >
        <!-- 1. ad group -->
        <section class="space-y-4" data-testid="agt-sec-adgroup">
          <h3 class="text-sm font-semibold text-highlighted">
            กลุ่มโฆษณา
          </h3>

          <UFormField label="Name" name="name" required>
            <UInput
              v-model="state.name"
              placeholder="Sales TH default"
              class="w-full"
              :disabled="submitting"
              data-testid="agt-form-name"
            />
          </UFormField>

          <UFormField label="Description" name="description" hint="Optional">
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
        <section class="space-y-4 border-t border-default pt-6" data-testid="agt-sec-placement">
          <h3 class="text-sm font-semibold text-highlighted">
            ตำแหน่งการเพิ่มประสิทธิภาพ
          </h3>

          <UFormField label="Placement" name="config.placement" required>
            <URadioGroup
              v-model="state.config.placement"
              :items="options.placement"
              value-key="value"
              orientation="horizontal"
              :disabled="submitting"
              data-testid="agt-form-placement"
            />
          </UFormField>

          <UFormField label="Data connection" name="config.dataConnection.mode" required>
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
          >
            <UInput
              v-model="state.config.dataConnection.name"
              placeholder="tiktok capi"
              class="w-full"
              :disabled="submitting"
              data-testid="agt-form-dc-name"
            />
          </UFormField>

          <UFormField label="Optimization event" name="config.optimizationEvent" required>
            <USelect
              v-model="state.config.optimizationEvent"
              :items="options.optimizationEvent"
              value-key="value"
              class="w-full sm:max-w-xs"
              :disabled="submitting"
              data-testid="agt-form-event"
            />
          </UFormField>
        </section>

        <!-- 3. audience -->
        <section class="space-y-4 border-t border-default pt-6" data-testid="agt-sec-audience">
          <h3 class="text-sm font-semibold text-highlighted">
            การกำหนดเป้าหมายผู้ชม
          </h3>

          <UFormField label="Locations" name="config.locations" required>
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

          <UFormField label="Gender" name="config.gender" required>
            <URadioGroup
              v-model="state.config.gender"
              :items="options.gender"
              value-key="value"
              orientation="horizontal"
              :disabled="submitting"
              data-testid="agt-form-gender"
            />
          </UFormField>
        </section>

        <!-- 4. budget and schedule -->
        <section class="space-y-4 border-t border-default pt-6" data-testid="agt-sec-budget">
          <h3 class="text-sm font-semibold text-highlighted">
            งบประมาณและกำหนดการ
          </h3>

          <div class="grid gap-4 sm:grid-cols-3">
            <UFormField label="Budget type" name="config.budget.type" required>
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

            <UFormField label="Currency" name="config.budget.currency" required>
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

          <UFormField label="Schedule" name="config.schedule.mode" required>
            <URadioGroup
              v-model="state.config.schedule.mode"
              :items="options.scheduleMode"
              value-key="value"
              :disabled="submitting"
              data-testid="agt-form-schedule-mode"
            />
          </UFormField>

          <UFormField label="Start" name="config.schedule.startMode" required>
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
            <UFormField label="Timezone" name="config.timezone" required>
              <USelect
                v-model="state.config.timezone"
                :items="options.timezone"
                value-key="value"
                class="w-full"
                :disabled="submitting"
                data-testid="agt-form-timezone"
              />
            </UFormField>

            <UFormField label="Dayparting" name="config.dayparting" required>
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
        </section>

        <!-- 5. bidding and optimization -->
        <section class="space-y-4 border-t border-default pt-6" data-testid="agt-sec-bidding">
          <h3 class="text-sm font-semibold text-highlighted">
            การเสนอราคาและการเพิ่มประสิทธิภาพ
          </h3>

          <div class="grid gap-4 sm:grid-cols-2">
            <UFormField label="Optimization goal" name="config.optimizationGoal" required>
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
