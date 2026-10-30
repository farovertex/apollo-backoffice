<script setup lang="ts">
/**
 * FEAT-086 (spec "UI behaviour" §1, AC-20, api-contract v1 §2/§3) — `/settings/ad-group-guard`, tab "กฎปิด ad group".
 *
 * GOD + Admin (`prefixes-access`: a Payment-only admin gets the "Not allowed" redirect, no request is made).
 *  - **Master switch** (`st-agg-master`, GOD only): one `GET /settings/ad-group-guard` per mount / Retry, one
 *    `PATCH { enabled }` per Save. The GET is GOD-only on the API (A8), so an Admin never calls it and sees the
 *    plain hint `st-agg-master-readonly` instead of the card.
 *  - **Workspace rules** (`st-agg-workspace-card`): `GET /workspaces` once per mount / Retry feeds the selector
 *    `st-agg-workspace` (GOD: all, Admin: own + shared). The rows are the selected workspace's `adGroupGuard` map,
 *    one `st-agg-row[data-currency]` per currency (switch, `RuleBuilder` `st-agg-rule`, remove). Save `st-agg-save` sends **one**
 *    `PATCH /workspaces/:id/ad-group-guard` with every changed / added currency and `null` for the removed ones;
 *    the 200 body (the workspace view) replaces the row and re-seeds the draft. A workspace the caller does not own
 *    (Admin, `ownerAdminId !== me`, A9) is read-only: every control is disabled and `st-agg-readonly` says why.
 *  - 400 issues are mapped back to their row: FEAT-087 `THB.rule.items.1.items.0.value` → the builder's
 *    `serverErrors` keyed by the sub-path (`items.1.items.0.value`, shown under that row), `THB.rule` → the
 *    builder's rule-level error, anything else → `st-agg-save-error`; 403/404 → `st-agg-save-error`.
 *  - FEAT-087: a new currency row starts with the default draft (`and`, one `spend ≥ ''`); Save is disabled while a
 *    changed row's rule is invalid (AC-10).
 */
import type { FetchError } from 'ofetch'
import type { ApiErrorBody } from '#shared/types/auth'
import type {
  AdGroupGuardSettings,
  AdGroupGuardSettingsBody,
  WorkspaceAdGroupGuardBody
} from '#shared/types/ad-group-guard'
import type { WorkspaceView, WorkspacesResponse } from '#shared/types/workspaces'
import type { AdGroupGuardDraft, AdGroupGuardDraftErrors } from '~/utils/ad-group-guard'

definePageMeta({ middleware: 'prefixes-access' })

useSeoMeta({ title: 'กฎปิด ad group' })

const LOAD_FALLBACK = 'โหลดข้อมูลไม่สำเร็จ'
const SAVE_FALLBACK = 'บันทึกไม่สำเร็จ'
const READONLY_TEXT = 'แก้ได้เฉพาะเจ้าของ workspace'
const CODE_MESSAGE = 'รหัสสกุลเงินต้องเป็นตัวพิมพ์ใหญ่ 3 ตัว'

const api = useApi()
const toast = useToast()
const { admin } = useAuth()

const isGod = computed(() => admin.value?.roles?.includes('GOD') === true)

function apiMessage(e: unknown, fallback: string): string {
  const err = e as FetchError<Partial<ApiErrorBody>>
  return err.data?.error ?? err.message ?? fallback
}

// ── master switch (GOD only) ─────────────────────────────────────────────────────────────────────────────────────────
const master = ref<AdGroupGuardSettings | null>(null)
const masterPending = ref(false)
const masterError = ref<string | null>(null)
const masterDraft = ref(false)
const masterSaving = ref(false)
const masterDirty = computed(() => master.value !== null && masterDraft.value !== master.value.enabled)

async function loadMaster() {
  if (!isGod.value) return
  masterPending.value = true
  masterError.value = null
  try {
    const res = await api<AdGroupGuardSettings>('/settings/ad-group-guard', { retry: 0 })
    master.value = res
    masterDraft.value = res.enabled
  } catch (e) {
    master.value = null
    masterError.value = apiMessage(e, LOAD_FALLBACK)
  } finally {
    masterPending.value = false
  }
}

