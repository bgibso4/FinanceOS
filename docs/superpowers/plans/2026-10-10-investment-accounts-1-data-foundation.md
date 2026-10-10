# Investment Accounts — Plan 1: Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store investment accounts outside the transaction ledger (balance history, securities, holdings snapshots, investment transactions), sync them from Plaid, link bank transfers to investment deposits, and migrate the existing manual investment accounts in place — with every balance in the app coming from one resolver.

**Architecture:** New Prisma models hold investment data; `src/lib/balances.ts` resolves an account's balance from `AccountBalance` (investment accounts) or the transaction sum (everything else), and the four existing balance call sites switch to it. `src/lib/investments/` holds pure Plaid→model mappers, the Plaid investment sync, transfer linking and migration logic; `/api/plaid/sync` routes investment-mode accounts to the new sync. A one-shot script converts existing accounts using a local, uncommitted mapping file.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma + SQLite, Plaid Node SDK v41, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-investment-accounts-design.md` (this plan covers spec §3, §4, §7, cloud-sync part of §3, and the balance-resolver part of §3; price service §5, valuation/history §6, and UI §8 are Plans 2 and 3).

**Plan series:**
1. **Data foundation (this plan)** — schema, balance resolver, Plaid investment sync, transfer linking, cloud sync, migration.
2. Prices & history — Yahoo price service, valuation accounts, manual-holding snapshot, derived history.
3. UI — `/investments` (approved mock A3), Settings modal/mapping (incl. investment-type Plaid accounts defaulting to investment mode on Add), linked-transfer chip.

**Interim behavior until Plans 2–3 land:** Questrade RRSP and Crypto Wallet are migrated as `balanceSource: manual` (they switch to `valuation` in Plan 2 once holdings are entered). The existing Settings "Reconcile Balance" keeps working for investment accounts by writing an `AccountBalance` row instead of an adjustment transaction (Task 4).

## Global Constraints

- Schema changes use `npx prisma db push` (never `prisma migrate dev` — it fails with P3006 on this DB). Run `npx prisma generate` after.
- All dates stored in UTC; day-granular investment rows use UTC midnight (`YYYY-MM-DDT00:00:00.000Z`).
- FinanceOS amount convention: negative = money out, positive = money in. `InvestmentTransaction.amount` keeps **Plaid's** convention verbatim (positive = cash leaves the investment account, negative = cash enters).
- Investment-mode accounts never write `Transaction` rows.
- Never call `/investments/refresh` or `/transactions/refresh` (per-request Plaid fees).
- **The GitHub repo is public:** no account names, masks/last-four, balances or other personal data in committed code, tests or fixtures. Test data is synthetic. Real account mapping lives in an uncommitted JSON file.
- Lint rules: only `console.warn` / `console.error`; prefix unused vars with `_`; single quotes, semicolons, 100-char lines. Run `npm run lint:fix` before each commit; the pre-commit hook runs ESLint + Prettier.
- Tests: Vitest; DB tests use `setupTestDb/resetTestDb/teardownTestDb` from `tests/helpers/db.ts` and mock `@/lib/prisma` with a getter returning the test client (pattern in `tests/unit/lib/plaid-sync.test.ts`).

## Review Focus

1. **Syncing the same account twice on the same day** must not duplicate balance rows, holding snapshots or investment transactions (all upserts keyed by day/external id). → Task 6 test "is idempotent within a day".
2. **A position sold since the previous sync** must disappear from today's holdings rather than linger. → Task 6 test "replaces today's snapshot".
3. **A Plaid investment transaction referencing a security no longer held** (sold earlier) must still store with its security, not fail on a missing FK. → Task 6 test "upserts securities that appear only in transactions".
4. **An investment account that still has old `Transaction` rows** (e.g. an un-migrated adjustment) must report its `AccountBalance`, not the transaction sum, and "Reconcile Balance" must not create new adjustment transactions for it. → Task 2 test "ignores transactions for investment accounts"; Task 4 tests.
5. **Running the migration again after it was applied** must be a no-op — no duplicated balances, no deleted rows. → Task 9 test "re-running an applied plan changes nothing".

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` (modify) | `Account.balanceSource`; models `AccountBalance`, `Security`, `SecurityPrice`, `SecurityEvent`, `HoldingSnapshot`, `InvestmentTransaction`; back-relation on `Transaction` |
| `src/lib/account-defaults.ts` (modify) | `TRACKING_MODES`, `BALANCE_SOURCES` constants |
| `src/app/api/accounts/route.ts`, `src/app/api/accounts/[id]/route.ts` (modify) | Accept `investment` tracking mode and `balanceSource` |
| `src/lib/investments/dates.ts` (create) | `utcDay`, `isoDay`, `addDays` |
| `src/lib/balances.ts` (create) | Balance resolver used by all balance call sites |
| `src/app/api/accounts/balances/route.ts`, `src/app/api/snapshots/route.ts`, `src/lib/goals.ts`, `src/lib/agent/tools.ts` (modify) | Use resolver |
| `src/app/api/transactions/adjustment/route.ts` (modify) | Investment accounts: write `AccountBalance` instead of a transaction |
| `src/lib/investments/plaid-mapping.ts` (create) | Pure Plaid → model mappers |
| `src/lib/investments/plaid-investment-sync.ts` (create) | `syncPlaidInvestments` |
| `src/lib/investments/transfer-linking.ts` (create) | Bank-transfer ↔ investment cash-flow matching |
| `src/app/api/plaid/sync/route.ts` (modify) | Route investment-mode accounts to the new sync |
| `src/lib/cloud-sync/types.ts`, `src/lib/cloud-sync/sync.ts` (modify) | Export/import new tables + `balanceSource` |
| `src/lib/investments/migration.ts` (create) | Pure replay + plan build + plan apply |
| `scripts/migrate-investment-accounts.ts` (create) | CLI: load local mapping, match Plaid accounts, dry run / backup / apply / first sync |
| `tests/helpers/db.ts` (modify) | Reset new tables |
| Tests under `tests/unit/lib/investments/`, `tests/unit/lib/balances.test.ts`, `tests/integration/api/…` | As listed per task |

---

### Task 1: Schema & tracking-mode plumbing

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/account-defaults.ts`
- Modify: `src/app/api/accounts/route.ts:13`, `src/app/api/accounts/[id]/route.ts:5-14`
- Modify: `tests/helpers/db.ts` (`resetTestDb`)
- Create: `src/lib/investments/dates.ts`
- Test: `tests/unit/lib/investments/dates.test.ts`, `tests/integration/api/investment-schema.test.ts`

**Interfaces:**
- Produces: Prisma models `AccountBalance`, `Security`, `SecurityPrice`, `SecurityEvent`, `HoldingSnapshot`, `InvestmentTransaction`; `Account.balanceSource: string | null`; `TRACKING_MODES = ['cash_flow','balance_only','investment'] as const`; `BALANCE_SOURCES = ['provider','valuation','manual'] as const`; `utcDay(input: string | Date): Date`, `isoDay(d: Date): string`, `addDays(d: Date, n: number): Date`.

- [ ] **Step 1: Write failing tests**

`tests/unit/lib/investments/dates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { utcDay, isoDay, addDays } from '@/lib/investments/dates';

describe('investment dates', () => {
  it('utcDay parses a YYYY-MM-DD string to UTC midnight', () => {
    expect(utcDay('2026-10-09').toISOString()).toBe('2026-10-09T00:00:00.000Z');
  });

  it('utcDay truncates a Date to its UTC day', () => {
    expect(utcDay(new Date('2026-10-09T23:59:59.999Z')).toISOString()).toBe(
      '2026-10-09T00:00:00.000Z'
    );
  });

  it('isoDay formats a Date as YYYY-MM-DD in UTC', () => {
    expect(isoDay(new Date('2026-01-05T03:00:00Z'))).toBe('2026-01-05');
  });

  it('addDays adds whole days', () => {
    expect(isoDay(addDays(utcDay('2026-03-01'), -1))).toBe('2026-02-28');
  });
});
```

`tests/integration/api/investment-schema.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { PATCH } from '@/app/api/accounts/[id]/route';

describe('investment schema', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('stores balance history, securities, snapshots and investment transactions', async () => {
    const account = await testPrisma.account.create({
      data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' },
    });
    const day = new Date('2026-10-09T00:00:00.000Z');
    await testPrisma.accountBalance.create({
      data: { accountId: account.id, date: day, balance: 1000, currency: 'USD', source: 'plaid' },
    });
    const security = await testPrisma.security.create({
      data: { name: 'Test ETF', ticker: 'TETF', type: 'etf', currency: 'USD', pricing: 'feed', priceSymbol: 'TETF' },
    });
    await testPrisma.holdingSnapshot.create({
      data: { accountId: account.id, securityId: security.id, date: day, quantity: 2, price: 500, value: 1000, source: 'plaid' },
    });
    await testPrisma.investmentTransaction.create({
      data: {
        accountId: account.id, securityId: security.id, externalId: 'inv-1', date: day, type: 'buy',
        subtype: 'buy', name: 'BUY TETF', quantity: 2, price: 500, amount: 1000, currency: 'USD', source: 'plaid',
      },
    });

    await expect(
      testPrisma.accountBalance.create({
        data: { accountId: account.id, date: day, balance: 1, currency: 'USD', source: 'plaid' },
      })
    ).rejects.toThrow(); // unique (accountId, date)

    await testPrisma.account.delete({ where: { id: account.id } });
    expect(await testPrisma.accountBalance.count()).toBe(0); // cascades
    expect(await testPrisma.holdingSnapshot.count()).toBe(0);
    expect(await testPrisma.investmentTransaction.count()).toBe(0);
  });

  it('PATCH accepts trackingMode investment with a balanceSource', async () => {
    const account = await testPrisma.account.create({ data: createAccountData({ type: 'brokerage' }) });
    const req = new NextRequest(`http://localhost/api/accounts/${account.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ trackingMode: 'investment', balanceSource: 'manual' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: account.id }) });
    const body = await res.json();
    expect(body.trackingMode).toBe('investment');
    expect(body.balanceSource).toBe('manual');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/dates.test.ts tests/integration/api/investment-schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/investments/dates`; Prisma client has no `accountBalance`.

- [ ] **Step 3: Implement**

`src/lib/investments/dates.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight for a `YYYY-MM-DD` string or the UTC day of a Date. */
export function utcDay(input: string | Date): Date {
  if (typeof input === 'string') return new Date(`${input.slice(0, 10)}T00:00:00.000Z`);
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * DAY_MS);
}
```

`prisma/schema.prisma` — in `model Account`, change the `trackingMode` comment and add fields/relations:

```prisma
  trackingMode     String            @default("cash_flow")  // "cash_flow" | "balance_only" | "investment"
  balanceSource    String?           // investment accounts only: "provider" | "valuation" | "manual"
```

and add to Account's relation list:

```prisma
  balances                  AccountBalance[]
  holdingSnapshots          HoldingSnapshot[]
  investmentTransactions    InvestmentTransaction[]
```

In `model Transaction`, add after `splitParts`:

```prisma
  investmentLinks    InvestmentTransaction[] @relation("InvestmentTransferLink")
```

Append new models:

```prisma
// Balance history for investment accounts. One row per account per UTC day.
model AccountBalance {
  id        String   @id @default(uuid())
  accountId String
  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  date      DateTime // UTC midnight
  balance   Float
  currency  String
  source    String   // "plaid" | "valuation" | "manual"
  createdAt DateTime @default(now())

  @@unique([accountId, date])
  @@index([accountId])
}

model Security {
  id                  String                  @id @default(uuid())
  plaidSecurityId     String?                 @unique
  ticker              String?
  name                String
  type                String // "etf" | "equity" | "mutual_fund" | "money_market" | "cash" | "crypto" | "other"
  currency            String                  @default("USD")
  exchangeMic         String?
  priceSymbol         String? // price-provider symbol, e.g. "VIU.TO", "BTC-CAD"
  priceSymbolOverride Boolean                 @default(false)
  pricing             String // "feed" | "plaid" | "fixed" | "manual" | "none"
  fixedPrice          Float?
  createdAt           DateTime                @default(now())
  updatedAt           DateTime                @updatedAt
  prices              SecurityPrice[]
  events              SecurityEvent[]
  holdings            HoldingSnapshot[]
  transactions        InvestmentTransaction[]

  @@index([ticker])
}

model SecurityPrice {
  id         String   @id @default(uuid())
  securityId String
  security   Security @relation(fields: [securityId], references: [id], onDelete: Cascade)
  date       DateTime // UTC midnight
  close      Float // raw (unadjusted) close
  source     String // "yahoo" | "plaid" | "manual"
  createdAt  DateTime @default(now())

  @@unique([securityId, date, source])
}

model SecurityEvent {
  id         String   @id @default(uuid())
  securityId String
  security   Security @relation(fields: [securityId], references: [id], onDelete: Cascade)
  date       DateTime
  type       String // "dividend" | "split"
  amount     Float?
  ratio      Float?
  source     String
  createdAt  DateTime @default(now())

  @@unique([securityId, date, type])
}

