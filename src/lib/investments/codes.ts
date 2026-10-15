/**
 * Every code stored for investment data (spec 2026-10-13 §3). Database columns stay strings;
 * code reads and writes them only through these objects, never as bare strings.
 */

/** `Security.pricing`: how a security gets its price. */
export const Pricing = {
  /** Daily closes from the market data provider. */
  Market: 'market',
  /** The price the account's institution reports with each sync. */
  Institution: 'institution',
  /** A constant `fixedPrice` (cash: 1). */
  Fixed: 'fixed',
  /** Prices entered by hand. */
  Manual: 'manual',
  /** No price source; valued at its last known price. */
  None: 'none',
} as const;
export type Pricing = (typeof Pricing)[keyof typeof Pricing];

/** `SecurityPrice.source`, `SecurityEvent.source`: where a stored price or event came from. */
export const PriceSource = {
  Market: 'market',
  Institution: 'institution',
  Manual: 'manual',
} as const;
export type PriceSource = (typeof PriceSource)[keyof typeof PriceSource];

/** `HoldingSnapshot.source`, `InvestmentTransaction.source`: how a record arrived. */
export const RecordSource = { Synced: 'synced', Manual: 'manual', Import: 'import' } as const;
export type RecordSource = (typeof RecordSource)[keyof typeof RecordSource];

/** `AccountBalance.source`: what wrote a balance row. */
export const BalanceRowSource = {
  Synced: 'synced',
  Valuation: 'valuation',
  Manual: 'manual',
} as const;
export type BalanceRowSource = (typeof BalanceRowSource)[keyof typeof BalanceRowSource];

/** `Account.balanceSource`: where an investment account's balance comes from. */
export const BalanceSource = {
  Provider: 'provider',
  Valuation: 'valuation',
  Manual: 'manual',
} as const;
export type BalanceSource = (typeof BalanceSource)[keyof typeof BalanceSource];

/** `Security.type`. */
export const SecurityType = {
  Etf: 'etf',
  Equity: 'equity',
  MutualFund: 'mutual_fund',
  MoneyMarket: 'money_market',
  Cash: 'cash',
  Crypto: 'crypto',
  Other: 'other',
} as const;
export type SecurityType = (typeof SecurityType)[keyof typeof SecurityType];

/**
 * Values stored before the neutral codes, by family, and what each became. Only the stored-code
 * rename and the cloud-sync import read this; nothing else may use the old values.
 */
export const LEGACY_CODES = {
  pricing: { feed: Pricing.Market, plaid: Pricing.Institution },
  priceSource: { yahoo: PriceSource.Market, plaid: PriceSource.Institution },
  recordSource: { plaid: RecordSource.Synced },
  balanceRowSource: { plaid: BalanceRowSource.Synced },
} as const satisfies Record<string, Record<string, string>>;
