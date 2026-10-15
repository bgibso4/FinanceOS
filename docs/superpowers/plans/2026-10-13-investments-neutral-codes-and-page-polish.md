# Investments: Vendor-Neutral Codes and Page Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Investment and price code stores and names things without vendor names, and the investments page gains 3Y/All ranges, a light y axis and expandable multi-account holdings rows.

**Architecture:**
- **Codes:** one module, `src/lib/investments/codes.ts`, holds every stored code as an `as const` object plus a union type. Task 1 moves all code onto it with today's values. Task 2 flips the values, renames existing rows automatically once per server process (inside `getInvestmentServices`, before any service is returned), and teaches the cloud-sync import to translate old snapshots.
- **Names and copy:** strategy classes, the backfill constant, the symbol hint (`PriceProvider.symbolHint` → overview → page) and UI copy become neutral. The holdings read model loses its per-row institution quote and the pricing pills go.
- **Page:** `ValueHistoryService.earliestDay` gives the "All" range its start; `chart-geometry` gives the y-axis values; `holdingLines` gives each line one member per account for the expandable rows.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma 5.22 + SQLite, Zod v4 (4.6.5), Vitest + Testing Library (jsdom 27).

**Spec:** `docs/superpowers/specs/2026-10-13-investments-neutral-codes-and-page-polish-design.md`. Approved mocks: `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/ranges-yaxis.html` (section 1: chips, y axis) and `holdings-securities.html` (screen 1: holdings rows). Their numbers are synthetic; never copy them into fixtures as if real.

## Rulings while writing

1. **Task 1 converts test files too, not only `tests/helpers`.** Every test literal of the five source/pricing families moves onto the enums while the values are unchanged, so Task 2's flip needs no test edits and the suite proves the flip. `SecurityType` literals in tests stay: their values never change, and many are Plaid's own fixture input (`type: 'etf'` on a Plaid `Security`).
2. **The cloud-sync translation runs after the checksum check.** A zod `.transform` inside `SyncDataSchema` would change the data `importDatabase` hashes, so every legacy snapshot would fail with "checksum mismatch". Task 2 adds `SyncImportDataSchema` (the same zod schemas, extended with legacy-mapping transforms) and `importDatabase` parses through it after verifying the checksum. Export is untouched; it writes whatever the database holds.
3. **`LEGACY_CODES` lives in `codes.ts`**, shared by the rename function and the cloud-sync import (DRY). It is the only place old values appear in `src/`; its keys are unquoted, so the lint guard stays clean.
4. **The rename runs itself (controller ruling, spec §3 as amended).** `renameStoredSourceCodes` lives in `src/lib/investments/rename-stored-codes.ts` (testable on the test DB). `ensureStoredCodes` memoises it per process, and `getInvestmentServices()` awaits it before returning, so concurrent first requests share one run and no service reads an old value. `createInvestmentServices` (tests) never runs it. `scripts/rename-stored-codes.ts` is a thin manual re-run that prints counts; it has no backup step, since the rename is idempotent and needs no user ceremony. The clash handling stays: if new-code closes ever exist beside old ones on the same day (a copy restored mid-change, or a row written before the rename), `SecurityPrice @@unique([securityId, date, source])` would reject the rename. So the function drops the legacy duplicate (the new row is fresher) and reports it.
5. **Plaid naming that stays, all out of scope per spec §2:** `overview.ts`'s `plaidConnection`/`plaidEnrollment` reads; `sync-status.ts` (writes `PlaidConnection`); `migration.ts`, the one-off Plaid linking migration, where only its stored codes change; `account-detail.tsx`'s `PlaidReconnectButton` (bank reconnection). The composition root `services.ts` keeps importing `YahooPriceProvider`, because that is where the gateway gets wired; its comment becomes neutral.
6. **Lint-guard scope:** `src/lib/investments`, `src/lib/prices`, `src/components/investments`, `src/app/api/investments`, `src/app/(routes)/investments` and `src/lib/balances.ts`, minus the three gateway files. Spec §1's other boundaries (`src/app/api/plaid/*`, `src/components/plaid/*`) sit outside this scope anyway. The guard is case-sensitive, as the spec asks: it looks for the stored values `'plaid'`, `'yahoo'` and `'feed'`. UI copy is covered by Task 3's tests and grep.
7. **Adjustment copy:** the synced case reads "This account's balance is set by its connection". The valued case keeps "This account's balance comes from its holdings".
8. **Year labels:** `AccountDetail` decides them with `spansYear(overview.from, overview.today)` (≥ 365 days). So 1Y and 3Y always show years, and All shows them only when its data reaches back a year. `ValueChart` takes a `yearLabels` prop.
9. **`rangeStart` takes `FixedRange`** (every range except All). The overview asks `ValueHistoryService.earliestDay` for All, so the pure helper never queries the database.
10. **Pills:** the price pills and the read-model quote go in Task 3. The account-count pill goes in Task 6, which replaces it with the chevron. `PricePillButton` is deleted, since nothing uses it any more.
11. **`BALANCE_SOURCES` is deleted.** The two accounts API routes validate with `z.enum(BalanceSource)`. Zod 4 accepts enum objects, so `codes.ts` exports no zod schemas; each validation site builds `z.enum(<Enum>)`.

## Global Constraints

- **Design principles: DRY > YAGNI > SOLID, all important.**
  - Before writing a helper, query, schema or pattern, look for an existing one in the codebase or an earlier task, and reuse or extract it rather than repeat it.
  - Build nothing that no task or spec requirement uses.
  - Keep each module single-purpose, with its dependencies (`prisma`, price provider, clock) passed in.
  - When the principles conflict, DRY beats YAGNI and YAGNI beats SOLID.
  - Reviewers flag violations as Important.
- **Object-oriented core:**
  - Stateful or dependency-holding services are classes taking their dependencies in the constructor. `src/lib/investments/services.ts` is the one place production instances are wired.
  - Pricing modes are `PricingStrategy` classes chosen only in `pricingFor`.
  - Tests construct classes directly or use `testServices(...)`. Never `vi.mock` our own modules, except `@/lib/prisma` and `@/lib/investments/services` in route tests.
  - Pure helpers (`holdings-view.ts`, `portfolio-view.ts`, `src/components/investments/*.ts`) stay functions.
- **Schema:** no structural change. Task 2 edits only comments in `prisma/schema.prisma`, so no `db push` is needed. Never run `prisma migrate dev`. Never read `.env`. Never print values from `prisma/dev.db`.
- **Dates:** all UTC. Day values are `YYYY-MM-DD` strings in the API. Display dates are formatted with `timeZone: 'UTC'`.
- **Zod is v4:** `z.enum(SomeConstObject)` accepts an `as const` object. `z.number()` already rejects `NaN`/`Infinity`.
- **No real network in tests:** unit and integration tests never reach Yahoo or Plaid. Use `fakeProvider` / `testServices` from `tests/helpers/investments.ts`. Component tests mock `global.fetch` (pattern in `tests/unit/components/investments/editors.test.tsx`).
- **UI conventions:**
  - Client components start with `'use client'`.
  - Colours only via CSS variables (`var(--accent)`, `var(--text-muted)`, `var(--text-secondary)`, `var(--bg-elevated)`, `var(--border)`, `var(--border-hover)`, `var(--grid-line)` …). No new hex colours.
  - Numbers, tickers and dates use `font-mono`.
  - Reuse `Modal`, `Button`, `Input` from `src/components/ui/`.
  - Copy (labels, hints, errors) is verbatim from this plan.
- **The GitHub repo is public:** no account names, masks, balances, holdings or other personal data in committed code, tests, fixtures or copy. Tests use synthetic data (`Example Brokerage`, `AAA`, `Triple A Fund` …). Never take values from the local database or from the mocks. No real holding names.
- **No vendor names (Plaid, Teller, Yahoo) outside the boundary files listed in the spec §1. Stored codes come only through the enums in `src/lib/investments/codes.ts`; no bare stored-value strings in code.** Tests use the enums too, except where a test checks the legacy translation (spec §7).
- **Out-of-scope bank-connection code (spec §2) is not touched.** That covers `PlaidConnection`/`TellerConnection`, the Settings forks, Connected Institutions, the adopt/ignored-account routes, `bank-errors`, `sync-grouping` and `PLAID_ENCRYPTION_KEY`. Their tests' `provider: 'plaid'` literals are bank-connection values, not investment codes; leave them.
- **Lint:**
  - Only `console.warn` / `console.error`. Prefix unused vars with `_`.
  - Single quotes, semicolons, 100-char lines. JSX props sorted (`react/jsx-sort-props`, reserved first, callbacks last).
  - Run `npm run lint:fix` before each commit.
- **Line numbers** in every task are as of commit `314e00d`. Task 1 adds one import line near the top of most files it touches, so later tasks' numbers can sit a line or two lower. The quoted code is the anchor; the number is a hint.
- **Tests:** Vitest. DB tests use `setupTestDb` / `resetTestDb` / `teardownTestDb` from `tests/helpers/db.ts`. Run one file with `npx vitest run <path>`.
- **Git:**
  - Stage explicit paths only; never stage `.claude/` or `.superpowers/`.
  - `docs/` is gitignored. Add docs with `git add -f`, and lint-staged's "paths are ignored" message is harmless.
  - Commit messages end with the Co-Authored-By trailer from your system reminder.

## Review Focus

1. **New-code closes already beside old ones, and concurrent first requests.** If both exist on the same days, the start-up rename must not crash on the unique `(securityId, date, source)` key, since a crash would fail every investments request. It keeps the new close and drops the duplicate. Two first requests at once must share one rename, and a failed run must be retried rather than cached. *Task 2 tests: "drops a legacy close that clashes with one already stored under the new code", "renames once per process, with concurrent callers sharing one run" and "lets the next caller retry after a failed run".*
2. **Restoring a cloud snapshot uploaded before the change.** The checksum must still verify, and every old code must land as its new code. *Task 2 test: "imports a snapshot uploaded before the neutral codes, translating every legacy code".*
3. **"All" with no investment data, or with data only on inactive accounts.** All starts today, the chart shows its placeholder, and a closed account's old balance doesn't stretch the range. *Task 4 test: "is today when no active account has a value, ignoring inactive accounts".*
4. **A manual account's y axis.** Its floor is lowered to 80 % of the last value, so the labels must come from the chart's geometry, not from the raw min and max. *Task 5 test: "labels a manual account’s axis from its lowered floor".*
5. **Cash and money market in one account, and a line that shrinks to one account.** They make one sub-line for that account, not two lines with the same name. A line that a reload leaves in one account loses its chevron and sub-lines. *Task 6 tests: "groups cash and money market held in one account into one member" and "drops the chevron when a reload leaves the line in one account".*

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/investments/codes.ts` (new) | every stored code as an `as const` enum + union type; `LEGACY_CODES` | 1, 2 |
| `src/lib/investments/rename-stored-codes.ts` (new) | `renameStoredSourceCodes(prisma)`: idempotent rename with counts; `ensureStoredCodes(prisma)`: once per process | 2 |
| `scripts/rename-stored-codes.ts` (new) | thin manual re-run: rename, print counts | 2 |
| `src/lib/investments/services.ts` | `getInvestmentServices` awaits `ensureStoredCodes` first; `symbolHint` wiring | 2, 3 |
| `src/lib/cloud-sync/types.ts`, `src/lib/cloud-sync/sync.ts` | `SyncImportDataSchema` / `upgradeLegacyCodes`, applied after the checksum check | 2 |
| `prisma/schema.prisma` | comments name the enums instead of vendor values | 2 |
| `src/lib/prices/{pricing,refresh,securities,types,yahoo,trading-days}.ts` | enums; neutral strategy names; `symbolHint`; `BACKFILL_DAYS` | 1, 3 |
| `src/lib/investments/{history,overview,current-holdings,holdings-view,valuation,manual-holding,migration,account-guard,plaid-mapping,plaid-investment-sync,refresh,services,activity,portfolio-view}.ts` | enums; neutral names/comments; read-model quote removal; `earliestDay`; ranges; members | 1, 3, 4, 6 |
| `src/lib/balances.ts`, `src/lib/account-defaults.ts`, `src/app/api/accounts/route.ts`, `src/app/api/accounts/[id]/route.ts` | `BalanceRowSource`/`BalanceSource` replace bare strings and `BALANCE_SOURCES` | 1 |
| `src/app/api/transactions/adjustment/route.ts` | enums; neutral error | 1, 3 |
| `scripts/set-valuation-holdings.ts` | enums | 1 |
| `src/components/investments/{account-states,pills,holdings-editor-modal}.ts(x)` | enums; "Synced" pill; `PricePillButton` removed | 1, 3 |
| `src/components/investments/set-symbol-modal.tsx` | `hint` prop; institution section and copy | 3 |
| `src/components/investments/holdings-table.tsx` | no pills (3); chevrons and per-account sub-lines (6) | 3, 6 |
| `src/components/investments/account-detail.tsx`, `src/app/(routes)/investments/page.tsx` | wiring: hint, year labels, table key/accounts | 3, 4, 6 |
| `src/components/investments/format.ts` | `fmtDay(iso, { year })`, `spansYear` | 4 |
| `src/components/investments/chart-geometry.ts` | `GRIDLINES`, `min`/`span` on the geometry, `gridValues` | 5 |
| `src/components/investments/value-chart.tsx` | year labels (4); y-axis gutter (5) | 4, 5 |
| `tests/unit/lint/vendor-literals.test.ts` (new) | the spec §7 lint guard | 2 |

---

### Task 1: Stored-code enums with today's values (pure refactor)

No behaviour changes in this task: every stored value stays as it is and the whole suite passes unchanged except for the new test.

**Files:**
- Create: `src/lib/investments/codes.ts`, `tests/unit/lib/investments/codes.test.ts`
- Modify (src): every file in the **src table** below
- Modify (tests): every file in the **test table** below, plus `tests/unit/components/investments/display.test.tsx:133`

**Interfaces:**
- Produces (from `@/lib/investments/codes`; each name is both a value and a union type):
  - `Pricing` `{ Market, Institution, Fixed, Manual, None }`, holding the values `'feed' | 'plaid' | 'fixed' | 'manual' | 'none'` in this task
  - `PriceSource` `{ Market, Institution, Manual }`, values `'yahoo' | 'plaid' | 'manual'`
  - `RecordSource` `{ Synced, Manual, Import }`, values `'plaid' | 'manual' | 'import'`
  - `BalanceRowSource` `{ Synced, Valuation, Manual }`, values `'plaid' | 'valuation' | 'manual'`
  - `BalanceSource` `{ Provider, Valuation, Manual }`, values `'provider' | 'valuation' | 'manual'`
  - `SecurityType` `{ Etf, Equity, MutualFund, MoneyMarket, Cash, Crypto, Other }`
- Removes: `BALANCE_SOURCES` and `type BalanceSource` from `src/lib/account-defaults.ts`; `type SecurityType` and `type Pricing` from `src/lib/investments/plaid-mapping.ts`.
- `ResolvedBalance.source` becomes `'transactions' | BalanceRowSource`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/lib/investments/codes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  BalanceRowSource,
  BalanceSource,
  PriceSource,
  Pricing,
  RecordSource,
  SecurityType,
} from '@/lib/investments/codes';

const FAMILIES: [string, Record<string, string>][] = [
  ['Pricing', Pricing],
  ['PriceSource', PriceSource],
  ['RecordSource', RecordSource],
  ['BalanceRowSource', BalanceRowSource],
  ['BalanceSource', BalanceSource],
  ['SecurityType', SecurityType],
];

describe('stored codes', () => {
  it.each(FAMILIES)('%s round-trips its zod enum', (_name, codes) => {
    const schema = z.enum(codes);
    const values = Object.values(codes);
    expect(values.map((v) => schema.parse(v))).toEqual(values);
    expect(new Set(values).size).toBe(values.length);
    expect(schema.safeParse('unknown-code').success).toBe(false);
  });

  it('keeps the values stored today', () => {
    expect([
      Pricing.Market,
      Pricing.Institution,
      PriceSource.Market,
      PriceSource.Institution,
      RecordSource.Synced,
      BalanceRowSource.Synced,
    ]).toEqual(['feed', 'plaid', 'yahoo', 'plaid', 'plaid', 'plaid']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/lib/investments/codes.test.ts`
Expected: FAIL, because `@/lib/investments/codes` doesn't exist.

- [ ] **Step 3: Create the codes module**

Create `src/lib/investments/codes.ts`:

```ts
/**
 * Every code stored for investment data (spec 2026-10-13 §3). Database columns stay strings;
 * code reads and writes them only through these objects, never as bare strings.
 */

/** `Security.pricing`: how a security gets its price. */
export const Pricing = {
  /** Daily closes from the market data provider. */
  Market: 'feed',
  /** The price the account's institution reports with each sync. */
  Institution: 'plaid',
  /** A constant `fixedPrice` (cash: 1). */
  Fixed: 'fixed',
  /** Prices entered by hand. */
  Manual: 'manual',
  /** No price source; valued at its last known price. */
  None: 'none',
} as const;
export type Pricing = (typeof Pricing)[keyof typeof Pricing];

/** `SecurityPrice.source`, `SecurityEvent.source`: where a stored price or event came from. */
export const PriceSource = { Market: 'yahoo', Institution: 'plaid', Manual: 'manual' } as const;
export type PriceSource = (typeof PriceSource)[keyof typeof PriceSource];

/** `HoldingSnapshot.source`, `InvestmentTransaction.source`: how a record arrived. */
export const RecordSource = { Synced: 'plaid', Manual: 'manual', Import: 'import' } as const;
export type RecordSource = (typeof RecordSource)[keyof typeof RecordSource];

/** `AccountBalance.source`: what wrote a balance row. */
export const BalanceRowSource = {
  Synced: 'plaid',
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
```

