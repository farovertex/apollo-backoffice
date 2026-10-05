/**
 * FEAT-027 §10/§11 — client-side CSV parsing for the Proxies batch upload modal (mirrors `batch-csv.ts`, FEAT-023:
 * the BO parses the file in the browser and POSTs JSON; the API stays the source of truth for duplicate/fail per
 * row — `proxy` format validation, country shape, etc. all happen server-side).
 *
 * Rules from spec.md "UI behaviour" + api-contract.md v1 §10/§11:
 * - header line required; column names exact and case-sensitive; `proxy` mandatory, `label`/`country` optional, any
 *   order; an unknown/extra column is a client-side error
 * - empty lines are skipped; 1..1000 data rows (an empty file or a bigger one is refused here, before any request)
 * - `line` echoed per row is the 1-based physical line in the file (header = line 1)
 * - the password part of a `proxy` value is never read out of the file into an error message — only line numbers
 */

export const PROXY_BATCH_PROXY_COLUMN = 'proxy'
export const PROXY_BATCH_OPTIONAL_COLUMNS = ['label', 'country'] as const
export const PROXY_BATCH_COLUMNS = [PROXY_BATCH_PROXY_COLUMN, ...PROXY_BATCH_OPTIONAL_COLUMNS] as const
export const PROXY_BATCH_MAX_ROWS = 1000

export interface ParsedProxyRow {
  /** 1-based line in the file (header is line 1) */
  line: number
  proxy: string
  label?: string
  country?: string
}

export type ProxyBatchCsvResult
  = { ok: true, rows: ParsedProxyRow[] }
    | { ok: false, error: string, detail?: string }

interface CsvRecord {
  cells: string[]
  /** 1-based physical line the record starts on, for "Line 4" messages */
  line: number
}

/** Minimal RFC-4180 reader: `"` quoting with `""` escapes, `,` separator, blank lines dropped. */
function parseRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let inQuotes = false
  let line = 1
  let recordLine = 1

  function endCell() {
    cells.push(quoted ? cell : cell.trim())
    cell = ''
    quoted = false
  }

  function endRecord() {
    endCell()
    if (cells.length > 1 || cells[0] !== '') records.push({ cells, line: recordLine })
    cells = []
    recordLine = line
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
        continue
      }
      if (ch === '\n') line++
      cell += ch
      continue
    }
    if (ch === '"' && cell === '') {
      inQuotes = true
      quoted = true
      continue
    }
    if (ch === ',') {
      endCell()
      continue
    }
    if (ch === '\n') {
      line++
      endRecord()
      continue
    }
    cell += ch
  }
  if (quoted || cell !== '' || cells.length > 0) endRecord()
  return records
}

/** Parse the uploaded text into the `rows` of `POST /proxies/batch`, or into one human error with a line number. */
export function parseProxyBatchCsv(raw: string): ProxyBatchCsvResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) {
    return { ok: false, error: 'The file is empty.', detail: `Header: ${PROXY_BATCH_COLUMNS.join(',')} (label/country optional).` }
  }

  const records = parseRecords(text)
  const header = records[0]
  if (!header) {
    return { ok: false, error: 'The file is empty.' }
  }

  const seen = new Set<string>()
  const unknown: string[] = []
  for (const name of header.cells) {
    if (!(PROXY_BATCH_COLUMNS as readonly string[]).includes(name)) unknown.push(name)
    else if (seen.has(name)) unknown.push(name)
    else seen.add(name)
  }
  if (unknown.length) {
    return {
      ok: false,
      error: `Line 1: unknown or duplicate column "${unknown[0]}".`,
      detail: `Allowed columns: ${PROXY_BATCH_COLUMNS.join(', ')} (any order; "${PROXY_BATCH_PROXY_COLUMN}" is mandatory).`
    }
  }
  const proxyIndex = header.cells.indexOf(PROXY_BATCH_PROXY_COLUMN)
  if (proxyIndex === -1) {
    return {
      ok: false,
      error: `Line 1: the header must include a "${PROXY_BATCH_PROXY_COLUMN}" column.`,
      detail: `Allowed columns: ${PROXY_BATCH_COLUMNS.join(', ')}.`
    }
  }
  const labelIndex = header.cells.indexOf('label')
  const countryIndex = header.cells.indexOf('country')
  const columnCount = header.cells.length

  const body = records.slice(1)
  if (body.length === 0) {
    return { ok: false, error: 'The file has the header but no proxy rows.' }
  }
  if (body.length > PROXY_BATCH_MAX_ROWS) {
    return {
      ok: false,
      error: `The file has ${body.length} rows — at most ${PROXY_BATCH_MAX_ROWS} per upload.`,
      detail: 'Split it into smaller files and upload them one after the other.'
    }
  }

  const rows: ParsedProxyRow[] = []
  for (const record of body) {
    if (record.cells.length !== columnCount) {
      return {
        ok: false,
        error: `Line ${record.line}: has ${record.cells.length} column${record.cells.length === 1 ? '' : 's'}, expected ${columnCount}.`
      }
    }
    const proxy = record.cells[proxyIndex] ?? ''
    if (!proxy) {
      return { ok: false, error: `Line ${record.line}: missing a "${PROXY_BATCH_PROXY_COLUMN}" value.` }
    }
    const label = labelIndex === -1 ? undefined : (record.cells[labelIndex] || undefined)
    const country = countryIndex === -1 ? undefined : (record.cells[countryIndex] || undefined)
    rows.push({ line: record.line, proxy, label, country })
  }

  return { ok: true, rows }
}
