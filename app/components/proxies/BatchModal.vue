<script setup lang="ts">
/**
 * FEAT-027 §10/§11 — Batch upload proxies (`px-batch-*`, spec.md "UI behaviour", api-contract.md v1 §10/§11).
 * Mirrors `TiktokAccountsBatchModal` (FEAT-023): the file is parsed in the browser (`parseProxyBatchCsv`) and
 * POSTed once as JSON to `POST /backend/proxies/batch`; the API stays the source of truth for `skip` (duplicate)
 * and `fail` (unparsable / bad type / bad port / bad country) per row.
 *
 * Refused here, before any request: an empty file, a header missing `proxy` or carrying an unknown/duplicate
 * column, more than 1000 rows, and rows whose cell count does not match the header. Those messages name line
 * numbers only — the password part of a `proxy` value never reaches a message or the result table (only
 * `hostPort`, which the API echoes back).
 */
import type { FetchError } from 'ofetch'
import type { ModalProps } from '@nuxt/ui'
import type { ApiErrorBody } from '#shared/types/auth'
import type { BatchProxiesBody, BatchProxiesResponse, BatchProxyRow, BatchProxyRowResult } from '#shared/types/proxies'
import type { ParsedProxyRow } from '~/utils/proxy-batch-csv'

const emit = defineEmits<{
  imported: [result: BatchProxiesResponse]
}>()

const open = defineModel<boolean>('open', { default: false })
// UModal's root is renderless, so a `data-testid` on the component lands nowhere; `content` is v-bound onto the
// rendered DialogContent element (the dialog QA locates as `px-batch-modal`).
const modalContent = { 'data-testid': 'px-batch-modal' } as ModalProps['content']

/** a CSV of 1000 rows is a few hundred kB; anything bigger is not what this modal takes */
const MAX_FILE_BYTES = 1_000_000

const api = useApi()
const toast = useToast()

const fileName = ref<string | null>(null)
const rows = ref<ParsedProxyRow[]>([])
const parseError = ref<{ title: string, description?: string } | null>(null)
const submitting = ref(false)
const submitError = ref<{ title: string, description?: string } | null>(null)
const result = ref<BatchProxiesResponse | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

const canSubmit = computed(() => rows.value.length > 0 && !parseError.value && !submitting.value)

function resetFile() {
  fileName.value = null
  rows.value = []
  parseError.value = null
  submitError.value = null
  result.value = null
  if (fileInput.value) fileInput.value.value = ''
}

watch(open, () => resetFile())

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  resetFile()
  if (!file) return
  fileName.value = file.name
  if (file.size === 0) {
    parseError.value = { title: 'The file is empty.', description: `Header: proxy,label,country (label/country optional).` }
    return
  }
  if (file.size > MAX_FILE_BYTES) {
    parseError.value = { title: 'The file is too large.', description: `A CSV of at most ${PROXY_BATCH_MAX_ROWS} rows is well under 1 MB.` }
    return
  }
  let text: string
  try {
    text = await file.text()
  } catch {
    parseError.value = { title: 'The file could not be read.', description: 'Pick it again, or export it as UTF-8 CSV.' }
    return
  }
  const parsed = parseProxyBatchCsv(text)
  if (!parsed.ok) {
    parseError.value = { title: parsed.error, description: parsed.detail }
    return
  }
  rows.value = parsed.rows
}

function batchErrorState(e: unknown): { title: string, description?: string } {
  const err = e as FetchError<Partial<ApiErrorBody>>
  const issues = err.data?.issues?.map(i => i.message).filter(Boolean)
  return {
    title: err.data?.error ?? err.message ?? 'Could not import the file',
    description: issues && issues.length ? issues.join(' · ') : undefined
  }
}

function toBody(row: ParsedProxyRow): BatchProxyRow {
  const body: BatchProxyRow = { line: row.line, proxy: row.proxy }
  if (row.label) body.label = row.label
  if (row.country) body.country = row.country
  return body
}

