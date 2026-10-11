/** Account types tracked by balance snapshots rather than individual transactions. */
export const BALANCE_ONLY_TYPES = ['brokerage', 'retirement', 'crypto', 'loan'];

export function getDefaultTrackingMode(type: string): 'cash_flow' | 'balance_only' {
  return BALANCE_ONLY_TYPES.includes(type) ? 'balance_only' : 'cash_flow';
}

export const TRACKING_MODES = ['cash_flow', 'balance_only', 'investment'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const BALANCE_SOURCES = ['provider', 'valuation', 'manual'] as const;
export type BalanceSource = (typeof BALANCE_SOURCES)[number];