model HoldingSnapshot {
  id         String   @id @default(uuid())
  accountId  String
  account    Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)
  securityId String
  security   Security @relation(fields: [securityId], references: [id])
  date       DateTime // UTC midnight
  quantity   Float
  price      Float
  value      Float
  costBasis  Float?
  source     String // "plaid" | "manual"
  createdAt  DateTime @default(now())

  @@unique([accountId, securityId, date])
  @@index([accountId, date])
}

model InvestmentTransaction {
  id                  String       @id @default(uuid())
  accountId           String
  account             Account      @relation(fields: [accountId], references: [id], onDelete: Cascade)
  securityId          String?
  security            Security?    @relation(fields: [securityId], references: [id], onDelete: SetNull)
  externalId          String?
  date                DateTime // UTC midnight
  type                String // Plaid verbatim: buy | sell | cancel | cash | fee | transfer
  subtype             String
  name                String
  quantity            Float?
  price               Float?
  amount              Float // Plaid sign: positive = cash leaves the account
  fees                Float?
  currency            String
  source              String // "plaid" | "manual" | "import"
  isCancelled         Boolean      @default(false)
  linkedTransactionId String?
  linkedTransaction   Transaction? @relation("InvestmentTransferLink", fields: [linkedTransactionId], references: [id], onDelete: SetNull)
  createdAt           DateTime     @default(now())

  @@unique([accountId, externalId])
  @@index([accountId, date])
  @@index([linkedTransactionId])
}
```

`src/lib/account-defaults.ts` — add (keep existing exports unchanged):

```ts
export const TRACKING_MODES = ['cash_flow', 'balance_only', 'investment'] as const;
export type TrackingMode = (typeof TRACKING_MODES)[number];

export const BALANCE_SOURCES = ['provider', 'valuation', 'manual'] as const;
export type BalanceSource = (typeof BALANCE_SOURCES)[number];
```

`src/app/api/accounts/[id]/route.ts` — replace the `trackingMode` line in `updateSchema` and add `balanceSource`:

```ts
import { TRACKING_MODES, BALANCE_SOURCES } from '@/lib/account-defaults';
// ...
  trackingMode: z.enum(TRACKING_MODES).optional(),
  balanceSource: z.enum(BALANCE_SOURCES).optional().nullable(),
```

`src/app/api/accounts/route.ts:13` — same change to its schema (`trackingMode: z.enum(TRACKING_MODES).optional(),` and `balanceSource: z.enum(BALANCE_SOURCES).optional().nullable(),`), and pass `balanceSource: parsed.balanceSource ?? null` into `prisma.account.create` data.

`tests/helpers/db.ts` — in `resetTestDb`, before `await prisma.transaction.deleteMany();` add:

```ts
  await prisma.investmentTransaction.deleteMany();
  await prisma.holdingSnapshot.deleteMany();
  await prisma.accountBalance.deleteMany();
  await prisma.securityEvent.deleteMany();
  await prisma.securityPrice.deleteMany();
  await prisma.security.deleteMany();
```

Apply schema: `npx prisma db push && npx prisma generate`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/dates.test.ts tests/integration/api/investment-schema.test.ts && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add prisma/schema.prisma src/lib/account-defaults.ts src/lib/investments/dates.ts \
  src/app/api/accounts/route.ts "src/app/api/accounts/[id]/route.ts" tests/helpers/db.ts \
  tests/unit/lib/investments/dates.test.ts tests/integration/api/investment-schema.test.ts
git commit -m "feat(investments): schema for balance history, securities, holdings, investment transactions"
```

---

### Task 2: Balance resolver

**Files:**
- Create: `src/lib/balances.ts`
- Test: `tests/unit/lib/balances.test.ts`

**Interfaces:**
- Consumes: Task 1 models.
- Produces:
  ```ts
  type ResolvedBalance = { balance: number; asOf: Date | null; source: 'transactions' | 'plaid' | 'valuation' | 'manual' };
  getAccountBalances(prisma: PrismaClient, accounts: { id: string; trackingMode: string }[]): Promise<Map<string, ResolvedBalance>>;
  getAccountBalance(prisma: PrismaClient, accountId: string): Promise<ResolvedBalance>;
  ```
  Balances are in the account's native currency.

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/balances.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import { getAccountBalances, getAccountBalance } from '@/lib/balances';

describe('balance resolver', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  async function cashAccount() {
    const a = await prisma.account.create({ data: createAccountData() });
    const tx = (amount: number, extra = {}) =>
      prisma.transaction.create({
        data: { accountId: a.id, date: new Date('2026-10-01'), amount, merchant: 'x', ...extra },
      });
    return { a, tx };
  }

  it('sums transactions for cash-flow accounts, excluding split parents', async () => {
    const { a, tx } = await cashAccount();
    await tx(100);
    await tx(-30);
    const parent = await tx(-50, { isSplitParent: true });
    await tx(-20, { parentTransactionId: parent.id });
    await tx(-30, { parentTransactionId: parent.id });
    const r = await getAccountBalance(prisma, a.id);
    expect(r).toEqual({ balance: 20, asOf: null, source: 'transactions' });
  });

  it('uses the latest AccountBalance for investment accounts', async () => {
    const a = await prisma.account.create({
      data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' },
    });
    for (const [d, b] of [['2026-10-01', 900], ['2026-10-08', 1100], ['2026-10-05', 1000]] as const) {
      await prisma.accountBalance.create({
        data: { accountId: a.id, date: new Date(`${d}T00:00:00Z`), balance: b, currency: 'USD', source: 'plaid' },
      });
    }
    const r = await getAccountBalance(prisma, a.id);
    expect(r.balance).toBe(1100);
    expect(r.asOf?.toISOString()).toBe('2026-10-08T00:00:00.000Z');
    expect(r.source).toBe('plaid');
  });

  it('ignores transactions for investment accounts', async () => {
    const a = await prisma.account.create({
      data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'manual' },
    });
    await prisma.transaction.create({
      data: { accountId: a.id, date: new Date('2026-10-01'), amount: 999, merchant: 'Balance Adjustment' },
    });
    await prisma.accountBalance.create({
      data: { accountId: a.id, date: new Date('2026-10-02T00:00:00Z'), balance: 50, currency: 'USD', source: 'manual' },
    });
    expect((await getAccountBalance(prisma, a.id)).balance).toBe(50);
  });

  it('returns 0 with null asOf for an investment account with no history', async () => {
    const a = await prisma.account.create({
      data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' },
    });
    expect(await getAccountBalance(prisma, a.id)).toEqual({ balance: 0, asOf: null, source: 'plaid' });
  });

  it('resolves a mixed batch', async () => {
    const { a: cash, tx } = await cashAccount();
    await tx(10);
    const inv = await prisma.account.create({
      data: { ...createAccountData({ type: 'retirement' }), trackingMode: 'investment', balanceSource: 'manual' },
    });
    await prisma.accountBalance.create({
      data: { accountId: inv.id, date: new Date('2026-10-02T00:00:00Z'), balance: 77, currency: 'USD', source: 'manual' },
    });
    const map = await getAccountBalances(prisma, [
      { id: cash.id, trackingMode: 'cash_flow' },
      { id: inv.id, trackingMode: 'investment' },
    ]);
    expect(map.get(cash.id)?.balance).toBe(10);
    expect(map.get(inv.id)?.balance).toBe(77);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/balances.test.ts`
Expected: FAIL — cannot resolve `@/lib/balances`.

- [ ] **Step 3: Implement**

`src/lib/balances.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

export type ResolvedBalance = {
  balance: number;
  asOf: Date | null;
  source: 'transactions' | 'plaid' | 'valuation' | 'manual';
};

const SOURCE_FOR_EMPTY: Record<string, ResolvedBalance['source']> = {
  provider: 'plaid',
  valuation: 'valuation',
  manual: 'manual',
};

/**
 * Resolve native-currency balances. Investment accounts read their latest AccountBalance row
 * (their Transaction rows, if any, are ignored); every other account sums its transactions,
 * excluding split parents (their parts carry the amounts).
 */
export async function getAccountBalances(
  prisma: PrismaClient,
  accounts: { id: string; trackingMode: string }[]
): Promise<Map<string, ResolvedBalance>> {
  const result = new Map<string, ResolvedBalance>();
  const investmentIds = accounts.filter((a) => a.trackingMode === 'investment').map((a) => a.id);
  const ledgerIds = accounts.filter((a) => a.trackingMode !== 'investment').map((a) => a.id);

  if (ledgerIds.length) {
    const sums = await prisma.transaction.groupBy({
      by: ['accountId'],
      _sum: { amount: true },
      where: { accountId: { in: ledgerIds }, isSplitParent: false },
    });
    const byId = new Map(sums.map((s) => [s.accountId, s._sum.amount ?? 0]));
    for (const id of ledgerIds) {
      result.set(id, { balance: byId.get(id) ?? 0, asOf: null, source: 'transactions' });
    }
  }

  if (investmentIds.length) {
    const latest = await prisma.accountBalance.findMany({
      where: { accountId: { in: investmentIds } },
      orderBy: { date: 'desc' },
      distinct: ['accountId'],
    });
    const byId = new Map(latest.map((r) => [r.accountId, r]));
    const meta = await prisma.account.findMany({
      where: { id: { in: investmentIds } },
      select: { id: true, balanceSource: true },
    });
    for (const { id, balanceSource } of meta) {
      const row = byId.get(id);
      result.set(
        id,
        row
          ? { balance: row.balance, asOf: row.date, source: row.source as ResolvedBalance['source'] }
          : { balance: 0, asOf: null, source: SOURCE_FOR_EMPTY[balanceSource ?? 'manual'] ?? 'manual' }
      );
    }
  }

  return result;
}

export async function getAccountBalance(
  prisma: PrismaClient,
  accountId: string
): Promise<ResolvedBalance> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { id: true, trackingMode: true },
  });
  const map = await getAccountBalances(prisma, [account]);
  return map.get(accountId)!;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/balances.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/balances.ts tests/unit/lib/balances.test.ts
git commit -m "feat(investments): balance resolver for ledger and investment accounts"
```

---

### Task 3: Route every balance call site through the resolver

**Files:**
- Modify: `src/app/api/accounts/balances/route.ts:16-58`
- Modify: `src/app/api/snapshots/route.ts:149-173`
- Modify: `src/lib/goals.ts:74-82`
- Modify: `src/lib/agent/tools.ts:114-138`
- Test: `tests/integration/api/balance-call-sites.test.ts`

**Interfaces:**
- Consumes: `getAccountBalances`, `getAccountBalance` (Task 2).
- Produces: no new exports; existing response shapes unchanged.

- [ ] **Step 1: Write the failing test**

`tests/integration/api/balance-call-sites.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { GET as getBalances } from '@/app/api/accounts/balances/route';
import { POST as postSnapshot } from '@/app/api/snapshots/route';
import { calculateGoalProgress } from '@/lib/goals';
import { executeGetAccountBalances } from '@/lib/agent/tools';

