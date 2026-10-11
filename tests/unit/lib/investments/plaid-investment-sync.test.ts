import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('@/lib/plaid', () => ({ getPlaidClient: vi.fn() }));
vi.mock('@/lib/encryption', () => ({ decryptAccessToken: vi.fn(() => 'token') }));

import { getPlaidClient } from '@/lib/plaid';
import {
  syncPlaidInvestments,
  type InvestmentConnection,
} from '@/lib/investments/plaid-investment-sync';

const NOW = new Date('2026-10-09T15:00:00Z');
const TODAY = '2026-10-09T00:00:00.000Z';

const SEC_ETF = {
  security_id: 's-etf',
  name: 'Test ETF',
  ticker_symbol: 'TETF',
  type: 'etf',
  is_cash_equivalent: false,
  iso_currency_code: 'USD',
  market_identifier_code: 'ARCX',
  close_price: 100,
};
const SEC_OLD = {
  security_id: 's-old',
  name: 'Sold Fund',
  ticker_symbol: 'TOLD',
  type: 'etf',
  is_cash_equivalent: false,
  iso_currency_code: 'USD',
  market_identifier_code: 'ARCX',
  close_price: 50,
};

function plaidMock(over: Record<string, unknown> = {}) {
  const client = {
    accountsGet: vi.fn(async () => ({
      data: {
        accounts: [{ account_id: 'pa-1', balances: { current: 1234.5, iso_currency_code: 'USD' } }],
      },
    })),
    investmentsHoldingsGet: vi.fn(async () => ({
      data: {
        holdings: [
          {
            account_id: 'pa-1',
            security_id: 's-etf',
            quantity: 10,
            institution_price: 100,
            institution_value: 1000,
            cost_basis: 800,
          },
        ],
        securities: [SEC_ETF],
      },
    })),
    investmentsTransactionsGet: vi.fn(async (_req: unknown) => ({
      data: {
        total_investment_transactions: 2,
        securities: [SEC_ETF, SEC_OLD],
        investment_transactions: [
          {
            investment_transaction_id: 'it-1',
            account_id: 'pa-1',
            security_id: 's-old',
            date: '2026-09-01',
            name: 'SELL TOLD',
            quantity: -5,
            price: 50,
            amount: -250,
            fees: 0,
            type: 'sell',
            subtype: 'sell',
            iso_currency_code: 'USD',
            cancel_transaction_id: null,
          },
          {
            investment_transaction_id: 'it-2',
            account_id: 'pa-1',
            security_id: 's-etf',
            date: '2026-09-02',
            name: 'BUY TETF',
            quantity: 2,
            price: 100,
            amount: 200,
            fees: 0,
            type: 'buy',
            subtype: 'buy',
            iso_currency_code: 'USD',
            cancel_transaction_id: null,
          },
        ],
      },
    })),
    transactionsGet: vi.fn(async () => ({ data: { total_transactions: 0, transactions: [] } })),
    ...over,
  };
  vi.mocked(getPlaidClient).mockReturnValue(client as never);
  return client;
}

