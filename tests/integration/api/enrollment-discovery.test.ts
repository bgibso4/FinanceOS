import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

function enrollmentRequest(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

let testPrisma: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

vi.mock('@/lib/teller', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/teller')>();
  return { ...original, tellerFetch: vi.fn() };
});

vi.mock('@/lib/plaid', () => ({
  getPlaidClient: vi.fn(),
}));

vi.mock('@/lib/encryption', () => ({
  encryptAccessToken: vi.fn(() => ({ encrypted: 'enc', iv: 'iv' })),
  decryptAccessToken: vi.fn(() => 'decrypted'),
}));

import { GET } from '@/app/api/teller/enrollment/route';
import { tellerFetch } from '@/lib/teller';
import { GET as plaidGET } from '@/app/api/plaid/enrollment/route';
import { getPlaidClient } from '@/lib/plaid';

function tellerAccount(id: string, lastFour: string, name: string) {
  return {
    id,
    enrollment_id: 'enr_1',
    institution: { id: 'chase', name: 'Chase' },
    name,
    type: 'depository',
    subtype: 'checking',
    currency: 'USD',
    last_four: lastFour,
    status: 'open',
  };
}

function plaidAccount(accountId: string, mask: string, name: string) {
  return {
    account_id: accountId,
    name,
    type: 'depository',
    subtype: 'checking',
    mask,
  };
}

function mockPlaidAccountsGet(accounts: unknown[]) {
  vi.mocked(getPlaidClient).mockReturnValue({
    accountsGet: vi.fn().mockResolvedValue({ data: { accounts } }),
  } as unknown as ReturnType<typeof getPlaidClient>);
}

describe('teller enrollment GET discovery', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    testPrisma = prisma;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
  });

  async function seed() {
    const enrollment = await prisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'enr_1',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
      },
    });
    const account = await prisma.account.create({
      data: createAccountData({ name: 'Personal Checking' }),
    });
    await prisma.tellerConnection.create({
      data: {
        accountId: account.id,
        tellerEnrollmentId: enrollment.id,
        tellerAccountId: 'acc_linked',
        tellerAccountName: 'Personal Checking',
        tellerAccountLastFour: '3857',
        status: 'connected',
      },
    });
    return enrollment;
  }

  it('excludes linked accounts from availableAccounts but counts them in the total', async () => {
    await seed();
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_linked', '3857', 'Personal Checking'),
      tellerAccount('acc_new', '4242', 'Amazon Card'),
    ]);

    const body = await (
      await GET(enrollmentRequest('http://localhost/api/teller/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.totalAccountCount).toBe(2);
    expect(enrollment.availableAccounts).toHaveLength(1);
    expect(enrollment.availableAccounts[0].externalId).toBe('acc_new');
    expect(enrollment.hiddenAccounts).toHaveLength(0);
  });

  it('survives a failing cache write without marking the enrollment disconnected', async () => {
    const enrollment = await seed();
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_linked', '3857', 'Personal Checking'),
      tellerAccount('acc_new', '4242', 'Amazon Card'),
    ]);

    // A DB write failure must not reach the reauth classifier. Prisma error text
    // mentions `tellerEnrollment.update()`, which matches that classifier's
    // "enrollment" test — this previously flipped a live Chase connection to
    // disconnected on every page load while its token was perfectly healthy.
    //
    // Prisma's model methods are proxied getters, so vi.spyOn cannot attach. Swap the
    // injected client for one that rejects exactly that call and delegates the rest.
    const realPrisma = testPrisma;
    testPrisma = new Proxy(realPrisma, {
      get(target, prop, receiver) {
        if (prop !== 'tellerEnrollment') return Reflect.get(target, prop, receiver);
        const model = Reflect.get(target, prop, receiver);
        return new Proxy(model, {
          get(m, p, r) {
            if (p !== 'update') return Reflect.get(m, p, r);
            return () =>
              Promise.reject(
                new Error('Unknown argument `cachedAccounts` on tellerEnrollment.update()')
              );
          },
        });
      },
    }) as PrismaClient;

    try {
      const body = await (
        await GET(enrollmentRequest('http://localhost/api/teller/enrollment'))
      ).json();
      const returned = body.enrollments[0];

      expect(returned.status).toBe('connected');
      expect(returned.availableAccounts).toHaveLength(1);
      expect(returned.totalAccountCount).toBe(2);
    } finally {
      testPrisma = realPrisma;
    }

    const persisted = await prisma.tellerEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(persisted?.status).toBe('connected');
  });

  it('never ships access token material or cache internals to the client', async () => {
    await seed();
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_linked', '3857', 'Personal Checking'),
    ]);

    const body = await (
      await GET(enrollmentRequest('http://localhost/api/teller/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    // Ciphertext is not a live credential, but it has no reason to leave the server
    // and is decryptable by anyone who obtains the encryption key.
    expect(enrollment).not.toHaveProperty('accessTokenEncrypted');
    expect(enrollment).not.toHaveProperty('accessTokenIv');
    expect(enrollment).not.toHaveProperty('cachedAccounts');
    expect(enrollment).not.toHaveProperty('accountsCachedAt');

    // The fields the UI actually consumes must survive.
    expect(enrollment.id).toBeTruthy();
    expect(enrollment.enrollmentId).toBe('enr_1');
    expect(enrollment.institutionId).toBe('chase');
    expect(enrollment.institutionName).toBe('Chase');
    expect(enrollment.status).toBe('connected');
    expect(enrollment.connections).toHaveLength(1);
  });

  it('moves ignored accounts into hiddenAccounts', async () => {
    await seed();
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_new',
        lastFour: '4242',
      },
    });
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_linked', '3857', 'Personal Checking'),
      tellerAccount('acc_new', '4242', 'Amazon Card'),
    ]);

    const body = await (
      await GET(enrollmentRequest('http://localhost/api/teller/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.availableAccounts).toHaveLength(0);
    expect(enrollment.hiddenAccounts.map((a: { externalId: string }) => a.externalId)).toEqual([
      'acc_new',
    ]);
  });

  it('keeps an account hidden after its external id changes, via last four', async () => {
    await seed();
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_stale_id',
        lastFour: '4242',
      },
    });
    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount('acc_reissued', '4242', 'Amazon Card'),
    ]);

    const body = await (
      await GET(enrollmentRequest('http://localhost/api/teller/enrollment'))
    ).json();

    expect(body.enrollments[0].availableAccounts).toHaveLength(0);
    expect(body.enrollments[0].hiddenAccounts).toHaveLength(1);
  });
});

