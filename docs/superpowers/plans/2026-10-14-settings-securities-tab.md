# Settings → Securities Tab (Plan 4a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Settings tab lists every security that investment accounts hold or have traded, with how each is priced, and opens the price window to change it. The investments page links to this tab instead of opening the window itself.

**Architecture:**
- **Read model:**
  - `SecurityListReader` (`src/lib/investments/security-list.ts`) is wired in `services.ts` as `securityList`. It finds the referenced securities with one Prisma query.
  - It counts `heldIn` from each active account's latest snapshot set, using `latestSets`, which is extracted from `CurrentHoldingsReader`.
  - It reads each latest price through `PriceBook.load` and a new `PricingStrategy.latest()`, so each pricing mode's own source filter decides which price counts.
  - `GET /api/investments/securities` returns `{ securities, symbolHint }`.
- **Window:** `SetSymbolModal` becomes `PriceWindow` (`price-window.tsx`). It takes a `SecurityListItem`, its new title is "How {label} is priced", and it opens with a "Currently" line. Pure label helpers live in `src/components/investments/securities-view.ts`.
- **Pages:**
  - `SecuritiesTab` (`src/components/investments/securities-tab.tsx`) holds the toolbar, rows, deep-link highlight and window. The Settings page only adds the tab and renders the component.
  - The investments page drops the window. Its unpriced notice links to `/settings?tab=securities&security={id}`, and the overview drops `symbolHint`.

**Tech Stack:** Next.js App Router (`package.json` pins next 16.1.6), React 19, TypeScript, Prisma 5.22 + SQLite, Zod v4, Vitest 4 + Testing Library (jsdom), Tailwind 3.

**Spec:** `docs/superpowers/specs/2026-10-14-settings-securities-tab-design.md`. Approved mock: `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/holdings-securities.html`, screen 2 (`#s-securities`, `S`, `openModal`). The mock's names and numbers are synthetic. Never copy them into fixtures as if they were real.

## Rulings while writing

1. **Latest price comes from the strategies.**
   - `PricingStrategy` gains `latest(points): LatestPrice | null`, with `LatestPrice = { price: number; date: Date | null }`.
   - Each mode reads only its own source through the existing `fromSource` filter:
     - Market reads market closes, with no institution fallback (spec §3), so a security switched to Market a moment ago shows "—" until its first close.
     - Institution reads institution closes, with or without a proxy.
     - Manual reads manual prices.
     - Fixed gives `fixedPrice ?? 1` with a null date.
     - None gives null.
   - `PriceBook.latest(securityId)` exposes it, and the reader loads prices with the existing `PriceBook.load`. No new price query is added.
2. **Reader dependencies:**
   - The reader is `new SecurityListReader(prisma, symbolHint, clock = systemClock)`.
   - `symbolHint` is wired the way the overview wired it until now.
   - The clock gives `PriceBook.load` its `to` day, and gives the snapshots the same `date <= today` cut-off that `CurrentHoldingsReader` uses.
   - The service key is `securityList`, so it doesn't clash with the response's `securities` key.
3. **Manual-account mirror securities (`manual-holding-{accountId}`) are left out.** They are account balances, not securities, and a manual price set on one would be overwritten by the next balance entry. `manual-holding.ts` gains `isManualHoldingSecurity(id)`. The spec is silent here.
4. **`latestSets` is extracted** from `CurrentHoldingsReader.read` into an exported function in `current-holdings.ts`, and both readers use it (DRY).
5. **The window is renamed** `SetSymbolModal` → `PriceWindow` (file `price-window.tsx`, moved with `git mv`) and takes a `SecurityListItem`.
   - `PriceTarget` and `InstitutionQuote` are deleted from `holdings-view.ts`. They existed only for this plan.
   - The following line reads "Following {proxySymbol}" without the fund name: the list carries only `proxySymbol`, and the mock shows the same.
   - The fund hint becomes the spec's shorter sentence.
6. **Typographic apostrophes (’)** are used in copy, as everywhere else in the app's UI. Otherwise copy is verbatim from the spec.
7. **Edge labels:**
   - Market with no `priceSymbol` → `Market`.
   - Manual with no stored price → `Manual` with no second line.
   - The Fixed label uses `latest.price`, so the `?? 1` default lives in one place (`FixedPricing`).
   - Unknown stored pricing values label as None, just as `pricingFor` prices them.
8. **Security column:** the muted second line (name) is left out when it equals the label. Cash rows have no ticker, so their label is their name.
9. **Toolbar and states:**
   - The toggle counts cover the whole list, not the search result.
   - The toolbar is hidden when there are no securities.
   - When the filters leave nothing, the card shows "No securities match.".
   - While loading, it shows "Loading securities…".
   - A failed load shows "Couldn’t load securities. Try again", following the investments page's wording.
10. **Visuals:**
    - Warning colour is `var(--accent)`, the app's warn tone, as in the mock.
    - The highlight is an accent ring, a tinted background and `aria-current="true"`. It clears on any click in the document.
    - The highlighted row scrolls into view (`block: 'center'`) when the list arrives.
11. **Markup:** rows are `<li aria-label={label}>` inside `<ul aria-label="Securities">`, which gives tests and screen readers a name per row.
12. **Task order:** the window and investments page (Task 2) come before the tab (Task 3), so the tab is built once, on the final window.
13. **Lint guard scope is unchanged.** All new code sits under `src/lib/investments`, `src/components/investments` and `src/app/api/investments`, which are already in scope. `src/app/(routes)/settings` stays out, because it holds bank-connection code.
14. **Settings wiring test:** it renders the real `SettingsPage`, with `next/navigation` (a third-party module) mocked per file to give the `?tab=securities&security=` params. None of our own modules are mocked.
15. **`securitySettingsHref(id)`** in `securities-view.ts` builds the deep link the notice uses.
16. **Overview:** `InvestmentOverview` loses `symbolHint` (spec §5). Nothing else reads it.
17. **Controller rulings (spec amended 2026-10-14):**
    - Pricing None's second line is "Valued at its last known price", which matches `UnpricedPricing` and the investments notice.
    - The window's "Currently" line names the source without repeating a price: Manual and Fixed drop their price from the label ("Currently Manual · $64.30 on Sep 30", "Currently Fixed · $2.00").
    - `priceSourceView` returns both `name` (window) and `main` (row label) from the one label table, so nothing is duplicated.

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
  - Pure view helpers (`securities-view.ts`, `account-states.ts`, `format.ts`) stay functions.
- **Schema:** no change. Never run `prisma migrate dev`. Never read `.env`. Never read or print values from `prisma/dev.db`.
- **Dates:** all UTC. Day values are `YYYY-MM-DD` strings in the API. Display dates use `fmtDay` (`timeZone: 'UTC'`).
- **Stored codes** come only through the enums in `src/lib/investments/codes.ts` (`Pricing`, `PriceSource`, `SecurityType`, …). There are no bare stored-value strings in code or tests.
- **No vendor names (Plaid, Teller, Yahoo) outside the integration gateways.** The only provider-specific text on screen is `symbolHint`, which the gateway supplies. The `vendor-literals` guard must stay green.
- **No real network in tests.** Use `fakeProvider` / `testServices` from `tests/helpers/investments.ts`. Component tests mock `global.fetch`.
- **UI conventions:**
  - Client components start with `'use client'`.
  - Colours only via CSS variables (`var(--accent)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--text-muted)`, `var(--bg-card)`, `var(--bg-elevated)`, `var(--bg-surface)`, `var(--border)`, `var(--border-hover)`). No new hex colours.
  - Numbers, tickers and prices use `font-mono`.
  - Reuse `Modal`, `Button`, `Input` and `Card` from `src/components/ui/`.
  - Copy (labels, hints, errors) is verbatim from this plan.
  - The tab body lives in its own component file, never inline in `settings/page.tsx`.
- **The GitHub repo is public.** No account names, balances, holdings or other personal data in committed code, tests, fixtures or copy. Tests use synthetic data (`Example Brokerage`, `AAA`, `Triple A Fund`, `PLAN`, `PRXY` …). Never take values from the local database or from the mock.
- **Lint:**
  - Only `console.warn` / `console.error`. Prefix unused vars with `_`.
  - Single quotes, semicolons, 100-char lines.
  - JSX props sorted (`react/jsx-sort-props`: reserved first, shorthand first, callbacks last).
  - Run `npm run lint:fix` before each commit.
- **Line numbers** are as of commit `fdb2c47`. The quoted code is the anchor and the number is a hint.
- **Tests:**
  - Vitest. DB tests use `setupTestDb` / `resetTestDb` / `teardownTestDb` from `tests/helpers/db.ts`.
  - Run one file with `npx vitest run <path>`.
  - The `testServices` clock is `2026-10-09T22:00Z`, and its provider's `symbolHint` is `'Use test symbols.'`.
- **Git:**
  - Stage explicit paths only. Never stage `.claude/` or `.superpowers/`.
  - `docs/` is gitignored, and this plan is not committed.
  - Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A manual account's balance mirror showing up as a security.** If `manual-holding-*` securities were listed, the pencil would let a user "price" an account balance, and the next balance entry would silently undo it. They must not appear. *Task 1 test: "leaves out securities no investment account references, and manual-account mirrors".*
2. **"Held in" after a sale, a move or a closed account.** An account whose latest snapshot holds zero, one whose latest set no longer contains the security, and an inactive account must not count. An account whose latest snapshot is older still counts. *Task 1 tests: "counts only active accounts whose latest snapshot holds a non-zero quantity" and "includes securities of inactive accounts, held in none".*
3. **A security just switched to Market, with only institution prices stored.** Its latest price is "—" until its first market close. It must not show a stale institution price under a "Market" label. *Task 1 test: "gives a fixed price with no date, and nothing for unpriced or missing sources".*
4. **A deep link from the investments page.**
   - The row is highlighted and scrolled to.
   - The Needs attention filter is not forced on.
   - The highlight clears on the next click.
   - Saving reloads the list without re-highlighting.

   *Task 3 test: "highlights and scrolls to the deep-linked security until the next click".*
5. **A search that matches nothing, and a failed load.**
   - An empty search result says "No securities match." and keeps the toggle counts at whole-list values.
   - A failed load offers Try again rather than a blank card.

   *Task 3 tests: "searches ticker or name, ignoring case" and "offers Try again when the list fails to load".*

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `src/lib/prices/pricing.ts` | `LatestPrice`; `PricingStrategy.latest` on every strategy | 1 |
| `src/lib/prices/price-book.ts` | `PriceBook.latest(securityId)` | 1 |
| `src/lib/investments/manual-holding.ts` | `isManualHoldingSecurity(id)` | 1 |
| `src/lib/investments/current-holdings.ts` | exported `latestSets`, used by `read` | 1 |
| `src/lib/investments/security-list.ts` (new) | `SecurityListItem`, `SecurityList`, `SecurityListReader` | 1 |
| `src/lib/investments/services.ts` | wires `securityList` (1); overview loses `symbolHint` (2) | 1, 2 |
| `src/app/api/investments/securities/route.ts` | `GET` list | 1 |
| `src/lib/investments/overview.ts` | drops `symbolHint` | 2 |
| `src/lib/investments/holdings-view.ts` | drops `PriceTarget`, `InstitutionQuote` | 2 |
| `src/components/investments/securities-view.ts` (new) | pure labels: source (2), latest (2), href (2), type/held-in/filters (3) | 2, 3 |
| `src/components/investments/price-window.tsx` (renamed from `set-symbol-modal.tsx`) | the price window | 2 |
| `src/components/investments/account-detail.tsx` | unpriced notice → **Set up pricing** link; no `onSetSymbol` | 2 |
| `src/app/(routes)/investments/page.tsx` | no window, no symbol dialog | 2 |
| `src/components/investments/securities-tab.tsx` (new) | the tab body | 3 |
| `src/app/(routes)/settings/page.tsx` | tab list + render `SecuritiesTab` | 3 |
| `tests/helpers/investment-overview.ts` | drops `symbolHint`; adds `makeSecurityItem` | 2 |