Run: `npx vitest run tests/unit/lib/investments/codes.test.ts`
Expected: PASS.

- [ ] **Step 4: Replace the literals in `src` (and the one script)**

Line numbers are as of commit `314e00d`. Within each file, replace the literals first, then add the import at the top. Each table names the import to add; import only those names (value import, `import { … }`, unless marked *type*).

**`src/lib/investments/plaid-mapping.ts`.** Replace lines 1–20 (the imports, `PLAID_TRADE_HISTORY_DAYS` and the two type aliases) with:

```ts
import type {
  Security as PlaidSecurity,
  Holding,
  InvestmentTransaction as PlaidInvestmentTransaction,
  Transaction as PlaidTransaction,
} from 'plaid';
import { Pricing, SecurityType } from './codes';
import { utcDay } from './dates';

/** How far back Plaid returns investment transactions (24 months). */
export const PLAID_TRADE_HISTORY_DAYS = 730;
```

`MappedSecurity` keeps `type: SecurityType; pricing: Pricing;`, which now resolve to the enum types. Replace `securityType` and `mapSecurity` (lines 62–102) with the following. The `case` labels and `s.type === 'cash'` are Plaid's own input values and stay as strings:

```ts
function securityType(s: PlaidSecurity): SecurityType {
  if (s.type === 'cash') return SecurityType.Cash;
  if (s.is_cash_equivalent) return SecurityType.MoneyMarket;
  switch (s.type) {
    case 'etf':
      return SecurityType.Etf;
    case 'equity':
      return SecurityType.Equity;
    case 'mutual fund':
      return SecurityType.MutualFund;
    case 'cryptocurrency':
      return SecurityType.Crypto;
    default:
      return SecurityType.Other;
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
  if (type === SecurityType.Cash || type === SecurityType.MoneyMarket) {
    return { ...base, priceSymbol: null, pricing: Pricing.Fixed, fixedPrice: 1 };
  }
  if (type === SecurityType.Crypto && ticker) {
    return {
      ...base,
      priceSymbol: `${ticker}-${currency}`,
      pricing: Pricing.Market,
      fixedPrice: null,
    };
  }
  if (ticker && PUBLIC_TICKER.test(ticker)) {
    const suffix = MIC_SUFFIX[s.market_identifier_code ?? ''] ?? '';
    return { ...base, priceSymbol: ticker + suffix, pricing: Pricing.Market, fixedPrice: null };
  }
  return { ...base, priceSymbol: null, pricing: Pricing.Institution, fixedPrice: null };
}
```

**`src/lib/balances.ts`.** Replace lines 1–13 with:

```ts
import type { PrismaClient } from '@prisma/client';
import { BalanceRowSource, BalanceSource } from '@/lib/investments/codes';

export type ResolvedBalance = {
  balance: number;
  asOf: Date | null;
  source: 'transactions' | BalanceRowSource;
};

/** The source an investment account reports before it has any balance row. */
const SOURCE_FOR_EMPTY: Record<string, BalanceRowSource> = {
  [BalanceSource.Provider]: BalanceRowSource.Synced,
  [BalanceSource.Valuation]: BalanceRowSource.Valuation,
  [BalanceSource.Manual]: BalanceRowSource.Manual,
};
```

and line 64 with:

```ts
              source: SOURCE_FOR_EMPTY[balanceSource ?? BalanceSource.Manual] ?? BalanceRowSource.Manual,
```

(`npm run lint:fix` rewraps it.)

**`src/lib/account-defaults.ts`.** Delete lines 11–12 (`BALANCE_SOURCES` and `type BalanceSource`).

**`src/app/api/accounts/route.ts` and `src/app/api/accounts/[id]/route.ts`.** On line 4, drop `BALANCE_SOURCES` from the `@/lib/account-defaults` import and add `import { BalanceSource } from '@/lib/investments/codes';`. On line 14, write `balanceSource: z.enum(BalanceSource).optional().nullable(),`.

**`src/lib/investments/account-guard.ts`.** Add `import type { BalanceSource } from './codes';` and change line 16 to `balanceSource: typeof BalanceSource.Valuation | typeof BalanceSource.Manual`.

**src table** (every other site):

