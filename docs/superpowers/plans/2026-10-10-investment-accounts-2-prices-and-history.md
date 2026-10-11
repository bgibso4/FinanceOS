# Investment Accounts — Plan 2: Prices & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price securities from Yahoo, value "valued" investment accounts from user-entered holdings, give manual accounts their single holding, derive daily value history for every investment account, and expose all of it through the APIs the Plan 3 UI will call.

**Architecture:** An object-oriented core behind small interfaces. `src/lib/clock.ts` defines the `Clock` interface every time-dependent service takes. `src/lib/prices/` holds the `PriceProvider` interface (plus narrowed views `HistorySource`, `QuoteSource`, `SymbolLookup`), its Yahoo adapter class `YahooPriceProvider` (`yahoo-finance2`, loaded lazily), a `QuoteCache` (15-minute TTL), the `PriceRefresher` (sequential, throttled, retry-once-then-stop), one `PricingStrategy` class per pricing mode chosen by `pricingFor`, a `PriceBook` that answers "price of security X on day D", and a `SecurityCatalog` for adding and repricing securities. `src/lib/investments/` gains `ValuationService` (holdings × price → `AccountBalance` rows), `ManualHoldingService` (the manual-holding mirror), `ValueHistoryService` (read-time history derivation) and `InvestmentRefreshService`, which runs after Plaid investment syncs and when the investments view asks. `src/lib/investments/services.ts` is the single composition root: `createInvestmentServices` wires the classes, and `getInvestmentServices` memoizes the production instance (app Prisma client + Yahoo) for routes and the sync hook. New routes live under `src/app/api/investments/` and stay thin. Plan 1 modules (`balances.ts`, `plaid-investment-sync.ts`, `migration.ts`, `dates.ts`) stay functional; only the lines this plan needs change.

**Tech Stack:** Next.js App Router, TypeScript, Prisma + SQLite, `yahoo-finance2` v4, Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-investment-accounts-design.md` — this plan covers §5 (price service) and §6 (valuation accounts, manual accounts, derived history), plus the server APIs §8's UI needs for those features. Plan 1 (`docs/superpowers/plans/2026-10-10-investment-accounts-1-data-foundation.md`, PR #32) built the schema, balance resolver, Plaid investment sync and migration this plan builds on.

**Plan series:** 1. Data foundation (done, PR #32) · **2. Prices & history (this plan)** · 3. UI — `/investments` page, Settings modal/mapping, linked-transfer chip, and the page-shaped read models (holdings list, aggregation, allocation, activity feed).

**Branch:** `feat/investment-prices-history`, created from `main` after PR #32 merged. Work on it in the main checkout (no worktrees); PRs target `main`; never push or open a PR unless the user asks.

**Rulings made while writing this plan (spec ambiguities):**
- Spec §5 lists `getDailyCloses`, `getQuote`, `getEvents`; the same section requires "one `chart()` call per symbol" for closes *and* events. The interface therefore has one `getDailyHistory(symbol, from, to)` returning both, plus `getQuote` and `search` (the holdings editor's ticker search). Cost if wrong: a rename.
- Spec §6 says derived history fills "days the app wasn't used". Stage 1 explicitly excludes "reconstructing pre-go-live holdings from trades" (§1 out of scope), so derivation only runs on or after an account's first Plaid holdings snapshot; earlier days carry the stored (migrated) balance forward, marked estimated.
- Spec §8 asks for migrated manual entries to be labelled "migrated from adjustments". `AccountBalance` has no field that can tell them apart, and that label is UI. Left to Plan 3, which must decide how to identify those rows.
- The synthetic security behind a manual account's single holding uses the deterministic id `manual-holding-<accountId>`, so it can be found, rebuilt and removed without ever touching a real security.

## Global Constraints

- **Design principles: DRY > YAGNI > SOLID, all important.** Before writing a helper, query, schema or pattern, look for an existing one (in the codebase or an earlier task) and reuse or extract it rather than repeat it. Build nothing that no task, spec requirement or Plan 3 interface uses. Keep each module single-purpose, with dependencies (`prisma`, price provider, clock) passed in and narrowed to the methods actually used. When the principles conflict, DRY beats YAGNI (extracting a shared helper is fine) and YAGNI beats SOLID (no speculative interfaces). Reviewers flag violations as Important.
- **Object-oriented core:** depend on interfaces for anything swappable (price provider, clock); stateful or dependency-holding services are classes taking their dependencies in the constructor; per-mode behaviour uses polymorphism, not `switch`; one composition root wires production instances, and tests construct classes directly with the test Prisma client and fakes — no `vi.mock` of our own modules except `@/lib/prisma` in route tests and the composition root itself. Stateless pure helpers (`lastCompletedTradingDay`, `roundCents`, `lastAtOrBefore`, `requireInvestmentAccount`) stay functions. OOP serves DRY > YAGNI > SOLID; it does not license speculative abstraction.
- Schema: this plan needs **no** schema change. If one turns out to be needed, use `npx prisma db push` then `npx prisma generate` — never `prisma migrate dev`.
- All dates UTC; day-granular rows use UTC midnight. API dates are `YYYY-MM-DD` strings.
- Zod is v4: `z.number()` already rejects `NaN`/`Infinity` (don't add the deprecated `.finite()`).
- Investment-mode accounts never write `Transaction` rows. `InvestmentTransaction.amount` keeps Plaid's sign (positive = cash leaves the investment account); Plaid sells carry a **negative** `quantity`.
- Never call Plaid `/investments/refresh` or `/transactions/refresh`.
- Prices never run in the background: only after an investment sync, when the investments view asks (`POST /api/investments/refresh`), or when a fresh quote is requested. Symbols run sequentially ~0.5 s apart; one history call per symbol covering (last stored day + 1 → last completed trading day); stored days are never refetched; null-close bars are dropped; on 429/network error retry once after a few seconds, then stop the run keeping what was saved; no persisted cooldown; an unrecognised symbol sets `pricing = 'none'`.
- `SecurityPrice` stores **raw** closes; never store adjusted closes.
- Unit tests never reach Yahoo: construct services with a fake `PriceProvider` (`fakeProvider` in `tests/helpers/investments.ts`), and in route tests mock `@/lib/investments/services` so `getInvestmentServices` returns `testServices(testPrisma, …)`. Tests never sleep for real: pass `noSleep` (or a `vi.fn` sleeper) and a `fixedClock(...)`. Only Task 1 Step 6 makes one real Yahoo call, as a manual smoke check that is not committed.
- **The GitHub repo is public:** no account names, masks, balances, holdings or other personal data in committed code, tests or fixtures. Tests use synthetic data. Real holdings for Task 10 live in `~/Documents/FinanceOS-private/` (outside the repo).
- Lint: only `console.warn` / `console.error`; prefix unused vars with `_`; single quotes, semicolons, 100-char lines. Run `npm run lint:fix` before each commit.
- Tests: Vitest. DB tests use `setupTestDb/resetTestDb/teardownTestDb` from `tests/helpers/db.ts`. New services take `prisma` as their first constructor argument, so library tests construct them with the test client directly; route tests mock `@/lib/prisma` with a getter returning the test client (pattern in `tests/integration/api/plaid-investment-sync-route.test.ts`) and mock `@/lib/investments/services` (Task 7 onward).
- Stage explicit paths only; never stage `.claude/` or `.superpowers/`. Commit messages end with the Co-Authored-By trailer from your system reminder.

## Review Focus

1. **The Plaid sync must not undo price fixes.** Plaid's security upsert rewrote `pricing` on every sync, so a symbol marked `none` (Yahoo doesn't know it) flipped back to `feed` and was refetched and re-failed on every sync. A user's manual price was overwritten the same way. A security stays `none` while Plaid reports the same symbol, and user edits set `priceSymbolOverride`. → Task 2 test "keeps a security marked unpriced while Plaid reports the same symbol"; Task 9 tests set `priceSymbolOverride`.
2. **Yahoo throttles mid-run.** Prices saved before the failure stay, later symbols are not called, and the next trigger resumes without refetching stored days. → Task 2 tests "stops the run after a second failure…" and "resumes on the next run…".
3. **Two triggers at once** (the view loads while a post-sync refresh is running) must not fetch the same symbol twice. → Task 7 test "serializes concurrent refreshes".
4. **A valued account holding a security with no price on some day** must skip that day, not write an undervalued balance. → Task 5 test "skips days where a holding has no price".
5. **History before go-live:** a provider account's days before its first Plaid holdings snapshot must show the migrated balances carried forward (estimated), not holdings reconstructed backwards from trades. → Task 6 test "does not derive before the first holdings snapshot".

---

## File Structure

| File | Responsibility |
|---|---|
| `package.json` (modify) | Add `yahoo-finance2` |
| `src/lib/clock.ts` (create) | `Clock` interface, `systemClock`, `fixedClock` |
| `src/lib/prices/types.ts` (create) | `PriceProvider` interface + narrowed views (`HistorySource`, `QuoteSource`, `SymbolLookup`), value types, `PriceProviderError` |
| `src/lib/prices/yahoo.ts` (create) | `YahooPriceProvider` class + `classifyYahooError` |
| `src/lib/prices/quote-cache.ts` (create) | `QuoteCache` (15-min TTL per symbol) |
| `src/lib/prices/trading-days.ts` (create) | Last completed trading day (exchange vs crypto), pure function |
| `src/lib/prices/refresh.ts` (create) | `PriceRefresher` (refresh run, `latestStoredClose`, `pricesAsOf`) |
| `src/lib/prices/pricing.ts` (create) | `PricingStrategy` interface, one class per pricing mode, `pricingFor` |
| `src/lib/prices/price-book.ts` (create) | `PriceBook`, `loadFxRates` |
| `src/lib/prices/securities.ts` (create) | `SecurityCatalog` (search, find-or-create, fix symbol, manual price) |
| `src/lib/investments/plaid-investment-sync.ts` (modify) | Keep `pricing = 'none'` while the symbol is unchanged |
| `src/lib/investments/dates.ts` (modify) | Add `lastAtOrBefore` (shared by valuation and history) |
| `src/lib/investments/money.ts` (create) | `roundCents` (shared by migration, valuation, history) |
| `src/lib/investments/migration.ts` (modify) | Use `roundCents` instead of inline rounding |
| `src/lib/investments/account-guard.ts` (create) | `InvestmentInputError`, `requireInvestmentAccount` |
| `src/lib/investments/manual-holding.ts` (create) | `ManualHoldingService`: record/delete/list manual balances; mirror the single holding |
| `src/lib/investments/valuation.ts` (create) | `ValuationService`: set/save holdings, write valued balances |
| `src/lib/investments/history.ts` (create) | `ValueHistoryService` (+ internal `ProviderValueDeriver`) |
| `src/lib/investments/refresh.ts` (create) | `InvestmentRefreshService` orchestrator |
| `src/lib/investments/services.ts` (create) | Composition root: `createInvestmentServices`, `getInvestmentServices` |
| `src/app/api/transactions/adjustment/route.ts` (modify) | Manual accounts via `ManualHoldingService.record`; other investment sources rejected |
| `src/app/api/plaid/sync/route.ts` (modify) | Fire-and-forget investment refresh after investment syncs |
| `src/app/api/investments/_lib/http.ts` (create) | Shared route helpers: `investmentErrorResponse`, `parseJsonBody`, `isoDateSchema` |
| `src/app/api/investments/refresh/route.ts`, `history/route.ts` (create) | Refresh trigger; value series |
| `src/app/api/investments/accounts/[id]/holdings/route.ts`, `balances/route.ts`, `balances/[balanceId]/route.ts` (create) | Valued holdings editor; manual balance history |
| `src/app/api/investments/securities/search/route.ts`, `securities/route.ts`, `securities/[id]/route.ts` (create) | Ticker search; add security; fix symbol / manual price |
| `scripts/lib/backup-db.ts` (create) | `backupDatabase` (moved out of the Plan 1 migration script) |
| `scripts/migrate-investment-accounts.ts` (modify) | Import `backupDatabase` from the shared module |
| `scripts/set-valuation-holdings.ts` (create) | One-shot: switch accounts to Valued from a local holdings file |
| `tests/helpers/investments.ts` (create) | Seed helpers, fake price provider, `noSleep`, `testServices` |
| Tests under `tests/unit/lib/prices/`, `tests/unit/lib/investments/`, `tests/integration/api/` | As listed per task |

---

### Task 1: Clock, price provider, Yahoo adapter and quote cache

**Files:**
- Modify: `package.json`, `package-lock.json` (via npm)
- Create: `src/lib/clock.ts`, `src/lib/prices/types.ts`, `src/lib/prices/yahoo.ts`, `src/lib/prices/quote-cache.ts`
- Test: `tests/unit/lib/prices/yahoo.test.ts`, `tests/unit/lib/prices/quote-cache.test.ts`

**Interfaces:**
- Consumes: `utcDay`, `addDays` from `src/lib/investments/dates.ts`; `SecurityType` from `src/lib/investments/plaid-mapping.ts`.
- Produces:
  - `src/lib/clock.ts`: `interface Clock { now(): Date }`, `systemClock: Clock`, `fixedClock(iso: string): Clock` (tests)
  - `type DailyClose = { date: Date; close: number }`
  - `type PriceEvent = { date: Date; type: 'dividend' | 'split'; amount: number | null; ratio: number | null }`
  - `type DailyHistory = { closes: DailyClose[]; events: PriceEvent[] }`
  - `type Quote = { symbol: string; price: number; currency: string; asOf: Date }`
  - `type SymbolMatch = { symbol: string; name: string; type: SecurityType; exchange: string | null }`
  - `type PriceErrorKind = 'rate_limited' | 'network' | 'unknown_symbol'`
  - `class PriceProviderError extends Error { kind: PriceErrorKind }`
  - `interface PriceProvider { getDailyHistory(symbol, from: Date, to: Date): Promise<DailyHistory>; getQuote(symbol): Promise<Quote>; search(query): Promise<SymbolMatch[]> }` (`from`/`to` are inclusive UTC days)
  - Narrowed views, so each consumer depends only on what it calls: `type HistorySource = Pick<PriceProvider, 'getDailyHistory'>`, `type QuoteSource = Pick<PriceProvider, 'getQuote'>`, `type SymbolLookup = Pick<PriceProvider, 'search'>`
  - `class YahooPriceProvider implements PriceProvider { constructor(client?: YahooClient) }` (defaults to a real `yahoo-finance2` client), `type YahooClient`, `classifyYahooError(error: unknown): PriceErrorKind`
  - `class QuoteCache { constructor(source: QuoteSource, clock?: Clock, ttlMs?: number); get(symbol: string): Promise<Quote> }` — 15-minute TTL by default; failures are not cached. One instance per process lives in the composition root (Task 7), replacing a module-level cache.

- [ ] **Step 1: Install the dependency**

Run: `npm install yahoo-finance2@^4.0.3`
Expected: `package.json` lists `"yahoo-finance2": "^4.0.3"` under `dependencies`.

- [ ] **Step 2: Write the failing tests**

`tests/unit/lib/prices/yahoo.test.ts`:

```ts
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

vi.mock('yahoo-finance2', () => ({ default: class {} }));

import { YahooPriceProvider, classifyYahooError, type YahooClient } from '@/lib/prices/yahoo';
import { utcDay } from '@/lib/investments/dates';

function client(over: Partial<YahooClient> = {}): YahooClient {
  return {
    chart: vi.fn(async () => ({ quotes: [], events: {} })),
    quote: vi.fn(async () => ({
      regularMarketPrice: 10,
      currency: 'USD',
      regularMarketTime: new Date('2026-10-09T20:00:00Z'),
    })),
    search: vi.fn(async () => ({ quotes: [] })),
    ...over,
  };
}

const FROM = utcDay('2026-10-05');
const TO = utcDay('2026-10-09');

describe('yahoo price provider', () => {
  it('requests one daily chart with events covering the inclusive range', async () => {
    const c = client();
    await new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO);
    expect(c.chart).toHaveBeenCalledTimes(1);
    expect(c.chart).toHaveBeenCalledWith('VTI', {
      period1: FROM,
      period2: utcDay('2026-10-10'),
      interval: '1d',
      events: 'div|split',
    });
  });

  it('maps closes to UTC days and drops null closes and out-of-range bars', async () => {
    const c = client({
      chart: vi.fn(async () => ({
        quotes: [
          { date: new Date('2026-10-08T13:30:00Z'), close: 101.5 },
          { date: new Date('2026-10-09T13:30:00Z'), close: null },
          { date: new Date('2026-10-12T13:30:00Z'), close: 105 },
        ],
      })),
    });
    const h = await new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO);
    expect(h.closes).toEqual([{ date: utcDay('2026-10-08'), close: 101.5 }]);
  });

  it('maps dividends and splits', async () => {
    const c = client({
      chart: vi.fn(async () => ({
        quotes: [],
        events: {
          dividends: [{ date: new Date('2026-10-06T13:30:00Z'), amount: 0.75 }],
          splits: [{ date: new Date('2026-10-07T13:30:00Z'), numerator: 4, denominator: 1 }],
        },
      })),
    });
    const h = await new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO);
    expect(h.events).toEqual([
      { date: utcDay('2026-10-06'), type: 'dividend', amount: 0.75, ratio: null },
      { date: utcDay('2026-10-07'), type: 'split', amount: null, ratio: 4 },
    ]);
  });

  it.each([
    ['Too Many Requests', 'rate_limited'],
    ['Request failed with status 429', 'rate_limited'],
    ['No data found, symbol may be delisted', 'unknown_symbol'],
    ['Not Found', 'unknown_symbol'],
    ['fetch failed', 'network'],
  ])('classifies "%s" as %s', (message, kind) => {
    expect(classifyYahooError(new Error(message))).toBe(kind);
  });

  it('wraps client errors in PriceProviderError', async () => {
    const c = client({
      chart: vi.fn(async () => {
        throw new Error('Too Many Requests');
      }),
    });
    await expect(new YahooPriceProvider(c).getDailyHistory('VTI', FROM, TO)).rejects.toMatchObject({
      name: 'PriceProviderError',
      kind: 'rate_limited',
    });
  });

  it('maps a quote', async () => {
    const q = await new YahooPriceProvider(client()).getQuote('VTI');
    expect(q).toEqual({
      symbol: 'VTI',
      price: 10,
      currency: 'USD',
      asOf: new Date('2026-10-09T20:00:00Z'),
    });
  });

  it('treats a quote without a price as an unknown symbol', async () => {
    const c = client({ quote: vi.fn(async () => ({})) });
    await expect(new YahooPriceProvider(c).getQuote('NOPE')).rejects.toMatchObject({
      kind: 'unknown_symbol',
    });
  });

  it('maps search results and ignores non-Yahoo entries', async () => {
    const c = client({
      search: vi.fn(async () => ({
        quotes: [
          {
            symbol: 'TEQ.TO',
            shortname: 'Test Equity ETF',
            quoteType: 'ETF',
            exchange: 'TOR',
            isYahooFinance: true,
          },
          { symbol: 'X', shortname: 'News', isYahooFinance: false },
        ],
      })),
    });
    expect(await new YahooPriceProvider(c).search('teq')).toEqual([
      { symbol: 'TEQ.TO', name: 'Test Equity ETF', type: 'etf', exchange: 'TOR' },
    ]);
  });
});
```

`tests/unit/lib/prices/quote-cache.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { Clock } from '@/lib/clock';
import { QuoteCache } from '@/lib/prices/quote-cache';
import type { QuoteSource } from '@/lib/prices/types';

function source(): QuoteSource {
  return {
    getQuote: vi.fn(async (symbol: string) => ({
      symbol,
      price: 10,
      currency: 'USD',
      asOf: new Date('2026-10-09T20:00:00Z'),
    })),
  };
}

/** A clock the test moves by hand: `clock.ms` is the current epoch milliseconds. */
function mutableClock(): Clock & { ms: number } {
  return {
    ms: 0,
    now() {
      return new Date(this.ms);
    },
  };
}

