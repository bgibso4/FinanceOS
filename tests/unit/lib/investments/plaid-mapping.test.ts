import { describe, it, expect } from 'vitest';
import type { Security, Holding, InvestmentTransaction, Transaction } from 'plaid';
import {
  mapSecurity,
  mapHolding,
  mapInvestmentTransaction,
  mapCashTransaction,
} from '@/lib/investments/plaid-mapping';
import { Pricing } from '@/lib/investments/codes';

const sec = (o: Partial<Security>): Security =>
  ({
    security_id: 'sec-1',
    name: 'Test',
    ticker_symbol: null,
    type: 'etf',
    is_cash_equivalent: false,
    iso_currency_code: 'USD',
    market_identifier_code: null,
    close_price: null,
    ...o,
  }) as unknown as Security;

describe('mapSecurity', () => {
  it('maps a US-listed ETF to a market symbol equal to its ticker', () => {
    const m = mapSecurity(sec({ ticker_symbol: 'TETF', market_identifier_code: 'ARCX' }));
    expect(m).toMatchObject({
      type: 'etf',
      pricing: Pricing.Market,
      priceSymbol: 'TETF',
      fixedPrice: null,
    });
  });

  it('adds the .TO suffix for Toronto listings', () => {
    const m = mapSecurity(
      sec({ ticker_symbol: 'TCAD', market_identifier_code: 'XTSE', iso_currency_code: 'CAD' })
    );
    expect(m.priceSymbol).toBe('TCAD.TO');
    expect(m.currency).toBe('CAD');
  });

  it('fixes cash and cash-equivalent funds at 1.00', () => {
    expect(mapSecurity(sec({ type: 'cash', ticker_symbol: 'CUR:USD' }))).toMatchObject({
      type: 'cash',
      pricing: Pricing.Fixed,
      fixedPrice: 1,
    });
    expect(
      mapSecurity(sec({ type: 'mutual fund', ticker_symbol: 'TMMXX', is_cash_equivalent: true }))
    ).toMatchObject({
      type: 'money_market',
      pricing: Pricing.Fixed,
      fixedPrice: 1,
    });
  });

  it('uses Plaid pricing for non-public identifiers', () => {
    expect(mapSecurity(sec({ type: 'equity', ticker_symbol: 'PLAN.FUND.2060' })).pricing).toBe(
      Pricing.Institution
    );
    expect(mapSecurity(sec({ type: 'equity', ticker_symbol: null })).pricing).toBe(
      Pricing.Institution
    );
  });

  it('maps crypto to a TICKER-CCY symbol', () => {
    expect(
      mapSecurity(sec({ type: 'cryptocurrency', ticker_symbol: 'BTC', iso_currency_code: 'CAD' }))
    ).toMatchObject({
      type: 'crypto',
      pricing: Pricing.Market,
      priceSymbol: 'BTC-CAD',
    });
  });

  it('maps mutual funds without the cash flag to mutual_fund', () => {
    expect(mapSecurity(sec({ type: 'mutual fund', ticker_symbol: 'TFUNX' })).type).toBe(
      'mutual_fund'
    );
  });
});

describe('mapHolding', () => {
  it('maps institution price/value and nullable cost basis', () => {
    const h = {
      account_id: 'a',
      security_id: 'sec-1',
      quantity: 2,
      institution_price: 10,
      institution_value: 20,
      cost_basis: null,
    } as unknown as Holding;
    expect(mapHolding(h)).toEqual({
      plaidSecurityId: 'sec-1',
      quantity: 2,
      price: 10,
      value: 20,
      costBasis: null,
    });
  });
});

describe('mapInvestmentTransaction', () => {
  it('keeps Plaid type, subtype and sign; parses the date to UTC midnight', () => {
    const t = {
      investment_transaction_id: 'it-1',
      account_id: 'a',
      security_id: 'sec-1',
      date: '2026-09-30',
      name: 'DIVIDEND',
      quantity: 0,
      price: 1,
      amount: -22.28,
      fees: 0,
      type: 'cash',
      subtype: 'dividend',
      iso_currency_code: 'USD',
      cancel_transaction_id: null,
    } as unknown as InvestmentTransaction;
    expect(mapInvestmentTransaction(t)).toEqual({
      externalId: 'it-1',
      plaidSecurityId: 'sec-1',
      date: new Date('2026-09-30T00:00:00.000Z'),
      type: 'cash',
      subtype: 'dividend',
      name: 'DIVIDEND',
      quantity: 0,
      price: 1,
      amount: -22.28,
      fees: 0,
      currency: 'USD',
      cancelsExternalId: null,
    });
  });

  it('exposes the cancelled transaction id', () => {
    const t = {
      investment_transaction_id: 'it-2',
      security_id: null,
      date: '2026-09-30',
      name: 'CANCEL',
      quantity: 0,
      price: 0,
      amount: 10,
      fees: null,
      type: 'cancel',
      subtype: 'cancel',
      iso_currency_code: 'USD',
      cancel_transaction_id: 'it-1',
    } as unknown as InvestmentTransaction;
    expect(mapInvestmentTransaction(t).cancelsExternalId).toBe('it-1');
  });
});

describe('mapCashTransaction', () => {
  it('maps a posted depository transaction to a cash investment transaction', () => {
    const t = {
      transaction_id: 'tx-1',
      account_id: 'a',
      date: '2026-09-15',
      name: 'TRANSFERRED FROM BANK',
      amount: -500,
      iso_currency_code: 'USD',
      pending: false,
      personal_finance_category: {
        primary: 'TRANSFER_IN',
        detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER',
      },
    } as unknown as Transaction;
    expect(mapCashTransaction(t)).toMatchObject({
      externalId: 'tx-1',
      type: 'cash',
      subtype: 'transfer_in',
      amount: -500,
      plaidSecurityId: null,
    });
  });

  it('skips pending transactions', () => {
    expect(
      mapCashTransaction({ transaction_id: 'p', pending: true } as unknown as Transaction)
    ).toBeNull();
  });
});
