# Add Accounts to an Existing Institution Enrollment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add a bank account opened after enrollment without disconnecting and re-linking every other account at that institution.

**Architecture:** Provider Connect/Link flows are re-opened in update mode from healthy enrollments, not just broken ones. Teller may return a new `enrollment_id`; a new reconciliation route detects that, re-points existing `TellerConnection` rows onto the new token using a pure matcher, and disposes of the stale enrollment row safely. Newly visible bank accounts surface as "discovered" in Settings with one-click adoption or a persistent ignore.

**Tech Stack:** Next.js 14 App Router, React 19, TypeScript, Prisma + SQLite, Zod, Vitest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-26-add-accounts-to-existing-enrollment-design.md`

**Branch:** `feat/add-accounts-to-existing-enrollment` (already created)

## Global Constraints

- Amount/date conventions are untouched by this work. Do not modify sync or dedup logic — the `importHash` tier from PR #23 already covers the token-swap case.
- Never delete a `TellerEnrollment` row that still has connections pointing at it. `TellerConnection.tellerEnrollmentId` is `onDelete: Cascade`; deleting the enrollment destroys the account linkage.
- Formatting is enforced: single quotes, semicolons, 2-space indent, 100 char width. Run `npm run lint:fix` before each commit.
- Only `console.warn` and `console.error` are permitted (`console.log` triggers a lint warning).
- Unused variables must be prefixed with `_`.
- Styling goes through the `ds` object from `src/lib/design-system.ts` (`ds.text.*`, `ds.bg.*`, `ds.border.*`). Do not hand-write color classes except the existing `var(--accent)` / `var(--red)` / `var(--green)` CSS-variable pattern.
- Account type mapping is exactly: `credit` → `credit`, `depository` → `checking`, everything else → `other`. Do not invent additional mappings.
- Tests run with `npm run test:unit` / `npm run test:integration`. Files run sequentially (`fileParallelism: false`) because they share SQLite databases.

---

### Task 1: Pure account matcher and type mapping

The reconciliation route and the discovery UI both need pure, testable helpers. Build them first with no I/O so they can be tested without a database.

**Files:**

- Create: `src/lib/bank-account-matching.ts`
- Test: `tests/unit/lib/bank-account-matching.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type ProviderAccount = { externalId: string; name: string; type: string; subtype: string; lastFour: string }`
  - `type ExistingConnection = { id: string; externalId: string; name: string | null; type: string | null; subtype: string | null; lastFour: string | null }`
  - `type MatchResult = { matched: Array<{ connectionId: string; account: ProviderAccount }>; unmatchedConnections: ExistingConnection[] }`
  - `matchConnectionsToAccounts(connections: ExistingConnection[], accounts: ProviderAccount[]): MatchResult`
  - `mapBankAccountType(type: string): string`
  - `normalizeAccountName(name: string | null): string`
  - `isAccountIgnored(account: { externalId: string; lastFour: string }, institutionId: string, ignored: IgnoredRecord[]): boolean`
  - `type IgnoredRecord = { externalAccountId: string; institutionId: string; lastFour: string | null }`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/bank-account-matching.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  matchConnectionsToAccounts,
  mapBankAccountType,
  normalizeAccountName,
  isAccountIgnored,
  type ExistingConnection,
  type ProviderAccount,
} from '@/lib/bank-account-matching';

function account(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    externalId: 'acc_new_1',
    name: 'Sapphire Reserve',
    type: 'credit',
    subtype: 'credit_card',
    lastFour: '7176',
    ...overrides,
  };
}

function connection(overrides: Partial<ExistingConnection> = {}): ExistingConnection {
  return {
    id: 'conn-1',
    externalId: 'acc_old_1',
    name: 'Sapphire Reserve',
    type: 'credit',
    subtype: 'credit_card',
    lastFour: '7176',
    ...overrides,
  };
}

describe('matchConnectionsToAccounts', () => {
  it('matches on exact external id first', () => {
    const conn = connection({ externalId: 'acc_same', lastFour: '0000' });
    const target = account({ externalId: 'acc_same', lastFour: '9999', name: 'Renamed' });
    const decoy = account({ externalId: 'acc_other', lastFour: '0000' });

    const result = matchConnectionsToAccounts([conn], [decoy, target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
    expect(result.unmatchedConnections).toHaveLength(0);
  });

  it('falls back to last four plus subtype when the external id changed', () => {
    const conn = connection({ externalId: 'acc_old_1', lastFour: '7176', subtype: 'credit_card' });
    const wrongSubtype = account({ externalId: 'acc_a', lastFour: '7176', subtype: 'checking' });
    const target = account({ externalId: 'acc_b', lastFour: '7176', subtype: 'credit_card' });

    const result = matchConnectionsToAccounts([conn], [wrongSubtype, target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
  });

  it('falls back to last four alone when no subtype matches', () => {
    const conn = connection({ externalId: 'acc_old_1', lastFour: '1130', subtype: 'credit_card' });
    const target = account({ externalId: 'acc_b', lastFour: '1130', subtype: null as unknown as string });

    const result = matchConnectionsToAccounts([conn], [target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
  });

  it('falls back to normalized name plus type when last four is missing', () => {
    const conn = connection({ externalId: 'acc_old_1', lastFour: null, name: 'Freedom  Unlimited' });
    const target = account({ externalId: 'acc_b', lastFour: '1130', name: 'FREEDOM UNLIMITED' });

    const result = matchConnectionsToAccounts([conn], [target]);

    expect(result.matched).toEqual([{ connectionId: 'conn-1', account: target }]);
  });

  it('leaves both connections unmatched when they compete for one account', () => {
    const connA = connection({ id: 'conn-a', externalId: 'old-a', lastFour: '3857' });
    const connB = connection({ id: 'conn-b', externalId: 'old-b', lastFour: '3857' });
    const shared = account({ externalId: 'acc_shared', lastFour: '3857' });

    const result = matchConnectionsToAccounts([connA, connB], [shared]);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedConnections.map((c) => c.id).sort()).toEqual(['conn-a', 'conn-b']);
  });

  it('never claims one account for two connections across tiers', () => {
    const exact = connection({ id: 'conn-exact', externalId: 'acc_x', lastFour: '1111' });
    const byLastFour = connection({ id: 'conn-lastfour', externalId: 'gone', lastFour: '1111' });
    const only = account({ externalId: 'acc_x', lastFour: '1111' });

    const result = matchConnectionsToAccounts([exact, byLastFour], [only]);

    expect(result.matched).toEqual([{ connectionId: 'conn-exact', account: only }]);
    expect(result.unmatchedConnections.map((c) => c.id)).toEqual(['conn-lastfour']);
  });

  it('reports every connection as unmatched when the account list is empty', () => {
    const result = matchConnectionsToAccounts([connection()], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatchedConnections).toHaveLength(1);
  });
});

describe('mapBankAccountType', () => {
  it('maps credit to credit', () => {
    expect(mapBankAccountType('credit')).toBe('credit');
  });

  it('maps depository to checking', () => {
    expect(mapBankAccountType('depository')).toBe('checking');
  });

  it('maps anything else to other', () => {
    expect(mapBankAccountType('investment')).toBe('other');
    expect(mapBankAccountType('')).toBe('other');
  });

  it('is case insensitive', () => {
    expect(mapBankAccountType('CREDIT')).toBe('credit');
  });
});

describe('normalizeAccountName', () => {
  it('lowercases, strips punctuation, and collapses whitespace', () => {
    expect(normalizeAccountName('  Chase  Sapphire-Reserve®  ')).toBe('chase sapphire reserve');
  });

  it('returns an empty string for null', () => {
    expect(normalizeAccountName(null)).toBe('');
  });
});

describe('isAccountIgnored', () => {
  const ignored = [{ externalAccountId: 'acc_ignored', institutionId: 'chase', lastFour: '4242' }];

  it('matches on external account id', () => {
    expect(isAccountIgnored({ externalId: 'acc_ignored', lastFour: '0000' }, 'chase', ignored)).toBe(
      true
    );
  });

  it('matches on institution plus last four when the external id changed', () => {
    expect(isAccountIgnored({ externalId: 'acc_reissued', lastFour: '4242' }, 'chase', ignored)).toBe(
      true
    );
  });

  it('does not match the same last four at a different institution', () => {
    expect(isAccountIgnored({ externalId: 'acc_other', lastFour: '4242' }, 'amex', ignored)).toBe(
      false
    );
  });

  it('does not match when nothing lines up', () => {
    expect(isAccountIgnored({ externalId: 'acc_new', lastFour: '9999' }, 'chase', ignored)).toBe(
      false
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- bank-account-matching`
Expected: FAIL — `Failed to resolve import "@/lib/bank-account-matching"`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/bank-account-matching.ts`:

```typescript
/**
 * Pure helpers for reconciling a provider's account list against the connections
 * we already store. Used when a bank hands back a NEW enrollment covering the same
 * underlying accounts (Teller mints fresh account ids on re-enrollment, so the old
 * `tellerAccountId` values no longer resolve).
 *
 * No I/O here on purpose — the matching rules are the part worth testing exhaustively.
 */

export type ProviderAccount = {
  externalId: string;
  name: string;
  type: string;
  subtype: string;
  lastFour: string;
};

export type ExistingConnection = {
  id: string;
  externalId: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
  lastFour: string | null;
};

export type MatchResult = {
  matched: Array<{ connectionId: string; account: ProviderAccount }>;
  unmatchedConnections: ExistingConnection[];
};

export type IgnoredRecord = {
  externalAccountId: string;
  institutionId: string;
  lastFour: string | null;
};