describe('QuoteCache', () => {
  it('serves a repeat request within 15 minutes from the cache', async () => {
    const s = source();
    const clock = mutableClock();
    const cache = new QuoteCache(s, clock);
    await cache.get('VTI');
    clock.ms = 14 * 60 * 1000;
    await cache.get('VTI');
    expect(s.getQuote).toHaveBeenCalledTimes(1);
  });

  it('refetches after 15 minutes', async () => {
    const s = source();
    const clock = mutableClock();
    const cache = new QuoteCache(s, clock);
    await cache.get('VTI');
    clock.ms = 15 * 60 * 1000;
    await cache.get('VTI');
    expect(s.getQuote).toHaveBeenCalledTimes(2);
  });

  it('does not cache failures', async () => {
    const s = source();
    const clock = mutableClock();
    const cache = new QuoteCache(s, clock);
    vi.mocked(s.getQuote).mockRejectedValueOnce(new Error('fetch failed'));
    await expect(cache.get('VTI')).rejects.toThrow('fetch failed');
    clock.ms = 1;
    await cache.get('VTI');
    expect(s.getQuote).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices`
Expected: FAIL — cannot resolve `@/lib/prices/yahoo` / `@/lib/prices/quote-cache` / `@/lib/clock`.

- [ ] **Step 4: Implement**

`src/lib/clock.ts`:

```ts
/** The current time, injected so services and tests agree on "today". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock frozen at `iso` (tests). */
export const fixedClock = (iso: string): Clock => ({ now: () => new Date(iso) });
```

`src/lib/prices/types.ts`:

```ts
import type { SecurityType } from '@/lib/investments/plaid-mapping';

export type DailyClose = { date: Date; close: number };

export type PriceEvent = {
  date: Date;
  type: 'dividend' | 'split';
  amount: number | null;
  ratio: number | null;
};

export type DailyHistory = { closes: DailyClose[]; events: PriceEvent[] };

export type Quote = { symbol: string; price: number; currency: string; asOf: Date };

export type SymbolMatch = {
  symbol: string;
  name: string;
  type: SecurityType;
  exchange: string | null;
};

export type PriceErrorKind = 'rate_limited' | 'network' | 'unknown_symbol';

export class PriceProviderError extends Error {
  readonly kind: PriceErrorKind;

  constructor(kind: PriceErrorKind, message: string) {
    super(message);
    this.name = 'PriceProviderError';
    this.kind = kind;
  }
}

export interface PriceProvider {
  /** Raw daily closes (null bars dropped) and dividend/split events for inclusive UTC days. */
  getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory>;
  getQuote(symbol: string): Promise<Quote>;
  search(query: string): Promise<SymbolMatch[]>;
}

/** Narrowed views: each consumer depends only on the provider methods it calls. */
export type HistorySource = Pick<PriceProvider, 'getDailyHistory'>;
export type QuoteSource = Pick<PriceProvider, 'getQuote'>;
export type SymbolLookup = Pick<PriceProvider, 'search'>;
```

`src/lib/prices/yahoo.ts`:

```ts
import YahooFinance from 'yahoo-finance2';
import { addDays, utcDay } from '@/lib/investments/dates';
import type { SecurityType } from '@/lib/investments/plaid-mapping';
import {
  PriceProviderError,
  type DailyHistory,
  type PriceErrorKind,
  type PriceEvent,
  type PriceProvider,
  type Quote,
  type SymbolMatch,
} from './types';

type ChartOptions = { period1: Date; period2: Date; interval: '1d'; events: string };
type ChartResult = {
  quotes: { date: Date; close: number | null }[];
  events?: {
    dividends?: { date: Date; amount: number }[];
    splits?: { date: Date; numerator: number; denominator: number }[];
  };
};
type SearchQuote = {
  symbol?: string;
  shortname?: string;
  longname?: string;
  quoteType?: string;
  exchange?: string;
  isYahooFinance?: boolean;
};

/** The subset of yahoo-finance2 this adapter uses; injectable for tests. */
export type YahooClient = {
  chart(symbol: string, options: ChartOptions): Promise<ChartResult>;
  quote(
    symbol: string
  ): Promise<{ regularMarketPrice?: number; currency?: string; regularMarketTime?: Date }>;
  search(
    query: string,
    options: { quotesCount: number; newsCount: number }
  ): Promise<{ quotes: SearchQuote[] }>;
};

const QUOTE_TYPES: Record<string, SecurityType> = {
  EQUITY: 'equity',
  ETF: 'etf',
  MUTUALFUND: 'mutual_fund',
  CRYPTOCURRENCY: 'crypto',
  MONEYMARKET: 'money_market',
};

export function classifyYahooError(error: unknown): PriceErrorKind {
  const message = error instanceof Error ? error.message : String(error);
  if (/too many requests|\b429\b/i.test(message)) return 'rate_limited';
  if (/not found|no data found|delisted|\b404\b|invalid symbol/i.test(message)) {
    return 'unknown_symbol';
  }
  return 'network';
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PriceProviderError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new PriceProviderError(classifyYahooError(error), message);
  }
}

/** `PriceProvider` backed by Yahoo Finance; every client error becomes a `PriceProviderError`. */
export class YahooPriceProvider implements PriceProvider {
  constructor(
    private readonly client: YahooClient = new YahooFinance() as unknown as YahooClient
  ) {}

  async getDailyHistory(symbol: string, from: Date, to: Date): Promise<DailyHistory> {
    const res = await call(() =>
      this.client.chart(symbol, {
        period1: from,
        period2: addDays(to, 1),
        interval: '1d',
        events: 'div|split',
      })
    );
    const inRange = (d: Date) => {
      const day = utcDay(d);
      return day >= from && day <= to;
    };
    const closes = res.quotes
      .filter((q) => q.close != null && Number.isFinite(q.close) && inRange(q.date))
      .map((q) => ({ date: utcDay(q.date), close: q.close as number }));
    const events: PriceEvent[] = [
      ...(res.events?.dividends ?? [])
        .filter((d) => inRange(d.date))
        .map((d) => ({
          date: utcDay(d.date),
          type: 'dividend' as const,
          amount: d.amount,
          ratio: null,
        })),
      ...(res.events?.splits ?? [])
        .filter((s) => inRange(s.date))
        .map((s) => ({
          date: utcDay(s.date),
          type: 'split' as const,
          amount: null,
          ratio: s.numerator / s.denominator,
        })),
    ];
    return { closes, events };
  }

  async getQuote(symbol: string): Promise<Quote> {
    const q = await call(() => this.client.quote(symbol));
    if (q?.regularMarketPrice == null) {
      throw new PriceProviderError('unknown_symbol', `No quote for ${symbol}`);
    }
    return {
      symbol,
      price: q.regularMarketPrice,
      currency: q.currency ?? 'USD',
      asOf: q.regularMarketTime ?? new Date(),
    };
  }

  async search(query: string): Promise<SymbolMatch[]> {
    const res = await call(() => this.client.search(query, { quotesCount: 8, newsCount: 0 }));
    return res.quotes
      .filter((q) => q.isYahooFinance && q.symbol)
      .map((q) => ({
        symbol: q.symbol!,
        name: q.shortname ?? q.longname ?? q.symbol!,
        type: QUOTE_TYPES[q.quoteType ?? ''] ?? 'other',
        exchange: q.exchange ?? null,
      }));
  }
}
```

`src/lib/prices/quote-cache.ts`:

```ts
import { systemClock, type Clock } from '@/lib/clock';
import type { Quote, QuoteSource } from './types';

const QUOTE_TTL_MS = 15 * 60 * 1000;

/** Latest quote per symbol, reused for `ttlMs`. Failures are not cached. */
export class QuoteCache {
  private readonly entries = new Map<string, { quote: Quote; fetchedAt: number }>();

  constructor(
    private readonly source: QuoteSource,
    private readonly clock: Clock = systemClock,
    private readonly ttlMs = QUOTE_TTL_MS
  ) {}

  async get(symbol: string): Promise<Quote> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(symbol);
    if (hit && now - hit.fetchedAt < this.ttlMs) return hit.quote;
    const quote = await this.source.getQuote(symbol);
    this.entries.set(symbol, { quote, fetchedAt: now });
    return quote;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices && npm run typecheck`
Expected: PASS; typecheck clean. If `new YahooFinance()` (the constructor's default client) doesn't typecheck against the installed v4 types, keep the `as unknown as YahooClient` cast and confirm the default export is the class (`import YahooFinance from 'yahoo-finance2'`).

- [ ] **Step 6: Smoke-check the real API shape (manual, not committed)**

Run once from the repo root:

```bash
npx tsx -e "import { YahooPriceProvider } from './src/lib/prices/yahoo'; const p = new YahooPriceProvider(); const to = new Date(Date.UTC(2026, 9, 9)); p.getDailyHistory('VTI', new Date(Date.UTC(2026, 8, 1)), to).then(h => console.warn(h.closes.length, h.closes.at(-1), h.events.length)).catch(e => console.error(e.name, e.kind, e.message))"
```

Expected: about 20+ closes, the last one dated 2026-10-09 or earlier, and no thrown error. If field names differ from `YahooClient` (for example events arrive as an object keyed by timestamp), adapt the adapter **and** add a test for the real shape, then note the deviation in your report. This is the only real Yahoo call in the plan's tests and checks.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add package.json package-lock.json src/lib/clock.ts src/lib/prices/types.ts src/lib/prices/yahoo.ts src/lib/prices/quote-cache.ts tests/unit/lib/prices/yahoo.test.ts tests/unit/lib/prices/quote-cache.test.ts
git commit -m "feat(prices): clock, price provider interface, Yahoo adapter and quote cache"
```

---

### Task 2: Price refresh run

**Files:**
- Create: `src/lib/prices/trading-days.ts`, `src/lib/prices/refresh.ts`, `tests/helpers/investments.ts`
- Modify: `src/lib/investments/plaid-investment-sync.ts` (`upsertSecurities`, ~line 66)
- Test: `tests/unit/lib/prices/trading-days.test.ts`, `tests/unit/lib/prices/refresh.test.ts`, `tests/unit/lib/investments/plaid-investment-sync.test.ts` (add one case)

**Interfaces:**
- Consumes: Task 1 types (`HistorySource`, `PriceProviderError`, `DailyHistory`, `PriceProvider`, `PriceEvent`, `SymbolMatch`); `Clock`, `systemClock`, `fixedClock` (Task 1); `utcDay`, `isoDay`, `addDays`.
- Produces:
  - `lastCompletedTradingDay(now: Date, market: 'exchange' | 'crypto'): Date` (pure function)
  - `type Sleeper = (ms: number) => Promise<void>`
  - `class PriceRefresher { constructor(prisma: PrismaClient, provider: HistorySource, clock?: Clock, sleep?: Sleeper); refresh(opts?: { securityIds?: string[] }): Promise<PriceRefreshResult>; latestStoredClose(securityId: string): Promise<Date | null> }` — `securityIds` limits the run to those (feed-priced) securities even if nothing references them yet; `latestStoredClose` is the date of the latest `yahoo` close (Task 7 adds `pricesAsOf()` on top of it)
  - `type PriceRefreshResult = { fetched: number; upToDate: number; unknownSymbols: string[]; stopped: boolean; error: string | null }`
  - `SYMBOL_GAP_MS = 500`, `RETRY_DELAY_MS = 3000`
  - Test helpers (`tests/helpers/investments.ts`): `day(iso)`, `seedInvestmentAccount(prisma, over?)`, `seedSecurity(prisma, over?)`, `seedSnapshot(prisma, data)`, `seedPrice(prisma, securityId, date, close, source?)`, `seedBalance(prisma, accountId, date, balance, source?)`, `seedTrade(prisma, data)`, `fakeProvider(opts?)`, `noSleep`

- [ ] **Step 1: Create the shared test helpers**

`tests/helpers/investments.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { vi } from 'vitest';
import { createAccountData } from './factories';
import { isoDay, utcDay } from '@/lib/investments/dates';
import {
  PriceProviderError,
  type PriceEvent,
  type PriceProvider,
  type SymbolMatch,
} from '@/lib/prices/types';

export const day = (iso: string) => utcDay(iso);

/** Sleeper for services under test: never waits. */
export const noSleep = async (_ms: number) => {};

export function seedInvestmentAccount(
  prisma: PrismaClient,
  over: { balanceSource?: string; currency?: string; type?: string; name?: string } = {}
) {
  return prisma.account.create({
    data: {
      ...createAccountData({
        type: over.type ?? 'brokerage',
        currency: over.currency ?? 'USD',
        name: over.name ?? 'Test Investments',
      }),
      trackingMode: 'investment',
      balanceSource: over.balanceSource ?? 'provider',
    },
  });
}

export function seedSecurity(
  prisma: PrismaClient,
  over: {
    name?: string;
    type?: string;
    currency?: string;
    priceSymbol?: string | null;
    pricing?: string;
    fixedPrice?: number | null;
  } = {}
) {
  const priceSymbol = over.priceSymbol === undefined ? 'TFND' : over.priceSymbol;
  return prisma.security.create({
    data: {
      name: over.name ?? 'Test Fund',
      ticker: priceSymbol,
      type: over.type ?? 'etf',
      currency: over.currency ?? 'USD',
      priceSymbol,
      pricing: over.pricing ?? 'feed',
      fixedPrice: over.fixedPrice ?? null,
    },
  });
}

export function seedSnapshot(
  prisma: PrismaClient,
  data: {
    accountId: string;
    securityId: string;
    date: string;
    quantity: number;
    price: number;
    source?: string;
  }
) {
  return prisma.holdingSnapshot.create({
    data: {
      accountId: data.accountId,
      securityId: data.securityId,
      date: day(data.date),
      quantity: data.quantity,
      price: data.price,
      value: data.quantity * data.price,
      source: data.source ?? 'plaid',
    },
  });
}

export function seedPrice(
  prisma: PrismaClient,
  securityId: string,
  date: string,
  close: number,
  source = 'yahoo'
) {
  return prisma.securityPrice.create({ data: { securityId, date: day(date), close, source } });
}

export function seedBalance(
  prisma: PrismaClient,
  accountId: string,
  date: string,
  balance: number,
  source = 'plaid'
) {
  return prisma.accountBalance.create({
    data: { accountId, date: day(date), balance, currency: 'USD', source },
  });
}

export function seedTrade(
  prisma: PrismaClient,
  data: {
    accountId: string;
    securityId?: string | null;
    date: string;
    type: string;
    quantity?: number | null;
    amount: number;
    isCancelled?: boolean;
  }
) {
  return prisma.investmentTransaction.create({
    data: {
      accountId: data.accountId,
      securityId: data.securityId ?? null,
      date: day(data.date),
      type: data.type,
      subtype: data.type,
      name: `Test ${data.type}`,
      quantity: data.quantity ?? null,
      amount: data.amount,
      currency: 'USD',
      source: 'plaid',
      isCancelled: data.isCancelled ?? false,
    },
  });
}

/**
 * In-memory PriceProvider. `closes[symbol][YYYY-MM-DD]` are the bars it knows; `errors[symbol]`
 * is a queue of errors thrown before it starts answering; `calls` records history requests.
 */
export function fakeProvider(
  opts: {
    closes?: Record<string, Record<string, number>>;
    events?: Record<string, PriceEvent[]>;
    errors?: Record<string, PriceProviderError[]>;
    currencies?: Record<string, string>;
    search?: Record<string, SymbolMatch[]>;
  } = {}
) {
  const calls: { symbol: string; from: string; to: string }[] = [];
  const errors = Object.fromEntries(
    Object.entries(opts.errors ?? {}).map(([symbol, list]) => [symbol, [...list]])
  );
  const provider: PriceProvider = {
    getDailyHistory: vi.fn(async (symbol: string, from: Date, to: Date) => {
      calls.push({ symbol, from: isoDay(from), to: isoDay(to) });
      const queued = errors[symbol]?.shift();
      if (queued) throw queued;
      const inRange = (d: string) => d >= isoDay(from) && d <= isoDay(to);
      return {
        closes: Object.entries(opts.closes?.[symbol] ?? {})
          .filter(([d]) => inRange(d))
          .map(([d, close]) => ({ date: day(d), close })),
        events: (opts.events?.[symbol] ?? []).filter((e) => inRange(isoDay(e.date))),
      };
    }),
    getQuote: vi.fn(async (symbol: string) => {
      const bars = opts.closes?.[symbol];
      if (!bars) throw new PriceProviderError('unknown_symbol', `Unknown symbol ${symbol}`);
      const last = Object.keys(bars).sort().at(-1)!;
      return {
        symbol,
        price: bars[last],
        currency: opts.currencies?.[symbol] ?? 'USD',
        asOf: day(last),
      };
    }),
    search: vi.fn(async (query: string) => opts.search?.[query] ?? []),
  };
  return { provider, calls };
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/lib/prices/trading-days.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { lastCompletedTradingDay } from '@/lib/prices/trading-days';
import { isoDay } from '@/lib/investments/dates';

const at = (iso: string, market: 'exchange' | 'crypto' = 'exchange') =>
  isoDay(lastCompletedTradingDay(new Date(iso), market));

describe('lastCompletedTradingDay', () => {
  it('is today once the US close has settled on a weekday', () => {
    expect(at('2026-10-09T22:00:00Z')).toBe('2026-10-09'); // Friday
  });
  it('is the previous weekday before the close', () => {
    expect(at('2026-10-09T15:00:00Z')).toBe('2026-10-08');
  });
  it('is Friday on a weekend', () => {
    expect(at('2026-10-10T12:00:00Z')).toBe('2026-10-09');
  });
  it('is Friday on Monday morning', () => {
    expect(at('2026-10-12T10:00:00Z')).toBe('2026-10-09');
  });
  it('is yesterday (UTC) for crypto', () => {
    expect(at('2026-10-12T10:00:00Z', 'crypto')).toBe('2026-10-11');
  });
});
```

`tests/unit/lib/prices/refresh.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  fakeProvider,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
} from '../../../helpers/investments';
import { fixedClock } from '@/lib/clock';
import { PriceRefresher, RETRY_DELAY_MS, SYMBOL_GAP_MS } from '@/lib/prices/refresh';
import { PriceProviderError, type HistorySource } from '@/lib/prices/types';
import { isoDay, utcDay } from '@/lib/investments/dates';

let prisma: PrismaClient;
const clock = fixedClock('2026-10-09T22:00:00Z'); // Friday, after the close
const sleep = vi.fn(async (_ms: number) => {});
const refresher = (provider: HistorySource) => new PriceRefresher(prisma, provider, clock, sleep);

async function held(symbol: string, opts: { type?: string; pricing?: string } = {}) {
  const account = await seedInvestmentAccount(prisma);
  const security = await seedSecurity(prisma, { priceSymbol: symbol, ...opts });
  await seedSnapshot(prisma, {
    accountId: account.id,
    securityId: security.id,
    date: '2026-10-01',
    quantity: 1,
    price: 100,
  });
  return { account, security };
}

const yahooRows = async (securityId: string) =>
  (
    await prisma.securityPrice.findMany({
      where: { securityId, source: 'yahoo' },
      orderBy: { date: 'asc' },
    })
  ).map((p) => [isoDay(p.date), p.close]);

describe('PriceRefresher', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    sleep.mockClear();
  });

  it('fetches from the day after the latest stored close through the last completed trading day', async () => {
    const { security } = await held('AAA');
    await seedPrice(prisma, security.id, '2026-10-06', 100);
    const { provider, calls } = fakeProvider({
      closes: { AAA: { '2026-10-07': 101, '2026-10-08': 102, '2026-10-09': 103 } },
    });
    const r = await refresher(provider).refresh();
    expect(calls).toEqual([{ symbol: 'AAA', from: '2026-10-07', to: '2026-10-09' }]);
    expect(r).toEqual({ fetched: 1, upToDate: 0, unknownSymbols: [], stopped: false, error: null });
    expect(await yahooRows(security.id)).toEqual([
      ['2026-10-06', 100],
      ['2026-10-07', 101],
      ['2026-10-08', 102],
      ['2026-10-09', 103],
    ]);
  });

  it('skips securities already priced through the last completed trading day', async () => {
    const { security } = await held('AAA');
    await seedPrice(prisma, security.id, '2026-10-09', 100);
    const { provider, calls } = fakeProvider();
    const r = await refresher(provider).refresh();
    expect(calls).toEqual([]);
    expect(r.upToDate).toBe(1);
  });

  it('starts a first fetch at the earliest holding or transaction date', async () => {
    const { account, security } = await held('AAA');
    await seedTrade(prisma, {
      accountId: account.id,
      securityId: security.id,
      date: '2026-08-14',
      type: 'buy',
      quantity: 1,
      amount: 100,
    });
    const { provider, calls } = fakeProvider({ closes: { AAA: {} } });
    await refresher(provider).refresh();
    expect(calls[0]).toEqual({ symbol: 'AAA', from: '2026-08-14', to: '2026-10-09' });
  });

  it('ignores unreferenced and non-feed securities', async () => {
    await seedSecurity(prisma, { priceSymbol: 'ZZZ' });
    await held('PLN', { pricing: 'plaid' });
    await held('AAA');
    const { provider, calls } = fakeProvider({ closes: { AAA: {} } });
    await refresher(provider).refresh();
    expect(calls.map((c) => c.symbol)).toEqual(['AAA']);
  });

  it('uses the previous UTC day as the last completed day for crypto', async () => {
    const { security } = await held('BTC-USD', { type: 'crypto' });
    await seedPrice(prisma, security.id, '2026-10-07', 60000);
    const { provider, calls } = fakeProvider({ closes: { 'BTC-USD': {} } });
    await refresher(provider).refresh();
    expect(calls).toEqual([{ symbol: 'BTC-USD', from: '2026-10-08', to: '2026-10-08' }]);
  });

  it('marks an unknown symbol as unpriced and continues', async () => {
    const { security: a } = await held('AAA');
    await held('BBB');
    const { provider } = fakeProvider({
      closes: { BBB: { '2026-10-09': 50 } },
      errors: { AAA: [new PriceProviderError('unknown_symbol', 'Not Found')] },
    });
    const r = await refresher(provider).refresh();
    expect(r).toMatchObject({ fetched: 1, unknownSymbols: ['AAA'], stopped: false });
    expect((await prisma.security.findUniqueOrThrow({ where: { id: a.id } })).pricing).toBe(
      'none'
    );
  });

  it('retries once after a rate limit', async () => {
    await held('AAA');
    const { provider, calls } = fakeProvider({
      closes: { AAA: { '2026-10-09': 10 } },
      errors: { AAA: [new PriceProviderError('rate_limited', 'Too Many Requests')] },
    });
    const r = await refresher(provider).refresh();
    expect(r).toMatchObject({ fetched: 1, stopped: false });
    expect(calls).toHaveLength(2);
    expect(sleep).toHaveBeenCalledWith(RETRY_DELAY_MS);
  });

  it('stops the run after a second failure and keeps prices already saved', async () => {
    const { security: a } = await held('AAA');
    await held('BBB');
    await held('CCC');
    const failure = () => new PriceProviderError('network', 'fetch failed');
    const { provider, calls } = fakeProvider({
      closes: { AAA: { '2026-10-09': 10 }, CCC: { '2026-10-09': 30 } },
      errors: { BBB: [failure(), failure()] },
    });
    const r = await refresher(provider).refresh();
    expect(r.stopped).toBe(true);
    expect(r.error).toContain('BBB');
    expect(calls.map((c) => c.symbol)).toEqual(['AAA', 'BBB', 'BBB']);
    expect(await yahooRows(a.id)).toEqual([['2026-10-09', 10]]);
  });

  it('resumes on the next run without refetching stored days', async () => {
    await held('AAA');
    await held('BBB');
    const failure = () => new PriceProviderError('network', 'fetch failed');
    const first = fakeProvider({
      closes: { AAA: { '2026-10-09': 10 } },
      errors: { BBB: [failure(), failure()] },
    });
    await refresher(first.provider).refresh();
    const second = fakeProvider({ closes: { BBB: { '2026-10-09': 20 } } });
    const r = await refresher(second.provider).refresh();
    expect(second.calls.map((c) => c.symbol)).toEqual(['BBB']);
    expect(r).toMatchObject({ fetched: 1, upToDate: 1, stopped: false });
  });

  it('waits between symbols', async () => {
    await held('AAA');
    await held('BBB');
    const { provider } = fakeProvider({ closes: { AAA: {}, BBB: {} } });
    await refresher(provider).refresh();
    expect(sleep.mock.calls).toEqual([[SYMBOL_GAP_MS]]);
  });

  it('stores dividend and split events', async () => {
    const { security } = await held('AAA');
    const { provider } = fakeProvider({
      closes: { AAA: {} },
      events: {
        AAA: [
          { date: utcDay('2026-10-02'), type: 'dividend', amount: 0.5, ratio: null },
          { date: utcDay('2026-10-05'), type: 'split', amount: null, ratio: 2 },
        ],
      },
    });
    await refresher(provider).refresh();
    const events = await prisma.securityEvent.findMany({
      where: { securityId: security.id },
      orderBy: { date: 'asc' },
    });
    expect(events.map((e) => [e.type, e.amount, e.ratio, e.source])).toEqual([
      ['dividend', 0.5, null, 'yahoo'],
      ['split', null, 2, 'yahoo'],
    ]);
  });

  it('with securityIds, prices only those, including unreferenced ones (30-day lookback)', async () => {
    await held('AAA');
    const fresh = await seedSecurity(prisma, { priceSymbol: 'NEW' });
    const { provider, calls } = fakeProvider({ closes: { NEW: {} } });
    await refresher(provider).refresh({ securityIds: [fresh.id] });
    expect(calls).toEqual([{ symbol: 'NEW', from: '2026-09-09', to: '2026-10-09' }]);
  });
});
```

Add to `tests/unit/lib/investments/plaid-investment-sync.test.ts`, inside `describe('syncPlaidInvestments')`:

```ts
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices tests/unit/lib/investments/plaid-investment-sync.test.ts`
Expected: FAIL — `@/lib/prices/trading-days` and `@/lib/prices/refresh` are missing; the new sync case fails with `pricing: 'feed'`.

- [ ] **Step 4: Implement**

`src/lib/prices/trading-days.ts`:

```ts
import { addDays, utcDay } from '@/lib/investments/dates';

// 16:00 ET is 20:00 UTC (EDT) or 21:00 UTC (EST); 21:30 covers both plus time for Yahoo to publish.
const SETTLED_UTC_MINUTES = 21 * 60 + 30;

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/**
 * The latest UTC day whose daily close is final. Exchange holidays are not modelled: asking for a
 * holiday returns no bar, nothing is stored, and the next run asks again (one cheap call).
 */
export function lastCompletedTradingDay(now: Date, market: 'exchange' | 'crypto'): Date {
  const today = utcDay(now);
  if (market === 'crypto') return addDays(today, -1);
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (!isWeekend(today) && minutes >= SETTLED_UTC_MINUTES) return today;
  let d = addDays(today, -1);
  while (isWeekend(d)) d = addDays(d, -1);
  return d;
}
```

`src/lib/prices/refresh.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { addDays, utcDay } from '@/lib/investments/dates';
import { lastCompletedTradingDay } from './trading-days';
import { PriceProviderError, type DailyHistory, type HistorySource } from './types';

export const SYMBOL_GAP_MS = 500;
export const RETRY_DELAY_MS = 3000;
const FIRST_FETCH_LOOKBACK_DAYS = 30;

export type Sleeper = (ms: number) => Promise<void>;

export type PriceRefreshResult = {
  fetched: number;
  upToDate: number;
  unknownSymbols: string[];
  stopped: boolean;
  error: string | null;
};

const defaultSleep: Sleeper = (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Brings stored daily closes up to the last completed trading day, one provider call per stale
 * symbol, sequentially. A second consecutive failure stops the run; saved prices are kept.
 */
export class PriceRefresher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: HistorySource,
    private readonly clock: Clock = systemClock,
    private readonly sleep: Sleeper = defaultSleep
  ) {}

  /** `securityIds`: only these (feed-priced) securities, even if nothing references them yet. */
  async refresh(opts: { securityIds?: string[] } = {}): Promise<PriceRefreshResult> {
    const now = this.clock.now();
    const today = utcDay(now);
    const result: PriceRefreshResult = {
      fetched: 0,
      upToDate: 0,
      unknownSymbols: [],
      stopped: false,
      error: null,
    };

    const securities = await this.prisma.security.findMany({
      where: {
        pricing: 'feed',
        priceSymbol: { not: null },
        ...(opts.securityIds
          ? { id: { in: opts.securityIds } }
          : { OR: [{ holdings: { some: {} } }, { transactions: { some: {} } }] }),
      },
      orderBy: { priceSymbol: 'asc' },
    });

    let calls = 0;
    for (const security of securities) {
      const symbol = security.priceSymbol!;
      const market = security.type === 'crypto' ? 'crypto' : 'exchange';
      const target = lastCompletedTradingDay(now, market);
      const latest = await this.latestStoredClose(security.id);
      const from = latest ? addDays(latest, 1) : await this.firstNeededDay(security.id, today);
      if (from > target) {
        result.upToDate++;
        continue;
      }

      if (calls++ > 0) await this.sleep(SYMBOL_GAP_MS);
      let history: DailyHistory;
      try {
        history = await this.fetchWithRetry(symbol, from, target);
      } catch (error) {
        if (error instanceof PriceProviderError && error.kind === 'unknown_symbol') {
          await this.prisma.security.update({
            where: { id: security.id },
            data: { pricing: 'none' },
          });
          result.unknownSymbols.push(symbol);
          continue;
        }
        result.stopped = true;
        result.error = `${symbol}: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[prices] stopping price refresh: ${result.error}`);
        break;
      }
      await this.storeHistory(security.id, history);
      result.fetched++;
    }

    return result;
  }

  async latestStoredClose(securityId: string): Promise<Date | null> {
    const row = await this.prisma.securityPrice.findFirst({
      where: { securityId, source: 'yahoo' },
      orderBy: { date: 'desc' },
      select: { date: true },
    });
    return row?.date ?? null;
  }

  /** First day a never-priced security needs: its earliest holding or trade, else a short lookback. */
  private async firstNeededDay(securityId: string, today: Date): Promise<Date> {
    const [snapshot, trade] = await Promise.all([
      this.prisma.holdingSnapshot.findFirst({
        where: { securityId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.investmentTransaction.findFirst({
        where: { securityId },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const dates = [snapshot?.date, trade?.date].filter((d): d is Date => d != null);
    if (!dates.length) return addDays(today, -FIRST_FETCH_LOOKBACK_DAYS);
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  }

  private async fetchWithRetry(symbol: string, from: Date, to: Date): Promise<DailyHistory> {
    try {
      return await this.provider.getDailyHistory(symbol, from, to);
    } catch (error) {
      if (error instanceof PriceProviderError && error.kind === 'unknown_symbol') throw error;
      await this.sleep(RETRY_DELAY_MS);
      return this.provider.getDailyHistory(symbol, from, to);
    }
  }

  private async storeHistory(securityId: string, history: DailyHistory): Promise<void> {
    const prisma = this.prisma;
    await prisma.$transaction([
      ...history.closes.map((c) =>
        prisma.securityPrice.upsert({
          where: { securityId_date_source: { securityId, date: c.date, source: 'yahoo' } },
          create: { securityId, date: c.date, close: c.close, source: 'yahoo' },
          update: { close: c.close },
        })
      ),
      ...history.events.map((e) =>
        prisma.securityEvent.upsert({
          where: { securityId_date_type: { securityId, date: e.date, type: e.type } },
          create: {
            securityId,
            date: e.date,
            type: e.type,
            amount: e.amount,
            ratio: e.ratio,
            source: 'yahoo',
          },
          update: { amount: e.amount, ratio: e.ratio },
        })
      ),
    ]);
  }
}
```

In `src/lib/investments/plaid-investment-sync.ts` `upsertSecurities`, replace the `pricingFields` lines:

```ts
      // Never clobber a user-set price symbol; pricing follows the symbol. A symbol the price
      // feed rejected stays unpriced until Plaid reports a different one.
      const keepUnpriced = existing.pricing === 'none' && existing.priceSymbol === m.priceSymbol;
      const pricingFields =
        existing.priceSymbolOverride || keepUnpriced
          ? {}
          : { priceSymbol: m.priceSymbol, pricing: m.pricing, fixedPrice: m.fixedPrice };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices tests/unit/lib/investments && npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add tests/helpers/investments.ts src/lib/prices/trading-days.ts src/lib/prices/refresh.ts src/lib/investments/plaid-investment-sync.ts tests/unit/lib/prices/trading-days.test.ts tests/unit/lib/prices/refresh.test.ts tests/unit/lib/investments/plaid-investment-sync.test.ts
git commit -m "feat(prices): throttled price refresh with retry-then-stop and unknown-symbol marking"
```

---

### Task 3: Pricing strategies and the price book

**Files:**
- Create: `src/lib/prices/pricing.ts`, `src/lib/prices/price-book.ts`
- Test: `tests/unit/lib/prices/pricing.test.ts`, `tests/unit/lib/prices/price-book.test.ts`

**Interfaces:**
- Consumes: `parseExchangeRates` from `src/lib/currency.ts`; Task 2 test helpers.
- Produces:
  - `type PricePoint = { date: Date; close: number; source: string }`
  - `type PricedAt = { price: number; estimated: boolean }`
  - `interface PricingStrategy { priceOn(points: PricePoint[] /* date asc */, date: Date): PricedAt | null }`
  - Classes implementing it, one per mode: `FixedPricing(fixedPrice: number | null)`, `FeedPricing`, `PlaidPricing`, `ManualPricing`, `UnpricedPricing`
  - `pricingFor(security: { pricing: string; fixedPrice: number | null }): PricingStrategy` — the single place that maps the `pricing` string to a strategy; an unknown value maps to `UnpricedPricing`
  - `class PriceBook { static load(prisma, securityIds: string[], to: Date): Promise<PriceBook>; at(securityId: string, date: Date): PricedAt | null }` — holds each security's strategy and its price points up to `to`; `at` returns null for a security it didn't load
  - `loadFxRates(prisma): Promise<Map<string, number>>` in `price-book.ts` (keys `FROM_TO`, as `convertAmount` expects)

Pricing rules, which Tasks 5 and 6 rely on:

| `pricing` | Strategy | Price on day D |
|---|---|---|
| `fixed` | `FixedPricing` | `fixedPrice ?? 1`, exact |
| `feed` | `FeedPricing` | latest `yahoo` close ≤ D, exact (weekends carry Friday's close); if none ≤ D, fall back to the `plaid` rule (composes `PlaidPricing`) |
| `plaid` | `PlaidPricing` | `plaid` point on D exact; between two points linear interpolation (estimated); after the last point carry it (estimated); before the first point `null` |
| `manual` | `ManualPricing` | latest `manual` point ≤ D, exact |
| `none` (or unknown) | `UnpricedPricing` | latest point of any source ≤ D, estimated |

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/prices/pricing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { day } from '../../../helpers/investments';
import { pricingFor, UnpricedPricing, type PricePoint } from '@/lib/prices/pricing';

const p = (date: string, close: number, source: string): PricePoint => ({
  date: day(date),
  close,
  source,
});

describe('pricing strategies', () => {
  const feed = pricingFor({ pricing: 'feed', fixedPrice: null });
  const plaid = pricingFor({ pricing: 'plaid', fixedPrice: null });

  it('fixed pricing ignores points', () => {
    expect(pricingFor({ pricing: 'fixed', fixedPrice: null }).priceOn([], day('2026-10-01'))).toEqual(
      { price: 1, estimated: false }
    );
  });

  it('feed carries the latest close forward over weekends', () => {
    const pts = [p('2026-10-02', 10, 'yahoo')];
    expect(feed.priceOn(pts, day('2026-10-04'))).toEqual({ price: 10, estimated: false });
  });

  it('feed falls back to Plaid prices before its first close', () => {
    const pts = [p('2026-09-01', 8, 'plaid'), p('2026-10-02', 10, 'yahoo')];
    expect(feed.priceOn(pts, day('2026-09-15'))).toEqual({ price: 8, estimated: true });
  });

  it('plaid pricing interpolates between reported prices', () => {
    const pts = [p('2026-10-01', 10, 'plaid'), p('2026-10-11', 12, 'plaid')];
    expect(plaid.priceOn(pts, day('2026-10-06'))).toEqual({ price: 11, estimated: true });
    expect(plaid.priceOn(pts, day('2026-10-11'))).toEqual({ price: 12, estimated: false });
    expect(plaid.priceOn(pts, day('2026-10-20'))).toEqual({ price: 12, estimated: true });
    expect(plaid.priceOn(pts, day('2026-09-30'))).toBeNull();
  });

  it('manual pricing carries the latest manual price', () => {
    const pts = [p('2026-10-01', 5, 'manual'), p('2026-10-03', 9, 'yahoo')];
    expect(
      pricingFor({ pricing: 'manual', fixedPrice: null }).priceOn(pts, day('2026-10-05'))
    ).toEqual({ price: 5, estimated: false });
  });

  it('unpriced securities use the latest known price, estimated', () => {
    const pts = [p('2026-10-01', 7, 'plaid')];
    expect(
      pricingFor({ pricing: 'none', fixedPrice: null }).priceOn(pts, day('2026-10-05'))
    ).toEqual({ price: 7, estimated: true });
    expect(pricingFor({ pricing: 'something-new', fixedPrice: null })).toBeInstanceOf(
      UnpricedPricing
    );
  });
});
```

`tests/unit/lib/prices/price-book.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { day, seedPrice, seedSecurity } from '../../../helpers/investments';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';

describe('PriceBook / loadFxRates', () => {
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

  it('answers from stored prices up to the requested day', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedPrice(prisma, s.id, '2026-10-01', 10);
    await seedPrice(prisma, s.id, '2026-10-05', 12);
    const book = await PriceBook.load(prisma, [s.id], day('2026-10-02'));
    expect(book.at(s.id, day('2026-10-09'))).toEqual({ price: 10, estimated: false });
    expect(book.at('missing', day('2026-10-09'))).toBeNull();
  });

  it('loads exchange rates keyed FROM_TO', async () => {
    await prisma.exchangeRate.create({ data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 } });
    expect((await loadFxRates(prisma)).get('CAD_USD')).toBe(0.75);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/price-book.test.ts`
Expected: FAIL — cannot resolve `@/lib/prices/pricing` / `@/lib/prices/price-book`.

- [ ] **Step 3: Implement**

`src/lib/prices/pricing.ts`:

```ts
export type PricePoint = { date: Date; close: number; source: string };
export type PricedAt = { price: number; estimated: boolean };

/** How one pricing mode prices a security on a UTC day (rules table in Plan 2, Task 3). */
export interface PricingStrategy {
  /** `points` are the security's stored prices, date ascending. */
  priceOn(points: PricePoint[], date: Date): PricedAt | null;
}

const fromSource = (points: PricePoint[], source: string) =>
  points.filter((p) => p.source === source);

function carryForward(points: PricePoint[], t: number, estimated: boolean): PricedAt | null {
  let found: PricePoint | null = null;
  for (const p of points) {
    if (p.date.getTime() > t) break;
    found = p;
  }
  return found ? { price: found.close, estimated } : null;
}

function interpolate(points: PricePoint[], t: number): PricedAt | null {
  let before: PricePoint | null = null;
  let after: PricePoint | null = null;
  for (const p of points) {
    if (p.date.getTime() <= t) before = p;
    else {
      after = p;
      break;
    }
  }
  if (!before) return null;
  if (before.date.getTime() === t) return { price: before.close, estimated: false };
  if (!after) return { price: before.close, estimated: true };
  const span = after.date.getTime() - before.date.getTime();
  const f = (t - before.date.getTime()) / span;
  return { price: before.close + f * (after.close - before.close), estimated: true };
}

export class FixedPricing implements PricingStrategy {
  constructor(private readonly fixedPrice: number | null) {}

  priceOn(): PricedAt {
    return { price: this.fixedPrice ?? 1, estimated: false };
  }
}

export class PlaidPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return interpolate(fromSource(points, 'plaid'), date.getTime());
  }
}

export class FeedPricing implements PricingStrategy {
  private readonly fallback = new PlaidPricing();

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return (
      carryForward(fromSource(points, 'yahoo'), date.getTime(), false) ??
      this.fallback.priceOn(points, date)
    );
  }
}

export class ManualPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(fromSource(points, 'manual'), date.getTime(), false);
  }
}

export class UnpricedPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(points, date.getTime(), true);
  }
}