---

### Task 1: Securities list reader and `GET /api/investments/securities`

**Files:**
- Create: `src/lib/investments/security-list.ts`, `tests/unit/lib/investments/security-list.test.ts`
- Modify: `src/lib/prices/pricing.ts`, `src/lib/prices/price-book.ts`, `src/lib/investments/manual-holding.ts:14`, `src/lib/investments/current-holdings.ts:41-45`, `src/lib/investments/services.ts`, `src/app/api/investments/securities/route.ts`
- Test: `tests/unit/lib/prices/pricing.test.ts`, `tests/unit/lib/prices/price-book.test.ts`, `tests/unit/lib/investments/manual-holding.test.ts`, `tests/integration/api/investment-securities-apis.test.ts`

**Interfaces:**
- Consumes: `pricingFor`, `PricePoint`, `PriceBook.load(prisma, ids, to)`, `manualHoldingSecurityId`, `testServices`, the seed helpers.
- Produces:
  - `type LatestPrice = { price: number; date: Date | null }` and `PricingStrategy.latest(points: PricePoint[]): LatestPrice | null` (`@/lib/prices/pricing`)
  - `PriceBook.latest(securityId: string): LatestPrice | null`
  - `isManualHoldingSecurity(securityId: string): boolean` (`@/lib/investments/manual-holding`)
  - `latestSets<T extends { accountId: string; date: Date }>(newestFirst: T[]): T[]` (`@/lib/investments/current-holdings`)
  - from `@/lib/investments/security-list`:
    ```ts
    type SecurityListItem = {
      id: string; label: string; name: string; type: SecurityType; currency: string;
      pricing: Pricing; priceSymbol: string | null; proxySymbol: string | null;
      fixedPrice: number | null; latest: { price: number; date: string | null } | null;
      heldIn: number;
    };
    type SecurityList = { securities: SecurityListItem[]; symbolHint: string };
    class SecurityListReader { list(): Promise<SecurityList> }
    ```
  - `InvestmentServices.securityList: SecurityListReader`
  - `GET /api/investments/securities` → `200 SecurityList`

- [ ] **Step 1: Write the failing strategy, book and mirror tests**

In `tests/unit/lib/prices/pricing.test.ts`, add this block at the end of the file (`p`, `day`, `pricingFor`, `PriceSource`, `Pricing` and `PricePoint` are already imported there):

```ts
describe('latest price per mode', () => {
  const pts = [
    p('2026-10-01', 10, PriceSource.Market),
    p('2026-10-02', 20, PriceSource.Institution),
    p('2026-10-03', 30, PriceSource.Manual),
    p('2026-10-04', 11, PriceSource.Market),
    p('2026-10-05', 21, PriceSource.Institution),
  ];
  const latest = (pricing: string, fixedPrice: number | null = null, proxy?: PricePoint[]) =>
    pricingFor({ pricing, fixedPrice }, proxy).latest(pts);

  it('reads only the mode’s own source', () => {
    expect(latest(Pricing.Market)).toEqual({ price: 11, date: day('2026-10-04') });
    expect(latest(Pricing.Institution)).toEqual({ price: 21, date: day('2026-10-05') });
    expect(
      latest(Pricing.Institution, null, [p('2026-10-06', 50, PriceSource.Market)])
    ).toEqual({ price: 21, date: day('2026-10-05') });
    expect(latest(Pricing.Manual)).toEqual({ price: 30, date: day('2026-10-03') });
  });

  it('gives a fixed price with no date, and nothing for unpriced or missing sources', () => {
    expect(latest(Pricing.Fixed, 2.5)).toEqual({ price: 2.5, date: null });
    expect(latest(Pricing.Fixed)).toEqual({ price: 1, date: null });
    expect(latest(Pricing.None)).toBeNull();
    expect(
      pricingFor({ pricing: Pricing.Market, fixedPrice: null }).latest([
        p('2026-10-02', 20, PriceSource.Institution),
      ])
    ).toBeNull();
  });
});
```

In `tests/unit/lib/prices/price-book.test.ts`, add inside `describe('PriceBook / loadFxRates', …)`:

```ts
  it('gives a security’s latest price from its own mode, up to the requested day', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await seedPrice(prisma, s.id, '2026-10-01', 10);
    await seedPrice(prisma, s.id, '2026-10-05', 12);
    await seedPrice(prisma, s.id, '2026-10-06', 13);
    await seedPrice(prisma, s.id, '2026-10-04', 99, PriceSource.Institution);
    const book = await PriceBook.load(prisma, [s.id], day('2026-10-05'));
    expect(book.latest(s.id)).toEqual({ price: 12, date: day('2026-10-05') });
    expect(book.latest('missing')).toBeNull();
  });
```

In `tests/unit/lib/investments/manual-holding.test.ts`, change line 12 to
`import { ManualHoldingService, isManualHoldingSecurity, manualHoldingSecurityId } from '@/lib/investments/manual-holding';`
and add at the end of the file:

```ts
describe('isManualHoldingSecurity', () => {
  it('recognises any account’s mirror security and nothing else', () => {
    expect(isManualHoldingSecurity(manualHoldingSecurityId('acc-1'))).toBe(true);
    expect(isManualHoldingSecurity('sec-aaa')).toBe(false);
  });
});
```

- [ ] **Step 2: Write the failing reader test**

Create `tests/unit/lib/investments/security-list.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../../helpers/db';
import { createAccountData } from '../../../helpers/factories';
import {
  seedInvestmentAccount,
  seedPrice,
  seedSecurity,
  seedSnapshot,
  seedTrade,
  testServices,
} from '../../../helpers/investments';
import { BalanceSource, PriceSource, Pricing, SecurityType } from '@/lib/investments/codes';

let prisma: PrismaClient;
// Clock: 2026-10-09T22:00Z. The fake provider's symbol hint is 'Use test symbols.'.
const services = () => testServices(prisma).services;
const list = () => services().securityList.list();
const byLabel = async () => new Map((await list()).securities.map((s) => [s.label, s]));
const hold = (accountId: string, securityId: string, date: string, quantity: number) =>
  seedSnapshot(prisma, { accountId, securityId, date, quantity, price: 10 });

describe('SecurityListReader', () => {
  beforeAll(async () => {
    prisma = await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
  });

  it('lists securities held in snapshots and named in trades, with the symbol hint', async () => {
    const a = await seedInvestmentAccount(prisma);
    const held = await seedSecurity(prisma, { priceSymbol: 'AAA', name: 'Triple A Fund' });
    const traded = await seedSecurity(prisma, { priceSymbol: 'BBB', name: 'Double B Fund' });
    await hold(a.id, held.id, '2026-10-01', 2);
    await seedTrade(prisma, {
      accountId: a.id,
      securityId: traded.id,
      date: '2026-09-15',
      type: 'buy',
      quantity: 1,
      amount: 20,
    });
    await seedPrice(prisma, held.id, '2026-10-08', 11);
    const result = await list();
    expect(result.symbolHint).toBe('Use test symbols.');
    expect(result.securities).toEqual([
      {
        id: held.id,
        label: 'AAA',
        name: 'Triple A Fund',
        type: SecurityType.Etf,
        currency: 'USD',
        pricing: Pricing.Market,
        priceSymbol: 'AAA',
        proxySymbol: null,
        fixedPrice: null,
        latest: { price: 11, date: '2026-10-08' },
        heldIn: 1,
      },
      {
        id: traded.id,
        label: 'BBB',
        name: 'Double B Fund',
        type: SecurityType.Etf,
        currency: 'USD',
        pricing: Pricing.Market,
        priceSymbol: 'BBB',
        proxySymbol: null,
        fixedPrice: null,
        latest: null,
        heldIn: 0,
      },
    ]);
  });

  it('includes securities of inactive accounts, held in none', async () => {
    const closed = await seedInvestmentAccount(prisma, { name: 'Closed Brokerage' });
    await prisma.account.update({ where: { id: closed.id }, data: { isActive: false } });
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await hold(closed.id, s.id, '2026-10-01', 5);
    expect((await byLabel()).get('AAA')?.heldIn).toBe(0);
  });

  it('counts only active accounts whose latest snapshot holds a non-zero quantity', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const other = await seedSecurity(prisma, { priceSymbol: 'BBB' });
    const holding = await seedInvestmentAccount(prisma, { name: 'Holding' });
    const olderButHolding = await seedInvestmentAccount(prisma, { name: 'Older but holding' });
    const soldToZero = await seedInvestmentAccount(prisma, { name: 'Sold to zero' });
    const movedOn = await seedInvestmentAccount(prisma, { name: 'Moved on' });
    await hold(holding.id, s.id, '2026-10-01', 5);
    await hold(olderButHolding.id, s.id, '2026-09-01', 1);
    await hold(soldToZero.id, s.id, '2026-09-01', 5);
    await hold(soldToZero.id, s.id, '2026-10-01', 0);
    await hold(movedOn.id, s.id, '2026-09-01', 5);
    await hold(movedOn.id, other.id, '2026-10-01', 3);
    const rows = await byLabel();
    expect(rows.get('AAA')?.heldIn).toBe(2);
    expect(rows.get('BBB')?.heldIn).toBe(1);
  });

  it('gives the latest price each pricing mode uses, with the proxy symbol and fixed price', async () => {
    const a = await seedInvestmentAccount(prisma);
    const market = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
    const fund = await prisma.security.create({
      data: {
        name: 'Example Plan Trust',
        ticker: 'PLAN',
        type: SecurityType.MutualFund,
        currency: 'USD',
        pricing: Pricing.Institution,
        proxySecurityId: proxy.id,
      },
    });
    const manual = await seedSecurity(prisma, {
      priceSymbol: null,
      name: 'Example Share Plan',
      type: SecurityType.Other,
      pricing: Pricing.Manual,
    });
    const cash = await seedSecurity(prisma, {
      priceSymbol: null,
      name: 'CAD cash',
      type: SecurityType.Cash,
      currency: 'CAD',
      pricing: Pricing.Fixed,
      fixedPrice: 1,
    });
    const unpriced = await seedSecurity(prisma, { priceSymbol: 'OLDF', pricing: Pricing.None });
    for (const s of [market, fund, manual, cash, unpriced]) {
      await hold(a.id, s.id, '2026-10-01', 1);
    }
    await seedPrice(prisma, market.id, '2026-10-07', 10);
    await seedPrice(prisma, market.id, '2026-10-08', 11);
    await seedPrice(prisma, market.id, '2026-10-09', 99, PriceSource.Institution);
    await seedPrice(prisma, fund.id, '2026-10-06', 28.5, PriceSource.Institution);
    await seedPrice(prisma, proxy.id, '2026-10-08', 50);
    await seedPrice(prisma, manual.id, '2026-09-30', 64.3, PriceSource.Manual);
    await seedPrice(prisma, unpriced.id, '2026-10-02', 7, PriceSource.Institution);
    const rows = await byLabel();
    expect(rows.get('AAA')?.latest).toEqual({ price: 11, date: '2026-10-08' });
    expect(rows.get('PLAN')).toMatchObject({
      pricing: Pricing.Institution,
      proxySymbol: 'PRXY',
      latest: { price: 28.5, date: '2026-10-06' },
    });
    expect(rows.get('Example Share Plan')?.latest).toEqual({ price: 64.3, date: '2026-09-30' });
    expect(rows.get('CAD cash')).toMatchObject({
      currency: 'CAD',
      fixedPrice: 1,
      latest: { price: 1, date: null },
    });
    expect(rows.get('OLDF')?.latest).toBeNull();
    expect(rows.has('PRXY')).toBe(false); // a proxy no account holds or trades is not listed
  });

  it('leaves out securities no investment account references, and manual-account mirrors', async () => {
    await seedSecurity(prisma, { priceSymbol: 'LONE' });
    const spending = await prisma.account.create({
      data: createAccountData({ name: 'Everyday' }),
    });
    const elsewhere = await seedSecurity(prisma, { priceSymbol: 'ELSE' });
    await hold(spending.id, elsewhere.id, '2026-10-01', 1);
    const pension = await seedInvestmentAccount(prisma, {
      balanceSource: BalanceSource.Manual,
      name: 'Pension',
    });
    await services().manualHoldings.record(pension.id, { date: '2026-10-01', balance: 500 });
    expect((await list()).securities).toEqual([]);
  });

  it('sorts by label, ignoring case, using the name when there is no ticker', async () => {
    const a = await seedInvestmentAccount(prisma);
    const seeds = [
      ['bbb', 'B Fund'],
      [null, 'Alpha Trust'],
      ['CCC', 'C Fund'],
      ['AAA', 'A Fund'],
    ] as const;
    for (const [priceSymbol, name] of seeds) {
      const s = await seedSecurity(prisma, { priceSymbol, name });
      await hold(a.id, s.id, '2026-10-01', 1);
    }
    expect((await list()).securities.map((s) => s.label)).toEqual([
      'AAA',
      'Alpha Trust',
      'bbb',
      'CCC',
    ]);
  });
});
```

