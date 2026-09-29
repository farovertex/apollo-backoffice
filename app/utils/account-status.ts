/** Discover payload only. 4 = Active, 8 = Suspended. The Business Center filter dropdown uses other numbers and is not this map. */
const ACCOUNT_STATUS_LABEL: Record<number, string> = {
  4: 'Active',
  8: 'Suspended'
}

export function accountStatusTip(code: number | null): string {
  if (code === null) return 'account_status —'
  const label = ACCOUNT_STATUS_LABEL[code]
  return label ? `${label} (account_status ${code})` : `account_status ${code}`
}
