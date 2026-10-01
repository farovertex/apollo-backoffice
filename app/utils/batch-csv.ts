/**
 * FEAT-023 — client-side CSV parsing for the batch upload modal (assumption A1: the BO parses the file in the
 * browser and POSTs JSON; the API stays the source of truth for duplicate / fail per row).
 *
 * Rules from spec.md + api-contract.md v1 §5:
 * - header must be exactly `email,email_password,tiktok_password` (case-sensitive, surrounding spaces ignored)
 * - 1..1000 data rows; an empty file or a bigger one is refused here, before any request
 * - unquoted cells are trimmed, quoted cells are kept verbatim so a password may contain `,` or a leading space
 * - no error message ever repeats a cell value — a headerless file's first line *is* a pair of passwords
 */
import type { BatchAccountRow } from '#shared/types/tiktok-accounts'

/** CSV columns, in order, as the human agreed them. `email` → `loginEmail`, `tiktok_password` → `password`. */
export const BATCH_CSV_HEADER = ['email', 'email_password', 'tiktok_password'] as const

export const BATCH_CSV_MAX_ROWS = 1000

/** Static template in `public/` (same header + one example row with throw-away values). */
export const BATCH_CSV_TEMPLATE_URL = '/templates/tiktok-accounts-batch.csv'
export const BATCH_CSV_TEMPLATE_FILENAME = 'tiktok-accounts-batch.csv'

export type BatchCsvResult
  = { ok: true, rows: BatchAccountRow[] }
    | { ok: false, error: string, detail?: string }

interface CsvRecord {
  cells: string[]
  /** 1-based physical line the record starts on, for "Lines 4, 9" messages */
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

/** Same shape as the Add modal's zod email: one `@`, a dot in the domain, no whitespace. */
function isEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value)
}

function lineList(lines: number[]): string {
  const shown = lines.slice(0, 10).join(', ')
  return lines.length > 10 ? `Lines ${shown} … (+${lines.length - 10} more)` : `Line${lines.length > 1 ? 's' : ''} ${shown}`
}

/** Parse the uploaded text into the `rows` of `POST /tiktok-accounts/batch`, or into one human error. */
export function parseBatchCsv(raw: string): BatchCsvResult {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.trim()) {
    return { ok: false, error: 'The file is empty.', detail: 'Download the template and fill one row per account.' }
  }

  const records = parseRecords(text)
  const header = records[0]
  if (!header || header.cells.join(',') !== BATCH_CSV_HEADER.join(',')) {
    return {
      ok: false,
      error: `The first line must be exactly "${BATCH_CSV_HEADER.join(',')}".`,
      detail: 'Column names are case-sensitive and must be in that order — download the template to get them right.'
    }
  }

  const body = records.slice(1)
  if (body.length === 0) {
    return { ok: false, error: 'The file has the header but no account rows.' }
  }
  if (body.length > BATCH_CSV_MAX_ROWS) {
    return {
      ok: false,
      error: `The file has ${body.length} rows — at most ${BATCH_CSV_MAX_ROWS} per upload.`,
      detail: 'Split it into smaller files and upload them one after the other.'
    }
  }

  const rows: BatchAccountRow[] = []
  const badEmail: number[] = []
  const incomplete: number[] = []
  const tooLong: number[] = []
  for (const record of body) {
    const [email = '', emailPassword = '', password = ''] = record.cells
    const loginEmail = email.trim().toLowerCase()
    if (record.cells.length !== BATCH_CSV_HEADER.length || !emailPassword || !password) {
      incomplete.push(record.line)
    } else if (!isEmail(loginEmail)) {
      badEmail.push(record.line)
    } else if (emailPassword.length > 128 || password.length > 128) {
      tooLong.push(record.line)
    } else {
      rows.push({ loginEmail, emailPassword, password })
    }
  }

  if (incomplete.length) {
    return {
      ok: false,
      error: `${incomplete.length} row${incomplete.length > 1 ? 's are' : ' is'} incomplete — every row needs all three columns.`,
      detail: lineList(incomplete)
    }
  }
  if (badEmail.length) {
    return {
      ok: false,
      error: `${badEmail.length} row${badEmail.length > 1 ? 's do' : ' does'} not have a valid email address.`,
      detail: lineList(badEmail)
    }
  }
  if (tooLong.length) {
    return {
      ok: false,
      error: `${tooLong.length} row${tooLong.length > 1 ? 's have a password' : ' has a password'} longer than 128 characters.`,
      detail: lineList(tooLong)
    }
  }
  return { ok: true, rows }
}