- [ ] **Step 3: Write the failing route test**

In `tests/integration/api/investment-securities-apis.test.ts`:
- change line 28 to `import { GET as list, POST as create } from '@/app/api/investments/securities/route';`;
- add `SecurityType` to the `@/lib/investments/codes` import;
- add this test inside the top-level `describe`:

```ts
  it('GET lists the securities investment accounts reference, with the symbol hint', async () => {
    const a = await seedInvestmentAccount(testPrisma);
    const s = await seedSecurity(testPrisma, { priceSymbol: 'AAA', name: 'Triple A Fund' });
    await seedSnapshot(testPrisma, {
      accountId: a.id,
      securityId: s.id,
      date: '2026-10-01',
      quantity: 2,
      price: 10,
    });
    await seedPrice(testPrisma, s.id, '2026-10-08', 11);
    const res = await list();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      securities: [
        {
          id: s.id,
          label: 'AAA',
          name: 'Triple A Fund',
          type: SecurityType.Etf,
          currency: 'USD',
          pricing: Pricing.Market,
          priceSymbol: 'AAA',
          proxySymbol: null,
          fixedPrice: null,
          latest: { price: 11, date: '2026-10-08' },
          heldIn: 1,
        },
      ],
      symbolHint: 'Use test symbols.',
    });
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/price-book.test.ts tests/unit/lib/investments/manual-holding.test.ts tests/unit/lib/investments/security-list.test.ts tests/integration/api/investment-securities-apis.test.ts`
Expected: FAIL. `latest` is not a function, `isManualHoldingSecurity` is not exported, `securityList` is undefined, and `GET` is not exported.

- [ ] **Step 5: Add `latest` to the strategies and the book**

In `src/lib/prices/pricing.ts`, replace lines 2–9 (the type exports and the interface) with:

```ts
export type PricePoint = { date: Date; close: number; source: string };
export type PricedAt = { price: number; estimated: boolean };
/** The newest price a pricing mode reads from its own source; `date` is null for a constant. */
export type LatestPrice = { price: number; date: Date | null };

/** How one pricing mode prices a security on a UTC day (rules table in Plan 2, Task 3). */
export interface PricingStrategy {
  /** `points` are the security's stored prices, date ascending. */
  priceOn(points: PricePoint[], date: Date): PricedAt | null;
  /** The newest of `points` this mode reads (Settings → Securities); null when none. */
  latest(points: PricePoint[]): LatestPrice | null;
}
```

After `fromSource` (line 12), add:

```ts
function lastFrom(points: PricePoint[], source: string): LatestPrice | null {
  const last = fromSource(points, source).at(-1);
  return last ? { price: last.close, date: last.date } : null;
}
```

Add one method to each strategy class:
- in `FixedPricing`:
  ```ts
    latest(): LatestPrice {
      return { price: this.priceOn().price, date: null };
    }
  ```
- in `InstitutionPricing`:
  ```ts
    latest(points: PricePoint[]): LatestPrice | null {
      return lastFrom(points, PriceSource.Institution);
    }
  ```
- in `ProxiedInstitutionPricing`:
  ```ts
    latest(points: PricePoint[]): LatestPrice | null {
      return this.fallback.latest(points);
    }
  ```
- in `MarketPricing`:
  ```ts
    latest(points: PricePoint[]): LatestPrice | null {
      return lastFrom(points, PriceSource.Market);
    }
  ```
- in `ManualPricing`:
  ```ts
    latest(points: PricePoint[]): LatestPrice | null {
      return lastFrom(points, PriceSource.Manual);
    }
  ```
- in `UnpricedPricing`:
  ```ts
    latest(): null {
      return null;
    }
  ```

In `src/lib/prices/price-book.ts`, change line 3 to
`import { pricingFor, type LatestPrice, type PricedAt, type PricePoint, type PricingStrategy } from './pricing';`
and add after `at(…)`:

```ts
  /** The newest price the security's own pricing mode stored; null when unknown or none. */
  latest(securityId: string): LatestPrice | null {
    const entry = this.entries.get(securityId);
    return entry ? entry.strategy.latest(entry.points) : null;
  }
```

- [ ] **Step 6: Add the mirror check and extract `latestSets`**

In `src/lib/investments/manual-holding.ts`, replace line 14 with:

```ts
const MANUAL_HOLDING_PREFIX = 'manual-holding-';

export const manualHoldingSecurityId = (accountId: string) => `${MANUAL_HOLDING_PREFIX}${accountId}`;

/** Whether a security is a manual account's balance mirror rather than a real security. */
export const isManualHoldingSecurity = (securityId: string) =>
  securityId.startsWith(MANUAL_HOLDING_PREFIX);
```

In `src/lib/investments/current-holdings.ts`, replace lines 41–45 (`const latestDay = …` through `const current = …`) with:

```ts
    const current = latestSets(snapshots);
```

Add at the end of the file:

```ts
/** Each account's newest snapshot set, from snapshots sorted newest first. */
export function latestSets<T extends { accountId: string; date: Date }>(newestFirst: T[]): T[] {
  const latestDay = new Map<string, number>();
  for (const s of newestFirst) {
    if (!latestDay.has(s.accountId)) latestDay.set(s.accountId, s.date.getTime());
  }
  return newestFirst.filter((s) => s.date.getTime() === latestDay.get(s.accountId));
}
```

- [ ] **Step 7: Create the reader**

Create `src/lib/investments/security-list.ts`:

```ts
import type { PrismaClient } from '@prisma/client';
import { systemClock, type Clock } from '@/lib/clock';
import { PriceBook } from '@/lib/prices/price-book';
import type { Pricing, SecurityType } from './codes';
import { latestSets } from './current-holdings';
import { isoDay, utcDay } from './dates';
import { isManualHoldingSecurity } from './manual-holding';

/** One row of Settings → Securities (spec 2026-10-14 §6). */
export type SecurityListItem = {
  id: string;
  /** Ticker, or the name when there is no ticker. */
  label: string;
  name: string;
  type: SecurityType;
  currency: string;
  pricing: Pricing;
  priceSymbol: string | null;
  proxySymbol: string | null;
  fixedPrice: number | null;
  /** The latest price the security's pricing mode uses; `date` (YYYY-MM-DD) is null for Fixed. */
  latest: { price: number; date: string | null } | null;
  /** Active accounts whose latest snapshot holds a non-zero quantity. */
  heldIn: number;
};

export type SecurityList = { securities: SecurityListItem[]; symbolHint: string };

const INVESTMENT = { trackingMode: 'investment' } as const;

/**
 * Every security an investment account (active or closed) holds or traded, with how it is
 * priced. Manual accounts' balance mirrors are not securities and are left out.
 */
export class SecurityListReader {
  constructor(
    private readonly prisma: PrismaClient,
    /** How to write a price symbol, from the market data provider; shown in the price window. */
    private readonly symbolHint: string,
    private readonly clock: Clock = systemClock
  ) {}

  async list(): Promise<SecurityList> {
    const today = utcDay(this.clock.now());
    const referenced = { some: { account: INVESTMENT } };
    const [found, snapshots] = await Promise.all([
      this.prisma.security.findMany({
        where: { OR: [{ holdings: referenced }, { transactions: referenced }] },
        include: { proxy: { select: { priceSymbol: true } } },
      }),
      this.prisma.holdingSnapshot.findMany({
        where: { account: { ...INVESTMENT, isActive: true }, date: { lte: today } },
        select: { accountId: true, securityId: true, date: true, quantity: true },
        orderBy: { date: 'desc' },
      }),
    ]);
    const securities = found.filter((s) => !isManualHoldingSecurity(s.id));

    const heldIn = new Map<string, number>();
    const real = snapshots.filter((s) => !isManualHoldingSecurity(s.securityId));
    for (const s of latestSets(real)) {
      if (s.quantity !== 0) heldIn.set(s.securityId, (heldIn.get(s.securityId) ?? 0) + 1);
    }

    const book = await PriceBook.load(
      this.prisma,
      securities.map((s) => s.id),
      today
    );
    const items: SecurityListItem[] = securities.map((s) => {
      const latest = book.latest(s.id);
      return {
        id: s.id,
        label: s.ticker ?? s.name,
        name: s.name,
        type: s.type as SecurityType,
        currency: s.currency,
        pricing: s.pricing as Pricing,
        priceSymbol: s.priceSymbol,
        proxySymbol: s.proxy?.priceSymbol ?? null,
        fixedPrice: s.fixedPrice,
        latest: latest
          ? { price: latest.price, date: latest.date ? isoDay(latest.date) : null }
          : null,
        heldIn: heldIn.get(s.id) ?? 0,
      };
    });
    items.sort(
      (a, b) =>
        a.label.toLowerCase().localeCompare(b.label.toLowerCase()) || a.id.localeCompare(b.id)
    );
    return { securities: items, symbolHint: this.symbolHint };
  }
}
```

