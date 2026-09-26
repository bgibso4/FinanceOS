/** Account types tracked by balance snapshots rather than individual transactions. */
export const BALANCE_ONLY_TYPES = ['brokerage', 'retirement', 'crypto', 'loan'];

export function getDefaultTrackingMode(type: string): 'cash_flow' | 'balance_only' {
  return BALANCE_ONLY_TYPES.includes(type) ? 'balance_only' : 'cash_flow';
}
