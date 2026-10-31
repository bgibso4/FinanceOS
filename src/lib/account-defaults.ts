/** Account types tracked by balance snapshots rather than individual transactions. */
export const BALANCE_ONLY_TYPES = ['brokerage', 'retirement', 'crypto', 'loan'];

export function getDefaultTrackingMode(type: string): 'cash_flow' | 'balance_only' {
  return BALANCE_ONLY_TYPES.includes(type) ? 'balance_only' : 'cash_flow';
}

/** `Account.trackingMode` of an account tracked by holdings and trades. */
export const INVESTMENT_TRACKING_MODE = 'investment' as const;

export const TRACKING_MODES = ['cash_flow', 'balance_only', INVESTMENT_TRACKING_MODE] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];