- [ ] **Step 8: Wire it and add the route**

In `src/lib/investments/services.ts`:
- add `import { SecurityListReader } from './security-list';` after the `./rename-stored-codes` import;
- add `securityList: SecurityListReader;` to `InvestmentServices` after `overview`;
- add this to the returned object after `overview: …`:

```ts
    securityList: new SecurityListReader(prisma, provider.symbolHint, clock),
```

In `src/app/api/investments/securities/route.ts`, add above `POST`:

```ts
/** Every security investment accounts hold or traded, with how it's priced (Settings → Securities). */
export async function GET() {
  try {
    const { securityList } = await getInvestmentServices();
    return NextResponse.json(await securityList.list());
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load securities');
  }
}
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices tests/unit/lib/investments tests/integration/api/investment-securities-apis.test.ts tests/unit/lint/vendor-literals.test.ts`
Expected: PASS. That includes `current-holdings.test.ts`, which proves the `latestSets` extraction changed nothing.

Then run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
npm run lint:fix
git add src/lib/prices/pricing.ts src/lib/prices/price-book.ts src/lib/investments/manual-holding.ts src/lib/investments/current-holdings.ts src/lib/investments/security-list.ts src/lib/investments/services.ts src/app/api/investments/securities/route.ts tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/price-book.test.ts tests/unit/lib/investments/manual-holding.test.ts tests/unit/lib/investments/security-list.test.ts tests/integration/api/investment-securities-apis.test.ts
git commit -m "feat(investments): securities list reader and GET /api/investments/securities

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Price window from the list; investments page links to Settings

**Files:**
- Create: `src/components/investments/securities-view.ts`, `tests/unit/components/investments/securities-view.test.ts`
- Rename: `src/components/investments/set-symbol-modal.tsx` → `src/components/investments/price-window.tsx` (`git mv`)
- Modify: `src/components/investments/account-detail.tsx`, `src/app/(routes)/investments/page.tsx`, `src/lib/investments/overview.ts`, `src/lib/investments/services.ts`, `src/lib/investments/holdings-view.ts:7-23`
- Test: `tests/helpers/investment-overview.ts`, `tests/unit/components/investments/editors.test.tsx`, `tests/unit/components/investments/navigator-detail.test.tsx`, `tests/unit/components/investments/investments-page.test.tsx`, `tests/unit/lib/investments/overview.test.ts`

**Interfaces:**
- Consumes: `SecurityListItem` (Task 1), `fmtDay`, `fmtMoney`, `editor-kit`.
- Produces:
  - from `@/components/investments/securities-view`:
    - `type PriceSourceView = { name: string; main: string; detail: string | null; warn: boolean }` (`name`: the source without its price, for the window; `main`: the row's label)
    - `type LatestView = { price: string; date: string | null }`
    - `latestView(s: SecurityListItem): LatestView | null`
    - `priceSourceView(s: SecurityListItem): PriceSourceView`
    - `securitySettingsHref(securityId: string): string`
  - `PriceWindow({ security: SecurityListItem; hint: string; onClose(): void; onSaved(): void })` from `@/components/investments/price-window`
  - `makeSecurityItem(over?: Partial<SecurityListItem>): SecurityListItem` in `tests/helpers/investment-overview.ts`
  - Removes: `SetSymbolModal`, `PriceTarget`, `InstitutionQuote`, `DetailProps.onSetSymbol`, `InvestmentOverview.symbolHint`.

- [ ] **Step 1: Add the fixture helper**

In `tests/helpers/investment-overview.ts`:
- change line 4 to `import { BalanceSource, Pricing, SecurityType } from '@/lib/investments/codes';`;
- add `import type { SecurityListItem } from '@/lib/investments/security-list';`;
- delete line 65 (`symbolHint: 'Use test symbols.',`);
- add at the end:

```ts
export function makeSecurityItem(over: Partial<SecurityListItem> = {}): SecurityListItem {
  return {
    id: 'sec-aaa',
    label: 'AAA',
    name: 'Triple A Fund',
    type: SecurityType.Etf,
    currency: 'USD',
    pricing: Pricing.Market,
    priceSymbol: 'AAA',
    proxySymbol: null,
    fixedPrice: null,
    latest: { price: 110, date: '2026-10-08' },
    heldIn: 1,
    ...over,
  };
}
```

- [ ] **Step 2: Write the failing view-helper test**

Create `tests/unit/components/investments/securities-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  latestView,
  priceSourceView,
  securitySettingsHref,
} from '@/components/investments/securities-view';
import { Pricing } from '@/lib/investments/codes';
import { makeSecurityItem } from '../../../helpers/investment-overview';

describe('priceSourceView', () => {
  it.each([
    [
      'market',
      makeSecurityItem(),
      { name: 'Market · AAA', main: 'Market · AAA', detail: null, warn: false },
    ],
    [
      'institution following a fund',
      makeSecurityItem({ pricing: Pricing.Institution, priceSymbol: null, proxySymbol: 'PRXY' }),
      {
        name: 'Institution',
        main: 'Institution',
        detail: 'Follows PRXY on days without an institution price',
        warn: false,
      },
    ],
    [
      'institution alone',
      makeSecurityItem({ pricing: Pricing.Institution, priceSymbol: null }),
      { name: 'Institution', main: 'Institution', detail: 'Not following a fund', warn: false },
    ],
    [
      'manual',
      makeSecurityItem({ pricing: Pricing.Manual, latest: { price: 64.3, date: '2026-09-30' } }),
      { name: 'Manual', main: 'Manual · $64.30', detail: 'Entered Sep 30', warn: false },
    ],
    [
      'fixed',
      makeSecurityItem({
        pricing: Pricing.Fixed,
        currency: 'CAD',
        fixedPrice: 1,
        latest: { price: 1, date: null },
      }),
      { name: 'Fixed', main: 'Fixed · CA$1.00', detail: null, warn: false },
    ],
    [
      'none',
      makeSecurityItem({ pricing: Pricing.None, latest: null }),
      {
        name: 'No price source',
        main: 'No price source',
        detail: 'Valued at its last known price',
        warn: true,
      },
    ],
  ])('labels %s', (_name, item, view) => {
    expect(priceSourceView(item)).toEqual(view);
  });

  it('falls back when the data behind a label is missing', () => {
    expect(priceSourceView(makeSecurityItem({ priceSymbol: null })).main).toBe('Market');
    expect(priceSourceView(makeSecurityItem({ pricing: Pricing.Manual, latest: null }))).toEqual({
      name: 'Manual',
      main: 'Manual',
      detail: null,
      warn: false,
    });
    const unknown = makeSecurityItem({ pricing: 'something-new' as Pricing });
    expect(priceSourceView(unknown).main).toBe('No price source');
  });
});

describe('latestView', () => {
  it('formats the price in the security’s currency, with a UTC day', () => {
    expect(latestView(makeSecurityItem({ currency: 'CAD' }))).toEqual({
      price: 'CA$110.00',
      date: 'Oct 8',
    });
    expect(latestView(makeSecurityItem({ latest: { price: 1, date: null } }))).toEqual({
      price: '$1.00',
      date: null,
    });
    expect(latestView(makeSecurityItem({ latest: null }))).toBeNull();
  });
});

describe('securitySettingsHref', () => {
  it('deep-links the securities tab to one security', () => {
    expect(securitySettingsHref('sec-z')).toBe('/settings?tab=securities&security=sec-z');
  });
});
```

- [ ] **Step 3: Rewrite the window tests**

In `tests/unit/components/investments/editors.test.tsx`:
- replace line 6 with `import { PriceWindow } from '@/components/investments/price-window';`;
- change line 7 to `import { makeHolding, makeSecurityItem } from '../../../helpers/investment-overview';`;
- add `import type { SecurityListItem } from '@/lib/investments/security-list';`;
- replace the whole `describe('SetSymbolModal', …)` block (from line 220 to the end of the file) with:

```tsx
describe('PriceWindow', () => {
  const hint = 'Use test symbols.';
  const market = makeSecurityItem({
    id: 'sec-z',
    label: 'ZZZ',
    priceSymbol: 'ZZZ',
    latest: { price: 11, date: '2026-10-08' },
  });
  const open = (security: SecurityListItem, onSaved = vi.fn()) =>
    render(<PriceWindow hint={hint} security={security} onClose={vi.fn()} onSaved={onSaved} />);
  const currently = () => screen.getByText('Currently').parentElement;

  it('titles the window and says how the security is priced now', () => {
    open(market);
    expect(screen.getByRole('heading', { name: 'How ZZZ is priced' })).toBeInTheDocument();
    expect(currently()).toHaveTextContent('Currently Market · ZZZ · $11.00 on Oct 8');
  });

  it('leaves out the price when there is none, and the date when the source has none', () => {
    const { unmount } = open(makeSecurityItem({ pricing: Pricing.None, latest: null }));
    expect(currently()).toHaveTextContent(/^Currently No price source$/);
    unmount();
    open(
      makeSecurityItem({ pricing: Pricing.Fixed, fixedPrice: 2, latest: { price: 2, date: null } })
    );
    expect(currently()).toHaveTextContent(/^Currently Fixed · \$2\.00$/);
  });

  it('names a manual price once, with the day it was entered', () => {
    open(
      makeSecurityItem({ pricing: Pricing.Manual, latest: { price: 64.3, date: '2026-09-30' } })
    );
    expect(currently()).toHaveTextContent(/^Currently Manual · \$64\.30 on Sep 30$/);
  });

  it('points the security at a new symbol, under the provider’s symbol hint', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    const onSaved = vi.fn();
    open(market, onSaved);
    expect(screen.getByText('Use test symbols.')).toBeInTheDocument();
    expect(screen.queryByText(/Yahoo/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Price symbol'), 'ZZZ.TO');
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0].body).toEqual({ priceSymbol: 'ZZZ.TO' });
  });

  it('sets a manual price, and validates both inputs', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    open(market);
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    expect(screen.getByText('Enter a symbol')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    expect(screen.getByText('Enter a positive price')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Or set a price per unit'), '50.73');
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    await waitFor(() => expect(calls()[0]?.body).toEqual({ manualPrice: 50.73 }));
  });

  describe('for a fund priced by its institution', () => {
    const fund = makeSecurityItem({
      id: 'sec-p',
      label: 'PLAN',
      name: 'Example Plan Trust',
      pricing: Pricing.Institution,
      priceSymbol: null,
      latest: { price: 28.34, date: '2026-10-10' },
    });

    it('shows the institution’s price and follows a fund', async () => {
      replies['PATCH /api/investments/securities/sec-p'] = ok({ security: {} });
      const onSaved = vi.fn();
      open(fund, onSaved);
      expect(currently()).toHaveTextContent('Currently Institution · $28.34 on Oct 10');
      expect(screen.getByText(/stays the real price/)).toHaveTextContent(
        'The institution’s price stays the real price. On days without one, this holding moves with the fund you pick.'
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
      open({ ...fund, proxySymbol: 'PRXY' });
      expect(screen.getByText(/^Following/)).toHaveTextContent(/^Following PRXY$/);
      await userEvent.click(screen.getByRole('button', { name: 'Stop following' }));
      await waitFor(() => expect(calls()[0]?.body).toEqual({ proxySymbol: null }));
    });
  });

  it('offers no fund to follow for a security its institution does not price', () => {
    open(market);
    expect(screen.queryByText('No public ticker? Follow a similar fund')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Rewrite the investments-page, detail and overview tests**

In `tests/unit/components/investments/navigator-detail.test.tsx`:
- delete `onSetSymbol: vi.fn(),` from `handlers` (line 25);
- rename the test at line 219 to `'offers Reconnect, Retry and Set up pricing from notices'`;
- replace its lines 251–256 (the `Set symbol` click and the `onSetSymbol` assertion) with:

```tsx
    expect(screen.getByRole('link', { name: 'Set up pricing' })).toHaveAttribute(
      'href',
      '/settings?tab=securities&security=sec-z'
    );
    expect(screen.queryByRole('button', { name: 'Set symbol' })).toBeNull();
```

In `tests/unit/components/investments/investments-page.test.tsx`, replace the last test (`'shows the price provider’s symbol hint in the price window'`) with:

```tsx
  it('links an unpriced holding’s notice to Settings → Securities, with no price window', async () => {
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
    expect(await screen.findByRole('link', { name: 'Set up pricing' })).toHaveAttribute(
      'href',
      '/settings?tab=securities&security=sec-z'
    );
    expect(screen.getByText('ZZZ has no price source.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set symbol' })).toBeNull();
    expect(screen.queryByRole('heading', { name: /is priced$/ })).toBeNull();
  });
