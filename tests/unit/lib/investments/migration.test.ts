import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';
import {
  replayAdjustments,
  buildMigrationPlan,
  applyMigrationPlan,
  type PlaidAccountRef,
} from '@/lib/investments/migration';
import { BalanceRowSource, BalanceSource } from '@/lib/investments/codes';

const d = (s: string) => new Date(s);

describe('replayAdjustments', () => {
  it('turns adjustments into running balances, last value per UTC day', () => {
    expect(
      replayAdjustments([
        { date: d('2026-04-04T12:00:00Z'), amount: -100 },
        { date: d('2026-01-27T01:00:00Z'), amount: 1000 },
        { date: d('2026-04-04T13:00:00Z'), amount: 50 },
      ])
    ).toEqual([
      { date: d('2026-01-27T00:00:00.000Z'), balance: 1000 },
      { date: d('2026-04-04T00:00:00.000Z'), balance: 950 },
    ]);
  });

  it('rounds to cents', () => {
    expect(
      replayAdjustments([
        { date: d('2026-01-01T00:00:00Z'), amount: 0.1 },
        { date: d('2026-01-01T01:00:00Z'), amount: 0.2 },
      ])[0].balance
    ).toBe(0.3);
  });
});

describe('buildMigrationPlan / applyMigrationPlan', () => {
  let prisma: PrismaClient;
  let enrollmentId: string;
  const plaidAccounts = (): PlaidAccountRef[] => [
    {
      enrollmentId,
      institutionName: 'Test Brokerage',
      accountId: 'pa-1',
      name: 'BROKERAGE',
      mask: '1111',
      type: 'investment',
      subtype: 'brokerage',
    },
    {
      enrollmentId,
      institutionName: 'Test Brokerage',
      accountId: 'pa-2',
      name: 'IRA',
      mask: '2222',
      type: 'investment',
      subtype: 'ira',
    },
  ];

  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    enrollmentId = (
      await prisma.plaidEnrollment.create({
        data: {
          plaidItemId: 'item',
          institutionName: 'Test Brokerage',
          accessTokenEncrypted: 'x',
          accessTokenIv: 'y',
        },
      })
    ).id;
  });

  async function legacyAccount(type = 'brokerage') {
    const a = await prisma.account.create({
      data: { ...createAccountData({ type }), trackingMode: 'balance_only' },
    });
    for (const [date, amount] of [
      ['2026-01-27T01:00:00Z', 1000],
      ['2026-04-04T12:00:00Z', 250],
    ] as const) {
      await prisma.transaction.create({
        data: {
          accountId: a.id,
          date: new Date(date),
          amount,
          merchant: 'Balance Adjustment',
          isTransfer: true,
        },
      });
    }
    return a;
  }

  it('converts in place: balance history, adjustments removed, Plaid connection created', async () => {
    const a = await legacyAccount();
    const plan = await buildMigrationPlan(
      prisma,
      {
        accounts: [
          {
            accountId: a.id,
            balanceSource: BalanceSource.Provider,
            plaid: { institution: 'Test Brokerage', mask: '1111' },
          },
        ],
        create: [],
      },
      plaidAccounts()
    );
    await applyMigrationPlan(prisma, plan);
    const acct = await prisma.account.findUniqueOrThrow({
      where: { id: a.id },
      include: { plaidConnection: true },
    });
    expect(acct).toMatchObject({
      trackingMode: 'investment',
      balanceSource: BalanceSource.Provider,
    });
    expect(acct.plaidConnection).toMatchObject({
      plaidAccountId: 'pa-1',
      plaidAccountMask: '1111',
      plaidAccountType: 'investment',
    });
    const rows = await prisma.accountBalance.findMany({
      where: { accountId: a.id },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.balance, r.source])).toEqual([
      ['2026-01-27', 1000, BalanceRowSource.Manual],
      ['2026-04-04', 1250, BalanceRowSource.Manual],
    ]);
    expect(await prisma.transaction.count({ where: { accountId: a.id } })).toBe(0);
  });

  it('creates new linked accounts', async () => {
    const plan = await buildMigrationPlan(
      prisma,
      {
        accounts: [],
        create: [
          {
            name: 'New IRA',
            type: 'retirement',
            currency: 'USD',
            plaid: { institution: 'Test Brokerage', mask: '2222' },
          },
        ],
      },
      plaidAccounts()
    );
    const { createdAccountIds } = await applyMigrationPlan(prisma, plan);
    const acct = await prisma.account.findUniqueOrThrow({
      where: { id: createdAccountIds[0] },
      include: { plaidConnection: true },
    });
    expect(acct).toMatchObject({
      name: 'New IRA',
      trackingMode: 'investment',
      balanceSource: BalanceSource.Provider,
    });
    expect(acct.plaidConnection?.plaidAccountId).toBe('pa-2');
  });

  it('refuses accounts with non-adjustment transactions', async () => {
    const a = await legacyAccount();
    await prisma.transaction.create({
      data: { accountId: a.id, date: new Date(), amount: 5, merchant: 'Coffee' },
    });
    await expect(
      buildMigrationPlan(
        prisma,
        { accounts: [{ accountId: a.id, balanceSource: BalanceSource.Manual }], create: [] },
        []
      )
    ).rejects.toThrow(/non-adjustment/);
  });

  it('refuses missing or ambiguous Plaid matches', async () => {
    const a = await legacyAccount();
    await expect(
      buildMigrationPlan(
        prisma,
        {
          accounts: [
            {
              accountId: a.id,
              balanceSource: BalanceSource.Provider,
              plaid: { institution: 'Test Brokerage', mask: '9999' },
            },
          ],
          create: [],
        },
        plaidAccounts()
      )
    ).rejects.toThrow(/exactly 1/);
    const dup = [...plaidAccounts(), { ...plaidAccounts()[0], accountId: 'pa-dup' }];
    await expect(
      buildMigrationPlan(
        prisma,
        {
          accounts: [
            {
              accountId: a.id,
              balanceSource: BalanceSource.Provider,
              plaid: { institution: 'Test Brokerage', mask: '1111' },
            },
          ],
          create: [],
        },
        dup
      )
    ).rejects.toThrow(/exactly 1/);
  });

  it('re-running an applied plan changes nothing', async () => {
    const a = await legacyAccount();
    const config = {
      accounts: [{ accountId: a.id, balanceSource: BalanceSource.Manual }],
      create: [],
    };
    await applyMigrationPlan(prisma, await buildMigrationPlan(prisma, config, []));
    const again = await buildMigrationPlan(prisma, config, []);
    expect(again.convert).toHaveLength(0);
    expect(again.skipped).toEqual([{ accountId: a.id, reason: 'already an investment account' }]);
    await applyMigrationPlan(prisma, again);
    expect(await prisma.accountBalance.count({ where: { accountId: a.id } })).toBe(2);
  });

  it('skips create entries whose Plaid account is already linked', async () => {
    const config = {
      accounts: [],
      create: [
        {
          name: 'New IRA',
          type: 'retirement',
          currency: 'USD',
          plaid: { institution: 'Test Brokerage', mask: '2222' },
        },
      ],
    };
    await applyMigrationPlan(prisma, await buildMigrationPlan(prisma, config, plaidAccounts()));
    const again = await buildMigrationPlan(prisma, config, plaidAccounts());
    expect(again.create).toHaveLength(0);
  });

  describe('conflict detection', () => {
    const provider = (accountId: string, mask: string) => ({
      accountId,
      balanceSource: BalanceSource.Provider,
      plaid: { institution: 'Test Brokerage', mask },
    });

    it('rejects an account listed twice', async () => {
      const a = await legacyAccount();
      await expect(
        buildMigrationPlan(
          prisma,
          {
            accounts: [
              { accountId: a.id, balanceSource: BalanceSource.Manual },
              { accountId: a.id, balanceSource: BalanceSource.Manual },
            ],
            create: [],
          },
          []
        )
      ).rejects.toThrow(/more than once/);
    });

    it('rejects an account that already has a Plaid connection', async () => {
      const a = await legacyAccount();
      await prisma.plaidConnection.create({
        data: {
          accountId: a.id,
          plaidEnrollmentId: enrollmentId,
          plaidAccountId: 'other',
          status: 'connected',
        },
      });
      await expect(
        buildMigrationPlan(
          prisma,
          { accounts: [provider(a.id, '1111')], create: [] },
          plaidAccounts()
        )
      ).rejects.toThrow(/conflict/);
    });

    it('rejects a Plaid account already linked to a different account', async () => {
      const a = await legacyAccount();
      const b = await legacyAccount();
      await prisma.plaidConnection.create({
        data: {
          accountId: b.id,
          plaidEnrollmentId: enrollmentId,
          plaidAccountId: 'pa-1',
          status: 'connected',
        },
      });
      await expect(
        buildMigrationPlan(
          prisma,
          { accounts: [provider(a.id, '1111')], create: [] },
          plaidAccounts()
        )
      ).rejects.toThrow(/conflict/);
    });

    it('rejects two entries resolving to the same Plaid account', async () => {
      const a = await legacyAccount();
      const b = await legacyAccount();
      await expect(
        buildMigrationPlan(
          prisma,
          { accounts: [provider(a.id, '1111'), provider(b.id, '1111')], create: [] },
          plaidAccounts()
        )
      ).rejects.toThrow(/already claimed/);
      await expect(
        buildMigrationPlan(
          prisma,
          {
            accounts: [provider(a.id, '1111')],
            create: [
              {
                name: 'X',
                type: 'brokerage',
                currency: 'USD',
                plaid: { institution: 'Test Brokerage', mask: '1111' },
              },
            ],
          },
          plaidAccounts()
        )
      ).rejects.toThrow(/already claimed/);
    });
  });
});