describe('balance call sites use the resolver', () => {
  let investmentId: string;
  let checkingId: string;

  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    const inv = await testPrisma.account.create({
      data: { ...createAccountData({ name: 'Brokerage', type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' },
    });
    investmentId = inv.id;
    await testPrisma.accountBalance.create({
      data: { accountId: inv.id, date: new Date('2026-10-09T00:00:00Z'), balance: 5000, currency: 'USD', source: 'plaid' },
    });
    // stray legacy row that must be ignored
    await testPrisma.transaction.create({
      data: { accountId: inv.id, date: new Date('2026-01-01'), amount: 123, merchant: 'Balance Adjustment' },
    });
    const chk = await testPrisma.account.create({ data: createAccountData({ name: 'Checking' }) });
    checkingId = chk.id;
    const parent = await testPrisma.transaction.create({
      data: { accountId: chk.id, date: new Date('2026-10-01'), amount: -100, merchant: 'split', isSplitParent: true },
    });
    await testPrisma.transaction.create({
      data: { accountId: chk.id, date: new Date('2026-10-01'), amount: -100, merchant: 'part', parentTransactionId: parent.id },
    });
    await testPrisma.transaction.create({
      data: { accountId: chk.id, date: new Date('2026-10-01'), amount: 1000, merchant: 'pay' },
    });
  });

  it('accounts/balances reports resolver balances', async () => {
    const body = await (await getBalances()).json();
    const byId = Object.fromEntries(body.accounts.map((a: { id: string; balance: number }) => [a.id, a.balance]));
    expect(byId[investmentId]).toBe(5000);
    expect(byId[checkingId]).toBe(900);
  });

  it('snapshot POST stores resolver balances (split parents not double counted)', async () => {
    const req = new NextRequest('http://localhost/api/snapshots', { method: 'POST', body: JSON.stringify({}) });
    const body = await (await postSnapshot(req)).json();
    expect(body.snapshot.accountBalances[investmentId].balance).toBe(5000);
    expect(body.snapshot.accountBalances[checkingId].balance).toBe(900);
  });

  it('account goals use the resolver', async () => {
    const goal = await testPrisma.goal.create({
      data: { name: 'g', type: 'saving', targetAmount: 10000, trackingMethod: 'account', accountId: investmentId },
    });
    expect((await calculateGoalProgress(goal, testPrisma)).currentAmount).toBe(5000);
  });

  it('agent balance tool uses the resolver', async () => {
    const rows = await executeGetAccountBalances(testPrisma);
    expect(rows.find((r) => r.name === 'Brokerage')?.balance).toBe(5000);
    expect(rows.find((r) => r.name === 'Checking')?.balance).toBe(900);
  });
});
```

(`calculateGoalProgress(goal, prisma, now?)` returns `{ currentAmount, percentage, remaining, paceStatus }`; `POST /api/snapshots` with `{}` runs standard mode.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/api/balance-call-sites.test.ts`
Expected: FAIL — investment balance reported as 123 (transaction sum); snapshot checking balance 800 (split parent double counted); agent tool 800.

- [ ] **Step 3: Implement**

`src/app/api/accounts/balances/route.ts` — add `trackingMode: true` to the account `select`, delete the `prisma.transaction.groupBy` block and `balanceMap`, and replace with:

```ts
import { getAccountBalances } from '@/lib/balances';
// ...
  const resolved = await getAccountBalances(prisma, accounts);

  const accountBalances = accounts.map((account) => {
    const balance = resolved.get(account.id)?.balance ?? 0;
    // ...rest of the existing map body unchanged (conversion, return shape)
```

`src/app/api/snapshots/route.ts` (standard mode) — replace the `findMany` with `include: { transactions: ... }` and the per-account `reduce` with:

```ts
import { getAccountBalances } from '@/lib/balances';
// ...
  const accounts = await prisma.account.findMany({ where: { isActive: true } });
  const resolved = await getAccountBalances(prisma, accounts);
  // ...
  for (const account of accounts) {
    const balance = resolved.get(account.id)?.balance ?? 0;
    // ...rest unchanged
```

`src/lib/goals.ts` — replace `calculateAccountProgress` body:

```ts
import { getAccountBalance } from '@/lib/balances';
// ...
async function calculateAccountProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  const { balance } = await getAccountBalance(prisma, goal.accountId!);
  return Math.abs(balance);
}
```

`src/lib/agent/tools.ts` — replace `executeGetAccountBalances` body:

```ts
import { getAccountBalances } from '@/lib/balances';
// ...
  const accounts = await prisma.account.findMany({
    where: { isActive: true },
    select: { id: true, name: true, type: true, institution: true, currency: true, trackingMode: true },
  });
  const resolved = await getAccountBalances(prisma, accounts);
  return accounts.map((a) => ({
    name: a.name,
    type: a.type,
    institution: a.institution,
    currency: a.currency,
    balance: resolved.get(a.id)?.balance ?? 0,
  }));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/api/balance-call-sites.test.ts && npx vitest run tests/unit/lib/goals.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/app/api/accounts/balances/route.ts src/app/api/snapshots/route.ts src/lib/goals.ts \
  src/lib/agent/tools.ts tests/integration/api/balance-call-sites.test.ts
git commit -m "feat(investments): route all balance calculations through the resolver

Also fixes split parents being double counted in net-worth snapshots and the agent balance tool."
```

---

### Task 4: Reconcile Balance writes balance history for investment accounts

**Files:**
- Modify: `src/app/api/transactions/adjustment/route.ts`
- Test: `tests/integration/api/investment-adjustment.test.ts`

**Interfaces:**
- Consumes: `getAccountBalance` (Task 2), `utcDay` (Task 1).
- Produces: For `trackingMode === 'investment'`, `POST /api/transactions/adjustment { accountId, amount }` upserts today's `AccountBalance` (`source: 'manual'`, `balance = current + amount`) and returns `{ accountBalance }` with status 200. Non-investment accounts unchanged.

- [ ] **Step 1: Write the failing test**

`tests/integration/api/investment-adjustment.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { POST } from '@/app/api/transactions/adjustment/route';

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/transactions/adjustment', { method: 'POST', body: JSON.stringify(body) }));

describe('adjustment route for investment accounts', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('records a manual AccountBalance instead of a transaction', async () => {
    const a = await testPrisma.account.create({
      data: { ...createAccountData({ type: 'retirement', currency: 'CAD' }), trackingMode: 'investment', balanceSource: 'manual' },
    });
    await testPrisma.accountBalance.create({
      data: { accountId: a.id, date: new Date('2026-07-12T00:00:00Z'), balance: 1000, currency: 'CAD', source: 'manual' },
    });
    const res = await post({ accountId: a.id, amount: 250 });
    expect(res.status).toBe(200);
    expect(await testPrisma.transaction.count({ where: { accountId: a.id } })).toBe(0);
    const rows = await testPrisma.accountBalance.findMany({ where: { accountId: a.id }, orderBy: { date: 'desc' } });
    expect(rows[0].balance).toBe(1250);
    expect(rows[0].source).toBe('manual');
    expect(rows[0].currency).toBe('CAD');
  });

  it('reconciling twice on the same day overwrites that day', async () => {
    const a = await testPrisma.account.create({
      data: { ...createAccountData({ type: 'crypto' }), trackingMode: 'investment', balanceSource: 'manual' },
    });
    await post({ accountId: a.id, amount: 100 });
    await post({ accountId: a.id, amount: 50 });
    const rows = await testPrisma.accountBalance.findMany({ where: { accountId: a.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].balance).toBe(150);
  });

  it('still creates an adjustment transaction for cash-flow accounts', async () => {
    const a = await testPrisma.account.create({ data: createAccountData() });
    await post({ accountId: a.id, amount: 10 });
    expect(await testPrisma.transaction.count({ where: { accountId: a.id } })).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/api/investment-adjustment.test.ts`
Expected: FAIL — a transaction is created for the investment account.

- [ ] **Step 3: Implement**

In `src/app/api/transactions/adjustment/route.ts`, after the "Verify account exists" block and before the category lookup, insert:

```ts
import { getAccountBalance } from '@/lib/balances';
import { utcDay } from '@/lib/investments/dates';
// ...
    // Investment accounts keep balances in AccountBalance, never in the transaction ledger.
    if (account.trackingMode === 'investment') {
      const { balance } = await getAccountBalance(prisma, accountId);
      const date = utcDay(new Date());
      const accountBalance = await prisma.accountBalance.upsert({
        where: { accountId_date: { accountId, date } },
        create: { accountId, date, balance: balance + amount, currency: account.currency, source: 'manual' },
        update: { balance: balance + amount, source: 'manual' },
      });
      return NextResponse.json({ accountBalance });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/api/investment-adjustment.test.ts tests/integration/api/transaction-adjustment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/app/api/transactions/adjustment/route.ts tests/integration/api/investment-adjustment.test.ts
git commit -m "feat(investments): reconcile investment accounts via balance history"
```

---

### Task 5: Plaid → model mappers

**Files:**
- Create: `src/lib/investments/plaid-mapping.ts`
- Test: `tests/unit/lib/investments/plaid-mapping.test.ts`

**Interfaces:**
- Consumes: `utcDay` (Task 1).
- Produces:
  ```ts
  type SecurityType = 'etf' | 'equity' | 'mutual_fund' | 'money_market' | 'cash' | 'crypto' | 'other';
  type Pricing = 'feed' | 'plaid' | 'fixed' | 'manual' | 'none';
  type MappedSecurity = { plaidSecurityId: string; ticker: string | null; name: string; type: SecurityType; currency: string; exchangeMic: string | null; priceSymbol: string | null; pricing: Pricing; fixedPrice: number | null };
  type MappedHolding = { plaidSecurityId: string; quantity: number; price: number; value: number; costBasis: number | null };
  type MappedInvestmentTransaction = { externalId: string; plaidSecurityId: string | null; date: Date; type: string; subtype: string; name: string; quantity: number | null; price: number | null; amount: number; fees: number | null; currency: string; cancelsExternalId: string | null };
  mapSecurity(s: PlaidSecurity): MappedSecurity;
  mapHolding(h: Holding): MappedHolding;
  mapInvestmentTransaction(t: PlaidInvestmentTransaction): MappedInvestmentTransaction;
  mapCashTransaction(t: PlaidTransaction): MappedInvestmentTransaction | null; // null for pending
  ```

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/investments/plaid-mapping.test.ts` (synthetic data only):

```ts
import { describe, it, expect } from 'vitest';
import type { Security, Holding, InvestmentTransaction, Transaction } from 'plaid';
import {
  mapSecurity,
  mapHolding,
  mapInvestmentTransaction,
  mapCashTransaction,
} from '@/lib/investments/plaid-mapping';

const sec = (o: Partial<Security>): Security =>
  ({
    security_id: 'sec-1', name: 'Test', ticker_symbol: null, type: 'etf', is_cash_equivalent: false,
    iso_currency_code: 'USD', market_identifier_code: null, close_price: null, ...o,
  }) as unknown as Security;

describe('mapSecurity', () => {
  it('maps a US-listed ETF to a feed symbol equal to its ticker', () => {
    const m = mapSecurity(sec({ ticker_symbol: 'TETF', market_identifier_code: 'ARCX' }));
    expect(m).toMatchObject({ type: 'etf', pricing: 'feed', priceSymbol: 'TETF', fixedPrice: null });
  });

  it('adds the .TO suffix for Toronto listings', () => {
    const m = mapSecurity(sec({ ticker_symbol: 'TCAD', market_identifier_code: 'XTSE', iso_currency_code: 'CAD' }));
    expect(m.priceSymbol).toBe('TCAD.TO');
    expect(m.currency).toBe('CAD');
  });

  it('fixes cash and cash-equivalent funds at 1.00', () => {
    expect(mapSecurity(sec({ type: 'cash', ticker_symbol: 'CUR:USD' }))).toMatchObject({ type: 'cash', pricing: 'fixed', fixedPrice: 1 });
    expect(mapSecurity(sec({ type: 'mutual fund', ticker_symbol: 'TMMXX', is_cash_equivalent: true }))).toMatchObject({
      type: 'money_market', pricing: 'fixed', fixedPrice: 1,
    });
  });

  it('uses Plaid pricing for non-public identifiers', () => {
    expect(mapSecurity(sec({ type: 'equity', ticker_symbol: 'PLAN.FUND.2060' })).pricing).toBe('plaid');
    expect(mapSecurity(sec({ type: 'equity', ticker_symbol: null })).pricing).toBe('plaid');
  });

  it('maps crypto to a TICKER-CCY symbol', () => {
    expect(mapSecurity(sec({ type: 'cryptocurrency', ticker_symbol: 'BTC', iso_currency_code: 'CAD' }))).toMatchObject({
      type: 'crypto', pricing: 'feed', priceSymbol: 'BTC-CAD',
    });
  });

  it('maps mutual funds without the cash flag to mutual_fund', () => {
    expect(mapSecurity(sec({ type: 'mutual fund', ticker_symbol: 'TFUNX' })).type).toBe('mutual_fund');
  });
});

describe('mapHolding', () => {
  it('maps institution price/value and nullable cost basis', () => {
    const h = { account_id: 'a', security_id: 'sec-1', quantity: 2, institution_price: 10, institution_value: 20, cost_basis: null } as unknown as Holding;
    expect(mapHolding(h)).toEqual({ plaidSecurityId: 'sec-1', quantity: 2, price: 10, value: 20, costBasis: null });
  });
});

describe('mapInvestmentTransaction', () => {
  it('keeps Plaid type, subtype and sign; parses the date to UTC midnight', () => {
    const t = {
      investment_transaction_id: 'it-1', account_id: 'a', security_id: 'sec-1', date: '2026-09-30', name: 'DIVIDEND',
      quantity: 0, price: 1, amount: -22.28, fees: 0, type: 'cash', subtype: 'dividend', iso_currency_code: 'USD',
      cancel_transaction_id: null,
    } as unknown as InvestmentTransaction;
    expect(mapInvestmentTransaction(t)).toEqual({
      externalId: 'it-1', plaidSecurityId: 'sec-1', date: new Date('2026-09-30T00:00:00.000Z'), type: 'cash',
      subtype: 'dividend', name: 'DIVIDEND', quantity: 0, price: 1, amount: -22.28, fees: 0, currency: 'USD',
      cancelsExternalId: null,
    });
  });

  it('exposes the cancelled transaction id', () => {
    const t = { investment_transaction_id: 'it-2', security_id: null, date: '2026-09-30', name: 'CANCEL', quantity: 0,
      price: 0, amount: 10, fees: null, type: 'cancel', subtype: 'cancel', iso_currency_code: 'USD',
      cancel_transaction_id: 'it-1' } as unknown as InvestmentTransaction;
    expect(mapInvestmentTransaction(t).cancelsExternalId).toBe('it-1');
  });
});

describe('mapCashTransaction', () => {
  it('maps a posted depository transaction to a cash investment transaction', () => {
    const t = { transaction_id: 'tx-1', account_id: 'a', date: '2026-09-15', name: 'TRANSFERRED FROM BANK',
      amount: -500, iso_currency_code: 'USD', pending: false,
      personal_finance_category: { primary: 'TRANSFER_IN', detailed: 'TRANSFER_IN_ACCOUNT_TRANSFER' } } as unknown as Transaction;
    expect(mapCashTransaction(t)).toMatchObject({ externalId: 'tx-1', type: 'cash', subtype: 'transfer_in', amount: -500, plaidSecurityId: null });
  });

  it('skips pending transactions', () => {
    expect(mapCashTransaction({ transaction_id: 'p', pending: true } as unknown as Transaction)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/investments/plaid-mapping.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/investments/plaid-mapping.ts`:

```ts
import type {
  Security as PlaidSecurity,
  Holding,
  InvestmentTransaction as PlaidInvestmentTransaction,
  Transaction as PlaidTransaction,
} from 'plaid';
import { utcDay } from './dates';

export type SecurityType = 'etf' | 'equity' | 'mutual_fund' | 'money_market' | 'cash' | 'crypto' | 'other';
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

export function mapInvestmentTransaction(t: PlaidInvestmentTransaction): MappedInvestmentTransaction {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/investments/plaid-mapping.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/plaid-mapping.ts tests/unit/lib/investments/plaid-mapping.test.ts
git commit -m "feat(investments): map Plaid securities, holdings and investment transactions"
```

---

### Task 6: Plaid investment sync

**Files:**
- Create: `src/lib/investments/plaid-investment-sync.ts`
- Test: `tests/unit/lib/investments/plaid-investment-sync.test.ts`

**Interfaces:**
- Consumes: mappers (Task 5), `utcDay/addDays` (Task 1), `getPlaidClient` (`@/lib/plaid`), `decryptAccessToken` (`@/lib/encryption`), `classifyPlaidError` (`@/lib/bank-errors`), `retryWithBackoff`/`RateLimitError` (`@/lib/sync-common`), `linkInvestmentTransfers` (Task 7 — **call it through a dynamic `import()` in this task's linking step so Task 6 compiles before Task 7 exists; Task 7 replaces it with a static import**).
- Produces:
  ```ts
  type StepStatus = 'ok' | 'pending' | 'error' | 'skipped';
  type InvestmentStep = 'balance' | 'holdings' | 'transactions' | 'linking';
  type InvestmentSyncResult = {
    accountId: string;
    steps: Record<InvestmentStep, StepStatus>;
    errors: Partial<Record<InvestmentStep, string>>;
    counts: { holdings: number; transactions: number; cancelled: number; linked: number };
  };
  type InvestmentConnection = {
    accountId: string;
    plaidAccountId: string;
    plaidAccountType: string | null;
    account: { id: string; currency: string };
    plaidEnrollment: { accessTokenEncrypted: string; accessTokenIv: string };
  };
  syncPlaidInvestments(conn: InvestmentConnection, opts?: { now?: Date }): Promise<InvestmentSyncResult>;
  ```
  Throws only for re-auth errors (`classifyPlaidError(e).needsReauth`), so the route's existing reauth handling applies.

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/investments/plaid-investment-sync.test.ts`:

```ts
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
import { syncPlaidInvestments, type InvestmentConnection } from '@/lib/investments/plaid-investment-sync';

const NOW = new Date('2026-10-09T15:00:00Z');
const TODAY = '2026-10-09T00:00:00.000Z';

const SEC_ETF = { security_id: 's-etf', name: 'Test ETF', ticker_symbol: 'TETF', type: 'etf', is_cash_equivalent: false, iso_currency_code: 'USD', market_identifier_code: 'ARCX', close_price: 100 };
const SEC_OLD = { security_id: 's-old', name: 'Sold Fund', ticker_symbol: 'TOLD', type: 'etf', is_cash_equivalent: false, iso_currency_code: 'USD', market_identifier_code: 'ARCX', close_price: 50 };

function plaidMock(over: Record<string, unknown> = {}) {
  const client = {
    accountsGet: vi.fn(async () => ({ data: { accounts: [{ account_id: 'pa-1', balances: { current: 1234.5, iso_currency_code: 'USD' } }] } })),
    investmentsHoldingsGet: vi.fn(async () => ({
      data: { holdings: [{ account_id: 'pa-1', security_id: 's-etf', quantity: 10, institution_price: 100, institution_value: 1000, cost_basis: 800 }], securities: [SEC_ETF] },
    })),
    investmentsTransactionsGet: vi.fn(async () => ({
      data: {
        total_investment_transactions: 2,
        securities: [SEC_ETF, SEC_OLD],
        investment_transactions: [
          { investment_transaction_id: 'it-1', account_id: 'pa-1', security_id: 's-old', date: '2026-09-01', name: 'SELL TOLD', quantity: -5, price: 50, amount: -250, fees: 0, type: 'sell', subtype: 'sell', iso_currency_code: 'USD', cancel_transaction_id: null },
          { investment_transaction_id: 'it-2', account_id: 'pa-1', security_id: 's-etf', date: '2026-09-02', name: 'BUY TETF', quantity: 2, price: 100, amount: 200, fees: 0, type: 'buy', subtype: 'buy', iso_currency_code: 'USD', cancel_transaction_id: null },
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
      data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' },
    });
    conn = { accountId: a.id, plaidAccountId: 'pa-1', plaidAccountType: 'investment', account: { id: a.id, currency: 'USD' }, plaidEnrollment: { accessTokenEncrypted: 'e', accessTokenIv: 'iv' } };
  });

  it('records balance, holdings snapshot, Plaid price and transactions', async () => {
    plaidMock();
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.steps).toMatchObject({ balance: 'ok', holdings: 'ok', transactions: 'ok' });
    const bal = await testPrisma.accountBalance.findFirstOrThrow({ where: { accountId: conn.accountId } });
    expect(bal).toMatchObject({ balance: 1234.5, source: 'plaid' });
    expect(bal.date.toISOString()).toBe(TODAY);
    const snap = await testPrisma.holdingSnapshot.findMany({ where: { accountId: conn.accountId }, include: { security: true } });
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({ quantity: 10, price: 100, value: 1000, costBasis: 800, source: 'plaid' });
    expect(snap[0].security).toMatchObject({ ticker: 'TETF', priceSymbol: 'TETF', pricing: 'feed' });
    expect(await testPrisma.securityPrice.count({ where: { source: 'plaid' } })).toBe(1);
    expect(await testPrisma.investmentTransaction.count({ where: { accountId: conn.accountId } })).toBe(2);
  });

  it('upserts securities that appear only in transactions', async () => {
    plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    const sold = await testPrisma.investmentTransaction.findFirstOrThrow({ where: { externalId: 'it-1' }, include: { security: true } });
    expect(sold.security?.ticker).toBe('TOLD');
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
    plaidMock({ investmentsHoldingsGet: vi.fn(async () => ({ data: { holdings: [], securities: [] } })) });
    await syncPlaidInvestments(conn, { now: NOW });
    expect(await testPrisma.holdingSnapshot.count()).toBe(0);
  });

  it('marks cancelled transactions', async () => {
    plaidMock({
      investmentsTransactionsGet: vi.fn(async () => ({
        data: {
          total_investment_transactions: 2,
          securities: [SEC_ETF],
          investment_transactions: [
            { investment_transaction_id: 'it-9', security_id: 's-etf', date: '2026-09-02', name: 'BUY', quantity: 1, price: 100, amount: 100, fees: 0, type: 'buy', subtype: 'buy', iso_currency_code: 'USD', cancel_transaction_id: null },
            { investment_transaction_id: 'it-10', security_id: 's-etf', date: '2026-09-03', name: 'CANCEL', quantity: -1, price: 100, amount: -100, fees: 0, type: 'cancel', subtype: 'cancel', iso_currency_code: 'USD', cancel_transaction_id: 'it-9' },
          ],
        },
      })),
    });
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.counts.cancelled).toBe(1);
    expect((await testPrisma.investmentTransaction.findFirstOrThrow({ where: { externalId: 'it-9' } })).isCancelled).toBe(true);
  });

  it('marks a step pending on PRODUCT_NOT_READY and still records the balance', async () => {
    const notReady = Object.assign(new Error('not ready'), { response: { data: { error_code: 'PRODUCT_NOT_READY', error_message: 'not ready' } } });
    plaidMock({ investmentsHoldingsGet: vi.fn(async () => { throw notReady; }) });
    const r = await syncPlaidInvestments(conn, { now: NOW });
    expect(r.steps.holdings).toBe('pending');
    expect(r.steps.balance).toBe('ok');
  });

  it('rethrows re-auth errors', async () => {
    const reauth = Object.assign(new Error('login'), { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' } } });
    plaidMock({ accountsGet: vi.fn(async () => { throw reauth; }) });
    await expect(syncPlaidInvestments(conn, { now: NOW })).rejects.toBe(reauth);
  });

  it('syncs depository investment accounts from the Transactions product', async () => {
    const client = plaidMock({
      transactionsGet: vi.fn(async () => ({
        data: { total_transactions: 1, transactions: [{ transaction_id: 'tx-1', account_id: 'pa-1', date: '2026-09-15', name: 'TRANSFER IN', amount: -500, iso_currency_code: 'USD', pending: false, personal_finance_category: { primary: 'TRANSFER_IN' } }] },
      })),
    });
    const r = await syncPlaidInvestments({ ...conn, plaidAccountType: 'depository' }, { now: NOW });
    expect(client.investmentsHoldingsGet).not.toHaveBeenCalled();
    expect(client.investmentsTransactionsGet).not.toHaveBeenCalled();
    expect(r.steps.holdings).toBe('skipped');
    expect(await testPrisma.investmentTransaction.findFirstOrThrow({ where: { externalId: 'tx-1' } })).toMatchObject({ type: 'cash', amount: -500 });
    expect(await testPrisma.transaction.count()).toBe(0);
  });

  it('requests 24 months on the first sync and last-date − 30 days afterwards', async () => {
    const client = plaidMock();
    await syncPlaidInvestments(conn, { now: NOW });
    expect(client.investmentsTransactionsGet.mock.calls[0][0]).toMatchObject({ start_date: '2024-10-09', end_date: '2026-10-09' });
    await syncPlaidInvestments(conn, { now: NOW });
    expect(client.investmentsTransactionsGet.mock.calls[1][0]).toMatchObject({ start_date: '2026-08-03' }); // 2026-09-02 − 30d
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/investments/plaid-investment-sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/investments/plaid-investment-sync.ts`:

```ts
import type { PlaidApi, Security as PlaidSecurity } from 'plaid';
import { prisma } from '@/lib/prisma';
import { getPlaidClient } from '@/lib/plaid';
import { decryptAccessToken } from '@/lib/encryption';
import { classifyPlaidError } from '@/lib/bank-errors';
import { retryWithBackoff, RateLimitError } from '@/lib/sync-common';
import { utcDay, addDays, isoDay } from './dates';
import {
  mapSecurity,
  mapHolding,
  mapInvestmentTransaction,
  mapCashTransaction,
  type MappedInvestmentTransaction,
} from './plaid-mapping';

export type StepStatus = 'ok' | 'pending' | 'error' | 'skipped';
export type InvestmentStep = 'balance' | 'holdings' | 'transactions' | 'linking';

export type InvestmentSyncResult = {
  accountId: string;
  steps: Record<InvestmentStep, StepStatus>;
  errors: Partial<Record<InvestmentStep, string>>;
  counts: { holdings: number; transactions: number; cancelled: number; linked: number };
};

export type InvestmentConnection = {
  accountId: string;
  plaidAccountId: string;
  plaidAccountType: string | null;
  account: { id: string; currency: string };
  plaidEnrollment: { accessTokenEncrypted: string; accessTokenIv: string };
};

const FIRST_SYNC_DAYS = 730; // Plaid's investment-transaction maximum (24 months)
const OVERLAP_DAYS = 30;
const PAGE = 500;

async function plaidCall<T>(fn: () => Promise<T>): Promise<T> {
  return retryWithBackoff(async () => {
    try {
      return await fn();
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 429) throw new RateLimitError('Plaid API rate limited (429)', 5000);
      throw error;
    }
  });
}

async function upsertSecurities(securities: PlaidSecurity[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const s of securities) {
    const m = mapSecurity(s);
    const existing = await prisma.security.findUnique({ where: { plaidSecurityId: m.plaidSecurityId } });
    const descriptive = { ticker: m.ticker, name: m.name, type: m.type, currency: m.currency, exchangeMic: m.exchangeMic };
    if (existing) {
      // Never clobber a user-set price symbol; pricing follows the symbol.
      const pricingFields = existing.priceSymbolOverride
        ? {}
        : { priceSymbol: m.priceSymbol, pricing: m.pricing, fixedPrice: m.fixedPrice };
      await prisma.security.update({ where: { id: existing.id }, data: { ...descriptive, ...pricingFields } });
      ids.set(m.plaidSecurityId, existing.id);
    } else {
      const created = await prisma.security.create({
        data: { plaidSecurityId: m.plaidSecurityId, ...descriptive, priceSymbol: m.priceSymbol, pricing: m.pricing, fixedPrice: m.fixedPrice },
      });
      ids.set(m.plaidSecurityId, created.id);
    }
  }
  return ids;
}

async function upsertInvestmentTransactions(
  accountId: string,
  rows: MappedInvestmentTransaction[],
  securityIds: Map<string, string>
): Promise<{ upserted: number; cancelled: number }> {
  for (const r of rows) {
    const data = {
      securityId: r.plaidSecurityId ? (securityIds.get(r.plaidSecurityId) ?? null) : null,
      date: r.date,
      type: r.type,
      subtype: r.subtype,
      name: r.name,
      quantity: r.quantity,
      price: r.price,
      amount: r.amount,
      fees: r.fees,
      currency: r.currency,
      source: 'plaid',
    };
    await prisma.investmentTransaction.upsert({
      where: { accountId_externalId: { accountId, externalId: r.externalId } },
      create: { accountId, externalId: r.externalId, ...data },
      update: data,
    });
  }
  const cancelIds = rows.map((r) => r.cancelsExternalId).filter((x): x is string => !!x);
  const cancelled = cancelIds.length
    ? (await prisma.investmentTransaction.updateMany({
        where: { accountId, externalId: { in: cancelIds } },
        data: { isCancelled: true },
      })).count
    : 0;
  return { upserted: rows.length, cancelled };
}

async function transactionWindowStart(accountId: string, today: Date): Promise<Date> {
  const latest = await prisma.investmentTransaction.findFirst({
    where: { accountId, source: 'plaid' },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  return latest ? addDays(latest.date, -OVERLAP_DAYS) : addDays(today, -FIRST_SYNC_DAYS);
}

export async function syncPlaidInvestments(
  conn: InvestmentConnection,
  opts: { now?: Date } = {}
): Promise<InvestmentSyncResult> {
  const now = opts.now ?? new Date();
  const today = utcDay(now);
  const plaid: PlaidApi = getPlaidClient();
  const access_token = decryptAccessToken(conn.plaidEnrollment.accessTokenEncrypted, conn.plaidEnrollment.accessTokenIv);
  const account_ids = [conn.plaidAccountId];
  const isDepository = conn.plaidAccountType === 'depository';
  const accountId = conn.accountId;

  const result: InvestmentSyncResult = {
    accountId,
    steps: { balance: 'skipped', holdings: 'skipped', transactions: 'skipped', linking: 'skipped' },
    errors: {},
    counts: { holdings: 0, transactions: 0, cancelled: 0, linked: 0 },
  };

  async function runStep(step: InvestmentStep, fn: () => Promise<void>) {
    try {
      await fn();
      result.steps[step] = 'ok';
    } catch (error) {
      const { needsReauth, code, reason } = classifyPlaidError(error);
      if (needsReauth) throw error;
      result.steps[step] = code === 'PRODUCT_NOT_READY' ? 'pending' : 'error';
      result.errors[step] = reason;
      if (result.steps[step] === 'error') console.error(`[investments] ${step} failed: ${reason}`);
    }
  }

  await runStep('balance', async () => {
    const res = await plaidCall(() => plaid.accountsGet({ access_token, options: { account_ids } }));
    const acct = res.data.accounts.find((a) => a.account_id === conn.plaidAccountId);
    if (!acct || acct.balances.current == null) throw new Error('Plaid returned no current balance');
    await prisma.accountBalance.upsert({
      where: { accountId_date: { accountId, date: today } },
      create: { accountId, date: today, balance: acct.balances.current, currency: conn.account.currency, source: 'plaid' },
      update: { balance: acct.balances.current, source: 'plaid' },
    });
  });

  if (!isDepository) {
    await runStep('holdings', async () => {
      const res = await plaidCall(() => plaid.investmentsHoldingsGet({ access_token, options: { account_ids } }));
      const holdings = res.data.holdings.filter((h) => h.account_id === conn.plaidAccountId).map(mapHolding);
      const securityIds = await upsertSecurities(res.data.securities);
      await prisma.$transaction([
        prisma.holdingSnapshot.deleteMany({ where: { accountId, date: today } }),
        ...holdings
          .filter((h) => securityIds.has(h.plaidSecurityId))
          .map((h) =>
            prisma.holdingSnapshot.create({
              data: {
                accountId, securityId: securityIds.get(h.plaidSecurityId)!, date: today, quantity: h.quantity,
                price: h.price, value: h.value, costBasis: h.costBasis, source: 'plaid',
              },
            })
          ),
      ]);
      for (const h of holdings) {
        const securityId = securityIds.get(h.plaidSecurityId);
        if (!securityId) continue;
        await prisma.securityPrice.upsert({
          where: { securityId_date_source: { securityId, date: today, source: 'plaid' } },
          create: { securityId, date: today, close: h.price, source: 'plaid' },
          update: { close: h.price },
        });
      }
      result.counts.holdings = holdings.length;
    });
  }

  await runStep('transactions', async () => {
    const start_date = isoDay(await transactionWindowStart(accountId, today));
    const end_date = isoDay(today);
    if (isDepository) {
      const rows: MappedInvestmentTransaction[] = [];
      let total = Infinity;
      for (let offset = 0; offset < total; offset += PAGE) {
        const res = await plaidCall(() =>
          plaid.transactionsGet({ access_token, start_date, end_date, options: { account_ids, count: PAGE, offset } })
        );
        total = res.data.total_transactions;
        for (const t of res.data.transactions) {
          const m = mapCashTransaction(t);
          if (m) rows.push(m);
        }
        if (!res.data.transactions.length) break;
      }
      const r = await upsertInvestmentTransactions(accountId, rows, new Map());
      result.counts.transactions = r.upserted;
      return;
    }
    const rows: MappedInvestmentTransaction[] = [];
    const securities: PlaidSecurity[] = [];
    let total = Infinity;
    for (let offset = 0; offset < total; offset += PAGE) {
      const res = await plaidCall(() =>
        plaid.investmentsTransactionsGet({ access_token, start_date, end_date, options: { account_ids, count: PAGE, offset } })
      );
      total = res.data.total_investment_transactions;
      securities.push(...res.data.securities);
      rows.push(...res.data.investment_transactions.map(mapInvestmentTransaction));
      if (!res.data.investment_transactions.length) break;
    }
    const securityIds = await upsertSecurities(securities);
    const r = await upsertInvestmentTransactions(accountId, rows, securityIds);
    result.counts.transactions = r.upserted;
    result.counts.cancelled = r.cancelled;
  });

  await runStep('linking', async () => {
    const { linkInvestmentTransfers } = await import('./transfer-linking');
    result.counts.linked = await linkInvestmentTransfers(prisma, [accountId]);
  });

  return result;
}
```

Create a temporary stub so this task compiles and its tests run before Task 7 — `src/lib/investments/transfer-linking.ts`:

```ts
import type { PrismaClient } from '@prisma/client';

export async function linkInvestmentTransfers(_prisma: PrismaClient, _accountIds: string[]): Promise<number> {
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/lib/investments/plaid-investment-sync.test.ts && npm run typecheck`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/plaid-investment-sync.ts src/lib/investments/transfer-linking.ts \
  tests/unit/lib/investments/plaid-investment-sync.test.ts
git commit -m "feat(investments): Plaid investment sync (balance, holdings, transactions)"
```

---

### Task 7: Transfer linking

**Files:**
- Modify: `src/lib/investments/transfer-linking.ts` (replace stub)
- Modify: `src/lib/investments/plaid-investment-sync.ts` (static import instead of dynamic)
- Test: `tests/unit/lib/investments/transfer-linking.test.ts`

**Interfaces:**
- Consumes: Task 1 models, `addDays` (Task 1).
- Produces:
  ```ts
  const LINK_WINDOW_DAYS = 5;
  isCashFlow(t: { type: string; subtype: string }): boolean;
  pickMatch(inv: { date: Date; amount: number }, candidates: { id: string; date: Date; amount: number }[]): string | null;
  linkInvestmentTransfers(prisma: PrismaClient, accountIds: string[]): Promise<number>; // number linked
  ```
  Matching rule: same signed amount (both conventions make a bank→brokerage deposit negative on both sides), |Δamount| ≤ 0.005, |Δdate| ≤ 5 days, bank transaction not in an investment-mode account, not a split parent, not already linked. Exactly one candidate → link (set `InvestmentTransaction.linkedTransactionId`, set bank `Transaction.isTransfer = true`); zero or several → leave unlinked.

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/investments/transfer-linking.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';
import { isCashFlow, pickMatch, linkInvestmentTransfers } from '@/lib/investments/transfer-linking';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);

describe('isCashFlow', () => {
  it('accepts transfers and cash deposits/withdrawals/contributions only', () => {
    expect(isCashFlow({ type: 'transfer', subtype: 'transfer' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'deposit' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'withdrawal' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'contribution' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'transfer_in' })).toBe(true);
    expect(isCashFlow({ type: 'cash', subtype: 'dividend' })).toBe(false);
    expect(isCashFlow({ type: 'buy', subtype: 'buy' })).toBe(false);
  });
});

describe('pickMatch', () => {
  const inv = { date: d('2026-10-07'), amount: -2000 };
  it('returns the single candidate within window and amount', () => {
    expect(pickMatch(inv, [{ id: 'a', date: d('2026-10-06'), amount: -2000 }])).toBe('a');
  });
  it('returns null when ambiguous', () => {
    expect(pickMatch(inv, [{ id: 'a', date: d('2026-10-06'), amount: -2000 }, { id: 'b', date: d('2026-10-08'), amount: -2000 }])).toBeNull();
  });
  it('rejects candidates outside 5 days or with a different amount', () => {
    expect(pickMatch(inv, [{ id: 'a', date: d('2026-10-01'), amount: -2000 }, { id: 'b', date: d('2026-10-07'), amount: -1999 }])).toBeNull();
  });
});

describe('linkInvestmentTransfers', () => {
  let prisma: PrismaClient;
  let invAccountId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    invAccountId = (await prisma.account.create({ data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' } })).id;
    bankAccountId = (await prisma.account.create({ data: createAccountData() })).id;
  });

  const inv = (o: Partial<{ externalId: string; date: Date; amount: number; type: string; subtype: string; isCancelled: boolean }> = {}) =>
    prisma.investmentTransaction.create({
      data: { accountId: invAccountId, externalId: o.externalId ?? 'it-1', date: o.date ?? d('2026-10-07'), type: o.type ?? 'transfer',
        subtype: o.subtype ?? 'transfer', name: 'Tfr', amount: o.amount ?? -2000, currency: 'USD', source: 'plaid', isCancelled: o.isCancelled ?? false },
    });
  const bank = (o: Partial<{ date: Date; amount: number }> = {}) =>
    prisma.transaction.create({ data: { accountId: bankAccountId, date: o.date ?? d('2026-10-06'), amount: o.amount ?? -2000, merchant: 'Brokerage' } });

  it('links a unique match and marks the bank side as a transfer', async () => {
    const i = await inv();
    const b = await bank();
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(1);
    expect((await prisma.investmentTransaction.findUniqueOrThrow({ where: { id: i.id } })).linkedTransactionId).toBe(b.id);
    expect((await prisma.transaction.findUniqueOrThrow({ where: { id: b.id } })).isTransfer).toBe(true);
  });

  it('leaves ambiguous matches unlinked', async () => {
    await inv();
    await bank({ date: d('2026-10-06') });
    await bank({ date: d('2026-10-08') });
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(0);
  });

  it('ignores dividends, cancelled rows and already-linked bank transactions', async () => {
    await inv({ externalId: 'div', type: 'cash', subtype: 'dividend', amount: -2000 });
    await inv({ externalId: 'cxl', isCancelled: true });
    const first = await inv({ externalId: 'it-a' });
    await bank();
    await linkInvestmentTransfers(prisma, [invAccountId]);
    await inv({ externalId: 'it-b' }); // same amount/date, bank row already taken
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(0);
    expect((await prisma.investmentTransaction.findUniqueOrThrow({ where: { id: first.id } })).linkedTransactionId).not.toBeNull();
  });

  it('never matches transactions in other investment accounts', async () => {
    await inv();
    const other = await prisma.account.create({ data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'manual' } });
    await prisma.transaction.create({ data: { accountId: other.id, date: d('2026-10-06'), amount: -2000, merchant: 'x' } });
    expect(await linkInvestmentTransfers(prisma, [invAccountId])).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/investments/transfer-linking.test.ts`
Expected: FAIL — `isCashFlow`/`pickMatch` not exported; stub returns 0.

- [ ] **Step 3: Implement**

Replace `src/lib/investments/transfer-linking.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { addDays } from './dates';

export const LINK_WINDOW_DAYS = 5;
const AMOUNT_EPSILON = 0.005;
const DAY_MS = 24 * 60 * 60 * 1000;
const CASH_FLOW_SUBTYPES = new Set(['deposit', 'withdrawal', 'contribution', 'transfer', 'transfer_in', 'transfer_out']);

export function isCashFlow(t: { type: string; subtype: string }): boolean {
  return t.type === 'transfer' || (t.type === 'cash' && CASH_FLOW_SUBTYPES.has(t.subtype));
}

export function pickMatch(
  inv: { date: Date; amount: number },
  candidates: { id: string; date: Date; amount: number }[]
): string | null {
  const hits = candidates.filter(
    (c) =>
      Math.abs(c.amount - inv.amount) <= AMOUNT_EPSILON &&
      Math.abs(c.date.getTime() - inv.date.getTime()) <= LINK_WINDOW_DAYS * DAY_MS
  );
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Link unlinked investment cash flows (deposits/withdrawals/transfers) in the given accounts to
 * a bank Transaction with the same signed amount within ±5 days. Both sign conventions make a
 * bank→brokerage deposit negative on both sides, so amounts must be equal, not opposite.
 */
export async function linkInvestmentTransfers(prisma: PrismaClient, accountIds: string[]): Promise<number> {
  const pending = await prisma.investmentTransaction.findMany({
    where: { accountId: { in: accountIds }, isCancelled: false, linkedTransactionId: null },
    orderBy: { date: 'asc' },
  });
  let linked = 0;
  for (const inv of pending.filter(isCashFlow)) {
    const candidates = await prisma.transaction.findMany({
      where: {
        date: { gte: addDays(inv.date, -LINK_WINDOW_DAYS), lte: addDays(inv.date, LINK_WINDOW_DAYS) },
        amount: { gte: inv.amount - AMOUNT_EPSILON, lte: inv.amount + AMOUNT_EPSILON },
        isSplitParent: false,
        investmentLinks: { none: {} },
        account: { trackingMode: { not: 'investment' } },
      },
      select: { id: true, date: true, amount: true },
    });
    const match = pickMatch(inv, candidates);
    if (!match) continue;
    await prisma.$transaction([
      prisma.investmentTransaction.update({ where: { id: inv.id }, data: { linkedTransactionId: match } }),
      prisma.transaction.update({ where: { id: match }, data: { isTransfer: true } }),
    ]);
    linked++;
  }
  return linked;
}
```

In `src/lib/investments/plaid-investment-sync.ts`, replace the dynamic import in the linking step with a static import at the top (`import { linkInvestmentTransfers } from './transfer-linking';`) and call `linkInvestmentTransfers(prisma, [accountId])` directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/ && npm run typecheck`
Expected: PASS (all investments unit tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/transfer-linking.ts src/lib/investments/plaid-investment-sync.ts \
  tests/unit/lib/investments/transfer-linking.test.ts
git commit -m "feat(investments): link bank transfers to investment deposits and withdrawals"
```

---

### Task 8: Route investment accounts through the investment sync

**Files:**
- Modify: `src/app/api/plaid/sync/route.ts`
- Test: `tests/integration/api/plaid-investment-sync-route.test.ts`

**Interfaces:**
- Consumes: `syncPlaidInvestments`, `InvestmentSyncResult` (Task 6); `withSyncLock` (`@/lib/sync-common`).
- Produces: `POST /api/plaid/sync { accountId }` for an account with `trackingMode === 'investment'` returns `{ success: true, investment: true, ...InvestmentSyncResult }`; updates `PlaidConnection.lastSyncAt/lastSyncStatus/lastSyncError`; never calls `syncPlaidTransactions`. Dry runs return `{ success: true, dryRun: true, investment: true, skipped: true }`. Re-auth errors keep the existing 400 `NEEDS_REAUTH` behavior.

- [ ] **Step 1: Write the failing test**

`tests/integration/api/plaid-investment-sync-route.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('@/lib/investments/plaid-investment-sync', () => ({ syncPlaidInvestments: vi.fn() }));
vi.mock('@/lib/plaid-sync', () => ({ syncPlaidTransactions: vi.fn() }));

import { POST } from '@/app/api/plaid/sync/route';
import { syncPlaidInvestments } from '@/lib/investments/plaid-investment-sync';
import { syncPlaidTransactions } from '@/lib/plaid-sync';

const post = (body: unknown) => POST(new NextRequest('http://localhost/api/plaid/sync', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/plaid/sync for investment accounts', () => {
  let accountId: string;
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.clearAllMocks();
    const a = await testPrisma.account.create({ data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' } });
    accountId = a.id;
    const e = await testPrisma.plaidEnrollment.create({ data: { plaidItemId: 'item-1', institutionName: 'Test Brokerage', accessTokenEncrypted: 'x', accessTokenIv: 'y' } });
    await testPrisma.plaidConnection.create({ data: { accountId, plaidEnrollmentId: e.id, plaidAccountId: 'pa-1', plaidAccountType: 'investment' } });
  });

  it('calls the investment sync, not the transaction sync, and records status', async () => {
    vi.mocked(syncPlaidInvestments).mockResolvedValue({
      accountId, steps: { balance: 'ok', holdings: 'ok', transactions: 'ok', linking: 'ok' }, errors: {},
      counts: { holdings: 1, transactions: 2, cancelled: 0, linked: 0 },
    });
    const body = await (await post({ accountId })).json();
    expect(body).toMatchObject({ success: true, investment: true, counts: { transactions: 2 } });
    expect(syncPlaidTransactions).not.toHaveBeenCalled();
    const conn = await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId } });
    expect(conn.lastSyncStatus).toBe('success');
    expect(conn.lastSyncAt).not.toBeNull();
  });

  it('records partial failures as an error status with the step messages', async () => {
    vi.mocked(syncPlaidInvestments).mockResolvedValue({
      accountId, steps: { balance: 'ok', holdings: 'error', transactions: 'ok', linking: 'ok' }, errors: { holdings: 'boom' },
      counts: { holdings: 0, transactions: 0, cancelled: 0, linked: 0 },
    });
    await post({ accountId });
    const conn = await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId } });
    expect(conn.lastSyncStatus).toBe('error');
    expect(conn.lastSyncError).toContain('holdings: boom');
  });

  it('marks the connection for re-auth on ITEM_LOGIN_REQUIRED', async () => {
    vi.mocked(syncPlaidInvestments).mockRejectedValue(
      Object.assign(new Error('login'), { response: { data: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'login' } } })
    );
    const res = await post({ accountId });
    expect(res.status).toBe(400);
    expect((await testPrisma.plaidConnection.findUniqueOrThrow({ where: { accountId } })).status).toBe('needs_reauth');
  });
});
```

(`'success'` matches the literal `syncPlaidTransactions` writes to `lastSyncStatus`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/api/plaid-investment-sync-route.test.ts`
Expected: FAIL — `syncPlaidTransactions` is called; no `investment` key.

- [ ] **Step 3: Implement**

In `src/app/api/plaid/sync/route.ts`, add the import and insert this block after the `needs_reauth` early return and before the existing `const result = dryRun ? ...`:

```ts
import { syncPlaidInvestments } from '@/lib/investments/plaid-investment-sync';
// ...
    if (connection.account.trackingMode === 'investment') {
      if (dryRun) {
        return NextResponse.json({ success: true, dryRun: true, investment: true, skipped: true });
      }
      const result = await withSyncLock(`plaid:${connection.plaidEnrollment.id}`, () =>
        syncPlaidInvestments(connection)
      );
      const failed = Object.entries(result.errors).filter(([step]) => result.steps[step as keyof typeof result.steps] === 'error');
      await prisma.plaidConnection.update({
        where: { accountId },
        data: {
          lastSyncAt: new Date(),
          lastSyncStatus: failed.length ? 'error' : 'success',
          lastSyncError: failed.length ? failed.map(([s, m]) => `${s}: ${m}`).join('; ') : null,
        },
      });
      return NextResponse.json({ success: true, investment: true, ...result });
    }
```

(`connection` already includes `account` and `plaidEnrollment`, and has `plaidAccountId`/`plaidAccountType`, satisfying `InvestmentConnection`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/api/plaid-investment-sync-route.test.ts tests/unit/lib/plaid-sync.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/app/api/plaid/sync/route.ts tests/integration/api/plaid-investment-sync-route.test.ts
git commit -m "feat(investments): sync investment-mode Plaid accounts via the investment sync"
```

---

### Task 9: Migration logic + script

**Files:**
- Create: `src/lib/investments/migration.ts`
- Create: `scripts/migrate-investment-accounts.ts`
- Test: `tests/unit/lib/investments/migration.test.ts`

**Interfaces:**
- Consumes: Task 1 models, `utcDay` (Task 1), `syncPlaidInvestments` (Task 6) — script only.
- Produces:
  ```ts
  type Adjustment = { date: Date; amount: number };
  replayAdjustments(adjustments: Adjustment[]): { date: Date; balance: number }[];
  const MigrationConfigSchema; // zod
  type MigrationConfig = z.infer<typeof MigrationConfigSchema>;
  type PlaidAccountRef = { enrollmentId: string; institutionName: string; accountId: string; name: string; mask: string | null; type: string; subtype: string | null };
  type MigrationPlan = { convert: ConvertStep[]; create: CreateStep[]; skipped: { accountId: string; reason: string }[] };
  buildMigrationPlan(prisma: PrismaClient, config: MigrationConfig, plaidAccounts: PlaidAccountRef[]): Promise<MigrationPlan>; // throws on missing/ambiguous match or non-adjustment transactions
  applyMigrationPlan(prisma: PrismaClient, plan: MigrationPlan): Promise<{ convertedAccountIds: string[]; createdAccountIds: string[] }>;
  ```
  Config file (local, **never committed**), e.g. `~/Documents/FinanceOS-private/investment-migration.json`:
  ```json
  {
    "accounts": [
      { "accountId": "<uuid>", "balanceSource": "provider", "plaid": { "institution": "Fidelity", "mask": "1234" } },
      { "accountId": "<uuid>", "balanceSource": "manual" }
    ],
    "create": [
      { "name": "Traditional IRA", "type": "retirement", "currency": "USD", "plaid": { "institution": "Fidelity", "mask": "5678" } }
    ]
  }
  ```

- [ ] **Step 1: Write the failing test**

`tests/unit/lib/investments/migration.test.ts`:

```ts
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
    expect(replayAdjustments([{ date: d('2026-01-01T00:00:00Z'), amount: 0.1 }, { date: d('2026-01-01T01:00:00Z'), amount: 0.2 }])[0].balance).toBe(0.3);
  });
});

describe('buildMigrationPlan / applyMigrationPlan', () => {
  let prisma: PrismaClient;
  let enrollmentId: string;
  const plaidAccounts = (): PlaidAccountRef[] => [
    { enrollmentId, institutionName: 'Test Brokerage', accountId: 'pa-1', name: 'BROKERAGE', mask: '1111', type: 'investment', subtype: 'brokerage' },
    { enrollmentId, institutionName: 'Test Brokerage', accountId: 'pa-2', name: 'IRA', mask: '2222', type: 'investment', subtype: 'ira' },
  ];

  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    enrollmentId = (await prisma.plaidEnrollment.create({ data: { plaidItemId: 'item', institutionName: 'Test Brokerage', accessTokenEncrypted: 'x', accessTokenIv: 'y' } })).id;
  });

  async function legacyAccount(type = 'brokerage') {
    const a = await prisma.account.create({ data: { ...createAccountData({ type }), trackingMode: 'balance_only' } });
    for (const [date, amount] of [['2026-01-27T01:00:00Z', 1000], ['2026-04-04T12:00:00Z', 250]] as const) {
      await prisma.transaction.create({ data: { accountId: a.id, date: new Date(date), amount, merchant: 'Balance Adjustment', isTransfer: true } });
    }
    return a;
  }

  it('converts in place: balance history, adjustments removed, Plaid connection created', async () => {
    const a = await legacyAccount();
    const plan = await buildMigrationPlan(prisma, { accounts: [{ accountId: a.id, balanceSource: 'provider', plaid: { institution: 'Test Brokerage', mask: '1111' } }], create: [] }, plaidAccounts());
    await applyMigrationPlan(prisma, plan);
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: a.id }, include: { plaidConnection: true } });
    expect(acct).toMatchObject({ trackingMode: 'investment', balanceSource: 'provider' });
    expect(acct.plaidConnection).toMatchObject({ plaidAccountId: 'pa-1', plaidAccountMask: '1111', plaidAccountType: 'investment' });
    const rows = await prisma.accountBalance.findMany({ where: { accountId: a.id }, orderBy: { date: 'asc' } });
    expect(rows.map((r) => [r.date.toISOString().slice(0, 10), r.balance, r.source])).toEqual([
      ['2026-01-27', 1000, 'manual'],
      ['2026-04-04', 1250, 'manual'],
    ]);
    expect(await prisma.transaction.count({ where: { accountId: a.id } })).toBe(0);
  });

  it('creates new linked accounts', async () => {
    const plan = await buildMigrationPlan(prisma, { accounts: [], create: [{ name: 'New IRA', type: 'retirement', currency: 'USD', plaid: { institution: 'Test Brokerage', mask: '2222' } }] }, plaidAccounts());
    const { createdAccountIds } = await applyMigrationPlan(prisma, plan);
    const acct = await prisma.account.findUniqueOrThrow({ where: { id: createdAccountIds[0] }, include: { plaidConnection: true } });
    expect(acct).toMatchObject({ name: 'New IRA', trackingMode: 'investment', balanceSource: 'provider' });
    expect(acct.plaidConnection?.plaidAccountId).toBe('pa-2');
  });

  it('refuses accounts with non-adjustment transactions', async () => {
    const a = await legacyAccount();
    await prisma.transaction.create({ data: { accountId: a.id, date: new Date(), amount: 5, merchant: 'Coffee' } });
    await expect(buildMigrationPlan(prisma, { accounts: [{ accountId: a.id, balanceSource: 'manual' }], create: [] }, [])).rejects.toThrow(/non-adjustment/);
  });

  it('refuses missing or ambiguous Plaid matches', async () => {
    const a = await legacyAccount();
    await expect(
      buildMigrationPlan(prisma, { accounts: [{ accountId: a.id, balanceSource: 'provider', plaid: { institution: 'Test Brokerage', mask: '9999' } }], create: [] }, plaidAccounts())
    ).rejects.toThrow(/exactly 1/);
    const dup = [...plaidAccounts(), { ...plaidAccounts()[0], accountId: 'pa-dup' }];
    await expect(
      buildMigrationPlan(prisma, { accounts: [{ accountId: a.id, balanceSource: 'provider', plaid: { institution: 'Test Brokerage', mask: '1111' } }], create: [] }, dup)
    ).rejects.toThrow(/exactly 1/);
  });

  it('re-running an applied plan changes nothing', async () => {
    const a = await legacyAccount();
    const config = { accounts: [{ accountId: a.id, balanceSource: 'manual' as const }], create: [] };
    await applyMigrationPlan(prisma, await buildMigrationPlan(prisma, config, []));
    const again = await buildMigrationPlan(prisma, config, []);
    expect(again.convert).toHaveLength(0);
    expect(again.skipped).toEqual([{ accountId: a.id, reason: 'already an investment account' }]);
    await applyMigrationPlan(prisma, again);
    expect(await prisma.accountBalance.count({ where: { accountId: a.id } })).toBe(2);
  });

  it('skips create entries whose Plaid account is already linked', async () => {
    const config = { accounts: [], create: [{ name: 'New IRA', type: 'retirement', currency: 'USD', plaid: { institution: 'Test Brokerage', mask: '2222' } }] };
    await applyMigrationPlan(prisma, await buildMigrationPlan(prisma, config, plaidAccounts()));
    const again = await buildMigrationPlan(prisma, config, plaidAccounts());
    expect(again.create).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/lib/investments/migration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/investments/migration.ts`:

```ts
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { utcDay } from './dates';

export const ADJUSTMENT_MERCHANT = 'Balance Adjustment';

export type Adjustment = { date: Date; amount: number };

export function replayAdjustments(adjustments: Adjustment[]): { date: Date; balance: number }[] {
  const sorted = [...adjustments].sort((a, b) => a.date.getTime() - b.date.getTime());
  const byDay = new Map<string, { date: Date; balance: number }>();
  let running = 0;
  for (const adj of sorted) {
    running += adj.amount;
    const day = utcDay(adj.date);
    byDay.set(day.toISOString(), { date: day, balance: Math.round(running * 100) / 100 });
  }
  return [...byDay.values()];
}

const PlaidRefSchema = z.object({ institution: z.string(), mask: z.string() });

export const MigrationConfigSchema = z.object({
  accounts: z.array(
    z.object({
      accountId: z.string(),
      balanceSource: z.enum(['provider', 'valuation', 'manual']),
      plaid: PlaidRefSchema.optional(),
    })
  ),
  create: z
    .array(z.object({ name: z.string(), type: z.string(), currency: z.string(), plaid: PlaidRefSchema }))
    .default([]),
});
export type MigrationConfig = z.input<typeof MigrationConfigSchema>;

export type PlaidAccountRef = {
  enrollmentId: string;
  institutionName: string;
  accountId: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
};

type ConvertStep = {
  accountId: string;
  accountName: string;
  balanceSource: 'provider' | 'valuation' | 'manual';
  currency: string;
  balances: { date: Date; balance: number }[];
  adjustmentIds: string[];
  plaid: PlaidAccountRef | null;
};
type CreateStep = { name: string; type: string; currency: string; plaid: PlaidAccountRef };

export type MigrationPlan = {
  convert: ConvertStep[];
  create: CreateStep[];
  skipped: { accountId: string; reason: string }[];
};

function matchPlaid(ref: { institution: string; mask: string }, plaidAccounts: PlaidAccountRef[]): PlaidAccountRef {
  const hits = plaidAccounts.filter(
    (p) => p.mask === ref.mask && p.institutionName.toLowerCase().includes(ref.institution.toLowerCase())
  );
  if (hits.length !== 1) {
    throw new Error(`Expected exactly 1 Plaid account at "${ref.institution}" ending ${ref.mask}, found ${hits.length}`);
  }
  return hits[0];
}

export async function buildMigrationPlan(
  prisma: PrismaClient,
  input: MigrationConfig,
  plaidAccounts: PlaidAccountRef[]
): Promise<MigrationPlan> {
  const config = MigrationConfigSchema.parse(input);
  const plan: MigrationPlan = { convert: [], create: [], skipped: [] };

  for (const entry of config.accounts) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: entry.accountId } });
    if (account.trackingMode === 'investment') {
      plan.skipped.push({ accountId: account.id, reason: 'already an investment account' });
      continue;
    }
    const txns = await prisma.transaction.findMany({ where: { accountId: account.id } });
    const other = txns.filter((t) => t.merchant !== ADJUSTMENT_MERCHANT);
    if (other.length) {
      throw new Error(`Account ${account.id} has ${other.length} non-adjustment transaction(s); refusing to convert`);
    }
    if (entry.balanceSource === 'provider' && !entry.plaid) {
      throw new Error(`Account ${account.id}: provider accounts need a plaid { institution, mask }`);
    }
    plan.convert.push({
      accountId: account.id,
      accountName: account.name,
      balanceSource: entry.balanceSource,
      currency: account.currency,
      balances: replayAdjustments(txns.map((t) => ({ date: t.date, amount: t.amount }))),
      adjustmentIds: txns.map((t) => t.id),
      plaid: entry.plaid ? matchPlaid(entry.plaid, plaidAccounts) : null,
    });
  }

  for (const entry of config.create) {
    const plaid = matchPlaid(entry.plaid, plaidAccounts);
    const linked = await prisma.plaidConnection.findFirst({
      where: { plaidEnrollmentId: plaid.enrollmentId, plaidAccountId: plaid.accountId },
    });
    if (linked) {
      plan.skipped.push({ accountId: linked.accountId, reason: 'Plaid account already linked' });
      continue;
    }
    plan.create.push({ name: entry.name, type: entry.type, currency: entry.currency, plaid });
  }
  return plan;
}

function connectionData(accountId: string, p: PlaidAccountRef) {
  return {
    accountId,
    plaidEnrollmentId: p.enrollmentId,
    plaidAccountId: p.accountId,
    plaidAccountName: p.name,
    plaidAccountType: p.type,
    plaidAccountSubtype: p.subtype,
    plaidAccountMask: p.mask,
    status: 'connected',
  };
}

export async function applyMigrationPlan(
  prisma: PrismaClient,
  plan: MigrationPlan
): Promise<{ convertedAccountIds: string[]; createdAccountIds: string[] }> {
  const createdAccountIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const step of plan.convert) {
      await tx.account.update({
        where: { id: step.accountId },
        data: { trackingMode: 'investment', balanceSource: step.balanceSource },
      });
      for (const b of step.balances) {
        await tx.accountBalance.upsert({
          where: { accountId_date: { accountId: step.accountId, date: b.date } },
          create: { accountId: step.accountId, date: b.date, balance: b.balance, currency: step.currency, source: 'manual' },
          update: {},
        });
      }
      await tx.transaction.deleteMany({ where: { id: { in: step.adjustmentIds } } });
      if (step.plaid) await tx.plaidConnection.create({ data: connectionData(step.accountId, step.plaid) });
    }
    for (const step of plan.create) {
      const account = await tx.account.create({
        data: {
          name: step.name,
          type: step.type,
          institution: step.plaid.institutionName,
          currency: step.currency,
          trackingMode: 'investment',
          balanceSource: 'provider',
        },
      });
      await tx.plaidConnection.create({ data: connectionData(account.id, step.plaid) });
      createdAccountIds.push(account.id);
    }
  });
  return { convertedAccountIds: plan.convert.map((c) => c.accountId), createdAccountIds };
}
```

`scripts/migrate-investment-accounts.ts`:

```ts
/**
 * One-shot migration: convert manual balance_only investment accounts into investment accounts
 * in place (ids preserved), replaying their "Balance Adjustment" history into AccountBalance and
 * linking Plaid investment accounts. Account mapping comes from a LOCAL JSON file that must never
 * be committed (the repo is public).
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/migrate-investment-accounts.ts <config.json>          # dry run
 *   npx tsx --env-file=.env scripts/migrate-investment-accounts.ts <config.json> --apply  # backup + write + first sync
 */
import { copyFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { getPlaidClient } from '../src/lib/plaid';
import { decryptAccessToken } from '../src/lib/encryption';
import {
  buildMigrationPlan,
  applyMigrationPlan,
  type PlaidAccountRef,
} from '../src/lib/investments/migration';
import { syncPlaidInvestments } from '../src/lib/investments/plaid-investment-sync';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function dbFilePath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';
  const file = url.replace(/^file:/, '').split('?')[0];
  return resolve(file.startsWith('./') && !file.startsWith('./prisma') ? `prisma/${file.slice(2)}` : file);
}

async function loadPlaidAccounts(): Promise<PlaidAccountRef[]> {
  const plaid = getPlaidClient();
  const refs: PlaidAccountRef[] = [];
  for (const e of await prisma.plaidEnrollment.findMany()) {
    const access_token = decryptAccessToken(e.accessTokenEncrypted, e.accessTokenIv);
    const res = await plaid.accountsGet({ access_token });
    for (const a of res.data.accounts) {
      refs.push({ enrollmentId: e.id, institutionName: e.institutionName, accountId: a.account_id, name: a.name, mask: a.mask ?? null, type: a.type, subtype: a.subtype ?? null });
    }
  }
  return refs;
}

async function main() {
  const configPath = process.argv[2];
  if (!configPath || configPath.startsWith('--')) throw new Error('Usage: migrate-investment-accounts.ts <config.json> [--apply]');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  console.warn(`\n=== Investment account migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const plan = await buildMigrationPlan(prisma, config, await loadPlaidAccounts());

  for (const c of plan.convert) {
    console.warn(`CONVERT ${c.accountName} → investment/${c.balanceSource}${c.plaid ? ` · Plaid ${c.plaid.institutionName} ••••${c.plaid.mask}` : ''}`);
    for (const b of c.balances) console.warn(`    ${b.date.toISOString().slice(0, 10)}  ${b.balance.toFixed(2)} ${c.currency}`);
    console.warn(`    delete ${c.adjustmentIds.length} adjustment transaction(s)`);
  }
  for (const c of plan.create) console.warn(`CREATE ${c.name} (${c.type}) · Plaid ${c.plaid.institutionName} ••••${c.plaid.mask}`);
  for (const s of plan.skipped) console.warn(`SKIP ${s.accountId}: ${s.reason}`);

  if (!APPLY) {
    console.warn('\nDry run only. Re-run with --apply to write.');
    return;
  }

  const db = dbFilePath();
  const backup = `${db}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  copyFileSync(db, backup);
  console.warn(`\nBacked up database to ${backup}`);

  const { convertedAccountIds, createdAccountIds } = await applyMigrationPlan(prisma, plan);
  console.warn(`Converted ${convertedAccountIds.length}, created ${createdAccountIds.length}.`);

  const connections = await prisma.plaidConnection.findMany({
    where: { accountId: { in: [...convertedAccountIds, ...createdAccountIds] } },
    include: { account: true, plaidEnrollment: true },
  });
  for (const conn of connections) {
    const r = await syncPlaidInvestments(conn);
    console.warn(`  synced ${conn.account.name}: ${JSON.stringify(r.steps)} ${JSON.stringify(r.counts)}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

Note for the script's `syncPlaidInvestments` import: the module imports `prisma` from `@/lib/prisma`; `tsx` resolves the `@/` alias via `tsconfig.json` paths. If it does not, run with `npx tsx --tsconfig tsconfig.json …`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/migration.test.ts && npm run typecheck`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/migration.ts scripts/migrate-investment-accounts.ts \
  tests/unit/lib/investments/migration.test.ts
git commit -m "feat(investments): in-place migration of manual investment accounts"
```

---

### Task 10: Cloud sync carries investment data

**Files:**
- Modify: `src/lib/cloud-sync/types.ts`
- Modify: `src/lib/cloud-sync/sync.ts`
- Test: `tests/integration/api/cloud-sync-investments.test.ts`

**Interfaces:**
- Consumes: Task 1 models.
- Produces: `SyncData` gains optional arrays `accountBalances`, `securities`, `securityPrices`, `securityEvents`, `holdingSnapshots`, `investmentTransactions`; `AccountExport.balanceSource` (optional, nullable). Older payloads without these keys still import. `recordCounts` gains optional counts for each.

- [ ] **Step 1: Write the failing test**

`tests/integration/api/cloud-sync-investments.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import { exportDatabase, importDatabase, setPrismaClient, resetPrismaClient } from '@/lib/cloud-sync/sync';

describe('cloud sync — investment data', () => {
  let prisma: PrismaClient;
  beforeAll(async () => {
    process.env.SYNC_ENCRYPTION_KEY = 'YV10ZXN0LWtleS10aGF0LWlzLWV4YWN0bHktMzItYiE=';
    prisma = await setupTestDb();
    setPrismaClient(prisma);
  });
  afterAll(async () => {
    resetPrismaClient();
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('round-trips investment tables and balanceSource', async () => {
    const day = new Date('2026-10-09T00:00:00.000Z');
    const a = await prisma.account.create({ data: { ...createAccountData({ type: 'brokerage' }), trackingMode: 'investment', balanceSource: 'provider' } });
    const bank = await prisma.account.create({ data: createAccountData() });
    const bankTx = await prisma.transaction.create({ data: { accountId: bank.id, date: day, amount: -100, merchant: 'Brokerage', isTransfer: true } });
    const s = await prisma.security.create({ data: { plaidSecurityId: 'ps', name: 'ETF', ticker: 'TETF', type: 'etf', pricing: 'feed', priceSymbol: 'TETF' } });
    await prisma.accountBalance.create({ data: { accountId: a.id, date: day, balance: 100, currency: 'USD', source: 'plaid' } });
    await prisma.securityPrice.create({ data: { securityId: s.id, date: day, close: 50, source: 'plaid' } });
    await prisma.securityEvent.create({ data: { securityId: s.id, date: day, type: 'dividend', amount: 0.5, source: 'yahoo' } });
    await prisma.holdingSnapshot.create({ data: { accountId: a.id, securityId: s.id, date: day, quantity: 2, price: 50, value: 100, source: 'plaid' } });
    await prisma.investmentTransaction.create({ data: { accountId: a.id, securityId: s.id, externalId: 'x', date: day, type: 'transfer', subtype: 'transfer', name: 'Tfr', amount: -100, currency: 'USD', source: 'plaid', linkedTransactionId: bankTx.id } });

    const payload = await exportDatabase();
    expect(payload.data.investmentTransactions).toHaveLength(1);
    await resetTestDb();
    await importDatabase(payload);

    expect((await prisma.account.findUniqueOrThrow({ where: { id: a.id } })).balanceSource).toBe('provider');
    expect(await prisma.accountBalance.count()).toBe(1);
    expect(await prisma.security.count()).toBe(1);
    expect(await prisma.securityPrice.count()).toBe(1);
    expect(await prisma.securityEvent.count()).toBe(1);
    expect(await prisma.holdingSnapshot.count()).toBe(1);
    const inv = await prisma.investmentTransaction.findFirstOrThrow();
    expect(inv.linkedTransactionId).toBe(bankTx.id);
  });

  it('imports payloads from before investment support', async () => {
    const payload = await exportDatabase();
    const legacy = structuredClone(payload) as unknown as { data: Record<string, unknown> };
    for (const k of ['accountBalances', 'securities', 'securityPrices', 'securityEvents', 'holdingSnapshots', 'investmentTransactions']) delete legacy.data[k];
    const { validateSyncPayload } = await import('@/lib/cloud-sync/types');
    expect(() => validateSyncPayload(legacy as never)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/api/cloud-sync-investments.test.ts`
Expected: FAIL — `payload.data.investmentTransactions` undefined.

- [ ] **Step 3: Implement**

`src/lib/cloud-sync/types.ts`:

1. In `AccountExportSchema` add `balanceSource: z.string().nullable().optional(),`.
2. Add schemas before `SyncDataSchema`:

```ts
export const AccountBalanceExportSchema = z.object({
  id: z.string(), accountId: z.string(), date: z.string(), balance: z.number(), currency: z.string(),
  source: z.string(), createdAt: z.string(),
});
export const SecurityExportSchema = z.object({
  id: z.string(), plaidSecurityId: z.string().nullable(), ticker: z.string().nullable(), name: z.string(),
  type: z.string(), currency: z.string(), exchangeMic: z.string().nullable(), priceSymbol: z.string().nullable(),
  priceSymbolOverride: z.boolean(), pricing: z.string(), fixedPrice: z.number().nullable(),
  createdAt: z.string(), updatedAt: z.string(),
});
export const SecurityPriceExportSchema = z.object({
  id: z.string(), securityId: z.string(), date: z.string(), close: z.number(), source: z.string(), createdAt: z.string(),
});
export const SecurityEventExportSchema = z.object({
  id: z.string(), securityId: z.string(), date: z.string(), type: z.string(), amount: z.number().nullable(),
  ratio: z.number().nullable(), source: z.string(), createdAt: z.string(),
});
export const HoldingSnapshotExportSchema = z.object({
  id: z.string(), accountId: z.string(), securityId: z.string(), date: z.string(), quantity: z.number(),
  price: z.number(), value: z.number(), costBasis: z.number().nullable(), source: z.string(), createdAt: z.string(),
});
export const InvestmentTransactionExportSchema = z.object({
  id: z.string(), accountId: z.string(), securityId: z.string().nullable(), externalId: z.string().nullable(),
  date: z.string(), type: z.string(), subtype: z.string(), name: z.string(), quantity: z.number().nullable(),
  price: z.number().nullable(), amount: z.number(), fees: z.number().nullable(), currency: z.string(),
  source: z.string(), isCancelled: z.boolean(), linkedTransactionId: z.string().nullable(), createdAt: z.string(),
});
```

3. In `SyncDataSchema` add:

```ts
  accountBalances: z.array(AccountBalanceExportSchema).optional(),
  securities: z.array(SecurityExportSchema).optional(),
  securityPrices: z.array(SecurityPriceExportSchema).optional(),
  securityEvents: z.array(SecurityEventExportSchema).optional(),
  holdingSnapshots: z.array(HoldingSnapshotExportSchema).optional(),
  investmentTransactions: z.array(InvestmentTransactionExportSchema).optional(),
```

4. In `SyncMetadataSchema.recordCounts` add the same six keys as `z.number().optional()`.

`src/lib/cloud-sync/sync.ts`:

1. `exportDatabase` — extend the destructuring and `Promise.all`:

```ts
    recurringTransactions,
    settings,
    accountBalances,
    securities,
    securityPrices,
    securityEvents,
    holdingSnapshots,
    investmentTransactions,
  ] = await Promise.all([
    // ...existing calls unchanged...
    getPrisma().userSettings.findFirst(),
    getPrisma().accountBalance.findMany(),
    getPrisma().security.findMany(),
    getPrisma().securityPrice.findMany(),
    getPrisma().securityEvent.findMany(),
    getPrisma().holdingSnapshot.findMany(),
    getPrisma().investmentTransaction.findMany(),
  ]);
```

In the `accounts` mapper add `balanceSource: a.balanceSource,`. Add to the `data` object (after `settings`):

```ts
    accountBalances: accountBalances.map((r) => ({
      id: r.id, accountId: r.accountId, date: r.date.toISOString(), balance: r.balance,
      currency: r.currency, source: r.source, createdAt: r.createdAt.toISOString(),
    })),
    securities: securities.map((r) => ({
      id: r.id, plaidSecurityId: r.plaidSecurityId, ticker: r.ticker, name: r.name, type: r.type,
      currency: r.currency, exchangeMic: r.exchangeMic, priceSymbol: r.priceSymbol,
      priceSymbolOverride: r.priceSymbolOverride, pricing: r.pricing, fixedPrice: r.fixedPrice,
      createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    })),
    securityPrices: securityPrices.map((r) => ({
      id: r.id, securityId: r.securityId, date: r.date.toISOString(), close: r.close,
      source: r.source, createdAt: r.createdAt.toISOString(),
    })),
    securityEvents: securityEvents.map((r) => ({
      id: r.id, securityId: r.securityId, date: r.date.toISOString(), type: r.type, amount: r.amount,
      ratio: r.ratio, source: r.source, createdAt: r.createdAt.toISOString(),
    })),
    holdingSnapshots: holdingSnapshots.map((r) => ({
      id: r.id, accountId: r.accountId, securityId: r.securityId, date: r.date.toISOString(),
      quantity: r.quantity, price: r.price, value: r.value, costBasis: r.costBasis, source: r.source,
      createdAt: r.createdAt.toISOString(),
    })),
    investmentTransactions: investmentTransactions.map((r) => ({
      id: r.id, accountId: r.accountId, securityId: r.securityId, externalId: r.externalId,
      date: r.date.toISOString(), type: r.type, subtype: r.subtype, name: r.name, quantity: r.quantity,
      price: r.price, amount: r.amount, fees: r.fees, currency: r.currency, source: r.source,
      isCancelled: r.isCancelled, linkedTransactionId: r.linkedTransactionId,
      createdAt: r.createdAt.toISOString(),
    })),
```

In `metadata.recordCounts` add:

```ts
      accountBalances: data.accountBalances?.length ?? 0,
      securities: data.securities?.length ?? 0,
      securityPrices: data.securityPrices?.length ?? 0,
      securityEvents: data.securityEvents?.length ?? 0,
      holdingSnapshots: data.holdingSnapshots?.length ?? 0,
      investmentTransactions: data.investmentTransactions?.length ?? 0,
```

2. `importDatabase` — at the very start of the `$transaction` callback (before `recurringTransaction.deleteMany`):

```ts
    await tx.investmentTransaction.deleteMany();
    await tx.holdingSnapshot.deleteMany();
    await tx.accountBalance.deleteMany();
    await tx.securityEvent.deleteMany();
    await tx.securityPrice.deleteMany();
    await tx.security.deleteMany();
```

Add `balanceSource: acc.balanceSource ?? null,` to both the account `update` data and `create` data. Then directly **after** the loop that imports `data.transactions`, add:

```ts
    for (const r of data.securities ?? []) {
      await tx.security.create({ data: { ...r, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) } });
    }
    for (const r of data.securityPrices ?? []) {
      await tx.securityPrice.create({ data: { ...r, date: new Date(r.date), createdAt: new Date(r.createdAt) } });
    }
    for (const r of data.securityEvents ?? []) {
      await tx.securityEvent.create({ data: { ...r, date: new Date(r.date), createdAt: new Date(r.createdAt) } });
    }
    for (const r of data.accountBalances ?? []) {
      await tx.accountBalance.create({ data: { ...r, date: new Date(r.date), createdAt: new Date(r.createdAt) } });
    }
    for (const r of data.holdingSnapshots ?? []) {
      await tx.holdingSnapshot.create({ data: { ...r, date: new Date(r.date), createdAt: new Date(r.createdAt) } });
    }
    for (const r of data.investmentTransactions ?? []) {
      await tx.investmentTransaction.create({ data: { ...r, date: new Date(r.date), createdAt: new Date(r.createdAt) } });
    }
```

3. `getRecordCounts` — add six `count()` calls to its `Promise.all` and return them under the same keys as above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/integration/api/cloud-sync-investments.test.ts tests/integration/api/cloud-sync.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/cloud-sync/types.ts src/lib/cloud-sync/sync.ts tests/integration/api/cloud-sync-investments.test.ts
git commit -m "feat(investments): include investment tables in cloud sync"
```

---

### Task 11: Verify on real data (user-gated)

**Files:** none committed. Uses `~/Documents/FinanceOS-private/investment-migration.json` (create; never commit).

- [ ] **Step 1: Full suite + checks**

Run: `npm run check && npm run test:unit && npm run test:integration`
Expected: all pass; lint shows only the pre-existing `console.log` warnings in `PlaidInstitutionConnect.tsx`.

- [ ] **Step 2: Apply schema to the dev database**

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema."

- [ ] **Step 3: Write the local mapping file**

Query account ids: `sqlite3 prisma/dev.db "select id, name, institution, type, trackingMode from Account where trackingMode='balance_only' order by institution"`. Write `~/Documents/FinanceOS-private/investment-migration.json`:
- Fidelity: Vested Employer Stock, Emergency Savings, HSA, Employer 401(k), Roth IRA, Index Portfolio → `"balanceSource": "provider"` with `plaid: { institution: "Fidelity", mask }`.
- Schwab: Individual, Roth IRA → `provider`, `institution: "Schwab"`.
- Questrade RRSP, Crypto Wallet, Canadian group RRSP → `"balanceSource": "manual"` (Plan 2 moves the first two to `valuation`).
- `create`: Traditional IRA (Fidelity, `retirement`, USD).
- Student Loan: not listed.

Masks come from the Plaid probe output (`accounts.json`). **Do not** put this file in the repo.

- [ ] **Step 4: Dry run and get user sign-off**

Run: `npx tsx --env-file=.env scripts/migrate-investment-accounts.ts ~/Documents/FinanceOS-private/investment-migration.json`
Expected: one CONVERT block per account with its replayed balance points (Jan 27, Apr 4, Jul 12, Oct 10 entries) and adjustment counts; one CREATE; no errors. **Stop and show the output to the user; proceed only on their explicit approval.**

- [ ] **Step 5: Apply**

Run: `npx tsx --env-file=.env scripts/migrate-investment-accounts.ts ~/Documents/FinanceOS-private/investment-migration.json --apply`
Expected: backup path printed; converted 11, created 1; each Plaid account synced with `balance: ok, holdings: ok|skipped, transactions: ok`.

- [ ] **Step 6: Spot-check**

- `curl -s localhost:3000/api/accounts/balances | jq '.accounts[] | {name, balance}'` — Plaid accounts match their Plaid balances; manual accounts match the last recorded value.
- `sqlite3 prisma/dev.db "select count(*) from \"Transaction\" where merchant='Balance Adjustment' and accountId in (select id from Account where trackingMode='investment')"` → `0`.
- Settings → Accounts loads; Dashboard net worth is plausible vs. before (difference = market movement since the last manual adjustment).
- Sync one Fidelity and one Schwab account from Settings; no errors; `PlaidConnection.lastSyncStatus` updated.

Report results to the user. No commit in this task.