| File (import to add) | Line(s): old → new |
|---|---|
| `src/lib/prices/types.ts` | 1: `from '@/lib/investments/plaid-mapping'` → `from '@/lib/investments/codes'` (stays `import type { SecurityType }`) |
| `src/lib/prices/yahoo.ts` (`SecurityType`, replacing line 3's import) | 44–48: `'equity'`, `'etf'`, `'mutual_fund'`, `'crypto'`, `'money_market'` → `SecurityType.Equity`, `.Etf`, `.MutualFund`, `.Crypto`, `.MoneyMarket`; 138: `?? 'other'` → `?? SecurityType.Other` |
| `src/lib/prices/pricing.ts` (`Pricing, PriceSource`) | 50, 66: `'plaid'` → `PriceSource.Institution`; 69, 85: `'yahoo'` → `PriceSource.Market`; 93: `'manual'` → `PriceSource.Manual`; 104–108 map keys `'fixed'`, `'feed'`, `'plaid'`, `'manual'`, `'none'` → `Pricing.Fixed`, `Pricing.Market`, `Pricing.Institution`, `Pricing.Manual`, `Pricing.None`; 119: `=== 'plaid'` → `=== Pricing.Institution` |
| `src/lib/prices/refresh.ts` (`Pricing, PriceSource, RecordSource`) | 66, 191: `pricing: 'feed'` → `Pricing.Market`; 105: `'none'` → `Pricing.None`; 167, 268, 269, 282: `'yahoo'` → `PriceSource.Market`; 233, 241: `source: 'plaid'` → `RecordSource.Synced` |
| `src/lib/prices/securities.ts` (`Pricing, PriceSource, SecurityType`) | 43: `?? 'other'` → `SecurityType.Other`; 47, 91: `'feed'` → `Pricing.Market`; 58: `type: 'cash', pricing: 'fixed'` → `SecurityType.Cash`, `Pricing.Fixed`; 66: `'cash'` → `SecurityType.Cash`; 70: `'fixed'` → `Pricing.Fixed`; 96, 97: `'yahoo'` → `PriceSource.Market`; 109: `'manual'` → `Pricing.Manual`; 112, 113: `'manual'` → `PriceSource.Manual`; 128: `!== 'plaid'` → `Pricing.Institution`; 136: `!== 'feed'` → `Pricing.Market` |
| `src/lib/prices/trading-days.ts` (`SecurityType`) | 12: `securityType === 'crypto'` → `securityType === SecurityType.Crypto` (the returned `'crypto'`/`'exchange'` are `Market` values, not stored codes; keep them) |
| `src/lib/investments/manual-holding.ts` (`BalanceRowSource, BalanceSource, Pricing, PriceSource, RecordSource, SecurityType` from `./codes`) | 19, 41, 50, 63: `'manual'` arg → `BalanceSource.Manual`; 32, 34, 43, 52, 67: `source: 'manual'` → `BalanceRowSource.Manual`; 87: `type: 'other'` → `SecurityType.Other`; 89: `pricing: 'manual'` → `Pricing.Manual`; 105: snapshot `source: 'manual'` → `RecordSource.Manual`; 109: price `source: 'manual'` → `PriceSource.Manual`; 118: `balanceSource: 'manual'` → `BalanceSource.Manual` |
| `src/lib/investments/history.ts` (`BalanceRowSource, BalanceSource, RecordSource, SecurityType` from `./codes`) | 73: `'provider'` → `BalanceSource.Provider`; 95: `'valuation'` → `BalanceRowSource.Valuation`; 155: `'plaid'` → `RecordSource.Synced`; 193: `s.type === 'cash'` → `SecurityType.Cash`. Line 273's `x.type === 'cash'` is an `InvestmentTransaction.type`; keep it. |
| `src/lib/investments/current-holdings.ts` (`BalanceSource, Pricing, RecordSource, SecurityType` from `./codes`) | 17: `{ cash: 'Cash', money_market: 'Money market' }` → `{ [SecurityType.Cash]: 'Cash', [SecurityType.MoneyMarket]: 'Money market' }`; 28: `'valuation'` → `BalanceSource.Valuation`; 55: `s.source === 'plaid'` → `RecordSource.Synced`; 63: `'none'`, `'fixed'` → `Pricing.None`, `Pricing.Fixed`; 100: `!== 'plaid'` → `Pricing.Institution` |
| `src/lib/investments/migration.ts` (`BalanceRowSource, BalanceSource` from `./codes`) | 28: `z.enum(['provider', 'valuation', 'manual'])` → `z.enum(BalanceSource)`; 53: `'provider' \| 'valuation' \| 'manual'` → `BalanceSource`; 114, 211: `'provider'` → `BalanceSource.Provider`; 194: `source: 'manual'` → `BalanceRowSource.Manual` |
| `src/lib/investments/valuation.ts` (`BalanceRowSource, BalanceSource, Pricing, RecordSource` from `./codes`) | 22, 121, 169, 175, 183, 185: `'valuation'` (balance rows) → `BalanceRowSource.Valuation`; 30, 79, 94: `'valuation'` (account) → `BalanceSource.Valuation`; 61: `source: 'manual'` → `RecordSource.Manual`; 147: `!== 'fixed'` → `Pricing.Fixed` |
| `src/lib/investments/overview.ts` (replace line 2 with `import { BalanceSource, Pricing, RecordSource } from './codes';`) | 114: `'plaid'` → `RecordSource.Synced`; 138: `?? 'manual'` → `?? BalanceSource.Manual`; 156: `'manual'` → `BalanceSource.Manual`; 158: `'valuation'` → `BalanceSource.Valuation`; 169: `'none'` → `Pricing.None`; 171: `'provider'` → `BalanceSource.Provider` |
| `src/lib/investments/holdings-view.ts` (`Pricing, SecurityType` from `./codes`) | 82: `'none'` → `Pricing.None`; 99–104 keys → `[SecurityType.Etf]: 'ETF'`, `[SecurityType.Equity]: 'Stock'`, `[SecurityType.MutualFund]: 'Mutual fund'`, `[SecurityType.Cash]: 'Cash & MM'`, `[SecurityType.MoneyMarket]: 'Cash & MM'`, `[SecurityType.Crypto]: 'Crypto'` |
| `src/lib/investments/plaid-investment-sync.ts` (`BalanceRowSource, Pricing, PriceSource, RecordSource` from `./codes`) | 68: `'none'` → `Pricing.None`; 126, 148, 219, 240: `'plaid'` → `RecordSource.Synced`; 203, 205: `'plaid'` → `BalanceRowSource.Synced`; 249, 250: `'plaid'` → `PriceSource.Institution` |
| `src/components/investments/account-states.ts` (line 1 becomes `import { BalanceSource } from '@/lib/investments/codes';`) | 42: `'valuation'` → `BalanceSource.Valuation`; 83/89/91 keys `provider:`, `valuation:`, `manual:` → `[BalanceSource.Provider]:`, `[BalanceSource.Valuation]:`, `[BalanceSource.Manual]:`; 100, 104: `'manual'` → `BalanceSource.Manual` |
| `src/components/investments/pills.tsx` (line 4 becomes `import { BalanceSource } from '@/lib/investments/codes';`) | 12/16/20 keys → `[BalanceSource.Provider]:`, `[BalanceSource.Valuation]:`, `[BalanceSource.Manual]:` |
| `src/components/investments/account-detail.tsx` (`BalanceSource` from `@/lib/investments/codes`) | 122, 158: `'manual'` → `BalanceSource.Manual`; 167: `'valuation'` → `BalanceSource.Valuation` |
| `src/components/investments/holdings-editor-modal.tsx` (`Pricing` from `@/lib/investments/codes`) | 51, 110: `=== 'none'` → `=== Pricing.None` |
| `src/app/api/transactions/adjustment/route.ts` (`BalanceSource` from `@/lib/investments/codes`) | 30: `'manual'` → `BalanceSource.Manual`; 31: `'provider'` → `BalanceSource.Provider` |
| `scripts/set-valuation-holdings.ts` (`BalanceSource` from `'../src/lib/investments/codes'`) | 70: `'provider'` → `BalanceSource.Provider`; 115: `'valuation'` → `BalanceSource.Valuation` |

- [ ] **Step 5: Replace the literals in tests**

Same rule: line numbers as of `314e00d`, replace first, then add one import line `import { … } from '@/lib/investments/codes';` naming exactly the enums that file's row lists. Each cell is `Enum.Member` followed by the lines where the quoted literal becomes it. The literal there is the one whose value matches the member today; for example `Pricing.Market` replaces `'feed'`, and `RecordSource.Synced` replaces `'plaid'`.

| File | Replacements |
|---|---|
| `tests/helpers/investment-overview.ts` | `BalanceSource.Provider` 21; `Pricing.Market` 43 |
| `tests/helpers/investments.ts` | `BalanceRowSource.Synced` 115; `BalanceSource.Provider` 46; `PriceSource.Market` 105; `Pricing.Market` 70; `RecordSource.Synced` 95, 146 (see the note below) |
| `tests/integration/api/balance-call-sites.test.ts` | `BalanceRowSource.Synced` 45; `BalanceSource.Provider` 35 |
| `tests/integration/api/cloud-sync-investments.test.ts` | `BalanceRowSource.Synced` 68, 189; `BalanceSource.Provider` 35, 109, 180; `PriceSource.Institution` 71; `PriceSource.Market` 74; `Pricing.Institution` 62; `Pricing.Market` 54, 126; `RecordSource.Synced` 84, 98 |
| `tests/integration/api/investment-account-apis.test.ts` | `BalanceRowSource.Valuation` 67; `BalanceSource.Manual` 103, 120; `BalanceSource.Provider` 129; `BalanceSource.Valuation` 57, 72, 90 |
| `tests/integration/api/investment-adjustment.test.ts` | `BalanceRowSource.Manual` 49, 60; `BalanceSource.Manual` 40, 69, 90; `BalanceSource.Provider` 99; `BalanceSource.Valuation` 99 |
| `tests/integration/api/investment-schema.test.ts` | `BalanceRowSource.Synced` 37, 79; `BalanceSource.Manual` 95, 100; `BalanceSource.Provider` 32; `Pricing.Market` 45; `RecordSource.Synced` 57, 73 |
| `tests/integration/api/investment-securities-apis.test.ts` | `BalanceRowSource.Valuation` 131; `BalanceSource.Valuation` 112; `PriceSource.Institution` 95, 107; `PriceSource.Market` 103; `Pricing.Fixed` 82; `Pricing.Institution` 146, 158; `Pricing.Manual` 124; `Pricing.Market` 99; `Pricing.None` 93, 113; `RecordSource.Manual` 120 |
| `tests/integration/api/investments-overview.test.ts` | `BalanceRowSource.Manual` 38; `BalanceSource.Manual` 37 |
| `tests/integration/api/investments-refresh-history.test.ts` | `BalanceRowSource.Manual` 45; `BalanceSource.Manual` 44 |
| `tests/integration/api/plaid-investment-sync-route.test.ts` | `BalanceSource.Provider` 46, 72 |
| `tests/unit/components/investments/account-states.test.ts` | `BalanceSource.Manual` 89, 92, 98, 105; `BalanceSource.Valuation` 16, 84 |
| `tests/unit/components/investments/display.test.tsx` | 133: `<SourcePill source="valuation" />` → `<SourcePill source={BalanceSource.Valuation} />` |
| `tests/unit/components/investments/editors.test.tsx` | `Pricing.Fixed` 195, 210; `Pricing.Market` 137, 156 |
| `tests/unit/components/investments/navigator-detail.test.tsx` | `BalanceSource.Manual` 43; `BalanceSource.Valuation` 204 |
| `tests/unit/lib/balances.test.ts` | `BalanceRowSource.Manual` 90, 127; `BalanceRowSource.Synced` 58, 65, 107; `BalanceSource.Manual` 73, 118; `BalanceSource.Provider` 44, 101 |
| `tests/unit/lib/investments/current-holdings.test.ts` | `BalanceSource.Manual` 106; `BalanceSource.Valuation` 37, 89, 126, 152, 177, 198; `PriceSource.Manual` 125, 208, 209; `Pricing.Fixed` 130, 180, 194; `Pricing.Institution` 221; `Pricing.Manual` 114, 154, 199; `RecordSource.Manual` 45, 53, 97, 123, 140, 162, 171, 189, 206 |
| `tests/unit/lib/investments/history.test.ts` | `BalanceRowSource.Manual` 34, 35, 57, 475; `BalanceRowSource.Valuation` 46, 467, 468; `BalanceSource.Manual` 33, 466; `BalanceSource.Valuation` 45, 465; `PriceSource.Institution` 229, 230, 259, 295, 326, 327, 426, 427, 445; `Pricing.Fixed` 205, 279, 390; `Pricing.Institution` 209, 210, 251, 282, 313, 411, 439 |
| `tests/unit/lib/investments/holdings-view.test.ts` | `Pricing.Market` 11; `Pricing.None` 69 |
| `tests/unit/lib/investments/manual-holding.test.ts` | `BalanceRowSource.Manual` 38, 88, 89, 101, 102, 120; `BalanceSource.Manual` 36, 52, 60, 77, 87, 99; `BalanceSource.Provider` 67, 100, 111; `PriceSource.Manual` 46; `Pricing.Manual` 43; `RecordSource.Manual` 40; `RecordSource.Synced` 122 |
| `tests/unit/lib/investments/migration.test.ts` | `BalanceRowSource.Manual` 135, 136; `BalanceSource.Manual` 178, 224, 266, 267; `BalanceSource.Provider` 111, 124, 165, 193, 210, 255 |
| `tests/unit/lib/investments/overview.test.ts` | `BalanceRowSource.Manual` 42, 44; `BalanceRowSource.Valuation` 120; `BalanceSource.Manual` 37, 43, 56; `BalanceSource.Provider` 90; `BalanceSource.Valuation` 106; `Pricing.None` 108; `RecordSource.Manual` 116 |
| `tests/unit/lib/investments/plaid-investment-sync.test.ts` | `BalanceRowSource.Synced` 147; `BalanceSource.Provider` 128; `PriceSource.Institution` 166; `Pricing.Market` 164; `Pricing.None` 187, 192; `RecordSource.Synced` 159 |
| `tests/unit/lib/investments/plaid-mapping.test.ts` | `Pricing.Fixed` 45, 52; `Pricing.Institution` 59, 61; `Pricing.Market` 28, 69 (line 2's `from 'plaid'` is the module import; keep) |
| `tests/unit/lib/investments/refresh.test.ts` | `BalanceRowSource.Valuation` 125, 133, 158; `BalanceSource.Valuation` 30, 64, 83, 137, 172; `PriceSource.Market` 109, 237; `Pricing.Institution` 209; `Pricing.Manual` 132; `Pricing.Market` 124, 202; `RecordSource.Manual` 38, 91, 145, 180 |
| `tests/unit/lib/investments/transfer-linking.test.ts` | `BalanceSource.Manual` 144; `BalanceSource.Provider` 63, 158, 217; `RecordSource.Synced` 90, 172, 241 |
| `tests/unit/lib/investments/valuation.test.ts` | `BalanceRowSource.Manual` 100, 110, 118, 119, 124, 125; `BalanceRowSource.Valuation` 51, 94, 111, 145, 146, 181, 203, 245, 246, 257, 273, 274, 275, 276, 277; `BalanceSource.Manual` 70, 98, 116; `BalanceSource.Valuation` 44, 55, 77, 102, 121, 130, 152, 177, 185, 197, 226, 254, 261; `Pricing.Fixed` 217; `Pricing.None` 187, 199; `RecordSource.Manual` 49, 138, 164, 238, 269 |
| `tests/unit/lib/plaid-sync.test.ts` | `BalanceSource.Provider` 1180; `RecordSource.Synced` 1236 |
| `tests/unit/lib/prices/price-book.test.ts` | `PriceSource.Institution` 39; `Pricing.Institution` 37 |
| `tests/unit/lib/prices/pricing.test.ts` | `PriceSource.Institution` 27, 32, 47, 63; `PriceSource.Manual` 40; `PriceSource.Market` 22, 27, 40, 58, 59, 60, 90, 91, 98; `Pricing.Fixed` 17; `Pricing.Institution` 13, 62, 84, 89; `Pricing.Manual` 42; `Pricing.Market` 12, 97; `Pricing.None` 49 |
| `tests/unit/lib/prices/refresh.test.ts` | `PriceSource.Market` 62, 239, 240; `Pricing.Institution` 130, 321; `Pricing.Market` 168, 302; `Pricing.None` 154; `RecordSource.Manual` 38 |
| `tests/unit/lib/prices/securities.test.ts` | `Pricing.Fixed` 82, 97, 113; `Pricing.Market` 48 |
| `tests/unit/lib/teller-sync.test.ts` | `BalanceSource.Provider` 1226; `RecordSource.Synced` 1239 |

Note on `tests/helpers/investments.ts`: line 115 is `seedBalance`'s default `source = 'plaid'`, a balance row. Write it as `source: string = BalanceRowSource.Synced`. Line 105 is `seedPrice`'s default: `source: string = PriceSource.Market`. Keep the parameter types `string` (and `seedSecurity`'s `pricing?: string`, `seedSnapshot`'s `source?: string`): Task 2's rename test seeds legacy values through them.

Where a line holds two literals (for example `pricing.test.ts:27`), it appears under both members.

- [ ] **Step 6: Check that no bare stored code is left**

Run:

```bash
grep -rn -E "'(plaid|yahoo|feed|fixed|none|manual|valuation|provider|import)'" src/lib/investments src/lib/prices src/components/investments src/app/api/investments "src/app/(routes)/investments" src/lib/balances.ts src/lib/account-defaults.ts src/app/api/accounts src/app/api/transactions/adjustment scripts/set-valuation-holdings.ts
```

Expected: only `src/lib/investments/codes.ts` value lines, and the `from 'plaid'` module imports in `plaid-mapping.ts` and `plaid-investment-sync.ts`.

Then run the same pattern over the test files from the table:

```bash
grep -n -E "'(plaid|yahoo|feed|fixed|none|manual|valuation|provider|import)'" tests/helpers/investments.ts tests/helpers/investment-overview.ts tests/integration/api/balance-call-sites.test.ts tests/integration/api/cloud-sync-investments.test.ts tests/integration/api/investment-*.test.ts tests/integration/api/investments-*.test.ts tests/integration/api/plaid-investment-sync-route.test.ts tests/unit/components/investments/*.test.ts* tests/unit/lib/balances.test.ts tests/unit/lib/investments/*.test.ts tests/unit/lib/prices/*.test.ts
```

Expected: only `tests/unit/lib/investments/plaid-mapping.test.ts:2` (`from 'plaid'`) and the strings inside `codes.test.ts`'s "keeps the values stored today".

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm run test:unit && npm run test:integration`
Expected: all pass, the new codes test included. A type error usually means a missing import or a `BalanceSource` still imported from `@/lib/account-defaults`.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add src/lib/investments/codes.ts tests/unit/lib/investments/codes.test.ts \
  src/lib/prices/types.ts src/lib/prices/yahoo.ts src/lib/prices/pricing.ts src/lib/prices/refresh.ts src/lib/prices/securities.ts src/lib/prices/trading-days.ts \
  src/lib/investments/plaid-mapping.ts src/lib/investments/plaid-investment-sync.ts src/lib/investments/manual-holding.ts src/lib/investments/history.ts src/lib/investments/current-holdings.ts src/lib/investments/migration.ts src/lib/investments/valuation.ts src/lib/investments/overview.ts src/lib/investments/holdings-view.ts src/lib/investments/account-guard.ts \
  src/lib/balances.ts src/lib/account-defaults.ts src/app/api/accounts/route.ts "src/app/api/accounts/[id]/route.ts" src/app/api/transactions/adjustment/route.ts scripts/set-valuation-holdings.ts \
  src/components/investments/account-states.ts src/components/investments/pills.tsx src/components/investments/account-detail.tsx src/components/investments/holdings-editor-modal.tsx \
  tests/helpers/investments.ts tests/helpers/investment-overview.ts \
  tests/integration/api/balance-call-sites.test.ts tests/integration/api/cloud-sync-investments.test.ts tests/integration/api/investment-account-apis.test.ts tests/integration/api/investment-adjustment.test.ts tests/integration/api/investment-schema.test.ts tests/integration/api/investment-securities-apis.test.ts tests/integration/api/investments-overview.test.ts tests/integration/api/investments-refresh-history.test.ts tests/integration/api/plaid-investment-sync-route.test.ts \
  tests/unit/components/investments/account-states.test.ts tests/unit/components/investments/display.test.tsx tests/unit/components/investments/editors.test.tsx tests/unit/components/investments/navigator-detail.test.tsx \
  tests/unit/lib/balances.test.ts tests/unit/lib/plaid-sync.test.ts tests/unit/lib/teller-sync.test.ts \
  tests/unit/lib/investments/current-holdings.test.ts tests/unit/lib/investments/history.test.ts tests/unit/lib/investments/holdings-view.test.ts tests/unit/lib/investments/manual-holding.test.ts tests/unit/lib/investments/migration.test.ts tests/unit/lib/investments/overview.test.ts tests/unit/lib/investments/plaid-investment-sync.test.ts tests/unit/lib/investments/plaid-mapping.test.ts tests/unit/lib/investments/refresh.test.ts tests/unit/lib/investments/transfer-linking.test.ts tests/unit/lib/investments/valuation.test.ts \
  tests/unit/lib/prices/price-book.test.ts tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/refresh.test.ts tests/unit/lib/prices/securities.test.ts
git commit -m "refactor(investments): read and write stored codes through one enums module"
```

---

### Task 2: Neutral stored values, automatic rename, cloud-sync translation, lint guard

**Files:**
- Modify: `src/lib/investments/codes.ts` (values, `LEGACY_CODES`)
- Create: `src/lib/investments/rename-stored-codes.ts`, `scripts/rename-stored-codes.ts`
- Modify: `src/lib/investments/services.ts:57-72` (`getInvestmentServices` runs the rename first)
- Modify: `src/lib/cloud-sync/types.ts` (after `export type SyncData`, around line 283), `src/lib/cloud-sync/sync.ts:27, 433`
- Modify: `prisma/schema.prisma:19, 348, 365, 368, 387, 418, 441` (comments only)
- Test: `tests/unit/lib/investments/codes.test.ts`, `tests/unit/lib/investments/rename-stored-codes.test.ts` (new), `tests/integration/api/investment-services-startup.test.ts` (new), `tests/integration/api/cloud-sync-investments.test.ts`, `tests/unit/lint/vendor-literals.test.ts` (new)

**Interfaces:**
- Consumes: the Task 1 enums.
- Produces:
  - stored values `Pricing.Market = 'market'`, `Pricing.Institution = 'institution'`, `PriceSource.Market = 'market'`, `PriceSource.Institution = 'institution'`, `RecordSource.Synced = 'synced'`, `BalanceRowSource.Synced = 'synced'`
  - `LEGACY_CODES: { pricing; priceSource; recordSource; balanceRowSource }`, each a `{ oldValue: newValue }` map
  - `renameStoredSourceCodes(prisma: PrismaClient): Promise<RenameCount[]>`, where `RenameCount = { column: string; from: string; to: string; renamed: number; dropped: number }`
  - `ensureStoredCodes(prisma: PrismaClient): Promise<RenameCount[]>`: the rename memoised once per process (concurrent callers share one run; a failed run is retried by the next caller)
  - `getInvestmentServices()` awaits `ensureStoredCodes(prisma)` before returning; `createInvestmentServices` (tests) never runs it
  - `SyncImportDataSchema` and `upgradeLegacyCodes(data: SyncData): SyncData` from `@/lib/cloud-sync/types`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lib/investments/codes.test.ts`, add `LEGACY_CODES` to the import and replace the `'keeps the values stored today'` test with:

```ts
  it('stores neutral values, and maps every old value onto a current one of its family', () => {
    expect([
      Pricing.Market,
      Pricing.Institution,
      PriceSource.Market,
      PriceSource.Institution,
      RecordSource.Synced,
      BalanceRowSource.Synced,
    ]).toEqual(['market', 'institution', 'market', 'institution', 'synced', 'synced']);
    const families: Record<keyof typeof LEGACY_CODES, Record<string, string>> = {
      pricing: Pricing,
      priceSource: PriceSource,
      recordSource: RecordSource,
      balanceRowSource: BalanceRowSource,
    };
    for (const [family, legacy] of Object.entries(LEGACY_CODES)) {
      const current = Object.values(families[family as keyof typeof LEGACY_CODES]);
      for (const [old, now] of Object.entries(legacy)) {
        expect(current).toContain(now);
        expect(current).not.toContain(old);
      }
    }
  });
```

Create `tests/unit/lib/investments/rename-stored-codes.test.ts`. Legacy strings appear here on purpose: this test checks the legacy translation (spec §7).

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
} from '../../../helpers/investments';
import {
  BalanceRowSource,
  PriceSource,
  Pricing,
  RecordSource,
  SecurityType,
} from '@/lib/investments/codes';
import { isoDay } from '@/lib/investments/dates';
import { renameStoredSourceCodes } from '@/lib/investments/rename-stored-codes';

let prisma: PrismaClient;

describe('renameStoredSourceCodes', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('rewrites every legacy code, reports counts, and is idempotent', async () => {
    const a = await seedInvestmentAccount(prisma);
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA', pricing: 'feed' });
    const plan = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
    const cash = await seedSecurity(prisma, {
      priceSymbol: null,
      pricing: Pricing.Fixed,
      fixedPrice: 1,
      type: SecurityType.Cash,
    });
    await seedPrice(prisma, etf.id, '2026-10-01', 10, 'yahoo');
    await seedPrice(prisma, plan.id, '2026-10-01', 20, 'plaid');
    await prisma.securityEvent.create({
      data: { securityId: etf.id, date: day('2026-10-01'), type: 'dividend', amount: 0.1, source: 'yahoo' },
    });
    await seedSnapshot(prisma, {
      accountId: a.id,
      securityId: plan.id,
      date: '2026-10-01',
      quantity: 1,
      price: 20,
      source: 'plaid',
    });
    await prisma.investmentTransaction.create({
      data: {
        accountId: a.id,
        securityId: plan.id,
        date: day('2026-10-01'),
        type: 'buy',
        subtype: 'buy',
        name: 'Test buy',
        quantity: 1,
        amount: 20,
        currency: 'USD',
        source: 'plaid',
      },
    });
    await seedBalance(prisma, a.id, '2026-10-01', 20, 'plaid');

    const first = await renameStoredSourceCodes(prisma);
    expect(first.map((c) => [c.column, c.from, c.to, c.renamed, c.dropped])).toEqual([
      ['Security.pricing', 'feed', 'market', 1, 0],
      ['Security.pricing', 'plaid', 'institution', 1, 0],
      ['SecurityPrice.source', 'yahoo', 'market', 1, 0],
      ['SecurityPrice.source', 'plaid', 'institution', 1, 0],
      ['SecurityEvent.source', 'yahoo', 'market', 1, 0],
      ['SecurityEvent.source', 'plaid', 'institution', 0, 0],
      ['HoldingSnapshot.source', 'plaid', 'synced', 1, 0],
      ['InvestmentTransaction.source', 'plaid', 'synced', 1, 0],
      ['AccountBalance.source', 'plaid', 'synced', 1, 0],
    ]);
    const pricing = async (id: string) =>
      (await prisma.security.findUniqueOrThrow({ where: { id } })).pricing;
    expect([await pricing(etf.id), await pricing(plan.id), await pricing(cash.id)]).toEqual([
      Pricing.Market,
      Pricing.Institution,
      Pricing.Fixed,
    ]);
    expect(
      (await prisma.securityPrice.findMany({ orderBy: { close: 'asc' } })).map((p) => p.source)
    ).toEqual([PriceSource.Market, PriceSource.Institution]);
    expect((await prisma.securityEvent.findFirstOrThrow()).source).toBe(PriceSource.Market);
    expect((await prisma.holdingSnapshot.findFirstOrThrow()).source).toBe(RecordSource.Synced);
    expect((await prisma.investmentTransaction.findFirstOrThrow()).source).toBe(
      RecordSource.Synced
    );
    expect((await prisma.accountBalance.findFirstOrThrow()).source).toBe(BalanceRowSource.Synced);

    const second = await renameStoredSourceCodes(prisma);
    expect(second).toHaveLength(first.length);
    expect(second.every((c) => c.renamed === 0 && c.dropped === 0)).toBe(true);
  });

  it('drops a legacy close that clashes with one already stored under the new code', async () => {
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA', pricing: Pricing.Market });
    await seedPrice(prisma, etf.id, '2026-09-30', 9, 'yahoo');
    await seedPrice(prisma, etf.id, '2026-10-01', 10, 'yahoo');
    await seedPrice(prisma, etf.id, '2026-10-01', 11, PriceSource.Market);

    const counts = await renameStoredSourceCodes(prisma);
    expect(
      counts.find((c) => c.column === 'SecurityPrice.source' && c.from === 'yahoo')
    ).toMatchObject({ renamed: 1, dropped: 1 });
    expect(
      (await prisma.securityPrice.findMany({ orderBy: { date: 'asc' } })).map((p) => [
        isoDay(p.date),
        p.close,
        p.source,
      ])
    ).toEqual([
      ['2026-09-30', 9, PriceSource.Market],
      ['2026-10-01', 11, PriceSource.Market],
    ]);
  });
});
```

In the same file, add `vi` to the `vitest` import and append a second `describe` for the per-process run. `vi.resetModules()` plus a dynamic import gives each test a fresh memo:

```ts
describe('ensureStoredCodes', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    vi.resetModules();
  });

  it('renames once per process, with concurrent callers sharing one run', async () => {
    const { ensureStoredCodes } = await import('@/lib/investments/rename-stored-codes');
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA', pricing: 'feed' });
    const run = vi.spyOn(prisma, '$transaction');
    const [a, b] = await Promise.all([ensureStoredCodes(prisma), ensureStoredCodes(prisma)]);
    expect(a).toBe(b);
    expect(run).toHaveBeenCalledTimes(1);
    expect((await prisma.security.findUniqueOrThrow({ where: { id: etf.id } })).pricing).toBe(
      Pricing.Market
    );
    await ensureStoredCodes(prisma);
    expect(run).toHaveBeenCalledTimes(1);
    run.mockRestore();
  });

  it('lets the next caller retry after a failed run', async () => {
    const { ensureStoredCodes } = await import('@/lib/investments/rename-stored-codes');
    const run = vi
      .spyOn(prisma, '$transaction')
      .mockRejectedValueOnce(new Error('database is locked'));
    await expect(ensureStoredCodes(prisma)).rejects.toThrow('database is locked');
    await expect(ensureStoredCodes(prisma)).resolves.toHaveLength(9);
    expect(run).toHaveBeenCalledTimes(2);
    run.mockRestore();
  });
});
```

(The first `describe`'s `beforeAll`/`afterAll` set up and tear down their own DB; vitest runs the two `describe`s one after the other, so each gets its own.)

Create `tests/integration/api/investment-services-startup.test.ts`. It mocks `@/lib/prisma` the way the route tests do; legacy strings appear on purpose:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb } from '../../helpers/db';
import { seedSecurity } from '../../helpers/investments';
import { Pricing } from '@/lib/investments/codes';

let testPrisma: PrismaClient;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return testPrisma;
  },
}));
vi.mock('yahoo-finance2', () => ({ default: class {} }));

