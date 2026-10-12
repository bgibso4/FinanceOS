# Investment Accounts — Plan 3: Investments Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `/investments` page from the approved mock (navigator + scoped detail with chart, holdings map, allocation, holdings and activity, and every edge state), plus the read API and the editors it needs: record a manual balance, edit a valued account's holdings (including cash) and fix an unpriced security.

**Architecture:** One read model and thin UI. On the server, `CurrentHoldingsReader` turns the latest holdings snapshots into priced rows. `InvestmentOverviewService` assembles everything the page shows for one range into one `InvestmentOverview` payload: account summaries with base-currency series and status, holdings rows, activity and price freshness. It reuses `ValueHistoryService`, `getAccountBalances` and `PriceRefresher.freshness`, and is served by `GET /api/investments/overview?range=`. Pure helpers hold the page rules so they can be unit-tested without a DB or DOM:
- `portfolio-view.ts`: ranges, groups, wrappers and change.
- `holdings-view.ts`: aggregation and allocation.
- `activity.ts`: activity titles and the dividend-reinvest merge.
- `src/components/investments/{format,chart-geometry,treemap}.ts`: formatting, chart paths and the squarified treemap.

The client page (`src/app/(routes)/investments/page.tsx`) fetches the overview, triggers `POST /api/investments/refresh` on open, and renders presentational components from `src/components/investments/`. The editors are standalone modals so Plan 4 can reuse them in Settings. Charts are plain SVG; no new dependency is added.

**Tech Stack:** Next.js 14 App Router, React 19, TypeScript, Tailwind with the app's CSS variables, Prisma + SQLite, Zod v4, Vitest + Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-10-09-investment-accounts-design.md`. This plan covers §8's `/investments` page (all states) per the approved mock `a3-navigator.html` (§9), and the page-facing parts of §10's error handling. Plan 2 (`docs/superpowers/plans/2026-10-10-investment-accounts-2-prices-and-history.md`, PR #33) built the prices, valuation, history and APIs this plan reads.