const STRATEGIES = new Map<string, (fixedPrice: number | null) => PricingStrategy>([
  ['fixed', (fixedPrice) => new FixedPricing(fixedPrice)],
  ['feed', () => new FeedPricing()],
  ['plaid', () => new PlaidPricing()],
  ['manual', () => new ManualPricing()],
  ['none', () => new UnpricedPricing()],
]);

/** The one place a `Security.pricing` value becomes behaviour. Unknown values price as unpriced. */
export function pricingFor(security: { pricing: string; fixedPrice: number | null }): PricingStrategy {
  const create = STRATEGIES.get(security.pricing);
  return create ? create(security.fixedPrice) : new UnpricedPricing();
}
```

`src/lib/prices/price-book.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { parseExchangeRates } from '@/lib/currency';
import { pricingFor, type PricedAt, type PricePoint, type PricingStrategy } from './pricing';

type Entry = { strategy: PricingStrategy; points: PricePoint[] };

/** Prices for a set of securities, loaded once, answering "price of X on day D". */
export class PriceBook {
  private constructor(private readonly entries: Map<string, Entry>) {}

  static async load(prisma: PrismaClient, securityIds: string[], to: Date): Promise<PriceBook> {
    const ids = [...new Set(securityIds)];
    const [securities, rows] = await Promise.all([
      prisma.security.findMany({
        where: { id: { in: ids } },
        select: { id: true, pricing: true, fixedPrice: true },
      }),
      prisma.securityPrice.findMany({
        where: { securityId: { in: ids }, date: { lte: to } },
        orderBy: { date: 'asc' },
        select: { securityId: true, date: true, close: true, source: true },
      }),
    ]);
    const entries = new Map<string, Entry>(
      securities.map((s) => [s.id, { strategy: pricingFor(s), points: [] }])
    );
    for (const r of rows) entries.get(r.securityId)?.points.push(r);
    return new PriceBook(entries);
  }