async function saveMaster() {
  if (masterSaving.value || !masterDirty.value) return
  masterSaving.value = true
  masterError.value = null
  try {
    const body: AdGroupGuardSettingsBody = { enabled: masterDraft.value }
    const res = await api<AdGroupGuardSettings>('/settings/ad-group-guard', { method: 'PATCH', body, retry: 0 })
    master.value = res
    masterDraft.value = res.enabled
    toast.add({ title: res.enabled ? 'เปิดกฎปิด ad group ทั้งระบบแล้ว' : 'ปิดกฎปิด ad group ทั้งระบบแล้ว', icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues?.map(i => i.message).filter(Boolean) ?? []
    masterError.value = issues.length ? issues.join(' · ') : apiMessage(e, SAVE_FALLBACK)
    toast.add({ title: SAVE_FALLBACK, description: masterError.value, color: 'error' })
  } finally {
    masterSaving.value = false
  }
}

// ── workspaces ───────────────────────────────────────────────────────────────────────────────────────────────────────
const workspaces = ref<WorkspaceView[]>([])
const wsPending = ref(true)
const wsError = ref<string | null>(null)
const workspaceId = ref<string | undefined>(undefined)

const workspace = computed(() => workspaces.value.find(w => w.id === workspaceId.value) ?? null)
const readonly = computed(() => !isGod.value && !!workspace.value && workspace.value.ownerAdminId !== admin.value?.id)

const workspaceItems = computed(() => workspaces.value.map(w => ({
  label: w.ownerAdminId === admin.value?.id ? `${w.name} (ของฉัน)` : w.name,
  value: w.id
})))

let wsSession = 0

async function loadWorkspaces() {
  const s = ++wsSession
  wsPending.value = true
  wsError.value = null
  try {
    const res = await api<WorkspacesResponse>('/workspaces', { retry: 0 })
    if (s !== wsSession) return
    workspaces.value = res.workspaces ?? []
    if (!workspaces.value.some(w => w.id === workspaceId.value)) {
      // an Admin lands on a workspace they own; a GOD on the first one
      const own = workspaces.value.find(w => w.ownerAdminId === admin.value?.id)
      workspaceId.value = (own ?? workspaces.value[0])?.id
    }
    seedRows()
  } catch (e) {
    if (s !== wsSession) return
    workspaces.value = []
    wsError.value = apiMessage(e, LOAD_FALLBACK)
    toast.add({ title: LOAD_FALLBACK, description: wsError.value, color: 'error' })
  } finally {
    if (s === wsSession) wsPending.value = false
  }
}

// ── rows (the draft of the selected workspace) ───────────────────────────────────────────────────────────────────────
interface RowDraft {
  currency: string
  enabled: boolean
  draft: AdGroupGuardDraft
  /** added in this session, not saved yet */
  isNew: boolean
  serverErrors: AdGroupGuardDraftErrors
}

const rows = ref<RowDraft[]>([])
/** saved currencies the user removed (sent as `null`) */
const removed = ref<string[]>([])
const showErrors = ref(false)
const saving = ref(false)
const saveError = ref<string | null>(null)

function savedMap() {
  return workspace.value?.adGroupGuard ?? {}
}

function seedRows() {
  const map = savedMap()
  rows.value = Object.keys(map).sort().map((currency) => {
    const entry = map[currency]!
    return { currency, enabled: entry.enabled, draft: adGroupGuardDraftOf(entry.rule), isNew: false, serverErrors: {} }
  })
  removed.value = []
  showErrors.value = false
  saveError.value = null
}

watch(workspaceId, () => seedRows())

function rowChanged(row: RowDraft): boolean {
  if (row.isNew) return true
  const saved = savedMap()[row.currency]
  if (!saved) return true
  if (row.enabled !== saved.enabled) return true
  const parsed = parseAdGroupGuardDraft(row.draft)
  return !parsed.rule || !sameAdGroupGuardRule(parsed.rule, saved.rule)
}

const dirty = computed(() => removed.value.length > 0 || rows.value.some(rowChanged))
const invalid = computed(() => rows.value.some(row => rowChanged(row) && parseAdGroupGuardDraft(row.draft).rule === null))

function removeRow(row: RowDraft) {
  rows.value = rows.value.filter(r => r !== row)
  if (!row.isNew && savedMap()[row.currency]) removed.value = [...removed.value, row.currency]
}

// ── add currency ─────────────────────────────────────────────────────────────────────────────────────────────────────
const addOpen = ref(false)
const addCode = ref('')
const addCodeError = ref<string | null>(null)
const PRESET_CURRENCIES = ['THB', 'USD']

function hasCurrency(code: string) {
  return rows.value.some(r => r.currency === code)
}

function addCurrency(code: string) {
  const currency = code.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) {
    addCodeError.value = CODE_MESSAGE
    return
  }
  if (hasCurrency(currency)) {
    addCodeError.value = `มี ${currency} อยู่แล้ว`
    return
  }
  rows.value = [...rows.value, { currency, enabled: true, draft: emptyAdGroupGuardDraft(), isNew: true, serverErrors: {} }]
  // re-adding a currency removed in this session is a plain upsert again
  removed.value = removed.value.filter(c => c !== currency)
  addOpen.value = false
  addCode.value = ''
  addCodeError.value = null
}

watch(addOpen, (open) => {
  if (!open) {
    addCode.value = ''
    addCodeError.value = null
  }
})

// ── save ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
function applyIssues(issues: NonNullable<ApiErrorBody['issues']>): string[] {
  const rest: string[] = []
  for (const issue of issues) {
    const path = String(issue.path ?? '')
    const [currency, first] = path.split('.')
    const row = rows.value.find(r => r.currency === currency)
    if (!row) {
      rest.push(path ? `${path}: ${issue.message}` : issue.message)
      continue
    }
    if (first === 'rule' || first === undefined) {
      // FEAT-087 — `THB.rule.items.1.items.0.value` → `items.1.items.0.value`; `THB.rule` / `THB` → the rule itself
      const sub = first === 'rule' ? path.slice(`${currency}.rule`.length).replace(/^\./, '') : ''
      row.serverErrors = { ...row.serverErrors, [sub]: issue.message }
    } else {
      rest.push(`${currency}: ${issue.message}`)
    }
  }
  return rest
}

async function save() {
  const ws = workspace.value
  if (!ws || saving.value || readonly.value || !dirty.value) return
  for (const row of rows.value) row.serverErrors = {}
  if (invalid.value) {
    // client error → no request
    showErrors.value = true
    return
  }
  const body: WorkspaceAdGroupGuardBody = {}
  for (const row of rows.value) {
    if (!rowChanged(row)) continue
    const parsed = parseAdGroupGuardDraft(row.draft)
    if (parsed.rule) body[row.currency] = { enabled: row.enabled, rule: parsed.rule }
  }
  for (const currency of removed.value) body[currency] = null

  saving.value = true
  saveError.value = null
  try {
    const res = await api<WorkspaceView>(`/workspaces/${encodeURIComponent(ws.id)}/ad-group-guard`, { method: 'PATCH', body, retry: 0 })
    workspaces.value = workspaces.value.map(w => (w.id === res.id ? { ...w, ...res } : w))
    seedRows()
    toast.add({ title: 'บันทึกกฎปิด ad group แล้ว', description: ws.name, icon: 'i-lucide-check', color: 'success' })
  } catch (e) {
    const err = e as FetchError<Partial<ApiErrorBody>>
    const issues = err.data?.issues ?? []
    const rest = issues.length ? applyIssues(issues) : []
    saveError.value = issues.length
      ? (rest.length ? rest.join(' · ') : null)
      : apiMessage(e, SAVE_FALLBACK)
    toast.add({ title: SAVE_FALLBACK, description: saveError.value ?? issues.map(i => i.message).join(' · '), color: 'error' })
  } finally {
    saving.value = false
  }
}

const controlsDisabled = computed(() => readonly.value || saving.value)

onMounted(() => {
  void loadWorkspaces()
  void loadMaster()
})
</script>

<template>
  <div class="flex flex-col gap-4" data-testid="st-agg-page">
    <!-- ── master switch (GOD only, A8) ─────────────────────────────────────────────────────────────────── -->
    <UPageCard
      v-if="isGod"
      title="กฎปิด ad group"
      description="กฎตั้งที่ workspace / บัญชี / order — สวิตช์นี้ปิดได้ทั้งระบบ"
      variant="subtle"
      data-testid="st-agg-master"
      :data-enabled="master?.enabled ? 'true' : 'false'"
    >
      <div v-if="masterPending && !master" class="flex flex-col gap-2" data-testid="st-agg-master-loading">
        <USkeleton class="h-6 w-40" />
      </div>
      <UAlert
        v-else-if="!master"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="โหลดสวิตช์ไม่สำเร็จ"
        :description="masterError ?? LOAD_FALLBACK"
        role="alert"
        data-testid="st-agg-master-error"
      >
        <template #actions>
          <UButton
            label="Retry"
            icon="i-lucide-refresh-cw"
            color="error"
            size="xs"
            :loading="masterPending"
            data-testid="st-agg-master-retry"
            @click="loadMaster()"
          />
        </template>
      </UAlert>
      <div v-else class="flex flex-wrap items-center justify-between gap-3">
        <USwitch
          v-model="masterDraft"
          label="เปิดใช้ทั้งระบบ"
          :disabled="masterSaving"
          data-testid="st-agg-enabled"
        />
        <UButton
          label="Save"
          color="neutral"
          :disabled="!masterDirty"
          :loading="masterSaving"
          data-testid="st-agg-save-master"
          @click="saveMaster()"
        />
        <p v-if="masterError" class="w-full text-sm text-error" role="alert">
          {{ masterError }}
        </p>
        <span class="w-full text-xs text-muted" data-testid="st-agg-master-updated">
          {{ master.updatedAt ? `แก้ไขล่าสุด ${formatDateTime(master.updatedAt)}` : 'ยังไม่เคยตั้งค่า (ปิดอยู่)' }}
        </span>
      </div>
    </UPageCard>
    <p v-else class="px-1 text-xs text-muted" data-testid="st-agg-master-readonly">
      สวิตช์รวมของระบบ (เปิด/ปิดกฎทั้งหมด) ตั้งได้เฉพาะ GOD
    </p>

    <!-- ── workspace rules ─────────────────────────────────────────────────────────────────────────────── -->
    <UPageCard
      title="กฎของ workspace"
      description="แยกตามสกุลเงินของบัญชี · บัญชีและ order ตั้งทับได้"
      variant="subtle"
      data-testid="st-agg-workspace-card"
      :data-state="wsPending && workspaces.length === 0 ? 'loading' : wsError ? 'error' : 'ready'"
      :data-readonly="readonly ? 'true' : 'false'"
    >
      <div v-if="wsPending && workspaces.length === 0" class="flex flex-col gap-3" data-testid="st-agg-loading">
        <USkeleton class="h-9 w-full" />
        <USkeleton class="h-32 w-full" />
      </div>

      <UAlert
        v-else-if="wsError"
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        title="โหลด workspace ไม่สำเร็จ"
        :description="wsError"
        role="alert"
        data-testid="st-agg-load-error"
      >
        <template #actions>
          <UButton
            label="Retry"
            icon="i-lucide-refresh-cw"
            color="error"
            size="xs"
            :loading="wsPending"
            data-testid="st-agg-retry"
            @click="loadWorkspaces()"
          />
        </template>
      </UAlert>

      <p v-else-if="workspaces.length === 0" class="text-sm text-muted" data-testid="st-agg-no-workspace">
        ยังไม่มี workspace ที่เข้าถึงได้
      </p>

      <form v-else class="flex flex-col gap-4" @submit.prevent="save">
        <UFormField label="Workspace" class="min-w-0">
          <USelect
            v-model="workspaceId"
            :items="workspaceItems"
            class="w-full sm:w-80"
            :disabled="saving"
            data-testid="st-agg-workspace"
          />
        </UFormField>

        <UAlert
          v-if="readonly"
          color="neutral"
          variant="subtle"
          icon="i-lucide-lock"
          :description="READONLY_TEXT"
          data-testid="st-agg-readonly"
        />

        <div
          v-if="rows.length === 0"
          class="flex flex-col items-start gap-2 rounded-md border border-dashed border-default p-4"
          data-testid="st-agg-empty"
        >
          <span class="text-sm text-muted">workspace นี้ยังไม่มีกฎ</span>
        </div>

        <div
          v-for="row in rows"
          :key="row.currency"
          class="flex flex-col gap-3 rounded-md border border-default p-3"
          data-testid="st-agg-row"
          :data-currency="row.currency"
          :data-enabled="row.enabled ? 'true' : 'false'"
          :data-new="row.isNew ? 'true' : 'false'"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-3">
              <UBadge color="neutral" variant="outline" class="font-mono">
                {{ row.currency }}
              </UBadge>
              <USwitch
                v-model="row.enabled"
                label="ใช้กฎนี้"
                :disabled="controlsDisabled"
                data-testid="st-agg-row-enabled"
              />
            </div>
            <UButton
              icon="i-lucide-trash-2"
              label="ลบ"
              color="error"
              variant="ghost"
              size="xs"
              :disabled="controlsDisabled"
              data-testid="st-agg-row-remove"
              @click="removeRow(row)"
            />
          </div>
          <AdGroupGuardRuleBuilder
            v-model="row.draft"
            testid="st-agg-rule"
            :currency="row.currency"
            :disabled="controlsDisabled"
            :show-errors="showErrors"
            :server-errors="row.serverErrors"
            @edited="row.serverErrors = {}"
          />
          <p
            v-if="parseAdGroupGuardDraft(row.draft).rule"
            class="text-xs text-muted"
            data-testid="st-agg-row-summary"
          >
            ปิด ad group เมื่อ {{ formatAdGroupGuardRule(parseAdGroupGuardDraft(row.draft).rule!, row.currency) }}
          </p>
        </div>

        <p v-if="removed.length" class="text-xs text-warning" data-testid="st-agg-removed">
          จะลบกฎของ {{ removed.join(', ') }} เมื่อกด Save
        </p>

        <div class="flex flex-wrap items-center gap-2">
          <UPopover v-model:open="addOpen">
            <UButton
              label="เพิ่มสกุลเงิน"
              icon="i-lucide-plus"
              color="neutral"
              variant="outline"
              :disabled="controlsDisabled"
              data-testid="st-agg-add"
            />
            <template #content>
              <div class="flex w-64 flex-col gap-3 p-3" data-testid="st-agg-add-popover">
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-for="code in PRESET_CURRENCIES"
                    :key="code"
                    :label="code"
                    color="neutral"
                    variant="subtle"
                    size="sm"
                    :disabled="hasCurrency(code)"
                    data-testid="st-agg-add-option"
                    :data-currency="code"
                    @click="addCurrency(code)"
                  />
                </div>
                <UFormField label="สกุลอื่น" :error="addCodeError ?? undefined">
                  <div class="flex gap-2">
                    <UInput
                      v-model="addCode"
                      maxlength="3"
                      placeholder="EUR"
                      class="w-24 font-mono uppercase"
                      autocomplete="off"
                      data-testid="st-agg-add-code"
                      @keydown.enter.prevent="addCurrency(addCode)"
                    />
                    <UButton
                      label="เพิ่ม"
                      size="sm"
                      :disabled="addCode.trim().length === 0"
                      data-testid="st-agg-add-code-confirm"
                      @click="addCurrency(addCode)"
                    />
                  </div>
                </UFormField>
              </div>
            </template>
          </UPopover>
          <div class="grow" />
          <UButton
            v-if="dirty && !readonly"
            label="ยกเลิกการแก้"
            color="neutral"
            variant="ghost"
            :disabled="saving"
            data-testid="st-agg-reset"
            @click="seedRows()"
          />
          <UButton
            type="submit"
            label="Save"
            icon="i-lucide-save"
            :disabled="!dirty || readonly || invalid"
            :loading="saving"
            data-testid="st-agg-save"
          />
        </div>

        <p
          v-if="saveError"
          class="text-sm break-words text-error"
          role="alert"
          data-testid="st-agg-save-error"
        >
          {{ saveError }}
        </p>
      </form>
    </UPageCard>
  </div>
</template>
