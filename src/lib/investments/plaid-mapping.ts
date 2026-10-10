import type {
  Security as PlaidSecurity,
  Holding,
  InvestmentTransaction as PlaidInvestmentTransaction,
  Transaction as PlaidTransaction,
} from 'plaid';
import { utcDay } from './dates';

export type SecurityType =
  | 'etf'
  | 'equity'
  | 'mutual_fund'
  | 'money_market'
  | 'cash'
  | 'crypto'
  | 'other';
export type Pricing = 'feed' | 'plaid' | 'fixed' | 'manual' | 'none';

export type MappedSecurity = {
  plaidSecurityId: string;
  ticker: string | null;
  name: string;
  type: SecurityType;
  currency: string;
  exchangeMic: string | null;
  priceSymbol: string | null;
  pricing: Pricing;
  fixedPrice: number | null;
};

export type MappedHolding = {
  plaidSecurityId: string;
  quantity: number;
  price: number;
  value: number;
  costBasis: number | null;
};

export type MappedInvestmentTransaction = {
  externalId: string;
  plaidSecurityId: string | null;
  date: Date;
  type: string;
  subtype: string;
  name: string;
  quantity: number | null;
  price: number | null;
  amount: number;
  fees: number | null;
  currency: string;
  cancelsExternalId: string | null;
};

// Exchange tickers only: 1–6 uppercase letters/digits. Plaid uses dotted or colon ids for
// plan-only funds, RSUs and cash (e.g. "PLAN.FUND.2060", "CUR:USD").
const PUBLIC_TICKER = /^[A-Z][A-Z0-9]{0,5}$/;
const MIC_SUFFIX: Record<string, string> = { XTSE: '.TO', XTSX: '.V', NEOE: '.NE' };

function securityType(s: PlaidSecurity): SecurityType {
  if (s.type === 'cash') return 'cash';
  if (s.is_cash_equivalent) return 'money_market';
  switch (s.type) {
    case 'etf':
      return 'etf';
    case 'equity':
      return 'equity';
    case 'mutual fund':
      return 'mutual_fund';
    case 'cryptocurrency':
      return 'crypto';
    default:
      return 'other';
  }
}

export function mapSecurity(s: PlaidSecurity): MappedSecurity {
  const ticker = s.ticker_symbol ?? null;
  const currency = s.iso_currency_code ?? 'USD';
  const type = securityType(s);
  const base = {
    plaidSecurityId: s.security_id,
    ticker,
    name: s.name ?? ticker ?? 'Unknown security',
    type,
    currency,
    exchangeMic: s.market_identifier_code ?? null,
  };
  if (type === 'cash' || type === 'money_market') {
    return { ...base, priceSymbol: null, pricing: 'fixed', fixedPrice: 1 };
  }
  if (type === 'crypto' && ticker) {
    return { ...base, priceSymbol: `${ticker}-${currency}`, pricing: 'feed', fixedPrice: null };
  }
  if (ticker && PUBLIC_TICKER.test(ticker)) {
    const suffix = MIC_SUFFIX[s.market_identifier_code ?? ''] ?? '';
    return { ...base, priceSymbol: ticker + suffix, pricing: 'feed', fixedPrice: null };
  }
  return { ...base, priceSymbol: null, pricing: 'plaid', fixedPrice: null };
}

export function mapHolding(h: Holding): MappedHolding {
  return {
    plaidSecurityId: h.security_id,
    quantity: h.quantity,
    price: h.institution_price,
    value: h.institution_value,
    costBasis: h.cost_basis ?? null,
  };
}

export function mapInvestmentTransaction(
  t: PlaidInvestmentTransaction
): MappedInvestmentTransaction {
  return {
    externalId: t.investment_transaction_id,
    plaidSecurityId: t.security_id ?? null,
    date: utcDay(t.date),
    type: t.type,
    subtype: t.subtype,
    name: t.name,
    quantity: t.quantity ?? null,
    price: t.price ?? null,
    amount: t.amount,
    fees: t.fees ?? null,
    currency: t.iso_currency_code ?? 'USD',
    cancelsExternalId: t.cancel_transaction_id ?? null,
  };
}

/** Depository "investment" accounts (cash management) report through the Transactions product. */
export function mapCashTransaction(t: PlaidTransaction): MappedInvestmentTransaction | null {
  if (t.pending) return null;
  return {
    externalId: t.transaction_id,
    plaidSecurityId: null,
    date: utcDay(t.date),
    type: 'cash',
    subtype: (t.personal_finance_category?.primary ?? 'other').toLowerCase(),
    name: t.name,
    quantity: null,
    price: null,
    amount: t.amount,
    fees: null,
    currency: t.iso_currency_code ?? 'USD',
    cancelsExternalId: null,
  };
}