  at(securityId: string, date: Date): PricedAt | null {
    const entry = this.entries.get(securityId);
    return entry ? entry.strategy.priceOn(entry.points, date) : null;
  }
}

export async function loadFxRates(prisma: PrismaClient): Promise<Map<string, number>> {
  return parseExchangeRates(await prisma.exchangeRate.findMany());
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/price-book.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/prices/pricing.ts src/lib/prices/price-book.ts tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/price-book.test.ts
git commit -m "feat(prices): pricing strategies and a price book resolving a security's price on any day"
```

---

### Task 4: Manual accounts — balance entries and the single holding

**Files:**
- Create: `src/lib/investments/account-guard.ts`, `src/lib/investments/manual-holding.ts`
- Modify: `src/app/api/transactions/adjustment/route.ts` (investment branch, ~lines 28-43)
- Test: `tests/unit/lib/investments/manual-holding.test.ts`, `tests/integration/api/investment-adjustment.test.ts` (add cases)

**Interfaces:**
- Consumes: `Clock`, `systemClock`, `fixedClock` (Task 1); `utcDay`; `getAccountBalance` from `src/lib/balances.ts`; Task 2 helpers.
- Produces:
  - `class InvestmentInputError extends Error { status: 400 | 404 }`
  - `requireInvestmentAccount(prisma, accountId, balanceSource: 'valuation' | 'manual'): Promise<Account>` (404 if missing, 400 if not that kind of investment account) — stateless, stays a function
  - `manualHoldingSecurityId(accountId: string): string` → `manual-holding-<accountId>` (pure)
  - `class ManualHoldingService { constructor(prisma: PrismaClient, clock?: Clock) }` with:
    - `record(accountId, input: { date: string | Date; balance: number }): Promise<AccountBalance>` (rejects dates after the clock's today)
    - `delete(accountId, balanceId): Promise<void>`
    - `list(accountId): Promise<AccountBalance[]>` (date desc)
    - `sync(accountId): Promise<boolean>` (true when it rewrote rows)
    - `syncAll(): Promise<number>` (accounts rewritten; used once by Task 10 to backfill migrated entries)
    - `removalOps(accountId): Prisma.PrismaPromise<unknown>[]` — operations that delete the mirror (snapshots, prices, synthetic security), for a caller's `$transaction` (Task 5)

The single holding: the account's snapshots are exactly one `HoldingSnapshot` per manual `AccountBalance` row (quantity 1, price = value = balance, `source: 'manual'`) on the security `manual-holding-<accountId>` (`type: 'other'`, `pricing: 'manual'`, named after the account), plus a matching `SecurityPrice` (`source: 'manual'`) per row. `sync` rebuilds this mirror only when it differs, so read-triggered refreshes don't write.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/investments/manual-holding.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { day, seedBalance, seedInvestmentAccount } from '../../../helpers/investments';
import { fixedClock } from '@/lib/clock';
import { ManualHoldingService, manualHoldingSecurityId } from '@/lib/investments/manual-holding';
import { isoDay } from '@/lib/investments/dates';

let prisma: PrismaClient;
let manual: ManualHoldingService;

const snapshots = async (accountId: string) =>
  (
    await prisma.holdingSnapshot.findMany({ where: { accountId }, orderBy: { date: 'asc' } })
  ).map((s) => [isoDay(s.date), s.securityId, s.quantity, s.value, s.source]);

describe('ManualHoldingService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
    manual = new ManualHoldingService(prisma, fixedClock('2026-10-09T15:00:00Z'));
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('records a balance and mirrors it as the single holding', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual', currency: 'CAD' });
    const row = await manual.record(a.id, { date: '2026-10-01', balance: 5000 });
    expect(row).toMatchObject({ balance: 5000, currency: 'CAD', source: 'manual' });
    const sid = manualHoldingSecurityId(a.id);
    expect(await snapshots(a.id)).toEqual([['2026-10-01', sid, 1, 5000, 'manual']]);
    expect(await prisma.security.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({
      type: 'other',
      pricing: 'manual',
      currency: 'CAD',
    });
    expect(await prisma.securityPrice.count({ where: { securityId: sid, source: 'manual' } })).toBe(
      1
    );
  });

  it('recording the same day again overwrites it', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await manual.record(a.id, { date: '2026-10-01', balance: 1 });
    await manual.record(a.id, { date: '2026-10-01', balance: 2 });
    expect(await prisma.accountBalance.count({ where: { accountId: a.id } })).toBe(1);
    expect((await snapshots(a.id)).map((s) => s[3])).toEqual([2]);
  });

  it('rejects future dates, non-numbers and non-manual accounts', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await expect(manual.record(a.id, { date: '2026-10-10', balance: 1 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(manual.record(a.id, { date: '2026-10-01', balance: NaN })).rejects.toMatchObject({
      status: 400,
    });
    const p = await seedInvestmentAccount(prisma, { balanceSource: 'provider' });
    await expect(manual.record(p.id, { date: '2026-10-01', balance: 1 })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      manual.record('missing', { date: '2026-10-01', balance: 1 })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('deletes an entry and its holding row', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    const first = await manual.record(a.id, { date: '2026-10-01', balance: 1 });
    await manual.record(a.id, { date: '2026-10-05', balance: 2 });
    await manual.delete(a.id, first.id);
    expect((await manual.list(a.id)).map((b) => isoDay(b.date))).toEqual(['2026-10-05']);
    expect((await snapshots(a.id)).map((s) => s[0])).toEqual(['2026-10-05']);
    await expect(manual.delete(a.id, first.id)).rejects.toMatchObject({ status: 404 });
  });

  it('backfills migrated entries and is a no-op when already in sync', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await seedBalance(prisma, a.id, '2026-01-27', 100, 'manual');
    await seedBalance(prisma, a.id, '2026-07-12', 150, 'manual');
    expect(await manual.sync(a.id)).toBe(true);
    expect((await snapshots(a.id)).map((s) => [s[0], s[3]])).toEqual([
      ['2026-01-27', 100],
      ['2026-07-12', 150],
    ]);
    expect(await manual.sync(a.id)).toBe(false);
  });

  it('syncAll touches manual accounts only', async () => {
    const m = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    const p = await seedInvestmentAccount(prisma, { balanceSource: 'provider' });
    await seedBalance(prisma, m.id, '2026-10-01', 10, 'manual');
    await seedBalance(prisma, p.id, '2026-10-01', 10, 'manual');
    expect(await manual.syncAll()).toBe(1);
    expect(await prisma.holdingSnapshot.count({ where: { accountId: p.id } })).toBe(0);
    expect(day('2026-10-01')).toEqual(
      (await prisma.holdingSnapshot.findFirstOrThrow({ where: { accountId: m.id } })).date
    );
  });
});
```

Add to `tests/integration/api/investment-adjustment.test.ts`, inside its `describe` (reuse its existing imports and request helper; if the file builds requests inline, follow that pattern):

```ts
  it('mirrors a manual reconciliation into the single holding', async () => {
    const account = await testPrisma.account.create({
      data: {
        ...createAccountData({ type: 'retirement' }),
        trackingMode: 'investment',
        balanceSource: 'manual',
      },
    });
    // POST { accountId: account.id, amount: 250 } to the adjustment route as the other cases do
    expect(await testPrisma.holdingSnapshot.count({ where: { accountId: account.id } })).toBe(1);
  });

  it('rejects reconciling a Plaid-synced or valued investment account', async () => {
    for (const balanceSource of ['provider', 'valuation']) {
      const account = await testPrisma.account.create({
        data: {
          ...createAccountData({ type: 'brokerage' }),
          trackingMode: 'investment',
          balanceSource,
        },
      });
      // POST { accountId: account.id, amount: 10 } → expect status 400
      expect(await testPrisma.accountBalance.count({ where: { accountId: account.id } })).toBe(0);
    }
  });
```

Replace the two `// POST …` comments with the file's actual request call and a `expect(res.status)` assertion (400 for the second case).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/manual-holding.test.ts tests/integration/api/investment-adjustment.test.ts`
Expected: FAIL — `@/lib/investments/manual-holding` is missing; the new adjustment cases fail.

- [ ] **Step 3: Implement**

`src/lib/investments/account-guard.ts`:

```ts
import type { Account, PrismaClient } from '@prisma/client';

export class InvestmentInputError extends Error {
  readonly status: 400 | 404;

  constructor(message: string, status: 400 | 404 = 400) {
    super(message);
    this.name = 'InvestmentInputError';
    this.status = status;
  }
}

export async function requireInvestmentAccount(
  prisma: PrismaClient,
  accountId: string,
  balanceSource: 'valuation' | 'manual'
): Promise<Account> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account) throw new InvestmentInputError('Account not found', 404);
  if (account.trackingMode !== 'investment' || account.balanceSource !== balanceSource) {
    throw new InvestmentInputError(`Account is not a ${balanceSource} investment account`);
  }
  return account;
}
```

`src/lib/investments/manual-holding.ts`:

```ts
import type { AccountBalance, Prisma, PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { InvestmentInputError, requireInvestmentAccount } from './account-guard';
import { utcDay } from './dates';

export const manualHoldingSecurityId = (accountId: string) => `manual-holding-${accountId}`;

/** Manual investment accounts: dated balance entries, mirrored as one synthetic holding. */
export class ManualHoldingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock = systemClock
  ) {}

  async record(
    accountId: string,
    input: { date: string | Date; balance: number }
  ): Promise<AccountBalance> {
    const account = await requireInvestmentAccount(this.prisma, accountId, 'manual');
    if (!Number.isFinite(input.balance)) throw new InvestmentInputError('Balance must be a number');
    const date = utcDay(input.date);
    if (date > utcDay(this.clock.now())) {
      throw new InvestmentInputError('Balance date cannot be in the future');
    }
    const row = await this.prisma.accountBalance.upsert({
      where: { accountId_date: { accountId, date } },
      create: {
        accountId,
        date,
        balance: input.balance,
        currency: account.currency,
        source: 'manual',
      },
      update: { balance: input.balance, source: 'manual' },
    });
    await this.sync(accountId);
    return row;
  }

  async delete(accountId: string, balanceId: string): Promise<void> {
    await requireInvestmentAccount(this.prisma, accountId, 'manual');
    const { count } = await this.prisma.accountBalance.deleteMany({
      where: { id: balanceId, accountId, source: 'manual' },
    });
    if (!count) throw new InvestmentInputError('Balance entry not found', 404);
    await this.sync(accountId);
  }

  async list(accountId: string): Promise<AccountBalance[]> {
    await requireInvestmentAccount(this.prisma, accountId, 'manual');
    return this.prisma.accountBalance.findMany({
      where: { accountId, source: 'manual' },
      orderBy: { date: 'desc' },
    });
  }

  /**
   * Make the account's holdings exactly one snapshot per manual balance entry, on the account's
   * synthetic security. Returns false (and writes nothing) when they already match.
   */
  async sync(accountId: string): Promise<boolean> {
    const prisma = this.prisma;
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const securityId = manualHoldingSecurityId(accountId);
    const [balances, snapshots] = await Promise.all([
      prisma.accountBalance.findMany({
        where: { accountId, source: 'manual' },
        orderBy: { date: 'asc' },
      }),
      prisma.holdingSnapshot.findMany({ where: { accountId }, orderBy: { date: 'asc' } }),
    ]);
    const inSync =
      snapshots.length === balances.length &&
      balances.every(
        (b, i) =>
          snapshots[i].securityId === securityId &&
          snapshots[i].date.getTime() === b.date.getTime() &&
          snapshots[i].value === b.balance
      );
    if (inSync) return false;

    await prisma.security.upsert({
      where: { id: securityId },
      create: {
        id: securityId,
        name: account.name,
        type: 'other',
        currency: account.currency,
        pricing: 'manual',
      },
      update: { name: account.name, currency: account.currency },
    });
    await prisma.$transaction([
      prisma.holdingSnapshot.deleteMany({ where: { accountId } }),
      prisma.securityPrice.deleteMany({ where: { securityId } }),
      ...balances.flatMap((b) => [
        prisma.holdingSnapshot.create({
          data: {
            accountId,
            securityId,
            date: b.date,
            quantity: 1,
            price: b.balance,
            value: b.balance,
            source: 'manual',
          },
        }),
        prisma.securityPrice.create({
          data: { securityId, date: b.date, close: b.balance, source: 'manual' },
        }),
      ]),
    ]);
    return true;
  }

  async syncAll(): Promise<number> {
    const accounts = await this.prisma.account.findMany({
      where: { trackingMode: 'investment', balanceSource: 'manual' },
      select: { id: true },
    });
    let changed = 0;
    for (const { id } of accounts) if (await this.sync(id)) changed++;
    return changed;
  }

  /** Operations deleting the account's manual-holding mirror; run inside the caller's `$transaction`. */
  removalOps(accountId: string): Prisma.PrismaPromise<unknown>[] {
    const securityId = manualHoldingSecurityId(accountId);
    return [
      this.prisma.holdingSnapshot.deleteMany({ where: { accountId, securityId } }),
      this.prisma.securityPrice.deleteMany({ where: { securityId } }),
      this.prisma.security.deleteMany({ where: { id: securityId } }),
    ];
  }
}
```

In `src/app/api/transactions/adjustment/route.ts`, replace the investment branch with (the composition root arrives in Task 7, so this task constructs the service directly; Task 7 switches it):

```ts
    // Investment accounts keep balances in AccountBalance, never in the transaction ledger.
    if (account.trackingMode === 'investment') {
      if (account.balanceSource !== 'manual') {
        const from = account.balanceSource === 'provider' ? 'Plaid' : 'its holdings';
        return NextResponse.json(
          { error: `This account's balance comes from ${from}` },
          { status: 400 }
        );
      }
      const { balance } = await getAccountBalance(prisma, accountId);
      const accountBalance = await new ManualHoldingService(prisma).record(accountId, {
        date: new Date(),
        balance: balance + amount,
      });
      return NextResponse.json({ accountBalance });
    }
