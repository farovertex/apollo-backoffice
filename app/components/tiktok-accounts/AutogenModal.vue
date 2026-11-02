<script setup lang="ts">
/**
 * FEAT-097 (spec "UI behaviour → Modal", AC-13..15; api-contract.md v1 §2.2 / §6) — the auto-gen form.
 * Opened by the row action `ta-autogen-<accountId>` of /tiktok-accounts, which already fetched
 * `GET …/bc-autogen/suggest` and passes the answer in — this modal issues no GET of its own, so every open is
 * exactly one suggest request made by the page.
 * The admin types the names of 1..10 sub Business Centers and, per sub, optionally a prefix + a count of
 * advertisers to create under it as `<prefix>001`, `<prefix>002`, … Names are **never prefilled** (A2 — the
 * human types them); the currency select is **read-only** when the root BC currency is known (`currencyLocked`).
 * Inline validation (six rules of "UI behaviour") runs while typing and disables สร้าง while any error exists;
 * submit issues exactly one `POST …/bc-autogen` (`retry: 0`): 202 → `created(run)` + the modal closes, 409 →
 * `ta-autogen-error` with the API's Thai text (a `nameTaken` also marks that row's name error), 400 → the issues.
 * A `stopped` run on `suggest.run` warns (`ta-autogen-superseded`) that starting a new one closes it, with a link
 * that opens its panel instead (`open-run`).
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { BcSubCurrency, TikTokAccount } from '#shared/types/tiktok-accounts'
import type {
  BcAutogenConflictBody,
  BcAutogenCreateBody,
  BcAutogenCreateRow,
  BcAutogenRunResponse,
  BcAutogenRunSummary,
  BcAutogenRunView,
  BcAutogenSuggest
} from '#shared/types/bc-autogen'

const props = defineProps<{
  account: TikTokAccount | null
  /** the answer of `GET …/bc-autogen/suggest`, fetched by the page right before it opened this modal */
  suggest: BcAutogenSuggest | null
}>()