async function onSubmit() {
  if (!canSubmit.value) return
  submitting.value = true
  submitError.value = null
  result.value = null
  const body: BatchProxiesBody = { rows: rows.value.map(toBody) }
  try {
    // retry: 0 — exactly one POST (a retry would create duplicate proxies for every `ok` row)
    const res = await api<BatchProxiesResponse>('/proxies/batch', { method: 'POST', body, retry: 0 })
    result.value = res
    toast.add({
      title: `Imported ${res.ok} of ${res.rows.length} proxies`,
      description: `${res.skip} skipped · ${res.fail} failed`,
      color: res.fail > 0 ? 'warning' : 'success'
    })
    emit('imported', res)
  } catch (e) {
    submitError.value = batchErrorState(e)
  } finally {
    submitting.value = false
  }
}

// ── result presentation ──────────────────────────────────────────────────────────────────────────────────────────────
const STATUS_BADGE: Record<BatchProxyRowResult['status'], { label: string, color: 'success' | 'neutral' | 'error' }> = {
  ok: { label: 'Created', color: 'success' },
  skip: { label: 'Skipped', color: 'neutral' },
  fail: { label: 'Failed', color: 'error' }
}

function reasonText(row: BatchProxyRowResult): string {
  if (row.status === 'ok') return 'Proxy created'
  if (row.error === 'duplicate') return 'Same label or host:port already exists in the file or in the workspace'
  return row.error ?? 'No reason given'
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Batch upload proxies"
    description="Import a CSV of proxies. One proxy is created per ok row."
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
              :href="PROXY_BATCH_CSV_TEMPLATE_URL"
              :download="PROXY_BATCH_CSV_TEMPLATE_FILENAME"
              class="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              data-testid="px-batch-template"
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
            data-testid="px-batch-file"
            @change="onFile"
          >
          <template #help>
            Header <span class="font-mono">proxy</span> (mandatory), <span class="font-mono">label</span>,
            <span class="font-mono">country</span> (optional, any order), UTF-8, at most {{ PROXY_BATCH_MAX_ROWS }} rows.
            Proxy format <span class="font-mono">type://[user[:pass]@]host:port</span> (http / https / socks5).
          </template>
        </UFormField>

        <p
          v-if="rows.length && !parseError"
          class="text-sm text-muted"
          data-testid="px-batch-parsed"
          :data-rows="rows.length"
        >
          <UIcon name="i-lucide-check" class="size-4 align-text-bottom text-success" />
          {{ rows.length }} {{ rows.length === 1 ? 'row' : 'rows' }} read from
          <span class="font-medium text-highlighted">{{ fileName }}</span>
        </p>

        <UAlert
          v-if="parseError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="parseError.title"
          :description="parseError.description"
          role="alert"
          data-testid="px-batch-error"
        />

        <UAlert
          v-if="submitError"
          color="error"
          variant="subtle"
          icon="i-lucide-triangle-alert"
          :title="submitError.title"
          :description="submitError.description"
          role="alert"
          data-testid="px-batch-submit-error"
        />

        <!-- result: label/hostPort + status + reason only, never a password -->
        <div
          v-if="result"
          class="space-y-2"
          data-testid="px-batch-result"
          :data-ok="result.ok"
          :data-skip="result.skip"
          :data-fail="result.fail"
        >
          <p class="text-sm font-medium text-highlighted" data-testid="px-batch-summary">
            ok {{ result.ok }} · skip {{ result.skip }} · fail {{ result.fail }}
          </p>

          <div class="max-h-64 overflow-y-auto rounded-lg border border-default">
            <table class="w-full text-left text-sm">
              <thead class="sticky top-0 bg-elevated/80 backdrop-blur">
                <tr>
                  <th class="px-3 py-2 font-medium">
                    Line
                  </th>
                  <th class="px-3 py-2 font-medium">
                    Label / host:port
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
                  v-for="row in result.rows"
                  :key="row.line"
                  class="border-t border-default align-top"
                  data-testid="px-batch-row"
                  :data-status="row.status"
                  :data-line="row.line"
                >
                  <td class="px-3 py-1.5">
                    {{ row.line }}
                  </td>
                  <!-- `hostPort` only — the API never echoes the password -->
                  <td class="px-3 py-1.5 font-mono text-xs break-all">
                    {{ row.label ?? '—' }}<span v-if="row.hostPort"> · {{ row.hostPort }}</span>
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
            data-testid="px-batch-cancel"
            @click="open = false"
          />
          <UButton
            v-if="result"
            label="Upload another file"
            icon="i-lucide-rotate-ccw"
            color="neutral"
            variant="outline"
            data-testid="px-batch-again"
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
            data-testid="px-batch-submit"
            @click="onSubmit()"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