```

Update its imports: drop `utcDay` and add `import { ManualHoldingService } from '@/lib/investments/manual-holding';`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/manual-holding.test.ts tests/integration/api/investment-adjustment.test.ts && npm run typecheck`
Expected: PASS (including the file's existing cases).

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/account-guard.ts src/lib/investments/manual-holding.ts src/app/api/transactions/adjustment/route.ts tests/unit/lib/investments/manual-holding.test.ts tests/integration/api/investment-adjustment.test.ts
git commit -m "feat(investments): manual balance entries mirrored as the account's single holding"
```

---

### Task 5: Valued accounts

**Files:**
- Create: `src/lib/investments/valuation.ts`, `src/lib/investments/money.ts`
- Modify: `src/lib/investments/dates.ts` (add `lastAtOrBefore`), `src/lib/investments/migration.ts:16` (use `roundCents`)
- Test: `tests/unit/lib/investments/valuation.test.ts`, `tests/unit/lib/investments/dates.test.ts` (add cases), `tests/unit/lib/investments/money.test.ts`

**Interfaces:**
- Consumes: `PriceBook`, `loadFxRates` (Task 3); `requireInvestmentAccount`, `InvestmentInputError`, `ManualHoldingService` (its `removalOps`; Task 4); `Clock`, `systemClock`, `fixedClock` (Task 1); `convertAmount` from `src/lib/currency.ts`.
- Produces:
  - `roundCents(n: number): number` in `src/lib/investments/money.ts` (Tasks 5 and 6, and Plan 1's `replayAdjustments`)
  - `lastAtOrBefore(sorted: number[], t: number): number | undefined` in `src/lib/investments/dates.ts`: the last value ≤ `t` in an ascending list (Tasks 5 and 6 use it to find the holdings set in effect on a day)
  - `type HoldingInput = { securityId: string; quantity: number }`
  - `class ValuationService { constructor(prisma: PrismaClient, manualHoldings: ManualHoldingService, clock?: Clock) }` with:
    - `setHoldings(accountId, holdings: HoldingInput[]): Promise<HoldingSnapshot[]>` (effective on the clock's today)
    - `writeBalances(opts?: { accountIds?: string[] }): Promise<number>` (rows written, through the clock's today)
    - private `valueAccount(account, today, rates)`

Rules:
- Holdings are a full replacement effective **today**: today's snapshots for the account are replaced, and earlier days keep the set that was in effect. Quantities must be > 0; ids must be distinct, known securities; an empty list is rejected (400, "A valued account needs at least one holding").
- The first valued entry for an account that was manual removes the manual-holding mirror (snapshots, prices and the synthetic security) via `ManualHoldingService.removalOps`.
- Snapshot `price`/`value` are in the **security's** currency, taken from the price book today (0 when unpriced).
- `writeBalances` recomputes from the account's latest `valuation` row (inclusive, since holdings may have changed since it was written), or from its first snapshot, through today. It writes a row on each day that has a stored price for any held security, on each holdings-change day, and today. Each row is Σ quantity × price for the set in effect, converted to the account currency, rounded to cents. A day where any holding has no price is skipped. Unchanged rows are not rewritten.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/investments/money.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { roundCents } from '@/lib/investments/money';

describe('roundCents', () => {
  it('rounds to cents', () => {
    expect(roundCents(10.005)).toBe(10.01);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(-1.234)).toBe(-1.23);
  });
});
```

Add to `tests/unit/lib/investments/dates.test.ts` (import `lastAtOrBefore` alongside the existing imports):

```ts
describe('lastAtOrBefore', () => {
  it('returns the last value at or before t', () => {
    expect(lastAtOrBefore([1, 3, 5], 4)).toBe(3);
    expect(lastAtOrBefore([1, 3, 5], 5)).toBe(5);
    expect(lastAtOrBefore([1, 3, 5], 0)).toBeUndefined();
  });
});
```

`tests/unit/lib/investments/valuation.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  seedBalance,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
} from '../../../helpers/investments';
import { fixedClock } from '@/lib/clock';
import { ValuationService } from '@/lib/investments/valuation';
import { ManualHoldingService, manualHoldingSecurityId } from '@/lib/investments/manual-holding';
import { isoDay } from '@/lib/investments/dates';

let prisma: PrismaClient;
const FRIDAY = '2026-10-09T22:00:00Z';
const MONDAY = '2026-10-05T22:00:00Z';

/** Services on a fixed clock (these tests seed prices directly). */
function at(iso: string) {
  const clock = fixedClock(iso);
  const manualHoldings = new ManualHoldingService(prisma, clock);
  return { manualHoldings, valuation: new ValuationService(prisma, manualHoldings, clock) };
}

const balances = async (accountId: string) =>
  (
    await prisma.accountBalance.findMany({ where: { accountId }, orderBy: { date: 'asc' } })
  ).map((b) => [isoDay(b.date), b.balance, b.source]);

describe('ValuationService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it("sets today's holdings priced from stored closes and writes today's balance", async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedPrice(prisma, s.id, '2026-10-09', 20);
    const rows = await at(FRIDAY).valuation.setHoldings(a.id, [{ securityId: s.id, quantity: 3 }]);
    expect(rows.map((r) => [isoDay(r.date), r.quantity, r.price, r.value, r.source])).toEqual([
      ['2026-10-09', 3, 20, 60, 'manual'],
    ]);
    expect(await balances(a.id)).toEqual([['2026-10-09', 60, 'valuation']]);
  });

  it('rejects bad input', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma);
    const { valuation } = at(FRIDAY);
    const set = (h: { securityId: string; quantity: number }[]) => valuation.setHoldings(a.id, h);
    await expect(set([])).rejects.toMatchObject({ status: 400 });
    await expect(set([{ securityId: s.id, quantity: 0 }])).rejects.toMatchObject({ status: 400 });
    await expect(set([{ securityId: 'nope', quantity: 1 }])).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      set([
        { securityId: s.id, quantity: 1 },
        { securityId: s.id, quantity: 2 },
      ])
    ).rejects.toMatchObject({ status: 400 });
    const manual = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await expect(
      valuation.setHoldings(manual.id, [{ securityId: s.id, quantity: 1 }])
    ).rejects.toMatchObject({ status: 400 });
  });

  it('editing again the same day replaces the set and the balance', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s1 = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const s2 = await seedSecurity(prisma, { priceSymbol: 'BBB' });
    await seedPrice(prisma, s1.id, '2026-10-09', 10);
    await seedPrice(prisma, s2.id, '2026-10-09', 100);
    const { valuation } = at(FRIDAY);
    await valuation.setHoldings(a.id, [
      { securityId: s1.id, quantity: 1 },
      { securityId: s2.id, quantity: 1 },
    ]);
    await valuation.setHoldings(a.id, [{ securityId: s2.id, quantity: 2 }]);
    expect(
      (await prisma.holdingSnapshot.findMany({ where: { accountId: a.id } })).map((h) => [
        h.securityId,
        h.quantity,
      ])
    ).toEqual([[s2.id, 2]]);
    expect(await balances(a.id)).toEqual([['2026-10-09', 200, 'valuation']]);
  });

  it('the first valued entry removes the manual-holding mirror', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    const { manualHoldings, valuation } = at(FRIDAY);
    await seedBalance(prisma, a.id, '2026-07-12', 500, 'manual');
    await manualHoldings.sync(a.id);
    await prisma.account.update({ where: { id: a.id }, data: { balanceSource: 'valuation' } });
    const s = await seedSecurity(prisma);
    await seedPrice(prisma, s.id, '2026-10-09', 5);
    await valuation.setHoldings(a.id, [{ securityId: s.id, quantity: 100 }]);
    const sid = manualHoldingSecurityId(a.id);
    expect(await prisma.holdingSnapshot.count({ where: { securityId: sid } })).toBe(0);
    expect(await prisma.security.findUnique({ where: { id: sid } })).toBeNull();
    expect(await balances(a.id)).toEqual([
      ['2026-07-12', 500, 'manual'],
      ['2026-10-09', 500, 'valuation'],
    ]);
  });

  it('writes one row per priced day since holdings were set, skipping weekends', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma);
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-02',
      quantity: 2,
      price: 10,
      source: 'manual',
    });
    await seedPrice(prisma, s.id, '2026-10-02', 10);
    await seedPrice(prisma, s.id, '2026-10-05', 11);
    const { valuation } = at(MONDAY);
    expect(await valuation.writeBalances()).toBe(2);
    expect(await balances(a.id)).toEqual([
      ['2026-10-02', 20, 'valuation'],
      ['2026-10-05', 22, 'valuation'],
    ]);
    expect(await valuation.writeBalances()).toBe(0);
  });

  it('uses the holdings in effect on each day', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma);
    for (const [date, quantity] of [
      ['2026-10-02', 1],
      ['2026-10-06', 3],
    ] as const) {
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date,
        quantity,
        price: 10,
        source: 'manual',
      });
    }
    for (const d of ['2026-10-02', '2026-10-05', '2026-10-06']) await seedPrice(prisma, s.id, d, 10);
    await at('2026-10-06T22:00:00Z').valuation.writeBalances();
    expect((await balances(a.id)).map((b) => b[1])).toEqual([10, 10, 30]);
  });

  it('converts security currency to the account currency', async () => {
    await prisma.exchangeRate.create({ data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 } });
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'TEQ.TO', currency: 'CAD' });
    await seedPrice(prisma, s.id, '2026-10-09', 40);
    await at(FRIDAY).valuation.setHoldings(a.id, [{ securityId: s.id, quantity: 10 }]);
    expect(await balances(a.id)).toEqual([['2026-10-09', 300, 'valuation']]);
  });

  it('skips days where a holding has no price', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const priced = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const unpriced = await seedSecurity(prisma, { priceSymbol: 'ZZZ', pricing: 'none' });
    await seedPrice(prisma, priced.id, '2026-10-09', 10);
    await at(FRIDAY).valuation.setHoldings(a.id, [
      { securityId: priced.id, quantity: 1 },
      { securityId: unpriced.id, quantity: 1 },
    ]);
    expect(await balances(a.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/valuation.test.ts tests/unit/lib/investments/money.test.ts tests/unit/lib/investments/dates.test.ts`
Expected: FAIL — cannot resolve `@/lib/investments/valuation` / `@/lib/investments/money`; `lastAtOrBefore` is not exported.

- [ ] **Step 3: Implement**

`src/lib/investments/money.ts`:

```ts
/** Round a currency amount to cents. */
export const roundCents = (n: number) => Math.round(n * 100) / 100;
```

Append to `src/lib/investments/dates.ts`:

```ts
/** Last value ≤ t in an ascending list (e.g. the holdings set in effect on a day). */
export function lastAtOrBefore(sorted: number[], t: number): number | undefined {
  let found: number | undefined;
  for (const v of sorted) {
    if (v > t) break;
    found = v;
  }
  return found;
}
```

In `src/lib/investments/migration.ts` `replayAdjustments`, replace `Math.round(running * 100) / 100` with `roundCents(running)` and add `import { roundCents } from './money';` (its existing tests must still pass).

`src/lib/investments/valuation.ts`:

```ts
import type { Account, HoldingSnapshot, PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { convertAmount } from '@/lib/currency';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';
import { InvestmentInputError, requireInvestmentAccount } from './account-guard';
import { addDays, lastAtOrBefore, utcDay } from './dates';
import type { ManualHoldingService } from './manual-holding';
import { roundCents } from './money';

export type HoldingInput = { securityId: string; quantity: number };

/** Valued investment accounts: user-entered holdings × stored prices → `AccountBalance` rows. */
export class ValuationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly manualHoldings: ManualHoldingService,
    private readonly clock: Clock = systemClock
  ) {}

  /** Replace today's holdings (earlier days keep the set in effect then) and revalue the account. */
  async setHoldings(accountId: string, holdings: HoldingInput[]): Promise<HoldingSnapshot[]> {
    const prisma = this.prisma;
    await requireInvestmentAccount(prisma, accountId, 'valuation');
    if (!holdings.length) {
      throw new InvestmentInputError('A valued account needs at least one holding');
    }
    if (holdings.some((h) => !Number.isFinite(h.quantity) || h.quantity <= 0)) {
      throw new InvestmentInputError('Quantities must be positive numbers');
    }
    const ids = holdings.map((h) => h.securityId);
    if (new Set(ids).size !== ids.length) {
      throw new InvestmentInputError('Each security can appear only once');
    }
    if ((await prisma.security.count({ where: { id: { in: ids } } })) !== ids.length) {
      throw new InvestmentInputError('Unknown security');
    }

    const today = utcDay(this.clock.now());
    const book = await PriceBook.load(prisma, ids, today);
    await prisma.$transaction([
      // A manual account switching to Valued drops its single-holding mirror on first entry.
      ...this.manualHoldings.removalOps(accountId),
      prisma.holdingSnapshot.deleteMany({ where: { accountId, date: today } }),
      ...holdings.map((h) => {
        const price = book.at(h.securityId, today)?.price ?? 0;
        return prisma.holdingSnapshot.create({
          data: {
            accountId,
            securityId: h.securityId,
            date: today,
            quantity: h.quantity,
            price,
            value: h.quantity * price,
            source: 'manual',
          },
        });
      }),
    ]);
    await this.writeBalances({ accountIds: [accountId] });
    return prisma.holdingSnapshot.findMany({ where: { accountId, date: today } });
  }

  async writeBalances(opts: { accountIds?: string[] } = {}): Promise<number> {
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
    for (const account of accounts) written += await this.valueAccount(account, today, rates);
    return written;
  }

  private async valueAccount(
    account: Account,
    today: Date,
    rates: Map<string, number>
  ): Promise<number> {
    const prisma = this.prisma;
    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { accountId: account.id, date: { lte: today } },
      include: { security: { select: { currency: true } } },
      orderBy: { date: 'asc' },
    });
    if (!snapshots.length) return 0;
    const last = await prisma.accountBalance.findFirst({
      where: { accountId: account.id, source: 'valuation' },
      orderBy: { date: 'desc' },
    });
    const start = last ? last.date : snapshots[0].date;
    const securityIds = [...new Set(snapshots.map((s) => s.securityId))];
    const book = await PriceBook.load(prisma, securityIds, today);
    const [prices, existingRows] = await Promise.all([
      prisma.securityPrice.findMany({
        where: { securityId: { in: securityIds }, date: { gte: start, lte: today } },
        select: { date: true },
      }),
      prisma.accountBalance.findMany({ where: { accountId: account.id, date: { gte: start } } }),
    ]);
    const priceDays = new Set(prices.map((p) => p.date.getTime()));
    const setDays = [...new Set(snapshots.map((s) => s.date.getTime()))];
    const existing = new Map(existingRows.map((r) => [r.date.getTime(), r]));

    let written = 0;
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const t = d.getTime();
      if (t !== today.getTime() && !priceDays.has(t) && !setDays.includes(t)) continue;
      const setDay = lastAtOrBefore(setDays, t);
      if (setDay === undefined) continue;
      let value = 0;
      let complete = true;
      for (const h of snapshots.filter((s) => s.date.getTime() === setDay)) {
        const priced = book.at(h.securityId, d);
        if (!priced) {
          complete = false;
          break;
        }
        value += convertAmount(
          h.quantity * priced.price,
          h.security.currency,
          account.currency,
          rates
        );
      }
      if (!complete) continue;
      const balance = roundCents(value);
      const prev = existing.get(t);
      if (prev?.source === 'valuation' && prev.balance === balance) continue;
      await prisma.accountBalance.upsert({
        where: { accountId_date: { accountId: account.id, date: d } },
        create: {
          accountId: account.id,
          date: d,
          balance,
          currency: account.currency,
          source: 'valuation',
        },
        update: { balance, source: 'valuation' },
      });
      written++;
    }
    return written;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments && npm run typecheck`
Expected: PASS (including Plan 1's migration tests). In "the first valued entry removes the manual-holding mirror", the 07-12 manual row stays, and today's row is 100 × 5 = 500.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/valuation.ts src/lib/investments/money.ts src/lib/investments/dates.ts src/lib/investments/migration.ts tests/unit/lib/investments/valuation.test.ts tests/unit/lib/investments/money.test.ts tests/unit/lib/investments/dates.test.ts
git commit -m "feat(investments): valued accounts — holdings × price balance history"
```

---

### Task 6: Value history

**Files:**
- Create: `src/lib/investments/history.ts`
- Test: `tests/unit/lib/investments/history.test.ts`

**Interfaces:**
- Consumes: `PriceBook`, `loadFxRates` (Task 3); `roundCents`, `lastAtOrBefore` (Task 5); `convertAmount`; `utcDay`, `isoDay`, `addDays`.
- Produces:
  - `type SeriesPoint = { date: string; value: number; isEstimated: boolean }` (`date` is `YYYY-MM-DD`)
  - `class ValueHistoryService { constructor(prisma: PrismaClient) }` with:
    - `accountSeries(accountId, from: Date, to: Date, opts?: { rates?: Map<string, number> }): Promise<SeriesPoint[]>` — value in the account's currency, one point per day from the first day with data
    - `portfolioSeries(from: Date, to: Date, baseCurrency: string): Promise<SeriesPoint[]>` — active investment accounts summed in `baseCurrency`
  - Internally, a non-exported `class ProviderValueDeriver { static load(prisma, account, to, rates, storedByDay): Promise<ProviderValueDeriver | null>; valueOn(day: Date): number | null }`. `load` does all DB reads once per series (null when the account has no Plaid snapshot); `valueOn` is pure over the loaded state. Keep that split: loading and computing are separate responsibilities, and the pure half stays testable.

Rules, applied per day D in [from, to]:
1. A stored `AccountBalance` on D → that value, `isEstimated: false`.
2. Otherwise, for a **provider** account on or after its first Plaid holdings snapshot: derive (below), `isEstimated: true`.
3. Otherwise, carry the latest stored row before D forward. It is `isEstimated: false` when that row is a `valuation` row (no trading happened), else `true`. With no earlier row, D has no point.

Derivation from the latest Plaid snapshot S on or before D:
- **Traded securities** (any non-cancelled `buy`/`sell`/`transfer` with a quantity in the account): quantity = S's quantity + Σ quantities of those rows in (S.date, D]. Plaid sells carry negative quantities.
- **Untraded securities:** quantity interpolates linearly between S and the next snapshot when that snapshot holds the security; otherwise S's quantity carries.
- **Cash:** a `cash`-type security in S moves by −Σ `amount` of every non-cancelled row in (S.date, D]. Without one, the same movement applies to an implicit cash balance that starts at (stored balance on S.date − S's holdings value), or at 0 when S.date has no stored balance.
- **Prices:** from the price book on D, falling back to the snapshot's own price. Each value converts security → account currency. Quantities ≤ 0 count as 0.
- Rows with `type = 'cancel'` or `isCancelled` are ignored.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/investments/history.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  day,
  seedBalance,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
} from '../../../helpers/investments';
import { ValueHistoryService } from '@/lib/investments/history';

let prisma: PrismaClient;
let history: ValueHistoryService;
const series = (accountId: string, from: string, to: string) =>
  history.accountSeries(accountId, day(from), day(to));

describe('ValueHistoryService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
    history = new ValueHistoryService(prisma);
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('manual: entered days are exact, carried days estimated, nothing before the first entry', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'manual' });
    await seedBalance(prisma, a.id, '2026-10-02', 100, 'manual');
    await seedBalance(prisma, a.id, '2026-10-04', 120, 'manual');
    expect(await series(a.id, '2026-10-01', '2026-10-05')).toEqual([
      { date: '2026-10-02', value: 100, isEstimated: false },
      { date: '2026-10-03', value: 100, isEstimated: true },
      { date: '2026-10-04', value: 120, isEstimated: false },
      { date: '2026-10-05', value: 120, isEstimated: true },
    ]);
  });

  it('valuation: weekend carry-forward is not an estimate', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    await seedBalance(prisma, a.id, '2026-10-02', 50, 'valuation');
    expect(await series(a.id, '2026-10-03', '2026-10-04')).toEqual([
      { date: '2026-10-03', value: 50, isEstimated: false },
      { date: '2026-10-04', value: 50, isEstimated: false },
    ]);
  });

  it('provider: does not derive before the first holdings snapshot', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma);
    await seedBalance(prisma, a.id, '2026-07-12', 900, 'manual');
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 100,
    });
    await seedBalance(prisma, a.id, '2026-10-01', 1000);
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-08-01',
      type: 'buy',
      quantity: 5,
      amount: 400,
    });
    expect(await series(a.id, '2026-09-30', '2026-09-30')).toEqual([
      { date: '2026-09-30', value: 900, isEstimated: true },
    ]);
    expect(await series(a.id, '2026-07-11', '2026-07-11')).toEqual([]);
  });

  it('provider: replays trades and cash flows after a snapshot', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 10,
      price: 100,
    });
    await seedBalance(prisma, a.id, '2026-10-01', 1050); // 50 cash outside holdings
    await seedPrice(prisma, s.id, '2026-10-01', 100);
    await seedPrice(prisma, s.id, '2026-10-02', 110);
    await seedPrice(prisma, s.id, '2026-10-05', 120);
    await seedTrade(prisma, { accountId: a.id, date: '2026-10-02', type: 'cash', amount: -500 });
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-03',
      type: 'buy',
      quantity: 5,
      amount: 500,
    });
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-02',
      type: 'buy',
      quantity: 100,
      amount: 10000,
      isCancelled: true,
    });
    expect(await series(a.id, '2026-10-01', '2026-10-05')).toEqual([
      { date: '2026-10-01', value: 1050, isEstimated: false },
      { date: '2026-10-02', value: 1650, isEstimated: true }, // 10 × 110 + 550 cash
      { date: '2026-10-03', value: 1700, isEstimated: true }, // 15 × 110 + 50 cash
      { date: '2026-10-04', value: 1700, isEstimated: true },
      { date: '2026-10-05', value: 1850, isEstimated: true }, // 15 × 120 + 50 cash
    ]);
  });

  it('provider: a cash security moves with cash flows', async () => {
    const a = await seedInvestmentAccount(prisma);
    const cash = await seedSecurity(prisma, {
      priceSymbol: null,
      type: 'cash',
      pricing: 'fixed',
      fixedPrice: 1,
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: cash.id,
      date: '2026-10-01',
      quantity: 200,
      price: 1,
    });
    await seedBalance(prisma, a.id, '2026-10-01', 200);
    await seedTrade(prisma, { accountId: a.id, date: '2026-10-02', type: 'fee', amount: 25 });
    expect((await series(a.id, '2026-10-02', '2026-10-02'))[0]).toEqual({
      date: '2026-10-02',
      value: 175,
      isEstimated: true,
    });
  });

  it('provider: an untraded plan fund interpolates quantity and price between snapshots', async () => {
    const a = await seedInvestmentAccount(prisma);
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: fund.id,
      date: '2026-10-01',
      quantity: 100,
      price: 10,
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: fund.id,
      date: '2026-10-11',
      quantity: 110,
      price: 12,
    });
    await seedPrice(prisma, fund.id, '2026-10-01', 10, 'plaid');
    await seedPrice(prisma, fund.id, '2026-10-11', 12, 'plaid');
    await seedBalance(prisma, a.id, '2026-10-01', 1000);
    await seedBalance(prisma, a.id, '2026-10-11', 1320);
    expect((await series(a.id, '2026-10-06', '2026-10-06'))[0]).toEqual({
      date: '2026-10-06',
      value: 1155, // 105 units × 11
      isEstimated: true,
    });
  });

  it('portfolio sums accounts in the base currency and flags any estimate', async () => {
    await prisma.exchangeRate.create({ data: { fromCurrency: 'CAD', toCurrency: 'USD', rate: 0.75 } });
    const usd = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const cad = await seedInvestmentAccount(prisma, { balanceSource: 'manual', currency: 'CAD' });
    await seedBalance(prisma, usd.id, '2026-10-01', 100, 'valuation');
    await seedBalance(prisma, usd.id, '2026-10-02', 110, 'valuation');
    await prisma.accountBalance.create({
      data: { accountId: cad.id, date: day('2026-10-01'), balance: 400, currency: 'CAD', source: 'manual' },
    });
    expect(await history.portfolioSeries(day('2026-10-01'), day('2026-10-02'), 'USD')).toEqual([
      { date: '2026-10-01', value: 400, isEstimated: false },
      { date: '2026-10-02', value: 410, isEstimated: true },
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/history.test.ts`
Expected: FAIL — cannot resolve `@/lib/investments/history`.

- [ ] **Step 3: Implement**

`src/lib/investments/history.ts`:

```ts
import type { AccountBalance, PrismaClient } from '@prisma/client';
import { convertAmount } from '@/lib/currency';
import { loadFxRates, PriceBook } from '@/lib/prices/price-book';
import { addDays, isoDay, lastAtOrBefore, utcDay } from './dates';
import { roundCents } from './money';

export type SeriesPoint = { date: string; value: number; isEstimated: boolean };

const QUANTITY_TYPES = new Set(['buy', 'sell', 'transfer']);

type Position = { securityId: string; quantity: number; price: number; value: number };
type Flow = {
  date: Date;
  securityId: string | null;
  type: string;
  quantity: number | null;
  amount: number;
};

/** Daily value series for investment accounts, derived at read time (rules in Plan 2, Task 6). */
export class ValueHistoryService {
  constructor(private readonly prisma: PrismaClient) {}

  async accountSeries(
    accountId: string,
    from: Date,
    to: Date,
    opts: { rates?: Map<string, number> } = {}
  ): Promise<SeriesPoint[]> {
    const prisma = this.prisma;
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, currency: true, balanceSource: true },
    });
    const rates = opts.rates ?? (await loadFxRates(prisma));
    const stored = await prisma.accountBalance.findMany({
      where: { accountId, date: { lte: to } },
      orderBy: { date: 'asc' },
    });
    const storedByDay = new Map(stored.map((r) => [r.date.getTime(), r]));
    const deriver =
      account.balanceSource === 'provider'
        ? await ProviderValueDeriver.load(prisma, account, to, rates, storedByDay)
        : null;

    const points: SeriesPoint[] = [];
    let prev: AccountBalance | null = null;
    let i = 0;
    for (let d = utcDay(from); d <= to; d = addDays(d, 1)) {
      const t = d.getTime();
      while (i < stored.length && stored[i].date.getTime() < t) prev = stored[i++];
      const exact = storedByDay.get(t);
      if (exact) {
        points.push({ date: isoDay(d), value: exact.balance, isEstimated: false });
        continue;
      }
      const derived = deriver ? deriver.valueOn(d) : null;
      if (derived != null) {
        points.push({ date: isoDay(d), value: derived, isEstimated: true });
      } else if (prev) {
        points.push({
          date: isoDay(d),
          value: prev.balance,
          isEstimated: prev.source !== 'valuation',
        });
      }
    }
    return points;
  }

  async portfolioSeries(from: Date, to: Date, baseCurrency: string): Promise<SeriesPoint[]> {
    const accounts = await this.prisma.account.findMany({
      where: { trackingMode: 'investment', isActive: true },
      select: { id: true, currency: true },
    });
    const rates = await loadFxRates(this.prisma);
    const totals = new Map<string, { value: number; isEstimated: boolean }>();
    for (const a of accounts) {
      for (const p of await this.accountSeries(a.id, from, to, { rates })) {
        const total = totals.get(p.date) ?? { value: 0, isEstimated: false };
        total.value += convertAmount(p.value, a.currency, baseCurrency, rates);
        total.isEstimated ||= p.isEstimated;
        totals.set(p.date, total);
      }
    }
    return [...totals.entries()]
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([date, t]) => ({ date, value: roundCents(t.value), isEstimated: t.isEstimated }));
  }
}

/**
 * Estimates a provider account's value on days without a stored balance, from its Plaid holdings
 * snapshots and the trades after them. `load` reads everything once; `valueOn` is pure.
 */
class ProviderValueDeriver {
  private constructor(
    private readonly snapshotDays: number[], // ascending
    private readonly setOn: Map<number, Position[]>,
    private readonly flows: Flow[], // non-cancelled, ascending
    private readonly traded: Set<string>,
    private readonly cashSecurityIds: Set<string>,
    private readonly book: PriceBook,
    private readonly toAccount: (amount: number, securityId: string) => number,
    private readonly storedByDay: Map<number, AccountBalance>
  ) {}

  /** Null when the account has no Plaid holdings snapshot on or before `to`. */
  static async load(
    prisma: PrismaClient,
    account: { id: string; currency: string },
    to: Date,
    rates: Map<string, number>,
    storedByDay: Map<number, AccountBalance>
  ): Promise<ProviderValueDeriver | null> {
    const securitySelect = { select: { id: true, type: true, currency: true } };
    const snapshots = await prisma.holdingSnapshot.findMany({
      where: { accountId: account.id, source: 'plaid', date: { lte: to } },
      include: { security: securitySelect },
      orderBy: { date: 'asc' },
    });
    if (!snapshots.length) return null;
    const flows = await prisma.investmentTransaction.findMany({
      where: {
        accountId: account.id,
        isCancelled: false,
        type: { not: 'cancel' },
        date: { lte: to },
      },
      include: { security: securitySelect },
      orderBy: { date: 'asc' },
    });

    const setOn = new Map<number, Position[]>();
    for (const s of snapshots) {
      const t = s.date.getTime();
      setOn.set(t, [...(setOn.get(t) ?? []), s]);
    }
    const securities = new Map(
      [...snapshots, ...flows].flatMap((r) =>
        r.security ? [[r.security.id, r.security] as const] : []
      )
    );
    const book = await PriceBook.load(prisma, [...securities.keys()], to);
    return new ProviderValueDeriver(
      [...setOn.keys()],
      setOn,
      flows,
      new Set(
        flows
          .filter((x) => x.securityId && x.quantity != null && QUANTITY_TYPES.has(x.type))
          .map((x) => x.securityId!)
      ),
      new Set([...securities.values()].filter((s) => s.type === 'cash').map((s) => s.id)),
      book,
      (amount, securityId) =>
        convertAmount(
          amount,
          securities.get(securityId)?.currency ?? account.currency,
          account.currency,
          rates
        ),
      storedByDay
    );
  }

  /** Estimated value on day `d` from the latest snapshot on or before it; null before the first. */
  valueOn(d: Date): number | null {
    const t = d.getTime();
    const prevDay = lastAtOrBefore(this.snapshotDays, t);
    if (prevDay === undefined) return null;
    const nextDay = this.snapshotDays.find((s) => s > t);
    const prevSet = this.setOn.get(prevDay)!;
    const nextSet = nextDay === undefined ? [] : this.setOn.get(nextDay)!;
    const window = this.flows.filter((x) => x.date.getTime() > prevDay && x.date.getTime() <= t);
    const cashFlow = -window.reduce((sum, x) => sum + x.amount, 0);
    const isCash = (securityId: string) => this.cashSecurityIds.has(securityId);

    const quantity = new Map(prevSet.map((s) => [s.securityId, s.quantity]));
    const fallbackPrice = new Map([...nextSet, ...prevSet].map((s) => [s.securityId, s.price]));
    for (const x of window) {
      if (
        !x.securityId ||
        x.quantity == null ||
        !QUANTITY_TYPES.has(x.type) ||
        isCash(x.securityId)
      ) {
        continue;
      }
      quantity.set(x.securityId, (quantity.get(x.securityId) ?? 0) + x.quantity);
    }
    if (nextDay !== undefined) {
      const f = (t - prevDay) / (nextDay - prevDay);
      for (const s of prevSet) {
        if (this.traded.has(s.securityId) || isCash(s.securityId)) continue;
        const next = nextSet.find((n) => n.securityId === s.securityId);
        if (next) quantity.set(s.securityId, s.quantity + f * (next.quantity - s.quantity));
      }
    }
    const cashPosition = prevSet.find((s) => isCash(s.securityId));
    if (cashPosition) quantity.set(cashPosition.securityId, cashPosition.quantity + cashFlow);

    let value = 0;
    for (const [securityId, q] of quantity) {
      if (q <= 0) continue;
      const price = this.book.at(securityId, d)?.price ?? fallbackPrice.get(securityId);
      if (price != null) value += this.toAccount(q * price, securityId);
    }
    if (!cashPosition) {
      // Implicit cash: what the stored balance held beyond the snapshot's positions, moved by flows.
      const anchor = this.storedByDay.get(prevDay);
      const held = prevSet.reduce((sum, s) => sum + this.toAccount(s.value, s.securityId), 0);
      value += (anchor ? anchor.balance - held : 0) + cashFlow;
    }
    return roundCents(value);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/history.test.ts && npm run typecheck`
Expected: PASS. If the replay test is off by the cash term, recheck the sign: `amount` is positive when cash leaves, so `cashFlow = −Σ amount`.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/history.ts tests/unit/lib/investments/history.test.ts
git commit -m "feat(investments): daily value history with read-time gap derivation"
```

---

### Task 7: Refresh orchestration, composition root, sync hook, refresh and history APIs

**Files:**
- Create: `src/lib/investments/refresh.ts`, `src/lib/investments/services.ts`, `src/app/api/investments/_lib/http.ts`, `src/app/api/investments/refresh/route.ts`, `src/app/api/investments/history/route.ts`
- Modify: `src/lib/prices/refresh.ts` (add `PriceRefresher.pricesAsOf`), `tests/helpers/investments.ts` (add `testServices`), `src/app/api/plaid/sync/route.ts` (after the `withSyncLock` block, ~line 104), `src/app/api/transactions/adjustment/route.ts` (switch from `new ManualHoldingService(prisma)` to the composition root)
- Test: `tests/unit/lib/investments/refresh.test.ts`, `tests/unit/lib/prices/refresh.test.ts` (add one case), `tests/integration/api/investments-refresh-history.test.ts`, `tests/integration/api/plaid-investment-sync-route.test.ts` (add cases)

**Interfaces:**
- Consumes: `PriceRefresher` (its `refresh`, `latestStoredClose`), `Sleeper`, `PriceRefreshResult` (Task 2); `ManualHoldingService` (Task 4); `ValuationService` (its `writeBalances`; Task 5); `ValueHistoryService` (Task 6); `PriceProvider`, `YahooPriceProvider`, `Clock`, `fixedClock` (Task 1); `fakeProvider`, `noSleep` (Task 2 helpers); `withSyncLock` from `src/lib/sync-common.ts`.
- Produces:
  - `PriceRefresher.pricesAsOf(): Promise<Date | null>` — the oldest "latest Yahoo close" across feed securities that appear in any holding snapshot (the honest "prices as of"); on `PriceRefresher` because it already owns `latestStoredClose`
  - `type InvestmentRefreshResult = PriceRefreshResult & { valuationRows: number }`
  - `class InvestmentRefreshService { constructor(prices: PriceRefresher, valuation: ValuationService); refresh(): Promise<InvestmentRefreshResult> }` — prices, then valued balances, serialized under lock key `investments:refresh` (Task 8 adds `saveHoldings`, since this class already composes pricing and valuation)
  - Composition root `src/lib/investments/services.ts`:
    - `type InvestmentServices = { prices: PriceRefresher; manualHoldings: ManualHoldingService; valuation: ValuationService; history: ValueHistoryService; refresh: InvestmentRefreshService }` (Task 9 adds `quotes` and `catalog`)
    - `createInvestmentServices(deps: { prisma: PrismaClient; provider: PriceProvider; clock?: Clock; sleep?: Sleeper }): InvestmentServices`
    - `getInvestmentServices(): Promise<InvestmentServices>` — memoized production instance: the app Prisma client and `new YahooPriceProvider()`, both loaded by dynamic import on first use. Routes and the sync hook call this.
  - Test helper `testServices(prisma, providerOpts?, iso = '2026-10-09T22:00:00Z'): { services: InvestmentServices; calls }` — `createInvestmentServices` with `fakeProvider(providerOpts)`, `fixedClock(iso)` and `noSleep`; `calls` is the fake's history-call log
  - In `src/app/api/investments/_lib/http.ts`, shared by every route in Tasks 7–9:
    - `investmentErrorResponse(error: unknown, fallback: string): NextResponse`
    - `parseJsonBody<T>(request, schema: z.ZodType<T>, error: string): Promise<{ data: T } | { response: NextResponse }>`
    - `isoDateSchema` (a `YYYY-MM-DD` string that is a real date)
  - `POST /api/investments/refresh` → `{ fetched, upToDate, unknownSymbols, stopped, error, valuationRows, pricesAsOf: 'YYYY-MM-DD' | null }`
  - `GET /api/investments/history?accountId=&from=&to=` → `{ currency, points: SeriesPoint[] }`. `from` and `to` are `YYYY-MM-DD`, defaulting to today and 30 days before it; the range is at most 3660 days. Without `accountId`, the portfolio is returned in the user's base currency.

- [ ] **Step 1: Write the failing tests**

Add to `tests/helpers/investments.ts` (the composition root exists from this task on):

```ts
import { fixedClock } from '@/lib/clock';
import { createInvestmentServices } from '@/lib/investments/services';

/** Production wiring over the test client: fake price feed, frozen clock, no real sleeps. */
export function testServices(
  prisma: PrismaClient,
  providerOpts: Parameters<typeof fakeProvider>[0] = {},
  iso = '2026-10-09T22:00:00Z'
) {
  const { provider, calls } = fakeProvider(providerOpts);
  const services = createInvestmentServices({
    prisma,
    provider,
    clock: fixedClock(iso),
    sleep: noSleep,
  });
  return { services, calls };
}
```

(Put the two imports with the file's other imports.)

`tests/unit/lib/investments/refresh.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import {
  seedInvestmentAccount,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../../helpers/investments';

let prisma: PrismaClient;

describe('InvestmentRefreshService', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('prices securities, then values valued accounts', async () => {
    const valued = await seedInvestmentAccount(prisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: valued.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 2,
      price: 0,
      source: 'manual',
    });
    const { services } = testServices(prisma, { closes: { AAA: { '2026-10-09': 15 } } });
    const r = await services.refresh.refresh();
    expect(r).toMatchObject({ fetched: 1, valuationRows: 1 });
    expect(
      (await prisma.accountBalance.findFirstOrThrow({ where: { accountId: valued.id } })).balance
    ).toBe(30);
  });

  it('serializes concurrent refreshes', async () => {
    const a = await seedInvestmentAccount(prisma);
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-09',
      quantity: 1,
      price: 1,
    });
    const { services, calls } = testServices(prisma, { closes: { AAA: { '2026-10-09': 1 } } });
    await Promise.all([services.refresh.refresh(), services.refresh.refresh()]);
    expect(calls).toHaveLength(1);
  });
});
```

Add to `tests/unit/lib/prices/refresh.test.ts`, inside `describe('PriceRefresher')`:

```ts
  it('pricesAsOf reports the oldest latest close among held feed securities', async () => {
    const a = await seedInvestmentAccount(prisma);
    for (const [symbol, last] of [
      ['AAA', '2026-10-09'],
      ['BBB', '2026-10-07'],
    ]) {
      const s = await seedSecurity(prisma, { priceSymbol: symbol });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-09',
        quantity: 1,
        price: 1,
      });
      await seedPrice(prisma, s.id, last, 1);
    }
    expect(isoDay((await refresher(fakeProvider().provider).pricesAsOf())!)).toBe('2026-10-07');
  });