```

In `tests/unit/lib/investments/overview.test.ts`, replace the test at lines 226–228 with:

```ts
  it('leaves the symbol hint to the securities list', async () => {
    expect(await overview()).not.toHaveProperty('symbolHint');
  });
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments tests/unit/lib/investments/overview.test.ts`
Expected: FAIL. `securities-view` and `price-window` don't exist, there is no "Set up pricing" link, and the overview still carries `symbolHint`.

- [ ] **Step 6: Create the view helpers**

Create `src/components/investments/securities-view.ts`:

```ts
import { Pricing } from '@/lib/investments/codes';
import type { SecurityListItem } from '@/lib/investments/security-list';
import { fmtDay, fmtMoney } from './format';

/**
 * How a security is priced. `name` is the source alone (the window's "Currently" line, which shows
 * the price itself); `main` is the row's label, which adds the price for Manual and Fixed.
 */
export type PriceSourceView = { name: string; main: string; detail: string | null; warn: boolean };
/** The latest price as shown: money in the security's currency, and its day (none for Fixed). */
export type LatestView = { price: string; date: string | null };

export function latestView(s: SecurityListItem): LatestView | null {
  if (!s.latest) return null;
  return {
    price: fmtMoney(s.latest.price, { cents: true, currency: s.currency }),
    date: s.latest.date ? fmtDay(s.latest.date) : null,
  };
}

const source = (
  name: string,
  detail: string | null = null,
  main: string = name
): PriceSourceView => ({ name, main, detail, warn: false });

/** A source whose row label carries its price (Manual, Fixed). */
const withPrice = (name: string, latest: LatestView | null) =>
  latest ? `${name} · ${latest.price}` : name;

const SOURCE_VIEWS: Record<
  Pricing,
  (s: SecurityListItem, latest: LatestView | null) => PriceSourceView
> = {
  [Pricing.Market]: (s) => source(s.priceSymbol ? `Market · ${s.priceSymbol}` : 'Market'),
  [Pricing.Institution]: (s) =>
    source(
      'Institution',
      s.proxySymbol
        ? `Follows ${s.proxySymbol} on days without an institution price`
        : 'Not following a fund'
    ),
  [Pricing.Manual]: (_s, latest) =>
    source(
      'Manual',
      latest?.date ? `Entered ${latest.date}` : null,
      withPrice('Manual', latest)
    ),
  [Pricing.Fixed]: (_s, latest) => source('Fixed', null, withPrice('Fixed', latest)),
  [Pricing.None]: () => ({
    ...source('No price source', 'Valued at its last known price'),
    warn: true,
  }),
};

/** How a security is priced, in words (spec §3); unknown stored values read as None. */
export function priceSourceView(s: SecurityListItem): PriceSourceView {
  const view = SOURCE_VIEWS[s.pricing] ?? SOURCE_VIEWS[Pricing.None];
  return view(s, latestView(s));
}

/** Settings → Securities, scrolled to and highlighting one security. */
export const securitySettingsHref = (securityId: string) =>
  `/settings?tab=securities&security=${encodeURIComponent(securityId)}`;
```

- [ ] **Step 7: Turn the modal into the price window**

Run: `git mv src/components/investments/set-symbol-modal.tsx src/components/investments/price-window.tsx`

Replace the whole content of `src/components/investments/price-window.tsx` with:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Pricing } from '@/lib/investments/codes';
import type { SecurityListItem } from '@/lib/investments/security-list';
import { ERROR, FIELD_LABEL, HINT, errorText, sendJson } from './editor-kit';
import { latestView, priceSourceView } from './securities-view';

type PatchBody = { priceSymbol: string } | { manualPrice: number } | { proxySymbol: string | null };

/** How one security is priced now, and the ways to change it (Settings → Securities). */
export function PriceWindow({
  security,
  hint,
  onClose,
  onSaved,
}: {
  security: SecurityListItem;
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
  const source = priceSourceView(security);
  const latest = latestView(security);

  const patch = async (body: PatchBody) => {
    setSaving(true);
    setError(null);
    try {
      await sendJson(`/api/investments/securities/${security.id}`, 'PATCH', body);
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
    <Modal isOpen title={`How ${security.label} is priced`} onClose={onClose}>
      <p className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-[var(--text-primary)]">
        <span className="text-[var(--text-muted)]">Currently</span>{' '}
        <b className="font-medium">{source.name}</b>
        {latest && (
          <>
            {' '}
            <span className="font-mono">· {latest.price}</span>
            {latest.date && <span className="text-[var(--text-muted)]"> on {latest.date}</span>}
          </>
        )}
      </p>
      <label className={FIELD_LABEL} htmlFor="price-window-symbol">
        Price symbol
      </label>
      <div className="flex gap-2">
        <Input
          className="font-mono"
          id="price-window-symbol"
          placeholder="e.g. VTI or XIU.TO"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
        />
        <Button disabled={saving} type="button" onClick={useSymbol}>
          Use symbol
        </Button>
      </div>
      {hint && <p className={HINT}>{hint}</p>}
      <label className={`${FIELD_LABEL} mt-4`} htmlFor="price-window-price">
        Or set a price per unit
      </label>
      <div className="flex gap-2">
        <Input
          className="font-mono"
          id="price-window-price"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
        />
        <Button disabled={saving} type="button" variant="outline" onClick={setManualPrice}>
          Set price
        </Button>
      </div>
      {security.pricing === Pricing.Institution && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className={FIELD_LABEL}>No public ticker? Follow a similar fund</p>
          {security.proxySymbol ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-[var(--text-primary)]">
              <span>
                Following <span className="font-mono">{security.proxySymbol}</span>
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
            with the fund you pick.
          </p>
        </div>
      )}
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
```

- [ ] **Step 8: Remove the window from the investments page; link the notice**

In `src/components/investments/account-detail.tsx`:
- add `import Link from 'next/link';` after the `react` import;
- remove `type PriceTarget,` from the `@/lib/investments/holdings-view` import (lines 6–11);
- add `import { securitySettingsHref } from './securities-view';` after the `./pills` import;
- delete `onSetSymbol: (target: PriceTarget) => void;` from `DetailProps` (line 47);
- replace the `unpriced` entry of `NOTICE_ACTIONS` (lines 67–75) with:

```tsx
  unpriced: (a) => (
    <Link className={BUTTON} href={securitySettingsHref(a.status.unpriced[0].securityId)}>
      Set up pricing
    </Link>
  ),
```

In `src/app/(routes)/investments/page.tsx`:
- delete line 10 (`import { SetSymbolModal } …`) and line 13 (`import type { PriceTarget } …`);
- delete the `| { kind: 'symbol'; security: PriceTarget }` variant from `Dialog` (line 20), so `Dialog` ends after the `'holdings'` variant with a `;`;
- delete `onSetSymbol={(security) => setDialog({ kind: 'symbol', security })}` (line 161);
- delete the `{dialog?.kind === 'symbol' && ( … )}` block (lines 186–194).

In `src/lib/investments/holdings-view.ts`, delete lines 7–23 (`InstitutionQuote` and `PriceTarget` with their comments).

In `src/lib/investments/overview.ts`:
- delete lines 59–60 (the `symbolHint` field and its comment) from `InvestmentOverview`;
- delete lines 82–83 (the `symbolHint` constructor parameter and its comment);
- delete line 187 (`symbolHint: this.symbolHint,`).

In `src/lib/investments/services.ts`, delete the `provider.symbolHint,` argument from `new InvestmentOverviewService(…)`.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments tests/unit/lib/investments tests/integration/api/investments-overview.test.ts tests/unit/lint/vendor-literals.test.ts`
Expected: PASS.

Then run: `npm run typecheck && grep -rn "SetSymbolModal\|PriceTarget\|InstitutionQuote\|onSetSymbol\|set-symbol-modal" src tests`
Expected: no type errors, and grep prints nothing.

- [ ] **Step 10: Commit**

```bash
npm run lint:fix
git add src/components/investments/securities-view.ts src/components/investments/set-symbol-modal.tsx src/components/investments/price-window.tsx src/components/investments/account-detail.tsx "src/app/(routes)/investments/page.tsx" src/lib/investments/holdings-view.ts src/lib/investments/overview.ts src/lib/investments/services.ts tests/helpers/investment-overview.ts tests/unit/components/investments/securities-view.test.ts tests/unit/components/investments/editors.test.tsx tests/unit/components/investments/navigator-detail.test.tsx tests/unit/components/investments/investments-page.test.tsx tests/unit/lib/investments/overview.test.ts
git commit -m "feat(investments): price window shows how a security is priced; page links to Settings

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Securities tab in Settings

**Files:**
- Create: `src/components/investments/securities-tab.tsx`, `tests/unit/components/investments/securities-tab.test.tsx`, `tests/unit/components/settings-securities.test.tsx`
- Modify: `src/components/investments/securities-view.ts`, `src/app/(routes)/settings/page.tsx:42,1911,2412`
- Test: `tests/unit/components/investments/securities-view.test.ts`

