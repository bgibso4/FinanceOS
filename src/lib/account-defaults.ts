import { BalanceSource } from '@/lib/investments/codes';

/** `Account.trackingMode` of an account tracked by holdings and trades. */
export const INVESTMENT_TRACKING_MODE = 'investment' as const;

export const TRACKING_MODES = ['cash_flow', 'balance_only', INVESTMENT_TRACKING_MODE] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

/** Account types tracked as investment accounts (balance history, holdings, activity). */
export const INVESTMENT_TYPES = ['brokerage', 'retirement', 'crypto'] as const;

export function getDefaultTrackingMode(type: string): TrackingMode {
  if ((INVESTMENT_TYPES as readonly string[]).includes(type)) return 'investment';
  return type === 'loan' ? 'balance_only' : 'cash_flow';
}

/** Investment accounts start Synced when a connection syncs them, otherwise Manual. */
export function defaultBalanceSource(
  trackingMode: TrackingMode,
  opts: { synced: boolean }
): BalanceSource | null {
  if (trackingMode !== 'investment') return null;
  return opts.synced ? BalanceSource.Provider : BalanceSource.Manual;
}