```

`tests/integration/api/investments-refresh-history.test.ts`:

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
import { POST as refresh } from '@/app/api/investments/refresh/route';
import { GET as history } from '@/app/api/investments/history/route';

const get = (query: string) =>
  history(new NextRequest(`http://localhost/api/investments/history?${query}`));

describe('investments refresh and history APIs', () => {
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

  it('POST /refresh runs and reports pricesAsOf', async () => {
    const res = await refresh();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stopped: false, pricesAsOf: null });
  });

  it('GET /history returns an account series in its currency', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    await seedBalance(testPrisma, a.id, '2026-10-01', 10, 'manual');
    const res = await get(`accountId=${a.id}&from=2026-10-01&to=2026-10-02`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      currency: 'USD',
      points: [
        { date: '2026-10-01', value: 10, isEstimated: false },
        { date: '2026-10-02', value: 10, isEstimated: true },
      ],
    });
  });

  it('GET /history without accountId returns the portfolio in the base currency', async () => {
    const res = await get('from=2026-10-01&to=2026-10-02');
    expect(await res.json()).toEqual({ currency: 'USD', points: [] });
  });

  it('GET /history validates input', async () => {
    expect((await get('from=2026-13-01')).status).toBe(400);
    expect((await get('from=2026-10-05&to=2026-10-01')).status).toBe(400);
    expect((await get('accountId=missing')).status).toBe(404);
    const cash = await testPrisma.account.create({
      data: { name: 'Checking', type: 'checking', currency: 'USD' },
    });
    expect((await get(`accountId=${cash.id}`)).status).toBe(400);
  });
});
```

Add to `tests/integration/api/plaid-investment-sync-route.test.ts`:
- next to the existing `vi.mock` lines, a stub composition root whose refresh is a spy:

```ts
const { refreshRun } = vi.hoisted(() => ({ refreshRun: vi.fn(async () => ({})) }));
vi.mock('@/lib/investments/services', () => ({
  getInvestmentServices: vi.fn(async () => ({ refresh: { refresh: refreshRun } })),
}));
```

- these cases (built with the file's existing `addAccount` / `okResult` / `post` helpers). The hook fires after the route responds, so assert the call with `vi.waitFor`:

```ts
  it('starts a price refresh after syncing investment accounts', async () => {
    // arrange an investment account as the existing investment cases do
    vi.mocked(syncPlaidInvestments).mockResolvedValue(okResult(accountId) as never);
    const res = await post({ accountId });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(refreshRun).toHaveBeenCalledTimes(1));
  });

  it('does not start a price refresh for a cash-flow-only item', async () => {
    // arrange a cash-flow account on its own item as the existing cash-flow case does
    expect(refreshRun).not.toHaveBeenCalled();
  });

  it('a failing price refresh does not fail the sync', async () => {
    refreshRun.mockRejectedValueOnce(new Error('boom'));
    vi.mocked(syncPlaidInvestments).mockResolvedValue(okResult(accountId) as never);
    const res = await post({ accountId });
    expect(res.status).toBe(200);
  });
```

Replace the arrange comments with the file's real setup calls, and make sure its `beforeEach` clears mocks (`vi.clearAllMocks()`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/refresh.test.ts tests/unit/lib/prices/refresh.test.ts tests/integration/api/investments-refresh-history.test.ts tests/integration/api/plaid-investment-sync-route.test.ts`
Expected: FAIL — modules missing; the sync route never starts a refresh; `pricesAsOf` is not a function.

- [ ] **Step 3: Implement**