/** Lowercase, strip anything that isn't a letter/digit/space, collapse runs of whitespace. */
export function normalizeAccountName(name: string | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Provider account type -> FinanceOS account type. Deliberately narrow: anything we
 * aren't certain about becomes `other` so the user corrects it in the adopt dialog
 * rather than silently getting a wrong tracking mode.
 */
export function mapBankAccountType(type: string): string {
  const normalized = (type || '').toLowerCase();
  if (normalized === 'credit') return 'credit';
  if (normalized === 'depository') return 'checking';
  return 'other';
}

type Tier = (conn: ExistingConnection, acc: ProviderAccount) => boolean;

// Tried in order. Each is strictly weaker than the one before it.
const TIERS: Tier[] = [
  (conn, acc) => conn.externalId === acc.externalId,
  (conn, acc) =>
    !!conn.lastFour &&
    conn.lastFour === acc.lastFour &&
    !!conn.subtype &&
    conn.subtype === acc.subtype,
  (conn, acc) => !!conn.lastFour && conn.lastFour === acc.lastFour,
  (conn, acc) =>
    normalizeAccountName(conn.name) !== '' &&
    normalizeAccountName(conn.name) === normalizeAccountName(acc.name) &&
    conn.type === acc.type,
];

/**
 * Pair each existing connection with at most one account from the new enrollment.
 *
 * A pairing is only accepted when it is unambiguous in BOTH directions: the
 * connection has exactly one candidate at this tier, and no other connection has
 * that same account as its sole candidate. Two cards sharing a last four would
 * otherwise get silently swapped, which quietly attaches months of transaction
 * history to the wrong account.
 */
export function matchConnectionsToAccounts(
  connections: ExistingConnection[],
  accounts: ProviderAccount[]
): MatchResult {
  const matched: MatchResult['matched'] = [];
  const claimedAccountIds = new Set<string>();
  const matchedConnectionIds = new Set<string>();

  for (const tier of TIERS) {
    const pending = connections.filter((c) => !matchedConnectionIds.has(c.id));
    const available = accounts.filter((a) => !claimedAccountIds.has(a.externalId));

    // Candidate set per still-unmatched connection at this tier.
    const candidates = new Map<string, ProviderAccount[]>();
    for (const conn of pending) {
      candidates.set(
        conn.id,
        available.filter((acc) => tier(conn, acc))
      );
    }

    for (const conn of pending) {
      const list = candidates.get(conn.id) ?? [];
      if (list.length !== 1) continue;

      const target = list[0];
      if (claimedAccountIds.has(target.externalId)) continue;

      const contested = pending.some((other) => {
        if (other.id === conn.id) return false;
        const otherList = candidates.get(other.id) ?? [];
        return otherList.length === 1 && otherList[0].externalId === target.externalId;
      });
      if (contested) continue;

      matched.push({ connectionId: conn.id, account: target });
      claimedAccountIds.add(target.externalId);
      matchedConnectionIds.add(conn.id);
    }
  }

  return {
    matched,
    unmatchedConnections: connections.filter((c) => !matchedConnectionIds.has(c.id)),
  };
}

/**
 * True when the user has dismissed this bank account. Matches on external id OR on
 * (institution, last four) — provider account ids are not stable across enrollments,
 * so without the second check an ignored account reappears after every merge.
 */
export function isAccountIgnored(
  account: { externalId: string; lastFour: string },
  institutionId: string,
  ignored: IgnoredRecord[]
): boolean {
  return ignored.some((row) => {
    if (row.externalAccountId === account.externalId) return true;
    return (
      row.institutionId === institutionId && !!row.lastFour && row.lastFour === account.lastFour
    );
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- bank-account-matching`
Expected: PASS — 16 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
npx tsc --noEmit
git add src/lib/bank-account-matching.ts tests/unit/lib/bank-account-matching.test.ts
git commit -m "feat: add pure matcher for reconciling bank accounts across enrollments"
```

---

### Task 2: IgnoredBankAccount model and API

**Files:**

- Modify: `prisma/schema.prisma` (append a new model)
- Create: `src/app/api/ignored-accounts/route.ts`
- Test: `tests/integration/api/ignored-accounts.test.ts`

**Interfaces:**

- Consumes: `isAccountIgnored`, `IgnoredRecord` from Task 1.
- Produces:
  - `GET /api/ignored-accounts` → `{ ignored: Array<{ id, provider, institutionId, externalAccountId, lastFour, name }> }`
  - `POST /api/ignored-accounts` body `{ provider, institutionId, externalAccountId, lastFour?, name? }` → the created row
  - `DELETE /api/ignored-accounts?id=<id>` → `{ success: true }`

- [ ] **Step 1: Add the Prisma model**

Append to `prisma/schema.prisma`:

```prisma
// A bank account the user explicitly declined to track. Keyed loosely on purpose:
// provider account ids are not stable across re-enrollments, so the (institutionId,
// lastFour) pair is the durable identity and externalAccountId is the fast path.
model IgnoredBankAccount {
  id                String   @id @default(uuid())
  provider          String   // 'teller' | 'plaid'
  institutionId     String
  externalAccountId String
  lastFour          String?
  name              String?  // display name captured at ignore time, for the Hidden list
  createdAt         DateTime @default(now())

  @@unique([provider, externalAccountId])
  @@index([provider, institutionId])
}
```

- [ ] **Step 2: Apply the schema and regenerate the client**

This repo's migration history has drifted — `prisma/dev.db` records two migrations whose folders were never committed, so `prisma migrate dev` fails with P3006. The project's actual workflow is `db push`; that is also how `tests/helpers/db.ts:31` builds every test database. Use it:

```bash
npx prisma db push
npx prisma generate
```

Do **not** pass `--accept-data-loss`. The change is purely additive (one new table), so `db push` should report no data loss. If it warns about dropping or altering anything, STOP and report BLOCKED — `prisma/dev.db` holds the user's real financial data.

Expected: `IgnoredBankAccount` available on the Prisma client as `prisma.ignoredBankAccount`. No migration folder is created, consistent with the repo's recent schema changes.

- [ ] **Step 3: Write the failing test**

Create `tests/integration/api/ignored-accounts.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

let testPrisma: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { GET, POST, DELETE } from '@/app/api/ignored-accounts/route';

function jsonRequest(url: string, method: string, body?: unknown): NextRequest {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }) as unknown as NextRequest;
}

describe('ignored-accounts API', () => {
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

  it('creates an ignore record', async () => {
    const res = await POST(
      jsonRequest('http://localhost/api/ignored-accounts', 'POST', {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_new_card',
        lastFour: '4242',
        name: 'Amazon Prime Card',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ignored.externalAccountId).toBe('acc_new_card');

    const rows = await prisma.ignoredBankAccount.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].lastFour).toBe('4242');
  });

  it('is idempotent when the same account is ignored twice', async () => {
    const payload = {
      provider: 'teller',
      institutionId: 'chase',
      externalAccountId: 'acc_new_card',
      lastFour: '4242',
    };

    await POST(jsonRequest('http://localhost/api/ignored-accounts', 'POST', payload));
    const res = await POST(jsonRequest('http://localhost/api/ignored-accounts', 'POST', payload));

    expect(res.status).toBe(200);
    expect(await prisma.ignoredBankAccount.count()).toBe(1);
  });

  it('lists ignore records', async () => {
    await prisma.ignoredBankAccount.create({
      data: {
        provider: 'plaid',
        institutionId: 'ins_1',
        externalAccountId: 'acc_1',
        lastFour: '1111',
      },
    });

    const res = await GET();
    const body = await res.json();

    expect(body.ignored).toHaveLength(1);
    expect(body.ignored[0].provider).toBe('plaid');
  });

  it('deletes an ignore record by id', async () => {
    const row = await prisma.ignoredBankAccount.create({
      data: {
        provider: 'teller',
        institutionId: 'chase',
        externalAccountId: 'acc_1',
        lastFour: '1111',
      },
    });

    const res = await DELETE(
      jsonRequest(`http://localhost/api/ignored-accounts?id=${row.id}`, 'DELETE')
    );

    expect(res.status).toBe(200);
    expect(await prisma.ignoredBankAccount.count()).toBe(0);
  });

  it('rejects a request with no id on delete', async () => {
    const res = await DELETE(jsonRequest('http://localhost/api/ignored-accounts', 'DELETE'));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:integration -- ignored-accounts`
Expected: FAIL — `Failed to resolve import "@/app/api/ignored-accounts/route"`.

- [ ] **Step 5: Write the implementation**

Create `src/app/api/ignored-accounts/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  provider: z.enum(['teller', 'plaid']),
  institutionId: z.string(),
  externalAccountId: z.string(),
  lastFour: z.string().optional(),
  name: z.string().optional(),
});

export async function GET() {
  const ignored = await prisma.ignoredBankAccount.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ ignored });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createSchema.parse(await req.json());

    // Upsert so re-ignoring an account the user already hid is a no-op rather than
    // a unique-constraint crash.
    const ignored = await prisma.ignoredBankAccount.upsert({
      where: {
        provider_externalAccountId: {
          provider: parsed.provider,
          externalAccountId: parsed.externalAccountId,
        },
      },
      create: {
        provider: parsed.provider,
        institutionId: parsed.institutionId,
        externalAccountId: parsed.externalAccountId,
        lastFour: parsed.lastFour ?? null,
        name: parsed.name ?? null,
      },
      update: {
        institutionId: parsed.institutionId,
        lastFour: parsed.lastFour ?? null,
        name: parsed.name ?? null,
      },
    });

    return NextResponse.json({ ignored });
  } catch (error: unknown) {
    console.error('[Ignored Accounts API POST] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to ignore account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Idempotent: a second delete of the same row succeeds.
  await prisma.ignoredBankAccount.deleteMany({ where: { id } });

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:integration -- ignored-accounts`
Expected: PASS — 5 tests.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint:fix
npx tsc --noEmit
git add prisma/schema.prisma src/app/api/ignored-accounts/route.ts tests/integration/api/ignored-accounts.test.ts
git commit -m "feat: add IgnoredBankAccount model and API"
```

---

### Task 3: Teller enrollment update and reconciliation route

The core of the fix. Handles both outcomes of re-running Teller Connect on an already-enrolled institution.

**Files:**

- Create: `src/app/api/teller/enrollment/update/route.ts`
- Test: `tests/integration/api/teller-enrollment-update.test.ts`

**Interfaces:**

- Consumes: `matchConnectionsToAccounts`, `ProviderAccount` from Task 1; `tellerFetch`, `TellerAccountsResponse`, `TellerAccount` from `@/lib/teller`; `encryptAccessToken` from `@/lib/encryption`.
- Produces: `POST /api/teller/enrollment/update` body `{ enrollmentId: string, accessToken: string }` →
  ```typescript
  {
    success: true,
    enrollmentId: string,        // FinanceOS DB id of the live enrollment
    merged: boolean,             // true when connections moved to a new enrollment row
    reconnected: number,         // connections now pointing at the live token
    discovered: ProviderAccount[],   // accounts with no connection
    unmatched: Array<{ connectionId: string; name: string | null; lastFour: string | null }>
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/teller-enrollment-update.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

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

vi.mock('@/lib/encryption', () => ({
  encryptAccessToken: vi.fn(() => ({ encrypted: 'enc', iv: 'iv' })),
  decryptAccessToken: vi.fn(() => 'decrypted'),
}));

import { POST } from '@/app/api/teller/enrollment/update/route';
import { tellerFetch } from '@/lib/teller';

function tellerAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc_new_checking',
    enrollment_id: 'enr_new',
    institution: { id: 'chase', name: 'Chase' },
    name: 'Personal Checking',
    type: 'depository',
    subtype: 'checking',
    currency: 'USD',
    last_four: '3857',
    status: 'open',
    ...overrides,
  };
}

function updateRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/teller/enrollment/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('teller enrollment update API', () => {
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

  async function seedEnrollment(enrollmentId: string) {
    return prisma.tellerEnrollment.create({
      data: {
        enrollmentId,
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'old-enc',
        accessTokenIv: 'old-iv',
        status: 'connected',
      },
    });
  }

  async function seedConnection(
    enrollmentDbId: string,
    overrides: { tellerAccountId: string; lastFour: string; name: string; subtype?: string }
  ) {
    const acct = await prisma.account.create({
      data: createAccountData({ name: overrides.name }),
    });
    return prisma.tellerConnection.create({
      data: {
        accountId: acct.id,
        tellerEnrollmentId: enrollmentDbId,
        tellerAccountId: overrides.tellerAccountId,
        tellerAccountName: overrides.name,
        tellerAccountType: 'depository',
        tellerAccountSubtype: overrides.subtype ?? 'checking',
        tellerAccountLastFour: overrides.lastFour,
        status: 'connected',
      },
    });
  }

  it('refreshes the token in place when the same enrollment id returns', async () => {
    const enrollment = await seedEnrollment('enr_same');
    await seedConnection(enrollment.id, {
      tellerAccountId: 'acc_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_checking', last_four: '3857' }),
      tellerAccount({ id: 'acc_new_card', last_four: '4242', name: 'Amazon Card', type: 'credit' }),
    ]);

    const res = await POST(
      updateRequest({ enrollmentId: 'enr_same', accessToken: 'fresh-token' })
    );
    const body = await res.json();

    expect(body.merged).toBe(false);
    expect(body.reconnected).toBe(1);
    expect(body.discovered).toHaveLength(1);
    expect(body.discovered[0].externalId).toBe('acc_new_card');

    const updated = await prisma.tellerEnrollment.findUnique({ where: { id: enrollment.id } });
    expect(updated?.accessTokenEncrypted).toBe('enc');
    expect(updated?.status).toBe('connected');
    expect(await prisma.tellerEnrollment.count()).toBe(1);
  });

  it('adopts prior connections and deletes the stale row when everything matches', async () => {
    const stale = await seedEnrollment('enr_old');
    const checking = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
      tellerAccount({
        id: 'acc_fresh_card',
        last_four: '4242',
        name: 'Amazon Card',
        type: 'credit',
        subtype: 'credit_card',
      }),
    ]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'fresh-token' }));
    const body = await res.json();

    expect(body.merged).toBe(true);
    expect(body.reconnected).toBe(1);
    expect(body.unmatched).toHaveLength(0);
    expect(body.discovered.map((a: { externalId: string }) => a.externalId)).toEqual([
      'acc_fresh_card',
    ]);

    // Stale row gone, connection moved onto the new enrollment with the new account id.
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    const moved = await prisma.tellerConnection.findUnique({ where: { id: checking.id } });
    expect(moved?.tellerEnrollmentId).toBe(body.enrollmentId);
    expect(moved?.tellerAccountId).toBe('acc_fresh_checking');
    expect(moved?.status).toBe('connected');
  });

  it('keeps the stale enrollment when a connection cannot be matched', async () => {
    const stale = await seedEnrollment('enr_old');
    const checking = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });
    const orphan = await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_closed',
      lastFour: '0000',
      name: 'Closed Savings',
      subtype: 'savings',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
    ]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'fresh-token' }));
    const body = await res.json();

    expect(body.reconnected).toBe(1);
    expect(body.unmatched).toHaveLength(1);
    expect(body.unmatched[0].connectionId).toBe(orphan.id);

    // Both enrollments survive, and crucially BOTH connections still exist —
    // deleting the stale row would cascade and destroy the orphan's linkage.
    expect(await prisma.tellerEnrollment.count()).toBe(2);
    expect(await prisma.tellerConnection.count()).toBe(2);

    const staleAfter = await prisma.tellerEnrollment.findUnique({ where: { id: stale.id } });
    expect(staleAfter?.status).toBe('disconnected');

    const movedChecking = await prisma.tellerConnection.findUnique({ where: { id: checking.id } });
    expect(movedChecking?.tellerEnrollmentId).toBe(body.enrollmentId);
  });

  it('creates a plain new enrollment when the institution is not already connected', async () => {
    vi.mocked(tellerFetch).mockResolvedValue([tellerAccount({ id: 'acc_a', last_four: '1111' })]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_first', accessToken: 'token' }));
    const body = await res.json();

    expect(body.merged).toBe(false);
    expect(body.reconnected).toBe(0);
    expect(body.discovered).toHaveLength(1);
    expect(await prisma.tellerEnrollment.count()).toBe(1);
  });

  it('is idempotent when the same payload is replayed', async () => {
    const stale = await seedEnrollment('enr_old');
    await seedConnection(stale.id, {
      tellerAccountId: 'acc_old_checking',
      lastFour: '3857',
      name: 'Personal Checking',
    });

    vi.mocked(tellerFetch).mockResolvedValue([
      tellerAccount({ id: 'acc_fresh_checking', last_four: '3857' }),
    ]);

    const first = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'token' }));
    const firstBody = await first.json();
    const second = await POST(updateRequest({ enrollmentId: 'enr_new', accessToken: 'token' }));
    const secondBody = await second.json();

    expect(secondBody.enrollmentId).toBe(firstBody.enrollmentId);
    expect(secondBody.reconnected).toBe(1);
    expect(await prisma.tellerEnrollment.count()).toBe(1);
    expect(await prisma.tellerConnection.count()).toBe(1);
  });

  it('returns 404 when the token resolves to no accounts and no institution is known', async () => {
    vi.mocked(tellerFetch).mockResolvedValue([]);

    const res = await POST(updateRequest({ enrollmentId: 'enr_empty', accessToken: 'token' }));

    expect(res.status).toBe(400);
    expect(await prisma.tellerEnrollment.count()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- teller-enrollment-update`
Expected: FAIL — `Failed to resolve import "@/app/api/teller/enrollment/update/route"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/api/teller/enrollment/update/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { encryptAccessToken } from '@/lib/encryption';
import { tellerFetch, type TellerAccount, type TellerAccountsResponse } from '@/lib/teller';
import { matchConnectionsToAccounts, type ProviderAccount } from '@/lib/bank-account-matching';

const schema = z.object({
  enrollmentId: z.string(),
  accessToken: z.string(),
});

function toProviderAccount(account: TellerAccount): ProviderAccount {
  return {
    externalId: account.id,
    name: account.name,
    type: account.type,
    subtype: account.subtype,
    lastFour: account.last_four,
  };
}

/**
 * Re-runs of Teller Connect against an already-enrolled institution land here.
 *
 * Two outcomes are possible and both must work:
 *   1. Teller returns the SAME enrollment id — refresh the stored token in place.
 *   2. Teller mints a NEW enrollment id — create it, then move the prior
 *      enrollment's connections onto the new token so the user keeps every
 *      existing account linkage (and its transaction history).
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.parse(await req.json());
    const { encrypted, iv } = encryptAccessToken(parsed.accessToken);

    const existing = await prisma.tellerEnrollment.findUnique({
      where: { enrollmentId: parsed.enrollmentId },
      include: { connections: true },
    });

    // ── Case 1: same enrollment came back ────────────────────────────────────
    if (existing) {
      await prisma.tellerEnrollment.update({
        where: { id: existing.id },
        data: { accessTokenEncrypted: encrypted, accessTokenIv: iv, status: 'connected' },
      });
      await prisma.tellerConnection.updateMany({
        where: { tellerEnrollmentId: existing.id },
        data: { status: 'connected', lastSyncError: null },
      });

      const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', parsed.accessToken);
      const linkedIds = new Set(existing.connections.map((c) => c.tellerAccountId));

      return NextResponse.json({
        success: true,
        enrollmentId: existing.id,
        merged: false,
        reconnected: existing.connections.length,
        discovered: accounts.filter((a) => !linkedIds.has(a.id)).map(toProviderAccount),
        unmatched: [],
      });
    }

    // ── Case 2: Teller minted a new enrollment ───────────────────────────────
    const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', parsed.accessToken);

    const institutionId = accounts[0]?.institution.id;
    const institutionName = accounts[0]?.institution.name;
    if (!institutionId || !institutionName) {
      // No accounts means we cannot tell which institution this token belongs to,
      // so we cannot safely reconcile it against anything. Store nothing.
      return NextResponse.json(
        { error: 'Could not determine the institution for this enrollment' },
        { status: 400 }
      );
    }

    const created = await prisma.tellerEnrollment.create({
      data: {
        enrollmentId: parsed.enrollmentId,
        institutionId,
        institutionName,
        accessTokenEncrypted: encrypted,
        accessTokenIv: iv,
        status: 'connected',
      },
    });

    const prior = await prisma.tellerEnrollment.findFirst({
      where: { institutionId, id: { not: created.id } },
      include: { connections: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!prior || prior.connections.length === 0) {
      // Nothing to adopt. Drop an empty stale row if one was sitting there.
      if (prior) {
        await prisma.tellerEnrollment.delete({ where: { id: prior.id } });
      }
      return NextResponse.json({
        success: true,
        enrollmentId: created.id,
        merged: false,
        reconnected: 0,
        discovered: accounts.map(toProviderAccount),
        unmatched: [],
      });
    }

    const result = matchConnectionsToAccounts(
      prior.connections.map((c) => ({
        id: c.id,
        externalId: c.tellerAccountId,
        name: c.tellerAccountName,
        type: c.tellerAccountType,
        subtype: c.tellerAccountSubtype,
        lastFour: c.tellerAccountLastFour,
      })),
      accounts.map(toProviderAccount)
    );

    for (const { connectionId, account } of result.matched) {
      await prisma.tellerConnection.update({
        where: { id: connectionId },
        data: {
          tellerEnrollmentId: created.id,
          tellerAccountId: account.externalId,
          tellerAccountName: account.name,
          tellerAccountType: account.type,
          tellerAccountSubtype: account.subtype,
          tellerAccountLastFour: account.lastFour,
          status: 'connected',
          lastSyncError: null,
        },
      });
    }

    if (result.unmatchedConnections.length === 0) {
      await prisma.tellerEnrollment.delete({ where: { id: prior.id } });
    } else {
      // Deleting would cascade and destroy the unmatched connections along with
      // their account linkage. Park the row as disconnected instead and let the
      // caller surface the leftovers for manual re-mapping.
      await prisma.tellerEnrollment.update({
        where: { id: prior.id },
        data: { status: 'disconnected' },
      });
    }

    const claimed = new Set(result.matched.map((m) => m.account.externalId));

    return NextResponse.json({
      success: true,
      enrollmentId: created.id,
      merged: true,
      reconnected: result.matched.length,
      discovered: accounts.filter((a) => !claimed.has(a.id)).map(toProviderAccount),
      unmatched: result.unmatchedConnections.map((c) => ({
        connectionId: c.id,
        name: c.name,
        lastFour: c.lastFour,
      })),
    });
  } catch (error: unknown) {
    console.error('[Teller Enrollment Update API] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to update enrollment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:integration -- teller-enrollment-update`
Expected: PASS — 6 tests.

- [ ] **Step 5: Lint and commit**

```bash
npm run lint:fix
npx tsc --noEmit
git add src/app/api/teller/enrollment/update tests/integration/api/teller-enrollment-update.test.ts
git commit -m "feat: reconcile Teller connections when re-enrollment mints a new enrollment id"
```

---

### Task 4: Normalize enrollment GETs to unlinked-only, with ignores applied

Both provider GETs must return the same shape so the UI stops branching. Teller currently returns every account; Plaid returns unlinked but no total.

**Files:**

- Modify: `src/app/api/teller/enrollment/route.ts:29-84` (the `enrollmentsWithAccounts` map in `GET`)
- Modify: `src/app/api/plaid/enrollment/route.ts:30-70` (the `enrollmentsWithAccounts` map in `GET`)
- Test: `tests/integration/api/enrollment-discovery.test.ts`

**Interfaces:**

- Consumes: `isAccountIgnored` from Task 1; `IgnoredBankAccount` model from Task 2.
- Produces: both GETs return per enrollment `{ ..., availableAccounts: ProviderAccount[], hiddenAccounts: ProviderAccount[], totalAccountCount: number }` where `availableAccounts` excludes linked **and** ignored accounts, `hiddenAccounts` holds the ignored ones, and `totalAccountCount` is every account the token can see.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/enrollment-discovery.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

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

vi.mock('@/lib/encryption', () => ({
  encryptAccessToken: vi.fn(() => ({ encrypted: 'enc', iv: 'iv' })),
  decryptAccessToken: vi.fn(() => 'decrypted'),
}));

import { GET } from '@/app/api/teller/enrollment/route';
import { tellerFetch } from '@/lib/teller';

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

    const body = await (await GET()).json();
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

    const body = await (await GET()).json();
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

    const body = await (await GET()).json();

    expect(body.enrollments[0].availableAccounts).toHaveLength(0);
    expect(body.enrollments[0].hiddenAccounts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- enrollment-discovery`
Expected: FAIL — `availableAccounts` still contains the linked account and items lack `externalId`.

- [ ] **Step 3: Update the Teller GET**

In `src/app/api/teller/enrollment/route.ts`, add imports:

```typescript
import { isAccountIgnored, type ProviderAccount } from '@/lib/bank-account-matching';
```

Inside `GET`, load ignores once before the `Promise.all`:

```typescript
const ignored = await prisma.ignoredBankAccount.findMany({ where: { provider: 'teller' } });
```

Replace the success branch of the per-enrollment map (currently returning `{ ...enrollment, availableAccounts: accounts, totalAccountCount: accounts.length }`) with:

```typescript
const accounts = await tellerFetch<TellerAccountsResponse>('/accounts', accessToken);

const linkedIds = new Set(enrollment.connections.map((c) => c.tellerAccountId));
const unlinked: ProviderAccount[] = accounts
  .filter((a) => !linkedIds.has(a.id))
  .map((a) => ({
    externalId: a.id,
    name: a.name,
    type: a.type,
    subtype: a.subtype,
    lastFour: a.last_four,
  }));

return {
  ...enrollment,
  // Unlinked only — the UI renders linked accounts from `connections`.
  availableAccounts: unlinked.filter(
    (a) => !isAccountIgnored(a, enrollment.institutionId, ignored)
  ),
  hiddenAccounts: unlinked.filter((a) => isAccountIgnored(a, enrollment.institutionId, ignored)),
  totalAccountCount: accounts.length,
};
```

Update both error branches to also return the new fields so the shape is stable:

```typescript
return {
  ...enrollment,
  status: 'disconnected',
  availableAccounts: [],
  hiddenAccounts: [],
  totalAccountCount: enrollment.connections.length,
};
```

(and the non-reauth error branch identically, without the `status` override).

- [ ] **Step 4: Update the Plaid GET**

In `src/app/api/plaid/enrollment/route.ts`, add the same import, load `ignored` with `provider: 'plaid'`, and replace the `availableAccounts` construction with the normalized shape:

```typescript
const linkedPlaidAccountIds = new Set(enrollment.connections.map((c) => c.plaidAccountId));
const unlinked: ProviderAccount[] = allAccounts
  .filter((acc) => !linkedPlaidAccountIds.has(acc.account_id))
  .map((acc) => ({
    externalId: acc.account_id,
    name: acc.name,
    type: acc.type,
    subtype: acc.subtype || '',
    lastFour: acc.mask || '',
  }));

const institutionKey = enrollment.institutionId ?? '';
```

Then in the returned object replace `availableAccounts,` with:

```typescript
availableAccounts: unlinked.filter((a) => !isAccountIgnored(a, institutionKey, ignored)),
hiddenAccounts: unlinked.filter((a) => isAccountIgnored(a, institutionKey, ignored)),
totalAccountCount: allAccounts.length,
```

Add `availableAccounts: []`, `hiddenAccounts: []`, and `totalAccountCount: enrollment.connections.length` to the Plaid error branches too.

- [ ] **Step 5: Patch the existing UI reads so nothing breaks mid-refactor**

`ConnectedInstitutions.tsx` currently reads `account.id` / `account.last_four` (Teller) and `account.account_id` / `account.mask` (Plaid) off `availableAccounts`, and derives the Plaid total from `linkedCount + availableCount`. Update the two `availableAccounts` render blocks to use `externalId` / `lastFour`, and change the Plaid count line to:

```typescript
{linkedCount} of {enrollment.totalAccountCount ?? linkedCount} accounts linked
```

Also update the local `TellerAccount`/`PlaidAccount` types at the top of the file to the normalized shape:

```typescript
type DiscoveredAccount = {
  externalId: string;
  name: string;
  type: string;
  subtype: string;
  lastFour: string;
};
```

Task 7 splits this file properly; this step only keeps it compiling and correct in between.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:integration -- enrollment-discovery`
Expected: PASS — 3 tests.

Run: `npm run test:integration && npm run test:unit`
Expected: PASS — no regressions elsewhere.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint:fix
npx tsc --noEmit
git add src/app/api/teller/enrollment/route.ts src/app/api/plaid/enrollment/route.ts src/components/teller/ConnectedInstitutions.tsx tests/integration/api/enrollment-discovery.test.ts
git commit -m "feat: return unlinked-only bank accounts with ignores applied"
```

---

### Task 5: Adopt endpoint — create a FinanceOS account and link it in one step

**Files:**

- Create: `src/lib/account-defaults.ts`
- Modify: `src/app/api/accounts/route.ts:5-9` (import the extracted helper instead of declaring it)
- Create: `src/app/api/bank-accounts/adopt/route.ts`
- Test: `tests/integration/api/bank-accounts-adopt.test.ts`

**Interfaces:**

- Consumes: `mapBankAccountType` from Task 1.
- Produces: `getDefaultTrackingMode(type: string): 'cash_flow' | 'balance_only'` and `BALANCE_ONLY_TYPES: string[]` from `src/lib/account-defaults.ts`.
- Produces: `POST /api/bank-accounts/adopt` body:
  ```typescript
  {
    provider: 'teller' | 'plaid',
    enrollmentId: string,        // FinanceOS DB id of the enrollment
    externalAccountId: string,
    name: string,                // user-editable, prefilled from the bank
    type: string,                // FinanceOS account type
    currency?: string,           // defaults 'USD'
    subtype?: string,
    lastFour?: string
  }
  ```
  → `{ success: true, account: Account }`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/api/bank-accounts-adopt.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import type { PrismaClient } from '@prisma/client';
import type { NextRequest } from 'next/server';

let testPrisma: PrismaClient;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));

import { POST } from '@/app/api/bank-accounts/adopt/route';

function adoptRequest(body: unknown): NextRequest {
  return new Request('http://localhost/api/bank-accounts/adopt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe('bank-accounts adopt API', () => {
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

  async function seedTellerEnrollment() {
    return prisma.tellerEnrollment.create({
      data: {
        enrollmentId: 'enr_1',
        institutionId: 'chase',
        institutionName: 'Chase',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
      },
    });
  }

  it('creates an account and a teller connection', async () => {
    const enrollment = await seedTellerEnrollment();

    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: enrollment.id,
        externalAccountId: 'acc_new_card',
        name: 'Amazon Prime Card',
        type: 'credit',
        subtype: 'credit_card',
        lastFour: '4242',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.account.name).toBe('Amazon Prime Card');
    expect(body.account.institution).toBe('Chase');
    expect(body.account.trackingMode).toBe('cash_flow');

    const connection = await prisma.tellerConnection.findUnique({
      where: { accountId: body.account.id },
    });
    expect(connection?.tellerAccountId).toBe('acc_new_card');
    expect(connection?.tellerEnrollmentId).toBe(enrollment.id);
  });

  it('applies the balance_only tracking default for non-cash-flow types', async () => {
    const enrollment = await seedTellerEnrollment();

    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: enrollment.id,
        externalAccountId: 'acc_loan',
        name: 'Auto Loan',
        type: 'loan',
      })
    );
    const body = await res.json();

    expect(body.account.trackingMode).toBe('balance_only');
  });

  it('rejects adopting an account that is already linked', async () => {
    const enrollment = await seedTellerEnrollment();
    const payload = {
      provider: 'teller',
      enrollmentId: enrollment.id,
      externalAccountId: 'acc_dup',
      name: 'Dup Card',
      type: 'credit',
    };

    await POST(adoptRequest(payload));
    const res = await POST(adoptRequest(payload));

    expect(res.status).toBe(409);
    expect(await prisma.account.count()).toBe(1);
  });

  it('returns 404 for an unknown enrollment', async () => {
    const res = await POST(
      adoptRequest({
        provider: 'teller',
        enrollmentId: 'does-not-exist',
        externalAccountId: 'acc_x',
        name: 'Ghost',
        type: 'credit',
      })
    );

    expect(res.status).toBe(404);
    expect(await prisma.account.count()).toBe(0);
  });

  it('creates an account and a plaid connection', async () => {
    const enrollment = await prisma.plaidEnrollment.create({
      data: {
        plaidItemId: 'item_1',
        institutionId: 'ins_1',
        institutionName: 'Bilt Rewards',
        accessTokenEncrypted: 'enc',
        accessTokenIv: 'iv',
        status: 'connected',
      },
    });

    const res = await POST(
      adoptRequest({
        provider: 'plaid',
        enrollmentId: enrollment.id,
        externalAccountId: 'plaid_acc_1',
        name: 'Bilt Card',
        type: 'credit',
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    const connection = await prisma.plaidConnection.findUnique({
      where: { accountId: body.account.id },
    });
    expect(connection?.plaidAccountId).toBe('plaid_acc_1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:integration -- bank-accounts-adopt`
Expected: FAIL — `Failed to resolve import "@/app/api/bank-accounts/adopt/route"`.

- [ ] **Step 3: Extract the tracking-mode default into a shared module**

`getDefaultTrackingMode` currently lives unexported in `src/app/api/accounts/route.ts:5-9`. Two routes now need it, and a copy would silently drift — a new balance-only type added to one list would leave the other creating `cash_flow` accounts. Move it.

Create `src/lib/account-defaults.ts`:

```typescript
/** Account types tracked by balance snapshots rather than individual transactions. */
export const BALANCE_ONLY_TYPES = ['brokerage', 'retirement', 'crypto', 'loan'];

export function getDefaultTrackingMode(type: string): 'cash_flow' | 'balance_only' {
  return BALANCE_ONLY_TYPES.includes(type) ? 'balance_only' : 'cash_flow';
}
```

In `src/app/api/accounts/route.ts`, delete the local `getDefaultTrackingMode` declaration and its comment, and import instead:

```typescript
import { getDefaultTrackingMode } from '@/lib/account-defaults';
```

The existing call site in `POST` is unchanged.

- [ ] **Step 4: Write the implementation**

Create `src/app/api/bank-accounts/adopt/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getDefaultTrackingMode } from '@/lib/account-defaults';

const schema = z.object({
  provider: z.enum(['teller', 'plaid']),
  enrollmentId: z.string(),
  externalAccountId: z.string(),
  name: z.string().min(1),
  type: z.string(),
  currency: z.string().default('USD'),
  subtype: z.string().optional(),
  lastFour: z.string().optional(),
});

/**
 * Turn a bank account the provider already exposes into a tracked FinanceOS account.
 * Creates the Account row and its provider connection together so a failure can't
 * leave an orphaned account with no way to sync.
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.parse(await req.json());

    const enrollment =
      parsed.provider === 'teller'
        ? await prisma.tellerEnrollment.findUnique({ where: { id: parsed.enrollmentId } })
        : await prisma.plaidEnrollment.findUnique({ where: { id: parsed.enrollmentId } });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    const alreadyLinked =
      parsed.provider === 'teller'
        ? await prisma.tellerConnection.findFirst({
            where: { tellerEnrollmentId: enrollment.id, tellerAccountId: parsed.externalAccountId },
          })
        : await prisma.plaidConnection.findFirst({
            where: { plaidEnrollmentId: enrollment.id, plaidAccountId: parsed.externalAccountId },
          });

    if (alreadyLinked) {
      return NextResponse.json(
        { error: 'This bank account is already linked' },
        { status: 409 }
      );
    }

    const maxSortOrder = await prisma.account.aggregate({ _max: { sortOrder: true } });
    const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          name: parsed.name,
          type: parsed.type,
          institution: enrollment.institutionName,
          currency: parsed.currency,
          isActive: true,
          sortOrder: nextSortOrder,
          trackingMode: getDefaultTrackingMode(parsed.type),
        },
      });

      if (parsed.provider === 'teller') {
        await tx.tellerConnection.create({
          data: {
            accountId: created.id,
            tellerEnrollmentId: enrollment.id,
            tellerAccountId: parsed.externalAccountId,
            tellerAccountName: parsed.name,
            tellerAccountType: parsed.type,
            tellerAccountSubtype: parsed.subtype ?? null,
            tellerAccountLastFour: parsed.lastFour ?? null,
            status: 'connected',
          },
        });
      } else {
        await tx.plaidConnection.create({
          data: {
            accountId: created.id,
            plaidEnrollmentId: enrollment.id,
            plaidAccountId: parsed.externalAccountId,
            plaidAccountName: parsed.name,
            status: 'connected',
          },
        });
      }

      return created;
    });

    return NextResponse.json({ success: true, account });
  } catch (error: unknown) {
    console.error('[Adopt Bank Account API] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to adopt account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

If `PlaidConnection` requires fields beyond those listed, read `prisma/schema.prisma:48-70` and supply them; do not make fields optional to work around a compile error.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:integration -- bank-accounts-adopt`
Expected: PASS — 5 tests.

Run: `npm run test:integration -- accounts`
Expected: PASS — the extraction in Step 3 must not change existing account-creation behavior.

- [ ] **Step 6: Lint and commit**

```bash
npm run lint:fix
npx tsc --noEmit
git add src/lib/account-defaults.ts src/app/api/accounts/route.ts src/app/api/bank-accounts/adopt tests/integration/api/bank-accounts-adopt.test.ts
git commit -m "feat: add endpoint to adopt a discovered bank account"
```

---

### Task 6: Update-mode entry points for both providers

Make the provider buttons usable from a healthy enrollment, and let Plaid's update mode change the account selection.

**Files:**

- Modify: `src/app/api/plaid/link-token/route.ts:35-41`
- Modify: `src/components/teller/TellerReconnectButton.tsx`
- Modify: `src/components/plaid/PlaidReconnectButton.tsx`
- Delete: `src/app/api/teller/enrollment/reconnect/route.ts`
- Test: `tests/unit/components/bank-update-buttons.test.tsx`

**Interfaces:**

- Consumes: `POST /api/teller/enrollment/update` from Task 3.
- Produces: both buttons accept `mode?: 'reconnect' | 'add-accounts'` (default `'reconnect'`) and `onResult?: (result: UpdateResult) => void`, where:
  ```typescript
  export type UpdateResult = {
    reconnected: number;
    discovered: Array<{ externalId: string; name: string; lastFour: string }>;
    unmatched: Array<{ connectionId: string; name: string | null; lastFour: string | null }>;
  };
  ```
  `UpdateResult` is exported from `src/components/institutions/types.ts` — create that file in this task; Task 7 adds the rest of its contents.

- [ ] **Step 1: Add account selection to the Plaid update-mode link token**

In `src/app/api/plaid/link-token/route.ts`, change the update-mode `linkTokenCreate` call to:

```typescript
const response = await plaid.linkTokenCreate({
  user: { client_user_id: 'user-1' },
  client_name: 'FinanceOS',
  country_codes: [CountryCode.Us, CountryCode.Ca],
  language: 'en',
  access_token: accessToken,
  // Lets the user add or remove accounts on the existing Item instead of
  // forcing a disconnect-and-relink to pick up a newly opened account.
  update: { account_selection_enabled: true },
});
```

- [ ] **Step 2: Create the shared result type**

Create `src/components/institutions/types.ts`:

```typescript
export type UpdateResult = {
  reconnected: number;
  discovered: Array<{ externalId: string; name: string; lastFour: string }>;
  unmatched: Array<{ connectionId: string; name: string | null; lastFour: string | null }>;
};
```

- [ ] **Step 3: Write the failing test**

Create `tests/unit/components/bank-update-buttons.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const openMock = vi.fn();
let capturedSetup: Record<string, unknown> = {};

beforeEach(() => {
  vi.clearAllMocks();
  capturedSetup = {};
  window.TellerConnect = {
    setup: (options: Record<string, unknown>) => {
      capturedSetup = options;
      return { open: openMock };
    },
  } as unknown as Window['TellerConnect'];

  global.fetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/api/teller/config')) {
      return {
        json: async () => ({ applicationId: 'app_test', environment: 'sandbox' }),
      } as Response;
    }
    return {
      json: async () => ({
        success: true,
        reconnected: 4,
        discovered: [{ externalId: 'acc_new', name: 'Amazon Card', lastFour: '4242' }],
        unmatched: [],
      }),
    } as Response;
  }) as unknown as typeof fetch;
});

import { TellerReconnectButton } from '@/components/teller/TellerReconnectButton';

describe('TellerReconnectButton', () => {
  it('renders Reconnect in the default mode', async () => {
    render(
      <TellerReconnectButton
        enrollmentId="enr_1"
        institutionName="Chase"
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    expect(screen.getByRole('button')).toHaveTextContent('Reconnect');
  });

  it('renders Add accounts in add-accounts mode', async () => {
    render(
      <TellerReconnectButton
        enrollmentId="enr_1"
        institutionName="Chase"
        mode="add-accounts"
        onSuccess={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    expect(screen.getByRole('button')).toHaveTextContent('Add accounts');
  });

  it('posts to the update route and reports the result', async () => {
    const onResult = vi.fn();
    const onSuccess = vi.fn();

    render(
      <TellerReconnectButton
        enrollmentId="enr_1"
        institutionName="Chase"
        mode="add-accounts"
        onResult={onResult}
        onSuccess={onSuccess}
      />
    );

    await waitFor(() => expect(screen.getByRole('button')).toBeEnabled());
    await userEvent.click(screen.getByRole('button'));
    expect(openMock).toHaveBeenCalled();

    // Drive Teller's callback the way the real widget would.
    const onTellerSuccess = capturedSetup.onSuccess as (payload: unknown) => Promise<void>;
    await onTellerSuccess({
      accessToken: 'fresh',
      enrollment: { id: 'enr_new', institution: { id: 'chase', name: 'Chase' } },
    });

    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(vi.mocked(global.fetch).mock.calls.some(([url]) =>
      String(url).includes('/api/teller/enrollment/update')
    )).toBe(true);
    expect(onResult.mock.calls[0][0].discovered).toHaveLength(1);
    expect(onSuccess).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm run test:unit -- bank-update-buttons`
Expected: FAIL — the button always says "Reconnect" and posts to `/api/teller/enrollment/reconnect`.

- [ ] **Step 5: Update `TellerReconnectButton`**

Change the props interface and the pieces that depend on `mode`:

```typescript
import type { UpdateResult } from '@/components/institutions/types';

interface TellerReconnectButtonProps {
  enrollmentId: string;
  institutionName: string;
  /**
   * Our DB id for the enrollment the user is acting on. Sent to the update route so it
   * adopts exactly this enrollment's connections when Teller mints a new enrollment id,
   * instead of guessing by institution — two logins at one bank would otherwise collide.
   */
  priorEnrollmentId?: string;
  /** 'reconnect' repairs a dead enrollment; 'add-accounts' re-runs Connect on a healthy one. */
  mode?: 'reconnect' | 'add-accounts';
  onSuccess: () => void;
  onResult?: (result: UpdateResult) => void;
  onExit?: () => void;
  className?: string;
  variant?: 'primary' | 'ghost' | 'outline' | 'destructive';
}
```

Destructure `mode = 'reconnect'`, `priorEnrollmentId`, and `onResult` alongside the existing props, and add `priorEnrollmentId` to the setup `useEffect` dependency array along with `mode` and `onResult`. Replace the body of the Teller `onSuccess` handler's fetch with the update route, which handles both the same-id and new-id cases:

```typescript
const response = await fetch('/api/teller/enrollment/update', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    enrollmentId: payload.enrollment.id,
    accessToken: payload.accessToken,
    ...(priorEnrollmentId ? { priorEnrollmentId } : {}),
  }),
});

const data = await response.json();

if (data.error) {
  console.error('[TellerUpdate] Error updating enrollment:', data.error);
  setError(data.error);
  setReconnecting(false);
  return;
}

onResult?.({
  reconnected: data.reconnected ?? 0,
  discovered: data.discovered ?? [],
  unmatched: data.unmatched ?? [],
});
onSuccess();
```

Add `mode` and `onResult` to the setup `useEffect` dependency array. Replace the button label expression with:

```typescript
{loading
  ? 'Loading...'
  : reconnecting
    ? mode === 'add-accounts'
      ? 'Checking...'
      : 'Reconnecting...'
    : mode === 'add-accounts'
      ? 'Add accounts'
      : 'Reconnect'}
```

Then delete `src/app/api/teller/enrollment/reconnect/route.ts`. The new update route strictly supersedes it: for a returning enrollment id it does everything the old route did (re-encrypt the token, set the enrollment and its connections back to `connected`, clear `lastSyncError`), and it additionally handles the new-enrollment-id case. Leaving it would strand a second, subtly weaker code path that a future caller could wire up by mistake.

Confirm nothing else references it before deleting:

```bash
grep -rn "enrollment/reconnect" src tests
```

Expected: only Plaid's `/api/plaid/enrollment/reconnect` hits remain (a different route, still in use).

- [ ] **Step 6: Update `PlaidReconnectButton`**

Plaid keeps the same Item and access token through update mode, so `add-accounts` reuses the existing reconnect endpoint. Add the same `mode` prop and swap the labels:

```typescript
interface PlaidReconnectButtonProps {
  enrollmentId: string;
  mode?: 'reconnect' | 'add-accounts';
  onSuccess: () => void;
  onExit?: () => void;
  className?: string;
  buttonText?: string;
}
```

Label expression:

```typescript
{loading
  ? 'Loading...'
  : reconnecting
    ? 'Working...'
    : (buttonText ?? (mode === 'add-accounts' ? 'Add accounts' : 'Reconnect'))}
```

And the error label:

```typescript
{mode === 'add-accounts' ? 'Add Accounts Error' : 'Reconnect Error'}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm run test:unit -- bank-update-buttons`
Expected: PASS — 3 tests.

- [ ] **Step 8: Lint and commit**

```bash
npm run lint:fix
npx tsc --noEmit
git add src/app/api/plaid/link-token/route.ts src/components/teller/TellerReconnectButton.tsx src/components/plaid/PlaidReconnectButton.tsx src/components/institutions/types.ts tests/unit/components/bank-update-buttons.test.tsx
git rm src/app/api/teller/enrollment/reconnect/route.ts
git commit -m "feat: allow update-mode Connect and Link from healthy enrollments"
```

---

### Task 7: Split ConnectedInstitutions into provider-agnostic components

Pure refactor. No behavior change — this exists so Task 8 adds discovery UI once rather than twice.

**Files:**

- Create: `src/components/institutions/normalize.ts`
- Create: `src/components/institutions/BankAccountRow.tsx`
- Create: `src/components/institutions/InstitutionCard.tsx`
- Create: `src/components/institutions/ConnectedInstitutions.tsx` (moved from `src/components/teller/`)
- Modify: `src/components/institutions/types.ts` (add the view model)
- Delete: `src/components/teller/ConnectedInstitutions.tsx`
- Modify: `src/app/(routes)/settings/page.tsx:34` (import path)
- Test: `tests/unit/components/institutions-normalize.test.ts`

**Interfaces:**

- Consumes: `UpdateResult` from Task 6.
- Produces (in `src/components/institutions/types.ts`):
  ```typescript
  export type Provider = 'teller' | 'plaid';

  export type DiscoveredAccount = {
    externalId: string;
    name: string;
    type: string;
    subtype: string;
    lastFour: string;
  };

  export type LinkedAccount = {
    connectionId: string;
    externalId: string;
    bankAccountName: string | null;
    linkedAccountName: string;
    status: string;
  };

  export type InstitutionView = {
    key: string;                  // `${provider}-${id}`, for React keys and expansion state
    provider: Provider;
    id: string;                   // FinanceOS enrollment DB id
    updateTargetId: string;       // what the update button needs: Teller's enrollmentId, Plaid's DB id
    institutionId: string;
    institutionName: string;
    status: string;
    linked: LinkedAccount[];
    discovered: DiscoveredAccount[];
    hidden: DiscoveredAccount[];
    totalAccountCount: number;
  };
  ```
  And `normalizeTellerEnrollment(raw) => InstitutionView`, `normalizePlaidEnrollment(raw) => InstitutionView` in `normalize.ts`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/institutions-normalize.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  normalizeTellerEnrollment,
  normalizePlaidEnrollment,
} from '@/components/institutions/normalize';

describe('normalizeTellerEnrollment', () => {
  it('maps a Teller enrollment onto the shared view model', () => {
    const view = normalizeTellerEnrollment({
      id: 'db-1',
      enrollmentId: 'enr_1',
      institutionId: 'chase',
      institutionName: 'Chase',
      status: 'connected',
      totalAccountCount: 3,
      connections: [
        {
          id: 'conn-1',
          tellerAccountId: 'acc_1',
          tellerAccountName: 'Personal Checking',
          status: 'connected',
          account: { id: 'a1', name: 'Chase Checking' },
        },
      ],
      availableAccounts: [
        { externalId: 'acc_2', name: 'Amazon Card', type: 'credit', subtype: 'credit_card', lastFour: '4242' },
      ],
      hiddenAccounts: [],
    });

    expect(view.key).toBe('teller-db-1');
    expect(view.updateTargetId).toBe('enr_1');
    expect(view.linked).toEqual([
      {
        connectionId: 'conn-1',
        externalId: 'acc_1',
        bankAccountName: 'Personal Checking',
        linkedAccountName: 'Chase Checking',
        status: 'connected',
      },
    ]);
    expect(view.discovered).toHaveLength(1);
    expect(view.totalAccountCount).toBe(3);
  });

  it('falls back to the linked count when the total is missing', () => {
    const view = normalizeTellerEnrollment({
      id: 'db-1',
      enrollmentId: 'enr_1',
      institutionId: 'chase',
      institutionName: 'Chase',
      status: 'disconnected',
      connections: [
        {
          id: 'conn-1',
          tellerAccountId: 'acc_1',
          tellerAccountName: 'Checking',
          status: 'connected',
          account: { id: 'a1', name: 'Chase Checking' },
        },
      ],
    });

    expect(view.totalAccountCount).toBe(1);
    expect(view.discovered).toEqual([]);
    expect(view.hidden).toEqual([]);
  });
});

describe('normalizePlaidEnrollment', () => {
  it('uses the DB id as the update target', () => {
    const view = normalizePlaidEnrollment({
      id: 'db-9',
      plaidItemId: 'item_9',
      institutionId: 'ins_9',
      institutionName: 'Bilt Rewards',
      status: 'connected',
      totalAccountCount: 2,
      connections: [
        {
          id: 'pc-1',
          plaidAccountId: 'pacc_1',
          plaidAccountName: 'Bilt Card',
          status: 'connected',
          account: { id: 'a9', name: 'Bilt' },
        },
      ],
      availableAccounts: [
        { externalId: 'pacc_2', name: 'New Card', type: 'credit', subtype: 'credit_card', lastFour: '9999' },
      ],
      hiddenAccounts: [],
    });

    expect(view.key).toBe('plaid-db-9');
    expect(view.updateTargetId).toBe('db-9');
    expect(view.institutionId).toBe('ins_9');
    expect(view.discovered[0].externalId).toBe('pacc_2');
  });

  it('tolerates a null institutionId', () => {
    const view = normalizePlaidEnrollment({
      id: 'db-9',
      plaidItemId: 'item_9',
      institutionId: null,
      institutionName: 'Unknown Bank',
      status: 'connected',
      connections: [],
    });

    expect(view.institutionId).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- institutions-normalize`
Expected: FAIL — `Failed to resolve import "@/components/institutions/normalize"`.

- [ ] **Step 3: Add the view model types**

Append the `Provider`, `DiscoveredAccount`, `LinkedAccount`, and `InstitutionView` types from the Interfaces block above to `src/components/institutions/types.ts`.

- [ ] **Step 4: Write `normalize.ts`**

Create `src/components/institutions/normalize.ts`:

```typescript
import type { DiscoveredAccount, InstitutionView } from './types';

type RawConnection = {
  id: string;
  status?: string;
  account: { id: string; name: string };
};

type RawTellerEnrollment = {
  id: string;
  enrollmentId: string;
  institutionId: string;
  institutionName: string;
  status: string;
  totalAccountCount?: number;
  connections: Array<RawConnection & { tellerAccountId: string; tellerAccountName: string | null }>;
  availableAccounts?: DiscoveredAccount[];
  hiddenAccounts?: DiscoveredAccount[];
};

type RawPlaidEnrollment = {
  id: string;
  plaidItemId: string;
  institutionId: string | null;
  institutionName: string;
  status: string;
  totalAccountCount?: number;
  connections: Array<RawConnection & { plaidAccountId: string; plaidAccountName: string | null }>;
  availableAccounts?: DiscoveredAccount[];
  hiddenAccounts?: DiscoveredAccount[];
};

export function normalizeTellerEnrollment(raw: RawTellerEnrollment): InstitutionView {
  return {
    key: `teller-${raw.id}`,
    provider: 'teller',
    id: raw.id,
    // Teller Connect's update mode keys off the provider's enrollment id, not ours.
    updateTargetId: raw.enrollmentId,
    institutionId: raw.institutionId,
    institutionName: raw.institutionName,
    status: raw.status,
    linked: raw.connections.map((c) => ({
      connectionId: c.id,
      externalId: c.tellerAccountId,
      bankAccountName: c.tellerAccountName,
      linkedAccountName: c.account.name,
      status: c.status ?? 'connected',
    })),
    discovered: raw.availableAccounts ?? [],
    hidden: raw.hiddenAccounts ?? [],
    totalAccountCount: raw.totalAccountCount ?? raw.connections.length,
  };
}

export function normalizePlaidEnrollment(raw: RawPlaidEnrollment): InstitutionView {
  return {
    key: `plaid-${raw.id}`,
    provider: 'plaid',
    id: raw.id,
    // Plaid's update mode takes our DB id; the route resolves the access token.
    updateTargetId: raw.id,
    institutionId: raw.institutionId ?? '',
    institutionName: raw.institutionName,
    status: raw.status,
    linked: raw.connections.map((c) => ({
      connectionId: c.id,
      externalId: c.plaidAccountId,
      bankAccountName: c.plaidAccountName,
      linkedAccountName: c.account.name,
      status: c.status ?? 'connected',
    })),
    discovered: raw.availableAccounts ?? [],
    hidden: raw.hiddenAccounts ?? [],
    totalAccountCount: raw.totalAccountCount ?? raw.connections.length,
  };
}
```

- [ ] **Step 5: Extract `BankAccountRow`**

Create `src/components/institutions/BankAccountRow.tsx`:

```typescript
'use client';

import { ds } from '@/lib/design-system';
import type { LinkedAccount } from './types';

export function BankAccountRow({ account }: { account: LinkedAccount }) {
  return (
    <div className={`p-3 rounded border ${ds.border.default} ${ds.bg.primary}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className={`text-sm font-medium ${ds.text.primary}`}>
            {account.bankAccountName || 'Unknown Account'}
          </span>
          <p className={`text-xs ${ds.text.muted} mt-1`}>Linked to: {account.linkedAccountName}</p>
        </div>
        <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
          Linked
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Extract `InstitutionCard`**

Create `src/components/institutions/InstitutionCard.tsx` containing the per-enrollment markup currently duplicated in both branches of `ConnectedInstitutions.tsx`: the clickable header (institution name, provider chip, `StatusBadge`, "*n* of *m* accounts linked"), the expanded body listing `view.linked` via `BankAccountRow`, and the action row (Reconnect when `status` is `disconnected`/`needs_reauth`/`error`, plus Disconnect). Move `StatusBadge` into this file.

Props:

```typescript
interface InstitutionCardProps {
  view: InstitutionView;
  isExpanded: boolean;
  onToggle: () => void;
  disconnecting: boolean;
  onDisconnect: () => void;
  onRefresh: () => void;
}
```

Render the provider chip from `view.provider` (`'Teller'` / `'Plaid'`) and pick the reconnect button by provider: `TellerReconnectButton` with `enrollmentId={view.updateTargetId}`, `institutionName={view.institutionName}`, and `priorEnrollmentId={view.id}`, or `PlaidReconnectButton` with `enrollmentId={view.updateTargetId}`.

`priorEnrollmentId` matters on the reconnect path too: repairing a dead Teller enrollment can also come back with a new enrollment id, and that is exactly when the connections need adopting onto the right row.

- [ ] **Step 7: Rewrite `ConnectedInstitutions` as a list container**

Create `src/components/institutions/ConnectedInstitutions.tsx`. It keeps the existing fetch, disconnect, connect-menu, and collapse behavior, but stores a single `InstitutionView[]`:

```typescript
const [institutions, setInstitutions] = useState<InstitutionView[]>([]);
```

built in `fetchEnrollments` as:

```typescript
setInstitutions([
  ...(tellerData.enrollments ?? []).map(normalizeTellerEnrollment),
  ...(plaidData.enrollments ?? []).map(normalizePlaidEnrollment),
]);
```

`handleDisconnect(view)` picks the DELETE URL from `view.provider`, replacing the two near-identical handlers. The render body becomes `institutions.map((view) => <InstitutionCard ... />)`, and `totalConnections` becomes `institutions.length`.

Delete `src/components/teller/ConnectedInstitutions.tsx` and update the import in `src/app/(routes)/settings/page.tsx:34` to `@/components/institutions/ConnectedInstitutions`.

- [ ] **Step 8: Run tests and verify no behavior change**

```bash
npm run test:unit -- institutions-normalize
npx tsc --noEmit
npm run lint
npm run build
```

Expected: normalize tests PASS (4 tests), typecheck clean, build succeeds.

Then start the app (`npm run dev`), open `/settings?tab=accounts`, expand Chase, and confirm the card renders exactly as before: institution name, Teller chip, status badge, "4 of 4 accounts linked", the four linked accounts, and a Disconnect button.

- [ ] **Step 9: Commit**

```bash
npm run lint:fix
git add src/components/institutions src/app/\(routes\)/settings/page.tsx tests/unit/components/institutions-normalize.test.ts
git rm src/components/teller/ConnectedInstitutions.tsx
git commit -m "refactor: split ConnectedInstitutions into provider-agnostic components"
```

---

### Task 8: Discovered-account UI — badge, Add, Ignore, Hidden

**Files:**

- Create: `src/components/institutions/DiscoveredAccountRow.tsx`
- Create: `src/components/institutions/AdoptAccountModal.tsx`
- Modify: `src/components/institutions/InstitutionCard.tsx`
- Test: `tests/unit/components/discovered-account-row.test.tsx`

**Interfaces:**

- Consumes: `DiscoveredAccount`, `InstitutionView` from Task 7; `POST /api/bank-accounts/adopt` from Task 5; `POST/DELETE /api/ignored-accounts` from Task 2; `mapBankAccountType` from Task 1.
- Produces: `DiscoveredAccountRow` and `AdoptAccountModal` components, consumed only by `InstitutionCard`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/components/discovered-account-row.test.tsx`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DiscoveredAccountRow } from '@/components/institutions/DiscoveredAccountRow';

const account = {
  externalId: 'acc_new',
  name: 'Amazon Prime Card',
  type: 'credit',
  subtype: 'credit_card',
  lastFour: '4242',
};

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn(async () => ({ json: async () => ({ success: true }) }) as Response) as
    unknown as typeof fetch;
});

describe('DiscoveredAccountRow', () => {
  it('shows the account name and last four', () => {
    render(
      <DiscoveredAccountRow
        account={account}
        institutionId="chase"
        provider="teller"
        onAdopt={vi.fn()}
        onChanged={vi.fn()}
      />
    );

    expect(screen.getByText('Amazon Prime Card')).toBeInTheDocument();
    expect(screen.getByText(/4242/)).toBeInTheDocument();
  });

  it('calls onAdopt with the account when Add is clicked', async () => {
    const onAdopt = vi.fn();
    render(
      <DiscoveredAccountRow
        account={account}
        institutionId="chase"
        provider="teller"
        onAdopt={onAdopt}
        onChanged={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdopt).toHaveBeenCalledWith(account);
  });

  it('posts an ignore record and refreshes when Ignore is clicked', async () => {
    const onChanged = vi.fn();
    render(
      <DiscoveredAccountRow
        account={account}
        institutionId="chase"
        provider="teller"
        onAdopt={vi.fn()}
        onChanged={onChanged}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Ignore' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(String(url)).toBe('/api/ignored-accounts');
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      provider: 'teller',
      institutionId: 'chase',
      externalAccountId: 'acc_new',
      lastFour: '4242',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- discovered-account-row`
Expected: FAIL — `Failed to resolve import "@/components/institutions/DiscoveredAccountRow"`.

- [ ] **Step 3: Write `DiscoveredAccountRow`**

Create `src/components/institutions/DiscoveredAccountRow.tsx`:

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ds } from '@/lib/design-system';
import type { DiscoveredAccount, Provider } from './types';

interface DiscoveredAccountRowProps {
  account: DiscoveredAccount;
  institutionId: string;
  provider: Provider;
  onAdopt: (account: DiscoveredAccount) => void;
  onChanged: () => void;
}

export function DiscoveredAccountRow({
  account,
  institutionId,
  provider,
  onAdopt,
  onChanged,
}: DiscoveredAccountRowProps) {
  const [ignoring, setIgnoring] = useState(false);

  const handleIgnore = async () => {
    setIgnoring(true);
    try {
      const res = await fetch('/api/ignored-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          institutionId,
          externalAccountId: account.externalId,
          lastFour: account.lastFour,
          name: account.name,
        }),
      });
      const data = await res.json();
      if (data.error) {
        console.error('Failed to ignore account:', data.error);
        return;
      }
      onChanged();
    } catch (error) {
      console.error('Exception ignoring account:', error);
    } finally {
      setIgnoring(false);
    }
  };

  return (
    <div className={`p-3 rounded border border-[var(--accent)]/40 ${ds.bg.primary}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${ds.text.primary}`}>{account.name}</span>
            <span className={`text-xs ${ds.text.muted}`}>•••• {account.lastFour}</span>
          </div>
          <p className={`text-xs ${ds.text.muted} mt-1`}>{account.subtype || account.type}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button disabled={ignoring} variant="ghost" onClick={handleIgnore}>
            Ignore
          </Button>
          <Button onClick={() => onAdopt(account)}>Add</Button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `AdoptAccountModal`**

Create `src/components/institutions/AdoptAccountModal.tsx`. It renders the existing `Modal` component with a prefilled, editable form and posts to the adopt endpoint:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { ds } from '@/lib/design-system';
import { mapBankAccountType } from '@/lib/bank-account-matching';
import type { DiscoveredAccount, Provider } from './types';

const ACCOUNT_TYPES = [
  'checking',
  'credit',
  'brokerage',
  'retirement',
  'crypto',
  'cash',
  'loan',
  'other',
];

interface AdoptAccountModalProps {
  account: DiscoveredAccount | null;
  provider: Provider;
  enrollmentId: string;
  institutionName: string;
  onClose: () => void;
  onAdopted: () => void;
}

export function AdoptAccountModal({
  account,
  provider,
  enrollmentId,
  institutionName,
  onClose,
  onAdopted,
}: AdoptAccountModalProps) {
  const [name, setName] = useState('');
  const [type, setType] = useState('other');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!account) return;
    setName(account.name);
    setType(mapBankAccountType(account.type));
    setError(null);
  }, [account]);

  const handleSubmit = async () => {
    if (!account) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/bank-accounts/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          enrollmentId,
          externalAccountId: account.externalId,
          name,
          type,
          subtype: account.subtype,
          lastFour: account.lastFour,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      onAdopted();
      onClose();
    } catch (_err) {
      setError('Failed to add account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={!!account} title="Add Account" onClose={onClose}>
      <div className="space-y-4">
        <p className={`text-sm ${ds.text.secondary}`}>
          Track <span className="font-semibold">{account?.name}</span> (••••{account?.lastFour}) from{' '}
          {institutionName}.
        </p>

        <div>
          <label className={`block text-sm ${ds.text.secondary} mb-1`}>Account name</label>
          <input
            className={`w-full rounded border ${ds.border.default} ${ds.bg.primary} ${ds.text.primary} px-3 py-2 text-sm`}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div>
          <label className={`block text-sm ${ds.text.secondary} mb-1`}>Type</label>
          <Select className="w-full" value={type} onChange={(e) => setType(e.target.value)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        </div>

        {error && <p className={`text-sm ${ds.status.error.text}`}>{error}</p>}

        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1" disabled={saving || !name.trim()} onClick={handleSubmit}>
            {saving ? 'Adding...' : 'Add Account'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
```

Check `src/components/ui/modal.tsx` and `src/components/ui/select.tsx` for their real export names and prop signatures before writing this; match them exactly rather than assuming.

- [ ] **Step 5: Wire discovery into `InstitutionCard`**

In `InstitutionCard.tsx`:

1. Add a badge next to the status badge when `view.discovered.length > 0`:

```typescript
{view.discovered.length > 0 && (
  <span className="text-xs px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
    {view.discovered.length} new {view.discovered.length === 1 ? 'account' : 'accounts'}
  </span>
)}
```

2. In the expanded body, above the linked accounts, render a "New accounts" section mapping `view.discovered` through `DiscoveredAccountRow`, passing `institutionId={view.institutionId}`, `provider={view.provider}`, `onAdopt={setAdopting}`, and `onChanged={onRefresh}`.

3. Below the linked accounts, render a collapsible `Hidden ({view.hidden.length})` section when `view.hidden.length > 0`. Each row shows the name and last four with a **Restore** button that calls `DELETE /api/ignored-accounts?id=...`. Because the enrollment GET returns hidden accounts without their ignore-record id, fetch `/api/ignored-accounts` when the section is first expanded and match on `externalAccountId`, falling back to `institutionId` + `lastFour` — the same pairing rule `isAccountIgnored` uses.

4. Hold the adopt target in local state and render the modal:

```typescript
const [adopting, setAdopting] = useState<DiscoveredAccount | null>(null);
```

```typescript
<AdoptAccountModal
  account={adopting}
  provider={view.provider}
  enrollmentId={view.id}
  institutionName={view.institutionName}
  onClose={() => setAdopting(null)}
  onAdopted={onRefresh}
/>
```

Note `enrollmentId={view.id}` — the adopt endpoint takes the FinanceOS DB id, not `updateTargetId`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test:unit -- discovered-account-row`
Expected: PASS — 3 tests.

Run: `npm run test:unit && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Lint and commit**

```bash
npm run lint:fix
git add src/components/institutions tests/unit/components/discovered-account-row.test.tsx
git commit -m "feat: surface discovered bank accounts with add and ignore actions"
```

---

### Task 9: Wire the Add accounts button and result summary

**Files:**

- Modify: `src/components/institutions/InstitutionCard.tsx`
- Test: manual verification against the real app

**Interfaces:**

- Consumes: `UpdateResult` from Task 6; the update buttons from Task 6.

- [ ] **Step 1: Add the button and summary state**

In `InstitutionCard.tsx`, add:

```typescript
const [lastResult, setLastResult] = useState<UpdateResult | null>(null);
```

In the action row, render an update-mode button for every enrollment regardless of status, alongside the existing Reconnect (which stays gated on `disconnected` / `needs_reauth` / `error`):

```typescript
{view.provider === 'teller' ? (
  <TellerReconnectButton
    enrollmentId={view.updateTargetId}
    institutionName={view.institutionName}
    priorEnrollmentId={view.id}
    mode="add-accounts"
    variant="outline"
    onResult={setLastResult}
    onSuccess={onRefresh}
  />
) : (
  <PlaidReconnectButton
    enrollmentId={view.updateTargetId}
    mode="add-accounts"
    onSuccess={onRefresh}
  />
)}
```

- [ ] **Step 2: Render the summary**

Above the accounts list in the expanded body:

```typescript
{lastResult && (
  <div className={`mb-4 p-3 rounded ${ds.status.success.bg} ${ds.status.success.text} text-sm`}>
    <div>
      {lastResult.reconnected} {lastResult.reconnected === 1 ? 'account' : 'accounts'} reconnected
      {' · '}
      {lastResult.discovered.length} new{' '}
      {lastResult.discovered.length === 1 ? 'account' : 'accounts'} found
    </div>
    {lastResult.unmatched.length > 0 && (
      <div className={`mt-2 ${ds.status.warning.text}`}>
        Could not match: {lastResult.unmatched.map((u) => u.name ?? 'Unknown').join(', ')}. Link
        these from the account&apos;s settings.
      </div>
    )}
  </div>
)}
```

Verify `ds.status.warning` exists in `src/lib/design-system.ts`; if the shape differs, use whatever warning tokens that file actually exports.

- [ ] **Step 3: Verify the whole suite still passes**

```bash
npm run check
npm test
```

Expected: typecheck, lint, format, and all unit + integration tests pass.

- [ ] **Step 4: Manual verification against the real Chase enrollment**

Run `npm run dev` and open `http://localhost:3000/settings?tab=accounts`.

1. Expand **Connected Institutions** → Chase. Confirm it shows "4 of 4 accounts linked" and the four existing accounts, unchanged.
2. Click **Add accounts**. Complete Chase's auth flow, selecting the new credit card.
3. Confirm the summary reads "4 accounts reconnected · 1 new account found" with no entries under "Could not match".
4. Confirm the header shows a **1 new account** badge and the card appears under "New accounts".
5. Click **Ignore**, confirm it moves to **Hidden (1)**, then **Restore** and confirm it returns.
6. Click **Add**, adjust the name if needed, submit. Confirm a new account appears in the accounts list with institution "Chase".
7. Open the new account's modal and click **Sync Now**. Confirm transactions import.
8. Open one of the four pre-existing Chase accounts, click **Sync Now**, and confirm the sync result reports 0 added (or only genuinely new transactions) — **not** a flood of duplicates. This is the check that the token swap didn't break `importHash` dedup.

If step 8 shows duplicates, stop and investigate before merging; do not paper over it by changing dedup logic.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/components/institutions/InstitutionCard.tsx
git commit -m "feat: add accounts to a connected institution without disconnecting"
```

---

## Self-Review Notes

Checked against the spec:

- §2 trigger — Task 6 (both providers) and Task 9 (surfaced on healthy enrollments).
- §3 reconciliation, all four matcher tiers, ambiguity rule, stale-row disposal — Tasks 1 and 3.
- §3 summary with unmatched listed — Task 9 Step 2.
- §4 discovery, badge, Add/Ignore/Hidden, adopt endpoint, type mapping, `IgnoredBankAccount` with last-four fallback — Tasks 1, 2, 4, 5, 8.
- §4 `totalAccountCount` correction — Task 4 Steps 3–5.
- §5 component split — Task 7.
- §6 all listed test cases — Tasks 1, 3, 4, 5, plus manual steps in Task 9.

Naming is consistent across tasks: `ProviderAccount.externalId`/`lastFour` throughout, `matchConnectionsToAccounts` returns `{ matched, unmatchedConnections }`, `InstitutionView.id` is the FinanceOS DB id while `updateTargetId` is what the provider's update flow needs, and the adopt endpoint takes `view.id` (called out explicitly in Task 8 Step 5 because the two are easy to confuse).
