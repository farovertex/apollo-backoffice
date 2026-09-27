/** English labels from the Business Center account-status filter (2026-09-27). 8 is the punished payload code, same word as Suspended. */
const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  0: 'Deactivated',
  1: 'Disapproved',
  2: 'Approved',
  3: 'In review',
  4: 'Suspended',
  5: 'Contract has not taken effect',
  8: 'Suspended',
  12: 'No TikTok accounts are linked'
}

export function accountStatusTip(code: number | null): string {
  if (code === null) return 'account_status —'
  const label = ACCOUNT_STATUS_LABEL[code]
  return label ? `${label} (account_status ${code})` : `account_status ${code}`
}