Add to `PriceRefresher` in `src/lib/prices/refresh.ts`:

```ts
  /** Oldest "latest Yahoo close" across held feed securities: the honest "prices as of". */
  async pricesAsOf(): Promise<Date | null> {
    const securities = await this.prisma.security.findMany({
      where: { pricing: 'feed', holdings: { some: {} } },
      select: { id: true },
    });
    let oldest: Date | null = null;
    for (const { id } of securities) {
      const latest = await this.latestStoredClose(id);
      if (latest && (!oldest || latest < oldest)) oldest = latest;
    }
    return oldest;
  }
```

`src/lib/investments/refresh.ts`:

```ts
import { withSyncLock } from '@/lib/sync-common';
import type { PriceRefresher, PriceRefreshResult } from '@/lib/prices/refresh';
import type { ValuationService } from './valuation';

export type InvestmentRefreshResult = PriceRefreshResult & { valuationRows: number };

/** Prices, then valued-account balances. One run at a time per process. */
export class InvestmentRefreshService {
  constructor(
    private readonly prices: PriceRefresher,
    private readonly valuation: ValuationService
  ) {}

  refresh(): Promise<InvestmentRefreshResult> {
    return withSyncLock('investments:refresh', async () => {
      const prices = await this.prices.refresh();
      const valuationRows = await this.valuation.writeBalances();
      return { ...prices, valuationRows };
    });
  }
}
```

`src/lib/investments/services.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import type { Clock } from '@/lib/clock';
import { PriceRefresher, type Sleeper } from '@/lib/prices/refresh';
import type { PriceProvider } from '@/lib/prices/types';
import { ValueHistoryService } from './history';
import { ManualHoldingService } from './manual-holding';
import { InvestmentRefreshService } from './refresh';
import { ValuationService } from './valuation';

export type InvestmentServices = {
  prices: PriceRefresher;
  manualHoldings: ManualHoldingService;
  valuation: ValuationService;
  history: ValueHistoryService;
  refresh: InvestmentRefreshService;
};

/** The one place investment services are wired. Omitted `clock`/`sleep` use the real ones. */
export function createInvestmentServices(deps: {
  prisma: PrismaClient;
  provider: PriceProvider;
  clock?: Clock;
  sleep?: Sleeper;
}): InvestmentServices {
  const { prisma, provider, clock, sleep } = deps;
  const prices = new PriceRefresher(prisma, provider, clock, sleep);
  const manualHoldings = new ManualHoldingService(prisma, clock);
  const valuation = new ValuationService(prisma, manualHoldings, clock);
  return {
    prices,
    manualHoldings,
    valuation,
    history: new ValueHistoryService(prisma),
    refresh: new InvestmentRefreshService(prices, valuation),
  };
}

let instance: InvestmentServices | null = null;

/**
 * Production services: the app Prisma client and Yahoo, built on first use. Both load lazily so
 * code paths that never price don't import `yahoo-finance2`.
 */
export async function getInvestmentServices(): Promise<InvestmentServices> {
  if (!instance) {
    const [{ prisma }, { YahooPriceProvider }] = await Promise.all([
      import('@/lib/prisma'),
      import('../prices/yahoo'),
    ]);
    instance ??= createInvestmentServices({ prisma, provider: new YahooPriceProvider() });
  }
  return instance;
}
```

`src/app/api/investments/_lib/http.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { PriceProviderError } from '@/lib/prices/types';

export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), 'Invalid date');

export async function parseJsonBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>,
  error: string
): Promise<{ data: T } | { response: NextResponse }> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (parsed.success) return { data: parsed.data };
  return {
    response: NextResponse.json({ error, details: parsed.error.issues }, { status: 400 }),
  };
}

export function investmentErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof InvestmentInputError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof PriceProviderError) {
    const status = error.kind === 'unknown_symbol' ? 400 : 502;
    const message = error.kind === 'unknown_symbol' ? 'Unknown symbol' : 'Price service unavailable';
    return NextResponse.json({ error: message }, { status });
  }
  console.error(`[investments] ${fallback}:`, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
```

`src/app/api/investments/refresh/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { isoDay } from '@/lib/investments/dates';
import { investmentErrorResponse } from '../_lib/http';

export async function POST() {
  try {
    const { refresh, prices } = await getInvestmentServices();
    const result = await refresh.refresh();
    const pricesAsOf = await prices.pricesAsOf();
    return NextResponse.json({ ...result, pricesAsOf: pricesAsOf ? isoDay(pricesAsOf) : null });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to refresh investments');
  }
}
```

`src/app/api/investments/history/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { addDays, utcDay } from '@/lib/investments/dates';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, isoDateSchema } from '../_lib/http';

const MAX_DAYS = 3660;

const querySchema = z.object({
  accountId: z.string().min(1).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid query', details: parsed.error.issues }, { status: 400 });
  }
  const to = parsed.data.to ? utcDay(parsed.data.to) : utcDay(new Date());
  const from = parsed.data.from ? utcDay(parsed.data.from) : addDays(to, -30);
  if (from > to || to.getTime() - from.getTime() > MAX_DAYS * 86_400_000) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  try {
    const { history } = await getInvestmentServices();
    if (parsed.data.accountId) {
      const account = await prisma.account.findUnique({ where: { id: parsed.data.accountId } });
      if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      if (account.trackingMode !== 'investment') {
        return NextResponse.json({ error: 'Not an investment account' }, { status: 400 });
      }
      const points = await history.accountSeries(account.id, from, to);
      return NextResponse.json({ currency: account.currency, points });
    }
    const settings = await prisma.userSettings.findFirst();
    const currency = settings?.baseCurrency || 'USD';
    const points = await history.portfolioSeries(from, to, currency);
    return NextResponse.json({ currency, points });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load investment history');
  }
}
```

In `src/app/api/plaid/sync/route.ts`, add `import { getInvestmentServices } from '@/lib/investments/services';` and, right after the `withSyncLock(...)` call resolves and before `return NextResponse.json({ ...base, ...result, investments });`:

```ts
    if (investments.length) {
      // Pricing is one throttled Yahoo call per stale symbol: run it after responding, never
      // failing the sync. The investments view's refresh call covers anything missed.
      void getInvestmentServices()
        .then(({ refresh }) => refresh.refresh())
        .catch((error) => console.error('[investments] post-sync refresh failed:', error));
    }
```

In `src/app/api/transactions/adjustment/route.ts` (Task 4), replace `new ManualHoldingService(prisma).record(` with the composition root's instance, and swap the `ManualHoldingService` import for `import { getInvestmentServices } from '@/lib/investments/services';`:

```ts
      const { balance } = await getAccountBalance(prisma, accountId);
      const { manualHoldings } = await getInvestmentServices();
      const accountBalance = await manualHoldings.record(accountId, {
        date: new Date(),
        balance: balance + amount,
      });
```

Its existing tests need no change: they mock `@/lib/prisma`, so the memoized services use the test client, and this path never calls the price provider.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/refresh.test.ts tests/unit/lib/prices/refresh.test.ts tests/integration/api/investments-refresh-history.test.ts tests/integration/api/plaid-investment-sync-route.test.ts tests/integration/api/investment-adjustment.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/refresh.ts src/lib/investments/services.ts src/lib/prices/refresh.ts tests/helpers/investments.ts src/app/api/investments/_lib/http.ts src/app/api/investments/refresh/route.ts src/app/api/investments/history/route.ts src/app/api/plaid/sync/route.ts src/app/api/transactions/adjustment/route.ts tests/unit/lib/investments/refresh.test.ts tests/unit/lib/prices/refresh.test.ts tests/integration/api/investments-refresh-history.test.ts tests/integration/api/plaid-investment-sync-route.test.ts
git commit -m "feat(investments): composition root, refresh orchestration after sync, refresh and history APIs"
```

---

### Task 8: Account APIs — valued holdings and manual balances

**Files:**
- Modify: `src/lib/investments/refresh.ts` (add `InvestmentRefreshService.saveHoldings`), `src/lib/investments/valuation.ts` (add `ValuationService.latestBalance`)
- Create: `src/app/api/investments/accounts/[id]/holdings/route.ts`, `src/app/api/investments/accounts/[id]/balances/route.ts`, `src/app/api/investments/accounts/[id]/balances/[balanceId]/route.ts`
- Test: `tests/integration/api/investment-account-apis.test.ts`

**Interfaces:**
- Consumes: `InvestmentRefreshService` (Task 7) and the `PriceRefresher` / `ValuationService` it holds (Tasks 2 and 5: `refresh({ securityIds })`, `setHoldings`), `HoldingInput` (Task 5), `ManualHoldingService.record` / `delete` / `list` (Task 4), `getInvestmentServices` and `testServices` (Task 7), `investmentErrorResponse` / `parseJsonBody` / `isoDateSchema` (Task 7).
- Produces:
  - `ValuationService.latestBalance(accountId): Promise<AccountBalance | null>` — the account's latest `valuation` row
  - `InvestmentRefreshService.saveHoldings(accountId, holdings: HoldingInput[]): Promise<{ holdings: HoldingSnapshot[]; balance: AccountBalance | null; prices: PriceRefreshResult }>`. It prices the given securities via `this.prices.refresh({ securityIds })` (a pricing failure doesn't block saving), then calls `this.valuation.setHoldings`, then reads `this.valuation.latestBalance`. The holdings route and the Task 10 script both use it, so this sequence exists only once. `services.ts` needs no change: the method lives on the existing `refresh` instance.
  - Routes (Plan 3 calls these):
    - `PUT /api/investments/accounts/:id/holdings` body `{ holdings: [{ securityId, quantity }] }`. It prices those securities first (a price failure doesn't block saving), sets today's holdings, and returns `{ holdings: HoldingSnapshot[], balance: AccountBalance | null, prices: PriceRefreshResult }`.
    - `GET /api/investments/accounts/:id/balances` → `{ balances: AccountBalance[] }` (manual accounts, date desc)
    - `POST /api/investments/accounts/:id/balances` body `{ date: 'YYYY-MM-DD', balance: number }` → 201 `{ balance: AccountBalance }`
    - `DELETE /api/investments/accounts/:id/balances/:balanceId` → `{ success: true }`

- [ ] **Step 1: Write the failing tests**

`tests/integration/api/investment-account-apis.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { seedInvestmentAccount, seedSecurity, testServices } from '../../helpers/investments';
import { PriceProviderError } from '@/lib/prices/types';

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
import { PUT as putHoldings } from '@/app/api/investments/accounts/[id]/holdings/route';
import {
  GET as listBalances,
  POST as postBalance,
} from '@/app/api/investments/accounts/[id]/balances/route';
import { DELETE as deleteBalance } from '@/app/api/investments/accounts/[id]/balances/[balanceId]/route';

const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/investments', {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const params = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) });
/** Services on the test client, clock frozen at 2026-10-09T22:00Z, with this price feed. */
const useServices = (providerOpts: Parameters<typeof testServices>[1] = {}) =>
  vi.mocked(getInvestmentServices).mockResolvedValue(
    testServices(testPrisma, providerOpts).services
  );

describe('investment account APIs', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    useServices();
  });

  it('PUT holdings prices new securities, then saves holdings and balance', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    useServices({ closes: { AAA: { '2026-10-09': 25 } } });
    const res = await putHoldings(
      req('PUT', { holdings: [{ securityId: s.id, quantity: 4 }] }),
      params({ id: a.id })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings).toHaveLength(1);
    expect(body.balance).toMatchObject({ balance: 100, source: 'valuation' });
    expect(body.prices).toMatchObject({ fetched: 1 });
  });

  it('PUT holdings still saves when pricing fails', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    const failure = () => new PriceProviderError('network', 'fetch failed');
    useServices({ errors: { AAA: [failure(), failure()] } });
    const res = await putHoldings(
      req('PUT', { holdings: [{ securityId: s.id, quantity: 4 }] }),
      params({ id: a.id })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).balance).toBeNull();
  });

  it('PUT holdings validates', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
    expect((await putHoldings(req('PUT', { holdings: 'x' }), params({ id: a.id }))).status).toBe(
      400
    );
    expect((await putHoldings(req('PUT', { holdings: [] }), params({ id: a.id }))).status).toBe(
      400
    );
    expect(
      (await putHoldings(req('PUT', { holdings: [] }), params({ id: 'missing' }))).status
    ).toBe(404);
  });

  it('manual balances: record, list, delete', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    const created = await postBalance(
      req('POST', { date: '2026-10-01', balance: 1234.5 }),
      params({ id: a.id })
    );
    expect(created.status).toBe(201);
    const { balance } = await created.json();
    const list = await (await listBalances(req('GET'), params({ id: a.id }))).json();
    expect(list.balances.map((b: { id: string }) => b.id)).toEqual([balance.id]);
    const del = await deleteBalance(req('DELETE'), params({ id: a.id, balanceId: balance.id }));
    expect(await del.json()).toEqual({ success: true });
    expect(
      (await deleteBalance(req('DELETE'), params({ id: a.id, balanceId: balance.id }))).status
    ).toBe(404);
  });

  it('manual balances validate body and account kind', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'manual' });
    expect((await postBalance(req('POST', { date: '10/01/2026', balance: 1 }), params({ id: a.id }))).status).toBe(400);
    expect((await postBalance(req('POST', { date: '2026-10-10', balance: 1 }), params({ id: a.id }))).status).toBe(400);
    const p = await seedInvestmentAccount(testPrisma, { balanceSource: 'provider' });
    expect((await postBalance(req('POST', { date: '2026-10-01', balance: 1 }), params({ id: p.id }))).status).toBe(400);
  });
});
```

No fake timers: "today" comes from the services' fixed clock, and the retry in "still saves when pricing fails" uses `noSleep`, so the test doesn't wait 3 s.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/api/investment-account-apis.test.ts`
Expected: FAIL — route modules missing.

- [ ] **Step 3: Implement**

Add to `ValuationService` in `src/lib/investments/valuation.ts` (add `AccountBalance` to the `@prisma/client` type import):

```ts
  latestBalance(accountId: string): Promise<AccountBalance | null> {
    return this.prisma.accountBalance.findFirst({
      where: { accountId, source: 'valuation' },
      orderBy: { date: 'desc' },
    });
  }
```

Add to `InvestmentRefreshService` in `src/lib/investments/refresh.ts` (imports: `import type { AccountBalance, HoldingSnapshot } from '@prisma/client';` and `type HoldingInput` alongside `ValuationService` from `./valuation`):

```ts
  /** Price the securities first so today's snapshot and balance can use their closes. */
  async saveHoldings(
    accountId: string,
    holdings: HoldingInput[]
  ): Promise<{
    holdings: HoldingSnapshot[];
    balance: AccountBalance | null;
    prices: PriceRefreshResult;
  }> {
    const prices = await this.prices.refresh({ securityIds: holdings.map((h) => h.securityId) });
    const saved = await this.valuation.setHoldings(accountId, holdings);
    const balance = await this.valuation.latestBalance(accountId);
    return { holdings: saved, balance, prices };
  }
```

`src/app/api/investments/accounts/[id]/holdings/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../../../_lib/http';

const bodySchema = z.object({
  holdings: z.array(z.object({ securityId: z.string().min(1), quantity: z.number() })),
});

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema, 'Invalid holdings');
  if ('response' in body) return body.response;
  try {
    const { refresh } = await getInvestmentServices();
    return NextResponse.json(await refresh.saveHoldings(id, body.data.holdings));
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to save holdings');
  }
}
```

`src/app/api/investments/accounts/[id]/balances/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, isoDateSchema, parseJsonBody } from '../../../_lib/http';

const bodySchema = z.object({ date: isoDateSchema, balance: z.number() });

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { manualHoldings } = await getInvestmentServices();
    return NextResponse.json({ balances: await manualHoldings.list(id) });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load balances');
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(request, bodySchema, 'Invalid balance');
  if ('response' in body) return body.response;
  try {
    const { manualHoldings } = await getInvestmentServices();
    const balance = await manualHoldings.record(id, body.data);
    return NextResponse.json({ balance }, { status: 201 });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to record balance');
  }
}
```

`src/app/api/investments/accounts/[id]/balances/[balanceId]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse } from '../../../../_lib/http';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; balanceId: string }> }
) {
  const { id, balanceId } = await params;
  try {
    const { manualHoldings } = await getInvestmentServices();
    await manualHoldings.delete(id, balanceId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to delete balance');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/integration/api/investment-account-apis.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/refresh.ts src/lib/investments/valuation.ts "src/app/api/investments/accounts/[id]/holdings/route.ts" "src/app/api/investments/accounts/[id]/balances/route.ts" "src/app/api/investments/accounts/[id]/balances/[balanceId]/route.ts" tests/integration/api/investment-account-apis.test.ts
git commit -m "feat(investments): APIs for valued holdings and manual balance history"
```

---

### Task 9: Securities APIs — search, add, fix symbol, manual price

**Files:**
- Create: `src/lib/prices/securities.ts`, `src/app/api/investments/securities/search/route.ts`, `src/app/api/investments/securities/route.ts`, `src/app/api/investments/securities/[id]/route.ts`
- Modify: `src/lib/investments/services.ts` (add `quotes` and `catalog`)
- Test: `tests/unit/lib/prices/securities.test.ts`, `tests/integration/api/investment-securities-apis.test.ts`

**Interfaces:**
- Consumes: `QuoteCache`, `SymbolLookup`, `Clock`, `systemClock` (Task 1); `InvestmentInputError` (Task 4); `ValuationService.writeBalances` (Task 5); `createInvestmentServices` / `getInvestmentServices` / `testServices`, `investmentErrorResponse` / `parseJsonBody` (Task 7); `utcDay`.
- Produces:
  - `class SecurityCatalog { constructor(prisma: PrismaClient, lookup: SymbolLookup, quotes: QuoteCache, clock?: Clock) }` with:
    - `search(query: string): Promise<SymbolMatch[]>` — delegates to `lookup.search` so the search route stays thin and services don't expose the raw provider (quotes come only through `QuoteCache`, so `lookup` is narrowed to `search`)
    - `findOrCreateFeed(symbol: string): Promise<{ security: Security; created: boolean }>`. It reuses any security whose `priceSymbol` matches (case-insensitive input, stored upper-case), so a Plaid-reported VTI and a hand-entered VTI are the same `Security`. Otherwise it creates one from a quote (currency) and a search hit (name, type), with `pricing: 'feed'` and `priceSymbolOverride: true`. An unknown symbol throws `PriceProviderError('unknown_symbol')`.
    - `setPriceSymbol(id: string, symbol: string): Promise<Security>` — validates the symbol with a quote (unknown → `PriceProviderError('unknown_symbol')`), sets `pricing: 'feed'` and `priceSymbolOverride: true`, and deletes the old symbol's `yahoo` prices and events
    - `setManualPrice(id: string, price: number): Promise<Security>` — sets `pricing: 'manual'` and `priceSymbolOverride: true` and upserts a `manual` `SecurityPrice` on the clock's today. It does **not** revalue: the caller runs `valuation.writeBalances()` next, which keeps `SecurityCatalog` independent of valuation.
    - Both setters throw `InvestmentInputError('Security not found', 404)` for an unknown id.
  - `InvestmentServices` gains `quotes: QuoteCache` (one per process, so the 15-minute cache is shared) and `catalog: SecurityCatalog`.
  - `GET /api/investments/securities/search?q=` → `{ results: SymbolMatch[] }`
  - `POST /api/investments/securities` body `{ symbol }` → 201 `{ security }` when created, 200 when reused, 400 for an unknown symbol
  - `PATCH /api/investments/securities/:id` body `{ priceSymbol }` or `{ manualPrice }`.
    - `priceSymbol`: `catalog.setPriceSymbol`.
    - `manualPrice` (> 0): `catalog.setManualPrice`, then `valuation.writeBalances()`.
    - Either form returns `{ security }`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/prices/securities.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { fakeProvider, seedSecurity } from '../../../helpers/investments';