import { getInvestmentServices } from '@/lib/investments/services';

describe('getInvestmentServices', () => {
  beforeAll(async () => {
    testPrisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  it('renames legacy stored codes before returning the services', async () => {
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA', pricing: 'feed' });
    const [first, second] = await Promise.all([getInvestmentServices(), getInvestmentServices()]);
    expect(first).toBe(second);
    expect((await testPrisma.security.findUniqueOrThrow({ where: { id: s.id } })).pricing).toBe(
      Pricing.Market
    );
  });
});
```

In `tests/integration/api/cloud-sync-investments.test.ts`, add the import `import { BalanceRowSource, BalanceSource, LEGACY_CODES, PriceSource, Pricing, RecordSource, SecurityType } from '@/lib/investments/codes';` (merge it with the Task 1 import) and append this test inside the `describe`:

```ts
  it('imports a snapshot uploaded before the neutral codes, translating every legacy code', async () => {
    const day = new Date('2026-10-09T00:00:00.000Z');
    const a = await prisma.account.create({
      data: {
        ...createAccountData({ type: 'brokerage' }),
        trackingMode: 'investment',
        balanceSource: BalanceSource.Provider,
      },
    });
    const etf = await prisma.security.create({
      data: { name: 'ETF', ticker: 'TETF', type: SecurityType.Etf, pricing: Pricing.Market, priceSymbol: 'TETF' },
    });
    const plan = await prisma.security.create({
      data: { name: 'Plan Fund', type: SecurityType.MutualFund, pricing: Pricing.Institution },
    });
    await prisma.securityPrice.create({
      data: { securityId: etf.id, date: day, close: 50, source: PriceSource.Market },
    });
    await prisma.securityPrice.create({
      data: { securityId: plan.id, date: day, close: 20, source: PriceSource.Institution },
    });
    await prisma.securityEvent.create({
      data: { securityId: etf.id, date: day, type: 'dividend', amount: 0.5, source: PriceSource.Market },
    });
    await prisma.accountBalance.create({
      data: { accountId: a.id, date: day, balance: 100, currency: 'USD', source: BalanceRowSource.Synced },
    });
    await prisma.holdingSnapshot.create({
      data: {
        accountId: a.id,
        securityId: plan.id,
        date: day,
        quantity: 5,
        price: 20,
        value: 100,
        source: RecordSource.Synced,
      },
    });
    await prisma.investmentTransaction.create({
      data: {
        accountId: a.id,
        securityId: plan.id,
        date: day,
        type: 'buy',
        subtype: 'buy',
        name: 'Test buy',
        quantity: 1,
        amount: 20,
        currency: 'USD',
        source: RecordSource.Synced,
      },
    });

    // Rewrite the export as a build before the neutral codes would have written it.
    const old = structuredClone(await exportDatabase());
    const back = (legacy: Readonly<Record<string, string>>, value: string) =>
      Object.entries(legacy).find(([, now]) => now === value)?.[0] ?? value;
    for (const r of old.data.securities!) r.pricing = back(LEGACY_CODES.pricing, r.pricing);
    for (const r of old.data.securityPrices!) r.source = back(LEGACY_CODES.priceSource, r.source);
    for (const r of old.data.securityEvents!) r.source = back(LEGACY_CODES.priceSource, r.source);
    for (const r of old.data.accountBalances!) {
      r.source = back(LEGACY_CODES.balanceRowSource, r.source);
    }
    for (const r of old.data.holdingSnapshots!) r.source = back(LEGACY_CODES.recordSource, r.source);
    for (const r of old.data.investmentTransactions!) {
      r.source = back(LEGACY_CODES.recordSource, r.source);
    }
    expect(old.data.securities!.map((s) => s.pricing).sort()).toEqual(['feed', 'plaid']);
    old.metadata.checksum = await generateChecksum(old.data);

    await resetTestDb();
    await importDatabase(old);

    expect((await prisma.security.findMany({ orderBy: { name: 'asc' } })).map((s) => s.pricing)).toEqual([
      Pricing.Market,
      Pricing.Institution,
    ]);
    expect(
      (await prisma.securityPrice.findMany({ orderBy: { close: 'desc' } })).map((p) => p.source)
    ).toEqual([PriceSource.Market, PriceSource.Institution]);
    expect((await prisma.securityEvent.findFirstOrThrow()).source).toBe(PriceSource.Market);
    expect((await prisma.accountBalance.findFirstOrThrow()).source).toBe(BalanceRowSource.Synced);
    expect((await prisma.holdingSnapshot.findFirstOrThrow()).source).toBe(RecordSource.Synced);
    expect((await prisma.investmentTransaction.findFirstOrThrow()).source).toBe(
      RecordSource.Synced
    );
  });
```

Create `tests/unit/lint/vendor-literals.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec §1/§7: investment code outside the vendor gateways holds no 'plaid', 'yahoo' or 'feed'
 * string literal. Scoped to investment code so bank-connection code (spec §2) doesn't trip it.
 */
const SCOPE = [
  'src/lib/investments',
  'src/lib/prices',
  'src/components/investments',
  'src/app/api/investments',
  'src/app/(routes)/investments',
  'src/lib/balances.ts',
];
const GATEWAYS = new Set([
  'src/lib/prices/yahoo.ts',
  'src/lib/investments/plaid-mapping.ts',
  'src/lib/investments/plaid-investment-sync.ts',
]);
const VENDOR_LITERAL = /(['"`])(plaid|yahoo|feed)\1/;

const filesUnder = (p: string): string[] =>
  statSync(p).isFile() ? [p] : readdirSync(p).flatMap((name) => filesUnder(path.join(p, name)));

describe('vendor-literal guard', () => {
  it('recognises a vendor literal and ignores a path that merely contains one', () => {
    expect(VENDOR_LITERAL.test("where: { source: 'yahoo' }")).toBe(true);
    expect(VENDOR_LITERAL.test('pricing: "feed"')).toBe(true);
    expect(VENDOR_LITERAL.test("import('../prices/yahoo')")).toBe(false);
  });

  it('finds none in investment code outside the gateways', () => {
    const hits = SCOPE.flatMap(filesUnder)
      .filter((f) => /\.tsx?$/.test(f) && !GATEWAYS.has(f))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .flatMap((line, i) => (VENDOR_LITERAL.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : []))
      );
    expect(hits).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/codes.test.ts tests/unit/lib/investments/rename-stored-codes.test.ts tests/integration/api/investment-services-startup.test.ts tests/integration/api/cloud-sync-investments.test.ts tests/unit/lint/vendor-literals.test.ts`
Expected:
- `codes`: FAIL, because `LEGACY_CODES` doesn't exist and the values are old.
- `rename-stored-codes`: FAIL, because the module is missing.
- `investment-services-startup`: FAIL, because the security still reads `feed`.
- `cloud-sync-investments`: FAIL, because `LEGACY_CODES` is missing.
- `vendor-literals`: FAIL, listing `src/lib/investments/codes.ts` lines (`Market: 'feed'` …).

- [ ] **Step 3: Flip the values and add the legacy table**

In `src/lib/investments/codes.ts`, set:
- `Pricing.Market: 'market'`, `Pricing.Institution: 'institution'`
- `PriceSource = { Market: 'market', Institution: 'institution', Manual: 'manual' }`
- `RecordSource = { Synced: 'synced', Manual: 'manual', Import: 'import' }`
- `BalanceRowSource.Synced: 'synced'`

Then append:

```ts
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
```

- [ ] **Step 4: Write the rename, its once-per-process guard, the start-up run and the script**

Create `src/lib/investments/rename-stored-codes.ts`:

```ts
import type { Prisma, PrismaClient } from '@prisma/client';
import { LEGACY_CODES } from './codes';

/** One old value rewritten in one column: rows renamed, and old rows dropped as duplicates. */
export type RenameCount = {
  column: string;
  from: string;
  to: string;
  renamed: number;
  dropped: number;
};

type Renamer = (
  tx: Prisma.TransactionClient,
  from: string,
  to: string
) => Promise<{ renamed: number; dropped: number }>;

const counted = ({ count }: { count: number }) => ({ renamed: count, dropped: 0 });

/**
 * Closes need care: if the app ran after the code change, a refresh stored new-code closes on
 * days that still have an old-code close, and `@@unique([securityId, date, source])` would reject
 * the rename. The new close is the fresher one, so the old duplicate is dropped first.
 */
const renamePrices: Renamer = async (tx, from, to) => {
  const key = (r: { securityId: string; date: Date }) => `${r.securityId}|${r.date.getTime()}`;
  const select = { id: true, securityId: true, date: true } as const;
  const taken = new Set((await tx.securityPrice.findMany({ where: { source: to }, select })).map(key));
  const clashes = (await tx.securityPrice.findMany({ where: { source: from }, select }))
    .filter((r) => taken.has(key(r)))
    .map((r) => r.id);
  if (clashes.length) await tx.securityPrice.deleteMany({ where: { id: { in: clashes } } });
  const { count } = await tx.securityPrice.updateMany({
    where: { source: from },
    data: { source: to },
  });
  return { renamed: count, dropped: clashes.length };
};

/** Every column whose stored codes changed (spec §3), with its legacy table. */
const COLUMNS: { column: string; legacy: Readonly<Record<string, string>>; rename: Renamer }[] = [
  {
    column: 'Security.pricing',
    legacy: LEGACY_CODES.pricing,
    rename: async (tx, from, to) =>
      counted(await tx.security.updateMany({ where: { pricing: from }, data: { pricing: to } })),
  },
  { column: 'SecurityPrice.source', legacy: LEGACY_CODES.priceSource, rename: renamePrices },
  {
    column: 'SecurityEvent.source',
    legacy: LEGACY_CODES.priceSource,
    rename: async (tx, from, to) =>
      counted(await tx.securityEvent.updateMany({ where: { source: from }, data: { source: to } })),
  },
  {
    column: 'HoldingSnapshot.source',
    legacy: LEGACY_CODES.recordSource,
    rename: async (tx, from, to) =>
      counted(
        await tx.holdingSnapshot.updateMany({ where: { source: from }, data: { source: to } })
      ),
  },
  {
    column: 'InvestmentTransaction.source',
    legacy: LEGACY_CODES.recordSource,
    rename: async (tx, from, to) =>
      counted(
        await tx.investmentTransaction.updateMany({ where: { source: from }, data: { source: to } })
      ),
  },
  {
    column: 'AccountBalance.source',
    legacy: LEGACY_CODES.balanceRowSource,
    rename: async (tx, from, to) =>
      counted(await tx.accountBalance.updateMany({ where: { source: from }, data: { source: to } })),
  },
];

/**
 * Rewrites stored investment codes from their old vendor values to the neutral ones, in one
 * transaction. Idempotent: a second run renames nothing.
 */
export async function renameStoredSourceCodes(prisma: PrismaClient): Promise<RenameCount[]> {
  return prisma.$transaction(
    async (tx) => {
      const counts: RenameCount[] = [];
      for (const { column, legacy, rename } of COLUMNS) {
        for (const [from, to] of Object.entries(legacy)) {
          counts.push({ column, from, to, ...(await rename(tx, from, to)) });
        }
      }
      return counts;
    },
    { timeout: 120_000 }
  );
}

let run: Promise<RenameCount[]> | null = null;

/**
 * The rename, once per process (spec §3): concurrent callers share one run, and a failed run is
 * retried by the next caller. `getInvestmentServices` awaits it before handing out any service.
 */
export function ensureStoredCodes(prisma: PrismaClient): Promise<RenameCount[]> {
  run ??= renameStoredSourceCodes(prisma).catch((error) => {
    run = null;
    throw error;
  });
  return run;
}
```

Create `scripts/rename-stored-codes.ts`, a manual re-run that prints counts (the app runs the rename by itself on start):

```ts
/**
 * Re-runs the stored-code rename by hand and prints what changed (spec 2026-10-13 §3). The app
 * already runs it once per server process; this is for checking or re-running it.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/rename-stored-codes.ts
 */
import { prisma } from '../src/lib/prisma';
import { renameStoredSourceCodes } from '../src/lib/investments/rename-stored-codes';

async function main() {
  const counts = await renameStoredSourceCodes(prisma);
  for (const c of counts) {
    const dropped = c.dropped ? `, ${c.dropped} duplicate(s) dropped` : '';
    console.warn(`${c.column}: ${c.from} → ${c.to}: ${c.renamed} renamed${dropped}`);
  }
  const total = counts.reduce((sum, c) => sum + c.renamed + c.dropped, 0);
  console.warn(total ? `Done: ${total} row(s) changed.` : 'Nothing to rename; already up to date.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
```

Run the rename at start-up. In `src/lib/investments/services.ts`, add `import { ensureStoredCodes } from './rename-stored-codes';` and replace `getInvestmentServices` (lines 57–72, its doc comment included; Task 3 rewords that comment again) with:

```ts
let instance: InvestmentServices | null = null;

/**
 * Production services: the app Prisma client and Yahoo, built on first use. Both load lazily so
 * code paths that never price don't import `yahoo-finance2`. Stored codes from before the neutral
 * codes are renamed first, once per process, so no service ever reads an old value.
 * `createInvestmentServices` (tests) never runs the rename.
 */
export async function getInvestmentServices(): Promise<InvestmentServices> {
  const { prisma } = await import('@/lib/prisma');
  await ensureStoredCodes(prisma);
  if (!instance) {
    const { YahooPriceProvider } = await import('../prices/yahoo');
    instance ??= createInvestmentServices({ prisma, provider: new YahooPriceProvider() });
  }
  return instance;
}
```

- [ ] **Step 5: Translate legacy codes on cloud-sync import**

In `src/lib/cloud-sync/types.ts`, add after `import { z } from 'zod';`:

```ts
import { LEGACY_CODES } from '@/lib/investments/codes';
```

and after `export type SyncData = z.infer<typeof SyncDataSchema>;`:

```ts
/** A stored code, with a value from before the neutral codes translated (spec §3). */
const upgraded = (legacy: Readonly<Record<string, string>>) =>
  z.string().transform((value) => legacy[value] ?? value);

/**
 * `SyncDataSchema` as imported: snapshots uploaded before the neutral codes carry old values.
 * Parsed after the checksum check, since the checksum covers the data exactly as exported.
 */
export const SyncImportDataSchema = SyncDataSchema.extend({
  accountBalances: z
    .array(AccountBalanceExportSchema.extend({ source: upgraded(LEGACY_CODES.balanceRowSource) }))
    .optional(),
  securities: z
    .array(SecurityExportSchema.extend({ pricing: upgraded(LEGACY_CODES.pricing) }))
    .optional(),
  securityPrices: z
    .array(SecurityPriceExportSchema.extend({ source: upgraded(LEGACY_CODES.priceSource) }))
    .optional(),
  securityEvents: z
    .array(SecurityEventExportSchema.extend({ source: upgraded(LEGACY_CODES.priceSource) }))
    .optional(),
  holdingSnapshots: z
    .array(HoldingSnapshotExportSchema.extend({ source: upgraded(LEGACY_CODES.recordSource) }))
    .optional(),
  investmentTransactions: z
    .array(
      InvestmentTransactionExportSchema.extend({ source: upgraded(LEGACY_CODES.recordSource) })
    )
    .optional(),
});

/** Verified sync data with stored codes from before the neutral codes translated. */
export const upgradeLegacyCodes = (data: SyncData): SyncData => SyncImportDataSchema.parse(data);
```

In `src/lib/cloud-sync/sync.ts`:
- change line 27 to `import { upgradeLegacyCodes, validateSyncPayload } from './types';`;
- in `importDatabase`, replace `const { data } = validated;` (line 433) with `const data = upgradeLegacyCodes(validated.data);`.

The checksum check above it stays on `validated.data`.

- [ ] **Step 6: Point the schema comments at the enums (comments only)**

In `prisma/schema.prisma`:
- line 19: `// investment accounts only: BalanceSource in src/lib/investments/codes.ts`
- line 348: `// BalanceRowSource (src/lib/investments/codes.ts)`
- line 365: `// Pricing (src/lib/investments/codes.ts)`
- line 368: `// market-priced security whose daily moves fill this one's days without an institution price`
- line 387: `// PriceSource (src/lib/investments/codes.ts)`
- lines 418 and 441: `// RecordSource (src/lib/investments/codes.ts)`

No `db push` is needed; the comments don't change the database.

- [ ] **Step 7: Run the tests to verify they pass, then everything**

Run: `npx vitest run tests/unit/lib/investments/codes.test.ts tests/unit/lib/investments/rename-stored-codes.test.ts tests/integration/api/investment-services-startup.test.ts tests/integration/api/cloud-sync-investments.test.ts tests/unit/lint/vendor-literals.test.ts`
Expected: PASS.

Run: `npm run typecheck && npm run test:unit && npm run test:integration`
Expected: all pass with no other test edits. Task 1 put every test onto the enums. If a test fails on a literal value, it was missed in Task 1; move it onto the enum.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add src/lib/investments/codes.ts src/lib/investments/rename-stored-codes.ts scripts/rename-stored-codes.ts src/lib/investments/services.ts src/lib/cloud-sync/types.ts src/lib/cloud-sync/sync.ts prisma/schema.prisma tests/unit/lib/investments/codes.test.ts tests/unit/lib/investments/rename-stored-codes.test.ts tests/integration/api/investment-services-startup.test.ts tests/integration/api/cloud-sync-investments.test.ts tests/unit/lint/vendor-literals.test.ts
git commit -m "feat(investments): store vendor-neutral codes, renamed on start; legacy sync import"
```

---

### Task 3: Neutral names and copy; pricing pills and read-model quote removed

**Files:**
- Modify: `src/lib/prices/pricing.ts` (whole file), `src/lib/prices/types.ts:36-41`, `src/lib/prices/yahoo.ts:76-79`, `src/lib/prices/refresh.ts:2, 209-251`, `src/lib/prices/securities.ts:53, 120-130`, `src/lib/prices/trading-days.ts:3`
- Modify: `src/lib/investments/history.ts:6, 117-121, 142-145, 267-270, 290-293`, `plaid-mapping.ts:9-10`, `plaid-investment-sync.ts:15, 36-37`, `overview.ts`, `services.ts:47-54, 59-62`, `current-holdings.ts` (whole file), `holdings-view.ts:1-52, 84`, `refresh.ts:74-78`, `activity.ts:12`, `portfolio-view.ts:44-49`
- Modify: `src/components/investments/pills.tsx`, `holdings-table.tsx` (whole file), `set-symbol-modal.tsx` (whole file), `account-detail.tsx:46, 71, 273-278`; `src/app/(routes)/investments/page.tsx:186-193`; `src/app/api/transactions/adjustment/route.ts:29-36`
- Test: `tests/helpers/investments.ts`, `tests/helpers/investment-overview.ts`, `tests/unit/lib/prices/pricing.test.ts`, `tests/unit/lib/prices/yahoo.test.ts`, `tests/unit/lib/investments/{history,overview,holdings-view,current-holdings}.test.ts`, `tests/unit/components/investments/{display,editors,navigator-detail,investments-page}.test.tsx`, `tests/integration/api/investment-securities-apis.test.ts`, `tests/integration/api/investment-adjustment.test.ts`

**Interfaces:**
- Consumes: the Task 1/2 enums.
- Produces:
  - `MarketPricing`, `InstitutionPricing`, `ProxiedInstitutionPricing` (replacing `FeedPricing`, `PlaidPricing`, `ProxiedPlaidPricing`)
  - `export const BACKFILL_DAYS = 730` from `@/lib/investments/history`; `PLAID_TRADE_HISTORY_DAYS` becomes private to `plaid-investment-sync.ts`
  - `PriceProvider.symbolHint: string` (readonly); `InvestmentOverview.symbolHint: string`
  - the `InvestmentOverviewService` constructor becomes `(prisma, history, holdings, prices, symbolHint: string, clock = systemClock)`
  - `type InstitutionQuote = { price; currency; date; proxy: { symbol; name } | null }`; `type PriceTarget = { securityId: string; label: string; institution: InstitutionQuote | null }`
  - `HoldingRow` and `HoldingLine` lose `plaid`
  - `HoldingsTable` props become `{ lines, multiAccount, currency }` (`onSetPrice` is gone); `SetSymbolModal` props become `{ security, hint, onClose, onSaved }`
  - `PricePillButton` removed

- [ ] **Step 1: Write the failing tests**

`tests/helpers/investments.ts`: in `fakeProvider`, add `symbolHint: 'Use test symbols.',` as the first property of `provider`.

`tests/helpers/investment-overview.ts`:
- delete `plaid: null,` from `makeHolding`;
- add `symbolHint: 'Use test symbols.',` after `prices: …` in `makeOverview`.

`tests/unit/lib/prices/pricing.test.ts`: extend the import to `import { InstitutionPricing, MarketPricing, pricingFor, ProxiedInstitutionPricing, UnpricedPricing, type PricePoint } from '@/lib/prices/pricing';` and add inside `describe('pricing strategies')`:

```ts
  it('picks the neutrally named strategy for each mode', () => {
    expect(feed).toBeInstanceOf(MarketPricing);
    expect(plaid).toBeInstanceOf(InstitutionPricing);
    expect(pricingFor({ pricing: Pricing.Institution, fixedPrice: null }, [])).toBeInstanceOf(
      ProxiedInstitutionPricing
    );
  });
```

`tests/unit/lib/prices/yahoo.test.ts`, inside the `describe`:

```ts
  it('tells the price window how to write its symbols', () => {
    expect(new YahooPriceProvider(client()).symbolHint).toBe(
      'Use Yahoo Finance symbols: add .TO for Toronto listings, -USD for crypto.'
    );
  });
```

`tests/unit/lib/investments/history.test.ts`:
- add `BACKFILL_DAYS` to the `@/lib/investments/history` import;
- rename the test `'reaches back exactly Plaid’s 730-day trade window'` to `'reaches back exactly BACKFILL_DAYS (730)'`;
- add `expect(BACKFILL_DAYS).toBe(730);` as its first line.

`tests/unit/lib/investments/overview.test.ts`:

```ts
  it('carries the price provider’s symbol hint for the price window', async () => {
    expect((await overview()).symbolHint).toBe('Use test symbols.');
  });
```

`tests/unit/lib/investments/holdings-view.test.ts`:
- delete `plaid: null,` from `row()`;
- delete the test `'carries the first member’s Plaid quote onto the line, never onto cash'`.

`tests/unit/lib/investments/current-holdings.test.ts`: delete the test `'gives a Plaid-priced fund its Plaid price and the fund it follows'`.

`tests/unit/components/investments/display.test.tsx`:
- delete `plaid: null,` from `line()`;
- in the `pills` test, render `<SourcePill source={BalanceSource.Provider} />` next to the valuation pill and add `expect(screen.getByText('Synced')).toBeInTheDocument();`;
- delete the `userEvent` import (line 3); nothing in the file uses it until Task 6 adds it back;
- replace the whole `describe('HoldingsTable', …)` with:

```tsx
describe('HoldingsTable', () => {
  it('shows the accounts tag and a dash for unknown gain, with no pricing pills', () => {
    render(
      <HoldingsTable
        multiAccount
        currency="USD"
        lines={[
          line({ accountCount: 2 }),
          line({
            key: 's2',
            label: 'ZZZ',
            unpriced: true,
            gainBase: null,
            quantity: null,
            weightPct: 40,
          }),
        ]}
      />
    );
    expect(screen.getByText('2 accounts')).toBeInTheDocument();
    expect(screen.queryByText('No price source')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('+$250')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('12.5 · Triple A Fund')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
  });

  it('uses whole-number weights for one account and hides the tag', () => {
    render(
      <HoldingsTable currency="USD" lines={[line({ accountCount: 2 })]} multiAccount={false} />
    );
    expect(screen.queryByText('2 accounts')).toBeNull();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });
});
```

`tests/unit/components/investments/editors.test.tsx`: replace the whole `describe('SetSymbolModal', …)` with:

```tsx
describe('SetSymbolModal', () => {
  const security = { securityId: 'sec-z', label: 'ZZZ', institution: null };
  const hint = 'Use test symbols.';

  it('points the security at a new symbol, under the provider’s symbol hint', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    const onSaved = vi.fn();
    render(<SetSymbolModal hint={hint} security={security} onClose={vi.fn()} onSaved={onSaved} />);
    expect(screen.getByText('Use test symbols.')).toBeInTheDocument();
    expect(screen.queryByText(/Yahoo/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Price symbol'), 'ZZZ.TO');
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0].body).toEqual({ priceSymbol: 'ZZZ.TO' });
  });

  it('sets a manual price, and validates both inputs', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    render(<SetSymbolModal hint={hint} security={security} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    expect(screen.getByText('Enter a symbol')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    expect(screen.getByText('Enter a positive price')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Or set a price per unit'), '50.73');
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    await waitFor(() => expect(calls()[0]?.body).toEqual({ manualPrice: 50.73 }));
  });

  describe('for a fund priced by its institution', () => {
    const quote = { price: 28.34, currency: 'USD', date: '2026-10-10', proxy: null };
    const fund = { securityId: 'sec-p', label: 'PLAN', institution: quote };

    it('shows the institution’s price and follows a fund', async () => {
      replies['PATCH /api/investments/securities/sec-p'] = ok({ security: {} });
      const onSaved = vi.fn();
      render(<SetSymbolModal hint={hint} security={fund} onClose={vi.fn()} onSaved={onSaved} />);
      expect(screen.getByText(/Priced by the institution/)).toHaveTextContent(
        'Priced by the institution: $28.34 on Oct 10.'
      );
      expect(screen.getByText(/stays the real price/)).toHaveTextContent(
        /^The institution’s price stays the real price\./
      );
      await userEvent.click(screen.getByRole('button', { name: 'Follow fund' }));
      expect(screen.getByText('Enter a fund symbol')).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('Fund to follow'), 'FOLW');
      await userEvent.click(screen.getByRole('button', { name: 'Follow fund' }));
      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(calls()[0].body).toEqual({ proxySymbol: 'FOLW' });
    });

    it('stops following', async () => {
      replies['PATCH /api/investments/securities/sec-p'] = ok({ security: {} });
      const following = {
        ...fund,
        institution: { ...quote, proxy: { symbol: 'PRXY', name: 'Proxy Fund' } },
      };
      render(
        <SetSymbolModal hint={hint} security={following} onClose={vi.fn()} onSaved={vi.fn()} />
      );
      expect(screen.getByText(/Following/)).toHaveTextContent('Following PRXY · Proxy Fund');
      await userEvent.click(screen.getByRole('button', { name: 'Stop following' }));
      await waitFor(() => expect(calls()[0]?.body).toEqual({ proxySymbol: null }));
    });
  });

  it('offers no fund to follow for a security its institution does not price', () => {
    render(<SetSymbolModal hint={hint} security={security} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText('No public ticker? Follow a similar fund')).not.toBeInTheDocument();
  });
});
```

`tests/unit/components/investments/navigator-detail.test.tsx`, line 219: change `plaid: null` to `institution: null`.

`tests/unit/components/investments/investments-page.test.tsx`, inside the `describe`:

```tsx
  it('shows the price provider’s symbol hint in the price window', async () => {
    overview = makeOverview({
      accounts: [
        makeAccount({
          status: {
            needsReauth: null,
            waiting: null,
            unpriced: [{ securityId: 'sec-z', label: 'ZZZ' }],
            tradesReported: true,
          },
        }),
      ],
    });
    render(<InvestmentsPage />);
    await userEvent.click(await screen.findByText('Brokerage'));
    await userEvent.click(await screen.findByRole('button', { name: 'Set symbol' }));
    expect(await screen.findByText('Use test symbols.')).toBeInTheDocument();
  });
```

`tests/integration/api/investment-securities-apis.test.ts`: in `'PATCH proxySymbol rejects unknown symbols, non-Plaid funds and blanks'`, rename the test to `'PATCH proxySymbol rejects unknown symbols, funds not priced by their institution, and blanks'` and replace its `feed.id` line with:

```ts
    const notInstitution = await patch(json('PATCH', { proxySymbol: 'FOLW' }), params(feed.id));
    expect(notInstitution.status).toBe(400);
    expect(await notInstitution.json()).toEqual({
      error: 'Only a fund priced by its institution can follow another fund',
    });
```

`tests/integration/api/investment-adjustment.test.ts`: replace the test `'rejects reconciling a Plaid-synced or valued investment account'` with:

```ts
  it('rejects reconciling a synced or valued investment account, saying where its balance comes from', async () => {
    const errors = {
      [BalanceSource.Provider]: "This account's balance is set by its connection",
      [BalanceSource.Valuation]: "This account's balance comes from its holdings",
    };
    for (const [balanceSource, error] of Object.entries(errors)) {
      const account = await testPrisma.account.create({
        data: {
          ...createAccountData({ type: 'brokerage' }),
          trackingMode: 'investment',
          balanceSource,
        },
      });
      const res = await post({ accountId: account.id, amount: 10 });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(await testPrisma.accountBalance.count({ where: { accountId: account.id } })).toBe(0);
    }
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices tests/unit/lib/investments tests/unit/components/investments tests/integration/api/investment-securities-apis.test.ts tests/integration/api/investment-adjustment.test.ts`
Expected: FAIL. The new class names, `BACKFILL_DAYS`, `symbolHint` and the `hint` prop are missing, the old copy is still there, and TypeScript rejects `institution` on `PriceTarget`.

- [ ] **Step 3: Rename the strategies**

Replace `src/lib/prices/pricing.ts` with:

```ts
import { Pricing, PriceSource } from '@/lib/investments/codes';

export type PricePoint = { date: Date; close: number; source: string };
export type PricedAt = { price: number; estimated: boolean };

/** How one pricing mode prices a security on a UTC day (rules table in Plan 2, Task 3). */
export interface PricingStrategy {
  /** `points` are the security's stored prices, date ascending. */
  priceOn(points: PricePoint[], date: Date): PricedAt | null;
}

const fromSource = (points: PricePoint[], source: PriceSource) =>
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

/** The prices the institution reports with each sync, interpolated between them. */
export class InstitutionPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return interpolate(fromSource(points, PriceSource.Institution), date.getTime());
  }
}

/**
 * Institution prices, with every other day moved by a proxy fund's closes (spec §6.2): the latest
 * institution price on or before the day (else the first one after) × proxy(day) / proxy(that
 * price's day). Without proxy closes for both days, plain institution pricing.
 */
export class ProxiedInstitutionPricing implements PricingStrategy {
  private readonly fallback = new InstitutionPricing();

  constructor(private readonly proxyPoints: PricePoint[]) {}

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    const t = date.getTime();
    const reported = fromSource(points, PriceSource.Institution);
    const anchor = reported.filter((p) => p.date.getTime() <= t).at(-1) ?? reported[0];
    if (anchor?.date.getTime() === t) return { price: anchor.close, estimated: false };
    const proxy = fromSource(this.proxyPoints, PriceSource.Market);
    const now = carryForward(proxy, t, true);
    const then = anchor ? carryForward(proxy, anchor.date.getTime(), true) : null;
    // A zero close can't scale the anchor; institution pricing answers instead.
    if (anchor && now && then && then.price > 0) {
      return { price: (anchor.close * now.price) / then.price, estimated: true };
    }
    return this.fallback.priceOn(points, date);
  }
}

/** Market closes carried forward; institution prices before the first close. */
export class MarketPricing implements PricingStrategy {
  private readonly fallback = new InstitutionPricing();

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return (
      carryForward(fromSource(points, PriceSource.Market), date.getTime(), false) ??
      this.fallback.priceOn(points, date)
    );
  }
}

export class ManualPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(fromSource(points, PriceSource.Manual), date.getTime(), false);
  }
}

export class UnpricedPricing implements PricingStrategy {
  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    return carryForward(points, date.getTime(), true);
  }
}

const STRATEGIES = new Map<string, (fixedPrice: number | null) => PricingStrategy>([
  [Pricing.Fixed, (fixedPrice) => new FixedPricing(fixedPrice)],
  [Pricing.Market, () => new MarketPricing()],
  [Pricing.Institution, () => new InstitutionPricing()],
  [Pricing.Manual, () => new ManualPricing()],
  [Pricing.None, () => new UnpricedPricing()],
]);

/**
 * The one place a `Security.pricing` value becomes behaviour. Unknown values price as unpriced.
 * `proxyPoints` (the proxy's stored prices) apply only to institution pricing.
 */
export function pricingFor(
  security: { pricing: string; fixedPrice: number | null },
  proxyPoints?: PricePoint[]
): PricingStrategy {
  if (security.pricing === Pricing.Institution && proxyPoints) {
    return new ProxiedInstitutionPricing(proxyPoints);
  }
  const create = STRATEGIES.get(security.pricing);
  return create ? create(security.fixedPrice) : new UnpricedPricing();
}
```

- [ ] **Step 4: Move the backfill window to the history domain**

`src/lib/investments/history.ts`:
- delete line 6 (`import { PLAID_TRADE_HISTORY_DAYS } from './plaid-mapping';`);
- add after the imports:

```ts
/**
 * How far before an account's first synced holdings its value is estimated, and prices are
 * fetched: the aggregator's investment-transaction history (24 months).
 */
export const BACKFILL_DAYS = 730;
```

- line 118: `* Estimates a provider account's value on days without a stored balance, from its synced holdings`;
- line 143: `* Null when the account has no synced holdings snapshot. Snapshots after `to` are loaded too, so`;
- line 268: `* A cash row carrying units of a non-cash security: the aggregator's form for retirement-plan`;
- line 290: `/** First snapshot minus BACKFILL_DAYS, walking back until a day can't be estimated. */`;
- line 293: `-PLAID_TRADE_HISTORY_DAYS` → `-BACKFILL_DAYS`.

`src/lib/investments/plaid-mapping.ts`: delete lines 9–10 (the constant and its comment).

`src/lib/investments/plaid-investment-sync.ts`:
- delete `PLAID_TRADE_HISTORY_DAYS,` from the `./plaid-mapping` import (line 15);
- after `const PAGE = 500;` add:

```ts
/** How far back Plaid returns investment transactions (24 months). */
const PLAID_TRADE_HISTORY_DAYS = 730;
```

`src/lib/prices/refresh.ts`:
- line 2 becomes `import { BACKFILL_DAYS } from '@/lib/investments/history';`;
- replace lines 209–251 (`historyStart`'s doc comment and body) with:

```ts
  /**
   * The first day a security needs closes for, over it and the securities following it as a proxy:
   * a week before their earliest holding or trade, and for each synced account holding them, that
   * account's first synced holdings day minus BACKFILL_DAYS. Else a short lookback.
   */
  private async historyStart(securityId: string, today: Date): Promise<Date> {
    const followers = await this.prisma.security.findMany({
      where: { proxySecurityId: securityId },
      select: { id: true },
    });
    const ids = [securityId, ...followers.map((f) => f.id)];
    const [snapshot, trade, syncedHolders] = await Promise.all([
      this.prisma.holdingSnapshot.findFirst({
        where: { securityId: { in: ids } },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.investmentTransaction.findFirst({
        where: { securityId: { in: ids } },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.holdingSnapshot.findMany({
        where: { securityId: { in: ids }, source: RecordSource.Synced },
        distinct: ['accountId'],
        select: { accountId: true },
      }),
    ]);
    const firstSyncedDays = syncedHolders.length
      ? await this.prisma.holdingSnapshot.groupBy({
          by: ['accountId'],
          where: {
            accountId: { in: syncedHolders.map((h) => h.accountId) },
            source: RecordSource.Synced,
          },
          _min: { date: true },
        })
      : [];
    const dates = [
      ...[snapshot?.date, trade?.date].map((d) => d && addDays(d, -HISTORY_START_BUFFER_DAYS)),
      ...firstSyncedDays.map((a) => a._min.date && addDays(a._min.date, -BACKFILL_DAYS)),
    ].filter((d): d is Date => d != null);
    if (!dates.length) return addDays(today, -FIRST_FETCH_LOOKBACK_DAYS);
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  }
```

- [ ] **Step 5: The symbol hint, from the provider to the overview**

`src/lib/prices/types.ts`: in `interface PriceProvider`, add as its first member:

```ts
  /** How to write a symbol this provider prices; shown in the price window. */
  readonly symbolHint: string;
```

`src/lib/prices/yahoo.ts`: in `YahooPriceProvider`, before the constructor:

```ts
  readonly symbolHint = 'Use Yahoo Finance symbols: add .TO for Toronto listings, -USD for crypto.';
```

`src/lib/investments/overview.ts`:
- add `symbolHint: string;` with the doc `/** How to write a price symbol, from the market data provider. */` to `InvestmentOverview`, after `prices`;
- line 65: `/** Sync steps whose pending state means the account is waiting on its institution. */`;
- the constructor becomes:

```ts
  constructor(
    private readonly prisma: PrismaClient,
    private readonly history: Pick<ValueHistoryService, 'accountSeries'>,
    private readonly holdings: Pick<CurrentHoldingsReader, 'read'>,
    private readonly prices: Pick<PriceRefresher, 'freshness'>,
    /** How to write a price symbol, from the market data provider; shown in the price window. */
    private readonly symbolHint: string,
    private readonly clock: Clock = systemClock
  ) {}
```

- rename `plaidDays` → `syncedDays` (line 103) and `lastPlaidDay` → `lastSyncedDay` (lines 130, 141);
- in the returned object, add `symbolHint: this.symbolHint,` after `prices: freshnessView(prices),`.

`src/lib/investments/services.ts`:
- pass `provider.symbolHint` to `InvestmentOverviewService`, between `prices` and `clock`;
- replace the doc comment on `getInvestmentServices` (written in Task 2) with:

```ts
/**
 * Production services: the app Prisma client and the market data provider's gateway, built on
 * first use. Both load lazily so code paths that never price don't load the provider's client.
 * Stored codes from before the neutral codes are renamed first, once per process, so no service
 * ever reads an old value. `createInvestmentServices` (tests) never runs the rename.
 */
```

- [ ] **Step 6: Drop the institution quote from the read model**

`src/lib/investments/holdings-view.ts`: replace lines 1–52 (imports through `HoldingLine`) with:

```ts
import { Pricing, SecurityType } from './codes';
import { allocationBucket } from './portfolio-view';
import { roundCents } from './money';

export type HoldingKind = 'security' | 'cash' | 'account';

/** An institution-priced security's latest institution price and the public fund it follows. */
export type InstitutionQuote = {
  price: number;
  currency: string;
  date: string;
  proxy: { symbol: string; name: string } | null;
};

/**
 * What the price window needs for one security; `institution` only when its institution prices it.
 * The investments page passes null; Settings → Securities (Plan 4) supplies it.
 */
export type PriceTarget = { securityId: string; label: string; institution: InstitutionQuote | null };

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
```

Then delete `plaid: isCash ? null : first.plaid,` from `holdingLines`.

Replace `src/lib/investments/current-holdings.ts` with:

```ts
import type { PrismaClient, Security } from '@prisma/client';
import { convertAmount } from '@/lib/currency';
import { PriceBook } from '@/lib/prices/price-book';
import { BalanceSource, Pricing, RecordSource, SecurityType } from './codes';
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

const CASH_LABELS: Record<string, string> = {
  [SecurityType.Cash]: 'Cash',
  [SecurityType.MoneyMarket]: 'Money market',
};

/** Each account's latest holdings set, priced for today, as page rows. */
export class CurrentHoldingsReader {
  constructor(private readonly prisma: PrismaClient) {}

  async read(opts: CurrentHoldingsOptions): Promise<HoldingRow[]> {
    const { accounts, today, rangeStart, baseCurrency, rates } = opts;
    if (!accounts.length) return [];
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const isLeftoverMirror = (accountId: string, securityId: string) =>
      byId.get(accountId)?.balanceSource === BalanceSource.Valuation &&
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
        s.source === RecordSource.Synced
          ? s.price
          : (book.at(s.securityId, today)?.price ?? s.price);
      const toAccount = (v: number) =>
        convertAmount(v, s.security.currency, account.currency, rates);
      const toBase = (v: number) => convertAmount(v, account.currency, baseCurrency, rates);
      const value = toAccount(s.quantity * price);
      const startPrice = book.at(s.securityId, rangeStart)?.price;
      const endPrice = book.at(s.securityId, today)?.price;
      const marketPriced =
        kind === 'security' &&
        s.security.pricing !== Pricing.None &&
        s.security.pricing !== Pricing.Fixed;
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

- [ ] **Step 7: Pills, holdings table, price window, wiring**

`src/components/investments/pills.tsx`:
- in `SOURCE_PILLS`, change the provider entry's `label: 'Plaid'` to `label: 'Synced'`;
- delete `PricePillButton` and its doc comment (lines 69–88);
- replace `PILL_TONES` and `FlagPill` (lines 60–67) with:

```tsx
const FLAG_TONE = 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] text-[var(--accent)]';

export function FlagPill({ children }: { children: ReactNode }) {
  return <span className={`${PILL} ml-1.5 font-sans ${FLAG_TONE}`}>{children}</span>;
}
```

Replace `src/components/investments/holdings-table.tsx` with:

```tsx
'use client';

import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtMoney, fmtQty, fmtSignedMoney, signedTone } from './format';

const GRID = 'grid grid-cols-[1fr_96px_92px_70px] gap-3';

export function HoldingsTable({
  lines,
  multiAccount,
  currency,
}: {
  lines: HoldingLine[];
  multiAccount: boolean;
  /** Base currency of `valueBase` and `gainBase`. */
  currency: string;
}) {
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
            </div>
            <div className="truncate text-[11px] text-[var(--text-muted)]">
              {l.quantity != null ? `${fmtQty(l.quantity)} · ${l.name}` : l.name}
            </div>
          </div>
          <span className="text-right font-mono text-[var(--text-primary)]">
            {fmtMoney(l.valueBase, { currency })}
          </span>
          <span className={`text-right font-mono ${signedTone(l.gainBase)}`}>
            {l.gainBase == null ? '—' : fmtSignedMoney(l.gainBase, { currency })}
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

Replace `src/components/investments/set-symbol-modal.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import type { PriceTarget } from '@/lib/investments/holdings-view';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';
import { fmtDay, fmtMoney } from './format';

type PatchBody = { priceSymbol: string } | { manualPrice: number } | { proxySymbol: string | null };

export function SetSymbolModal({
  security,
  hint,
  onClose,
  onSaved,
}: {
  security: PriceTarget;
  /** How to write a price symbol, from the market data provider. */
  hint: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [proxy, setProxy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const quote = security.institution;

  const patch = async (body: PatchBody) => {
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
  const follow = () => {
    if (!proxy.trim()) return setError('Enter a fund symbol');
    void patch({ proxySymbol: proxy.trim() });
  };

  return (
    <Modal isOpen title={`Price ${security.label}`} onClose={onClose}>
      {quote && (
        <p className={`${HINT} mb-3`}>
          Priced by the institution:{' '}
          <span className="font-mono text-[var(--text-secondary)]">
            {fmtMoney(quote.price, { cents: true, currency: quote.currency })}
          </span>{' '}
          on {fmtDay(quote.date)}.
        </p>
      )}
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
      {hint && <p className={HINT}>{hint}</p>}
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
      {quote && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className={FIELD_LABEL}>No public ticker? Follow a similar fund</p>
          {quote.proxy ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-[var(--text-primary)]">
              <span>
                Following <span className="font-mono">{quote.proxy.symbol}</span>{' '}
                <span className="text-[var(--text-muted)]">· {quote.proxy.name}</span>
              </span>
              <button
                className="text-[var(--text-muted)] underline hover:text-[var(--text-secondary)]"
                disabled={saving}
                type="button"
                onClick={() => void patch({ proxySymbol: null })}
              >
                Stop following
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input
                aria-label="Fund to follow"
                className="font-mono"
                placeholder="Ticker"
                value={proxy}
                onChange={(e) => setProxy(e.target.value)}
              />
              <Button disabled={saving} type="button" onClick={follow}>
                Follow fund
              </Button>
            </div>
          )}
          <p className={HINT}>
            The institution’s price stays the real price. On days without one, this holding moves
            with the fund you pick, which fills in history before the first sync and any days the
            app didn’t sync.
          </p>
        </div>
      )}
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
```

`src/components/investments/account-detail.tsx`:
- line 71: `onClick={() => p.onSetSymbol({ ...a.status.unpriced[0], institution: null })}`;
- remove `onSetPrice={props.onSetSymbol}` from `<HoldingsTable …>` (line 277).

`src/app/(routes)/investments/page.tsx`: in the `SetSymbolModal` element add `hint={overview?.symbolHint ?? ''}` (between `key` and `security`; `lint:fix` sorts it).

- [ ] **Step 8: Neutral errors and comments**

`src/lib/prices/securities.ts`:
- line 53: `/** The cash security for a currency (1 unit = 1 <currency>), shared with the aggregator's cash securities. */`;
- replace lines 120–130 (doc comment and the pricing check) with:

```ts
  /**
   * Link an institution-priced security to the market-priced fund whose daily moves fill its days
   * without an institution price (validated and created like any market symbol); null unlinks.
   * Callers price the proxy and revalue under the refresh lock (`InvestmentRefreshService.setProxy`).
   */
  async setProxy(id: string, symbol: string | null): Promise<Security> {
    const security = await this.prisma.security.findUnique({ where: { id } });
    if (!security) throw new InvestmentInputError('Security not found', 404);
    if (security.pricing !== Pricing.Institution) {
      throw new InvestmentInputError('Only a fund priced by its institution can follow another fund');
    }
```

`src/app/api/transactions/adjustment/route.ts`: replace lines 29–36 with:

```ts
    if (account.trackingMode === 'investment') {
      if (account.balanceSource !== BalanceSource.Manual) {
        const error =
          account.balanceSource === BalanceSource.Provider
            ? "This account's balance is set by its connection"
            : "This account's balance comes from its holdings";
        return NextResponse.json({ error }, { status: 400 });
      }
```

Comments:
- `src/lib/investments/refresh.ts:75`: `* Make an institution-priced fund follow a public fund (null stops following), price that fund back to`;
- `src/lib/investments/activity.ts:12`: `amount: number; // aggregator sign: positive = cash leaves the account`;
- `src/lib/prices/trading-days.ts:3`: `// 16:00 ET is 20:00 UTC (EDT) or 21:00 UTC (EST); 21:30 covers both plus time for the market data provider to publish.` (`lint:fix` wraps it);
- `src/lib/investments/portfolio-view.ts:44–49`: rename the parameter `plaidSubtype` to `subtype`.

- [ ] **Step 9: Run the tests to verify they pass, then check for vendor names**

Run: `npx vitest run tests/unit/lib/prices tests/unit/lib/investments tests/unit/components/investments tests/integration/api/investment-securities-apis.test.ts tests/integration/api/investment-adjustment.test.ts`
Expected: PASS.

Run:

```bash
grep -rn -i "plaid\|yahoo" src/lib/investments src/lib/prices src/components/investments src/app/api/investments "src/app/(routes)/investments" src/lib/balances.ts src/app/api/transactions/adjustment | grep -v "^src/lib/prices/yahoo.ts\|^src/lib/investments/plaid-mapping.ts\|^src/lib/investments/plaid-investment-sync.ts"
```

Expected: hits only in the out-of-scope files from ruling 5:
- `overview.ts`: the `plaidConnection`/`plaidEnrollment` include and `conn` reads;
- `sync-status.ts`;
- `migration.ts`;
- `services.ts`: `import('../prices/yahoo')` and `YahooPriceProvider`;
- `account-detail.tsx`: `PlaidReconnectButton`.

Anything else is a missed rename.

Run: `npm run typecheck && npm run test:unit && npm run test:integration`
Expected: all pass.

- [ ] **Step 10: Commit**

```bash
npm run lint:fix
git add src/lib/prices/pricing.ts src/lib/prices/types.ts src/lib/prices/yahoo.ts src/lib/prices/refresh.ts src/lib/prices/securities.ts src/lib/prices/trading-days.ts \
  src/lib/investments/history.ts src/lib/investments/plaid-mapping.ts src/lib/investments/plaid-investment-sync.ts src/lib/investments/overview.ts src/lib/investments/services.ts src/lib/investments/current-holdings.ts src/lib/investments/holdings-view.ts src/lib/investments/refresh.ts src/lib/investments/activity.ts src/lib/investments/portfolio-view.ts \
  src/components/investments/pills.tsx src/components/investments/holdings-table.tsx src/components/investments/set-symbol-modal.tsx src/components/investments/account-detail.tsx "src/app/(routes)/investments/page.tsx" src/app/api/transactions/adjustment/route.ts \
  tests/helpers/investments.ts tests/helpers/investment-overview.ts tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/yahoo.test.ts tests/unit/lib/investments/history.test.ts tests/unit/lib/investments/overview.test.ts tests/unit/lib/investments/holdings-view.test.ts tests/unit/lib/investments/current-holdings.test.ts \
  tests/unit/components/investments/display.test.tsx tests/unit/components/investments/editors.test.tsx tests/unit/components/investments/navigator-detail.test.tsx tests/unit/components/investments/investments-page.test.tsx \
  tests/integration/api/investment-securities-apis.test.ts tests/integration/api/investment-adjustment.test.ts
git commit -m "refactor(investments): neutral names and copy; drop holdings pricing pills"
```

---

### Task 4: Ranges 3Y and All, with year labels

**Files:**
- Modify: `src/lib/investments/portfolio-view.ts:4-16`, `src/lib/investments/history.ts` (`ValueHistoryService`), `src/lib/investments/overview.ts:77, 86`
- Modify: `src/components/investments/format.ts:42-48, after 74`, `src/components/investments/value-chart.tsx:33-43, 188-192`, `src/components/investments/account-detail.tsx:211`
- Test: `tests/unit/lib/investments/portfolio-view.test.ts`, `tests/unit/lib/investments/history.test.ts`, `tests/unit/lib/investments/overview.test.ts`, `tests/integration/api/investments-overview.test.ts`, `tests/unit/components/investments/format.test.ts`, `tests/unit/components/investments/display.test.tsx`, `tests/unit/components/investments/navigator-detail.test.tsx`, `tests/unit/components/investments/investments-page.test.tsx`

**Interfaces:**
- Consumes: `BACKFILL_DAYS`, `RecordSource.Synced`.
- Produces:
  - `type Range = '1M' | '3M' | 'YTD' | '1Y' | '3Y' | 'All'`; `RANGES` in that order; `type FixedRange = Exclude<Range, 'All'>`; `rangeStart(range: FixedRange, today: Date): Date`
  - `ValueHistoryService.earliestDay(today: Date): Promise<Date>`
  - `fmtDay(iso: string, opts?: { year?: boolean }): string`; `spansYear(fromIso: string, toIso: string): boolean`
  - `ValueChart` prop `yearLabels?: boolean`

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/investments/portfolio-view.test.ts`:
- add `['3Y', '2023-10-12'],` to the `rangeStart` table;
- replace the `isRange` test with:

```ts
  it('accepts the six ranges only', () => {
    expect(isRange('YTD')).toBe(true);
    expect(isRange('3Y')).toBe(true);
    expect(isRange('All')).toBe(true);
    expect(isRange('5Y')).toBe(false);
    expect(isRange(undefined)).toBe(false);
  });
```

`tests/unit/lib/investments/history.test.ts`: add `import { isoDay } from '@/lib/investments/dates';` and, inside `describe('ValueHistoryService')`:

```ts
  describe('earliestDay', () => {
    const today = day('2026-10-09');

    it('is the earliest stored balance or first synced holdings minus BACKFILL_DAYS', async () => {
      const manual = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
      await seedBalance(prisma, manual.id, '2025-03-02', 100, BalanceRowSource.Manual);
      const synced = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma);
      for (const date of ['2026-06-01', '2026-07-01']) {
        await seedSnapshot(prisma, { accountId: synced.id, securityId: s.id, date, quantity: 1, price: 10 });
      }
      expect(isoDay(await history.earliestDay(today))).toBe('2024-06-01');
      await seedBalance(prisma, manual.id, '2024-01-15', 90, BalanceRowSource.Manual);
      expect(isoDay(await history.earliestDay(today))).toBe('2024-01-15');
    });

    it('is today when no active account has a value, ignoring inactive accounts', async () => {
      expect(isoDay(await history.earliestDay(today))).toBe('2026-10-09');
      const closed = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
      await prisma.account.update({ where: { id: closed.id }, data: { isActive: false } });
      await seedBalance(prisma, closed.id, '2020-01-01', 5, BalanceRowSource.Manual);
      expect(isoDay(await history.earliestDay(today))).toBe('2026-10-09');
    });
  });
```

`tests/unit/lib/investments/overview.test.ts`:

```ts
  it('starts All at the earliest day any account has a value', async () => {
    const a = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Manual });
    await seedBalance(prisma, a.id, '2025-03-02', 100, BalanceRowSource.Manual);
    const o = await overview('All');
    expect(o).toMatchObject({ range: 'All', from: '2025-03-02' });
    expect(o.portfolio.series[0]).toEqual({ date: '2025-03-02', value: 100, isEstimated: false });
  });
```

`tests/integration/api/investments-overview.test.ts`: in `'accepts a range and rejects an unknown one'`, add `expect((await (await get('?range=All')).json()).range).toBe('All');`.

`tests/unit/components/investments/format.test.ts`: add `spansYear` to the import and:

```ts
  it('adds a two-digit year to a day on request, and knows a range of a year or more', () => {
    expect(fmtDay('2023-10-14')).toBe('Oct 14');
    expect(fmtDay('2023-10-14', { year: true })).toBe('Oct 14, 23');
    expect(spansYear('2025-10-13', '2026-10-13')).toBe(true);
    expect(spansYear('2026-01-01', '2026-10-13')).toBe(false);
  });
```

`tests/unit/components/investments/display.test.tsx`, in `describe('ValueChart')`:

```tsx
  it('puts a two-digit year on the axis dates when asked', () => {
    render(
      <ValueChart
        yearLabels
        currency="USD"
        from="2025-10-13"
        points={[point('2025-10-13', 1), point('2026-10-13', 2)]}
      />
    );
    expect(screen.getAllByText('Oct 13, 25')).toHaveLength(2);
    expect(screen.getByText('Oct 13, 26')).toBeInTheDocument();
  });
```

`tests/unit/components/investments/navigator-detail.test.tsx`, in `describe('AccountDetail')`:

```tsx
  it('labels the All range and dates its axis with years', () => {
    render(
      <AccountDetail
        {...handlers()}
        overview={makeOverview({ range: 'All', from: '2024-10-01' })}
        selected={null}
      />
    );
    expect(screen.getByText('balance change · All')).toBeInTheDocument();
    expect(screen.getByText('Oct 1, 24')).toBeInTheDocument();
  });
```

`tests/unit/components/investments/investments-page.test.tsx`:

```tsx
  it('offers 3Y and All and loads the range picked', async () => {
    render(<InvestmentsPage />);
    await screen.findByRole('heading', { name: 'All accounts' });
    expect(screen.getByRole('button', { name: '3Y' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(screen.getByRole('button', { name: 'All' }));
    await waitFor(() => expect(urls()).toContain('GET /api/investments/overview?range=All'));
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/portfolio-view.test.ts tests/unit/lib/investments/history.test.ts tests/unit/lib/investments/overview.test.ts tests/integration/api/investments-overview.test.ts tests/unit/components/investments`
Expected: FAIL. `3Y`/`All` aren't ranges yet, and `earliestDay`, `spansYear`, the `year` option and `yearLabels` are missing.

- [ ] **Step 3: Ranges**

In `src/lib/investments/portfolio-view.ts`, replace lines 4–16 with:

```ts
export type Range = '1M' | '3M' | 'YTD' | '1Y' | '3Y' | 'All';
export const RANGES: Range[] = ['1M', '3M', 'YTD', '1Y', '3Y', 'All'];
export const DEFAULT_RANGE: Range = '3M';
/** Ranges whose start follows from today alone; 'All' starts where the data does. */
export type FixedRange = Exclude<Range, 'All'>;

export const isRange = (v: unknown): v is Range => RANGES.includes(v as Range);

const RANGE_DAYS: Record<Exclude<FixedRange, 'YTD'>, number> = {
  '1M': 30,
  '3M': 91,
  '1Y': 365,
  '3Y': 1095,
};

/** First day of a fixed range ending today (UTC). */
export function rangeStart(range: FixedRange, today: Date): Date {
  if (range === 'YTD') return utcDay(`${today.getUTCFullYear()}-01-01`);
  return addDays(today, -RANGE_DAYS[range]);
}
```

- [ ] **Step 4: The All range's start**

In `src/lib/investments/history.ts`, add `RecordSource` to the `./codes` import, and above `export class ValueHistoryService` add:

```ts
/** The accounts the investments page values. */
const ACTIVE_INVESTMENT = { trackingMode: 'investment', isActive: true } as const;
```

In `portfolioSeries`, change `where: { trackingMode: 'investment', isActive: true }` to `where: ACTIVE_INVESTMENT`. Add this method to `ValueHistoryService`:

```ts
  /**
   * The first day any active investment account can have a value (the "All" range, spec §6): the
   * earliest stored balance, or an account's first synced holdings day minus BACKFILL_DAYS,
   * whichever is earlier. Today when there's neither.
   */
  async earliestDay(today: Date): Promise<Date> {
    const [balance, synced] = await Promise.all([
      this.prisma.accountBalance.findFirst({
        where: { account: ACTIVE_INVESTMENT, date: { lte: today } },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
      this.prisma.holdingSnapshot.findFirst({
        where: { account: ACTIVE_INVESTMENT, source: RecordSource.Synced },
        orderBy: { date: 'asc' },
        select: { date: true },
      }),
    ]);
    const days = [balance?.date, synced && addDays(synced.date, -BACKFILL_DAYS)].filter(
      (d): d is Date => d != null
    );
    return new Date(Math.min(today.getTime(), ...days.map((d) => d.getTime())));
  }
```

In `src/lib/investments/overview.ts`:
- line 77: `private readonly history: Pick<ValueHistoryService, 'accountSeries' | 'earliestDay'>,`;
- line 86: `const from = range === 'All' ? await this.history.earliestDay(today) : rangeStart(range, today);`.

- [ ] **Step 5: Year labels**

In `src/components/investments/format.ts`, replace `fmtDay` (lines 42–48) with:

```ts
/** `Oct 9` for a `YYYY-MM-DD` day; `Oct 9, 26` with `year`. */
export const fmtDay = (iso: string, opts: { year?: boolean } = {}): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(opts.year ? { year: '2-digit' as const } : {}),
    timeZone: 'UTC',
  });
```

and after `daysBetween`:

```ts
/** A range of a year or more, whose axis dates need a year. */
export const spansYear = (fromIso: string, toIso: string): boolean =>
  daysBetween(fromIso, toIso) >= 365;
```

In `src/components/investments/value-chart.tsx`:
- add `yearLabels = false,` to the destructured props;
- add `/** Axis dates carry a two-digit year (ranges of a year or more). */ yearLabels?: boolean;` to the props type;
- change the axis label to `<span key={`${d}-${i}`}>{fmtDay(d, { year: yearLabels })}</span>`.

In `src/components/investments/account-detail.tsx`:
- import `spansYear` from `./format` (extending the `fmtDay, fmtMoney` import);
- line 211 becomes:

```tsx
      <ValueChart
        currency={currency}
        from={overview.from}
        manual={manual}
        points={series}
        yearLabels={spansYear(overview.from, overview.today)}
      />
```

The page's chips come from `RANGES`, so they need no change.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments tests/unit/components/investments tests/integration/api/investments-overview.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add src/lib/investments/portfolio-view.ts src/lib/investments/history.ts src/lib/investments/overview.ts src/components/investments/format.ts src/components/investments/value-chart.tsx src/components/investments/account-detail.tsx tests/unit/lib/investments/portfolio-view.test.ts tests/unit/lib/investments/history.test.ts tests/unit/lib/investments/overview.test.ts tests/integration/api/investments-overview.test.ts tests/unit/components/investments/format.test.ts tests/unit/components/investments/display.test.tsx tests/unit/components/investments/navigator-detail.test.tsx tests/unit/components/investments/investments-page.test.tsx
git commit -m "feat(investments): 3Y and All ranges, with years on long-range axis dates"
```

---

### Task 5: Light y axis

**Files:**
- Modify: `src/components/investments/chart-geometry.ts`, `src/components/investments/value-chart.tsx` (the `ValueChart` function)
- Test: `tests/unit/components/investments/chart-geometry.test.ts`, `tests/unit/components/investments/display.test.tsx`

**Interfaces:**
- Consumes: `fmtCompact(v, currency)`; Task 4's `yearLabels` prop.
- Produces:
  - `export const GRIDLINES = [0.25, 0.5, 0.75] as const`
  - `ChartGeometry` gains `min: number; span: number`
  - `gridValues(geo: ChartGeometry, box: ChartBox): number[]`, the value at each gridline, top to bottom

- [ ] **Step 1: Write the failing tests**

`tests/unit/components/investments/chart-geometry.test.ts`: add `gridValues, GRIDLINES` to the import and:

```ts
describe('gridValues', () => {
  it('gives the value at each gridline, top to bottom, inverting the plot', () => {
    const box = { width: 100, height: 120, pad: 10 };
    const g = chartGeometry([p(0), p(100)], box)!;
    expect(GRIDLINES).toEqual([0.25, 0.5, 0.75]);
    expect(gridValues(g, box).map((v) => Number(v.toFixed(6)))).toEqual([80, 50, 20]);
  });

  it('follows a lowered floor', () => {
    const box = { width: 100, height: 100, pad: 0, yMin: 0 };
    const g = chartGeometry([p(100), p(100)], box)!;
    expect(gridValues(g, box).map((v) => Number(v.toFixed(6)))).toEqual([75, 50, 25]);
  });
});
```

`tests/unit/components/investments/display.test.tsx`, in `describe('ValueChart')`:

```tsx
  const axisLabels = () =>
    within(screen.getByTestId('chart-y-axis'))
      .getAllByText(/\$/)
      .map((e) => e.textContent);

  it('labels the three gridlines with the values there, recomputed with the points', () => {
    const { rerender } = render(
      <ValueChart
        currency="USD"
        from="2026-10-01"
        points={[point('2026-10-01', 1000), point('2026-10-02', 3000)]}
      />
    );
    expect(axisLabels()).toEqual(['$2.6k', '$2.0k', '$1.4k']);
    rerender(
      <ValueChart
        currency="USD"
        from="2026-10-01"
        points={[point('2026-10-01', 100_000), point('2026-10-02', 300_000)]}
      />
    );
    expect(axisLabels()).toEqual(['$255k', '$200k', '$145k']);
  });

  it('labels a manual account’s axis from its lowered floor', () => {
    render(
      <ValueChart
        manual
        currency="USD"
        from="2026-10-01"
        points={[point('2026-10-01', 1000), point('2026-10-02', 1000, true), point('2026-10-03', 1000)]}
      />
    );
    // yMin = 80% of the last value: the plot spans $800–$1,000.
    expect(axisLabels()).toEqual(['$955', '$900', '$845']);
  });
```

Where these numbers come from: the plot is 170 px high with an 8 px pad, so the gridline at fraction f reads `min + (1 − (170f − 8) / 154) × span`. For 1,000–3,000 that gives 2,551.9 / 2,000 / 1,448.1. For 800–1,000 it gives 955.2 / 900 / 844.8.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/chart-geometry.test.ts tests/unit/components/investments/display.test.tsx`
Expected: FAIL. `gridValues`/`GRIDLINES` and `chart-y-axis` are missing.

- [ ] **Step 3: Geometry**

In `src/components/investments/chart-geometry.ts`:
- add `min: number; span: number;` to `ChartGeometry`, with the doc `/** Value at the plot's floor, and the value range the plot height covers. */`;
- add `min,` and `span,` to `chartGeometry`'s returned object;
- add:

```ts
/** Horizontal gridlines, as fractions of the plot height from the top. */
export const GRIDLINES = [0.25, 0.5, 0.75] as const;

/** The value at each gridline, top to bottom: `chartGeometry`'s y mapping inverted. */
export function gridValues(geo: ChartGeometry, box: ChartBox): number[] {
  return GRIDLINES.map(
    (f) => geo.min + (1 - (box.height * f - box.pad) / (box.height - 2 * box.pad)) * geo.span
  );
}
```

- [ ] **Step 4: The axis in the chart**

In `src/components/investments/value-chart.tsx`:
- import `chartGeometry, GRIDLINES, gridValues, nearestIndex, tooltipSide` from `./chart-geometry`, and add `fmtCompact` to the `./format` import;
- add `const PAD = 8;` under `HEIGHT`;
- replace the `ValueChart` function with the version below. Tooltip, gap note, markers and paths are unchanged; only the 52px gutter, the shared `box` and `GRIDLINES` are new.

```tsx
export function ValueChart({
  points,
  manual = false,
  from,
  currency,
  yearLabels = false,
}: {
  points: SeriesPoint[];
  manual?: boolean;
  from: string;
  currency: string;
  /** Axis dates carry a two-digit year (ranges of a year or more). */
  yearLabels?: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const last = points.at(-1)?.value ?? 0;
  const lead = points.length ? Math.max(0, daysBetween(from, points[0].date)) : 0;
  const box = {
    width: WIDTH,
    height: HEIGHT,
    pad: PAD,
    yMin: manual ? last * 0.8 : undefined,
    lead,
  };
  const geo = chartGeometry(points, box);
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
  const span = lead + lastIndex;
  const labels = [
    from,
    isoDay(addDays(utcDay(from), Math.floor(span / 2))),
    points[lastIndex].date,
  ];
  const axis = gridValues(geo, box);
  const track = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHover(
      rect.width ? nearestIndex((e.clientX - rect.left) / rect.width, points.length, lead) : null
    );
  };
  // The points can change under a resting pointer; an index past them is no hover.
  const hovered =
    hover == null || hover > lastIndex ? null : { point: points[hover], at: geo.points[hover] };
  const hoverPct = hovered ? (hovered.at.x / WIDTH) * 100 : 0;
  return (
    <div className="mt-3">
      <div className="grid grid-cols-[52px_1fr]">
        <div aria-hidden className="relative h-[170px]" data-testid="chart-y-axis">
          {GRIDLINES.map((f, i) => (
            <span
              key={f}
              className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-[var(--text-muted)]"
              style={{ top: `${f * 100}%` }}
            >
              {fmtCompact(axis[i], currency)}
            </span>
          ))}
        </div>
        <div
          className="relative h-[170px] touch-pan-y"
          data-testid="chart-plot"
          onPointerDown={track}
          onPointerLeave={() => setHover(null)}
          onPointerMove={track}
        >
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
            {GRIDLINES.map((f) => (
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
          {lead > GAP_NOTE_DAYS && (
            <div
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-center text-[10.5px] text-[var(--text-muted)]"
              style={{ left: 0, width: `${(geo.points[0].x / WIDTH) * 100}%` }}
            >
              No history before {fmtDay(points[0].date)}
            </div>
          )}
          {hovered && (
            <>
              <div
                className="pointer-events-none absolute inset-y-0 border-l border-[var(--border-hover)]"
                style={{ left: `${hoverPct}%` }}
              />
              <span
                className="pointer-events-none absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--bg-card)] bg-[var(--accent)]"
                style={{ left: `${hoverPct}%`, top: hovered.at.y }}
              />
              <div
                className={`pointer-events-none absolute top-1 whitespace-nowrap rounded-lg border border-[var(--border-hover)] bg-[var(--bg-elevated)] px-2.5 py-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.35)] ${
                  tooltipSide(hoverPct / 100) === 'left' ? '-ml-3.5 -translate-x-full' : 'ml-3.5'
                }`}
                role="tooltip"
                style={{ left: `${hoverPct}%` }}
              >
                <div className="text-[10.5px] text-[var(--text-muted)]">
                  {fmtLongDay(hovered.point.date)}
                </div>
                <div className="font-mono text-sm font-medium text-[var(--text-primary)]">
                  {fmtMoney(hovered.point.value, { currency })}
                </div>
                <div className="flex items-center gap-1.5 text-[10.5px] text-[var(--text-muted)]">
                  <span
                    className={`inline-block h-0 w-3.5 border-t-[1.5px] border-[var(--accent)] ${
                      hovered.point.isEstimated ? 'border-dashed opacity-70' : ''
                    }`}
                  />
                  {pointLabel(hovered.point, manual)}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="ml-[52px] mt-1 flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
        {labels.map((d, i) => (
          <span key={`${d}-${i}`}>{fmtDay(d, { year: yearLabels })}</span>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments && npm run typecheck`
Expected: PASS. The hover tests still pass because the pointer is tracked on `chart-plot`, whose box the tests mock.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add src/components/investments/chart-geometry.ts src/components/investments/value-chart.tsx tests/unit/components/investments/chart-geometry.test.ts tests/unit/components/investments/display.test.tsx
git commit -m "feat(investments): light y axis on value charts"
```

---

### Task 6: Expandable holdings rows

**Files:**
- Modify: `src/lib/investments/holdings-view.ts` (`HoldingLine`, `holdingLines`), `src/components/investments/holdings-table.tsx` (whole file), `src/components/investments/account-detail.tsx` (`<HoldingsTable …>`)
- Test: `tests/unit/lib/investments/holdings-view.test.ts`, `tests/unit/components/investments/display.test.tsx`, `tests/unit/components/investments/navigator-detail.test.tsx`

**Interfaces:**
- Consumes: Task 3's `HoldingsTable` and `HoldingLine` (with no `plaid`).
- Produces:
  - `type HoldingMember = { accountId: string; quantity: number | null; valueBase: number; gainBase: number | null; weightPct: number }`
  - `HoldingLine.members: HoldingMember[]`, sorted by value descending; `accountCount === members.length`
  - `type AccountLabel = { id: string; name: string; institution: string }`
  - `HoldingsTable` props `{ lines, multiAccount, currency, accounts: AccountLabel[] }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/lib/investments/holdings-view.test.ts`: add `SecurityType` to the codes import and, in `describe('holdingLines')`:

```ts
  it('splits a line into one member per account, by value, summing to the line', () => {
    const lines = holdingLines([
      row({ valueBase: 30, gainBase: 3, quantity: 3 }),
      row({ accountId: 'a2', quantity: 7, valueBase: 70, gainBase: null }),
      row({ securityId: 's2', label: 'BBB', valueBase: 100 }),
    ]);
    const aaa = lines.find((l) => l.key === 's1')!;
    expect(aaa.members).toEqual([
      { accountId: 'a2', quantity: 7, valueBase: 70, gainBase: null, weightPct: 35 },
      { accountId: 'a1', quantity: 3, valueBase: 30, gainBase: 3, weightPct: 15 },
    ]);
    expect(aaa.members.reduce((sum, m) => sum + m.valueBase, 0)).toBeCloseTo(aaa.valueBase);
    expect(aaa.members.reduce((sum, m) => sum + m.weightPct, 0)).toBeCloseTo(aaa.weightPct);
  });

  it('groups cash and money market held in one account into one member', () => {
    const [cash] = holdingLines([
      row({ securityId: 'c1', kind: 'cash', type: SecurityType.Cash, label: 'Cash', valueBase: 30, gainBase: null }),
      row({
        securityId: 'm1',
        kind: 'cash',
        type: SecurityType.MoneyMarket,
        label: 'Money market',
        valueBase: 20,
        gainBase: null,
      }),
      row({ accountId: 'a2', securityId: 'c2', kind: 'cash', type: SecurityType.Cash, label: 'Cash', valueBase: 50, gainBase: null }),
    ]);
    expect(cash.accountCount).toBe(2);
    expect(cash.members.map((m) => [m.accountId, m.quantity, m.valueBase])).toEqual([
      ['a1', null, 50],
      ['a2', null, 50],
    ]);
  });
```

`tests/unit/components/investments/display.test.tsx`:
- add back `import userEvent from '@testing-library/user-event';` (Task 3 removed it);
- add `members: [],` to `line()`'s defaults;
- replace `describe('HoldingsTable', …)` with:

```tsx
describe('HoldingsTable', () => {
  const accounts = [
    { id: 'a1', name: 'Roth IRA', institution: 'Example Brokerage' },
    { id: 'a2', name: 'Taxable', institution: 'Example Brokerage' },
  ];
  const spread = line({
    accountCount: 2,
    members: [
      { accountId: 'a1', quantity: 10, valueBase: 1000, gainBase: 200, weightPct: 40 },
      { accountId: 'a2', quantity: 2.5, valueBase: 500, gainBase: 50, weightPct: 20 },
    ],
  });
  const single = line({
    key: 's2',
    securityId: 's2',
    label: 'ZZZ',
    unpriced: true,
    gainBase: null,
    quantity: null,
    weightPct: 40,
    members: [{ accountId: 'a1', quantity: null, valueBase: 1000, gainBase: null, weightPct: 40 }],
  });

  it('shows value, gain and weight, a dash for unknown gain, and no pills', () => {
    render(<HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread, single]} />);
    expect(screen.queryByText('2 accounts')).toBeNull();
    expect(screen.queryByText('No price source')).toBeNull();
    expect(screen.getByText('+$250')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('12.5 · Triple A Fund')).toBeInTheDocument();
    expect(screen.getByText('60.0%')).toBeInTheDocument();
  });

  it('gives only a line held in several accounts a chevron, and lists its accounts when opened', async () => {
    render(<HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread, single]} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    const row = screen.getByRole('button', { name: /AAA/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('holding-member')).toBeNull();
    await userEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    const [roth, taxable] = screen.getAllByTestId('holding-member');
    expect(within(roth).getByText('Roth IRA')).toBeInTheDocument();
    expect(within(roth).getByText('Example Brokerage · 10')).toBeInTheDocument();
    expect(within(roth).getByText('$1,000')).toBeInTheDocument();
    expect(within(roth).getByText('+$200')).toBeInTheDocument();
    expect(within(roth).getByText('40.0%')).toBeInTheDocument();
    expect(within(taxable).getByText('Example Brokerage · 2.5')).toBeInTheDocument();
    await userEvent.click(row);
    expect(screen.queryByTestId('holding-member')).toBeNull();
  });

  it('offers nothing to expand in a single-account view and uses whole-number weights', () => {
    render(
      <HoldingsTable accounts={accounts} currency="USD" lines={[spread]} multiAccount={false} />
    );
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('keeps a line open when the lines are replaced, as on a range change', async () => {
    const { rerender } = render(
      <HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread]} />
    );
    await userEvent.click(screen.getByRole('button', { name: /AAA/ }));
    const moved = {
      ...spread,
      valueBase: 1600,
      members: [{ ...spread.members[0], valueBase: 1100 }, spread.members[1]],
    };
    rerender(<HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[moved]} />);
    expect(screen.getAllByTestId('holding-member')).toHaveLength(2);
    expect(screen.getByText('$1,100')).toBeInTheDocument();
  });

  it('drops the chevron when a reload leaves the line in one account', async () => {
    const { rerender } = render(
      <HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[spread]} />
    );
    await userEvent.click(screen.getByRole('button', { name: /AAA/ }));
    const narrowed = { ...spread, accountCount: 1, members: [spread.members[0]] };
    rerender(<HoldingsTable multiAccount accounts={accounts} currency="USD" lines={[narrowed]} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByTestId('holding-member')).toBeNull();
  });
});
```

`tests/unit/components/investments/navigator-detail.test.tsx`:
- in `'shows all accounts combined'`, replace `expect(screen.getByText('2 accounts')).toBeInTheDocument();` with `expect(screen.getByRole('button', { name: /AAA/ })).toHaveAttribute('aria-expanded', 'false');`;
- add:

```tsx
  it('keeps a holding open across a range change and closes it after switching accounts', async () => {
    const o = makeOverview({
      accounts: [makeAccount(), retirement],
      holdings: [makeHolding(), makeHolding({ accountId: 'acc-ret', quantity: 5, valueBase: 500 })],
    });
    const { rerender } = render(<AccountDetail {...handlers()} overview={o} selected={null} />);
    await userEvent.click(screen.getByRole('button', { name: /AAA/ }));
    expect(screen.getAllByTestId('holding-member')).toHaveLength(2);
    expect(screen.getByText('Workplace Plan')).toBeInTheDocument();
    rerender(<AccountDetail {...handlers()} overview={{ ...o, range: '1Y' }} selected={null} />);
    expect(screen.getAllByTestId('holding-member')).toHaveLength(2);
    rerender(<AccountDetail {...handlers()} overview={o} selected="acc-ret" />);
    rerender(<AccountDetail {...handlers()} overview={o} selected={null} />);
    expect(screen.queryByTestId('holding-member')).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/holdings-view.test.ts tests/unit/components/investments/display.test.tsx tests/unit/components/investments/navigator-detail.test.tsx`
Expected: FAIL. `members`, the `accounts` prop, the chevron button and `holding-member` don't exist yet.

- [ ] **Step 3: Members in the read model**

In `src/lib/investments/holdings-view.ts`, add `members: HoldingMember[];` (doc: `/** One per account holding it, largest first. */`) to `HoldingLine`, define `HoldingMember` above `HoldingLine`:

```ts
/** One account's share of a holdings line. */
export type HoldingMember = {
  accountId: string;
  quantity: number | null;
  valueBase: number;
  gainBase: number | null;
  /** Share of the whole portfolio shown. */
  weightPct: number;
};
```

and replace everything from `const lineKey = …` through the end of `holdingLines` with:

```ts
const lineKey = (r: HoldingRow) => (r.kind === 'cash' ? CASH_KEY : r.securityId);

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  return groups;
}

/** Totals over rows of one security (or of cash): value, gain only when every row has one. */
function totals(rows: HoldingRow[]) {
  const gains = rows.map((r) => r.gainBase);
  return {
    quantity: rows[0].kind === 'security' ? rows.reduce((sum, r) => sum + r.quantity, 0) : null,
    valueBase: roundCents(rows.reduce((sum, r) => sum + r.valueBase, 0)),
    gainBase: gains.every((g) => g != null)
      ? roundCents(gains.reduce((sum: number, g) => sum + g!, 0))
      : null,
  };
}

/** Holdings lines for the given rows: grouped by security, cash merged, sorted by value. */
export function holdingLines(rows: HoldingRow[]): HoldingLine[] {
  const lines = [...groupBy(rows, lineKey).entries()].map(([key, group]) => {
    const first = group[0];
    const isCash = key === CASH_KEY;
    const members = [...groupBy(group, (r) => r.accountId).entries()]
      .map(([accountId, own]) => ({ accountId, ...totals(own), weightPct: 0 }))
      .sort((a, b) => b.valueBase - a.valueBase);
    return {
      key,
      label: isCash ? CASH_LABEL : first.label,
      name: isCash ? CASH_LABEL : first.name,
      kind: first.kind,
      securityId: isCash ? null : first.securityId,
      ...totals(group),
      rangeChangePct: first.rangeChangePct,
      accountCount: members.length,
      unpriced: group.some((m) => m.pricing === Pricing.None),
      weightPct: 0,
      members,
    };
  });

  const shown = lines.filter((l) => l.valueBase > MIN_SHOWN_VALUE);
  const total = shown.reduce((sum, l) => sum + l.valueBase, 0);
  const pct = (v: number) => (total ? (v / total) * 100 : 0);
  return shown
    .map((l) => ({
      ...l,
      weightPct: pct(l.valueBase),
      members: l.members.map((m) => ({ ...m, weightPct: pct(m.valueBase) })),
    }))
    .sort((a, b) => b.valueBase - a.valueBase);
}
```

- [ ] **Step 4: The table**

Replace `src/components/investments/holdings-table.tsx` with:

```tsx
'use client';

import { useState, type ReactNode } from 'react';
import type { HoldingLine } from '@/lib/investments/holdings-view';
import { fmtMoney, fmtQty, fmtSignedMoney, signedTone } from './format';

/** Names a member account on its sub-line. */
export type AccountLabel = { id: string; name: string; institution: string };

const SINGLE = 'grid grid-cols-[1fr_96px_92px_70px] gap-3';
const MULTI = 'grid grid-cols-[18px_1fr_96px_92px_70px] gap-3';
const MONEY = 'text-right font-mono';

function Figures({
  valueBase,
  gainBase,
  weight,
  currency,
}: {
  valueBase: number;
  gainBase: number | null;
  weight: string;
  currency: string;
}) {
  return (
    <>
      <span className={`${MONEY} text-[var(--text-primary)]`}>
        {fmtMoney(valueBase, { currency })}
      </span>
      <span className={`${MONEY} ${signedTone(gainBase)}`}>
        {gainBase == null ? '—' : fmtSignedMoney(gainBase, { currency })}
      </span>
      <span className={`${MONEY} text-[var(--text-secondary)]`}>{weight}</span>
    </>
  );
}

/**
 * Holdings lines. In the all-accounts view a line held in more than one account is a button with
 * a chevron; opening it lists one sub-line per account. Open lines are kept per line key while
 * this table stays mounted (a range change or reload), and reset when it remounts.
 */
export function HoldingsTable({
  lines,
  multiAccount,
  currency,
  accounts,
}: {
  lines: HoldingLine[];
  multiAccount: boolean;
  /** Base currency of `valueBase` and `gainBase`. */
  currency: string;
  accounts: AccountLabel[];
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const grid = multiAccount ? MULTI : SINGLE;
  const weight = (pct: number) => `${pct.toFixed(multiAccount ? 1 : 0)}%`;
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });

  return (
    <div className="mt-2.5">
      <div
        className={`${grid} pb-1.5 text-[10.5px] uppercase tracking-[0.5px] text-[var(--text-muted)]`}
      >
        {multiAccount && <span />}
        <span>Security</span>
        <span className="text-right">Value</span>
        <span className="text-right">Gain</span>
        <span className="text-right">Weight</span>
      </div>
      {lines.map((l, i) => {
        const expandable = multiAccount && l.accountCount > 1;
        const isOpen = expandable && open.has(l.key);
        const rowClass = `${grid} w-full py-2 text-left text-xs ${
          i ? 'border-t border-[var(--border)]' : ''
        }`;
        const cells: ReactNode = (
          <>
            {multiAccount && (
              <span
                aria-hidden
                className={`inline-block text-[11px] leading-[18px] text-[var(--text-muted)] transition-transform ${
                  isOpen ? 'rotate-90' : ''
                }`}
              >
                {expandable ? '›' : ''}
              </span>
            )}
            <span className="block min-w-0">
              <span className="block font-mono font-medium text-[var(--text-primary)] [overflow-wrap:anywhere]">
                {l.label}
              </span>
              <span className="block truncate text-[11px] text-[var(--text-muted)]">
                {l.quantity != null ? `${fmtQty(l.quantity)} · ${l.name}` : l.name}
              </span>
            </span>
            <Figures
              currency={currency}
              gainBase={l.gainBase}
              valueBase={l.valueBase}
              weight={weight(l.weightPct)}
            />
          </>
        );
        return (
          <div key={l.key}>
            {expandable ? (
              <button
                aria-expanded={isOpen}
                className={`${rowClass} hover:bg-[color-mix(in_srgb,var(--bg-elevated)_50%,transparent)]`}
                type="button"
                onClick={() => toggle(l.key)}
              >
                {cells}
              </button>
            ) : (
              <div className={rowClass}>{cells}</div>
            )}
            {isOpen &&
              l.members.map((m) => {
                const account = byId.get(m.accountId);
                const detail = [account?.institution, m.quantity != null ? fmtQty(m.quantity) : null]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <div
                    key={m.accountId}
                    className={`${grid} py-1.5 text-[11.5px] text-[var(--text-secondary)]`}
                    data-testid="holding-member"
                  >
                    <span />
                    <span className="block min-w-0 border-l-2 border-[var(--border-hover)] pl-2.5">
                      {account?.name ?? 'Unknown account'}
                      <small className="block truncate text-[10.5px] text-[var(--text-muted)]">
                        {detail}
                      </small>
                    </span>
                    <Figures
                      currency={currency}
                      gainBase={m.gainBase}
                      valueBase={m.valueBase}
                      weight={weight(m.weightPct)}
                    />
                  </div>
                );
              })}
          </div>
        );
      })}
    </div>
  );
}
```

In `src/components/investments/account-detail.tsx`, render the table as:

```tsx
            <HoldingsTable
              key={account?.id ?? 'all'}
              accounts={overview.accounts}
              currency={currency}
              lines={lines}
              multiAccount={!account}
            />
```

The `key` remounts the table when the selection changes, so switching to another account and back resets open lines (spec §5). A range change or reload keeps the same key, so open lines stay open.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments tests/unit/components/investments && npm run typecheck`
Expected: PASS. `HoldingsMap` and the treemap accept the extra `members` field unchanged.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add src/lib/investments/holdings-view.ts src/components/investments/holdings-table.tsx src/components/investments/account-detail.tsx tests/unit/lib/investments/holdings-view.test.ts tests/unit/components/investments/display.test.tsx tests/unit/components/investments/navigator-detail.test.tsx
git commit -m "feat(investments): expand a holding held in several accounts into per-account lines"
```

---

### Task 7: Check the page on real data (user-gated)

This task runs only after the controller stops and the user agrees. The executor never reads `.env` and never prints database values. The stored-code rename needs no step: the app runs it the first time the restarted server builds its investment services.

- [ ] **Step 1:** Run the full suite: `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration`. Everything must pass, with lint showing 0 errors.
- [ ] **Step 2:** Ask the user to restart their dev server and open `/investments`, then check:
  - the page loads with history and holdings intact (this first load runs the rename);
  - the chips read `1M · 3M · YTD · 1Y · 3Y · All`;
  - All reaches back to the oldest balance or backfill, with "balance change · All";
  - long ranges show `Oct 14, 23`-style dates;
  - the y axis shows three compact labels that change with the range, including on a manual account;
  - holdings rows carry no pills; a security held in several accounts opens into per-account lines that add up, and stays open across a range change;
  - a synced account's pill reads "Synced";
  - an unpriced holding's notice opens the price window with the provider's symbol hint.

  Then ask them to say what looks wrong.
- [ ] **Step 3:** Fix anything they report through the normal task loop: implement, review, then re-check.
- [ ] **Step 4:** Remind the controller to say in the PR description: **update every device to this build before cloud-syncing.** New builds translate old snapshots on import, but a device still on the old build that pulls a new snapshot would see unknown codes.
