<script setup lang="ts">
/**
 * FEAT-023 — Batch upload modal (`ta-batch-*`, spec.md "UI behaviour", api-contract.md v1 §5).
 * The file is parsed in the browser (assumption A1) and POSTed as JSON to `POST /backend/tiktok-accounts/batch`;
 * the API stays the source of truth for `skip` (duplicate) and `fail` (profile create / bind) per row.
 *
 * Refused here, before any request: an empty file, a header that is neither `email,email_password,tiktok_password`
 * nor `email,email_password,tiktok_password,proxy` (FEAT-028 §7), more than 1000 rows, and structurally broken rows
 * (a row that does not have one cell per header column). Those messages name line numbers only — never a cell
 * value, because a headerless file's first line is a pair of passwords.
 *
 * FEAT-028 — the optional 4th column decides the proxy per row: an empty cell = auto-select a free proxy, a
 * `type://[user:pass@]host:port` URL = create-or-reuse that one, no column at all = the caller's Default settings
 * mode. The BO never validates the URL (the API answers with a row `fail` and its text). When the free-proxy pool
 * runs dry the API stops: the triggering row is `fail`, every later row comes back `stopped` and is shown with the
 * "Stopped" badge + the `ta-batch-stopped` summary badge, and re-uploading the same file finishes the rest.
 *
 * FEAT-036 §7 — the optional 5th column `recovery_email` (needs the `proxy` column too, AS-3) sets the per-row
 * recovery email: an empty cell sends no key (→ `null` on the account), a non-empty one is checked here (trim +
 * lowercase + email shape) before any request — a malformed value never reaches the API. `ta-batch-parsed` always
 * carries `data-recovery` = rows that will carry a recovery email; the ` · <n> with a recovery email` suffix shows
 * only when the file used the 5-column header.
 *
 * The result table shows the email + status + reason of every row and **no password**. `pendingFirstLogin` applies
 * to the whole file and never enqueues a login here (AC-5); the scheduler picks the marked accounts up.
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { BatchAccountRow, BatchAccountsBody, BatchAccountsResponse, BatchRowResult } from '#shared/types/tiktok-accounts'

const emit = defineEmits<{
  imported: [result: BatchAccountsResponse]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `ta-batch-modal`).
const modalContent = { 'data-testid': 'ta-batch-modal' } as ModalProps['content']

/** a CSV of 1000 rows is a few hundred kB; anything bigger is not what this modal takes */
const MAX_FILE_BYTES = 1_000_000

const api = useApi()
const toast = useToast()

const pendingFirstLogin = ref(true)
const fileName = ref<string | null>(null)
const rows = ref<BatchAccountRow[]>([])
// FEAT-036 §7 — true only when the parsed file used the 5-column header (drives the ` · <n> with a recovery
// email` suffix even when every cell of column 5 was empty)
const withRecovery = ref(false)
const parseError = ref<{ title: string, description?: string } | null>(null)
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)
const result = ref<BatchAccountsResponse | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const canSubmit = computed(() => rows.value.length > 0 && !parseError.value && !submitting.value)
const recoveryCount = computed(() => rows.value.filter(r => r.recoveryEmail).length)

function resetFile() {
  fileName.value = null
  rows.value = []
  withRecovery.value = false
  parseError.value = null
  submitError.value = null
  result.value = null
  if (fileInput.value) fileInput.value.value = ''
}

function reset() {
  resetFile()
  pendingFirstLogin.value = true
  submitting.value = false
}

watch(open, () => reset())

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  resetFile()
  if (!file) return
  fileName.value = file.name
  if (file.size === 0) {
    parseError.value = { title: 'The file is empty.', description: 'Download the template and fill one row per account.' }
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    parseError.value = { title: 'The file is too large.', description: `A CSV of at most ${BATCH_CSV_MAX_ROWS} rows is well under 1 MB.` }
    return
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    parseError.value = { title: 'The file could not be read.', description: 'Pick it again, or export it as UTF-8 CSV.' }
    return
  }
  const parsed = parseBatchCsv(text)
  if (!parsed.ok) {
    parseError.value = { title: parsed.error, description: parsed.detail }
    return
  }
  rows.value = parsed.rows
  withRecovery.value = parsed.withRecovery
}

function batchErrorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  return {
    title: err.data?.error ?? err.message ?? 'Could not import the file',
    description: issues && issues.length ? issues.join(' · ') : undefined
  }
}

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = null
  result.value = null
  const body: BatchAccountsBody = { pendingFirstLogin: pendingFirstLogin.value, rows: rows.value }
  try {
    // retry: 0 — exactly one POST (a retry would create a second AdsPower profile per row)
    const res = await api<BatchAccountsResponse>('/tiktok-accounts/batch', { method: 'POST', body, retry: 0 })
    result.value = res
    toast.add({
      title: `Imported ${res.ok} of ${res.rows.length} accounts`,
      description: `${res.skip} skipped · ${res.fail} failed · ${res.stopped} stopped`,
      color: res.fail > 0 || res.stopped > 0 ? 'warning' : 'success'
    })
    emit('imported', res)
  } catch (e) {
    submitError.value = batchErrorState(e)
  } finally {
    submitting.value = false
  }
}

// ── result presentation ──────────────────────────────────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<BatchRowResult['status'], { label: string, color: 'success' | 'neutral' | 'warning' | 'error' }> = {
  ok: { label: 'Created', color: 'success' },
  skip: { label: 'Skipped', color: 'neutral' },
  fail: { label: 'Failed', color: 'error' },
  // FEAT-028 §6 — the row was never processed: the free-proxy pool ran dry earlier in the file
  stopped: { label: 'Stopped', color: 'warning' }
}

/**
 * the only `error` code the contract names is `duplicate`; a `stopped` row gets the explanation of what to do
 * next (FEAT-028), anything else is already a human sentence from the API (`proxy in use`,
 * `no proxy available (tried N)`, a proxy-URL parse message…) and is shown as-is
 */