**Interfaces:**
- Consumes:
  - `SecurityList`, `SecurityListItem` (Task 1)
  - `PriceWindow`, `priceSourceView`, `latestView`, `makeSecurityItem` (Task 2)
  - `plural` from `./account-states`
  - `triggerSync` from `@/lib/cloud-sync`, which dispatches the `financeos-sync-trigger` window event
- Produces:
  - from `securities-view.ts`:
    - `typeLabel(type: SecurityType): string`
    - `heldInText(accounts: number): string`
    - `type SecurityFilter = 'all' | 'attention'`
    - `SECURITY_FILTERS: { id: SecurityFilter; label: string; keeps(s: SecurityListItem): boolean }[]`
    - `filterSecurities(items: SecurityListItem[], filter: SecurityFilter, query: string): SecurityListItem[]`
  - `SecuritiesTab({ focusId: string | null })` from `@/components/investments/securities-tab`

- [ ] **Step 1: Write the failing view-helper tests**

In `tests/unit/components/investments/securities-view.test.ts`:
- extend the `securities-view` import with `filterSecurities, heldInText, SECURITY_FILTERS, typeLabel`;
- change the codes import to `import { Pricing, SecurityType } from '@/lib/investments/codes';`;
- append:

```ts
describe('typeLabel and heldInText', () => {
  it('names every security type', () => {
    expect(Object.values(SecurityType).map(typeLabel)).toEqual([
      'ETF',
      'Stock',
      'Fund',
      'Money market',
      'Cash',
      'Crypto',
      'Other',
    ]);
    expect(typeLabel('warrant' as SecurityType)).toBe('Other');
  });

  it('counts accounts, or says the security is not held', () => {
    expect([0, 1, 3].map(heldInText)).toEqual(['Not held', '1 account', '3 accounts']);
  });
});

describe('filterSecurities', () => {
  const items = [
    makeSecurityItem({ id: 'a', label: 'AAA', name: 'Triple A Fund' }),
    makeSecurityItem({ id: 'p', label: 'PLAN', name: 'Example Plan Trust', pricing: Pricing.None }),
  ];
  const ids = (filter: 'all' | 'attention', q = '') =>
    filterSecurities(items, filter, q).map((s) => s.id);

  it('keeps securities with no price source under Needs attention', () => {
    expect(SECURITY_FILTERS.map((f) => f.label)).toEqual(['All', 'Needs attention']);
    expect(ids('all')).toEqual(['a', 'p']);
    expect(ids('attention')).toEqual(['p']);
  });

  it('searches ticker or name, ignoring case and surrounding spaces', () => {
    expect(ids('all', '  trust ')).toEqual(['p']);
    expect(ids('all', 'aaa')).toEqual(['a']);
    expect(ids('attention', 'aaa')).toEqual([]);
  });
});
```

- [ ] **Step 2: Write the failing tab test**

Create `tests/unit/components/investments/securities-tab.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecuritiesTab } from '@/components/investments/securities-tab';
import { Pricing, SecurityType } from '@/lib/investments/codes';
import type { SecurityList } from '@/lib/investments/security-list';
import { makeSecurityItem } from '../../../helpers/investment-overview';

const LIST: SecurityList = {
  symbolHint: 'Use test symbols.',
  securities: [
    makeSecurityItem({ id: 'sec-aaa', label: 'AAA', name: 'Triple A Fund', heldIn: 2 }),
    makeSecurityItem({
      id: 'sec-cash',
      label: 'CAD cash',
      name: 'CAD cash',
      type: SecurityType.Cash,
      currency: 'CAD',
      pricing: Pricing.Fixed,
      priceSymbol: null,
      fixedPrice: 1,
      latest: { price: 1, date: null },
    }),
    makeSecurityItem({
      id: 'sec-old',
      label: 'OLDF',
      name: 'Legacy Balanced Fund',
      type: SecurityType.MutualFund,
      pricing: Pricing.None,
      priceSymbol: 'OLDF',
      latest: null,
      heldIn: 0,
    }),
    makeSecurityItem({
      id: 'sec-plan',
      label: 'PLAN',
      name: 'Example Plan Trust',
      type: SecurityType.MutualFund,
      pricing: Pricing.Institution,
      priceSymbol: null,
      proxySymbol: 'PRXY',
      latest: { price: 28.5, date: '2026-10-06' },
    }),
  ],
};

let list: SecurityList;
let listStatus: number;
const scrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  list = LIST;
  listStatus = 200;
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    if (key === 'GET /api/investments/securities') {
      return { ok: listStatus < 400, status: listStatus, json: async () => list } as Response;
    }
    if (key.startsWith('PATCH /api/investments/securities/')) {
      return { ok: true, status: 200, json: async () => ({ security: {} }) } as Response;
    }
    return { ok: false, status: 404, json: async () => ({ error: 'Not mocked' }) } as Response;
  }) as unknown as typeof fetch;
});

afterEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

const urls = () =>
  vi.mocked(global.fetch).mock.calls.map(([u, init]) => `${init?.method ?? 'GET'} ${String(u)}`);
const row = (label: string) => screen.getByRole('listitem', { name: label });
const shown = () => screen.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
const ready = () => screen.findByRole('listitem', { name: 'AAA' });

describe('SecuritiesTab', () => {
  it('shows each security’s type, accounts, price source and latest price', async () => {
    render(<SecuritiesTab focusId={null} />);
    const aaa = await ready();
    for (const text of ['Triple A Fund', 'ETF', '2 accounts', 'Market · AAA', '$110.00', 'Oct 8']) {
      expect(within(aaa).getByText(text)).toBeInTheDocument();
    }
    const edit = within(aaa).getByRole('button', { name: 'Change how AAA is priced' });
    expect(edit).toHaveAttribute('title', 'Change how AAA is priced');

    const plan = row('PLAN');
    expect(within(plan).getByText('Fund')).toBeInTheDocument();
    expect(within(plan).getByText('1 account')).toBeInTheDocument();
    expect(within(plan).getByText('Institution')).toBeInTheDocument();
    expect(
      within(plan).getByText('Follows PRXY on days without an institution price')
    ).toBeInTheDocument();
    expect(within(plan).getByText('$28.50')).toBeInTheDocument();

    const old = row('OLDF');
    expect(within(old).getByText('Not held')).toBeInTheDocument();
    expect(within(old).getByText('No price source')).toHaveClass('text-[var(--accent)]');
    expect(within(old).getByText('Valued at its last known price')).toBeInTheDocument();
    expect(within(old).getByText('—')).toBeInTheDocument();

    const cash = row('CAD cash');
    expect(within(cash).getByText('Cash')).toBeInTheDocument();
    expect(within(cash).getByText('Fixed · CA$1.00')).toBeInTheDocument();
    expect(within(cash).getAllByText('CAD cash')).toHaveLength(1);
    expect(within(cash).queryByRole('button')).toBeNull();
  });

  it('filters to securities that need attention, with both counts', async () => {
    render(<SecuritiesTab focusId={null} />);
    await ready();
    const all = screen.getByRole('button', { name: 'All · 4' });
    const attention = screen.getByRole('button', { name: 'Needs attention · 1' });
    expect(all).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(attention);
    expect(attention).toHaveAttribute('aria-pressed', 'true');
    expect(shown()).toEqual(['OLDF']);
    await userEvent.click(all);
    expect(shown()).toEqual(['AAA', 'CAD cash', 'OLDF', 'PLAN']);
  });

  it('searches ticker or name, ignoring case', async () => {
    render(<SecuritiesTab focusId={null} />);
    await ready();
    const search = screen.getByPlaceholderText('Search ticker or name');
    await userEvent.type(search, 'TRUST');
    expect(shown()).toEqual(['PLAN']);
    await userEvent.clear(search);
    await userEvent.type(search, 'aa');
    expect(shown()).toEqual(['AAA']);
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('No securities match.')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'All · 4' })).toBeInTheDocument();
  });

  it('explains an empty list', async () => {
    list = { securities: [], symbolHint: 'Use test symbols.' };
    render(<SecuritiesTab focusId={null} />);
    expect(
      await screen.findByText(
        'No securities yet. They appear once an investment account has holdings or trades.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search ticker or name')).toBeNull();
  });

  it('highlights and scrolls to the deep-linked security until the next click', async () => {
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    render(<SecuritiesTab focusId="sec-plan" />);
    const plan = await screen.findByRole('listitem', { name: 'PLAN' });
    expect(plan).toHaveAttribute('aria-current', 'true');
    expect(plan).toHaveClass('ring-[var(--accent)]');
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ block: 'center' }));
    expect(scrolled.mock.contexts[0]).toBe(plan);
    expect(screen.getByRole('button', { name: 'Needs attention · 1' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(shown()).toHaveLength(4);
    await userEvent.click(document.body);
    expect(plan).not.toHaveAttribute('aria-current');
    expect(plan).not.toHaveClass('ring-[var(--accent)]');
  });

  it('opens the price window, and a save closes it, reloads the list and syncs', async () => {
    const synced = vi.fn();
    window.addEventListener('financeos-sync-trigger', synced);
    render(<SecuritiesTab focusId={null} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Change how PLAN is priced' }));
    expect(screen.getByRole('heading', { name: 'How PLAN is priced' })).toBeInTheDocument();
    expect(screen.getByText('Currently').parentElement).toHaveTextContent(
      'Currently Institution · $28.50 on Oct 6'
    );
    expect(screen.getByText('Use test symbols.')).toBeInTheDocument();
    expect(screen.getByText(/^Following/)).toHaveTextContent(/^Following PRXY$/);

    list = {
      ...LIST,
      securities: LIST.securities.map((s) =>
        s.id === 'sec-plan' ? { ...s, proxySymbol: null } : s
      ),
    };
    await userEvent.click(screen.getByRole('button', { name: 'Stop following' }));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'How PLAN is priced' })).toBeNull()
    );
    expect(await within(row('PLAN')).findByText('Not following a fund')).toBeInTheDocument();
    expect(urls()).toEqual([
      'GET /api/investments/securities',
      'PATCH /api/investments/securities/sec-plan',
      'GET /api/investments/securities',
    ]);
    await waitFor(() => expect(synced).toHaveBeenCalledTimes(1));
    window.removeEventListener('financeos-sync-trigger', synced);
  });

  it('offers Try again when the list fails to load', async () => {
    listStatus = 500;
    render(<SecuritiesTab focusId={null} />);
    expect(await screen.findByText(/Couldn’t load securities\./)).toBeInTheDocument();
    listStatus = 200;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await ready()).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Write the failing Settings wiring test**

Create `tests/unit/components/settings-securities.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeSecurityItem } from '../../helpers/investment-overview';

// Overrides tests/setup.ts for this file: the page reads ?tab= and ?security=.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams('tab=securities&security=sec-aaa'),
}));

import SettingsPage from '@/app/(routes)/settings/page';