describe('syncPlaidInvestments', () => {
  let conn: InvestmentConnection;

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
    const a = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: 'provider',
      },
    });
    conn = {
      accountId: a.id,
      plaidAccountId: 'pa-1',
      plaidAccountType: 'investment',
      account: { id: a.id, currency: 'USD' },
      plaidEnrollment: { accessTokenEncrypted: 'e', accessTokenIv: 'iv' },
    };
  });

  it('records balance, holdings snapshot, Plaid price and transactions', async () => {
    plaidMock();
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.steps).toMatchObject({ balance: 'ok', holdings: 'ok', transactions: 'ok' });
    const bal = await testPrisma.accountBalance.findFirstOrThrow({
      where: { accountId: conn.accountId },
    });
    expect(bal).toMatchObject({ balance: 1234.5, source: 'plaid' });
    expect(bal.date.toISOString()).toBe(TODAY);
    const snap = await testPrisma.holdingSnapshot.findMany({
      where: { accountId: conn.accountId },
      include: { security: true },
    });
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      quantity: 10,
      price: 100,
      value: 1000,
      costBasis: 800,
      source: 'plaid',
    });
    expect(snap[0].security).toMatchObject({
      ticker: 'TETF',
      priceSymbol: 'TETF',
      pricing: 'feed',
    });
    expect(await testPrisma.securityPrice.count({ where: { source: 'plaid' } })).toBe(1);
    expect(
      await testPrisma.investmentTransaction.count({ where: { accountId: conn.accountId } })
    ).toBe(2);
  });

  it('upserts securities that appear only in transactions', async () => {
    plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    const sold = await testPrisma.investmentTransaction.findFirstOrThrow({
      where: { externalId: 'it-1' },
      include: { security: true },
    });
    expect(sold.security?.ticker).toBe('TOLD');
  });

  it('keeps a security marked unpriced while Plaid reports the same symbol', async () => {
    plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    await testPrisma.security.updateMany({
      where: { plaidSecurityId: 's-etf' },
      data: { pricing: 'none' },
    });
    await syncPlaidInvestments(conn, { now: NOW });
    expect(
      await testPrisma.security.findFirstOrThrow({ where: { plaidSecurityId: 's-etf' } })
    ).toMatchObject({ pricing: 'none', priceSymbol: 'TETF' });
  });

  it('is idempotent within a day', async () => {
    plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    await syncPlaidInvestments(conn, { now: NOW });
    expect(await testPrisma.accountBalance.count()).toBe(1);
    expect(await testPrisma.holdingSnapshot.count()).toBe(1);
    expect(await testPrisma.investmentTransaction.count()).toBe(2);
    expect(await testPrisma.security.count()).toBe(2);
  });

  it("replaces today's snapshot when a position is sold", async () => {
    plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    plaidMock({
      investmentsHoldingsGet: vi.fn(async () => ({ data: { holdings: [], securities: [] } })),
    });
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.steps.holdings).toBe('ok');
    expect(await testPrisma.holdingSnapshot.count()).toBe(0);
  });

  it('keeps the security on a transaction when it is no longer held or listed', async () => {
    plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    plaidMock({
      investmentsHoldingsGet: vi.fn(async () => ({ data: { holdings: [], securities: [] } })),
      investmentsTransactionsGet: vi.fn(async () => ({
        data: {
          total_investment_transactions: 1,
          securities: [],
          investment_transactions: [
            {
              investment_transaction_id: 'it-1',
              account_id: 'pa-1',
              security_id: 's-old',
              date: '2026-09-01',
              name: 'SELL TOLD',
              quantity: -5,
              price: 50,
              amount: -250,
              fees: 0,
              type: 'sell',
              subtype: 'sell',
              iso_currency_code: 'USD',
              cancel_transaction_id: null,
            },
          ],
        },
      })),
    });
    await syncPlaidInvestments(conn, { now: NOW });
    const sold = await testPrisma.investmentTransaction.findFirstOrThrow({
      where: { externalId: 'it-1' },
      include: { security: true },
    });
    expect(sold.security?.ticker).toBe('TOLD');
  });

  it('marks holdings pending on an empty first extraction and keeps the balance', async () => {
    plaidMock({
      investmentsHoldingsGet: vi.fn(async () => ({ data: { holdings: [], securities: [] } })),
    });
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.steps.holdings).toBe('pending');
    expect(r.errors.holdings).toBeTruthy();
    expect(r.steps.balance).toBe('ok');
    expect(await testPrisma.holdingSnapshot.count()).toBe(0);
  });

  it('marks cancelled transactions', async () => {
    plaidMock({
      investmentsTransactionsGet: vi.fn(async () => ({
        data: {
          total_investment_transactions: 2,
          securities: [SEC_ETF],
          investment_transactions: [
            {
              investment_transaction_id: 'it-9',
              security_id: 's-etf',
              date: '2026-09-02',
              name: 'BUY',
              quantity: 1,
              price: 100,
              amount: 100,
              fees: 0,
              type: 'buy',
              subtype: 'buy',
              iso_currency_code: 'USD',
              cancel_transaction_id: null,
            },
            {
              investment_transaction_id: 'it-10',
              security_id: 's-etf',
              date: '2026-09-03',
              name: 'CANCEL',
              quantity: -1,
              price: 100,
              amount: -100,
              fees: 0,
              type: 'cancel',
              subtype: 'cancel',
              iso_currency_code: 'USD',
              cancel_transaction_id: 'it-9',
            },
          ],
        },
      })),
    });
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.counts.cancelled).toBe(1);
    expect(
      (await testPrisma.investmentTransaction.findFirstOrThrow({ where: { externalId: 'it-9' } }))
        .isCancelled
    ).toBe(true);
  });

  it('marks a step pending on PRODUCT_NOT_READY and still records the balance', async () => {
    const notReady = Object.assign(new Error('not ready'), {
      response: { data: { error_code: 'PRODUCT_NOT_READY', error_message: 'not ready' } },
    });
    plaidMock({
      investmentsHoldingsGet: vi.fn(async () => {
        throw notReady;
      }),
    });
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.steps.holdings).toBe('pending');
    expect(r.steps.balance).toBe('ok');
  });

  it('rethrows re-auth errors', async () => {
    const reauth = Object.assign(new Error('login'), {
      response: { data: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' } },
    });
    plaidMock({
      accountsGet: vi.fn(async () => {
        throw reauth;
      }),
    });
    await expect(syncPlaidInvestments(conn, { now: NOW })).rejects.toBe(reauth);
  });

  it('syncs depository investment accounts from the Transactions product', async () => {
    const client = plaidMock({
      transactionsGet: vi.fn(async () => ({
        data: {
          total_transactions: 1,
          transactions: [
            {
              transaction_id: 'tx-1',
              account_id: 'pa-1',
              date: '2026-09-15',
              name: 'TRANSFER IN',
              amount: -500,
              iso_currency_code: 'USD',
              pending: false,
              personal_finance_category: { primary: 'TRANSFER_IN' },
            },
          ],
        },
      })),
    });
    const r = await syncPlaidInvestments({ ...conn, plaidAccountType: 'depository' }, { now: NOW });
    expect(client.investmentsHoldingsGet).not.toHaveBeenCalled();
    expect(client.investmentsTransactionsGet).not.toHaveBeenCalled();
    expect(r.steps.holdings).toBe('skipped');
    expect(
      await testPrisma.investmentTransaction.findFirstOrThrow({ where: { externalId: 'tx-1' } })
    ).toMatchObject({ type: 'cash', amount: -500 });
    expect(await testPrisma.transaction.count()).toBe(0);
  });

  it('requests 24 months on the first sync and last-date − 30 days afterwards', async () => {
    const client = plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    expect(client.investmentsTransactionsGet.mock.calls[0][0]).toMatchObject({
      start_date: '2024-10-09',
      end_date: '2026-10-09',
    });
    await syncPlaidInvestments(conn, { now: NOW });
    expect(client.investmentsTransactionsGet.mock.calls[1][0]).toMatchObject({
      start_date: '2026-08-03', // 2026-09-02 − 30d
    });
  });
});