function reasonText(row: BatchRowResult): string {
  if (row.status === 'ok') return 'Account and browser profile created'
  if (row.status === 'stopped') return 'Stopped — no free proxy left; upload the file again to continue'
  if (row.error === 'duplicate') return 'This email already exists in the file or in the workspace'
  return row.error ?? 'No reason given'
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Batch upload TikTok accounts"
    description="Import a CSV of test accounts. One AdsPower profile is created per row."
    :dismissible="!submitting"
    :ui="{ content: 'max-w-2xl' }"
    :content="modalContent"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField label="CSV file" name="file" required>
          <template #hint>
            <!-- plain <a download>: the template is a static file in `public/`, so no component has to forward `download` -->
            <a
              :href="BATCH_CSV_TEMPLATE_URL"
              :download="BATCH_CSV_TEMPLATE_FILENAME"
              class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              data-testid="ta-batch-template"
            >
              <UIcon name="i-lucide-download" class="size-3.5" />
              Download template
            </a>
          </template>
          <!-- a plain input (not UFileUpload): QA sets the file on this exact element, and a dropzone adds nothing here -->
          <input
            ref="fileInput"
            type="file"
            accept=".csv,text/csv"
            :disabled="submitting"
            class="w-full cursor-pointer rounded-md border border-default bg-default p-1.5 text-sm text-default
              file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-elevated file:px-2 file:py-1
              file:text-sm file:font-medium file:text-default"
            data-testid="ta-batch-file"
            @change="onFile"
          >
          <!-- `break-all` on every mono run: at 390 px the 4/5-column header is wider than the modal body and
               would be clipped at the right edge. `data-testid` on this wrapper (not on UFormField's own help
               slot element, which carries none) so QA can assert on the exact text. -->
          <template #help>
            <span data-testid="ta-batch-help">
              Header <span class="font-mono break-all">{{ BATCH_CSV_HEADERS[0] }}</span>, UTF-8, at most
              {{ BATCH_CSV_MAX_ROWS }} rows. Put a password in double quotes if it contains a comma.
              The optional 4th column <span class="font-mono">proxy</span>
              (<span class="font-mono break-all">{{ BATCH_CSV_HEADERS[1] }}</span>) takes
              <span class="font-mono break-all">type://user:pass@host:port</span> per row — leave a cell empty to
              auto-select a free proxy, or omit the column to use your Default settings. The optional 5th column
              <span class="font-mono">recovery_email</span>
              (<span class="font-mono break-all">{{ BATCH_CSV_HEADERS[2] }}</span>) sets the temp-mail address
              Microsoft sends its identity-check code to — leave a cell empty for none.
            </span>
          </template>
        </UFormField>

        <p
          v-if="rows.length && !parseError"
          class="text-sm text-muted"
          data-testid="ta-batch-parsed"
          :data-rows="rows.length"
          :data-recovery="recoveryCount"
        >
          <UIcon name="i-lucide-check" class="size-4 align-text-bottom text-success" />
          {{ rows.length }} {{ rows.length === 1 ? 'row' : 'rows' }} read from
          <span class="font-medium text-highlighted">{{ fileName }}</span>
          <template v-if="withRecovery">
            · {{ recoveryCount }} with a recovery email
          </template>
        </p>

        <UAlert
          v-if="parseError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="parseError.title"
          :description="parseError.description"
          role="alert"
          data-testid="ta-batch-file-error"
        />

        <UCheckbox
          v-model="pendingFirstLogin"
          label="Auto first login"
          :disabled="submitting"
          data-testid="ta-batch-pending"
        >
          <template #description>
            <span data-testid="ta-batch-pending-helper">{{ AUTO_FIRST_LOGIN_HELP }}</span>
          </template>
        </UCheckbox>

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="ta-batch-error"
        />

        <!-- result: email + status + reason only, never a password -->
        <div
          v-if="result"
          class="space-y-2"
          data-testid="ta-batch-result"
          :data-ok="result.ok"
          :data-skip="result.skip"
          :data-fail="result.fail"
          :data-stopped="result.stopped"
        >
          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge color="success" variant="subtle" data-testid="ta-batch-ok">
              {{ result.ok }} created
            </UBadge>
            <UBadge color="neutral" variant="subtle" data-testid="ta-batch-skip">
              {{ result.skip }} skipped
            </UBadge>
            <UBadge :color="result.fail ? 'error' : 'neutral'" variant="subtle" data-testid="ta-batch-fail">
              {{ result.fail }} failed
            </UBadge>
            <UBadge :color="result.stopped ? 'warning' : 'neutral'" variant="subtle" data-testid="ta-batch-stopped">
              {{ result.stopped }} stopped
            </UBadge>
          </div>

          <div class="max-h-64 overflow-y-auto rounded-lg border border-default">
            <table class="w-full text-left text-sm">
              <thead class="sticky top-0 bg-elevated/80 backdrop-blur">
                <tr>
                  <th class="px-3 py-2 font-medium">
                    Email
                  </th>
                  <th class="px-3 py-2 font-medium">
                    Status
                  </th>
                  <th class="px-3 py-2 font-medium">
                    Reason
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(row, index) in result.rows"
                  :key="`${row.loginEmail}-${index}`"
                  class="border-t border-default align-top"
                  data-testid="ta-batch-row"
                  :data-status="row.status"
                  :data-email="row.loginEmail"
                >
                  <td class="px-3 py-1.5 break-all">
                    {{ row.loginEmail }}
                  </td>
                  <td class="px-3 py-1.5">
                    <UBadge
                      :color="STATUS_BADGE[row.status].color"
                      variant="subtle"
                      size="sm"
                      class="whitespace-nowrap"
                    >
                      {{ STATUS_BADGE[row.status].label }}
                    </UBadge>
                  </td>
                  <td class="px-3 py-1.5 text-muted">
                    {{ reasonText(row) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            :label="result ? 'Close' : 'Cancel'"
            color="neutral"
            variant="subtle"
            :disabled="submitting"
            data-testid="ta-batch-cancel"
            @click="open = false"
          />
          <UButton
            v-if="result"
            label="Upload another file"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="outline"
            data-testid="ta-batch-again"
            @click="resetFile()"
          />
          <UButton
            v-else
            label="Upload"
            icon="i-lucide-upload"
            color="primary"
            variant="solid"
            :disabled="!canSubmit"
            :loading="submitting"
            data-testid="ta-batch-submit"
            @click="onSubmit()"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