**Plan series:** 1. Data foundation (PR #32) · 2. Prices & history (PR #33) · **3. Investments page (this plan)** · 4. Settings & Transactions:
- the Manage account modal (tracking mode and balance source, sync summary, reuse of this plan's editors, a Balance History list with the "migrated from adjustments" label)
- Add-from-Plaid preselect
- the linked-transfer chip in Transactions
- automatic FX, as a later follow-up

**Branch:** `feat/investment-page`, created from `main` after PR #33 merges (no stacked PRs). Work in the main checkout (no worktrees). PRs target `main`. Never push or open a PR unless the user asks. Commit this plan as the branch's first commit.

**Rulings made while writing this plan (spec/mock ambiguities):**
- **One payload per range.** Accounts, sparklines, holdings and activity for every account are small enough to load at once. The client slices them by selection, so changing the selection never refetches. Cost if wrong: one endpoint gets split later.
- **Display currency.** The page shows amounts in the base currency (`UserSettings.baseCurrency`, default USD), as the mock does. A non-base account also shows its native balance in the headline (`CA$…`). The holdings editor works in the account's currency.
- **Wrapper label.** It comes from the Plaid account subtype (`401k` → `401(k)` …). Without one it falls back to the group (`Retirement` / `Taxable` / `Crypto`). Accounts have no wrapper field, and adding one is YAGNI until labels look wrong. Cost if wrong: a manual group RRSP reads "Retirement" instead of "Group RRSP".
- **Institution mark.** Its initials are the first letters of up to two words; its colour is a stable pick from `PIE_COLORS`. The mock hand-picked these per institution.
- **"Waiting on institution" needs persisted state.** Plaid sync `pending` steps are not stored today. Task 1 adds `PlaidConnection.pendingSteps` (`prisma db push`); Plan 4's Settings reuses it.
- **Staleness is judged per market, with one trading day of grace.** A security is stale only when its latest close is older than the trading day before its market's last completed day. The grace absorbs exchange holidays, which are not modelled. Crypto is judged against its own calendar, so it no longer drags the header date back. The header date is the oldest exchange close (crypto's if nothing else is held).
- **Holding prices.** Plaid accounts show the snapshot's reported price and value, so holdings add up to the synced balance. Valued and manual accounts use today's `PriceBook` price.
- **All-accounts aggregation.** Holdings are grouped by `Security`. Every cash and money-market position merges into one "Cash & money market" row.
- **Activity.** A dividend and a buy of the same security on the same day in the same account are shown as one "Dividend reinvested" row. Amounts are shown as cash into the account (positive) or out of it (negative).
- **Charts are plain SVG.** Dashed-per-segment lines and the treemap are simpler by hand than in Recharts. Point markers are HTML overlays so the stretched SVG doesn't distort them.
- **Small screens.** Below the `lg` breakpoint the navigator stacks above the detail and isn't sticky. The mock defines no breakpoint.
- **Treemap tile size classes** assume the mock's ~470 px canvas width, so no ResizeObserver is needed.
- **Holdings map and allocation hide on a single position**, for All accounts too (spec §8 governs over the mock): they show only when the selection has more than one holding line.

## Global Constraints

- **Design principles: DRY > YAGNI > SOLID, all important.** Before writing a helper, query, schema or pattern, look for an existing one (in the codebase or an earlier task) and reuse or extract it rather than repeat it. Build nothing that no task, spec requirement or Plan 4 interface uses. Keep each module single-purpose, with dependencies (`prisma`, price provider, clock) passed in and narrowed to the methods actually used. When the principles conflict, DRY beats YAGNI (extracting a shared helper is fine) and YAGNI beats SOLID (no speculative interfaces). Reviewers flag violations as Important.
- **Object-oriented core:** depend on interfaces for anything swappable (price provider, clock); stateful or dependency-holding services are classes taking their dependencies in the constructor; one composition root (`src/lib/investments/services.ts`) wires production instances, and tests construct classes directly with the test Prisma client and fakes — no `vi.mock` of our own modules except `@/lib/prisma` in route tests and the composition root itself. Stateless pure helpers (everything in `portfolio-view.ts`, `holdings-view.ts`, `activity.ts`, and `src/components/investments/*.ts`) stay functions. Rule tables (`Record`/arrays of `{ match, … }`) instead of long `switch`/`if` chains. OOP serves DRY > YAGNI > SOLID; it does not license speculative abstraction.
- Schema: only Task 1 changes it (`PlaidConnection.pendingSteps`). Use `npx prisma db push` then `npx prisma generate` — never `prisma migrate dev`. Never read `.env`.
- All dates UTC; day-granular values are `YYYY-MM-DD` strings in the API. Display dates are formatted with `timeZone: 'UTC'` except sync timestamps (local time).
- Zod is v4: `z.number()` already rejects `NaN`/`Infinity` (don't add `.finite()`).
- Prices never run in the background: the page calls `POST /api/investments/refresh` once on open and on **Retry**; nothing polls.
- Unit tests never reach Yahoo: services come from `testServices(...)` / `fakeProvider` in `tests/helpers/investments.ts`; route tests mock `@/lib/prisma` (getter returning the test client) and `@/lib/investments/services` (pattern in `tests/integration/api/investments-refresh-history.test.ts`). Component tests mock `global.fetch` (pattern in `tests/unit/components/discovered-account-row.test.tsx`); never render against a live server. The one allowed `vi.mock` of our own UI module is `@/components/plaid/PlaidReconnectButton` (it wraps the Plaid Link SDK, which cannot run in jsdom).
- **UI conventions:** client components start with `'use client'`; colours only via the app's CSS variables (`var(--accent)`, `var(--green)`, `var(--red)`, `var(--text-muted)`, `var(--bg-card)`, `var(--bg-elevated)`, `var(--border)`, `var(--border-hover)`, `var(--grid-line)`, `var(--track-bg)` …) or `ds` from `@/lib/design-system` — no new hex colours except reusing `PIE_COLORS`; numbers, tickers and dates use `font-mono`; muted "old-money" palette (no saturated colours). Pages do not add their own max-width/padding (the app shell does). Reuse `Modal`, `Button`, `Input`, `Select` from `src/components/ui/`. Copy (labels, notices, hints) is verbatim from this plan.
- **The GitHub repo is public:** no account names, masks, balances, holdings or other personal data in committed code, tests, fixtures or copy. Tests use synthetic data. Never take fixture values from the mocks; they contain real data.
- Lint: only `console.warn` / `console.error`; prefix unused vars with `_`; single quotes, semicolons, 100-char lines; JSX props sorted (`react/jsx-sort-props`). Run `npm run lint:fix` before each commit.
- Tests: Vitest (single jsdom config). DB tests use `setupTestDb/resetTestDb/teardownTestDb` from `tests/helpers/db.ts`. Run one file with `npx vitest run <path>`.
- Stage explicit paths only; never stage `.claude/` or `.superpowers/`. Commit messages end with the Co-Authored-By trailer from your system reminder.

## Review Focus

1. **Mixed currencies.** A CAD account next to USD accounts must be converted into the base currency in the navigator, group totals, All-accounts series and holdings, while its headline also shows its native `CA$` balance. Missing this silently adds CAD to USD. → Task 9 test "converts a CAD account into the base currency"; Task 12 test "shows the native balance for a non-base account".
2. **Empty and thin data.** The page must render without crashing and with honest empty states in these cases: no investment accounts; an account with fewer than two points in the range (just switched, or a brand-new manual account); an account with no holdings; no activity. → Task 11 test "shows a placeholder when the range has under two points"; Task 12 tests "renders an empty overview" and "shows the empty activity copy"; Task 14 test "renders the empty state when there are no investment accounts".
3. **A failed price refresh on open.** A refresh that returns 502, or `stopped: true`, must not block or blank the page. The overview still renders, and the header switches to the stale wording with **Retry**. → Task 14 test "keeps the page usable when the refresh fails".
4. **Bad holdings input.** These must give an inline error with no request, or no duplicate row: blank, zero or negative units; adding a security that's already listed; an unknown ticker (400); a price service outage (502). → Task 13 tests "rejects non-positive units without saving", "does not add a security twice" and "shows the API error when adding fails".
5. **Manual accounts are not market accounts.** A manual account has:
   - no change chip; the headline says "Manual balance";
   - dots on entered days and a dashed carry-forward between them;
   - a meta line that says "as of" the last entry;
   - freshness that counts days since the last entry.

   Any of these showing as a synced/valued account would mislead. → Task 12 test "renders a manual account's entries, legend and freshness".

---

### Task 1: Persist pending Plaid investment steps

The page's "Waiting on institution" state needs to know that the last investment sync left a step `pending` (Plaid `PRODUCT_NOT_READY`, or an empty first holdings extraction). Today that is only in the live sync response.

**Files:**
- Modify: `prisma/schema.prisma` (model `PlaidConnection`)
- Modify: `src/lib/investments/sync-status.ts`
- Modify: `tests/helpers/investments.ts` (add `seedPlaidConnection`)
- Test: `tests/unit/lib/investments/sync-status.test.ts`

**Interfaces:**
- Consumes: `InvestmentSyncResult`, `InvestmentStep` from `src/lib/investments/plaid-investment-sync.ts`.
- Produces:
  - `PlaidConnection.pendingSteps String?` — comma-separated steps still waiting on the institution after the last investment sync (e.g. `"holdings,transactions"`), `null` when none.
  - `investmentSyncStatus(result): { lastSyncStatus: 'success' | 'error'; lastSyncError: string | null; pendingSteps: string | null }` (`recordInvestmentSyncStatus` persists all three).
  - Test helper `seedPlaidConnection(prisma, accountId, over?)` → the `PlaidConnection` with `plaidEnrollment` included. `over: { institutionName?: string; subtype?: string | null; status?: string; pendingSteps?: string | null; lastSyncAt?: Date | null }`.

- [ ] **Step 1: Add the column**

In `prisma/schema.prisma`, model `PlaidConnection`, add after `lastSyncError`:

```prisma
  pendingSteps     String?   // investment sync steps still waiting on the institution, e.g. "holdings,transactions"
```

(Align with the surrounding columns.) Then run:

```bash
npx prisma db push && npx prisma generate
```

Expected: "Your database is now in sync with your Prisma schema" and the client regenerates. `PlaidConnection` is not part of cloud sync (bank state stays device-local), so no cloud-sync change is needed.

- [ ] **Step 2: Add the test helper**

Append to `tests/helpers/investments.ts`:

```ts
/** A Plaid connection (with its enrollment) for an account; synthetic credentials. */
export async function seedPlaidConnection(
  prisma: PrismaClient,
  accountId: string,
  over: {
    institutionName?: string;
    subtype?: string | null;
    status?: string;
    pendingSteps?: string | null;
    lastSyncAt?: Date | null;
  } = {}
) {
  const enrollment = await prisma.plaidEnrollment.create({
    data: {
      plaidItemId: `item-${accountId}`,
      institutionName: over.institutionName ?? 'Test Brokerage',
      accessTokenEncrypted: 'test',
      accessTokenIv: 'test',
    },
  });
  return prisma.plaidConnection.create({
    data: {
      accountId,
      plaidEnrollmentId: enrollment.id,
      plaidAccountId: `plaid-${accountId}`,
      plaidAccountSubtype: over.subtype ?? null,
      status: over.status ?? 'connected',
      pendingSteps: over.pendingSteps ?? null,
      lastSyncAt: over.lastSyncAt ?? null,
    },
    include: { plaidEnrollment: true },
  });
}
```

- [ ] **Step 3: Write the failing tests**

Replace `tests/unit/lib/investments/sync-status.test.ts` with:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { seedInvestmentAccount, seedPlaidConnection } from '../../../helpers/investments';
import {
  investmentSyncStatus,
  recordInvestmentSyncStatus,
} from '@/lib/investments/sync-status';
import type { InvestmentSyncResult } from '@/lib/investments/plaid-investment-sync';

const result = (
  steps: Partial<InvestmentSyncResult['steps']>,
  errors: InvestmentSyncResult['errors'] = {},
  accountId = 'a'
): InvestmentSyncResult => ({
  accountId,
  steps: { balance: 'ok', holdings: 'ok', transactions: 'ok', linking: 'ok', ...steps },
  errors,
  counts: { holdings: 0, transactions: 0, cancelled: 0, linked: 0 },
});

describe('investmentSyncStatus', () => {
  it('is success when every step is ok, skipped or pending', () => {
    expect(
      investmentSyncStatus(result({ holdings: 'pending' }, { holdings: 'not ready' }))
    ).toEqual({ lastSyncStatus: 'success', lastSyncError: null, pendingSteps: 'holdings' });
  });

  it('is error with the failed steps when any step errored', () => {
    expect(
      investmentSyncStatus(
        result(
          { holdings: 'error', transactions: 'pending' },
          { holdings: 'boom', transactions: 'not ready' }
        )
      )
    ).toEqual({
      lastSyncStatus: 'error',
      lastSyncError: 'holdings: boom',
      pendingSteps: 'transactions',
    });
  });

  it('has no pending steps when nothing is pending', () => {
    expect(investmentSyncStatus(result({})).pendingSteps).toBeNull();
  });
});

describe('recordInvestmentSyncStatus', () => {
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

  it('persists pending steps, and clears them once the institution is ready', async () => {
    const a = await seedInvestmentAccount(prisma);
    await seedPlaidConnection(prisma, a.id);
    await recordInvestmentSyncStatus(
      prisma,
      result({ holdings: 'pending', transactions: 'pending' }, {}, a.id)
    );
    expect(await prisma.plaidConnection.findUnique({ where: { accountId: a.id } })).toMatchObject(
      { lastSyncStatus: 'success', pendingSteps: 'holdings,transactions' }
    );
    await recordInvestmentSyncStatus(prisma, result({}, {}, a.id));
    expect(
      (await prisma.plaidConnection.findUnique({ where: { accountId: a.id } }))?.pendingSteps
    ).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/sync-status.test.ts`
Expected: FAIL — the `toEqual` assertions miss `pendingSteps`, and the DB test sees `pendingSteps: null`.

- [ ] **Step 5: Implement**

Replace `investmentSyncStatus` in `src/lib/investments/sync-status.ts`:

```ts
/**
 * Connection status for one investment sync: 'pending' steps are not failures, 'error' ones are.
 * Pending steps are kept so the UI can say it is waiting on the institution.
 */
export function investmentSyncStatus(result: InvestmentSyncResult): {
  lastSyncStatus: 'success' | 'error';
  lastSyncError: string | null;
  pendingSteps: string | null;
} {
  const steps = Object.keys(result.steps) as InvestmentStep[];
  const failed = steps.filter((step) => result.steps[step] === 'error');
  const pending = steps.filter((step) => result.steps[step] === 'pending');
  return {
    lastSyncStatus: failed.length ? 'error' : 'success',
    lastSyncError: failed.length
      ? failed.map((step) => `${step}: ${result.errors[step] ?? 'failed'}`).join('; ')
      : null,
    pendingSteps: pending.length ? pending.join(',') : null,
  };
}
```

`recordInvestmentSyncStatus` already spreads `investmentSyncStatus(result)` into the update, so it persists `pendingSteps` unchanged. The Settings page's Sync All (`src/app/(routes)/settings/page.tsx`, the `investmentSyncStatus(inv)` call) reads only `lastSyncStatus`/`lastSyncError`, so the extra field is harmless there.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/sync-status.test.ts tests/integration/api/plaid-investment-sync-route.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add prisma/schema.prisma src/lib/investments/sync-status.ts tests/helpers/investments.ts tests/unit/lib/investments/sync-status.test.ts
git commit -m "feat(investments): persist pending Plaid investment sync steps"
```

### Task 2: A symbol fix revalues every day the security was held

Plan 2 deferred this. After `setPriceSymbol`, `ValuationService.writeBalances` only revalues from each account's last valuation row onward, so older valued days keep the wrong symbol's values.

**Files:**
- Modify: `src/lib/investments/valuation.ts`
- Modify: `src/lib/investments/refresh.ts`
- Test: `tests/unit/lib/investments/refresh.test.ts`

**Interfaces:**
- Consumes: `ValuationService.writeBalances`, `InvestmentRefreshService.setPriceSymbol` (Plan 2).
- Produces:
  - `ValuationService.writeBalances(opts?: { accountIds?: string[]; from?: Date }): Promise<number>`. With `from`, every listed valued account is revalued from `max(from, its first holdings day)` instead of from its last valuation row.
  - `ValuationService.holdersOf(securityId: string): Promise<{ accountIds: string[]; from: Date } | null>`. Returns the valued accounts whose holdings include the security, and the earliest day any of them held it.
  - `InvestmentRefreshService.setPriceSymbol` revalues `holdersOf(id)` from that day.

- [ ] **Step 1: Write the failing test**

Append inside the `describe('InvestmentRefreshService', …)` block of `tests/unit/lib/investments/refresh.test.ts` (add `seedBalance` is not needed; reuse the imports already there):

```ts
  it('setPriceSymbol revalues every valued day since the security was first held', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'OLD' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 1,
      source: 'manual',
    });
    const weekdays = ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'];
    for (const d of [...weekdays, '2026-10-08', '2026-10-09']) await seedPrice(prisma, s.id, d, 1);
    const { services } = testServices(prisma, {
      closes: {
        NEW: Object.fromEntries([...weekdays, '2026-10-08', '2026-10-09'].map((d) => [d, 2])),
      },
    });
    await services.valuation.writeBalances();
    const before = await prisma.accountBalance.findFirst({
      where: { accountId: a.id, date: new Date('2026-10-02T00:00:00Z') },
    });
    expect(before).toMatchObject({ balance: 10, source: 'valuation' });

    await services.refresh.setPriceSymbol(s.id, 'NEW');

    const rows = await prisma.accountBalance.findMany({
      where: { accountId: a.id },
      orderBy: { date: 'asc' },
    });
    expect(rows.map((r) => [isoDay(r.date), r.balance])).toEqual(
      [...weekdays, '2026-10-08', '2026-10-09'].map((d) => [d, 20])
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/investments/refresh.test.ts -t "every valued day"`
Expected: FAIL — only `2026-10-09` is 20; the earlier days are still 10.

- [ ] **Step 3: Implement**

In `src/lib/investments/valuation.ts`:

1. Change `writeBalances` to accept and forward `from`:

```ts
  /**
   * Write valued accounts' daily balances. By default each account resumes from its last valuation
   * row; `from` revalues from that day instead (e.g. after a security's prices were replaced).
   */
  async writeBalances(opts: { accountIds?: string[]; from?: Date } = {}): Promise<number> {
    const today = utcDay(this.clock.now());
    const accounts = await this.prisma.account.findMany({
      where: {
        trackingMode: 'investment',
        balanceSource: 'valuation',
        ...(opts.accountIds ? { id: { in: opts.accountIds } } : {}),
      },
    });
    const rates = await loadFxRates(this.prisma);
    let written = 0;
    for (const account of accounts) {
      written += await this.valueAccount(account, today, rates, opts.from);
    }
    return written;
  }

  /** Valued accounts holding `securityId`, and the first day any of them held it. */
  async holdersOf(securityId: string): Promise<{ accountIds: string[]; from: Date } | null> {
    const snapshots = await this.prisma.holdingSnapshot.findMany({
      where: { securityId, account: { trackingMode: 'investment', balanceSource: 'valuation' } },
      select: { accountId: true, date: true },
      orderBy: { date: 'asc' },
    });
    if (!snapshots.length) return null;
    return { accountIds: [...new Set(snapshots.map((s) => s.accountId))], from: snapshots[0].date };
  }
```

2. Give `valueAccount` a `from?: Date` parameter and replace its `start` line:

```ts
  private async valueAccount(
    account: Account,
    today: Date,
    rates: Map<string, number>,
    from?: Date
  ): Promise<number> {
```

```ts
    const firstDay = snapshots[0].date;
    const resumeAt = last ? last.date : firstDay;
    const start = from ? (from < firstDay ? firstDay : from) : resumeAt;
```

(Keep `const last = …` above it; everything after `start` is unchanged.)

In `src/lib/investments/refresh.ts`, `setPriceSymbol`:

```ts
  /** Point a security at a new feed symbol, price it under that symbol and revalue its history. */
  setPriceSymbol(id: string, symbol: string): Promise<Security> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const security = await this.catalog.setPriceSymbol(id, symbol);
      await this.prices.refresh({ securityIds: [id] });
      const holders = await this.valuation.holdersOf(id);
      if (holders) await this.valuation.writeBalances(holders);
      return security;
    });
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/refresh.test.ts tests/unit/lib/investments/valuation.test.ts tests/integration/api/investment-securities-apis.test.ts`
Expected: PASS (existing symbol-fix tests still pass: their holders are revalued too).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/valuation.ts src/lib/investments/refresh.ts tests/unit/lib/investments/refresh.test.ts
git commit -m "fix(investments): revalue every held day after a symbol fix"
```

### Task 3: Price freshness per market

Plan 2's `pricesAsOf` takes the oldest close across all held securities. Crypto always lags a day, which drags the date back. It also never says whether prices are actually stale.

**Files:**
- Modify: `src/lib/prices/trading-days.ts`
- Modify: `src/lib/prices/refresh.ts`
- Modify: `src/app/api/investments/refresh/route.ts`
- Test: `tests/unit/lib/prices/trading-days.test.ts`, `tests/unit/lib/prices/refresh.test.ts` (regression: `tests/integration/api/investments-refresh-history.test.ts`, unchanged)

**Interfaces:**
- Consumes: `lastCompletedTradingDay`, `PriceRefresher.latestStoredClose` (Plan 2).
- Produces:
  - `type Market = 'exchange' | 'crypto'` and `marketOf(securityType: string): Market` (crypto ⇒ `'crypto'`, else `'exchange'`), exported from `trading-days.ts`.
  - `previousTradingDay(d: Date, market: Market): Date`. Crypto is the previous calendar day; exchange is the previous weekday.
  - `type PriceFreshness = { asOf: Date | null; stale: boolean }` and `PriceRefresher.freshness(opts?: { securityIds?: string[] }): Promise<PriceFreshness>`, which **replaces** `pricesAsOf`.
  - `POST /api/investments/refresh` response: unchanged shape from Plan 2; `pricesAsOf: 'YYYY-MM-DD' | null` is now `freshness().asOf`. Staleness is not returned here: the page reads it from the overview (`prices.stale`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lib/prices/trading-days.test.ts` (add `previousTradingDay, marketOf` to its import from `@/lib/prices/trading-days`):

```ts
describe('previousTradingDay', () => {
  it('skips weekends for exchanges', () => {
    expect(isoDay(previousTradingDay(utcDay('2026-10-12'), 'exchange'))).toBe('2026-10-09');
    expect(isoDay(previousTradingDay(utcDay('2026-10-09'), 'exchange'))).toBe('2026-10-08');
  });
  it('is the previous calendar day for crypto', () => {
    expect(isoDay(previousTradingDay(utcDay('2026-10-12'), 'crypto'))).toBe('2026-10-11');
  });
});

describe('marketOf', () => {
  it('maps crypto securities to the crypto market and everything else to exchange', () => {
    expect(marketOf('crypto')).toBe('crypto');
    expect(marketOf('etf')).toBe('exchange');
  });
});
```

(The file already imports `isoDay` only; change that line to `import { isoDay, utcDay } from '@/lib/investments/dates';`.)

In `tests/unit/lib/prices/refresh.test.ts`, replace the test `'pricesAsOf reports the oldest latest close among held feed securities'` with:

```ts
  describe('freshness', () => {
    // Clock: Friday 2026-10-09 22:00Z. Exchange target 10-09 (grace 10-08); crypto 10-08 (grace 10-07).
    async function heldWithClose(symbol: string, last: string, type = 'etf') {
      const { security } = await held(symbol, { type });
      await seedPrice(prisma, security.id, last, 1);
      return security;
    }
    const freshness = (opts?: { securityIds?: string[] }) =>
      refresher(fakeProvider().provider).freshness(opts);

    it('reports the oldest exchange close and is fresh within one trading day', async () => {
      await heldWithClose('AAA', '2026-10-09');
      await heldWithClose('BBB', '2026-10-08');
      await heldWithClose('BTC-USD', '2026-10-07', 'crypto');
      const f = await freshness();
      expect(isoDay(f.asOf!)).toBe('2026-10-08');
      expect(f.stale).toBe(false);
    });

    it('is stale when an exchange close is older than the grace day', async () => {
      await heldWithClose('AAA', '2026-10-09');
      await heldWithClose('BBB', '2026-10-07');
      expect(await freshness()).toMatchObject({ stale: true });
    });

    it('is stale when crypto is older than its own grace day', async () => {
      await heldWithClose('BTC-USD', '2026-10-06', 'crypto');
      const f = await freshness();
      expect(isoDay(f.asOf!)).toBe('2026-10-06');
      expect(f.stale).toBe(true);
    });

    it('is stale for a held feed security never priced', async () => {
      await held('NEW');
      expect(await freshness()).toEqual({ asOf: null, stale: true });
    });

    it('judges only the given securities', async () => {
      const fresh = await heldWithClose('AAA', '2026-10-09');
      await heldWithClose('BBB', '2026-10-01');
      expect(await freshness({ securityIds: [fresh.id] })).toMatchObject({ stale: false });
    });

    it('has nothing to judge when no feed security is held', async () => {
      expect(await freshness()).toEqual({ asOf: null, stale: false });
    });
  });
```

The route test `'POST /refresh runs and reports pricesAsOf'` in `tests/integration/api/investments-refresh-history.test.ts` stays as it is (still `pricesAsOf: null`); it runs in Step 4 as a regression check.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices/trading-days.test.ts tests/unit/lib/prices/refresh.test.ts`
Expected: FAIL — `previousTradingDay`/`marketOf`/`freshness` don't exist.

- [ ] **Step 3: Implement**

`src/lib/prices/trading-days.ts` — add the market type and helpers, and reuse `previousTradingDay` inside `lastCompletedTradingDay`:

```ts
export type Market = 'exchange' | 'crypto';

/** Which trading calendar a security follows. */
export const marketOf = (securityType: string): Market =>
  securityType === 'crypto' ? 'crypto' : 'exchange';

/** The trading day before `d`: the previous calendar day for crypto, else the previous weekday. */
export function previousTradingDay(d: Date, market: Market): Date {
  if (market === 'crypto') return addDays(d, -1);
  let p = addDays(d, -1);
  while (isWeekend(p)) p = addDays(p, -1);
  return p;
}

/**
 * The latest UTC day whose daily close is final. Exchange holidays are not modelled: asking for a
 * holiday returns no bar, nothing is stored, and the next run asks again (one cheap call).
 */
export function lastCompletedTradingDay(now: Date, market: Market): Date {
  const today = utcDay(now);
  if (market === 'crypto') return addDays(today, -1);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (!isWeekend(today) && minutes >= SETTLED_UTC_MINUTES) return today;
  return previousTradingDay(today, 'exchange');
}
```

`src/lib/prices/refresh.ts`:

1. Import `marketOf, previousTradingDay, type Market` alongside `lastCompletedTradingDay`.
2. In `refresh()`, replace `const market = security.type === 'crypto' ? 'crypto' : 'exchange';` with `const market = marketOf(security.type);`.
3. Replace `pricesAsOf()` with:

```ts
export type PriceFreshness = { asOf: Date | null; stale: boolean };
```

(top-level, next to `PriceRefreshResult`) and the method:

```ts
  /**
   * How current stored closes are for held feed securities (or just `securityIds`). Each security
   * is judged on its own market's calendar, with one trading day of grace for unmodelled holidays:
   * stale when its latest close is older than the trading day before the last completed one.
   * `asOf` is the oldest latest close among exchange securities, else among crypto.
   */
  async freshness(opts: { securityIds?: string[] } = {}): Promise<PriceFreshness> {
    const now = this.clock.now();
    const securities = await this.prisma.security.findMany({
      where: {
        pricing: 'feed',
        ...(opts.securityIds ? { id: { in: opts.securityIds } } : { holdings: { some: {} } }),
      },
      select: { id: true, type: true },
    });
    const oldest: Partial<Record<Market, Date>> = {};
    let stale = false;
    for (const s of securities) {
      const market = marketOf(s.type);
      const latest = await this.latestStoredClose(s.id);
      const grace = previousTradingDay(lastCompletedTradingDay(now, market), market);
      if (!latest || latest < grace) stale = true;
      const current = oldest[market];
      if (latest && (!current || latest < current)) oldest[market] = latest;
    }
    return { asOf: oldest.exchange ?? oldest.crypto ?? null, stale };
  }
```

`src/app/api/investments/refresh/route.ts`:

```ts
export async function POST() {
  try {
    const { refresh, prices } = await getInvestmentServices();
    const result = await refresh.refresh();
    const freshness = await prices.freshness();
    return NextResponse.json({
      ...result,
      pricesAsOf: freshness.asOf ? isoDay(freshness.asOf) : null,
    });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to refresh investments');
  }
}
```

Check nothing else calls `pricesAsOf`: `grep -rn "pricesAsOf()" src scripts` must be empty.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices tests/integration/api/investments-refresh-history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/prices/trading-days.ts src/lib/prices/refresh.ts src/app/api/investments/refresh/route.ts tests/unit/lib/prices/trading-days.test.ts tests/unit/lib/prices/refresh.test.ts
git commit -m "feat(prices): judge price freshness per market with a day of grace"
```

### Task 4: Add cash through the securities API

The holdings editor needs a cash row. `SecurityCatalog.findOrCreateCash` exists (Plan 2 follow-up) but no route exposes it.

**Files:**
- Modify: `src/app/api/investments/securities/route.ts`
- Test: `tests/integration/api/investment-securities-apis.test.ts`

**Interfaces:**
- Consumes: `SecurityCatalog.findOrCreateCash(currency): Promise<Security>` (throws `InvestmentInputError('Unsupported currency: X')` → 400).
- Produces: `POST /api/investments/securities` accepts `{ symbol: string }` (unchanged) **or** `{ cash: string }` (3-letter currency) → `200 { security }` (cash security: `type: 'cash'`, `pricing: 'fixed'`, `fixedPrice: 1`). Bad body → `400 { error: 'Symbol or cash currency is required', details }`.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/api/investment-securities-apis.test.ts`:

```ts
  it('POST { cash } finds or creates the currency cash security', async () => {
    const first = await create(json('POST', { cash: 'cad' }));
    expect(first.status).toBe(200);
    const { security } = await first.json();
    expect(security).toMatchObject({ type: 'cash', pricing: 'fixed', fixedPrice: 1, currency: 'CAD' });
    const again = await (await create(json('POST', { cash: 'CAD' }))).json();
    expect(again.security.id).toBe(security.id);
    expect((await create(json('POST', { cash: 'XYZ' }))).status).toBe(400);
    expect((await create(json('POST', {}))).status).toBe(400);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/integration/api/investment-securities-apis.test.ts -t "cash"`
Expected: FAIL — `{ cash }` is rejected as a bad body (400).

- [ ] **Step 3: Implement**

Replace `src/app/api/investments/securities/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../_lib/http';

const bodySchema = z.union([
  z.object({ symbol: z.string().trim().min(1).max(20) }),
  z.object({ cash: z.string().trim().length(3) }),
]);

/** Add a security by ticker (validated by a live quote) or get the cash security for a currency. */
export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema, 'Symbol or cash currency is required');
  if ('response' in body) return body.response;
  try {
    const { catalog } = await getInvestmentServices();
    if ('cash' in body.data) {
      return NextResponse.json({ security: await catalog.findOrCreateCash(body.data.cash) });
    }
    const { security, created } = await catalog.findOrCreateFeed(body.data.symbol);
    return NextResponse.json({ security }, { status: created ? 201 : 200 });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to add security');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/api/investment-securities-apis.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/app/api/investments/securities/route.ts tests/integration/api/investment-securities-apis.test.ts
git commit -m "feat(investments): add cash holdings through the securities API"
```

### Task 5: Page rules — ranges, groups, wrappers, change

Pure helpers that both the server read model and the client use.

**Files:**
- Create: `src/lib/investments/portfolio-view.ts`
- Test: `tests/unit/lib/investments/portfolio-view.test.ts`

**Interfaces:**
- Consumes: `addDays`, `utcDay` from `src/lib/investments/dates.ts`.
- Produces (all exported from `src/lib/investments/portfolio-view.ts`):
  - `type Range = '1M' | '3M' | 'YTD' | '1Y'`; `const RANGES: Range[]` (that order); `DEFAULT_RANGE: Range = '3M'`; `isRange(v: unknown): v is Range`.
  - `rangeStart(range: Range, today: Date): Date` — 1M = today − 30 days, 3M = −91, 1Y = −365, YTD = Jan 1 (UTC) of today's year.
  - `type AccountGroup = 'Retirement' | 'Taxable' | 'Crypto'`; `GROUP_ORDER: AccountGroup[]`; `accountGroup(accountType: string): AccountGroup` (`retirement` → Retirement, `crypto` → Crypto, anything else → Taxable).
  - `wrapperLabel(plaidSubtype: string | null, accountType: string): string` — mapped Plaid subtype, else the group name.
  - `allocationBucket(wrapper: string): string` — `Taxable`/`Cash mgmt` → `Taxable`; strips a leading `Group `.
  - `type SeriesChange = { start: number; end: number; delta: number; pct: number | null }`; `seriesChange(points: { value: number }[]): SeriesChange | null` (null when there are no points; `pct` null when `start` is 0).

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/investments/portfolio-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isoDay, utcDay } from '@/lib/investments/dates';
import {
  accountGroup,
  allocationBucket,
  isRange,
  rangeStart,
  seriesChange,
  wrapperLabel,
} from '@/lib/investments/portfolio-view';

describe('rangeStart', () => {
  const today = utcDay('2026-10-11');
  it.each([
    ['1M', '2026-09-11'],
    ['3M', '2026-07-12'],
    ['1Y', '2025-10-11'],
    ['YTD', '2026-01-01'],
  ] as const)('%s starts on %s', (range, expected) => {
    expect(isoDay(rangeStart(range, today))).toBe(expected);
  });
});

describe('isRange', () => {
  it('accepts the four ranges only', () => {
    expect(isRange('YTD')).toBe(true);
    expect(isRange('5Y')).toBe(false);
    expect(isRange(undefined)).toBe(false);
  });
});

describe('accountGroup', () => {
  it('groups by account type', () => {
    expect(accountGroup('retirement')).toBe('Retirement');
    expect(accountGroup('crypto')).toBe('Crypto');
    expect(accountGroup('brokerage')).toBe('Taxable');
    expect(accountGroup('cash')).toBe('Taxable');
  });
});

describe('wrapperLabel', () => {
  it('names the wrapper from the Plaid subtype', () => {
    expect(wrapperLabel('401k', 'retirement')).toBe('401(k)');
    expect(wrapperLabel('roth', 'brokerage')).toBe('Roth IRA');
    expect(wrapperLabel('cash management', 'cash')).toBe('Cash mgmt');
  });
  it('falls back to the group without a known subtype', () => {
    expect(wrapperLabel(null, 'retirement')).toBe('Retirement');
    expect(wrapperLabel('something new', 'brokerage')).toBe('Taxable');
  });
});

describe('allocationBucket', () => {
  it('folds cash management into Taxable and drops a Group prefix', () => {
    expect(allocationBucket('Cash mgmt')).toBe('Taxable');
    expect(allocationBucket('Group RRSP')).toBe('RRSP');
    expect(allocationBucket('HSA')).toBe('HSA');
  });
});

describe('seriesChange', () => {
  it('compares the first and last points', () => {
    expect(seriesChange([{ value: 100 }, { value: 90 }, { value: 110 }])).toEqual({
      start: 100,
      end: 110,
      delta: 10,
      pct: 10,
    });
  });
  it('has no percentage from a zero start, and nothing without points', () => {
    expect(seriesChange([{ value: 0 }, { value: 5 }])?.pct).toBeNull();
    expect(seriesChange([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/portfolio-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/investments/portfolio-view.ts`:

```ts
import { addDays, utcDay } from './dates';
import { roundCents } from './money';

export type Range = '1M' | '3M' | 'YTD' | '1Y';
export const RANGES: Range[] = ['1M', '3M', 'YTD', '1Y'];
export const DEFAULT_RANGE: Range = '3M';

export const isRange = (v: unknown): v is Range => RANGES.includes(v as Range);

const RANGE_DAYS: Record<Exclude<Range, 'YTD'>, number> = { '1M': 30, '3M': 91, '1Y': 365 };

/** First day of a range ending today (UTC). */
export function rangeStart(range: Range, today: Date): Date {
  if (range === 'YTD') return utcDay(`${today.getUTCFullYear()}-01-01`);
  return addDays(today, -RANGE_DAYS[range]);
}

export type AccountGroup = 'Retirement' | 'Taxable' | 'Crypto';
export const GROUP_ORDER: AccountGroup[] = ['Retirement', 'Taxable', 'Crypto'];

const GROUP_BY_TYPE: Record<string, AccountGroup> = { retirement: 'Retirement', crypto: 'Crypto' };

export const accountGroup = (accountType: string): AccountGroup =>
  GROUP_BY_TYPE[accountType] ?? 'Taxable';

const WRAPPER_BY_SUBTYPE: Record<string, string> = {
  '401k': '401(k)',
  '403b': '403(b)',
  '457b': '457(b)',
  roth: 'Roth IRA',
  'roth 401k': 'Roth 401(k)',
  ira: 'IRA',
  'sep ira': 'SEP IRA',
  'simple ira': 'SIMPLE IRA',
  hsa: 'HSA',
  rrsp: 'RRSP',
  'group rrsp': 'Group RRSP',
  tfsa: 'TFSA',
  brokerage: 'Taxable',
  'cash management': 'Cash mgmt',
  'crypto exchange': 'Crypto',
};

/** The tax wrapper shown next to the institution ("Test Brokerage · 401(k)"). */
export function wrapperLabel(plaidSubtype: string | null, accountType: string): string {
  return (
    (plaidSubtype && WRAPPER_BY_SUBTYPE[plaidSubtype.toLowerCase()]) || accountGroup(accountType)
  );
}

const BUCKET_ALIASES: Record<string, string> = { 'Cash mgmt': 'Taxable' };

/** The "Account" allocation bucket for a wrapper. */
export const allocationBucket = (wrapper: string): string =>
  BUCKET_ALIASES[wrapper] ?? wrapper.replace(/^Group /, '');

export type SeriesChange = { start: number; end: number; delta: number; pct: number | null };

/** Balance change across a series: last point minus first. Not a return (flows aren't removed). */
export function seriesChange(points: { value: number }[]): SeriesChange | null {
  if (!points.length) return null;
  const start = points[0].value;
  const end = points[points.length - 1].value;
  const delta = roundCents(end - start);
  return { start, end, delta, pct: start === 0 ? null : (delta / start) * 100 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/portfolio-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/portfolio-view.ts tests/unit/lib/investments/portfolio-view.test.ts
git commit -m "feat(investments): page rules for ranges, groups, wrappers and change"
```

### Task 6: Holdings aggregation and allocation

**Files:**
- Create: `src/lib/investments/holdings-view.ts`
- Test: `tests/unit/lib/investments/holdings-view.test.ts`

**Interfaces:**
- Consumes: `allocationBucket` (Task 5).
- Produces (exported from `src/lib/investments/holdings-view.ts`):
  - `type HoldingKind = 'security' | 'cash' | 'account'`. `account` is a manual account's single holding.
  - `type HoldingRow` — one current position, produced by Task 7's reader:
    ```ts
    {
      accountId: string; securityId: string; kind: HoldingKind;
      label: string;           // ticker, "Cash", "Money market", or the manual account's name
      name: string;            // security name
      type: string;            // Security.type
      pricing: string;         // Security.pricing
      currency: string;        // security currency
      quantity: number;
      price: number;           // per unit, security currency
      priceInAccount: number;  // per unit, account currency
      value: number;           // account currency
      valueBase: number;       // base currency
      gainBase: number | null; // value − cost basis, base currency; null without cost basis
      rangeChangePct: number | null; // price change over the range; null when not market-priced
    }
    ```
  - `type HoldingLine = { key: string; label: string; name: string; kind: HoldingKind; securityId: string | null; quantity: number | null; valueBase: number; gainBase: number | null; rangeChangePct: number | null; accountCount: number; unpriced: boolean; weightPct: number }`.
  - `CASH_KEY = 'cash'`, `CASH_LABEL = 'Cash & money market'`.
  - `holdingLines(rows: HoldingRow[]): HoldingLine[]`. Groups by security, merges every cash row into one `CASH_KEY` line, and hides lines worth $1 or less. Results are sorted by value descending, and `weightPct` is each line's share of the shown total. `quantity` is null for cash and account lines, `gainBase` is null unless every contributing row has a gain, and `unpriced` means `pricing === 'none'`.
  - `type AllocationDimension = 'type' | 'account' | 'currency'`; `type AllocationSlice = { label: string; value: number; pct: number }`.
  - `allocation(rows: HoldingRow[], accounts: { id: string; wrapper: string; currency: string }[], dimension: AllocationDimension): AllocationSlice[]`, sorted by value descending:
    - `type` uses `TYPE_LABELS` (`etf` ETF, `equity` Stock, `mutual_fund` Mutual fund, `cash`/`money_market` Cash & MM, `crypto` Crypto, others Other).
    - `account` uses `allocationBucket(wrapper)`.
    - `currency` uses the account's currency.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/investments/holdings-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { allocation, holdingLines, type HoldingRow } from '@/lib/investments/holdings-view';

const row = (over: Partial<HoldingRow>): HoldingRow => ({
  accountId: 'a1',
  securityId: 's1',
  kind: 'security',
  label: 'AAA',
  name: 'Triple A Fund',
  type: 'etf',
  pricing: 'feed',
  currency: 'USD',
  quantity: 10,
  price: 10,
  priceInAccount: 10,
  value: 100,
  valueBase: 100,
  gainBase: 20,
  rangeChangePct: 5,
  ...over,
});

describe('holdingLines', () => {
  it('aggregates a security across accounts and counts the accounts', () => {
    const lines = holdingLines([
      row({}),
      row({ accountId: 'a2', quantity: 5, valueBase: 50, gainBase: 5 }),
      row({ securityId: 's2', label: 'BBB', valueBase: 50, gainBase: null }),
    ]);
    expect(lines.map((l) => [l.label, l.valueBase, l.quantity, l.accountCount, l.gainBase])).toEqual(
      [
        ['AAA', 150, 15, 2, 25],
        ['BBB', 50, 10, 1, null],
      ]
    );
    expect(lines[0].weightPct).toBe(75);
  });

  it('needs every position to have cost basis to show a gain', () => {
    const [line] = holdingLines([row({}), row({ accountId: 'a2', gainBase: null })]);
    expect(line.gainBase).toBeNull();
  });

  it('merges cash and money market into one line without a quantity', () => {
    const lines = holdingLines([
      row({ securityId: 'c1', kind: 'cash', label: 'Cash', type: 'cash', valueBase: 30 }),
      row({ securityId: 'm1', kind: 'cash', label: 'Money market', type: 'money_market', valueBase: 20 }),
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ key: 'cash', label: 'Cash & money market', quantity: null, valueBase: 50 }),
    ]);
  });

  it('hides positions worth a dollar or less and flags unpriced ones', () => {
    const lines = holdingLines([
      row({ valueBase: 0.5 }),
      row({ securityId: 's2', label: 'ZZZ', pricing: 'none', valueBase: 10 }),
    ]);
    expect(lines.map((l) => [l.label, l.unpriced])).toEqual([['ZZZ', true]]);
  });
});

describe('allocation', () => {
  const accounts = [
    { id: 'a1', wrapper: '401(k)', currency: 'USD' },
    { id: 'a2', wrapper: 'Cash mgmt', currency: 'CAD' },
  ];
  const rows = [
    row({ valueBase: 60 }),
    row({ accountId: 'a2', securityId: 'c1', kind: 'cash', type: 'cash', valueBase: 40 }),
  ];

  it('splits by security type', () => {
    expect(allocation(rows, accounts, 'type')).toEqual([
      { label: 'ETF', value: 60, pct: 60 },
      { label: 'Cash & MM', value: 40, pct: 40 },
    ]);
  });

  it('splits by account bucket and by currency', () => {
    expect(allocation(rows, accounts, 'account').map((s) => s.label)).toEqual(['401(k)', 'Taxable']);
    expect(allocation(rows, accounts, 'currency').map((s) => [s.label, s.pct])).toEqual([
      ['USD', 60],
      ['CAD', 40],
    ]);
  });

  it('is empty when nothing is held', () => {
    expect(allocation([], accounts, 'type')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/holdings-view.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/investments/holdings-view.ts`:

```ts
import { allocationBucket } from './portfolio-view';
import { roundCents } from './money';

export type HoldingKind = 'security' | 'cash' | 'account';

/** One current position in one account, priced (see `CurrentHoldingsReader`). */
export type HoldingRow = {
  accountId: string;
  securityId: string;
  kind: HoldingKind;
  label: string;
  name: string;
  type: string;
  pricing: string;
  currency: string;
  quantity: number;
  price: number;
  priceInAccount: number;
  value: number;
  valueBase: number;
  gainBase: number | null;
  rangeChangePct: number | null;
};

/** One row of the holdings table / treemap tile, possibly spanning accounts. */
export type HoldingLine = {
  key: string;
  label: string;
  name: string;
  kind: HoldingKind;
  securityId: string | null;
  quantity: number | null;
  valueBase: number;
  gainBase: number | null;
  rangeChangePct: number | null;
  accountCount: number;
  unpriced: boolean;
  weightPct: number;
};

export const CASH_KEY = 'cash';
export const CASH_LABEL = 'Cash & money market';
const MIN_SHOWN_VALUE = 1;

const lineKey = (r: HoldingRow) => (r.kind === 'cash' ? CASH_KEY : r.securityId);

/** Holdings lines for the given rows: grouped by security, cash merged, sorted by value. */
export function holdingLines(rows: HoldingRow[]): HoldingLine[] {
  const groups = new Map<string, HoldingRow[]>();
  for (const r of rows) groups.set(lineKey(r), [...(groups.get(lineKey(r)) ?? []), r]);

  const lines = [...groups.entries()].map(([key, members]) => {
    const first = members[0];
    const isCash = key === CASH_KEY;
    const gains = members.map((m) => m.gainBase);
    return {
      key,
      label: isCash ? CASH_LABEL : first.label,
      name: isCash ? CASH_LABEL : first.name,
      kind: first.kind,
      securityId: isCash ? null : first.securityId,
      quantity:
        first.kind === 'security' ? members.reduce((sum, m) => sum + m.quantity, 0) : null,
      valueBase: roundCents(members.reduce((sum, m) => sum + m.valueBase, 0)),
      gainBase: gains.every((g) => g != null)
        ? roundCents(gains.reduce((sum: number, g) => sum + g!, 0))
        : null,
      rangeChangePct: first.rangeChangePct,
      accountCount: new Set(members.map((m) => m.accountId)).size,
      unpriced: members.some((m) => m.pricing === 'none'),
      weightPct: 0,
    };
  });

  const shown = lines.filter((l) => l.valueBase > MIN_SHOWN_VALUE);
  const total = shown.reduce((sum, l) => sum + l.valueBase, 0);
  return shown
    .map((l) => ({ ...l, weightPct: total ? (l.valueBase / total) * 100 : 0 }))
    .sort((a, b) => b.valueBase - a.valueBase);
}

export type AllocationDimension = 'type' | 'account' | 'currency';
export type AllocationSlice = { label: string; value: number; pct: number };

export const TYPE_LABELS: Record<string, string> = {
  etf: 'ETF',
  equity: 'Stock',
  mutual_fund: 'Mutual fund',
  cash: 'Cash & MM',
  money_market: 'Cash & MM',
  crypto: 'Crypto',
};

type AccountFacts = { id: string; wrapper: string; currency: string };

const BUCKETS: Record<
  AllocationDimension,
  (row: HoldingRow, account: AccountFacts | undefined) => string
> = {
  type: (row) => TYPE_LABELS[row.type] ?? 'Other',
  account: (_row, account) => allocationBucket(account?.wrapper ?? 'Other'),
  currency: (_row, account) => account?.currency ?? 'Other',
};

/** Share of value by type, account bucket or currency, largest first. */
export function allocation(
  rows: HoldingRow[],
  accounts: AccountFacts[],
  dimension: AllocationDimension
): AllocationSlice[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const totals = new Map<string, number>();
  for (const r of rows) {
    const label = BUCKETS[dimension](r, byId.get(r.accountId));
    totals.set(label, (totals.get(label) ?? 0) + r.valueBase);
  }
  const total = [...totals.values()].reduce((sum, v) => sum + v, 0);
  return [...totals.entries()]
    .map(([label, value]) => ({
      label,
      value: roundCents(value),
      pct: total ? (value / total) * 100 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/holdings-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/holdings-view.ts tests/unit/lib/investments/holdings-view.test.ts
git commit -m "feat(investments): holdings aggregation and allocation for the page"
```

### Task 7: Current holdings reader

Turns each account's latest holdings snapshot into priced `HoldingRow`s.

**Files:**
- Create: `src/lib/investments/current-holdings.ts`
- Test: `tests/unit/lib/investments/current-holdings.test.ts`

**Interfaces:**
- Consumes: `PriceBook.load(prisma, securityIds, to)` / `.at(securityId, date)` (`src/lib/prices/price-book.ts`); `convertAmount` (`src/lib/currency.ts`); `manualHoldingSecurityId` (`src/lib/investments/manual-holding.ts`); `roundCents`; `HoldingRow`, `HoldingKind` (Task 6).
- Produces: `class CurrentHoldingsReader { constructor(prisma: PrismaClient); read(opts: CurrentHoldingsOptions): Promise<HoldingRow[]> }` with
  ```ts
  type CurrentHoldingsOptions = {
    accounts: { id: string; name: string; currency: string; balanceSource: string | null }[];
    today: Date;        // UTC day
    rangeStart: Date;   // UTC day, for rangeChangePct
    baseCurrency: string;
    rates: Map<string, number>;
  };
  ```
  Each account's current set is its latest snapshot day on or before `today`; a valued account's leftover manual-holding mirror is ignored. Plaid rows (`source: 'plaid'`) keep the snapshot's price. Other rows are priced from the `PriceBook` today, falling back to the snapshot price. `kind` is `account` for the manual-holding mirror, `cash` for `type` cash/money_market, else `security`. `label` is the account name, then `Cash` / `Money market`, then the ticker, then the security name, in that order. `gainBase` is set when `costBasis` is present (cost basis is in the security's currency). `rangeChangePct` is only for `security` rows not priced `none` that have a book price at both ends.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/investments/current-holdings.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  day,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
} from '../../../helpers/investments';
import { CurrentHoldingsReader } from '@/lib/investments/current-holdings';
import { manualHoldingSecurityId } from '@/lib/investments/manual-holding';

let prisma: PrismaClient;
const rates = new Map([['CAD_USD', 0.5]]); // 1 USD = 2 CAD, exact in floating point
const read = (accounts: Awaited<ReturnType<typeof seedInvestmentAccount>>[]) =>
  new CurrentHoldingsReader(prisma).read({
    accounts,
    today: day('2026-10-09'),
    rangeStart: day('2026-09-09'),
    baseCurrency: 'USD',
    rates,
  });

describe('CurrentHoldingsReader', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('prices a valued account’s latest set from the price book, with range change', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA', name: 'Triple A' });
    await seedSnapshot(prisma, { accountId: a.id, securityId: s.id, date: '2026-09-01', quantity: 1, price: 5, source: 'manual' });
    await seedSnapshot(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-01', quantity: 3, price: 5, source: 'manual' });
    await seedPrice(prisma, s.id, '2026-09-09', 8);
    await seedPrice(prisma, s.id, '2026-10-09', 10);
    const [r] = await read([a]);
    expect(r).toMatchObject({
      kind: 'security',
      label: 'AAA',
      name: 'Triple A',
      quantity: 3,
      price: 10,
      priceInAccount: 10,
      value: 30,
      valueBase: 30,
      gainBase: null,
      rangeChangePct: 25,
    });
  });

  it('keeps Plaid’s reported price and computes gain from cost basis', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const snap = await seedSnapshot(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-08', quantity: 2, price: 50 });
    await prisma.holdingSnapshot.update({ where: { id: snap.id }, data: { costBasis: 60 } });
    await seedPrice(prisma, s.id, '2026-10-09', 55);
    const [r] = await read([a]);
    expect(r).toMatchObject({ price: 50, value: 100, gainBase: 40 });
  });

  it('converts a CAD account into the base currency', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation', currency: 'CAD' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA', currency: 'USD' });
    await seedSnapshot(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-01', quantity: 1, price: 75, source: 'manual' });
    await seedPrice(prisma, s.id, '2026-10-09', 75);
    const [r] = await read([a]);
    expect(r).toMatchObject({ price: 75, priceInAccount: 150, value: 150, valueBase: 75 });
  });

  it('labels cash and a manual account’s single holding, without range change', async () => {
    const manual = await seedInvestmentAccount(prisma, { balanceSource: 'manual', name: 'Pension' });
    await prisma.security.create({
      data: { id: manualHoldingSecurityId(manual.id), name: 'Pension', type: 'other', pricing: 'manual' },
    });
    await seedSnapshot(prisma, { accountId: manual.id, securityId: manualHoldingSecurityId(manual.id), date: '2026-10-01', quantity: 1, price: 900, source: 'manual' });
    await seedPrice(prisma, manualHoldingSecurityId(manual.id), '2026-10-01', 900, 'manual');
    const valued = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const cash = await seedSecurity(prisma, { type: 'cash', priceSymbol: null, pricing: 'fixed', fixedPrice: 1, name: 'USD cash' });
    await seedSnapshot(prisma, { accountId: valued.id, securityId: cash.id, date: '2026-10-01', quantity: 250, price: 1, source: 'manual' });
    const rows = await read([manual, valued]);
    expect(rows.map((r) => [r.kind, r.label, r.value, r.rangeChangePct])).toEqual(
      expect.arrayContaining([
        ['account', 'Pension', 900, null],
        ['cash', 'Cash', 250, null],
      ])
    );
  });

  it('ignores a valued account’s leftover manual-holding mirror', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    await prisma.security.create({
      data: { id: manualHoldingSecurityId(a.id), name: 'Mirror', type: 'other', pricing: 'manual' },
    });
    await seedSnapshot(prisma, { accountId: a.id, securityId: manualHoldingSecurityId(a.id), date: '2026-10-09', quantity: 1, price: 900, source: 'manual' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-05', quantity: 1, price: 10, source: 'manual' });
    expect((await read([a])).map((r) => r.label)).toEqual(['AAA']);
  });

  it('returns nothing for no accounts', async () => {
    expect(await read([])).toEqual([]);
  });
});
```

(Prettier will wrap the long `seedSnapshot` calls when you run `lint:fix`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/current-holdings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/investments/current-holdings.ts`:

```ts
import type { PrismaClient, Security } from '@prisma/client';
import { convertAmount } from '@/lib/currency';
import { PriceBook } from '@/lib/prices/price-book';
import type { HoldingKind, HoldingRow } from './holdings-view';
import { manualHoldingSecurityId } from './manual-holding';
import { roundCents } from './money';

export type CurrentHoldingsOptions = {
  accounts: { id: string; name: string; currency: string; balanceSource: string | null }[];
  today: Date;
  rangeStart: Date;
  baseCurrency: string;
  rates: Map<string, number>;
};

const CASH_LABELS: Record<string, string> = { cash: 'Cash', money_market: 'Money market' };

/** Each account's latest holdings set, priced for today, as page rows. */
export class CurrentHoldingsReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read(opts: CurrentHoldingsOptions): Promise<HoldingRow[]> {
    const { accounts, today, rangeStart, baseCurrency, rates } = opts;
    if (!accounts.length) return [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const isLeftoverMirror = (accountId: string, securityId: string) =>
      byId.get(accountId)?.balanceSource === 'valuation' &&
      securityId === manualHoldingSecurityId(accountId);

    const snapshots = (
      await this.prisma.holdingSnapshot.findMany({
        where: { accountId: { in: [...byId.keys()] }, date: { lte: today } },
        include: { security: true },
        orderBy: { date: 'desc' },
      })
    ).filter((s) => !isLeftoverMirror(s.accountId, s.securityId));
    const latestDay = new Map<string, number>();
    for (const s of snapshots) {
      if (!latestDay.has(s.accountId)) latestDay.set(s.accountId, s.date.getTime());
    }
    const current = snapshots.filter((s) => s.date.getTime() === latestDay.get(s.accountId));
    const book = await PriceBook.load(
      this.prisma,
      [...new Set(current.map((s) => s.securityId))],
      today
    );

    return current.map((s) => {
      const account = byId.get(s.accountId)!;
      const kind = kindOf(s.security, account.id);
      const price =
        s.source === 'plaid' ? s.price : (book.at(s.securityId, today)?.price ?? s.price);
      const toAccount = (v: number) =>
        convertAmount(v, s.security.currency, account.currency, rates);
      const toBase = (v: number) => convertAmount(v, account.currency, baseCurrency, rates);
      const value = toAccount(s.quantity * price);
      const startPrice = book.at(s.securityId, rangeStart)?.price;
      const endPrice = book.at(s.securityId, today)?.price;
      const marketPriced = kind === 'security' && s.security.pricing !== 'none';
      return {
        accountId: account.id,
        securityId: s.securityId,
        kind,
        label: labelOf(s.security, kind, account.name),
        name: s.security.name,
        type: s.security.type,
        pricing: s.security.pricing,
        currency: s.security.currency,
        quantity: s.quantity,
        price,
        priceInAccount: toAccount(price),
        value: roundCents(value),
        valueBase: roundCents(toBase(value)),
        gainBase: s.costBasis == null ? null : roundCents(toBase(value - toAccount(s.costBasis))),
        rangeChangePct:
          marketPriced && startPrice && endPrice
            ? ((endPrice - startPrice) / startPrice) * 100
            : null,
      };
    });
  }
}

function kindOf(security: Security, accountId: string): HoldingKind {
  if (security.id === manualHoldingSecurityId(accountId)) return 'account';
  return CASH_LABELS[security.type] ? 'cash' : 'security';
}

function labelOf(security: Security, kind: HoldingKind, accountName: string): string {
  if (kind === 'account') return accountName;
  if (kind === 'cash') return CASH_LABELS[security.type];
  return security.ticker ?? security.name;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/current-holdings.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/current-holdings.ts tests/unit/lib/investments/current-holdings.test.ts
git commit -m "feat(investments): read each account's current holdings as priced rows"
```

### Task 8: Activity feed

**Files:**
- Create: `src/lib/investments/activity.ts`
- Test: `tests/unit/lib/investments/activity.test.ts`

**Interfaces:**
- Consumes: `isoDay` (`dates.ts`).
- Produces:
  - `type ActivityInput = { id: string; accountId: string; date: Date; type: string; subtype: string; name: string; quantity: number | null; price: number | null; amount: number; securityId: string | null; ticker: string | null; securityName: string | null }`. `amount` keeps Plaid's sign: positive means cash left the account.
  - `type ActivityItem = { id: string; accountId: string; date: string; title: string; detail: string | null; amount: number }`, where `amount` is positive when cash comes into the account.
  - `buildActivity(rows: ActivityInput[]): ActivityItem[]`, newest first:
    - **Merge.** A dividend (`type: 'cash'`, subtype containing `dividend`) and a `buy` of the same security on the same day in the same account become one item. Its title is `Dividend reinvested · {sym}`, its amount is the dividend's, and its detail is the buy's `{qty} sh @ ${price}`.
    - **Titles.** These come from a rule table, as listed in Step 3.
  - `ACTIVITY_SHOWN = { all: 8, account: 5 }`: how many items the All view and one account's view list (Task 12 slices by it).
  - `ACTIVITY_ROWS_PER_ACCOUNT`: raw rows to load per account (Task 9) so every view can fill. It is twice the largest `ACTIVITY_SHOWN` value, because a merged dividend reinvestment uses two rows.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/investments/activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { utcDay } from '@/lib/investments/dates';
import { buildActivity, type ActivityInput } from '@/lib/investments/activity';

let n = 0;
const tx = (over: Partial<ActivityInput>): ActivityInput => ({
  id: `t${n++}`,
  accountId: 'a1',
  date: utcDay('2026-10-01'),
  type: 'cash',
  subtype: 'deposit',
  name: 'Raw name',
  quantity: null,
  price: null,
  amount: 0,
  securityId: 's1',
  ticker: 'AAA',
  securityName: 'Triple A',
  ...over,
});

describe('buildActivity', () => {
  it('titles common trades and cash events', () => {
    const items = buildActivity([
      tx({ type: 'buy', subtype: 'buy', quantity: 2, price: 50, amount: 100, date: utcDay('2026-10-05') }),
      tx({ type: 'sell', subtype: 'sell', quantity: -2, price: 10, amount: -20, date: utcDay('2026-10-04') }),
      tx({ subtype: 'dividend', amount: -3.5, date: utcDay('2026-10-03'), securityId: 's2', ticker: 'BBB' }),
      tx({ subtype: 'interest', amount: -1, securityId: null, ticker: null, date: utcDay('2026-10-02') }),
      tx({ subtype: 'deposit', amount: -500, securityId: null, ticker: null }),
    ]);
    expect(items.map((i) => [i.title, i.detail, i.amount])).toEqual([
      ['Buy · AAA', '2 sh @ $50.00', -100],
      ['Sell · AAA', '2 sh @ $10.00', 20],
      ['Dividend · BBB', null, 3.5],
      ['Interest', null, 1],
      ['Deposit', null, 500],
    ]);
    expect(items[0].date).toBe('2026-10-05');
  });

  it('merges a same-day dividend and reinvestment into one line', () => {
    const items = buildActivity([
      tx({ subtype: 'dividend', amount: -10 }),
      tx({ type: 'buy', subtype: 'buy', quantity: 0.25, price: 40, amount: 10 }),
      tx({ accountId: 'a2', type: 'buy', subtype: 'buy', quantity: 1, price: 5, amount: 5 }),
    ]);
    expect(items.map((i) => [i.accountId, i.title, i.detail, i.amount])).toEqual([
      ['a1', 'Dividend reinvested · AAA', '0.25 sh @ $40.00', 10],
      ['a2', 'Buy · AAA', '1 sh @ $5.00', -5],
    ]);
  });

  it('merges regardless of input order', () => {
    const items = buildActivity([
      tx({ type: 'buy', subtype: 'buy', quantity: 1, price: 2, amount: 2 }),
      tx({ subtype: 'dividend', amount: -2 }),
    ]);
    expect(items.map((i) => i.title)).toEqual(['Dividend reinvested · AAA']);
  });

  it('falls back to the institution’s name for unknown events', () => {
    expect(buildActivity([tx({ type: 'other', subtype: 'odd', name: 'Odd thing' })])[0].title).toBe(
      'Odd thing'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/activity.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/investments/activity.ts`:

```ts
import { isoDay } from './dates';

export type ActivityInput = {
  id: string;
  accountId: string;
  date: Date;
  type: string;
  subtype: string;
  name: string;
  quantity: number | null;
  price: number | null;
  amount: number; // Plaid sign: positive = cash leaves the account
  securityId: string | null;
  ticker: string | null;
  securityName: string | null;
};

export type ActivityItem = {
  id: string;
  accountId: string;
  date: string;
  title: string;
  detail: string | null;
  amount: number; // positive = cash into the account
};

const symbolOf = (r: ActivityInput) => r.ticker ?? r.securityName ?? '';
const titled = (label: string, r: ActivityInput) =>
  symbolOf(r) ? `${label} · ${symbolOf(r)}` : label;
const isDividend = (r: ActivityInput) => r.type === 'cash' && r.subtype.includes('dividend');

/** Items listed by the All view and by one account's view. */
export const ACTIVITY_SHOWN = { all: 8, account: 5 } as const;
/** Rows to load per account: enough for the longest view even if every item merges two rows. */
export const ACTIVITY_ROWS_PER_ACCOUNT = 2 * Math.max(...Object.values(ACTIVITY_SHOWN));

/** First matching rule names the event; unknown events keep the institution's description. */
const TITLE_RULES: { match: (r: ActivityInput) => boolean; title: (r: ActivityInput) => string }[] =
  [
    { match: (r) => r.type === 'buy', title: (r) => titled('Buy', r) },
    { match: (r) => r.type === 'sell', title: (r) => titled('Sell', r) },
    { match: isDividend, title: (r) => titled('Dividend', r) },
    { match: (r) => r.subtype.includes('interest'), title: () => 'Interest' },
    { match: (r) => r.type === 'fee' || r.subtype.includes('fee'), title: () => 'Fee' },
    { match: (r) => r.subtype === 'contribution', title: () => 'Contribution' },
    { match: (r) => r.subtype === 'deposit', title: () => 'Deposit' },
    { match: (r) => r.subtype === 'withdrawal', title: () => 'Withdrawal' },
    {
      match: (r) => r.type === 'transfer',
      title: (r) => (r.amount < 0 ? 'Transfer in' : 'Transfer out'),
    },
  ];

const titleOf = (r: ActivityInput) => TITLE_RULES.find((rule) => rule.match(r))?.title(r) ?? r.name;

const tradeDetail = (r: ActivityInput): string | null =>
  r.quantity != null && r.price != null
    ? `${Math.abs(r.quantity).toLocaleString('en-US', { maximumFractionDigits: 4 })} sh @ $${r.price.toFixed(2)}`
    : null;

const sameDaySecurity = (a: ActivityInput, b: ActivityInput) =>
  a.accountId === b.accountId &&
  a.securityId != null &&
  a.securityId === b.securityId &&
  a.date.getTime() === b.date.getTime();

/** Investment activity for display, newest first, with dividend reinvestments merged. */
export function buildActivity(rows: ActivityInput[]): ActivityItem[] {
  // Dividends first, so each claims its reinvestment before that buy could be listed alone.
  const ordered = [...rows].sort((a, b) => Number(isDividend(b)) - Number(isDividend(a)));
  const used = new Set<string>();
  const items: ActivityItem[] = [];
  for (const r of ordered) {
    if (used.has(r.id)) continue;
    const reinvest = isDividend(r)
      ? ordered.find((b) => b.type === 'buy' && !used.has(b.id) && sameDaySecurity(r, b))
      : undefined;
    used.add(r.id);
    if (reinvest) used.add(reinvest.id);
    items.push({
      id: r.id,
      accountId: r.accountId,
      date: isoDay(r.date),
      title: reinvest ? titled('Dividend reinvested', r) : titleOf(r),
      detail: tradeDetail(reinvest ?? r),
      amount: -r.amount,
    });
  }
  return items.sort((a, b) => b.date.localeCompare(a.date));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/activity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/activity.ts tests/unit/lib/investments/activity.test.ts
git commit -m "feat(investments): activity feed with merged dividend reinvestments"
```

### Task 9: Overview read model and API

One payload for the page, per range.

**Files:**
- Modify: `src/lib/investments/history.ts` (extract `convertSeries`, `sumSeries`)
- Create: `src/lib/investments/overview.ts`
- Modify: `src/lib/investments/services.ts`
- Create: `src/app/api/investments/overview/route.ts`
- Test: `tests/unit/lib/investments/overview.test.ts`, `tests/integration/api/investments-overview.test.ts`

**Interfaces:**
- Consumes:
  - `ValueHistoryService.accountSeries(accountId, from, to, { rates })` and `SeriesPoint`.
  - `getAccountBalances(prisma, accounts)` (`src/lib/balances.ts`).
  - `loadFxRates`, `convertAmount`.
  - `PriceRefresher.freshness` (Task 3), `CurrentHoldingsReader` (Task 7), `buildActivity` and `ACTIVITY_ROWS_PER_ACCOUNT` (Task 8).
  - `rangeStart`, `accountGroup`, `wrapperLabel`, `seriesChange` (Task 5).
- Produces:
  - In `history.ts`:
    - `convertSeries(points: SeriesPoint[], from: string, to: string, rates: Map<string, number>): SeriesPoint[]`.
    - `sumSeries(series: SeriesPoint[][]): SeriesPoint[]`. This is the day-by-day sum, ascending, with values rounded to cents. A day is estimated if any member's point is.
    - `portfolioSeries` now uses both.
  - Types exported from `src/lib/investments/overview.ts`, all JSON-safe:
    ```ts
    type BalanceSource = 'provider' | 'valuation' | 'manual';
    type PriceFreshnessView = { asOf: string | null; stale: boolean };
    type AccountStatus = {
      needsReauth: { since: string } | null;          // since = YYYY-MM-DD the connection broke
      waiting: { showingFrom: string | null } | null; // latest Plaid holdings day
      unpriced: { securityId: string; label: string }[];
      tradesReported: boolean;                        // false: provider account with no trades ever
    };
    type AccountSummary = {
      id: string; name: string; institution: string; group: AccountGroup; wrapper: string;
      currency: string; balanceSource: BalanceSource;
      value: number; valueBase: number; asOf: string | null;
      lastSyncAt: string | null;   // ISO timestamp
      enrollmentId: string | null; // Plaid enrollment, for Reconnect
      series: SeriesPoint[];       // base currency, the range
      change: SeriesChange | null; // null for manual accounts
      prices: PriceFreshnessView | null; // valued accounts only
      status: AccountStatus;
    };
    type InvestmentOverview = {
      range: Range; today: string; baseCurrency: string;
      prices: PriceFreshnessView;
      portfolio: { value: number; series: SeriesPoint[]; change: SeriesChange | null };
      accounts: AccountSummary[];
      holdings: HoldingRow[];
      activity: ActivityItem[];
    };
    ```
  - `class InvestmentOverviewService { constructor(prisma, history: Pick<ValueHistoryService, 'accountSeries'>, holdings: Pick<CurrentHoldingsReader, 'read'>, prices: Pick<PriceRefresher, 'freshness'>, clock?: Clock); load(range: Range): Promise<InvestmentOverview> }`.
  - `InvestmentServices.overview: InvestmentOverviewService`.
  - `GET /api/investments/overview?range=1M|3M|YTD|1Y` (default `3M`) → `200 InvestmentOverview`; `400 { error: 'Invalid range' }`; 500 via `investmentErrorResponse`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/lib/investments/overview.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  seedBalance,
  seedInvestmentAccount,
  seedPlaidConnection,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
  testServices,
} from '../../../helpers/investments';
import { ACTIVITY_ROWS_PER_ACCOUNT } from '@/lib/investments/activity';
import type { Range } from '@/lib/investments/portfolio-view';

let prisma: PrismaClient;
// Clock: Friday 2026-10-09 22:00Z, so 1M = 2026-09-09 … 2026-10-09.
const overview = (range: Range = '1M') => testServices(prisma).services.overview.load(range);

describe('InvestmentOverviewService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('converts a CAD account into the base currency', async () => {
    await prisma.exchangeRate.create({ data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.5 } });
    const cad = await seedInvestmentAccount(prisma, {
      balanceSource: 'manual',
      currency: 'CAD',
      type: 'retirement',
      name: 'CAD Plan',
    });
    await seedBalance(prisma, cad.id, '2026-10-01', 200, 'manual');
    const usd = await seedInvestmentAccount(prisma, { balanceSource: 'manual', name: 'USD Plan' });
    await seedBalance(prisma, usd.id, '2026-10-01', 50, 'manual');

    const o = await overview();
    expect(o).toMatchObject({ range: '1M', today: '2026-10-09', baseCurrency: 'USD' });
    const c = o.accounts.find((a) => a.id === cad.id)!;
    expect(c).toMatchObject({
      currency: 'CAD',
      value: 200,
      valueBase: 100,
      asOf: '2026-10-01',
      group: 'Retirement',
      wrapper: 'Retirement',
      balanceSource: 'manual',
      change: null,
      prices: null,
    });
    expect(c.series[0]).toEqual({ date: '2026-10-01', value: 100, isEstimated: false });
    expect(c.series.at(-1)).toEqual({ date: '2026-10-09', value: 100, isEstimated: true });
    expect(o.portfolio.value).toBe(150);
    expect(o.portfolio.series[0]).toEqual({ date: '2026-10-01', value: 150, isEstimated: false });
  });

  it('summarizes a Plaid account with its connection status', async () => {
    const a = await seedInvestmentAccount(prisma, { type: 'retirement' });
    await seedPlaidConnection(prisma, a.id, {
      subtype: '401k',
      status: 'needs_reauth',
      pendingSteps: 'holdings',
      lastSyncAt: new Date('2026-10-08T14:00:00Z'),
    });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-02', quantity: 1, price: 100 });
    await seedBalance(prisma, a.id, '2026-09-20', 90);
    await seedBalance(prisma, a.id, '2026-10-02', 100);

    const [summary] = (await overview()).accounts;
    expect(summary).toMatchObject({
      institution: 'Test Bank',
      wrapper: '401(k)',
      group: 'Retirement',
      balanceSource: 'provider',
      enrollmentId: expect.any(String),
      lastSyncAt: '2026-10-08T14:00:00.000Z',
      value: 100,
      asOf: '2026-10-02',
      change: { start: 90, end: 100, delta: 10 },
      status: {
        needsReauth: { since: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
        waiting: { showingFrom: '2026-10-02' },
        unpriced: [],
        tradesReported: false,
      },
    });
  });

  it('flags unpriced holdings and judges a valued account’s prices', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const priced = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const unpriced = await seedSecurity(prisma, { priceSymbol: 'ZZZ', pricing: 'none' });
    for (const s of [priced, unpriced]) {
      await seedSnapshot(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-01', quantity: 1, price: 10, source: 'manual' });
    }
    await seedPrice(prisma, priced.id, '2026-10-06', 10);
    await seedBalance(prisma, a.id, '2026-10-06', 20, 'valuation');

    const o = await overview();
    expect(o.accounts[0].status.unpriced).toEqual([{ securityId: unpriced.id, label: 'ZZZ' }]);
    expect(o.accounts[0].prices).toEqual({ asOf: '2026-10-06', stale: true });
    expect(o.prices).toEqual({ asOf: '2026-10-06', stale: true });
    expect(o.holdings.map((h) => h.label).sort()).toEqual(['AAA', 'ZZZ']);
  });

  it('lists activity newest first, merged, without cancelled trades', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedTrade(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-05', type: 'buy', quantity: 1, amount: 10 });
    await seedTrade(prisma, { accountId: a.id, securityId: s.id, date: '2026-10-06', type: 'sell', quantity: -1, amount: -12, isCancelled: true });
    await seedBalance(prisma, a.id, '2026-10-05', 10);

    const o = await overview();
    expect(o.activity.map((i) => [i.date, i.title])).toEqual([['2026-10-05', 'Buy · AAA']]);
    expect(o.accounts[0].status.tradesReported).toBe(true);
  });

  it('keeps a quiet account’s activity next to a busy one', async () => {
    const busy = await seedInvestmentAccount(prisma);
    const quiet = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    for (let d = 1; d <= ACTIVITY_ROWS_PER_ACCOUNT + 2; d++) {
      const date = `2026-09-${String(d).padStart(2, '0')}`;
      await seedTrade(prisma, { accountId: busy.id, securityId: s.id, date, type: 'buy', quantity: 1, amount: 1 });
    }
    await seedTrade(prisma, { accountId: quiet.id, securityId: s.id, date: '2026-08-01', type: 'buy', quantity: 1, amount: 1 });

    const { activity } = await overview();
    expect(activity.filter((i) => i.accountId === busy.id)).toHaveLength(ACTIVITY_ROWS_PER_ACCOUNT);
    expect(activity.filter((i) => i.accountId === quiet.id)).toHaveLength(1);
  });

  it('renders an empty overview without investment accounts', async () => {
    expect(await overview()).toMatchObject({
      accounts: [],
      holdings: [],
      activity: [],
      portfolio: { value: 0, series: [], change: null },
      prices: { asOf: null, stale: false },
    });
  });

  it('uses the stored base currency', async () => {
    await prisma.userSettings.create({ data: { baseCurrency: 'CAD' } });
    expect((await overview()).baseCurrency).toBe('CAD');
  });
});
```

(`seedTrade` stores no price, so the buy's detail is null; the test checks only date and title.)

Create `tests/integration/api/investments-overview.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { seedBalance, seedInvestmentAccount, testServices } from '../../helpers/investments';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('@/lib/investments/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/investments/services')>()),
  getInvestmentServices: vi.fn(),
}));

import { getInvestmentServices } from '@/lib/investments/services';
import { GET } from '@/app/api/investments/overview/route';

const get = (query = '') =>
  GET(new NextRequest(`http://localhost/api/investments/overview${query}`));

describe('GET /api/investments/overview', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.mocked(getInvestmentServices).mockResolvedValue(testServices(testPrisma).services);
  });

  it('defaults to 3M and returns the overview', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    await seedBalance(testPrisma, a.id, '2026-10-01', 10, 'manual');
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ range: '3M', accounts: [{ id: a.id, value: 10 }] });
  });

  it('accepts a range and rejects an unknown one', async () => {
    expect((await (await get('?range=YTD')).json()).range).toBe('YTD');
    const bad = await get('?range=5Y');
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: 'Invalid range' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/overview.test.ts tests/integration/api/investments-overview.test.ts`
Expected: FAIL — `services.overview` / the route don't exist.

- [ ] **Step 3: Extract the series helpers**

In `src/lib/investments/history.ts`, add below the `SeriesPoint` type:

```ts
/** A series re-expressed in another currency at today's rates, rounded to cents. */
export function convertSeries(
  points: SeriesPoint[],
  from: string,
  to: string,
  rates: Map<string, number>
): SeriesPoint[] {
  if (from === to) return points;
  return points.map((p) => ({ ...p, value: roundCents(convertAmount(p.value, from, to, rates)) }));
}

/** Day-by-day sum of series in one currency; a day is estimated when any member's point is. */
export function sumSeries(series: SeriesPoint[][]): SeriesPoint[] {
  const totals = new Map<string, { value: number; isEstimated: boolean }>();
  for (const points of series) {
    for (const p of points) {
      const total = totals.get(p.date) ?? { value: 0, isEstimated: false };
      total.value += p.value;
      total.isEstimated ||= p.isEstimated;
      totals.set(p.date, total);
    }
  }
  return [...totals.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([date, t]) => ({ date, value: roundCents(t.value), isEstimated: t.isEstimated }));
}
```

and replace the body of `portfolioSeries` with:

```ts
  async portfolioSeries(from: Date, to: Date, baseCurrency: string): Promise<SeriesPoint[]> {
    const accounts = await this.prisma.account.findMany({
      where: { trackingMode: 'investment', isActive: true },
      select: { id: true, currency: true },
    });
    const rates = await loadFxRates(this.prisma);
    const series: SeriesPoint[][] = [];
    for (const a of accounts) {
      const points = await this.accountSeries(a.id, from, to, { rates });
      series.push(convertSeries(points, a.currency, baseCurrency, rates));
    }
    return sumSeries(series);
  }
```

Run `npx vitest run tests/unit/lib/investments/history.test.ts tests/integration/api/investments-refresh-history.test.ts` — expected PASS (same results; values are now rounded per account before summing).

- [ ] **Step 4: Implement the service**

Create `src/lib/investments/overview.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { getAccountBalances } from '@/lib/balances';
import { convertAmount } from '@/lib/currency';
import { loadFxRates } from '@/lib/prices/price-book';
import type { PriceFreshness, PriceRefresher } from '@/lib/prices/refresh';
import { ACTIVITY_ROWS_PER_ACCOUNT, buildActivity, type ActivityItem } from './activity';
import type { CurrentHoldingsReader } from './current-holdings';
import { isoDay, utcDay } from './dates';
import { convertSeries, sumSeries, type SeriesPoint, type ValueHistoryService } from './history';
import type { HoldingRow } from './holdings-view';
import { roundCents } from './money';
import {
  accountGroup,
  rangeStart,
  seriesChange,
  wrapperLabel,
  type AccountGroup,
  type Range,
  type SeriesChange,
} from './portfolio-view';

export type BalanceSource = 'provider' | 'valuation' | 'manual';
export type PriceFreshnessView = { asOf: string | null; stale: boolean };

export type AccountStatus = {
  needsReauth: { since: string } | null;
  waiting: { showingFrom: string | null } | null;
  unpriced: { securityId: string; label: string }[];
  tradesReported: boolean;
};

export type AccountSummary = {
  id: string;
  name: string;
  institution: string;
  group: AccountGroup;
  wrapper: string;
  currency: string;
  balanceSource: BalanceSource;
  value: number;
  valueBase: number;
  asOf: string | null;
  lastSyncAt: string | null;
  enrollmentId: string | null;
  series: SeriesPoint[];
  change: SeriesChange | null;
  prices: PriceFreshnessView | null;
  status: AccountStatus;
};

export type InvestmentOverview = {
  range: Range;
  today: string;
  baseCurrency: string;
  prices: PriceFreshnessView;
  portfolio: { value: number; series: SeriesPoint[]; change: SeriesChange | null };
  accounts: AccountSummary[];
  holdings: HoldingRow[];
  activity: ActivityItem[];
};

/** Plaid steps whose pending state means the account is waiting on its institution. */
const WAITING_STEPS = new Set(['holdings', 'transactions']);

const freshnessView = (f: PriceFreshness): PriceFreshnessView => ({
  asOf: f.asOf ? isoDay(f.asOf) : null,
  stale: f.stale,
});

/** Everything the investments page shows for one range, in one payload. */
export class InvestmentOverviewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly history: Pick<ValueHistoryService, 'accountSeries'>,
    private readonly holdings: Pick<CurrentHoldingsReader, 'read'>,
    private readonly prices: Pick<PriceRefresher, 'freshness'>,
    private readonly clock: Clock = systemClock
  ) {}

  async load(range: Range): Promise<InvestmentOverview> {
    const prisma = this.prisma;
    const today = utcDay(this.clock.now());
    const from = rangeStart(range, today);
    const [accounts, settings, rates] = await Promise.all([
      prisma.account.findMany({
        where: { trackingMode: 'investment', isActive: true },
        include: {
          plaidConnection: {
            include: { plaidEnrollment: { select: { id: true, institutionName: true } } },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.userSettings.findFirst(),
      loadFxRates(prisma),
    ]);
    const baseCurrency = settings?.baseCurrency || 'USD';
    const ids = accounts.map((a) => a.id);

    const [balances, holdings, trades, plaidDays, recent, prices] = await Promise.all([
      getAccountBalances(prisma, accounts),
      this.holdings.read({ accounts, today, rangeStart: from, baseCurrency, rates }),
      prisma.investmentTransaction.groupBy({
        by: ['accountId'],
        _count: { _all: true },
        where: { accountId: { in: ids } },
      }),
      prisma.holdingSnapshot.groupBy({
        by: ['accountId'],
        _max: { date: true },
        where: { accountId: { in: ids }, source: 'plaid' },
      }),
      // Newest rows per account, so a busy account can't crowd out a quieter one's feed.
      Promise.all(
        ids.map((accountId) =>
          prisma.investmentTransaction.findMany({
            where: { accountId, isCancelled: false, type: { not: 'cancel' } },
            include: { security: { select: { ticker: true, name: true } } },
            orderBy: { date: 'desc' },
            take: ACTIVITY_ROWS_PER_ACCOUNT,
          })
        )
      ),
      this.prices.freshness(),
    ]);
    const tradeCount = new Map(trades.map((t) => [t.accountId, t._count._all]));
    const lastPlaidDay = new Map(plaidDays.map((d) => [d.accountId, d._max.date]));

    const summaries: AccountSummary[] = [];
    for (const a of accounts) {
      const native = await this.history.accountSeries(a.id, from, today, { rates });
      const series = convertSeries(native, a.currency, baseCurrency, rates);
      const balance = balances.get(a.id)!;
      const rows = holdings.filter((h) => h.accountId === a.id);
      const source = (a.balanceSource ?? 'manual') as BalanceSource;
      const conn = a.plaidConnection;
      const pending = conn?.pendingSteps?.split(',') ?? [];
      const showingFrom = lastPlaidDay.get(a.id);
      summaries.push({
        id: a.id,
        name: a.name,
        institution: a.institution ?? conn?.plaidEnrollment.institutionName ?? '',
        group: accountGroup(a.type),
        wrapper: wrapperLabel(conn?.plaidAccountSubtype ?? null, a.type),
        currency: a.currency,
        balanceSource: source,
        value: balance.balance,
        valueBase: roundCents(convertAmount(balance.balance, a.currency, baseCurrency, rates)),
        asOf: balance.asOf ? isoDay(balance.asOf) : null,
        lastSyncAt: conn?.lastSyncAt?.toISOString() ?? null,
        enrollmentId: conn?.plaidEnrollment.id ?? null,
        series,
        change: source === 'manual' ? null : seriesChange(series),
        prices:
          source === 'valuation'
            ? freshnessView(
                await this.prices.freshness({ securityIds: rows.map((r) => r.securityId) })
              )
            : null,
        status: {
          needsReauth: conn?.status === 'needs_reauth' ? { since: isoDay(conn.updatedAt) } : null,
          waiting: pending.some((s) => WAITING_STEPS.has(s))
            ? { showingFrom: showingFrom ? isoDay(showingFrom) : null }
            : null,
          unpriced: rows
            .filter((r) => r.pricing === 'none')
            .map((r) => ({ securityId: r.securityId, label: r.label })),
          tradesReported: source !== 'provider' || (tradeCount.get(a.id) ?? 0) > 0,
        },
      });
    }

    const portfolioSeries = sumSeries(summaries.map((s) => s.series));
    return {
      range,
      today: isoDay(today),
      baseCurrency,
      prices: freshnessView(prices),
      portfolio: {
        value: roundCents(summaries.reduce((sum, s) => sum + s.valueBase, 0)),
        series: portfolioSeries,
        change: seriesChange(portfolioSeries),
      },
      accounts: summaries,
      holdings,
      activity: buildActivity(
        recent.flat().map((t) => ({
          id: t.id,
          accountId: t.accountId,
          date: t.date,
          type: t.type,
          subtype: t.subtype,
          name: t.name,
          quantity: t.quantity,
          price: t.price,
          amount: t.amount,
          securityId: t.securityId,
          ticker: t.security?.ticker ?? null,
          securityName: t.security?.name ?? null,
        }))
      ),
    };
  }
}
```

- [ ] **Step 5: Wire it into the composition root**

In `src/lib/investments/services.ts`: import `CurrentHoldingsReader` from `./current-holdings` and `InvestmentOverviewService` from `./overview`; add `overview: InvestmentOverviewService;` to `InvestmentServices`; and in `createInvestmentServices` build `history` once and add the service:

```ts
  const history = new ValueHistoryService(prisma);
  return {
    prices,
    quotes,
    catalog,
    manualHoldings,
    valuation,
    history,
    refresh: new InvestmentRefreshService(prices, valuation, catalog),
    overview: new InvestmentOverviewService(
      prisma,
      history,
      new CurrentHoldingsReader(prisma),
      prices,
      clock
    ),
  };
```

- [ ] **Step 6: Add the route**

Create `src/app/api/investments/overview/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { DEFAULT_RANGE, isRange } from '@/lib/investments/portfolio-view';
import { investmentErrorResponse } from '../_lib/http';

/** Everything the investments page shows for one range. */
export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get('range') ?? DEFAULT_RANGE;
  if (!isRange(range)) return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  try {
    const { overview } = await getInvestmentServices();
    return NextResponse.json(await overview.load(range));
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load investments');
  }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments tests/integration/api/investments-overview.test.ts tests/integration/api/investments-refresh-history.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add src/lib/investments/history.ts src/lib/investments/overview.ts src/lib/investments/services.ts src/app/api/investments/overview/route.ts tests/unit/lib/investments/overview.test.ts tests/integration/api/investments-overview.test.ts
git commit -m "feat(investments): overview read model and API for the investments page"
```

### Task 10: Formatting, chart geometry and treemap layout

Pure client-side helpers, unit-tested without a DOM.

**Files:**
- Create: `src/components/investments/format.ts`
- Create: `src/components/investments/chart-geometry.ts`
- Create: `src/components/investments/treemap.ts`
- Create: `src/components/investments/institution-mark.ts`
- Test: `tests/unit/components/investments/format.test.ts`, `tests/unit/components/investments/chart-geometry.test.ts`, `tests/unit/components/investments/treemap.test.ts`

**Interfaces:**
- Consumes: `getCurrencySymbol` (`src/lib/currency.ts`); `SeriesChange` (Task 5); `PIE_COLORS` (`src/components/chart-renderer.tsx`).
- Produces:
  - `format.ts`:
    - `MINUS` (U+2212).
    - `fmtMoney(v, { cents?, currency? })` gives `$1,234` / `CA$1,234` / `−$5`.
    - `fmtSignedMoney(v)` gives `+$5` / `−$5`.
    - `fmtCompact(v)` gives `$12.3k` / `$123k` / `$950`.
    - `fmtPct(p)` gives `+1.2%` / `−3.0%`.
    - `fmtQty(q)` (up to 4 decimals).
    - `fmtDay(iso)` gives `Oct 9` (UTC).
    - `fmtSyncTime(isoTimestamp)` gives `Oct 9, 9:24 AM` (local).
    - `daysBetween(fromIso, toIso)`.
    - `type Tone = 'up' | 'down' | 'flat'` and `toneOf(pct: number | null): Tone` (±0.05 deadband).
    - `signedTone(v: number | null): string` gives the text-colour class for a signed figure: muted when null, green when ≥ 0, red below 0 (used by the holdings map and table).
    - `changeText(change: SeriesChange)` gives `↗ $1,234 · +2.1%`.
  - `chart-geometry.ts`: `type ChartBox = { width: number; height: number; pad: number; yMin?: number }`; `type ChartGeometry = { solid: string; dashed: string; area: string; points: { x: number; y: number }[] }`; `chartGeometry(points: { value: number; isEstimated: boolean }[], box: ChartBox): ChartGeometry | null`. Returns null with fewer than two points. A segment is dashed when either of its endpoints is estimated.
  - `treemap.ts`: `type Tile = { key: string; x: number; y: number; w: number; h: number }`; `squarify(items: { key: string; value: number }[], width: number, height: number): Tile[]`; `tileBackground(changePct: number | null): string`.
  - `institution-mark.ts`: `institutionMark(name: string): { initials: string; color: string }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/investments/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  changeText,
  daysBetween,
  fmtCompact,
  fmtDay,
  fmtMoney,
  fmtPct,
  fmtQty,
  fmtSignedMoney,
  fmtSyncTime,
  signedTone,
  toneOf,
} from '@/components/investments/format';
import { institutionMark } from '@/components/investments/institution-mark';
import { PIE_COLORS } from '@/components/chart-renderer';

describe('investment formatting', () => {
  it('formats money with a true minus and native prefixes', () => {
    expect(fmtMoney(1234.4)).toBe('$1,234');
    expect(fmtMoney(-5)).toBe('−$5');
    expect(fmtMoney(-0.4)).toBe('$0');
    expect(fmtMoney(12.5, { cents: true })).toBe('$12.50');
    expect(fmtMoney(1000, { currency: 'CAD' })).toBe('CA$1,000');
    expect(fmtSignedMoney(5)).toBe('+$5');
    expect(fmtSignedMoney(-5)).toBe('−$5');
  });

  it('compacts large values', () => {
    expect(fmtCompact(950)).toBe('$950');
    expect(fmtCompact(12_345)).toBe('$12.3k');
    expect(fmtCompact(123_456)).toBe('$123k');
  });

  it('formats percentages, quantities and dates', () => {
    expect(fmtPct(1.234)).toBe('+1.2%');
    expect(fmtPct(-3)).toBe('−3.0%');
    expect(fmtQty(1234.56789)).toBe('1,234.5679');
    expect(fmtDay('2026-10-09')).toBe('Oct 9');
    expect(fmtSyncTime('2026-10-09T13:24:00Z')).toMatch(/^Oct \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
    expect(daysBetween('2026-07-12', '2026-10-09')).toBe(89);
  });

  it('describes a change with an arrow outside the deadband', () => {
    expect(toneOf(0.04)).toBe('flat');
    expect(toneOf(null)).toBe('flat');
    expect(signedTone(null)).toBe('text-[var(--text-muted)]');
    expect(signedTone(0)).toBe('text-[var(--green)]');
    expect(signedTone(-1)).toBe('text-[var(--red)]');
    expect(changeText({ start: 100, end: 110, delta: 10, pct: 10 })).toBe('↗ $10 · +10.0%');
    expect(changeText({ start: 100, end: 90, delta: -10, pct: -10 })).toBe('↘ −$10 · −10.0%');
    expect(changeText({ start: 0, end: 5, delta: 5, pct: null })).toBe('$5');
  });

  it('marks institutions with initials and a stable palette colour', () => {
    expect(PIE_COLORS).toContain(institutionMark('Test Brokerage').color);
    expect(institutionMark('Test Brokerage').initials).toBe('TB');
    expect(institutionMark('acme').initials).toBe('A');
    expect(institutionMark('').initials).toBe('?');
  });
});
```

Create `tests/unit/components/investments/chart-geometry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { chartGeometry } from '@/components/investments/chart-geometry';

const p = (value: number, isEstimated = false) => ({ value, isEstimated });

describe('chartGeometry', () => {
  it('needs two points', () => {
    expect(chartGeometry([p(1)], { width: 100, height: 10, pad: 0 })).toBeNull();
  });

  it('maps values into the box, dashing segments that touch an estimate', () => {
    const g = chartGeometry([p(0), p(10), p(10, true), p(0)], { width: 90, height: 10, pad: 0 })!;
    expect(g.points).toEqual([
      { x: 0, y: 10 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
      { x: 90, y: 10 },
    ]);
    expect(g.solid).toBe('M0,10L30,0');
    expect(g.dashed).toBe('M30,0L60,0M60,0L90,10');
    expect(g.area).toBe('M0,10L30,0L60,0L90,10L90,10L0,10Z');
  });

  it('lowers the floor to yMin and centres a flat series', () => {
    const floored = chartGeometry([p(100), p(100)], { width: 10, height: 10, pad: 0, yMin: 80 })!;
    expect(floored.points.map((pt) => pt.y)).toEqual([0, 0]);
    const flat = chartGeometry([p(5), p(5)], { width: 10, height: 10, pad: 0 })!;
    expect(flat.points.map((pt) => pt.y)).toEqual([10, 10]);
  });
});
```

Create `tests/unit/components/investments/treemap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { squarify, tileBackground } from '@/components/investments/treemap';

describe('squarify', () => {
  it('splits two equal values into two squares', () => {
    expect(squarify([{ key: 'a', value: 1 }, { key: 'b', value: 1 }], 200, 100)).toEqual([
      { key: 'a', x: 0, y: 0, w: 100, h: 100 },
      { key: 'b', x: 100, y: 0, w: 100, h: 100 },
    ]);
  });

  it('fills the box exactly, largest first, ignoring empty values', () => {
    const tiles = squarify(
      [
        { key: 's', value: 1 },
        { key: 'l', value: 6 },
        { key: 'm', value: 3 },
        { key: 'z', value: 0 },
      ],
      300,
      200
    );
    expect(tiles.map((t) => t.key)).toEqual(['l', 'm', 's']);
    const area = tiles.reduce((sum, t) => sum + t.w * t.h, 0);
    expect(area).toBeCloseTo(60_000);
    for (const t of tiles) {
      expect(t.x + t.w).toBeLessThanOrEqual(300.0001);
      expect(t.y + t.h).toBeLessThanOrEqual(200.0001);
    }
  });

  it('returns nothing for an empty box or no value', () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify([{ key: 'a', value: 1 }], 0, 100)).toEqual([]);
  });
});

describe('tileBackground', () => {
  it('is neutral without a market change and deepens with the size of the move', () => {
    expect(tileBackground(null)).toBe('var(--bg-elevated)');
    expect(tileBackground(0)).toBe('color-mix(in srgb, var(--green) 14%, var(--bg-card))');
    expect(tileBackground(-24)).toBe('color-mix(in srgb, var(--red) 60%, var(--bg-card))');
    expect(tileBackground(6)).toBe('color-mix(in srgb, var(--green) 37%, var(--bg-card))');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `src/components/investments/format.ts`:

```ts
import { getCurrencySymbol } from '@/lib/currency';
import type { SeriesChange } from '@/lib/investments/portfolio-view';

export const MINUS = '−';
const DAY_MS = 86_400_000;
const DEADBAND_PCT = 0.05;

const symbolFor = (currency = 'USD') => (currency === 'CAD' ? 'CA$' : getCurrencySymbol(currency));

/** `$1,234`, `CA$1,234`, `−$5` (U+2212). Whole units unless `cents`. */
export function fmtMoney(v: number, opts: { cents?: boolean; currency?: string } = {}): string {
  const digits = opts.cents ? 2 : 0;
  const rounded = Number(v.toFixed(digits));
  const body = Math.abs(rounded).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${rounded < 0 ? MINUS : ''}${symbolFor(opts.currency)}${body}`;
}

export const fmtSignedMoney = (v: number): string =>
  Number(v.toFixed(0)) > 0 ? `+${fmtMoney(v)}` : fmtMoney(v);

/** Treemap values: `$12.3k`, `$123k` from 100k, plain dollars under 1k. */
export function fmtCompact(v: number): string {
  if (Math.abs(v) < 1000) return fmtMoney(v);
  const k = v / 1000;
  return `${v < 0 ? MINUS : ''}$${Math.abs(k).toFixed(Math.abs(v) >= 100_000 ? 0 : 1)}k`;
}

export const fmtPct = (p: number): string => `${p >= 0 ? '+' : MINUS}${Math.abs(p).toFixed(1)}%`;

export const fmtQty = (q: number): string =>
  q.toLocaleString('en-US', { maximumFractionDigits: 4 });

/** `Oct 9` for a `YYYY-MM-DD` day. */
export const fmtDay = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** `Oct 9, 9:24 AM` in local time, for sync timestamps. */
export const fmtSyncTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const daysBetween = (fromIso: string, toIso: string): number =>
  Math.round(
    (Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) - Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) /
      DAY_MS
  );

export type Tone = 'up' | 'down' | 'flat';

export function toneOf(pct: number | null): Tone {
  if (pct == null || Math.abs(pct) <= DEADBAND_PCT) return 'flat';
  return pct > 0 ? 'up' : 'down';
}

const ARROWS: Record<Tone, string> = { up: '↗ ', down: '↘ ', flat: '' };

/** Text colour for a signed figure (gain, price change): muted when unknown. */
export const signedTone = (v: number | null): string =>
  v == null ? 'text-[var(--text-muted)]' : v >= 0 ? 'text-[var(--green)]' : 'text-[var(--red)]';

/** `↗ $1,234 · +2.1%` — a balance change, never labelled a return. */
export function changeText(change: SeriesChange): string {
  const money = `${ARROWS[toneOf(change.pct)]}${fmtMoney(change.delta)}`;
  return change.pct == null ? money : `${money} · ${fmtPct(change.pct)}`;
}
```

Create `src/components/investments/chart-geometry.ts`:

```ts
export type ChartBox = { width: number; height: number; pad: number; yMin?: number };
export type ChartGeometry = {
  solid: string;
  dashed: string;
  area: string;
  points: { x: number; y: number }[];
};

const r = (n: number) => Number(n.toFixed(2));

/**
 * SVG paths for a value series in a `width × height` box. Each segment is drawn solid when both
 * ends are recorded values, dashed when either is estimated. `yMin` lowers the floor (manual
 * accounts, so a flat carry-forward doesn't hug the baseline). A flat series sits on the floor.
 */
export function chartGeometry(
  points: { value: number; isEstimated: boolean }[],
  box: ChartBox
): ChartGeometry | null {
  if (points.length < 2) return null;
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values, box.yMin ?? Infinity);
  const span = max - min || 1;
  const xy = points.map((p, i) => ({
    x: r((i / (points.length - 1)) * box.width),
    y: r(box.pad + (1 - (p.value - min) / span) * (box.height - 2 * box.pad)),
  }));
  let solid = '';
  let dashed = '';
  for (let i = 1; i < xy.length; i++) {
    const seg = `M${xy[i - 1].x},${xy[i - 1].y}L${xy[i].x},${xy[i].y}`;
    if (points[i].isEstimated || points[i - 1].isEstimated) dashed += seg;
    else solid += seg;
  }
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
  return { solid, dashed, area: `${line}L${box.width},${box.height}L0,${box.height}Z`, points: xy };
}
```

(Check against the test: a flat series has `span = 0 → 1`, `value − min = 0`, so `y = pad + (h − 2·pad)` = the floor.)

Create `src/components/investments/treemap.ts`:

```ts
export type Tile = { key: string; x: number; y: number; w: number; h: number };

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/** Squarified treemap (Bruls et al.): tiles with areas proportional to value, largest first. */
export function squarify(
  items: { key: string; value: number }[],
  width: number,
  height: number
): Tile[] {
  const positive = items.filter((i) => i.value > 0);
  const total = positive.reduce((sum, i) => sum + i.value, 0);
  if (!total || width <= 0 || height <= 0) return [];
  const scale = (width * height) / total;
  const queue = positive
    .sort((a, b) => b.value - a.value)
    .map((i) => ({ key: i.key, area: i.value * scale }));

  const tiles: Tile[] = [];
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  while (queue.length) {
    const side = Math.min(w, h);
    const row = [queue.shift()!];
    while (
      queue.length &&
      worst([...row, queue[0]].map((t) => t.area), side) <= worst(row.map((t) => t.area), side)
    ) {
      row.push(queue.shift()!);
    }
    const rowArea = row.reduce((sum, t) => sum + t.area, 0);
    if (w >= h) {
      const colW = rowArea / h;
      let cy = y;
      for (const t of row) {
        tiles.push({ key: t.key, x, y: cy, w: colW, h: t.area / colW });
        cy += t.area / colW;
      }
      x += colW;
      w -= colW;
    } else {
      const rowH = rowArea / w;
      let cx = x;
      for (const t of row) {
        tiles.push({ key: t.key, x: cx, y, w: t.area / rowH, h: rowH });
        cx += t.area / rowH;
      }
      y += rowH;
      h -= rowH;
    }
  }
  return tiles;
}

/** Muted diverging tint by range price change: 14% at no change up to 60% at ±12% or more. */
export function tileBackground(changePct: number | null): string {
  if (changePct == null) return 'var(--bg-elevated)';
  const strength = Math.round(14 + Math.min(Math.abs(changePct) / 12, 1) * 46);
  const base = changePct >= 0 ? 'var(--green)' : 'var(--red)';
  return `color-mix(in srgb, ${base} ${strength}%, var(--bg-card))`;
}
```

Create `src/components/investments/institution-mark.ts`:

```ts
import { PIE_COLORS } from '@/components/chart-renderer';

/** Initials (first letters of up to two words) and a stable palette colour for an institution. */
export function institutionMark(name: string): { initials: string; color: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { initials, color: PIE_COLORS[hash % PIE_COLORS.length] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/components/investments/format.ts src/components/investments/chart-geometry.ts src/components/investments/treemap.ts src/components/investments/institution-mark.ts tests/unit/components/investments
git commit -m "feat(investments): formatting, chart geometry and treemap layout helpers"
```

### Task 11: Display components

Presentational building blocks for the detail panel and navigator. They hold no state, do no fetching, and contain no page rules.

**Files:**
- Create: `src/components/investments/value-chart.tsx` (`ValueChart`, `Sparkline`)
- Create: `src/components/investments/pills.tsx` (`SourcePill`, `ChangeChip`, `StatusDot`, `FlagPill`, `Notice`)
- Create: `src/components/investments/holdings-map.tsx` (`HoldingsMap`)
- Create: `src/components/investments/allocation-bars.tsx` (`AllocationBars`)
- Create: `src/components/investments/holdings-table.tsx` (`HoldingsTable`)
- Create: `src/components/investments/activity-list.tsx` (`ActivityList`)
- Test: `tests/unit/components/investments/display.test.tsx`

**Interfaces:**
- Consumes: Task 10 helpers; `SeriesPoint` (`src/lib/investments/history.ts`); `HoldingLine`, `AllocationSlice` (Task 6); `ActivityItem` (Task 8); `BalanceSource` (Task 9); `SeriesChange` (Task 5).
- Produces (all named exports, client components):
  - `ValueChart({ points: SeriesPoint[]; manual?: boolean })` — an 820×170 area chart:
    - three gridlines and an accent gradient;
    - a solid `data-testid="chart-solid"` path and a dashed `data-testid="chart-dashed"` path;
    - HTML markers: `data-testid="chart-entry"` on each manual entry and `data-testid="chart-end"` on the last point;
    - start, middle and end date labels.

    With fewer than two points it shows the placeholder "Not enough history in this range yet."
  - `Sparkline({ points: SeriesPoint[]; tone: 'up' | 'down' | 'muted' })` — 64×24, no axis; an empty 64×24 span when under two points.
  - `SourcePill({ source: BalanceSource })` → "Plaid" / "Valued" / "Manual".
  - `ChangeChip({ change: SeriesChange })` → `changeText`, toned by `toneOf(change.pct)`.
  - `StatusDot({ tone: 'warn' | 'err'; title: string })` — a 6 px dot, with `title` and `aria-label` set.
  - `FlagPill({ children })` — the accent pill, e.g. "No price source".
  - `Notice({ tone: 'warn' | 'err'; lead: string; text: string; action?: ReactNode })`.
  - `HoldingsMap({ lines: HoldingLine[]; height: number })` — the squarified treemap. A tile's tooltip is `{name} · {$value} · {weight}% of portfolio`.
  - `AllocationBars({ slices: AllocationSlice[] })`.
  - `HoldingsTable({ lines: HoldingLine[]; multiAccount: boolean })` — columns Security / Value / Gain / Weight. It shows the "N accounts" tag when `multiAccount` and `accountCount > 1`, a "No price source" pill on unpriced lines, and a `{qty} · {name}` sub-line. Weights have 1 decimal when `multiAccount`, else 0.
  - `ActivityList({ items: ActivityItem[]; sourceOf?: (accountId: string) => string | null; emptyText: string })`. `sourceOf` adds the "{account} · {institution}" prefix to the sub-line in the All view.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/investments/display.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { ValueChart, Sparkline } from '@/components/investments/value-chart';
import { ChangeChip, Notice, SourcePill, StatusDot } from '@/components/investments/pills';
import { HoldingsMap } from '@/components/investments/holdings-map';
import { AllocationBars } from '@/components/investments/allocation-bars';
import { HoldingsTable } from '@/components/investments/holdings-table';
import { ActivityList } from '@/components/investments/activity-list';
import type { HoldingLine } from '@/lib/investments/holdings-view';

const point = (date: string, value: number, isEstimated = false) => ({ date, value, isEstimated });

const line = (over: Partial<HoldingLine>): HoldingLine => ({
  key: 's1',
  label: 'AAA',
  name: 'Triple A Fund',
  kind: 'security',
  securityId: 's1',
  quantity: 12.5,
  valueBase: 1500,
  gainBase: 250,
  rangeChangePct: 3.2,
  accountCount: 1,
  unpriced: false,
  weightPct: 60,
  ...over,
});

describe('ValueChart', () => {
  it('shows a placeholder when the range has under two points', () => {
    render(<ValueChart points={[point('2026-10-09', 5)]} />);
    expect(screen.getByText('Not enough history in this range yet.')).toBeInTheDocument();
  });

  it('draws solid and dashed segments with start, middle and end labels', () => {
    render(
      <ValueChart
        points={[point('2026-10-01', 1), point('2026-10-02', 2, true), point('2026-10-03', 3)]}
      />
    );
    expect(screen.getByTestId('chart-dashed').getAttribute('d')).not.toBe('');
    expect(screen.getByTestId('chart-end')).toBeInTheDocument();
    expect(screen.getByText('Oct 1')).toBeInTheDocument();
    expect(screen.getByText('Oct 2')).toBeInTheDocument();
    expect(screen.getByText('Oct 3')).toBeInTheDocument();
  });

  it('marks manual entries', () => {
    render(
      <ValueChart
        manual
        points={[point('2026-10-01', 1), point('2026-10-02', 1, true), point('2026-10-03', 2)]}
      />
    );
    expect(screen.getAllByTestId('chart-entry')).toHaveLength(1);
  });
});

describe('Sparkline', () => {
  it('renders an empty slot without enough points', () => {
    const { container } = render(<Sparkline points={[]} tone="up" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('pills', () => {
  it('labels sources, changes, dots and notices', () => {
    render(
      <>
        <SourcePill source="valuation" />
        <ChangeChip change={{ start: 100, end: 110, delta: 10, pct: 10 }} />
        <StatusDot title="Waiting on Test Brokerage" tone="warn" />
        <Notice action={<button type="button">Retry</button>} lead="Prices are from Oct 6." text="The price source didn’t respond." tone="warn" />
      </>
    );
    expect(screen.getByText('Valued')).toBeInTheDocument();
    expect(screen.getByText('↗ $10 · +10.0%')).toBeInTheDocument();
    expect(screen.getByLabelText('Waiting on Test Brokerage')).toBeInTheDocument();
    expect(screen.getByText('Prices are from Oct 6.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('HoldingsMap', () => {
  it('draws a tile per line with a tooltip', () => {
    render(
      <HoldingsMap
        height={250}
        lines={[line({}), line({ key: 's2', label: 'BBB', name: 'B Fund', valueBase: 1000, weightPct: 40 })]}
      />
    );
    expect(screen.getByTitle('Triple A Fund · $1,500 · 60.0% of portfolio')).toBeInTheDocument();
    expect(screen.getByText('BBB')).toBeInTheDocument();
  });
});

describe('AllocationBars', () => {
  it('lists slices with one-decimal shares', () => {
    render(<AllocationBars slices={[{ label: 'ETF', value: 60, pct: 60 }, { label: 'Cash & MM', value: 40, pct: 40 }]} />);
    expect(screen.getByText('ETF')).toBeInTheDocument();
    expect(screen.getByText('40.0%')).toBeInTheDocument();
  });
});

describe('HoldingsTable', () => {
  it('shows the accounts tag, unpriced flag and a dash for unknown gain', () => {
    render(
      <HoldingsTable
        multiAccount
        lines={[
          line({ accountCount: 2 }),
          line({ key: 's2', label: 'ZZZ', unpriced: true, gainBase: null, quantity: null, weightPct: 40 }),
        ]}
      />
    );
    expect(screen.getByText('2 accounts')).toBeInTheDocument();
    expect(screen.getByText('No price source')).toBeInTheDocument();
    expect(screen.getByText('+$250')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('12.5 · Triple A Fund')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
  });

  it('uses whole-number weights for one account and hides the tag', () => {
    render(<HoldingsTable lines={[line({ accountCount: 2 })]} multiAccount={false} />);
    expect(screen.queryByText('2 accounts')).toBeNull();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });
});

describe('ActivityList', () => {
  const item = {
    id: 't1',
    accountId: 'a1',
    date: '2026-10-05',
    title: 'Buy · AAA',
    detail: '1 sh @ $5.00',
    amount: -5,
  };

  it('shows the empty copy', () => {
    render(<ActivityList emptyText="No activity reported." items={[]} />);
    expect(screen.getByText('No activity reported.')).toBeInTheDocument();
  });

  it('prefixes the account in the all-accounts view and signs amounts', () => {
    render(<ActivityList emptyText="" items={[item]} sourceOf={() => 'Brokerage · Test Bank'} />);
    const row = screen.getByText('Buy · AAA').closest('.grid') as HTMLElement;
    expect(within(row).getByText('Brokerage · Test Bank · 1 sh @ $5.00')).toBeInTheDocument();
    expect(within(row).getByText('−$5.00')).toBeInTheDocument();
    expect(within(row).getByText('Oct 5')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/display.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

Create `src/components/investments/value-chart.tsx`:

```tsx
'use client';

import type { SeriesPoint } from '@/lib/investments/history';
import { chartGeometry } from './chart-geometry';
import { fmtDay } from './format';

const WIDTH = 820;
const HEIGHT = 170;

/** Balance history: solid where recorded, dashed where estimated; dots on manual entries. */
export function ValueChart({ points, manual = false }: { points: SeriesPoint[]; manual?: boolean }) {
  const last = points.at(-1)?.value ?? 0;
  const geo = chartGeometry(points, {
    width: WIDTH,
    height: HEIGHT,
    pad: 8,
    yMin: manual ? last * 0.8 : undefined,
  });
  if (!geo) {
    return (
      <div className="mt-3 flex h-[188px] items-center justify-center text-xs text-[var(--text-muted)]">
        Not enough history in this range yet.
      </div>
    );
  }
  const lastIndex = points.length - 1;
  const markers = geo.points.flatMap((p, i) =>
    i === lastIndex || (manual && !points[i].isEstimated) ? [{ ...p, i, end: i === lastIndex }] : []
  );
  const labels = [points[0], points[Math.floor(lastIndex / 2)], points[lastIndex]];
  return (
    <div className="mt-3">
      <div className="relative h-[170px]">
        <svg
          aria-label="Balance history"
          className="absolute inset-0 h-full w-full"
          preserveAspectRatio="none"
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <defs>
            <linearGradient id="investment-value-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              stroke="var(--grid-line)"
              vectorEffect="non-scaling-stroke"
              x1={0}
              x2={WIDTH}
              y1={HEIGHT * f}
              y2={HEIGHT * f}
            />
          ))}
          <path d={geo.area} fill="url(#investment-value-fill)" />
          <path
            d={geo.solid}
            data-testid="chart-solid"
            fill="none"
            stroke="var(--accent)"
            strokeLinejoin="round"
            strokeWidth={1.8}
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={geo.dashed}
            data-testid="chart-dashed"
            fill="none"
            opacity={0.6}
            stroke="var(--accent)"
            strokeDasharray="4 4"
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {markers.map((m) => (
          <span
            key={m.i}
            className={`absolute h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-[var(--accent)] ${
              m.end ? 'bg-[var(--bg-card)]' : 'bg-[var(--accent)]'
            }`}
            data-testid={m.end ? 'chart-end' : 'chart-entry'}
            style={{ left: `${(m.x / WIDTH) * 100}%`, top: m.y }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
        {labels.map((p, i) => (
          <span key={`${p.date}-${i}`}>{fmtDay(p.date)}</span>
        ))}
      </div>
    </div>
  );
}

const SPARK_COLORS = { up: 'var(--green)', down: 'var(--red)', muted: 'var(--text-muted)' };

/** Navigator sparkline: same solid/dashed rule, no axis. */
export function Sparkline({ points, tone }: { points: SeriesPoint[]; tone: keyof typeof SPARK_COLORS }) {
  const geo = chartGeometry(points, { width: 96, height: 24, pad: 3 });
  if (!geo) return <span className="block h-6 w-16" />;
  const color = SPARK_COLORS[tone];
  return (
    <svg aria-hidden className="block h-6 w-16" preserveAspectRatio="none" viewBox="0 0 96 24">
      <path
        d={geo.solid}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <path
        d={geo.dashed}
        fill="none"
        opacity={0.6}
        stroke={color}
        strokeDasharray="3 3"
        strokeWidth={1.4}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
```

Create `src/components/investments/pills.tsx`:

```tsx
'use client';

import type { ReactNode } from 'react';
import type { BalanceSource } from '@/lib/investments/overview';
import type { SeriesChange } from '@/lib/investments/portfolio-view';
import { changeText, toneOf, type Tone } from './format';

const PILL = 'inline-flex items-center whitespace-nowrap rounded-full border px-[7px] py-px text-[10.5px] font-medium';

const SOURCE_PILLS: Record<BalanceSource, { label: string; className: string }> = {
  provider: {
    label: 'Plaid',
    className:
      'text-[var(--tag-blue)] border-[color-mix(in_srgb,var(--tag-blue)_30%,transparent)]',
  },
  valuation: {
    label: 'Valued',
    className:
      'text-[var(--tag-teal)] border-[color-mix(in_srgb,var(--tag-teal)_30%,transparent)]',
  },
  manual: { label: 'Manual', className: 'text-[var(--text-secondary)] border-[var(--border-hover)]' },
};

export function SourcePill({ source }: { source: BalanceSource }) {
  const pill = SOURCE_PILLS[source];
  return <span className={`${PILL} ${pill.className}`}>{pill.label}</span>;
}

const CHIP_TONES: Record<Tone, string> = {
  up: 'text-[var(--green)] bg-[color-mix(in_srgb,var(--green)_12%,transparent)]',
  down: 'text-[var(--red)] bg-[color-mix(in_srgb,var(--red)_12%,transparent)]',
  flat: 'text-[var(--text-muted)] bg-[var(--track-bg)]',
};

export function ChangeChip({ change }: { change: SeriesChange }) {
  return (
    <span className={`rounded-[5px] px-1.5 py-px font-mono text-[11px] ${CHIP_TONES[toneOf(change.pct)]}`}>
      {changeText(change)}
    </span>
  );
}

export function StatusDot({ tone, title }: { tone: 'warn' | 'err'; title: string }) {
  return (
    <span
      aria-label={title}
      className={`ml-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full align-middle ${
        tone === 'err' ? 'bg-[var(--red)]' : 'bg-[var(--accent)]'
      }`}
      role="img"
      title={title}
    />
  );
}

export function FlagPill({ children }: { children: ReactNode }) {
  return (
    <span
      className={`${PILL} ml-1.5 border-[color-mix(in_srgb,var(--accent)_35%,transparent)] font-sans text-[var(--accent)]`}
    >
      {children}
    </span>
  );
}

const NOTICE_TONES = {
  warn: 'bg-[color-mix(in_srgb,var(--accent)_7%,transparent)] border-[color-mix(in_srgb,var(--accent)_22%,transparent)]',
  err: 'bg-[color-mix(in_srgb,var(--red)_7%,transparent)] border-[color-mix(in_srgb,var(--red)_25%,transparent)]',
};

export function Notice({
  tone,
  lead,
  text,
  action,
}: {
  tone: 'warn' | 'err';
  lead: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={`mt-4 flex items-start gap-2.5 rounded-[9px] border px-3 py-2.5 text-xs leading-[1.45] text-[var(--text-secondary)] ${NOTICE_TONES[tone]}`}
      role="status"
    >
      <div className="grow">
        <b className="font-medium text-[var(--text-primary)]">{lead}</b> {text}
      </div>
      {action}
    </div>
  );
}
```

Create `src/components/investments/holdings-map.tsx`:

```tsx
'use client';

import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtCompact, fmtMoney, fmtPct, signedTone } from './format';
import { squarify, tileBackground } from './treemap';

/** Layout units across; tiles are placed in % of the container width. */
const CANVAS = 1000;
/** The mock's canvas width, used only to decide which tile details fit. */
const DESIGN_WIDTH = 470;

export function HoldingsMap({ lines, height }: { lines: HoldingLine[]; height: number }) {
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const tiles = squarify(
    lines.map((l) => ({ key: l.key, value: l.valueBase })),
    CANVAS,
    height
  );
  return (
    <div className="relative mt-2.5" style={{ height }}>
      {tiles.map((t) => {
        const l = byKey.get(t.key)!;
        const px = (t.w / CANVAS) * DESIGN_WIDTH;
        const size = px < 64 || t.h < 42 ? 'tiny' : px < 120 || t.h < 64 ? 'small' : 'full';
        return (
          <div
            key={t.key}
            className="absolute flex flex-col justify-between overflow-hidden rounded-md border border-[var(--border)] px-[9px] py-2 transition hover:brightness-110"
            style={{
              left: `${(t.x / CANVAS) * 100}%`,
              width: `calc(${(t.w / CANVAS) * 100}% - 3px)`,
              top: t.y,
              height: t.h - 3,
              background: tileBackground(l.rangeChangePct),
            }}
            title={`${l.name} · ${fmtMoney(l.valueBase)} · ${l.weightPct.toFixed(1)}% of portfolio`}
          >
            {size !== 'tiny' && (
              <>
                <div className="min-w-0">
                  <div className="font-mono text-xs font-medium text-[var(--text-primary)]">
                    {l.label}
                  </div>
                  {size === 'full' && (
                    <div className="truncate text-[10.5px] text-[var(--text-secondary)]">
                      {l.weightPct.toFixed(1)}% · {l.name}
                    </div>
                  )}
                </div>
                <div className="flex justify-between font-mono text-[11px]">
                  {size === 'full' && (
                    <span className="text-[var(--text-secondary)]">{fmtCompact(l.valueBase)}</span>
                  )}
                  <span className={signedTone(l.rangeChangePct)}>
                    {l.rangeChangePct == null ? '—' : fmtPct(l.rangeChangePct)}
                  </span>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

Create `src/components/investments/allocation-bars.tsx`:

```tsx
'use client';

import type { AllocationSlice } from '@/lib/investments/holdings-view';

export function AllocationBars({ slices }: { slices: AllocationSlice[] }) {
  return (
    <div className="mt-2.5">
      {slices.map((s) => (
        <div
          key={s.label}
          className="grid grid-cols-[130px_1fr_52px] items-center gap-3 py-[5px] text-xs text-[var(--text-secondary)]"
        >
          <span className="truncate">{s.label}</span>
          <span className="h-[5px] rounded-[3px] bg-[var(--track-bg)]">
            <span
              className="block h-full rounded-[3px] bg-[var(--text-muted)] opacity-80"
              style={{ width: `${s.pct}%` }}
            />
          </span>
          <span className="text-right font-mono text-[11.5px] text-[var(--text-primary)]">
            {s.pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );
}
```

Create `src/components/investments/holdings-table.tsx`:

```tsx
'use client';

import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtMoney, fmtQty, fmtSignedMoney, signedTone } from './format';
import { FlagPill } from './pills';

const GRID = 'grid grid-cols-[1fr_96px_92px_70px] gap-3';

export function HoldingsTable({ lines, multiAccount }: { lines: HoldingLine[]; multiAccount: boolean }) {
  return (
    <div className="mt-2.5">
      <div
        className={`${GRID} pb-1.5 text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]`}
      >
        <span>Security</span>
        <span className="text-right">Value</span>
        <span className="text-right">Gain</span>
        <span className="text-right">Weight</span>
      </div>
      {lines.map((l, i) => (
        <div
          key={l.key}
          className={`${GRID} py-2 text-xs ${i ? 'border-t border-[var(--border)]' : ''}`}
        >
          <div className="min-w-0">
            <div className="flex items-center">
              <span className="font-mono font-medium text-[var(--text-primary)]">{l.label}</span>
              {multiAccount && l.accountCount > 1 && (
                <span className="ml-1.5 rounded-full border border-[var(--border-hover)] px-1.5 text-[10.5px] text-[var(--text-muted)]">
                  {l.accountCount} accounts
                </span>
              )}
              {l.unpriced && <FlagPill>No price source</FlagPill>}
            </div>
            <div className="truncate text-[11px] text-[var(--text-muted)]">
              {l.quantity != null ? `${fmtQty(l.quantity)} · ${l.name}` : l.name}
            </div>
          </div>
          <span className="text-right font-mono text-[var(--text-primary)]">
            {fmtMoney(l.valueBase)}
          </span>
          <span className={`text-right font-mono ${signedTone(l.gainBase)}`}>
            {l.gainBase == null ? '—' : fmtSignedMoney(l.gainBase)}
          </span>
          <span className="text-right font-mono text-[var(--text-secondary)]">
            {l.weightPct.toFixed(multiAccount ? 1 : 0)}%
          </span>
        </div>
      ))}
    </div>
  );
}
```

Create `src/components/investments/activity-list.tsx`:

```tsx
'use client';

import type { ActivityItem } from '@/lib/investments/activity';
import { fmtDay, fmtMoney } from './format';

export function ActivityList({
  items,
  sourceOf,
  emptyText,
}: {
  items: ActivityItem[];
  sourceOf?: (accountId: string) => string | null;
  emptyText: string;
}) {
  if (!items.length) {
    return <p className="mt-1.5 text-xs text-[var(--text-muted)]">{emptyText}</p>;
  }
  return (
    <div className="mt-1.5">
      {items.map((item, i) => {
        const sub = [sourceOf?.(item.accountId), item.detail].filter(Boolean).join(' · ');
        return (
          <div
            key={item.id}
            className={`grid grid-cols-[44px_1fr_auto] items-baseline gap-2.5 py-[7px] text-xs ${
              i ? 'border-t border-[var(--border)]' : ''
            }`}
          >
            <span className="font-mono text-[10.5px] text-[var(--text-muted)]">
              {fmtDay(item.date)}
            </span>
            <div className="min-w-0">
              <div className="text-[var(--text-primary)]">{item.title}</div>
              {sub && <small className="block text-[11px] text-[var(--text-muted)]">{sub}</small>}
            </div>
            <span
              className={`font-mono ${
                item.amount < 0 ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'
              }`}
            >
              {fmtMoney(item.amount, { cents: true })}
            </span>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/components/investments/value-chart.tsx src/components/investments/pills.tsx src/components/investments/holdings-map.tsx src/components/investments/allocation-bars.tsx src/components/investments/holdings-table.tsx src/components/investments/activity-list.tsx tests/unit/components/investments/display.test.tsx
git commit -m "feat(investments): chart, holdings map, allocation, holdings and activity components"
```

### Task 12: Navigator and detail panel

**Files:**
- Create: `src/components/investments/account-states.ts`
- Create: `src/components/investments/account-navigator.tsx`
- Create: `src/components/investments/account-detail.tsx`
- Create: `tests/helpers/investment-overview.ts`
- Test: `tests/unit/components/investments/account-states.test.ts`, `tests/unit/components/investments/navigator-detail.test.tsx`

**Interfaces:**
- Consumes:
  - Tasks 5, 6, 8 (`ACTIVITY_SHOWN`), 9, 10 and 11.
  - `PlaidReconnectButton({ enrollmentId, onSuccess, buttonText?, className? })` from `src/components/plaid/PlaidReconnectButton.tsx`.
  - `TrendingUp` from `lucide-react`.
- Produces:
  - `account-states.ts`:
    - `type NoticeKind = 'reauth' | 'waiting' | 'stale' | 'unpriced'` and `type NoticeView = { kind; tone: 'warn' | 'err'; lead: string; text: string }`.
    - `accountNotices(a: AccountSummary): NoticeView[]`, in rule order.
    - `accountDots(a): { tone: 'warn' | 'err'; title: string }[]`.
    - `freshnessText(a, todayIso): string`.
    - `navMeta(a): string`.
    - `sparkTone(a): 'up' | 'down' | 'muted'`.
    - `plural(n, word): string`.
    - `activityEmptyText(a: AccountSummary | null): string`.
  - `AccountNavigator({ overview: InvestmentOverview; selected: string | null; onSelect: (id: string | null) => void })`. `null` selects All accounts.
  - `AccountDetail({ overview; selected: string | null; onRecordBalance: (a: AccountSummary) => void; onEditHoldings: (a: AccountSummary) => void; onSetSymbol: (s: { securityId: string; label: string }) => void; onRetryPrices: () => void; onReconnected: () => void })`.
  - Test fixtures `tests/helpers/investment-overview.ts`: `series(values, estimatedIdx?, start?)`, `makeAccount(over?)`, `makeHolding(over?)`, `makeOverview(over?)`.

**Copy (verbatim):**
- **Notices:**
  - reauth: lead `{Institution} needs to be reconnected.`, text `Authorization expired on {Mon D}, so balances and holdings stopped updating. Nothing is lost — reconnecting resumes from where it left off.`, action **Reconnect**.
  - waiting: lead `Waiting on {Institution}.`, text `{Institution} hasn’t finished preparing holdings and activity for this connection. Showing data from {Mon D}; the balance is current.` If there is no date, the last sentence is just `The balance is current.`
  - stale (valued only): lead `Prices are from {Mon D}.`, text `The price source didn’t respond, so this balance uses the last stored prices.`, action **Retry**.
  - unpriced: lead `{TICK} has no price source.`, text `It’s valued at its last known price. Check the symbol or set a price manually.`, action **Set symbol**. With several, the lead is `{A, B} have no price source.` and the text is `They’re valued at their last known prices. Check the symbols or set prices manually.`
- **Dots:**
  - `{Institution} needs reconnection` (err)
  - `Waiting on {Institution}` (warn)
  - `A holding has no price source` (warn)
- **Freshness:**
  - Plaid: `Synced {Oct 9, 9:24 AM}`. When it needs reconnecting: `Last synced {Mon D}`. Never synced: `Not synced yet`.
  - Valued: `Prices as of {Mon D} close`, or `Not priced yet`.
  - Manual: `Last entry {Mon D} · {N days ago | 1 day ago | today}`, or `No entries yet`.
- **Navigator meta:**
  - `{Institution} · {Wrapper}`, plus ` · as of {Mon D}` for manual accounts.
  - The All row reads `{n} account(s) · {m} institution(s)`.
- **Headline:**
  - Non-manual: change chip, then `balance change · {range}`.
  - Manual: `Manual balance`.
  - Non-base accounts: the native balance (`CA$…`) as well.
- **Legend:**
  - Non-manual: `Synced` (solid) and `Estimated between syncs` (dashed).
  - Manual: `Entered` (dot) and `Carried forward` (dashed).
- **Manual entries strip:** `Entries:` then `{Mon D} {$X}` for each entry, then `· carried forward between entries`.
- **Section titles (title — hint):**
  - `Holdings map` — `size = value · color = {range} change`
  - `Allocation` — the Type / Account / Currency segmented control for All; Type only for one account
  - `Holdings` — All: `combined across accounts`; one account: `{n} position(s)`
  - `Activity` — All: `all accounts`; one account: `recent`
- **Empty states:**
  - No holdings: `No holdings reported.`
  - No activity: `{Institution} doesn’t report trades for this account — changes show as balance movement.` for a Plaid account with no trades ever; otherwise `No activity reported.`
- **Layout rules:**
  - The holdings map and allocation row shows only when the selection (All accounts or one account) has more than one holding line.
  - Activity shows the top `ACTIVITY_SHOWN.all` (8) lines for All and the top `ACTIVITY_SHOWN.account` (5) for one account (constants from Task 8).
  - The holdings map is 250 px tall for All and 200 px for one account.

- [ ] **Step 1: Add the fixtures**

Create `tests/helpers/investment-overview.ts`:

```ts
import { addDays, isoDay, utcDay } from '@/lib/investments/dates';
import type { HoldingRow } from '@/lib/investments/holdings-view';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';

/** Daily points from `start`; indexes in `estimated` are estimates. */
export const series = (values: number[], estimated: number[] = [], start = '2026-10-01') =>
  values.map((value, i) => ({
    date: isoDay(addDays(utcDay(start), i)),
    value,
    isEstimated: estimated.includes(i),
  }));

export function makeAccount(over: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'acc-plaid',
    name: 'Brokerage',
    institution: 'Test Bank',
    group: 'Taxable',
    wrapper: 'Taxable',
    currency: 'USD',
    balanceSource: 'provider',
    value: 1100,
    valueBase: 1100,
    asOf: '2026-10-09',
    lastSyncAt: '2026-10-09T13:24:00.000Z',
    enrollmentId: 'enr-1',
    series: series([1000, 1050, 1100]),
    change: { start: 1000, end: 1100, delta: 100, pct: 10 },
    prices: null,
    status: { needsReauth: null, waiting: null, unpriced: [], tradesReported: true },
    ...over,
  };
}

export function makeHolding(over: Partial<HoldingRow> = {}): HoldingRow {
  return {
    accountId: 'acc-plaid',
    securityId: 'sec-aaa',
    kind: 'security',
    label: 'AAA',
    name: 'Triple A Fund',
    type: 'etf',
    pricing: 'feed',
    currency: 'USD',
    quantity: 10,
    price: 110,
    priceInAccount: 110,
    value: 1100,
    valueBase: 1100,
    gainBase: 100,
    rangeChangePct: 10,
    ...over,
  };
}

export function makeOverview(over: Partial<InvestmentOverview> = {}): InvestmentOverview {
  const accounts = over.accounts ?? [makeAccount()];
  return {
    range: '3M',
    today: '2026-10-09',
    baseCurrency: 'USD',
    prices: { asOf: '2026-10-09', stale: false },
    portfolio: {
      value: accounts.reduce((sum, a) => sum + a.valueBase, 0),
      series: series([1000, 1050, 1100]),
      change: { start: 1000, end: 1100, delta: 100, pct: 10 },
    },
    accounts,
    holdings: [makeHolding()],
    activity: [],
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/components/investments/account-states.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  accountDots,
  accountNotices,
  activityEmptyText,
  freshnessText,
  navMeta,
  plural,
  sparkTone,
} from '@/components/investments/account-states';
import { makeAccount } from '../../../helpers/investment-overview';

describe('account states', () => {
  it('lists notices in priority order with their copy', () => {
    const a = makeAccount({
      balanceSource: 'valuation',
      prices: { asOf: '2026-10-06', stale: true },
      status: {
        needsReauth: { since: '2026-10-01' },
        waiting: { showingFrom: '2026-10-02' },
        unpriced: [{ securityId: 's', label: 'ZZZ' }],
        tradesReported: true,
      },
    });
    expect(accountNotices(a)).toEqual([
      {
        kind: 'reauth',
        tone: 'err',
        lead: 'Test Bank needs to be reconnected.',
        text: 'Authorization expired on Oct 1, so balances and holdings stopped updating. Nothing is lost — reconnecting resumes from where it left off.',
      },
      {
        kind: 'waiting',
        tone: 'warn',
        lead: 'Waiting on Test Bank.',
        text: 'Test Bank hasn’t finished preparing holdings and activity for this connection. Showing data from Oct 2; the balance is current.',
      },
      {
        kind: 'stale',
        tone: 'warn',
        lead: 'Prices are from Oct 6.',
        text: 'The price source didn’t respond, so this balance uses the last stored prices.',
      },
      {
        kind: 'unpriced',
        tone: 'warn',
        lead: 'ZZZ has no price source.',
        text: 'It’s valued at its last known price. Check the symbol or set a price manually.',
      },
    ]);
    expect(accountDots(a)).toEqual([
      { tone: 'err', title: 'Test Bank needs reconnection' },
      { tone: 'warn', title: 'Waiting on Test Bank' },
      { tone: 'warn', title: 'A holding has no price source' },
    ]);
  });

  it('pluralizes several unpriced holdings and has no notices when healthy', () => {
    const many = makeAccount({
      status: {
        needsReauth: null,
        waiting: null,
        unpriced: [
          { securityId: 'a', label: 'AAA' },
          { securityId: 'b', label: 'BBB' },
        ],
        tradesReported: true,
      },
    });
    expect(accountNotices(many)[0].lead).toBe('AAA, BBB have no price source.');
    expect(accountNotices(makeAccount())).toEqual([]);
  });

  it('describes freshness per source', () => {
    expect(freshnessText(makeAccount(), '2026-10-09')).toMatch(/^Synced Oct \d{1,2}, /);
    expect(
      freshnessText(makeAccount({ status: { ...makeAccount().status, needsReauth: { since: '2026-10-01' } } }), '2026-10-09')
    ).toBe('Last synced Oct 9');
    expect(
      freshnessText(makeAccount({ balanceSource: 'valuation', prices: { asOf: '2026-10-08', stale: false } }), '2026-10-09')
    ).toBe('Prices as of Oct 8 close');
    expect(freshnessText(makeAccount({ balanceSource: 'manual', asOf: '2026-07-12' }), '2026-10-09')).toBe(
      'Last entry Jul 12 · 89 days ago'
    );
    expect(freshnessText(makeAccount({ balanceSource: 'manual', asOf: '2026-10-09' }), '2026-10-09')).toBe(
      'Last entry Oct 9 · today'
    );
  });

  it('builds navigator meta, sparkline tone and plurals', () => {
    expect(navMeta(makeAccount())).toBe('Test Bank · Taxable');
    expect(navMeta(makeAccount({ balanceSource: 'manual', asOf: '2026-07-12' }))).toBe(
      'Test Bank · Taxable · as of Jul 12'
    );
    expect(sparkTone(makeAccount())).toBe('up');
    expect(sparkTone(makeAccount({ change: { start: 2, end: 1, delta: -1, pct: -50 } }))).toBe('down');
    expect(sparkTone(makeAccount({ balanceSource: 'manual', change: null }))).toBe('muted');
    expect(plural(1, 'account')).toBe('1 account');
    expect(plural(3, 'institution')).toBe('3 institutions');
  });

  it('says when an institution does not report trades', () => {
    expect(
      activityEmptyText(makeAccount({ status: { ...makeAccount().status, tradesReported: false } }))
    ).toBe('Test Bank doesn’t report trades for this account — changes show as balance movement.');
    expect(activityEmptyText(null)).toBe('No activity reported.');
  });
});
```

Create `tests/unit/components/investments/navigator-detail.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The Plaid Link SDK cannot run in jsdom; the button is replaced by a plain one.
vi.mock('@/components/plaid/PlaidReconnectButton', () => ({
  PlaidReconnectButton: ({ buttonText }: { buttonText?: string }) => (
    <button type="button">{buttonText}</button>
  ),
}));

import { AccountNavigator } from '@/components/investments/account-navigator';
import { AccountDetail } from '@/components/investments/account-detail';
import {
  makeAccount,
  makeHolding,
  makeOverview,
  series,
} from '../../../helpers/investment-overview';

const handlers = () => ({
  onRecordBalance: vi.fn(),
  onEditHoldings: vi.fn(),
  onSetSymbol: vi.fn(),
  onRetryPrices: vi.fn(),
  onReconnected: vi.fn(),
});

const retirement = makeAccount({
  id: 'acc-ret',
  name: 'Workplace Plan',
  group: 'Retirement',
  wrapper: '401(k)',
  valueBase: 5000,
  value: 5000,
});
const manual = makeAccount({
  id: 'acc-man',
  name: 'Pension',
  institution: 'Test Life',
  group: 'Retirement',
  wrapper: 'Retirement',
  balanceSource: 'manual',
  asOf: '2026-10-01',
  value: 900,
  valueBase: 900,
  change: null,
  series: series([800, 800, 900], [1]),
  enrollmentId: null,
  lastSyncAt: null,
});

describe('AccountNavigator', () => {
  it('groups accounts in order with totals and selects', async () => {
    const onSelect = vi.fn();
    render(
      <AccountNavigator
        overview={makeOverview({ accounts: [makeAccount(), retirement, manual] })}
        selected={null}
        onSelect={onSelect}
      />
    );
    const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(groups).toEqual(['Retirement', 'Taxable']);
    const ret = within(screen.getByRole('region', { name: 'Retirement' }));
    expect(ret.getByText('$5,900')).toBeInTheDocument();
    expect(ret.getByText('Test Life · Retirement · as of Oct 1')).toBeInTheDocument();
    expect(screen.getByText('3 accounts · 2 institutions')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Pension'));
    expect(onSelect).toHaveBeenCalledWith('acc-man');
  });

  it('shows status dots', () => {
    const waiting = makeAccount({
      status: { needsReauth: null, waiting: { showingFrom: null }, unpriced: [], tradesReported: true },
    });
    render(
      <AccountNavigator overview={makeOverview({ accounts: [waiting] })} selected={null} onSelect={vi.fn()} />
    );
    expect(screen.getByLabelText('Waiting on Test Bank')).toBeInTheDocument();
  });
});

describe('AccountDetail', () => {
  it('shows all accounts combined', () => {
    const overview = makeOverview({
      accounts: [makeAccount(), retirement],
      holdings: [
        makeHolding(),
        makeHolding({ accountId: 'acc-ret', valueBase: 500 }),
        makeHolding({ accountId: 'acc-ret', securityId: 'sec-bbb', label: 'BBB', name: 'B Fund', valueBase: 400 }),
      ],
      activity: [
        { id: 't1', accountId: 'acc-ret', date: '2026-10-05', title: 'Buy · AAA', detail: null, amount: -5 },
      ],
    });
    render(<AccountDetail {...handlers()} overview={overview} selected={null} />);
    expect(screen.getByRole('heading', { name: 'All accounts' })).toBeInTheDocument();
    expect(screen.getByText('$6,100')).toBeInTheDocument();
    expect(screen.getByText('combined across accounts')).toBeInTheDocument();
    expect(screen.getByText('2 accounts')).toBeInTheDocument();
    expect(screen.getByText('size = value · color = 3M change')).toBeInTheDocument();
    expect(screen.getByText('Workplace Plan · Test Bank')).toBeInTheDocument();
    expect(screen.getByText('balance change · 3M')).toBeInTheDocument();
  });

  it('renders a manual account’s entries, legend and freshness', async () => {
    const h = handlers();
    render(
      <AccountDetail
        {...h}
        overview={makeOverview({ accounts: [manual], holdings: [] })}
        selected="acc-man"
      />
    );
    expect(screen.getByText('Manual balance')).toBeInTheDocument();
    expect(screen.getByText('Entered')).toBeInTheDocument();
    expect(screen.getByText('Carried forward')).toBeInTheDocument();
    expect(screen.getByText('Last entry Oct 1 · 8 days ago')).toBeInTheDocument();
    expect(screen.getByText('Entries:')).toBeInTheDocument();
    expect(screen.queryByText(/balance change/)).toBeNull();
    expect(screen.getByText('No holdings reported.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record balance' }));
    expect(h.onRecordBalance).toHaveBeenCalledWith(manual);
  });

  it('shows the native balance for a non-base account', () => {
    const cad = makeAccount({ id: 'acc-cad', currency: 'CAD', value: 2000, valueBase: 1000 });
    render(<AccountDetail {...handlers()} overview={makeOverview({ accounts: [cad] })} selected="acc-cad" />);
    expect(screen.getByText('CA$2,000')).toBeInTheDocument();
  });

  it('offers Reconnect, Retry and Set symbol from notices', async () => {
    const h = handlers();
    const broken = makeAccount({
      status: { needsReauth: { since: '2026-10-01' }, waiting: null, unpriced: [], tradesReported: true },
    });
    const { unmount } = render(
      <AccountDetail {...h} overview={makeOverview({ accounts: [broken] })} selected="acc-plaid" />
    );
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    unmount();

    const valued = makeAccount({
      id: 'acc-val',
      balanceSource: 'valuation',
      prices: { asOf: '2026-10-06', stale: true },
      status: {
        needsReauth: null,
        waiting: null,
        unpriced: [{ securityId: 'sec-z', label: 'ZZZ' }],
        tradesReported: true,
      },
    });
    render(<AccountDetail {...h} overview={makeOverview({ accounts: [valued] })} selected="acc-val" />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.onRetryPrices).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Set symbol' }));
    expect(h.onSetSymbol).toHaveBeenCalledWith({ securityId: 'sec-z', label: 'ZZZ' });
    await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
    expect(h.onEditHoldings).toHaveBeenCalledWith(valued);
  });

  it('shows the empty activity copy', () => {
    const quiet = makeAccount({
      status: { needsReauth: null, waiting: null, unpriced: [], tradesReported: false },
    });
    render(<AccountDetail {...handlers()} overview={makeOverview({ accounts: [quiet] })} selected="acc-plaid" />);
    expect(
      screen.getByText('Test Bank doesn’t report trades for this account — changes show as balance movement.')
    ).toBeInTheDocument();
    // A single position hides the holdings map and allocation (spec §8).
    expect(screen.queryByText('Holdings map')).toBeNull();
    expect(screen.queryByText('Allocation')).toBeNull();
  });

  it('renders an empty overview', () => {
    render(
      <AccountDetail
        {...handlers()}
        overview={makeOverview({
          accounts: [],
          holdings: [],
          portfolio: { value: 0, series: [], change: null },
        })}
        selected={null}
      />
    );
    expect(screen.getByText('Not enough history in this range yet.')).toBeInTheDocument();
    expect(screen.getByText('No holdings reported.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/account-states.test.ts tests/unit/components/investments/navigator-detail.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the state helpers**

Create `src/components/investments/account-states.ts`:

```ts
import type { AccountSummary, BalanceSource } from '@/lib/investments/overview';
import { daysBetween, fmtDay, fmtSyncTime } from './format';

export type NoticeKind = 'reauth' | 'waiting' | 'stale' | 'unpriced';
export type NoticeView = { kind: NoticeKind; tone: 'warn' | 'err'; lead: string; text: string };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const NOTICE_RULES: {
  kind: NoticeKind;
  applies: (a: AccountSummary) => boolean;
  view: (a: AccountSummary) => Omit<NoticeView, 'kind'>;
}[] = [
  {
    kind: 'reauth',
    applies: (a) => a.status.needsReauth != null,
    view: (a) => ({
      tone: 'err',
      lead: `${a.institution} needs to be reconnected.`,
      text: `Authorization expired on ${fmtDay(a.status.needsReauth!.since)}, so balances and holdings stopped updating. Nothing is lost — reconnecting resumes from where it left off.`,
    }),
  },
  {
    kind: 'waiting',
    applies: (a) => a.status.waiting != null,
    view: (a) => {
      const from = a.status.waiting!.showingFrom;
      return {
        tone: 'warn',
        lead: `Waiting on ${a.institution}.`,
        text: `${a.institution} hasn’t finished preparing holdings and activity for this connection. ${
          from ? `Showing data from ${fmtDay(from)}; the balance is current.` : 'The balance is current.'
        }`,
      };
    },
  },
  {
    kind: 'stale',
    applies: (a) => a.balanceSource === 'valuation' && a.prices?.stale === true,
    view: (a) => ({
      tone: 'warn',
      lead: a.prices?.asOf ? `Prices are from ${fmtDay(a.prices.asOf)}.` : 'Prices are out of date.',
      text: 'The price source didn’t respond, so this balance uses the last stored prices.',
    }),
  },
  {
    kind: 'unpriced',
    applies: (a) => a.status.unpriced.length > 0,
    view: (a) => {
      const many = a.status.unpriced.length > 1;
      return {
        tone: 'warn',
        lead: `${a.status.unpriced.map((u) => u.label).join(', ')} ${many ? 'have' : 'has'} no price source.`,
        text: many
          ? 'They’re valued at their last known prices. Check the symbols or set prices manually.'
          : 'It’s valued at its last known price. Check the symbol or set a price manually.',
      };
    },
  },
];

export const accountNotices = (a: AccountSummary): NoticeView[] =>
  NOTICE_RULES.filter((r) => r.applies(a)).map((r) => ({ kind: r.kind, ...r.view(a) }));

export function accountDots(a: AccountSummary): { tone: 'warn' | 'err'; title: string }[] {
  const dots: { tone: 'warn' | 'err'; title: string }[] = [];
  if (a.status.needsReauth) dots.push({ tone: 'err', title: `${a.institution} needs reconnection` });
  if (a.status.waiting) dots.push({ tone: 'warn', title: `Waiting on ${a.institution}` });
  if (a.status.unpriced.length) dots.push({ tone: 'warn', title: 'A holding has no price source' });
  return dots;
}

const ago = (days: number) => (days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`);

const FRESHNESS: Record<BalanceSource, (a: AccountSummary, today: string) => string> = {
  provider: (a) => {
    if (!a.lastSyncAt) return 'Not synced yet';
    return a.status.needsReauth
      ? `Last synced ${fmtDay(a.lastSyncAt)}`
      : `Synced ${fmtSyncTime(a.lastSyncAt)}`;
  },
  valuation: (a) => (a.prices?.asOf ? `Prices as of ${fmtDay(a.prices.asOf)} close` : 'Not priced yet'),
  manual: (a, today) =>
    a.asOf ? `Last entry ${fmtDay(a.asOf)} · ${ago(daysBetween(a.asOf, today))}` : 'No entries yet',
};

export const freshnessText = (a: AccountSummary, today: string) => FRESHNESS[a.balanceSource](a, today);

export const navMeta = (a: AccountSummary) =>
  `${a.institution} · ${a.wrapper}${
    a.balanceSource === 'manual' && a.asOf ? ` · as of ${fmtDay(a.asOf)}` : ''
  }`;

export function sparkTone(a: AccountSummary): 'up' | 'down' | 'muted' {
  if (a.balanceSource === 'manual' || !a.change) return 'muted';
  return a.change.delta >= 0 ? 'up' : 'down';
}

export const activityEmptyText = (a: AccountSummary | null) =>
  a && !a.status.tradesReported
    ? `${a.institution} doesn’t report trades for this account — changes show as balance movement.`
    : 'No activity reported.';
```

- [ ] **Step 5: Implement the navigator**

Create `src/components/investments/account-navigator.tsx`:

```tsx
'use client';

import { TrendingUp } from 'lucide-react';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';
import { GROUP_ORDER } from '@/lib/investments/portfolio-view';
import { accountDots, navMeta, plural, sparkTone } from './account-states';
import { fmtMoney } from './format';
import { institutionMark } from './institution-mark';
import { StatusDot } from './pills';
import { Sparkline } from './value-chart';

const rowClass = (on: boolean) =>
  `-mx-2.5 w-[calc(100%+20px)] items-center gap-3 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)] ${
    on ? 'bg-[var(--bg-elevated)] shadow-[inset_2px_0_0_var(--accent)]' : ''
  }`;

export function AccountNavigator({
  overview,
  selected,
  onSelect,
}: {
  overview: InvestmentOverview;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { accounts } = overview;
  const institutions = new Set(accounts.map((a) => a.institution)).size;
  return (
    <nav aria-label="Investment accounts">
      <button
        aria-current={selected === null ? 'true' : undefined}
        className={`${rowClass(selected === null)} mb-1 grid grid-cols-[28px_1fr_84px] py-2.5`}
        type="button"
        onClick={() => onSelect(null)}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--border-hover)] text-[var(--accent)]">
          <TrendingUp size={14} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-[var(--text-primary)]">
            All accounts
          </span>
          <span className="block text-[11px] text-[var(--text-muted)]">
            {plural(accounts.length, 'account')} · {plural(institutions, 'institution')}
          </span>
        </span>
        <span className="text-right font-mono text-[13px] font-medium text-[var(--text-primary)]">
          {fmtMoney(overview.portfolio.value)}
        </span>
      </button>
      {GROUP_ORDER.map((group) => {
        const members = accounts
          .filter((a) => a.group === group)
          .sort((x, y) => y.valueBase - x.valueBase);
        if (!members.length) return null;
        const total = members.reduce((sum, a) => sum + a.valueBase, 0);
        return (
          <section key={group} aria-label={group}>
            <div className="flex justify-between pb-1.5 pt-3.5 text-[10.5px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]">
              <span>{group}</span>
              <span className="font-mono">{fmtMoney(total)}</span>
            </div>
            {members.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                selected={selected === a.id}
                onSelect={() => onSelect(a.id)}
              />
            ))}
          </section>
        );
      })}
    </nav>
  );
}

function AccountRow({
  account: a,
  selected,
  onSelect,
}: {
  account: AccountSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const mark = institutionMark(a.institution);
  return (
    <button
      aria-current={selected ? 'true' : undefined}
      className={`${rowClass(selected)} grid grid-cols-[28px_1fr_64px_84px] py-[9px]`}
      type="button"
      onClick={onSelect}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[11px] font-semibold text-[var(--bg-base)]"
        style={{ background: mark.color }}
      >
        {mark.initials}
      </span>
      <span className="min-w-0">
        <span className="flex items-center">
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {a.name}
          </span>
          {accountDots(a).map((d) => (
            <StatusDot key={d.title} title={d.title} tone={d.tone} />
          ))}
        </span>
        <span className="block truncate text-[11px] text-[var(--text-muted)]">{navMeta(a)}</span>
      </span>
      {a.valueBase === 0 ? <span /> : <Sparkline points={a.series} tone={sparkTone(a)} />}
      <span className="text-right font-mono text-[13px] font-medium text-[var(--text-primary)]">
        {fmtMoney(a.valueBase)}
      </span>
    </button>
  );
}
```

- [ ] **Step 6: Implement the detail panel**

Create `src/components/investments/account-detail.tsx`:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import { PlaidReconnectButton } from '@/components/plaid/PlaidReconnectButton';
import { ACTIVITY_SHOWN } from '@/lib/investments/activity';
import { allocation, holdingLines, type AllocationDimension } from '@/lib/investments/holdings-view';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';
import { GROUP_ORDER } from '@/lib/investments/portfolio-view';
import {
  accountNotices,
  activityEmptyText,
  freshnessText,
  plural,
  type NoticeKind,
} from './account-states';
import { ActivityList } from './activity-list';
import { AllocationBars } from './allocation-bars';
import { fmtDay, fmtMoney } from './format';
import { HoldingsMap } from './holdings-map';
import { HoldingsTable } from './holdings-table';
import { ChangeChip, Notice, SourcePill } from './pills';
import { ValueChart } from './value-chart';

const BUTTON =
  'rounded-lg border border-[var(--border-hover)] bg-[var(--bg-elevated)] px-[11px] py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]';
const ACCENT_BUTTON =
  'rounded-lg border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] px-[11px] py-1.5 text-xs font-medium text-[var(--accent)]';
const LINK = 'font-medium text-[var(--accent)] hover:underline';

const DIMENSIONS: { id: AllocationDimension; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'account', label: 'Account' },
  { id: 'currency', label: 'Currency' },
];

type DetailProps = {
  overview: InvestmentOverview;
  selected: string | null;
  onRecordBalance: (account: AccountSummary) => void;
  onEditHoldings: (account: AccountSummary) => void;
  onSetSymbol: (security: { securityId: string; label: string }) => void;
  onRetryPrices: () => void;
  onReconnected: () => void;
};

const NOTICE_ACTIONS: Record<NoticeKind, (a: AccountSummary, p: DetailProps) => ReactNode> = {
  reauth: (a, p) =>
    a.enrollmentId ? (
      <PlaidReconnectButton
        buttonText="Reconnect"
        className={ACCENT_BUTTON}
        enrollmentId={a.enrollmentId}
        onSuccess={p.onReconnected}
      />
    ) : null,
  waiting: () => null,
  stale: (_a, p) => (
    <button className={LINK} type="button" onClick={p.onRetryPrices}>
      Retry
    </button>
  ),
  unpriced: (a, p) => (
    <button className={BUTTON} type="button" onClick={() => p.onSetSymbol(a.status.unpriced[0])}>
      Set symbol
    </button>
  ),
};

function SectionTitle({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
      <span>{title}</span>
      {hint && (
        <span className="text-[10.5px] font-medium uppercase tracking-[0.6px] text-[var(--text-muted)]">
          {hint}
        </span>
      )}
    </div>
  );
}

function ChartLegend({ manual }: { manual: boolean }) {
  const solid = <span className="inline-block h-0 w-4 border-t-[1.5px] border-[var(--accent)]" />;
  const dashed = (
    <span className="inline-block h-0 w-4 border-t-[1.5px] border-dashed border-[var(--accent)] opacity-70" />
  );
  return (
    <div className="flex gap-3.5 text-[10.5px] text-[var(--text-muted)]">
      <span className="flex items-center gap-1.5">
        {manual ? <span className="h-[7px] w-[7px] rounded-full bg-[var(--accent)]" /> : solid}
        {manual ? 'Entered' : 'Synced'}
      </span>
      <span className="flex items-center gap-1.5">
        {dashed}
        {manual ? 'Carried forward' : 'Estimated between syncs'}
      </span>
    </div>
  );
}

export function AccountDetail(props: DetailProps) {
  const { overview, selected } = props;
  const [dimension, setDimension] = useState<AllocationDimension>('type');
  const account = overview.accounts.find((a) => a.id === selected) ?? null;
  const rows = account
    ? overview.holdings.filter((h) => h.accountId === account.id)
    : overview.holdings;
  const lines = holdingLines(rows);
  const series = account ? account.series : overview.portfolio.series;
  const change = account ? account.change : overview.portfolio.change;
  const manual = account?.balanceSource === 'manual';
  const value = account ? account.valueBase : overview.portfolio.value;
  const facts = overview.accounts.map((a) => ({ id: a.id, wrapper: a.wrapper, currency: a.currency }));
  const slices = allocation(rows, facts, account ? 'type' : dimension);
  const activity = (
    account ? overview.activity.filter((i) => i.accountId === account.id) : overview.activity
  ).slice(0, account ? ACTIVITY_SHOWN.account : ACTIVITY_SHOWN.all);
  const byId = new Map(overview.accounts.map((a) => [a.id, a]));
  const entries = manual ? series.filter((p) => !p.isEstimated) : [];
  const showMap = lines.length > 1;

  return (
    <section aria-label="Account detail">
      <div className="flex justify-between gap-4">
        <div>
          <h2 className="mb-0.5 text-base font-semibold text-[var(--text-primary)]">
            {account ? account.name : 'All accounts'}
          </h2>
          <div className="flex min-h-5 flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
            {account ? (
              <>
                <span>
                  {account.institution} · {account.wrapper}
                </span>
                <SourcePill source={account.balanceSource} />
                <span>{freshnessText(account, overview.today)}</span>
              </>
            ) : (
              <span>{GROUP_ORDER.join(' · ')}</span>
            )}
          </div>
        </div>
        {account?.balanceSource === 'manual' && (
          <button
            className={ACCENT_BUTTON}
            type="button"
            onClick={() => props.onRecordBalance(account)}
          >
            Record balance
          </button>
        )}
        {account?.balanceSource === 'valuation' && (
          <button className={BUTTON} type="button" onClick={() => props.onEditHoldings(account)}>
            Edit holdings
          </button>
        )}
      </div>

      {account &&
        accountNotices(account).map((n) => (
          <Notice
            key={n.kind}
            action={NOTICE_ACTIONS[n.kind](account, props)}
            lead={n.lead}
            text={n.text}
            tone={n.tone}
          />
        ))}

      <div className="mt-[18px] flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[32px] font-medium tracking-[-0.8px] text-[var(--text-primary)]">
            {fmtMoney(value)}
          </div>
          <div className="mt-1.5 flex items-center gap-2.5 text-xs text-[var(--text-muted)]">
            {manual ? (
              <span>Manual balance</span>
            ) : (
              change && (
                <>
                  <ChangeChip change={change} />
                  <span>balance change · {overview.range}</span>
                </>
              )
            )}
            {account && account.currency !== overview.baseCurrency && (
              <span className="font-mono">{fmtMoney(account.value, { currency: account.currency })}</span>
            )}
          </div>
        </div>
        <ChartLegend manual={manual} />
      </div>

      <ValueChart manual={manual} points={series} />

      {entries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-[18px] text-[11px] text-[var(--text-muted)]">
          <span>Entries:</span>
          {entries.map((e) => (
            <span key={e.date}>
              {fmtDay(e.date)}{' '}
              <span className="font-mono text-[var(--text-secondary)]">{fmtMoney(e.value)}</span>
            </span>
          ))}
          <span>· carried forward between entries</span>
        </div>
      )}

      {showMap && (
        <div className="mt-7 grid grid-cols-1 gap-7 xl:grid-cols-[1.55fr_1fr]">
          <div>
            <SectionTitle hint={`size = value · color = ${overview.range} change`} title="Holdings map" />
            <HoldingsMap height={account ? 200 : 250} lines={lines} />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
              <span>Allocation</span>
              <span className="inline-flex gap-0.5 rounded-[7px] border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
                {(account ? DIMENSIONS.slice(0, 1) : DIMENSIONS).map((d) => {
                  const on = (account ? 'type' : dimension) === d.id;
                  return (
                    <button
                      key={d.id}
                      aria-pressed={on}
                      className={`rounded-[5px] px-2 py-0.5 text-[10.5px] font-medium ${
                        on
                          ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                          : 'text-[var(--text-muted)]'
                      }`}
                      type="button"
                      onClick={() => setDimension(d.id)}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </span>
            </div>
            <AllocationBars slices={slices} />
          </div>
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 gap-7 xl:grid-cols-[1.55fr_1fr]">
        <div>
          <SectionTitle
            hint={account ? plural(lines.length, 'position') : 'combined across accounts'}
            title="Holdings"
          />
          {lines.length ? (
            <HoldingsTable lines={lines} multiAccount={!account} />
          ) : (
            <p className="mt-2.5 text-xs text-[var(--text-muted)]">No holdings reported.</p>
          )}
        </div>
        <div>
          <SectionTitle hint={account ? 'recent' : 'all accounts'} title="Activity" />
          <ActivityList
            emptyText={activityEmptyText(account)}
            items={activity}
            sourceOf={
              account
                ? undefined
                : (id) => {
                    const a = byId.get(id);
                    return a ? `${a.name} · ${a.institution}` : null;
                  }
            }
          />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add src/components/investments/account-states.ts src/components/investments/account-navigator.tsx src/components/investments/account-detail.tsx tests/helpers/investment-overview.ts tests/unit/components/investments/account-states.test.ts tests/unit/components/investments/navigator-detail.test.tsx
git commit -m "feat(investments): account navigator and detail panel with edge states"
```

### Task 13: Editors — record balance, edit holdings, set symbol

Standalone modals. Each one validates, calls one API and reports success through `onSaved`. Plan 4 reuses them in Settings.

**Files:**
- Create: `src/components/investments/editor-kit.ts` (shared request helper and form styles)
- Create: `src/components/investments/record-balance-modal.tsx`
- Create: `src/components/investments/holdings-editor-modal.tsx`
- Create: `src/components/investments/set-symbol-modal.tsx`
- Test: `tests/unit/components/investments/editors.test.tsx`

**Interfaces:**
- Consumes:
  - `Modal`, `Button`, `Input` (`src/components/ui`).
  - `POST /api/investments/accounts/:id/balances` `{ date, balance }`.
  - `GET /api/investments/securities/search?q=` → `{ results: SymbolMatch[] }`.
  - `POST /api/investments/securities` `{ symbol } | { cash }` → `{ security }`.
  - `PUT /api/investments/accounts/:id/holdings` `{ holdings: { securityId, quantity }[] }`.
  - `PATCH /api/investments/securities/:id` `{ priceSymbol } | { manualPrice }`.
  - `HoldingRow` (Task 6); `fmtMoney`, `fmtDay` (Task 10); `FlagPill` (Task 11).

  All APIs answer errors as `{ error }`.
- Produces:
  - `editor-kit.ts`: `sendJson<T>(url, method, body?): Promise<T>` (throws `Error(apiError)` on non-2xx), `errorText(e): string`, and the class strings `FIELD_LABEL`, `HINT`, `ERROR`.
  - `RecordBalanceModal({ account: { id: string; name: string; institution: string; currency: string }; today: string; onClose: () => void; onSaved: () => void })`.
  - `HoldingsEditorModal({ account: { id: string; name: string; currency: string }; holdings: HoldingRow[]; pricesAsOf: string | null; onClose: () => void; onSaved: () => void })`.
  - `SetSymbolModal({ security: { securityId: string; label: string }; onClose: () => void; onSaved: () => void })`.

  Each modal renders open. The page mounts it only while it's needed, with `key` set to the account or security id so its state resets.

**Copy (verbatim):**
- **Record balance:**
  - Title `Record balance · {Account}`; labels `Balance ({CUR})` and `As of`; button **Record**.
  - Hint: `From your {Institution} statement. Shown as the balance until the next entry.`
  - Errors: `Enter a balance`, or the API's `error`.
- **Edit holdings:**
  - Title `Edit holdings · {Account}`.
  - Hint: `valued daily · prices as of {Mon D} close`.
  - Columns `Security`, `Units`, `Price ({CUR})`, `Value ({CUR})`.
  - Unpriced row: `No price source` pill.
  - Search placeholder: `+ Add security — search ticker (e.g. VTI)`; button **+ Add cash**.
  - Total row: `Total`.
  - Footnote: `* Last known price. Units are what you hold today — edit them when you buy or sell; history keeps the old quantities.`
  - Button **Save holdings**.
  - Errors: `Units must be positive numbers`, `Add at least one holding`, `{TICK} is already listed`, or the API's `error`.
- **Set symbol:**
  - Title `Price {TICK}`.
  - Label `Price symbol`, placeholder `e.g. VTI or XIU.TO`, button **Use symbol**.
  - Label `Or set a price per unit`, button **Set price**.
  - Hint: `Use Yahoo Finance symbols: add .TO for Toronto listings, -USD for crypto.`
  - Errors: `Enter a symbol`, `Enter a positive price`, or the API's `error`.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/investments/editors.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordBalanceModal } from '@/components/investments/record-balance-modal';
import { HoldingsEditorModal } from '@/components/investments/holdings-editor-modal';
import { SetSymbolModal } from '@/components/investments/set-symbol-modal';
import { makeHolding } from '../../../helpers/investment-overview';

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply>;
const ok = (body: unknown): Reply => ({ body });

beforeEach(() => {
  replies = {};
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    const match = Object.keys(replies).find((k) => key.startsWith(k));
    const reply = match ? replies[match] : { status: 404, body: { error: 'Not mocked' } };
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: async () => reply.body,
    } as Response;
  }) as unknown as typeof fetch;
});

const calls = () =>
  vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    key: `${init?.method ?? 'GET'} ${String(url)}`,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));

describe('RecordBalanceModal', () => {
  const account = { id: 'acc-1', name: 'Pension', institution: 'Test Life', currency: 'CAD' };

  it('records a balance for a date', async () => {
    replies['POST /api/investments/accounts/acc-1/balances'] = ok({ balance: {} });
    const onSaved = vi.fn();
    render(<RecordBalanceModal account={account} today="2026-10-09" onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByText('From your Test Life statement. Shown as the balance until the next entry.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Balance (CAD)'), '1234.5');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0]).toEqual({
      key: 'POST /api/investments/accounts/acc-1/balances',
      body: { date: '2026-10-09', balance: 1234.5 },
    });
  });

  it('shows the API error', async () => {
    replies['POST /api/investments/accounts/acc-1/balances'] = {
      status: 400,
      body: { error: 'Balance date cannot be in the future' },
    };
    render(<RecordBalanceModal account={account} today="2026-10-09" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.type(screen.getByLabelText('Balance (CAD)'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByText('Balance date cannot be in the future')).toBeInTheDocument();
  });

  it('needs a balance', async () => {
    render(<RecordBalanceModal account={account} today="2026-10-09" onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByText('Enter a balance')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('HoldingsEditorModal', () => {
  const account = { id: 'acc-v', name: 'Valued', currency: 'USD' };
  const holdings = [makeHolding({ accountId: 'acc-v', quantity: 10, priceInAccount: 110 })];
  const renderEditor = (onSaved = vi.fn()) =>
    render(
      <HoldingsEditorModal
        account={account}
        holdings={holdings}
        pricesAsOf="2026-10-08"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

  it('saves edited units', async () => {
    replies['PUT /api/investments/accounts/acc-v/holdings'] = ok({ holdings: [] });
    const onSaved = vi.fn();
    renderEditor(onSaved);
    expect(screen.getByText('valued daily · prices as of Oct 8 close')).toBeInTheDocument();
    const units = screen.getByLabelText('Units for AAA');
    await userEvent.clear(units);
    await userEvent.type(units, '12');
    expect(screen.getAllByText('$1,320')).toHaveLength(2); // the row and the total
    await userEvent.click(screen.getByRole('button', { name: 'Save holdings' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls().at(-1)).toEqual({
      key: 'PUT /api/investments/accounts/acc-v/holdings',
      body: { holdings: [{ securityId: 'sec-aaa', quantity: 12 }] },
    });
  });

  it('rejects non-positive units without saving', async () => {
    renderEditor();
    await userEvent.clear(screen.getByLabelText('Units for AAA'));
    await userEvent.type(screen.getByLabelText('Units for AAA'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save holdings' }));
    expect(screen.getByText('Units must be positive numbers')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('adds a security found by search', async () => {
    replies['GET /api/investments/securities/search?q=bb'] = ok({
      results: [{ symbol: 'BBB', name: 'B Fund', type: 'etf', exchange: 'NYQ' }],
    });
    replies['POST /api/investments/securities'] = ok({
      security: { id: 'sec-bbb', ticker: 'BBB', name: 'B Fund', pricing: 'feed' },
    });
    renderEditor();
    await userEvent.type(screen.getByPlaceholderText('+ Add security — search ticker (e.g. VTI)'), 'bb');
    await userEvent.click(await screen.findByRole('button', { name: 'BBB · B Fund · NYQ' }));
    expect(await screen.findByLabelText('Units for BBB')).toBeInTheDocument();
    expect(calls().find((c) => c.key === 'POST /api/investments/securities')?.body).toEqual({ symbol: 'BBB' });
  });

  it('does not add a security twice', async () => {
    replies['GET /api/investments/securities/search?q=aa'] = ok({
      results: [{ symbol: 'AAA', name: 'Triple A Fund', type: 'etf', exchange: null }],
    });
    replies['POST /api/investments/securities'] = ok({
      security: { id: 'sec-aaa', ticker: 'AAA', name: 'Triple A Fund', pricing: 'feed' },
    });
    renderEditor();
    await userEvent.type(screen.getByPlaceholderText('+ Add security — search ticker (e.g. VTI)'), 'aa');
    await userEvent.click(await screen.findByRole('button', { name: 'AAA · Triple A Fund' }));
    expect(await screen.findByText('AAA is already listed')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Units for AAA')).toHaveLength(1);
  });

  it.each([
    [400, 'Unknown symbol'],
    [502, 'Price service unavailable'],
  ])('shows the API error when adding fails (%i)', async (status, message) => {
    replies['GET /api/investments/securities/search?q=zz'] = ok({
      results: [{ symbol: 'ZZZ', name: 'Zed', type: 'etf', exchange: null }],
    });
    replies['POST /api/investments/securities'] = { status, body: { error: message } };
    renderEditor();
    await userEvent.type(screen.getByPlaceholderText('+ Add security — search ticker (e.g. VTI)'), 'zz');
    await userEvent.click(await screen.findByRole('button', { name: 'ZZZ · Zed' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText('Units for ZZZ')).toBeNull();
  });

  it('adds cash in the account currency', async () => {
    replies['POST /api/investments/securities'] = ok({
      security: { id: 'sec-cash', ticker: null, name: 'USD cash', pricing: 'fixed' },
    });
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: '+ Add cash' }));
    expect(await screen.findByLabelText('Units for Cash')).toBeInTheDocument();
    expect(calls()[0]).toEqual({ key: 'POST /api/investments/securities', body: { cash: 'USD' } });
  });
});

describe('SetSymbolModal', () => {
  const security = { securityId: 'sec-z', label: 'ZZZ' };

  it('points the security at a new symbol', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    const onSaved = vi.fn();
    render(<SetSymbolModal security={security} onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Price symbol'), 'ZZZ.TO');
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0].body).toEqual({ priceSymbol: 'ZZZ.TO' });
  });

  it('sets a manual price, and validates both inputs', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    render(<SetSymbolModal security={security} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    expect(screen.getByText('Enter a symbol')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    expect(screen.getByText('Enter a positive price')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Or set a price per unit'), '50.73');
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    await waitFor(() => expect(calls()[0]?.body).toEqual({ manualPrice: 50.73 }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/editors.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

All three modals share one request helper and the form styles, in `editor-kit.ts`:

Create `src/components/investments/editor-kit.ts`:

```ts
/** JSON request; resolves to the parsed body, or throws an Error carrying the API's `error`. */
export async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export const FIELD_LABEL = 'mb-1 block text-[12.5px] font-medium text-[var(--text-secondary)]';
export const HINT = 'mt-1.5 text-[11.5px] text-[var(--text-muted)]';
export const ERROR = 'mt-2 text-xs text-[var(--red)]';
```

Create `src/components/investments/record-balance-modal.tsx`:

```tsx
'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';

export function RecordBalanceModal({
  account,
  today,
  onClose,
  onSaved,
}: {
  account: { id: string; name: string; institution: string; currency: string };
  today: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [balance, setBalance] = useState('');
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(balance.replace(/,/g, ''));
    if (!balance.trim() || !Number.isFinite(amount)) {
      setError('Enter a balance');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/accounts/${account.id}/balances`, 'POST', {
        date,
        balance: amount,
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen title={`Record balance · ${account.name}`} onClose={onClose}>
      <form className="grid grid-cols-[1.2fr_1fr_auto] items-end gap-3" onSubmit={submit}>
        <div>
          <label className={FIELD_LABEL} htmlFor="record-balance-amount">
            Balance ({account.currency})
          </label>
          <Input
            className="font-mono"
            id="record-balance-amount"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
          />
        </div>
        <div>
          <label className={FIELD_LABEL} htmlFor="record-balance-date">
            As of
          </label>
          <Input
            className="font-mono"
            id="record-balance-date"
            max={today}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <Button disabled={saving} type="submit">
          Record
        </Button>
      </form>
      <p className={HINT}>
        From your {account.institution} statement. Shown as the balance until the next entry.
      </p>
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
```

Create `src/components/investments/holdings-editor-modal.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import type { HoldingKind, HoldingRow } from '@/lib/investments/holdings-view';
import type { SymbolMatch } from '@/lib/prices/types';
import { fmtDay, fmtMoney } from './format';
import { FlagPill } from './pills';
import { ERROR, HINT, errorText, sendJson } from './editor-kit';

type EditorRow = {
  securityId: string;
  label: string;
  name: string;
  kind: HoldingKind;
  units: string;
  priceInAccount: number | null;
  unpriced: boolean;
};

type AddedSecurity = { id: string; ticker: string | null; name: string; pricing: string };

const SEARCH_DELAY_MS = 300;
const CELL = 'border-t border-[var(--border)] py-1.5 pr-2';

export function HoldingsEditorModal({
  account,
  holdings,
  pricesAsOf,
  onClose,
  onSaved,
}: {
  account: { id: string; name: string; currency: string };
  holdings: HoldingRow[];
  pricesAsOf: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rows, setRows] = useState<EditorRow[]>(() =>
    holdings
      .filter((h) => h.kind !== 'account')
      .map((h) => ({
        securityId: h.securityId,
        label: h.label,
        name: h.name,
        kind: h.kind,
        units: String(h.quantity),
        priceInAccount: h.priceInAccount,
        unpriced: h.pricing === 'none',
      }))
  );
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SymbolMatch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      sendJson<{ results: SymbolMatch[] }>(
        `/api/investments/securities/search?q=${encodeURIComponent(q)}`,
        'GET'
      )
        .then((data) => setResults(data.results))
        .catch((err) => setError(errorText(err)));
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const addRow = (row: EditorRow) => {
    if (rows.some((r) => r.securityId === row.securityId)) {
      setError(`${row.label} is already listed`);
      return;
    }
    setRows((current) => [...current, row]);
  };

  const add = async (body: { symbol: string } | { cash: string }, kind: HoldingKind) => {
    setError(null);
    try {
      const { security } = await sendJson<{ security: AddedSecurity }>(
        '/api/investments/securities',
        'POST',
        body
      );
      addRow({
        securityId: security.id,
        label: kind === 'cash' ? 'Cash' : (security.ticker ?? security.name),
        name: security.name,
        kind,
        units: '',
        priceInAccount: kind === 'cash' ? 1 : null,
        unpriced: security.pricing === 'none',
      });
      setQuery('');
      setResults([]);
    } catch (err) {
      setError(errorText(err));
    }
  };

  const save = async () => {
    if (!rows.length) {
      setError('Add at least one holding');
      return;
    }
    const quantities = rows.map((r) => Number(r.units));
    if (quantities.some((q) => !Number.isFinite(q) || q <= 0)) {
      setError('Units must be positive numbers');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/accounts/${account.id}/holdings`, 'PUT', {
        holdings: rows.map((r, i) => ({ securityId: r.securityId, quantity: quantities[i] })),
      });
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const valueOf = (r: EditorRow) =>
    r.priceInAccount == null || !Number(r.units) ? null : Number(r.units) * r.priceInAccount;
  const total = rows.reduce((sum, r) => sum + (valueOf(r) ?? 0), 0);
  const money = (v: number, cents = false) => fmtMoney(v, { cents, currency: account.currency });

  return (
    <Modal isOpen size="lg" title={`Edit holdings · ${account.name}`} onClose={onClose}>
      {pricesAsOf && (
        <p className="mb-2 text-right text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]">
          valued daily · prices as of {fmtDay(pricesAsOf)} close
        </p>
      )}
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]">
            <th className="w-[38%] pb-1.5 text-left font-normal">Security</th>
            <th className="pb-1.5 text-right font-normal">Units</th>
            <th className="pb-1.5 text-right font-normal">Price ({account.currency})</th>
            <th className="pb-1.5 text-right font-normal">Value ({account.currency})</th>
            <th className="w-6" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const value = valueOf(r);
            return (
              <tr key={r.securityId}>
                <td className={CELL}>
                  <span className="font-mono font-medium text-[var(--text-primary)]">{r.label}</span>
                  {r.unpriced && <FlagPill>No price source</FlagPill>}
                  <span className="block text-[11px] text-[var(--text-muted)]">{r.name}</span>
                </td>
                <td className={`${CELL} text-right`}>
                  <Input
                    aria-label={`Units for ${r.label}`}
                    className="ml-auto h-8 w-28 text-right font-mono"
                    inputMode="decimal"
                    value={r.units}
                    onChange={(e) =>
                      setRows((current) =>
                        current.map((c) =>
                          c.securityId === r.securityId ? { ...c, units: e.target.value } : c
                        )
                      )
                    }
                  />
                </td>
                <td
                  className={`${CELL} text-right font-mono ${r.unpriced ? 'text-[var(--accent)]' : ''}`}
                >
                  {r.priceInAccount == null ? '—' : money(r.priceInAccount, true)}
                  {r.unpriced && '*'}
                </td>
                <td className={`${CELL} text-right font-mono`}>
                  {value == null ? '—' : money(value)}
                </td>
                <td className={`${CELL} text-right`}>
                  <button
                    aria-label={`Remove ${r.label}`}
                    className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                    type="button"
                    onClick={() =>
                      setRows((current) => current.filter((c) => c.securityId !== r.securityId))
                    }
                  >
                    ✕
                  </button>
                </td>
              </tr>
            );
          })}
          <tr>
            <td className={CELL} colSpan={2}>
              <Input
                className="h-8"
                placeholder="+ Add security — search ticker (e.g. VTI)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {results.length > 0 && (
                <div className="mt-1 rounded-lg border border-[var(--border-hover)] bg-[var(--bg-base)]">
                  {results.map((m) => (
                    <button
                      key={m.symbol}
                      className="block w-full px-2.5 py-1.5 text-left text-xs hover:bg-[var(--bg-elevated)]"
                      type="button"
                      onClick={() => add({ symbol: m.symbol }, 'security')}
                    >
                      {[m.symbol, m.name, m.exchange].filter(Boolean).join(' · ')}
                    </button>
                  ))}
                </div>
              )}
            </td>
            <td className={CELL} colSpan={3}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => add({ cash: account.currency }, 'cash')}
              >
                + Add cash
              </Button>
            </td>
          </tr>
          <tr>
            <td className={`${CELL} font-medium`} colSpan={3}>
              Total
            </td>
            <td className={`${CELL} text-right font-mono font-medium`}>{money(total)}</td>
            <td className={CELL} />
          </tr>
        </tbody>
      </table>
      <p className={HINT}>
        * Last known price. Units are what you hold today — edit them when you buy or sell; history
        keeps the old quantities.
      </p>
      {error && <p className={ERROR}>{error}</p>}
      <div className="mt-3.5 flex justify-end">
        <Button disabled={saving} type="button" onClick={save}>
          Save holdings
        </Button>
      </div>
    </Modal>
  );
}
```

Create `src/components/investments/set-symbol-modal.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';

export function SetSymbolModal({
  security,
  onClose,
  onSaved,
}: {
  security: { securityId: string; label: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = async (body: { priceSymbol: string } | { manualPrice: number }) => {
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/securities/${security.securityId}`, 'PATCH', body);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const useSymbol = () => {
    if (!symbol.trim()) return setError('Enter a symbol');
    void patch({ priceSymbol: symbol.trim() });
  };
  const setManualPrice = () => {
    const value = Number(price);
    if (!price.trim() || !Number.isFinite(value) || value <= 0) {
      return setError('Enter a positive price');
    }
    void patch({ manualPrice: value });
  };

  return (
    <Modal isOpen title={`Price ${security.label}`} onClose={onClose}>
      <label className={FIELD_LABEL} htmlFor="set-symbol-symbol">
        Price symbol
      </label>
      <div className="flex gap-2">
        <Input
          className="font-mono"
          id="set-symbol-symbol"
          placeholder="e.g. VTI or XIU.TO"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <Button disabled={saving} type="button" onClick={useSymbol}>
          Use symbol
        </Button>
      </div>
      <p className={HINT}>Use Yahoo Finance symbols: add .TO for Toronto listings, -USD for crypto.</p>
      <label className={`${FIELD_LABEL} mt-4`} htmlFor="set-symbol-price">
        Or set a price per unit
      </label>
      <div className="flex gap-2">
        <Input
          className="font-mono"
          id="set-symbol-price"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Button disabled={saving} type="button" variant="outline" onClick={setManualPrice}>
          Set price
        </Button>
      </div>
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments/editors.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/components/investments/editor-kit.ts src/components/investments/record-balance-modal.tsx src/components/investments/holdings-editor-modal.tsx src/components/investments/set-symbol-modal.tsx tests/unit/components/investments/editors.test.tsx
git commit -m "feat(investments): editors to record balances, edit holdings and fix prices"
```

### Task 14: The `/investments` page and nav entry

**Files:**
- Create: `src/app/(routes)/investments/page.tsx`
- Modify: `src/components/side-nav.tsx`
- Test: `tests/unit/components/investments/investments-page.test.tsx`

**Interfaces:**
- Consumes:
  - `GET /api/investments/overview?range=` (Task 9) and `POST /api/investments/refresh` → `{ fetched, valuationRows, stopped, failedSymbols, pricesAsOf, … }` (Plan 2 shape; `pricesAsOf` per Task 3).
  - `AccountNavigator`, `AccountDetail` (Task 12); the three modals (Task 13).
  - `RANGES`, `DEFAULT_RANGE`, `Range` (Task 5); `fmtDay` (Task 10); `triggerSync` from `@/lib/cloud-sync`.
- Produces: the client page at `/investments` and the nav entry `Investments` (lucide `TrendingUp`), placed after Reports and before Goals.

**Behaviour:**
- **On open:** load the overview for `3M`, then `POST /api/investments/refresh` once. When the refresh settles, whatever its outcome, reload the overview for the current range. If the refresh stored anything (`fetched > 0` or `valuationRows > 0`), call `triggerSync()` first, as after an editor save, so new prices and valued balances reach cloud sync.
- **Stale responses:** each overview request gets an id from a ref; a response is applied only if no newer request was started (range switches and the post-refresh reload can overlap).
- **Refresh failed:** a non-2xx response, `stopped: true`, or any `failedSymbols`. It is remembered for the header wording only.
- **Changing range** reloads the overview. Selection is client state: `null` means All accounts, otherwise an account id. If the selected account disappears, the page falls back to All.
- **Header:** `Investments` on the left. On the right, the prices note, then the range tabs `1M · 3M · YTD · 1Y`. The prices note is one of:
  - while the refresh runs: `Updating prices…`;
  - when `overview.prices.stale`: `Prices as of {Mon D} close`, plus ` · couldn’t reach price source` if the refresh failed, then a **Retry** link that refreshes and reloads (accent);
  - otherwise: `Prices as of {Mon D} close` (muted);
  - nothing when `prices.asOf` is null.
- **Layout:** `grid lg:grid-cols-[400px_1fr] gap-6 items-start`. The navigator card is `lg:sticky lg:top-6`, with padding 16px 20px 18px. The detail card has padding 24px 26px 28px. Both use `Card` from `src/components/ui/card`.
- **Dialogs:**
  - **Record balance** opens `RecordBalanceModal`.
  - **Edit holdings** opens `HoldingsEditorModal` with that account's holdings rows and `account.prices?.asOf`.
  - **Set symbol** opens `SetSymbolModal`.
  - **Reconnect success** reloads the overview.
  - **After any save:** close the dialog, call `triggerSync()`, and reload the overview.
- **Empty state:** with no investment accounts, show one card with the title `No investment accounts yet` and the text `Set an account’s tracking mode to Investment in Settings → Accounts.`, where "Settings → Accounts" links to `/settings?tab=accounts`.
- **Load error:** with no overview yet, show `Couldn’t load investments.` with a **Try again** button.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/components/investments/investments-page.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/plaid/PlaidReconnectButton', () => ({
  PlaidReconnectButton: ({ buttonText }: { buttonText?: string }) => (
    <button type="button">{buttonText}</button>
  ),
}));

import InvestmentsPage from '@/app/(routes)/investments/page';
import { makeAccount, makeOverview } from '../../../helpers/investment-overview';
import type { InvestmentOverview } from '@/lib/investments/overview';

let overview: InvestmentOverview;
let refreshReply: { status: number; body: unknown };
/** Holds overview responses for one range until `until` resolves. */
let hold: { range: string; until: Promise<void> } | null;

beforeEach(() => {
  overview = makeOverview({ accounts: [makeAccount()] });
  refreshReply = { status: 200, body: { stopped: false, failedSymbols: [], fetched: 0, valuationRows: 0 } };
  hold = null;
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.startsWith('/api/investments/refresh') && init?.method === 'POST') {
      return { ok: refreshReply.status < 400, status: refreshReply.status, json: async () => refreshReply.body } as Response;
    }
    if (u.startsWith('/api/investments/overview')) {
      const range = new URLSearchParams(u.split('?')[1]).get('range');
      if (hold && hold.range === range) await hold.until;
      return { ok: true, status: 200, json: async () => ({ ...overview, range }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: 'Not mocked' }) } as Response;
  }) as unknown as typeof fetch;
});

const urls = () => vi.mocked(global.fetch).mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);

/** Counts cloud-sync requests (`triggerSync()` dispatches this window event). */
function listenForSync() {
  const synced = vi.fn();
  window.addEventListener('financeos-sync-trigger', synced);
  return { synced, stop: () => window.removeEventListener('financeos-sync-trigger', synced) };
}

describe('InvestmentsPage', () => {
  it('loads the overview, refreshes prices once, then reloads', async () => {
    const { synced, stop } = listenForSync();
    render(<InvestmentsPage />);
    expect(await screen.findByRole('heading', { name: 'Investments' })).toBeInTheDocument();
    await waitFor(() =>
      expect(urls()).toEqual([
        'GET /api/investments/overview?range=3M',
        'POST /api/investments/refresh',
        'GET /api/investments/overview?range=3M',
      ])
    );
    expect(await screen.findByText('Prices as of Oct 9 close')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'All accounts' })).toBeInTheDocument();
    expect(synced).not.toHaveBeenCalled(); // the refresh stored nothing
    stop();
  });

  it('syncs after a refresh that stored prices', async () => {
    const { synced, stop } = listenForSync();
    refreshReply = { status: 200, body: { stopped: false, failedSymbols: [], fetched: 1, valuationRows: 2 } };
    render(<InvestmentsPage />);
    await waitFor(() => expect(synced).toHaveBeenCalledTimes(1));
    stop();
  });

  it('ignores an overview response that arrives after a newer one', async () => {
    let release = () => {};
    const until = new Promise<void>((resolve) => {
      release = resolve;
    });
    hold = { range: '3M', until };
    render(<InvestmentsPage />);
    await userEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(await screen.findByText('balance change · 1M')).toBeInTheDocument();
    await act(async () => {
      release();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(screen.getByText('balance change · 1M')).toBeInTheDocument();
    expect(screen.queryByText('balance change · 3M')).toBeNull();
  });

  it('keeps the page usable when the refresh fails', async () => {
    refreshReply = { status: 502, body: { error: 'Price service unavailable' } };
    overview = makeOverview({ accounts: [makeAccount()], prices: { asOf: '2026-10-06', stale: true } });
    render(<InvestmentsPage />);
    expect(
      await screen.findByText('Prices as of Oct 6 close · couldn’t reach price source')
    ).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Investment accounts' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(urls().filter((u) => u === 'POST /api/investments/refresh')).toHaveLength(2));
  });

  it('switches range and selection', async () => {
    render(<InvestmentsPage />);
    await screen.findByRole('heading', { name: 'All accounts' });
    await userEvent.click(screen.getByRole('button', { name: '1M' }));
    await waitFor(() => expect(urls()).toContain('GET /api/investments/overview?range=1M'));
    await userEvent.click(screen.getByText('Brokerage'));
    expect(await screen.findByRole('heading', { name: 'Brokerage' })).toBeInTheDocument();
  });

  it('renders the empty state when there are no investment accounts', async () => {
    overview = makeOverview({ accounts: [], holdings: [] });
    render(<InvestmentsPage />);
    expect(await screen.findByText('No investment accounts yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings → Accounts' })).toHaveAttribute(
      'href',
      '/settings?tab=accounts'
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/investments-page.test.tsx`
Expected: FAIL — the page module does not exist.

- [ ] **Step 3: Implement the page**

Create `src/app/(routes)/investments/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountDetail } from '@/components/investments/account-detail';
import { AccountNavigator } from '@/components/investments/account-navigator';
import { fmtDay } from '@/components/investments/format';
import { HoldingsEditorModal } from '@/components/investments/holdings-editor-modal';
import { RecordBalanceModal } from '@/components/investments/record-balance-modal';
import { SetSymbolModal } from '@/components/investments/set-symbol-modal';
import { Card } from '@/components/ui/card';
import { triggerSync } from '@/lib/cloud-sync';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';
import { DEFAULT_RANGE, RANGES, type Range } from '@/lib/investments/portfolio-view';

type Dialog =
  | { kind: 'record'; account: AccountSummary }
  | { kind: 'holdings'; account: AccountSummary }
  | { kind: 'symbol'; security: { securityId: string; label: string } };

type RefreshState = { running: boolean; failed: boolean };

/** Runs the price refresh; `failed` drives the header wording, `wrote` whether to cloud-sync. */
async function runPriceRefresh(): Promise<{ failed: boolean; wrote: boolean }> {
  try {
    const res = await fetch('/api/investments/refresh', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    return {
      failed: !res.ok || data.stopped === true || (data.failedSymbols?.length ?? 0) > 0,
      wrote: res.ok && ((data.fetched ?? 0) > 0 || (data.valuationRows ?? 0) > 0),
    };
  } catch {
    return { failed: true, wrote: false };
  }
}

export default function InvestmentsPage() {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [overview, setOverview] = useState<InvestmentOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState<RefreshState>({ running: false, failed: false });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  /** Id of the newest overview request; older responses are dropped. */
  const latestLoad = useRef(0);

  const load = useCallback(async (r: Range) => {
    const id = ++latestLoad.current;
    try {
      const res = await fetch(`/api/investments/overview?range=${r}`);
      if (!res.ok) throw new Error('overview failed');
      const data: InvestmentOverview = await res.json();
      if (id !== latestLoad.current) return;
      setOverview(data);
      setLoadFailed(false);
    } catch {
      if (id === latestLoad.current) setLoadFailed(true);
    }
  }, []);

  const refreshPrices = useCallback(async () => {
    setRefresh({ running: true, failed: false });
    const { failed, wrote } = await runPriceRefresh();
    setRefresh({ running: false, failed });
    if (wrote) triggerSync();
    await load(rangeRef.current);
  }, [load]);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  useEffect(() => {
    void refreshPrices();
  }, [refreshPrices]);

  useEffect(() => {
    if (selected && overview && !overview.accounts.some((a) => a.id === selected)) {
      setSelected(null);
    }
  }, [overview, selected]);

  const saved = async () => {
    setDialog(null);
    triggerSync();
    await load(rangeRef.current);
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-[-0.3px] text-[var(--text-primary)]">
          Investments
        </h1>
        <div className="flex items-center gap-3.5">
          <PricesNote overview={overview} refresh={refresh} onRetry={refreshPrices} />
          <div className="inline-flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                aria-pressed={r === range}
                className={`rounded-md px-2.5 py-[3px] text-[11px] font-medium ${
                  r === range
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)]'
                }`}
                type="button"
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!overview && loadFailed && (
        <Card className="p-6 text-sm text-[var(--text-secondary)]">
          Couldn’t load investments.{' '}
          <button
            className="font-medium text-[var(--accent)]"
            type="button"
            onClick={() => load(range)}
          >
            Try again
          </button>
        </Card>
      )}

      {overview && overview.accounts.length === 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            No investment accounts yet
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Set an account’s tracking mode to Investment in{' '}
            <Link className="text-[var(--accent)]" href="/settings?tab=accounts">
              Settings → Accounts
            </Link>
            .
          </p>
        </Card>
      )}

      {overview && overview.accounts.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[400px_1fr]">
          <Card className="px-5 pb-[18px] pt-4 lg:sticky lg:top-6">
            <AccountNavigator
              overview={overview}
              selected={selected}
              onSelect={setSelected}
            />
          </Card>
          <Card className="px-[26px] pb-7 pt-6">
            <AccountDetail
              overview={overview}
              selected={selected}
              onEditHoldings={(account) => setDialog({ kind: 'holdings', account })}
              onReconnected={() => load(range)}
              onRecordBalance={(account) => setDialog({ kind: 'record', account })}
              onRetryPrices={refreshPrices}
              onSetSymbol={(security) => setDialog({ kind: 'symbol', security })}
            />
          </Card>
        </div>
      )}

      {dialog?.kind === 'record' && (
        <RecordBalanceModal
          key={dialog.account.id}
          account={dialog.account}
          today={overview?.today ?? new Date().toISOString().slice(0, 10)}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === 'holdings' && overview && (
        <HoldingsEditorModal
          key={dialog.account.id}
          account={dialog.account}
          holdings={overview.holdings.filter((h) => h.accountId === dialog.account.id)}
          pricesAsOf={dialog.account.prices?.asOf ?? null}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === 'symbol' && (
        <SetSymbolModal
          key={dialog.security.securityId}
          security={dialog.security}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function PricesNote({
  overview,
  refresh,
  onRetry,
}: {
  overview: InvestmentOverview | null;
  refresh: RefreshState;
  onRetry: () => void;
}) {
  if (refresh.running) {
    return <span className="text-[11.5px] text-[var(--text-muted)]">Updating prices…</span>;
  }
  const asOf = overview?.prices.asOf;
  if (!asOf) return null;
  if (!overview.prices.stale) {
    return (
      <span className="text-[11.5px] text-[var(--text-muted)]">Prices as of {fmtDay(asOf)} close</span>
    );
  }
  return (
    <span className="inline-flex gap-2 text-[11.5px] text-[var(--accent)]">
      <span>
        {`Prices as of ${fmtDay(asOf)} close${refresh.failed ? ' · couldn’t reach price source' : ''}`}
      </span>
      <button className="font-medium" type="button" onClick={onRetry}>
        Retry
      </button>
    </span>
  );
}
```

- [ ] **Step 4: Add the nav entry**

In `src/components/side-nav.tsx`, add `TrendingUp` to the `lucide-react` import (alphabetical, after `Target`), and insert after the Reports entry in `links`:

```ts
  { href: '/investments', label: 'Investments', icon: TrendingUp },
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components`
Expected: PASS.

- [ ] **Step 6: Full verification**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration`
Expected: typecheck clean, lint 0 errors, all tests pass.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add "src/app/(routes)/investments/page.tsx" src/components/side-nav.tsx tests/unit/components/investments/investments-page.test.tsx
git commit -m "feat(investments): the investments page"
```

### Task 15: Compare with the approved mock (user-gated)

Spec §11 requires checking the built UI side by side with the approved mocks. Only the user can sign this off.

- [ ] **Step 1: Run the app**

Run `npm run dev` in the background and open `http://localhost:3000/investments`. Also open `~/Documents/FinanceOS-design-archive/design-mocks/investments/layouts/a3-navigator.html` in the browser. The mock is outside the repo; never copy it in.

- [ ] **Step 2: Walk the states**

Check each against the mock in both light and dark themes, at desktop width and at a narrow width (< 1024 px). Note any deviation as `state — element — expected — actual`:
- Normal: All accounts selected.
- A Plaid account, a valued account and a manual account.
- Every range tab.
- Any live edge state the data has: needs reconnection, waiting, unpriced, stale.

Do not fake edge states in the user's database.

- [ ] **Step 3: STOP — ask the user to review**

Send the user the deviation list and the URL. Fix only what they ask for, with the same TDD steps, as one follow-up commit per fix, then ask again. Do not push or open a PR until the user says so.

---

## Handed to Plan 4

- **Settings → Manage account modal for investment accounts:**
  - The tracking mode option `Investment — holdings & balance history` and the Synced / Valued / Manual balance-source cards, with cross-field validation on `PATCH /api/accounts/:id`. Switching to Valued must not leave a half-switched account.
  - The Bank Connection summary, including "trades not reported" (from `AccountStatus.tradesReported`) and the waiting state (from `PlaidConnection.pendingSteps`, Task 1).
  - Read-only Plaid holdings.
  - Reuse of `HoldingsEditorModal` and `RecordBalanceModal`, or their bodies.
  - A Balance History list with delete, plus the "migrated from adjustments" label. This needs a way to identify migrated rows, which no current field provides.
  - Removing Reconcile Balance for investment accounts.
- **Add from Plaid:** preselect Investment tracking for investment-type accounts, with the explanatory note.
- **Transactions:** the `→ {account} · {institution}` chip and hover card on linked transfers, **Unlink**, and the muted "Transfer · not matched" chip. `GET /api/transactions` must include `investmentLinks`.
- **Follow-up after Plan 4:** automatic FX rates. The user wants this; the manual rate went stale.