describe('plaid enrollment GET discovery', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    testPrisma = prisma;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
  });

  async function seed(institutionId: string | null = 'chase') {
    const enrollment = await prisma.plaidEnrollment.create({
      data: {
        plaidItemId: 'item_1',
        institutionId,
        institutionName: 'Chase',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
      },
    });
    const account = await prisma.account.create({
      data: createAccountData({ name: 'Personal Checking' }),
    });
    await prisma.plaidConnection.create({
      data: {
        accountId: account.id,
        plaidEnrollmentId: enrollment.id,
        plaidAccountId: 'acc_linked',
        plaidAccountName: 'Personal Checking',
        plaidAccountMask: '3857',
        status: 'connected',
      },
    });
    return enrollment;
  }

  it('excludes linked accounts from availableAccounts but counts them in the total', async () => {
    await seed();
    mockPlaidAccountsGet([
      plaidAccount('acc_linked', '3857', 'Personal Checking'),
      plaidAccount('acc_new', '4242', 'Amazon Card'),
    ]);

    const body = await (
      await plaidGET(enrollmentRequest('http://localhost/api/plaid/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.totalAccountCount).toBe(2);
    expect(enrollment.availableAccounts).toHaveLength(1);
    expect(enrollment.availableAccounts[0].externalId).toBe('acc_new');
    expect(enrollment.hiddenAccounts).toHaveLength(0);
  });

  it('moves ignored accounts into hiddenAccounts', async () => {
    await seed();
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'plaid',
        institutionId: 'chase',
        externalAccountId: 'acc_new',
        lastFour: '4242',
      },
    });
    mockPlaidAccountsGet([
      plaidAccount('acc_linked', '3857', 'Personal Checking'),
      plaidAccount('acc_new', '4242', 'Amazon Card'),
    ]);

    const body = await (
      await plaidGET(enrollmentRequest('http://localhost/api/plaid/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.availableAccounts).toHaveLength(0);
    expect(enrollment.hiddenAccounts.map((a: { externalId: string }) => a.externalId)).toEqual([
      'acc_new',
    ]);
  });

  it('keeps an account hidden after its external id changes, via last four', async () => {
    await seed();
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'plaid',
        institutionId: 'chase',
        externalAccountId: 'acc_stale_id',
        lastFour: '4242',
      },
    });
    mockPlaidAccountsGet([plaidAccount('acc_reissued', '4242', 'Amazon Card')]);

    const body = await (
      await plaidGET(enrollmentRequest('http://localhost/api/plaid/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.availableAccounts).toHaveLength(0);
    expect(enrollment.hiddenAccounts).toHaveLength(1);
  });

  it('coalesces a null institutionId to an empty string for ignore matching', async () => {
    // Plaid's institutionId is nullable; the route falls back to '' so
    // isAccountIgnored always gets a string. Pin what that produces: an
    // ignore row keyed on institutionId: '' still matches via last-four,
    // and a null institutionId enrollment doesn't crash the route.
    await seed(null);
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'plaid',
        institutionId: '',
        externalAccountId: 'irrelevant_id',
        lastFour: '9999',
      },
    });
    mockPlaidAccountsGet([plaidAccount('acc_new', '9999', 'Untitled Account')]);

    const body = await (
      await plaidGET(enrollmentRequest('http://localhost/api/plaid/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.institutionId).toBeNull();
    expect(enrollment.availableAccounts).toHaveLength(0);
    expect(enrollment.hiddenAccounts).toHaveLength(1);
    expect(enrollment.hiddenAccounts[0].externalId).toBe('acc_new');
  });

  it('falls back to empty account lists and the linked count when the Plaid client throws', async () => {
    await seed();
    vi.mocked(getPlaidClient).mockReturnValue({
      accountsGet: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ReturnType<typeof getPlaidClient>);

    const body = await (
      await plaidGET(enrollmentRequest('http://localhost/api/plaid/enrollment'))
    ).json();
    const enrollment = body.enrollments[0];

    expect(enrollment.availableAccounts).toEqual([]);
    expect(enrollment.hiddenAccounts).toEqual([]);
    expect(enrollment.totalAccountCount).toBe(1);
  });
});

describe('teller enrollment GET accounts cache', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDb();
    testPrisma = prisma;
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
  });

  async function seed(overrides: {
    cachedAccounts?: string | null;
    accountsCachedAt?: Date | null;
  }) {
    return prisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'enr_1',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
        cachedAccounts: overrides.cachedAccounts ?? null,
        accountsCachedAt: overrides.accountsCachedAt ?? null,
      },
    });
  }

  it('skips the live tellerFetch call entirely when a fresh cache is present', async () => {
    const cachedAt = new Date();
    const enrollment = await seed({
      cachedAccounts: JSON.stringify([tellerAccount('acc_new', '4242', 'Amazon Card')]),
      accountsCachedAt: cachedAt,
    });

    const body = await (
      await GET(enrollmentRequest('http://localhost/api/teller/enrollment'))
    ).json();

    expect(tellerFetch).toHaveBeenCalledTimes(0);
    expect(body.enrollments[0].availableAccounts).toHaveLength(1);
    expect(body.enrollments[0].availableAccounts[0].externalId).toBe('acc_new');

    // A cached read must not write anything either — the stored cache timestamp
    // stays exactly what it was.
    const unchanged = await prisma.tellerEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(unchanged.accountsCachedAt?.getTime()).toBe(cachedAt.getTime());
  });

  it('falls back to a live tellerFetch call once the cache has expired', async () => {
    const staleCachedAt = new Date(Date.now() - 7 * 60 * 60 * 1000); // 7h ago, past the 6h TTL
    await seed({
      cachedAccounts: JSON.stringify([tellerAccount('acc_stale', '1111', 'Stale Cached Account')]),
      accountsCachedAt: staleCachedAt,
    });
    vi.mocked(tellerFetch).mockResolvedValue([tellerAccount('acc_new', '4242', 'Amazon Card')]);

    const body = await (
      await GET(enrollmentRequest('http://localhost/api/teller/enrollment'))
    ).json();

    expect(tellerFetch).toHaveBeenCalledTimes(1);
    expect(body.enrollments[0].availableAccounts[0].externalId).toBe('acc_new');
  });

  it('forces a live tellerFetch call when ?refresh=1 is passed, even with a fresh cache', async () => {
    await seed({
      cachedAccounts: JSON.stringify([tellerAccount('acc_stale', '1111', 'Stale Cached Account')]),
      accountsCachedAt: new Date(),
    });
    vi.mocked(tellerFetch).mockResolvedValue([tellerAccount('acc_new', '4242', 'Amazon Card')]);

    const body = await (
      await GET(enrollmentRequest('http://localhost/api/teller/enrollment?refresh=1'))
    ).json();

    expect(tellerFetch).toHaveBeenCalledTimes(1);
    expect(body.enrollments[0].availableAccounts[0].externalId).toBe('acc_new');
  });

  it('persists a live fetch result back onto the cache columns', async () => {
    const enrollment = await seed({ cachedAccounts: null, accountsCachedAt: null });
    vi.mocked(tellerFetch).mockResolvedValue([tellerAccount('acc_new', '4242', 'Amazon Card')]);

    await GET(enrollmentRequest('http://localhost/api/teller/enrollment'));

    const updated = await prisma.tellerEnrollment.findUniqueOrThrow({
      where: { id: enrollment.id },
    });
    expect(updated.cachedAccounts).toContain('acc_new');
    expect(updated.accountsCachedAt).not.toBeNull();
  });
});