beforeEach(() => {
  // Every other Settings endpoint answers `{}`; the page defaults each missing list to [].
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const body =
      String(url) === '/api/investments/securities'
        ? { securities: [makeSecurityItem()], symbolHint: 'Use test symbols.' }
        : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
});

describe('Settings → Securities', () => {
  it('sits between Accounts and Categories and opens on the deep-linked security', async () => {
    render(<SettingsPage />);
    const tabs = screen.getAllByRole('link').map((l) => l.textContent);
    const at = tabs.indexOf('Accounts');
    expect(tabs.slice(at, at + 3)).toEqual(['Accounts', 'Securities', 'Categories']);
    expect(screen.getByRole('link', { name: 'Securities' })).toHaveAttribute(
      'href',
      '/settings?tab=securities'
    );
    expect(await screen.findByRole('listitem', { name: 'AAA' })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });
});
```

If `SettingsPage` can't render in jsdom for a reason that has nothing to do with this task (an import that throws on load, say), stop and report it to the controller. Don't mock our own components to work around it.

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/securities-view.test.ts tests/unit/components/investments/securities-tab.test.tsx tests/unit/components/settings-securities.test.tsx`
Expected: FAIL. The helpers aren't exported, `securities-tab` doesn't exist, and the Settings page has no Securities link.

- [ ] **Step 5: Add the tab's view helpers**

In `src/components/investments/securities-view.ts`:
- change the codes import to `import { Pricing, SecurityType } from '@/lib/investments/codes';`;
- add `import { plural } from './account-states';`;
- append:

```ts
const TYPE_LABELS: Record<SecurityType, string> = {
  [SecurityType.Etf]: 'ETF',
  [SecurityType.Equity]: 'Stock',
  [SecurityType.MutualFund]: 'Fund',
  [SecurityType.MoneyMarket]: 'Money market',
  [SecurityType.Cash]: 'Cash',
  [SecurityType.Crypto]: 'Crypto',
  [SecurityType.Other]: 'Other',
};

/** The Type column; an unknown stored type reads Other. */
export const typeLabel = (type: SecurityType): string => TYPE_LABELS[type] ?? 'Other';

/** The Held in column. */
export const heldInText = (accounts: number): string =>
  accounts === 0 ? 'Not held' : plural(accounts, 'account');

export type SecurityFilter = 'all' | 'attention';

/** The segmented toggle; Needs attention means no price source. */
export const SECURITY_FILTERS: {
  id: SecurityFilter;
  label: string;
  keeps: (s: SecurityListItem) => boolean;
}[] = [
  { id: 'all', label: 'All', keeps: () => true },
  { id: 'attention', label: 'Needs attention', keeps: (s) => s.pricing === Pricing.None },
];

/** The rows a filter and a search (ticker or name, any case) leave. */
export function filterSecurities(
  items: SecurityListItem[],
  filter: SecurityFilter,
  query: string
): SecurityListItem[] {
  const keeps = SECURITY_FILTERS.find((f) => f.id === filter)?.keeps ?? (() => true);
  const q = query.trim().toLowerCase();
  return items.filter(
    (s) => keeps(s) && (!q || [s.label, s.name].some((v) => v.toLowerCase().includes(q)))
  );
}
```

- [ ] **Step 6: Create the tab component**

Create `src/components/investments/securities-tab.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { triggerSync } from '@/lib/cloud-sync';
import { Pricing } from '@/lib/investments/codes';
import type { SecurityList, SecurityListItem } from '@/lib/investments/security-list';
import { PriceWindow } from './price-window';
import {
  SECURITY_FILTERS,
  filterSecurities,
  heldInText,
  latestView,
  priceSourceView,
  typeLabel,
  type SecurityFilter,
} from './securities-view';

const GRID =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px] items-center gap-3.5 md:grid-cols-[minmax(0,1.6fr)_90px_90px_minmax(0,1.5fr)_110px_36px]';
const WIDE = 'hidden md:block';
const ICON_BUTTON =
  'inline-flex h-[30px] w-[30px] items-center justify-center rounded-[7px] border border-transparent text-[var(--text-muted)] hover:border-[var(--border-hover)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]';
const HIGHLIGHT =
  'rounded-lg bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] ring-1 ring-inset ring-[var(--accent)]';
const MESSAGE = 'py-6 text-center text-sm text-[var(--text-secondary)]';

function PencilIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.4"
      viewBox="0 0 16 16"
      width="14"
    >
      <path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.4 12.7 2.5 13.5l.8-2.9z" />
      <path d="M10 3.5l2.5 2.5" />
    </svg>
  );
}

function SecurityRow({
  security: s,
  highlighted,
  rowRef,
  onEdit,
}: {
  security: SecurityListItem;
  highlighted: boolean;
  rowRef?: Ref<HTMLLIElement>;
  onEdit: () => void;
}) {
  const source = priceSourceView(s);
  const latest = latestView(s);
  const action = `Change how ${s.label} is priced`;
  return (
    <li
      ref={rowRef}
      aria-current={highlighted ? 'true' : undefined}
      aria-label={s.label}
      className={`${GRID} border-b border-[var(--border)] px-2 py-2.5 last:border-b-0 ${
        highlighted ? HIGHLIGHT : ''
      }`}
    >
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] text-[var(--text-primary)]">{s.label}</div>
        {s.name !== s.label && (
          <div className="truncate text-[11.5px] text-[var(--text-muted)]">{s.name}</div>
        )}
      </div>
      <span className={`${WIDE} text-xs text-[var(--text-secondary)]`}>{typeLabel(s.type)}</span>
      <span className={`${WIDE} text-xs text-[var(--text-secondary)]`}>
        {heldInText(s.heldIn)}
      </span>
      <div className="min-w-0 text-xs">
        <div
          className={`font-medium ${source.warn ? 'text-[var(--accent)]' : 'text-[var(--text-primary)]'}`}
        >
          {source.main}
        </div>
        {source.detail && (
          <div className="text-[11px] text-[var(--text-muted)]">{source.detail}</div>
        )}
      </div>
      <div className={`${WIDE} text-right font-mono text-xs text-[var(--text-primary)]`}>
        <div>{latest ? latest.price : '—'}</div>
        {latest?.date && (
          <div className="text-[10.5px] text-[var(--text-muted)]">{latest.date}</div>
        )}
      </div>
      <div className="text-right">
        {s.pricing !== Pricing.Fixed && (
          <button
            aria-label={action}
            className={ICON_BUTTON}
            title={action}
            type="button"
            onClick={onEdit}
          >
            <PencilIcon />
          </button>
        )}
      </div>
    </li>
  );
}

/** Settings → Securities: how every security is priced, and the price window to change it. */
export function SecuritiesTab({ focusId }: { focusId: string | null }) {
  const [list, setList] = useState<SecurityList | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<SecurityFilter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<SecurityListItem | null>(null);
  const [highlighted, setHighlighted] = useState(focusId);
  const focusRow = useRef<HTMLLIElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/investments/securities');
      if (!res.ok) throw new Error('securities failed');
      setList(await res.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A deep-linked row is brought into view once the list arrives.
  useEffect(() => {
    if (list) focusRow.current?.scrollIntoView?.({ block: 'center' });
  }, [list]);

  // The highlight lasts until the next click anywhere.
  useEffect(() => {
    if (!highlighted) return;
    const clear = () => setHighlighted(null);
    document.addEventListener('click', clear);
    return () => document.removeEventListener('click', clear);
  }, [highlighted]);

  const saved = async () => {
    setEditing(null);
    triggerSync();
    await load();
  };

  if (!list) {
    return (
      <Card className="p-6 text-sm text-[var(--text-secondary)]">
        {failed ? (
          <>
            Couldn’t load securities.{' '}
            <button
              className="font-medium text-[var(--accent)]"
              type="button"
              onClick={() => void load()}
            >
              Try again
            </button>
          </>
        ) : (
          'Loading securities…'
        )}
      </Card>
    );
  }

  const all = list.securities;
  const rows = filterSecurities(all, filter, query);
  return (
    <div className="space-y-4">
      {all.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
            {SECURITY_FILTERS.map((f) => (
              <button
                key={f.id}
                aria-pressed={f.id === filter}
                className={`rounded-md px-2.5 py-[3px] text-[11.5px] font-medium ${
                  f.id === filter
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)]'
                }`}
                type="button"
                onClick={() => setFilter(f.id)}
              >
                {`${f.label} · ${all.filter(f.keeps).length}`}
              </button>
            ))}
          </div>
          <Input
            aria-label="Search securities"
            className="h-9 max-w-[260px]"
            placeholder="Search ticker or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}
      <Card className="px-5 py-3.5">
        {all.length === 0 ? (
          <p className={MESSAGE}>
            No securities yet. They appear once an investment account has holdings or trades.
          </p>
        ) : (
          <>
            <div
              className={`${GRID} border-b border-[var(--border)] px-2 pb-2 text-[10.5px] font-medium uppercase tracking-[0.6px] text-[var(--text-muted)]`}
            >
              <span>Security</span>
              <span className={WIDE}>Type</span>
              <span className={WIDE}>Held in</span>
              <span>Price source</span>
              <span className={`${WIDE} text-right`}>Latest price</span>
              <span />
            </div>
            {rows.length === 0 ? (
              <p className={MESSAGE}>No securities match.</p>
            ) : (
              <ul aria-label="Securities">
                {rows.map((s) => (
                  <SecurityRow
                    key={s.id}
                    highlighted={s.id === highlighted}
                    rowRef={s.id === highlighted ? focusRow : undefined}
                    security={s}
                    onEdit={() => setEditing(s)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
      {editing && (
        <PriceWindow
          key={editing.id}
          hint={list.symbolHint}
          security={editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 7: Wire the tab into Settings**

In `src/app/(routes)/settings/page.tsx`:
- after line 42 (`import { RulesTab } …`), add `import { SecuritiesTab } from '@/components/investments/securities-tab';`;
- in the tab bar (line 1911), change the array to
  `['general', 'accounts', 'securities', 'categories', 'rules', 'budgets', 'import', 'tags', 'sync']`.
  The existing label code turns `securities` into "Securities", so no label change is needed;
- immediately before `{tab === 'categories' && (` (line 2412), add:

```tsx
      {tab === 'securities' && <SecuritiesTab focusId={searchParams.get('security')} />}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components tests/unit/lint/vendor-literals.test.ts`
Expected: PASS.

Then run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
npm run lint:fix
git add src/components/investments/securities-view.ts src/components/investments/securities-tab.tsx "src/app/(routes)/settings/page.tsx" tests/unit/components/investments/securities-view.test.ts tests/unit/components/investments/securities-tab.test.tsx tests/unit/components/settings-securities.test.tsx
git commit -m "feat(settings): Securities tab lists how every security is priced

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Check the tab on real data (user-gated)

This task runs only after the controller stops and the user agrees. The executor never reads `.env` and never prints database values.

- [ ] **Step 1:** Run the full suite: `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration`. Everything must pass, with lint showing 0 errors.
- [ ] **Step 2:** Ask the user to restart their dev server and open `/settings?tab=securities`, then check:
  - **Tab bar:** "Securities" sits between Accounts and Categories.
  - **Rows:**
    - Every held or traded security appears, including those of closed accounts, with one row per cash currency.
    - Manual accounts' balances do not appear.
    - Rows are sorted by ticker.
  - **Columns:** Type, Held in, Price source with its second line, and Latest price with its date. Each looks right against what the user knows.
  - **Pencil:** absent on cash. Its tooltip reads "Change how {ticker} is priced".
  - **Toolbar:** "All · N" / "Needs attention · N" filter and count correctly, and search matches ticker or name.
  - **First real use:** on an institution-priced fund with no public ticker, open the window. It reads "How {label} is priced" and "Currently Institution · {price} on {date}". Follow a similar fund. The window closes, and the row then reads "Follows {symbol} on days without an institution price".
  - **Investments page:** on `/investments`, an account with an unpriced holding shows **Set up pricing**. It lands on the tab with that row highlighted and in view, and the highlight clears on the next click.

  Then ask them to say what looks wrong.
- [ ] **Step 3:** Fix anything they report through the normal task loop: implement, review, then re-check.

---

## Self-review

1. **Spec coverage:**
   - §3 tab, rows, columns, labels, latest price, toolbar, empty state and deep link: Tasks 1 and 3.
   - §4 window title, "Currently" line (source `name` + latest price, Ruling 17), unchanged sections, saving reloads and syncs, no pencil on Fixed: Tasks 2 and 3.
   - §5 notice link, window removed from the page, `onSetSymbol` and overview `symbolHint` removed: Task 2.
   - §6 API shape, `SecurityListReader` wired in `services.ts`, `getInvestmentServices`, reuse of strategies and the source filter, no schema change: Task 1.
   - §7 constraints: Global Constraints, plus Ruling 13 on the lint scope.
   - §8 tests: each item has a named test in Tasks 1–3.
2. **Placeholder scan:** every code step carries full code. The one conditional instruction (Task 3, Step 3) names exactly what to do.
3. **Type consistency:**
   - `SecurityListItem`, `SecurityList`, `LatestPrice`, `PriceSourceView`, `LatestView`, `SecurityFilter`, `securityList` (service key), `PriceWindow`, `makeSecurityItem` and `securitySettingsHref` are spelled the same wherever they appear.
   - The `PricingStrategy.latest` signature matches all six strategies and `PriceBook.latest`.
4. **Review Focus:** each of the five lines has a named test in its owning task.

---

# Addendum 2026-10-16: price window v2

Implements spec §9 (amendment). Mock: `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/price-window-v2.html` (read it for layout; its data is synthetic). Task 4 (real-data check) moves after Task 6.

### Task 5: Switching back to the institution's price; list fields and cash labels

**Files:**
- Modify: `src/lib/prices/securities.ts` (`SecurityCatalog.setProxy`)
- Modify: `src/lib/investments/refresh.ts` (doc comment of `setProxy` only, if wording changes)
- Modify: `src/lib/investments/security-list.ts` (`hasInstitutionPrice`, cash label)
- Modify: `src/app/api/investments/securities/[id]/route.ts` (error text only if needed; body schema unchanged)
- Modify: `tests/helpers/investment-overview.ts` (`makeSecurityItem` gains `hasInstitutionPrice: false`)
- Test: `tests/unit/lib/prices/securities.test.ts`, `tests/unit/lib/investments/security-list.test.ts`, `tests/integration/api/investment-securities-apis.test.ts`

**Interfaces:**
- Produces: `SecurityListItem.hasInstitutionPrice: boolean`; `PATCH { proxySymbol: string | null }` now also switches a security that has stored institution prices back to Institution pricing.

**Behaviour.** `SecurityCatalog.setProxy(id, symbol)`:
1. 404 when the security is missing (unchanged).
2. Allowed when `pricing === Pricing.Institution` **or** a `SecurityPrice` row with `source: PriceSource.Institution` exists for it. Otherwise throw `InvestmentInputError('Only a fund priced by its institution can follow another fund')` (unchanged text).
3. When `symbol != null`, resolve the proxy with `findOrCreateMarket` and keep the existing self-follow and not-market checks, **before** writing anything.
4. In one `$transaction`: update the security with `{ pricing: Pricing.Institution, priceSymbol: null, priceSymbolOverride: true, pricesFetchedFrom: null, proxySecurityId: proxy?.id ?? null }`; and, only when it was not already Institution, `deleteMany` its `SecurityPrice` and `SecurityEvent` rows with `source: PriceSource.Market` (as `setPriceSymbol` drops the old symbol's data). Return the updated security.
   - Keep it DRY: extract the two market `deleteMany` calls that `setPriceSymbol` already makes into one private helper (e.g. `dropMarketData(id)` returning the two Prisma promises) used by both.
   - Note `priceSymbolOverride: true` keeps aggregator sync from overwriting the choice (see `plaid-investment-sync.ts`).
5. `InvestmentRefreshService.setProxy` already prices the proxy and revalues holders; no change beyond its doc comment ("price by the institution, following ..."). Revalue holders must also run when the proxy is null (it already does).

`SecurityListReader.list()`:
- `hasInstitutionPrice`: true when the security has any `SecurityPrice` with `source: PriceSource.Institution`. One query for all listed ids (`securityPrice.findMany({ where: { securityId: { in }, source }, distinct: ['securityId'], select: { securityId: true } })`), not one per security.
- Cash label: `labelOf` returns `` `${s.currency} cash` `` for `SecurityType.Cash` (doc comment: aggregator cash carries an internal id as ticker and a long or oddly spaced name, so cash reads by its currency).

**Tests (TDD, write first):**
- securities.test.ts (`SecurityCatalog.setProxy`):
  - a Market security with a stored institution price and market closes/events: `setProxy(id, 'FOLW')` → pricing Institution, priceSymbol null, priceSymbolOverride true, proxy linked, its market prices and events gone, its institution prices kept.
  - same with `null` → Institution, no proxy.
  - a Market security with no institution price → rejects with the existing message, nothing changed.
  - an Institution security following a fund: `setProxy(id, null)` unlinks and keeps its other prices (no deletes happen for an already-Institution security).
  - an unknown proxy symbol on a Market security with institution prices → rejects and leaves pricing Market (nothing written).
- security-list.test.ts: `hasInstitutionPrice` true for a security with an institution price, false otherwise; a cash security named "U S Dollar" in USD lists with label `USD cash`. Update existing expectations that assumed the cash name as label.
- integration (`investment-securities-apis.test.ts`): `PATCH { proxySymbol: 'FOLW' }` on a Market security with a stored institution price returns 200 and the security is Institution following FOLW; GET list includes `hasInstitutionPrice`. Existing rejection cases still pass.

Commit: `feat(investments): switch a security back to its institution's price`.

### Task 6: Price window v2 and list labels

**Files:**
- Modify: `src/components/investments/price-window.tsx` (rewrite body)
- Modify: `src/components/investments/securities-view.ts` (Institution label)
- Test: `tests/unit/components/investments/editors.test.tsx` (`describe('PriceWindow')`), `tests/unit/components/investments/securities-view.test.ts`, `tests/unit/components/investments/securities-tab.test.tsx` (label expectations)

**Interfaces:**
- Consumes: `SecurityListItem.hasInstitutionPrice` (Task 5); PATCH bodies `{ priceSymbol }`, `{ manualPrice }`, `{ proxySymbol: string | null }`.

**securities-view.ts.** `[Pricing.Institution]` returns `source(label)` where `label = s.proxySymbol ? `Institution · follows ${s.proxySymbol}` : 'Institution'`, so `name` and `main` are both that label (the window's Currently line reads e.g. "Currently Institution · follows PRXY · $28.34 on Oct 10") and `detail` is null. Manual and Fixed are unchanged.

**price-window.tsx** (exact copy from spec §9):
- Keep the `Modal`, title `How {label} is priced`, and the Currently line as now.
- Then `<p>` "Price it with" (11px uppercase muted, tracking like the mock), then a `role="radiogroup"` with one card per option: Institution (only if `security.pricing === Pricing.Institution || security.hasInstitutionPrice`), Market, Manual — in that order. Each card is a `<label>` containing a visually hidden native `<input type="radio" name="price-source">` (accessible name = the title), a custom radio dot, title and description; selected card gets the accent border and `color-mix` tint from the mock. The selected card's fields render below its head, indented to the text.
  - Institution field: label "Follow a similar fund between institution prices" with a muted "· optional"; `Input` (mono, placeholder "Ticker", initial `security.proxySymbol ?? ''`); hint (existing text).
  - Market field: label "Symbol"; `Input` (mono, placeholder "e.g. VTI or XIU.TO", initial `security.pricing === Pricing.Market ? security.priceSymbol ?? '' : ''`); `hint` prop below when non-empty.
  - Manual field: label "Price per unit"; `Input` (mono, `inputMode="decimal"`, placeholder "0.00", initial the latest price as a plain number string when Manual, else '').
  - Labels tie to inputs with `htmlFor`/`id`.
- Initial selection: the option matching `security.pricing` (Institution/Market/Manual), else none.
- Footer row `flex justify-end gap-2 mt-5`: `Button variant="outline"` **Cancel** → `onClose`; `Button` **Save** → submit. Both `whitespace-nowrap`. Save disabled when `saving`, nothing selected, or nothing differs from the opening state (selection and the selected option's field compared trimmed against their initial values).
- Submit: Institution → `{ proxySymbol: proxy.trim() || null }` (the server uppercases). Market → empty → error "Enter a symbol", else `{ priceSymbol: symbol.trim() }`. Manual → not finite or ≤ 0 → "Enter a positive price", else `{ manualPrice }`. Errors and `onSaved` as now.
- Remove the old three-section layout, "Use symbol", "Set price", "Follow fund", "Stop following" and "Following X".

**Tests (rewrite `describe('PriceWindow')`, keep the Currently-line tests):**
- Market security: Market card checked (`getByRole('radio', { name: 'Market symbol' })`), Symbol prefilled `ZZZ`, Save disabled; typing `ZZZ.TO` enables Save; Save sends `{ priceSymbol: 'ZZZ.TO' }` and calls onSaved; the provider hint shows, no "Yahoo".
- Choosing Manual shows "Price per unit"; Save with empty → "Enter a positive price"; `50.73` → `{ manualPrice: 50.73 }`.
- Clearing the symbol and saving → "Enter a symbol".
- No Institution card for a Market security with `hasInstitutionPrice: false`.
- Market security with `hasInstitutionPrice: true` (the real-data case): Institution card offered; picking it enables Save; Save with blank fund → `{ proxySymbol: null }`; with `FOLW` → `{ proxySymbol: 'FOLW' }`.
- Institution security following PRXY: Institution checked, fund field `PRXY`, Save disabled; clearing it and saving → `{ proxySymbol: null }`.
- None security: no card checked, Save disabled.
- Cancel calls onClose and sends nothing.
- securities-view.test.ts: Institution with proxy → main and name `Institution · follows PRXY`, detail null; without → `Institution`, detail null.

Commit: `feat(investments): price window picks one source and saves once`.