const emit = defineEmits<{
  'created': [run: BcAutogenRunView]
  /** the "เปิดดู" link of the superseded warning — open the panel of that stopped run instead of starting a new one */
  'open-run': [run: BcAutogenRunSummary]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-autogen-modal`).
const modalContent = { 'data-testid': 'ta-autogen-modal' } as ModalProps['content']

const api = useApi()
const toast = useToast()

const CURRENCIES: BcSubCurrency[] = ['THB', 'USD']

interface RowForm {
  name: string
  currency: BcSubCurrency
  advOn: boolean
  prefix: string
  count: number
}

const rows = ref<RowForm[]>([])
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)
/** rowIdx → message set by a 409 `nameTaken`; cleared when that row's name is edited */
const serverNameError = ref<Record<number, string>>({})

const currencyLocked = computed(() => props.suggest?.currencyLocked === true)
const suggestCurrency = computed<BcSubCurrency>(() => props.suggest?.currency ?? 'THB')
const used = computed<string[]>(() => props.suggest?.used ?? [])
const blockedText = computed<string | null>(() =>
  props.suggest && !props.suggest.canStart ? bcAutogenReasonText(props.suggest.reason) : null
)
/** a `stopped` run of this account is superseded by a new one — warn before that happens */
const supersededRun = computed<BcAutogenRunSummary | null>(() =>
  props.suggest?.run && props.suggest.run.status === 'stopped' ? props.suggest.run : null
)

const parentText = computed<string>(() => {
  const name = props.suggest?.bcOrgName
  const tail = props.account?.bcOrgId ? ` (…${props.account.bcOrgId.slice(-4)})` : ''
  return `${name || '—'}${tail}`
})

function blankRow(): RowForm {
  return { name: '', currency: suggestCurrency.value, advOn: true, prefix: '', count: BC_AUTOGEN_ADV_DEFAULT }
}

function resetForm() {
  rows.value = Array.from({ length: BC_AUTOGEN_ROWS_DEFAULT }, () => blankRow())
  submitting.value = false
  submitError.value = null
  serverNameError.value = {}
}

watch(open, (isOpen) => {
  if (isOpen) resetForm()
})
watch(() => props.suggest, () => {
  if (open.value) resetForm()
})

// ── count control ────────────────────────────────────────────────────────────────────────────────────────────────
/** add/remove rows at the end so the typed values of kept rows survive (spec AC-14) */
function setRowCount(n: number) {
  const next = Math.max(BC_AUTOGEN_ROWS_MIN, Math.min(BC_AUTOGEN_ROWS_MAX, Math.floor(n || 0)))
  const list = rows.value.slice()
  while (list.length < next) list.push(blankRow())
  if (list.length > next) list.length = next
  rows.value = list
}
function onCountInput(value: string | number) {
  const n = typeof value === 'number' ? value : Number(value)
  if (Number.isFinite(n)) setRowCount(n)
}

// ── validation ───────────────────────────────────────────────────────────────────────────────────────────────────
const allNames = computed(() => rows.value.map(r => r.name))

function nameErrorFor(idx: number): string | undefined {
  return serverNameError.value[idx]
    ?? autogenNameError(rows.value[idx]!.name, idx, allNames.value, used.value)
    ?? undefined
}
function prefixErrorFor(idx: number): string | undefined {
  const row = rows.value[idx]!
  return autogenPrefixError(row.prefix, row.advOn) ?? undefined
}
function countErrorFor(idx: number): string | undefined {
  const row = rows.value[idx]!
  return autogenCountError(row.count, row.advOn) ?? undefined
}

const hasErrors = computed(() =>
  rows.value.some((_, idx) => !!nameErrorFor(idx) || !!prefixErrorFor(idx) || !!countErrorFor(idx))
)

function onNameInput(idx: number) {
  // a fresh keystroke clears the stale 409 mark so the inline rule takes over again
  if (serverNameError.value[idx] !== undefined) {
    serverNameError.value = Object.fromEntries(
      Object.entries(serverNameError.value).filter(([k]) => Number(k) !== idx)
    )
  }
}

// ── copy-down (row 0 → every row) ────────────────────────────────────────────────────────────────────────────────
function copyRow0() {
  const first = rows.value[0]
  if (!first) return
  rows.value = rows.value.map((row, idx) => idx === 0
    ? row
    : { ...row, advOn: first.advOn, prefix: first.prefix, count: first.count })
}

// ── summary / ETA ────────────────────────────────────────────────────────────────────────────────────────────────
const planRows = computed(() => rows.value.map(r => ({ adv: r.advOn ? { count: r.count } : null })))
const rowsCount = computed(() => rows.value.length)
const advTotal = computed(() => countAdvertisers(planRows.value))
const stepTotal = computed(() => countSteps(planRows.value))
const etaText = computed(() => `ประมาณ ${estimateText(stepTotal.value)}`)
const submitLabel = computed(() =>
  `สร้าง ${rowsCount.value} Sub BC${advTotal.value > 0 ? ` + ${advTotal.value} บัญชีโฆษณา` : ''}`
)
const summaryText = computed(() =>
  `รวม ${rowsCount.value} Sub BC · ${advTotal.value} บัญชีโฆษณา · ${stepTotal.value} งาน`
)

const NOTICE
  = 'ระบบทำทีละงานตามลำดับ (1 งานต่อ login): สร้าง Sub BC → Sync → สร้างบัญชีโฆษณาทีละบัญชี → Sync org'
    + ' · ถ้า TikTok แจ้งว่า Sub BC ใดเต็มโควตาบัญชีโฆษณา จะข้ามที่เหลือของ Sub BC นั้นแล้วทำแถวถัดไป'
    + ' · เขตเวลา: กรุงเทพ (UTC+07:00) เปลี่ยนไม่ได้หลังสร้าง'

// ── submit ───────────────────────────────────────────────────────────────────────────────────────────────────────
function buildBody(): BcAutogenCreateBody {
  const out: BcAutogenCreateRow[] = rows.value.map((row) => {
    const entry: BcAutogenCreateRow = { name: normalizeBcSubName(row.name) }
    // the currency select is read-only when locked, so the body omits it (the API uses the root BC currency)
    if (!currencyLocked.value) entry.currency = row.currency
    entry.adv = row.advOn ? { prefix: row.prefix.trim(), count: row.count } : null
    return entry
  })
  return { rows: out }
}

function applyError(e: unknown) {
  const err = e as FetchError<Partial<BcAutogenConflictBody & ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  const reason = err.data?.reason
  const title = err.data?.error ?? err.message ?? 'สร้างอัตโนมัติไม่สำเร็จ'
  const description = issues && issues.length
    ? issues.join(' · ')
    : (reason && reason !== 'nameTaken' ? bcAutogenReasonText(reason) : undefined)
  submitError.value = { title, description: description === title ? undefined : description }
  // a 409 `nameTaken` points at the offending row: show the inline name error there too
  if (reason === 'nameTaken' && typeof err.data?.rowIdx === 'number') {
    serverNameError.value = { ...serverNameError.value, [err.data.rowIdx]: BC_AUTOGEN_VALIDATION.nameUsed }
  }
  toast.add({ title, description, color: 'error' })
}

async function onSubmit() {
  const account = props.account
  if (!account || submitting.value || blockedText.value || hasErrors.value) return
  submitting.value = true
  submitError.value = null
  try {
    // retry: 0 — exactly one POST per click (ofetch would otherwise re-issue it on 5xx and start two runs)
    const res = await api<BcAutogenRunResponse>(
      `/tiktok-accounts/${encodeURIComponent(account.id)}/bc-autogen`,
      { method: 'POST', retry: 0, body: buildBody() }
    )
    open.value = false
    emit('created', res.run)
  } catch (e) {
    applyError(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="สร้าง Sub BC และบัญชีโฆษณาอัตโนมัติ"
    description="สร้างศูนย์ธุรกิจย่อยหลายอันและบัญชีโฆษณาใต้แต่ละอันแบบอัตโนมัติ ทีละงานตามลำดับ"
    :dismissible="!submitting"
    :ui="{ content: 'max-w-2xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-muted">
          ภายใต้:
          <span class="font-medium text-highlighted" data-testid="ta-autogen-parent">{{ parentText }}</span>
        </p>

        <UAlert
          v-if="blockedText"
          color="warning"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          title="สร้างไม่ได้ตอนนี้"
          :description="blockedText"
          role="alert"
          data-testid="ta-autogen-blocked"
        />

        <UAlert
          v-if="supersededRun"
          color="warning"
          variant="subtle"
          icon="i-lucide-history"
          data-testid="ta-autogen-superseded"
          :title="`มีงานสร้างอัตโนมัติที่หยุดค้างอยู่ (เหลือ ${supersededRun.counts.pending} ขั้น) — เริ่มใหม่จะปิดงานนั้น`"
        >
          <template #actions>
            <UButton
              label="เปิดดู"
              color="warning"
              variant="soft"
              size="xs"
              data-testid="ta-autogen-superseded-open"
              @click="emit('open-run', supersededRun!)"
            />
          </template>
        </UAlert>

        <!-- count control -->
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-highlighted">จำนวน Sub BC</span>
          <UButton
            icon="i-lucide-minus"
            color="neutral"
            variant="outline"
            size="xs"
            aria-label="ลดจำนวน Sub BC"
            :disabled="!!blockedText || rowsCount <= 1"
            data-testid="ta-autogen-dec"
            @click="setRowCount(rowsCount - 1)"
          />
          <UInput
            :model-value="String(rowsCount)"
            type="number"
            :min="1"
            :max="10"
            class="w-16"
            :disabled="!!blockedText"
            aria-label="จำนวน Sub BC"
            data-testid="ta-autogen-count"
            :data-count="rowsCount"
            @update:model-value="onCountInput"
          />
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="outline"
            size="xs"
            aria-label="เพิ่มจำนวน Sub BC"
            :disabled="!!blockedText || rowsCount >= 10"
            data-testid="ta-autogen-inc"
            @click="setRowCount(rowsCount + 1)"
          />
        </div>

        <!-- row cards -->
        <div class="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
          <div
            v-for="(row, i) in rows"
            :key="i"
            class="rounded-lg border border-default p-3"
            :data-testid="`ta-autogen-row-${i}`"
          >
            <div class="mb-1 flex items-center justify-between">
              <span class="text-xs font-medium text-dimmed">Sub BC {{ i + 1 }}</span>
              <UButton
                v-if="i === 0"
                label="ใช้ค่า prefix/จำนวน นี้กับทุกแถว"
                icon="i-lucide-copy"
                color="neutral"
                variant="ghost"
                size="xs"
                :disabled="!!blockedText"
                data-testid="ta-autogen-copy"
                @click="copyRow0"
              />
            </div>

            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UFormField
                label="ชื่อ Sub BC"
                :name="`name-${i}`"
                required
                :error="nameErrorFor(i)"
              >
                <UInput
                  v-model="row.name"
                  autocomplete="off"
                  placeholder="ชื่อศูนย์ธุรกิจย่อย"
                  class="w-full"
                  :disabled="!!blockedText"
                  :data-testid="`ta-autogen-name-${i}`"
                  @update:model-value="onNameInput(i)"
                />
                <template #error="{ error }">
                  <span :data-testid="`ta-autogen-name-error-${i}`">{{ error }}</span>
                </template>
              </UFormField>

              <UFormField label="สกุลเงิน" :name="`currency-${i}`" required>
                <USelect
                  v-model="row.currency"
                  :items="CURRENCIES"
                  class="w-full"
                  :disabled="!!blockedText || currencyLocked"
                  aria-label="สกุลเงิน"
                  :data-testid="`ta-autogen-currency-${i}`"
                  :data-currency="row.currency"
                  :data-locked="String(currencyLocked)"
                />
                <template v-if="currencyLocked" #help>
                  <span>ตาม BC หลัก</span>
                </template>
              </UFormField>
            </div>

            <div class="mt-3">
              <UCheckbox
                v-model="row.advOn"
                label="สร้างบัญชีโฆษณาใต้ Sub BC นี้ด้วย"
                :disabled="!!blockedText"
                :data-testid="`ta-autogen-adv-${i}`"
              />
            </div>

            <div v-if="row.advOn" class="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <UFormField
                label="Prefix"
                :name="`prefix-${i}`"
                required
                :error="prefixErrorFor(i)"
              >
                <UInput
                  v-model="row.prefix"
                  autocomplete="off"
                  placeholder="เช่น SLD-A"
                  class="w-full"
                  :disabled="!!blockedText"
                  :data-testid="`ta-autogen-prefix-${i}`"
                />
                <template #error="{ error }">
                  <span :data-testid="`ta-autogen-prefix-error-${i}`">{{ error }}</span>
                </template>
              </UFormField>

              <UFormField
                label="จำนวนบัญชีโฆษณา"
                :name="`advcount-${i}`"
                required
                :error="countErrorFor(i)"
              >
                <UInputNumber
                  v-model="row.count"
                  :min="1"
                  :max="50"
                  class="w-full"
                  :disabled="!!blockedText"
                  :data-testid="`ta-autogen-advcount-${i}`"
                />
                <template #error="{ error }">
                  <span :data-testid="`ta-autogen-advcount-error-${i}`">{{ error }}</span>
                </template>
              </UFormField>

              <p
                class="col-span-full break-words text-xs text-muted"
                :data-testid="`ta-autogen-preview-${i}`"
              >
                {{ previewText(row.prefix.trim(), row.count) }}
              </p>
            </div>
          </div>
        </div>

        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-info"
          :description="NOTICE"
          data-testid="ta-autogen-notice"
        />

        <div class="flex flex-wrap items-center justify-between gap-2 border-t border-default pt-3">
          <div class="text-sm">
            <p
              class="font-medium text-highlighted"
              data-testid="ta-autogen-summary"
              :data-rows="rowsCount"
              :data-adv="advTotal"
              :data-steps="stepTotal"
            >
              {{ summaryText }}
            </p>
            <p class="text-xs text-muted" data-testid="ta-autogen-eta">
              {{ etaText }}
            </p>
          </div>
        </div>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="ta-autogen-error"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            label="ยกเลิก"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-autogen-cancel"
            @click="open = false"
          />
          <UButton
            :label="submitLabel"
            icon="i-lucide-sparkles"
            color="primary"
            variant="solid"
            :disabled="!!blockedText || hasErrors"
            :loading="submitting"
            data-testid="ta-autogen-submit"
            @click="onSubmit"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