import { QuoteCache } from '@/lib/prices/quote-cache';
import { SecurityCatalog } from '@/lib/prices/securities';
import type { PriceProvider } from '@/lib/prices/types';

let prisma: PrismaClient;
const catalogFor = (provider: PriceProvider) =>
  new SecurityCatalog(prisma, provider, new QuoteCache(provider));

describe('SecurityCatalog.findOrCreateFeed', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('reuses an existing security with the same price symbol', async () => {
    const existing = await seedSecurity(prisma, { priceSymbol: 'VTI' });
    const { provider } = fakeProvider();
    const r = await catalogFor(provider).findOrCreateFeed('vti');
    expect(r).toMatchObject({ created: false, security: { id: existing.id } });
    expect(provider.getQuote).not.toHaveBeenCalled();
  });

  it('creates a feed security from quote and search', async () => {
    const { provider } = fakeProvider({
      closes: { 'TEQ.TO': { '2026-10-09': 30 } },
      currencies: { 'TEQ.TO': 'CAD' },
      search: {
        'TEQ.TO': [{ symbol: 'TEQ.TO', name: 'Test Equity ETF', type: 'etf', exchange: 'TOR' }],
      },
    });
    const { security, created } = await catalogFor(provider).findOrCreateFeed('teq.to');
    expect(created).toBe(true);
    expect(security).toMatchObject({
      ticker: 'TEQ',
      name: 'Test Equity ETF',
      type: 'etf',
      currency: 'CAD',
      priceSymbol: 'TEQ.TO',
      pricing: 'feed',
      priceSymbolOverride: true,
    });
  });

  it('throws for an unknown symbol', async () => {
    const { provider } = fakeProvider();
    await expect(catalogFor(provider).findOrCreateFeed('NOPE')).rejects.toMatchObject({
      kind: 'unknown_symbol',
    });
  });
});
```

`tests/integration/api/investment-securities-apis.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { NextRequest } from 'next/server';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  day,
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  testServices,
} from '../../helpers/investments';

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
import { GET as search } from '@/app/api/investments/securities/search/route';
import { POST as create } from '@/app/api/investments/securities/route';
import { PATCH as patch } from '@/app/api/investments/securities/[id]/route';

const json = (method: string, body: unknown) =>
  new NextRequest('http://localhost/api/investments/securities', {
    method,
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

describe('investment securities APIs', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    // Fresh services per test, so the quote cache starts empty. Clock: 2026-10-09T22:00Z.
    vi.mocked(getInvestmentServices).mockResolvedValue(
      testServices(testPrisma, {
        closes: { AAA: { '2026-10-09': 10 }, BBB: { '2026-10-09': 20 } },
        search: { aa: [{ symbol: 'AAA', name: 'Triple A', type: 'equity', exchange: 'NMS' }] },
      }).services
    );
  });

  it('GET search returns matches and requires q', async () => {
    const ok = await search(new NextRequest('http://localhost/api/investments/securities/search?q=aa'));
    expect(await ok.json()).toEqual({
      results: [{ symbol: 'AAA', name: 'Triple A', type: 'equity', exchange: 'NMS' }],
    });
    expect(
      (await search(new NextRequest('http://localhost/api/investments/securities/search'))).status
    ).toBe(400);
  });

  it('POST creates once, then reuses; unknown symbols are 400', async () => {
    const first = await create(json('POST', { symbol: 'AAA' }));
    expect(first.status).toBe(201);
    const again = await create(json('POST', { symbol: 'aaa' }));
    expect(again.status).toBe(200);
    expect((await create(json('POST', { symbol: 'NOPE' }))).status).toBe(400);
  });

  it('PATCH priceSymbol re-arms feed pricing and drops the old symbol prices', async () => {
    const s = await seedSecurity(testPrisma, { priceSymbol: 'OLD', pricing: 'none' });
    await seedPrice(testPrisma, s.id, '2026-10-01', 1);
    await seedPrice(testPrisma, s.id, '2026-10-01', 1, 'plaid');
    const res = await patch(json('PATCH', { priceSymbol: 'bbb' }), params(s.id));
    expect((await res.json()).security).toMatchObject({
      priceSymbol: 'BBB',
      pricing: 'feed',
      priceSymbolOverride: true,
    });
    expect(await testPrisma.securityPrice.count({ where: { securityId: s.id, source: 'yahoo' } })).toBe(0);
    expect(await testPrisma.securityPrice.count({ where: { securityId: s.id, source: 'plaid' } })).toBe(1);
  });

  it('PATCH manualPrice prices the security and revalues valued accounts', async () => {
    const a = await seedInvestmentAccount(testPrisma, { balanceSource: 'valuation' });
    const s = await seedSecurity(testPrisma, { priceSymbol: 'ZZZ', pricing: 'none' });
    await seedSnapshot(testPrisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 3,
      price: 0,
      source: 'manual',
    });
    const res = await patch(json('PATCH', { manualPrice: 7 }), params(s.id));
    expect((await res.json()).security).toMatchObject({ pricing: 'manual', priceSymbolOverride: true });
    expect(
      await testPrisma.accountBalance.findUnique({
        where: { accountId_date: { accountId: a.id, date: day('2026-10-09') } },
      })
    ).toMatchObject({ balance: 21, source: 'valuation' });
  });

  it('PATCH validates', async () => {
    const s = await seedSecurity(testPrisma);
    expect((await patch(json('PATCH', {}), params(s.id))).status).toBe(400);
    expect((await patch(json('PATCH', { manualPrice: -1 }), params(s.id))).status).toBe(400);
    expect((await patch(json('PATCH', { manualPrice: 1 }), params('missing'))).status).toBe(404);
    expect((await patch(json('PATCH', { priceSymbol: 'NOPE' }), params(s.id))).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices/securities.test.ts tests/integration/api/investment-securities-apis.test.ts`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`src/lib/prices/securities.ts`:

```ts
import type { PrismaClient, Security } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { InvestmentInputError } from '@/lib/investments/account-guard';
import { utcDay } from '@/lib/investments/dates';
import type { QuoteCache } from './quote-cache';
import type { SymbolLookup, SymbolMatch } from './types';

/** Finding, adding and repricing securities by hand (ticker search, symbol fixes, manual prices). */
export class SecurityCatalog {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly lookup: SymbolLookup,
    private readonly quotes: QuoteCache,
    private readonly clock: Clock = systemClock
  ) {}

  search(query: string): Promise<SymbolMatch[]> {
    return this.lookup.search(query);
  }

  async findOrCreateFeed(symbol: string): Promise<{ security: Security; created: boolean }> {
    const priceSymbol = symbol.trim().toUpperCase();
    const existing = await this.prisma.security.findFirst({
      where: { priceSymbol },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return { security: existing, created: false };

    const quote = await this.quotes.get(priceSymbol);
    let match: SymbolMatch | undefined;
    try {
      match = (await this.lookup.search(priceSymbol)).find(
        (m) => m.symbol.toUpperCase() === priceSymbol
      );
    } catch {
      match = undefined; // name/type are cosmetic; the quote already proved the symbol prices
    }
    const security = await this.prisma.security.create({
      data: {
        ticker: priceSymbol.split(/[.-]/)[0],
        name: match?.name ?? priceSymbol,
        type: match?.type ?? 'other',
        currency: quote.currency,
        priceSymbol,
        priceSymbolOverride: true,
        pricing: 'feed',
      },
    });
    return { security, created: true };
  }

  /** Point a security at a new feed symbol (validated by a quote) and drop the old symbol's data. */
  async setPriceSymbol(id: string, symbol: string): Promise<Security> {
    await this.requireSecurity(id);
    const priceSymbol = symbol.trim().toUpperCase();
    await this.quotes.get(priceSymbol); // throws unknown_symbol → 400
    const [security] = await this.prisma.$transaction([
      this.prisma.security.update({
        where: { id },
        data: { priceSymbol, priceSymbolOverride: true, pricing: 'feed' },
      }),
      this.prisma.securityPrice.deleteMany({ where: { securityId: id, source: 'yahoo' } }),
      this.prisma.securityEvent.deleteMany({ where: { securityId: id, source: 'yahoo' } }),
    ]);
    return security;
  }

  /** Price a security by hand from today. Callers revalue (`valuation.writeBalances()`) after. */
  async setManualPrice(id: string, price: number): Promise<Security> {
    await this.requireSecurity(id);
    const date = utcDay(this.clock.now());
    const [security] = await this.prisma.$transaction([
      this.prisma.security.update({
        where: { id },
        data: { pricing: 'manual', priceSymbolOverride: true },
      }),
      this.prisma.securityPrice.upsert({
        where: { securityId_date_source: { securityId: id, date, source: 'manual' } },
        create: { securityId: id, date, close: price, source: 'manual' },
        update: { close: price },
      }),
    ]);
    return security;
  }

  private async requireSecurity(id: string): Promise<void> {
    if (!(await this.prisma.security.findUnique({ where: { id }, select: { id: true } }))) {
      throw new InvestmentInputError('Security not found', 404);
    }
  }
}
```

In `src/lib/investments/services.ts`, add the two members (imports: `QuoteCache` from `@/lib/prices/quote-cache`, `SecurityCatalog` from `@/lib/prices/securities`):

```ts
export type InvestmentServices = {
  prices: PriceRefresher;
  quotes: QuoteCache;
  catalog: SecurityCatalog;
  manualHoldings: ManualHoldingService;
  valuation: ValuationService;
  history: ValueHistoryService;
  refresh: InvestmentRefreshService;
};
```

and in `createInvestmentServices`:

```ts
  const quotes = new QuoteCache(provider, clock);
  const catalog = new SecurityCatalog(prisma, provider, quotes, clock);
  // ...existing wiring...
  return {
    prices,
    quotes,
    catalog,
    manualHoldings,
    valuation,
    history: new ValueHistoryService(prisma),
    refresh: new InvestmentRefreshService(prices, valuation),
  };
```

`src/app/api/investments/securities/search/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse } from '../../_lib/http';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim();
  if (!q) return NextResponse.json({ error: 'Query is required' }, { status: 400 });
  try {
    const { catalog } = await getInvestmentServices();
    return NextResponse.json({ results: await catalog.search(q) });
  } catch (error) {
    return investmentErrorResponse(error, 'Search failed');
  }
}
```

`src/app/api/investments/securities/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../_lib/http';

const bodySchema = z.object({ symbol: z.string().trim().min(1).max(20) });

export async function POST(request: NextRequest) {
  const body = await parseJsonBody(request, bodySchema, 'Symbol is required');
  if ('response' in body) return body.response;
  try {
    const { catalog } = await getInvestmentServices();
    const { security, created } = await catalog.findOrCreateFeed(body.data.symbol);
    return NextResponse.json({ security }, { status: created ? 201 : 200 });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to add security');
  }
}
```

`src/app/api/investments/securities/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '../../_lib/http';

const bodySchema = z.union([
  z.object({ priceSymbol: z.string().trim().min(1).max(20) }),
  z.object({ manualPrice: z.number().positive() }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(
    request,
    bodySchema,
    'Provide priceSymbol or a positive manualPrice'
  );
  if ('response' in body) return body.response;
  try {
    const { catalog, valuation } = await getInvestmentServices();
    if ('priceSymbol' in body.data) {
      return NextResponse.json({ security: await catalog.setPriceSymbol(id, body.data.priceSymbol) });
    }
    const security = await catalog.setManualPrice(id, body.data.manualPrice);
    await valuation.writeBalances();
    return NextResponse.json({ security });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to update security');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices/securities.test.ts tests/integration/api/investment-securities-apis.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/prices/securities.ts src/lib/investments/services.ts src/app/api/investments/securities/search/route.ts src/app/api/investments/securities/route.ts "src/app/api/investments/securities/[id]/route.ts" tests/unit/lib/prices/securities.test.ts tests/integration/api/investment-securities-apis.test.ts
git commit -m "feat(investments): security search, add, symbol fix and manual price APIs"
```

---

### Task 10: Switch accounts to Valued (user-gated)

**Files:**
- Create: `scripts/lib/backup-db.ts`, `scripts/set-valuation-holdings.ts`
- Modify: `scripts/migrate-investment-accounts.ts` (delete its local `backupDatabase` and import it from `./lib/backup-db`)
- Local only (never committed): `~/Documents/FinanceOS-private/valuation-holdings.json`

**Interfaces:**
- Consumes: `createInvestmentServices` and its `catalog.findOrCreateFeed` (Task 9), `quotes.get` (Tasks 1/9), `refresh.saveHoldings` (Task 8), `manualHoldings.syncAll` (Task 4); `YahooPriceProvider` (Task 1); `loadFxRates` (Task 3); `getAccountBalance` (Plan 1).
- Produces: `backupDatabase(prisma): Promise<string>`; CLI `npx tsx scripts/set-valuation-holdings.ts <file> [--apply]`.

Holdings file format (example values only, synthetic):

```json
{
  "accounts": [
    {
      "accountId": "<account uuid>",
      "holdings": [
        { "symbol": "TEQ.TO", "quantity": 12.5 },
        { "symbol": "BTC-USD", "quantity": 0.1 }
      ]
    }
  ]
}
```

- [ ] **Step 1: Move the backup helper**

`scripts/lib/backup-db.ts` gets the body of `backupDatabase` from `scripts/migrate-investment-accounts.ts` (Plan 1), parameterised on the client:

```ts
import { existsSync, statSync } from 'node:fs';
import type { PrismaClient } from '@prisma/client';

/** Backs up the live database via the open connection; returns the backup path. */
export async function backupDatabase(prisma: PrismaClient): Promise<string> {
  const rows =
    await prisma.$queryRawUnsafe<{ name: string; file: string }[]>('PRAGMA database_list');
  const file = rows.find((r) => r.name === 'main')?.file;
  if (!file) throw new Error('Could not determine the main database file; aborting');
  const backup = `${file}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  if (!existsSync(backup) || statSync(backup).size === 0) {
    throw new Error(`Backup ${backup} is missing or empty; aborting before any write`);
  }
  return backup;
}
```

In `scripts/migrate-investment-accounts.ts`, delete the local function and change its call to `await backupDatabase(prisma)` with `import { backupDatabase } from './lib/backup-db';`. Remove `statSync`/`existsSync` from its `node:fs` import if they become unused.

- [ ] **Step 2: Write the script**

`scripts/set-valuation-holdings.ts`:

```ts
/**
 * Switch manual investment accounts to Valued (holdings × price) from a local, uncommitted file,
 * and backfill the single-holding mirror for accounts that stay manual.
 * Dry run by default; --apply backs up the database first.
 *   npx tsx scripts/set-valuation-holdings.ts ~/Documents/FinanceOS-private/valuation-holdings.json [--apply]
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma';
import { getAccountBalance } from '../src/lib/balances';
import { convertAmount } from '../src/lib/currency';
import { loadFxRates } from '../src/lib/prices/price-book';
import { YahooPriceProvider } from '../src/lib/prices/yahoo';
import { createInvestmentServices } from '../src/lib/investments/services';
import { backupDatabase } from './lib/backup-db';

const FileSchema = z.object({
  accounts: z
    .array(
      z.object({
        accountId: z.string().min(1),
        holdings: z
          .array(z.object({ symbol: z.string().min(1), quantity: z.number().positive() }))
          .min(1),
      })
    )
    .min(1),
});

const APPLY = process.argv.includes('--apply');
const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

async function main() {
  const path = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!path) throw new Error('Usage: set-valuation-holdings.ts <holdings.json> [--apply]');
  const config = FileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const services = createInvestmentServices({ prisma, provider: new YahooPriceProvider() });
  const rates = await loadFxRates(prisma);

  for (const entry of config.accounts) {
    const account = await prisma.account.findUniqueOrThrow({ where: { id: entry.accountId } });
    if (account.trackingMode !== 'investment' || account.balanceSource === 'provider') {
      throw new Error(`${account.name}: must be a manual or valued investment account`);
    }
    const current = await getAccountBalance(prisma, account.id);
    console.warn(`\n${account.name} (${account.currency}) — current ${fmt(current.balance)}`);
    let total = 0;
    for (const h of entry.holdings) {
      const quote = await services.quotes.get(h.symbol.toUpperCase());
      const value = convertAmount(h.quantity * quote.price, quote.currency, account.currency, rates);
      total += value;
      console.warn(
        `  ${h.symbol}: ${h.quantity} × ${fmt(quote.price)} ${quote.currency} = ${fmt(value)}`
      );
    }
    console.warn(`  valued at ~${fmt(total)} (latest quotes; stored closes may differ)`);
  }

  if (!APPLY) {
    console.warn('\nDry run — nothing written. Re-run with --apply to switch these accounts.');
    return;
  }

  console.warn(`\nBackup: ${await backupDatabase(prisma)}`);
  for (const entry of config.accounts) {
    const holdings = [];
    for (const h of entry.holdings) {
      const { security } = await services.catalog.findOrCreateFeed(h.symbol);
      holdings.push({ securityId: security.id, quantity: h.quantity });
    }
    await prisma.account.update({
      where: { id: entry.accountId },
      data: { balanceSource: 'valuation' },
    });
    await services.refresh.saveHoldings(entry.accountId, holdings);
    const after = await getAccountBalance(prisma, entry.accountId);
    console.warn(`Switched ${entry.accountId}: balance ${fmt(after.balance)} (${after.source})`);
  }
  // One-time backfill: migrated manual entries predate the single-holding mirror.
  console.warn(`Manual holdings rebuilt for ${await services.manualHoldings.syncAll()} account(s)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 3: Verify the build and run the suites**

Run: `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration`
Expected: typecheck clean, 0 lint errors, all tests pass. (The script has no unit test: every service method it calls is covered above, and its own logic is printing and ordering. It builds its own services with `createInvestmentServices` rather than `getInvestmentServices`, so it shares the script's Prisma client and disconnects cleanly.)

- [ ] **Step 4: Commit**

```bash
npm run lint:fix
git add scripts/lib/backup-db.ts scripts/set-valuation-holdings.ts scripts/migrate-investment-accounts.ts
git commit -m "feat(investments): script to switch accounts to valued holdings"
```

- [ ] **Step 5: USER-GATED — dry run on real data, then stop**

1. Ask the user for the positions of the accounts to switch (the plan intends the two manual accounts that hold listed securities; the Canadian group RRSP stays manual). Write them to `~/Documents/FinanceOS-private/valuation-holdings.json`, outside the repo. Never commit it, and never paste positions into commit messages or PR text.
2. Run: `npx tsx scripts/set-valuation-holdings.ts ~/Documents/FinanceOS-private/valuation-holdings.json`
3. Save the output next to the holdings file and **stop**. Report the dry-run output to the user: each account's current balance against its valued total. Do **not** run `--apply` without the user's explicit approval.

- [ ] **Step 6: After approval only — apply and spot-check**

1. Run the same command with `--apply`. Confirm the backup path is printed.
2. Each switched account: `balanceSource = 'valuation'`, today's `AccountBalance` has `source: 'valuation'`, and its earlier manual rows are untouched.
3. With the dev server running: `curl -s -X POST localhost:3000/api/investments/refresh` reports `stopped: false`, and `curl -s 'localhost:3000/api/investments/history?accountId=<id>&from=<30 days ago>'` returns a continuous series.
4. Remaining manual account: `GET /api/investments/accounts/<id>/balances` lists its migrated entries, and it has one holding snapshot per entry.
5. Report the results to the user.

---

## Handed to Plan 3

- The page-shaped read models: current holdings per account, the cross-account aggregation by `Security`, the range price change for the treemap, allocation buckets, and the activity feed (merging a dividend with its same-day reinvestment).
- The "migrated from adjustments" label on manual balance entries. It needs a way to identify those rows; no current field can.
- UI wiring: call `POST /api/investments/refresh` when the investments view opens and show `pricesAsOf`; flag `pricing = 'none'` securities with **Set symbol** (`PATCH /api/investments/securities/:id`).
