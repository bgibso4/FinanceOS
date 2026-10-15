# Investment History Backfill, Proxy Pricing & Chart Hover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plaid investment accounts show up to two years of estimated value history. A Plaid-priced fund can follow a public fund's daily moves. Pricing pills open the price window, and the value chart shows the value under the cursor.

**Architecture:**
- **Backfill** is worked out when the page loads, in the existing `ProviderValueDeriver`: it undoes trades backward from the first Plaid holdings snapshot.
- **Prices** come from a one-time backward Yahoo fetch in `PriceRefresher`, tracked by a new `Security.pricesFetchedFrom`.
- **Proxy pricing** is a new `PricingStrategy` (`ProxiedPlaidPricing`) fed by `PriceBook`, with the link stored in a new self-relation `Security.proxySecurityId`.
- **UI:** a new `PATCH` body, clickable pills, a new section in the price window, and hover plus a range-aligned x axis in `ValueChart`.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma + SQLite, Zod v4, Vitest + Testing Library (jsdom 27).

**Spec:** `docs/superpowers/specs/2026-10-12-investment-history-backfill-design.md`. The approved mock is at `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/history-hover.html`; its numbers are synthetic.

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
  - Pure helpers (`holdings-view.ts`, `src/components/investments/*.ts`) stay functions.
- **Schema:** only Task 1 changes it, adding `Security.pricesFetchedFrom` and `Security.proxySecurityId`. Use `npx prisma db push` then `npx prisma generate`, never `prisma migrate dev`. Never read `.env`.
- **Dates:** all UTC. Day values are `YYYY-MM-DD` strings in the API. Display dates are formatted with `timeZone: 'UTC'`.
- **Zod is v4:** `z.number()` already rejects `NaN`/`Infinity`.
- **No real network in tests:** unit and integration tests never reach Yahoo or Plaid. Use `fakeProvider` / `testServices` from `tests/helpers/investments.ts`. Component tests mock `global.fetch` (pattern in `tests/unit/components/investments/editors.test.tsx`).
- **UI conventions:**
  - Client components start with `'use client'`.
  - Colours only via CSS variables (`var(--accent)`, `var(--tag-blue)`, `var(--text-muted)`, `var(--bg-elevated)`, `var(--border)`, `var(--border-hover)` …). No new hex colours.
  - Numbers, tickers and dates use `font-mono`.
  - Reuse `Modal`, `Button`, `Input` from `src/components/ui/`.
  - Copy (labels, hints) is verbatim from this plan.
- **The GitHub repo is public:** no account names, masks, balances, holdings or other personal data in committed code, tests, fixtures or copy. Tests use synthetic data. Never take values from the local database or from mocks.
- **Lint:**
  - Only `console.warn` / `console.error`. Prefix unused vars with `_`.
  - Single quotes, semicolons, 100-char lines. JSX props sorted (`react/jsx-sort-props`).
  - Run `npm run lint:fix` before each commit.
- **Tests:** Vitest. DB tests use `setupTestDb` / `resetTestDb` / `teardownTestDb` from `tests/helpers/db.ts`. Run one file with `npx vitest run <path>`.
- **Git:**
  - Stage explicit paths only; never stage `.claude/` or `.superpowers/`.
  - `docs/` is gitignored. Add docs with `git add -f`, and lint-staged's "paths are ignored" message is harmless.
  - Commit messages end with the Co-Authored-By trailer from your system reminder.

## Review Focus

1. **A first Plaid snapshot with no stored balance on the same day.** Implicit cash counts as 0, and the backfill values positions only, with no crash. *Task 4 test: "values positions only when the first snapshot day has no stored balance."*
2. **A symbol fix after the backward fetch.** The old symbol's closes are deleted, so `pricesFetchedFrom` must reset. Otherwise the new symbol never gets its history. *Task 1 test: "setPriceSymbol clears pricesFetchedFrom."*
3. **A proxy whose closes start after the day asked about.** The fund falls back to Plaid pricing, which is null before its first Plaid price. The deriver then holds the first snapshot's price, so the line never stops just for that reason. *Task 2 test: "falls back to Plaid pricing before the proxy's first close."*
4. **A requested range that ends before the first snapshot.** A day's value must not depend on the range. In particular, implicit cash must come from the first snapshot day's balance even when that day is outside the range. *Task 4 test: "a backfilled day has the same value whatever the range."*
5. **Hovering in the empty part of a chart whose history starts mid-range.** No tooltip appears, and the gap shows "No history before …". *Task 8 test: "leaves the part of the range before the first point empty, without hover."*

---

## File Structure

| File | Responsibility | Tasks |
|---|---|---|
| `prisma/schema.prisma` | `Security.pricesFetchedFrom`, `Security.proxySecurityId` self-relation | 1 |
| `src/lib/cloud-sync/types.ts`, `src/lib/cloud-sync/sync.ts` | carry the two fields through sync | 1 |
| `src/lib/investments/plaid-mapping.ts` | shared `PLAID_TRADE_HISTORY_DAYS` | 1 |
| `src/lib/investments/plaid-investment-sync.ts` | use the shared constant | 1 |
| `src/lib/prices/securities.ts` | `setPriceSymbol` resets `pricesFetchedFrom`; new `setProxy` | 1, 5 |
| `src/lib/prices/pricing.ts` | `ProxiedPlaidPricing`; `pricingFor(security, proxyPoints?)` | 2 |
| `src/lib/prices/price-book.ts` | load proxy closes | 2 |
| `src/lib/prices/refresh.ts` | history start, backward fetch, price proxies | 3 |
| `src/lib/investments/history.ts` | backward derivation and stop rules | 4 |
| `src/lib/investments/refresh.ts` | `setProxy` under the lock; shared `revalueHolders` | 5 |
| `src/app/api/investments/securities/[id]/route.ts` | `{ proxySymbol }` body | 5 |
| `src/lib/investments/holdings-view.ts` | `PlaidQuote`, `PriceTarget`, `plaid` on rows and lines | 6 |
| `src/lib/investments/current-holdings.ts` | fill `plaid` | 6 |
| `src/lib/investments/overview.ts` | `from` on the overview | 6 |
| `src/components/investments/pills.tsx` | `PricePillButton` | 7 |
| `src/components/investments/holdings-table.tsx` | pricing pills open the price window | 7 |
| `src/components/investments/set-symbol-modal.tsx` | Plaid hint and "follow a similar fund" section | 7 |
| `src/components/investments/account-detail.tsx`, `src/app/(routes)/investments/page.tsx` | wiring | 7, 8 |
| `src/components/investments/chart-geometry.ts` | `lead`, `nearestIndex`, `tooltipSide` | 8 |
| `src/components/investments/format.ts` | `fmtLongDay` | 8 |
| `src/components/investments/value-chart.tsx` | hover, gap note, range axis, `SERIES_LABELS` | 8 |

---

### Task 1: Schema, sync and shared constant

**Files:**
- Modify: `prisma/schema.prisma` (model `Security`)
- Modify: `src/lib/cloud-sync/types.ts` (`SecurityExportSchema`)
- Modify: `src/lib/cloud-sync/sync.ts` (security export, around line 300; security import, around line 596)
- Modify: `src/lib/investments/plaid-mapping.ts`, `src/lib/investments/plaid-investment-sync.ts:35,152`
- Modify: `src/lib/prices/securities.ts` (`setPriceSymbol`)
- Test: `tests/integration/api/cloud-sync-investments.test.ts`, `tests/unit/lib/prices/securities.test.ts`

**Interfaces:**
- Produces:
  - `Security.pricesFetchedFrom: Date | null`
  - `Security.proxySecurityId: string | null`
  - Prisma relations `proxy` / `proxyFor` (relation name `"SecurityProxy"`)
  - `export const PLAID_TRADE_HISTORY_DAYS = 730` from `src/lib/investments/plaid-mapping.ts`

- [ ] **Step 1: Write the failing tests**

In `tests/integration/api/cloud-sync-investments.test.ts`, extend `'round-trips investment tables and balanceSource'`. After the existing `const s = await prisma.security.create(...)`, add a proxy-following fund:

```ts
    const fund = await prisma.security.create({
      data: {
        name: 'Plan Fund',
        type: 'mutual_fund',
        pricing: 'plaid',
        proxySecurityId: s.id,
        pricesFetchedFrom: new Date('2024-10-01T00:00:00.000Z'),
      },
    });
```

Then change `expect(await prisma.security.count()).toBe(1);` to:

```ts
    expect(await prisma.security.count()).toBe(2);
    expect(await prisma.security.findUniqueOrThrow({ where: { id: fund.id } })).toMatchObject({
      proxySecurityId: s.id,
      pricesFetchedFrom: new Date('2024-10-01T00:00:00.000Z'),
    });
```

Add a new test after it:

```ts
  it('imports securities exported before proxies and fetch tracking existed', async () => {
    await prisma.security.create({
      data: { name: 'ETF', ticker: 'TETF', type: 'etf', pricing: 'feed', priceSymbol: 'TETF' },
    });
    const payload = await exportDatabase();
    const old = structuredClone(payload) as unknown as {
      data: Record<string, unknown> & { securities: Record<string, unknown>[] };
      metadata: { checksum: string };
    };
    for (const s of old.data.securities) {
      delete s.proxySecurityId;
      delete s.pricesFetchedFrom;
    }
    old.metadata.checksum = await generateChecksum(old.data as never);
    await resetTestDb();
    await importDatabase(old as unknown as SyncPayload);
    expect(await prisma.security.findFirstOrThrow()).toMatchObject({
      proxySecurityId: null,
      pricesFetchedFrom: null,
    });
  });
```

In `tests/unit/lib/prices/securities.test.ts`, add a test inside the existing top-level `describe`. Reuse that file's existing catalog construction, which builds a `SecurityCatalog` over the test client with `fakeProvider`. If the file builds it with a helper, use the helper:

```ts
  it('setPriceSymbol clears pricesFetchedFrom so the new symbol gets its full history', async () => {
    const s = await seedSecurity(prisma, { priceSymbol: 'OLD' });
    await prisma.security.update({
      where: { id: s.id },
      data: { pricesFetchedFrom: day('2024-10-01') },
    });
    const { services } = testServices(prisma, { closes: { NEW: { '2026-10-09': 2 } } });
    const updated = await services.catalog.setPriceSymbol(s.id, 'NEW');
    expect(updated.pricesFetchedFrom).toBeNull();
  });
```

Import `day`, `seedSecurity` and `testServices` from `'../../../helpers/investments'` if they're missing.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/integration/api/cloud-sync-investments.test.ts tests/unit/lib/prices/securities.test.ts`
Expected: FAIL. TypeScript/Prisma reject the unknown fields `proxySecurityId` and `pricesFetchedFrom`.

- [ ] **Step 3: Change the schema**

In `prisma/schema.prisma`, model `Security`, add after `fixedPrice Float?`:

```prisma
  pricesFetchedFrom   DateTime? // earliest day already requested from the price provider
  proxySecurityId     String? // feed security whose daily moves fill this one's days without a Plaid price
  proxy               Security?               @relation("SecurityProxy", fields: [proxySecurityId], references: [id], onDelete: SetNull)
  proxyFor            Security[]              @relation("SecurityProxy")
```

Run: `npx prisma db push && npx prisma generate`
Expected: "Your database is now in sync with your Prisma schema" and the client generated.

- [ ] **Step 4: Carry the fields through cloud sync**

In `src/lib/cloud-sync/types.ts`, in `SecurityExportSchema` after `fixedPrice: z.number().nullable(),`:

```ts
  // Optional: payloads from before proxies and fetch tracking omit them.
  pricesFetchedFrom: z.string().nullable().optional(),
  proxySecurityId: z.string().nullable().optional(),
```

In `src/lib/cloud-sync/sync.ts`, in the `securities: securities.map((r) => ({ ... }))` export, after `fixedPrice: r.fixedPrice,`:

```ts
      pricesFetchedFrom: r.pricesFetchedFrom?.toISOString() ?? null,
      proxySecurityId: r.proxySecurityId,
```

Replace the security import loop:

```ts
    for (const r of data.securities ?? []) {
      await tx.security.create({
        data: { ...r, createdAt: new Date(r.createdAt), updatedAt: new Date(r.updatedAt) },
      });
    }
```

with:

```ts
    for (const r of data.securities ?? []) {
      const { pricesFetchedFrom, proxySecurityId: _proxy, ...rest } = r;
      await tx.security.create({
        data: {
          ...rest,
          pricesFetchedFrom: pricesFetchedFrom ? new Date(pricesFetchedFrom) : null,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        },
      });
    }
    // A proxy is another security, so link proxies once every security exists.
    for (const r of data.securities ?? []) {
      if (!r.proxySecurityId) continue;
      await tx.security.update({
        where: { id: r.id },
        data: { proxySecurityId: r.proxySecurityId, updatedAt: new Date(r.updatedAt) },
      });
    }
```

- [ ] **Step 5: Share the Plaid trade-history constant**

In `src/lib/investments/plaid-mapping.ts`, add near the top, after the imports:

```ts
/** How far back Plaid returns investment transactions (24 months). */
export const PLAID_TRADE_HISTORY_DAYS = 730;
```

In `src/lib/investments/plaid-investment-sync.ts`:
- delete line 35 (`const FIRST_SYNC_DAYS = 730; ...`);
- import `PLAID_TRADE_HISTORY_DAYS` from `./plaid-mapping`, extending the existing import from that module if there is one;
- change line 152 to `return latest ? addDays(latest.date, -OVERLAP_DAYS) : addDays(today, -PLAID_TRADE_HISTORY_DAYS);`.

- [ ] **Step 6: Reset fetch tracking on a symbol fix**

In `src/lib/prices/securities.ts`, `setPriceSymbol`, change the update data to:

```ts
        data: { priceSymbol, priceSymbolOverride: true, pricing: 'feed', pricesFetchedFrom: null },
```

and add to its doc comment: `The new symbol's history is fetched from scratch, so fetch tracking resets too.`

- [ ] **Step 7: Run the tests and typecheck**

Run: `npx vitest run tests/integration/api/cloud-sync-investments.test.ts tests/unit/lib/prices/securities.test.ts tests/unit/lib/investments/plaid-investment-sync.test.ts && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add prisma/schema.prisma src/lib/cloud-sync/types.ts src/lib/cloud-sync/sync.ts src/lib/investments/plaid-mapping.ts src/lib/investments/plaid-investment-sync.ts src/lib/prices/securities.ts tests/integration/api/cloud-sync-investments.test.ts tests/unit/lib/prices/securities.test.ts
git commit -m "feat(investments): track price fetch depth and proxy funds on securities"
```

---

### Task 2: Proxy pricing strategy

**Files:**
- Modify: `src/lib/prices/pricing.ts`
- Modify: `src/lib/prices/price-book.ts`
- Test: `tests/unit/lib/prices/pricing.test.ts`, `tests/unit/lib/prices/price-book.test.ts`

**Interfaces:**
- Consumes: `Security.proxySecurityId` (Task 1).
- Produces:
  - `export class ProxiedPlaidPricing implements PricingStrategy` with `constructor(proxyPoints: PricePoint[])`
  - `pricingFor(security: { pricing: string; fixedPrice: number | null }, proxyPoints?: PricePoint[]): PricingStrategy`
  - `PriceBook.load` prices proxied securities through their proxy, with an unchanged signature.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lib/prices/pricing.test.ts`, inside `describe('pricing strategies', ...)`:

```ts
  describe('plaid pricing with a proxy', () => {
    const proxy = [
      p('2026-09-01', 50, 'yahoo'),
      p('2026-10-01', 100, 'yahoo'),
      p('2026-10-05', 110, 'yahoo'),
    ];
    const proxied = pricingFor({ pricing: 'plaid', fixedPrice: null }, proxy);
    const pts = [p('2026-10-01', 20, 'plaid'), p('2026-10-11', 25, 'plaid')];

    it('uses a Plaid price on its own day', () => {
      expect(proxied.priceOn(pts, day('2026-10-11'))).toEqual({ price: 25, estimated: false });
    });

    it('moves the latest earlier Plaid price by the proxy since then', () => {
      // 20 × 110 / 100
      expect(proxied.priceOn(pts, day('2026-10-06'))).toEqual({ price: 22, estimated: true });
    });

    it('moves the first Plaid price back by the proxy before it', () => {
      // 20 × 50 / 100 (the proxy's Sep 1 close carried to Sep 15)
      expect(proxied.priceOn(pts, day('2026-09-15'))).toEqual({ price: 10, estimated: true });
    });

    it("falls back to Plaid pricing before the proxy's first close", () => {
      expect(proxied.priceOn(pts, day('2026-08-01'))).toBeNull();
    });

    it('falls back to Plaid interpolation when the proxy has no closes', () => {
      const bare = pricingFor({ pricing: 'plaid', fixedPrice: null }, []);
      expect(bare.priceOn(pts, day('2026-10-06'))).toEqual({ price: 22.5, estimated: true });
    });

    it('ignores a proxy on any other pricing mode', () => {
      const feedWithProxy = pricingFor({ pricing: 'feed', fixedPrice: null }, proxy);
      const closes = [p('2026-10-02', 10, 'yahoo')];
      expect(feedWithProxy.priceOn(closes, day('2026-10-04'))).toEqual({
        price: 10,
        estimated: false,
      });
    });
  });
```

Append to `tests/unit/lib/prices/price-book.test.ts`, inside its top-level `describe`, using that file's test client variable and existing helper imports. Add `seedPrice` / `seedSecurity` / `day` from `'../../../helpers/investments'` if missing:

```ts
  it("prices a Plaid-priced security through its proxy's closes", async () => {
    const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
    await prisma.security.update({ where: { id: fund.id }, data: { proxySecurityId: proxy.id } });
    await seedPrice(prisma, fund.id, '2026-10-01', 20, 'plaid');
    await seedPrice(prisma, proxy.id, '2026-09-01', 50);
    await seedPrice(prisma, proxy.id, '2026-10-01', 100);
    const book = await PriceBook.load(prisma, [fund.id], day('2026-10-09'));
    expect(book.at(fund.id, day('2026-09-15'))).toEqual({ price: 10, estimated: true });
    expect(book.at(proxy.id, day('2026-09-15'))).toBeNull(); // only requested securities answer
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/price-book.test.ts`
Expected: FAIL. The proxied cases return Plaid interpolation (`null` for Sep 15) instead of the proxy-moved prices.

- [ ] **Step 3: Implement `ProxiedPlaidPricing` and the `pricingFor` hook**

In `src/lib/prices/pricing.ts`, add after `class PlaidPricing`:

```ts
/**
 * Plaid prices, with every other day moved by a proxy fund's closes (spec §6.2): the latest
 * Plaid price on or before the day (else the first one after) × proxy(day) / proxy(that price's
 * day). Without proxy closes for both days, plain Plaid pricing.
 */
export class ProxiedPlaidPricing implements PricingStrategy {
  private readonly fallback = new PlaidPricing();

  constructor(private readonly proxyPoints: PricePoint[]) {}

  priceOn(points: PricePoint[], date: Date): PricedAt | null {
    const t = date.getTime();
    const plaid = fromSource(points, 'plaid');
    const anchor = plaid.filter((p) => p.date.getTime() <= t).at(-1) ?? plaid[0];
    if (anchor?.date.getTime() === t) return { price: anchor.close, estimated: false };
    const proxy = fromSource(this.proxyPoints, 'yahoo');
    const now = carryForward(proxy, t, true);
    const then = anchor ? carryForward(proxy, anchor.date.getTime(), true) : null;
    if (anchor && now && then) {
      return { price: (anchor.close * now.price) / then.price, estimated: true };
    }
    return this.fallback.priceOn(points, date);
  }
}
```

Replace `pricingFor` with:

```ts
/**
 * The one place a `Security.pricing` value becomes behaviour. Unknown values price as unpriced.
 * `proxyPoints` (the proxy's stored prices) apply only to Plaid pricing.
 */
export function pricingFor(
  security: { pricing: string; fixedPrice: number | null },
  proxyPoints?: PricePoint[]
): PricingStrategy {
  if (security.pricing === 'plaid' && proxyPoints) return new ProxiedPlaidPricing(proxyPoints);
  const create = STRATEGIES.get(security.pricing);
  return create ? create(security.fixedPrice) : new UnpricedPricing();
}
```

- [ ] **Step 4: Load proxy closes in `PriceBook`**

In `src/lib/prices/price-book.ts`, replace `static async load(...)` with:

```ts
  static async load(prisma: PrismaClient, securityIds: string[], to: Date): Promise<PriceBook> {
    const ids = [...new Set(securityIds)];
    const securities = await prisma.security.findMany({
      where: { id: { in: ids } },
      select: { id: true, pricing: true, fixedPrice: true, proxySecurityId: true },
    });
    const proxyIds = securities.flatMap((s) => (s.proxySecurityId ? [s.proxySecurityId] : []));
    const rows = await prisma.securityPrice.findMany({
      where: { securityId: { in: [...ids, ...proxyIds] }, date: { lte: to } },
      orderBy: { date: 'asc' },
      select: { securityId: true, date: true, close: true, source: true },
    });
    const pointsOf = new Map<string, PricePoint[]>();
    for (const r of rows) {
      const list = pointsOf.get(r.securityId);
      if (list) list.push(r);
      else pointsOf.set(r.securityId, [r]);
    }
    const entries = new Map<string, Entry>(
      securities.map((s) => [
        s.id,
        {
          strategy: pricingFor(
            s,
            s.proxySecurityId ? (pointsOf.get(s.proxySecurityId) ?? []) : undefined
          ),
          points: pointsOf.get(s.id) ?? [],
        },
      ])
    );
    return new PriceBook(entries);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices/ && npm run typecheck`
Expected: all pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add src/lib/prices/pricing.ts src/lib/prices/price-book.ts tests/unit/lib/prices/pricing.test.ts tests/unit/lib/prices/price-book.test.ts
git commit -m "feat(prices): price Plaid-only funds through a proxy fund's daily moves"
```

---

### Task 3: Backward price fetch and proxy refresh

**Files:**
- Modify: `src/lib/prices/refresh.ts` (`refresh`, replace `firstNeededDay` with `historyStart`, add `earliestStoredClose` / `markFetchedFrom`)
- Test: `tests/unit/lib/prices/refresh.test.ts`

**Interfaces:**
- Consumes:
  - `Security.pricesFetchedFrom`, `Security.proxySecurityId`, relation `proxyFor` (Task 1)
  - `PLAID_TRADE_HISTORY_DAYS` (Task 1)
- Produces: `PriceRefresher.refresh()` now also:
  - prices proxies;
  - fetches each feed security back to its history start once.

  `PriceRefreshResult` is unchanged. `fetched` counts securities that stored closes in either direction. `upToDate` counts the rest that didn't fail.

**Two deliberate differences from spec §5:**
- **Backward fetch runs per security, right after its forward fetch,** instead of in a second pass after all forward fetches. That keeps one loop with the same pacing, retry and stop rules. The result is the same.
- **No revaluation after a backward fetch.** A valued account is valued only from its own first holdings day, and forward fetching already covers that day. So closes from before it never change a valued balance. Symbol fixes and proxy changes still revalue holders (Task 5).

- [ ] **Step 1: Pin existing tests to non-Plaid holdings**

Existing tests use `held()`, which seeds a Plaid snapshot. With this task, a Plaid snapshot widens the history window to two years and adds a backward call. In `tests/unit/lib/prices/refresh.test.ts`, change `held()` to seed a manual snapshot so those tests keep their meaning:

```ts
  await seedSnapshot(prisma, {
    accountId: account.id,
    securityId: security.id,
    date: '2026-10-01',
    quantity: 1,
    price: 100,
    source: 'manual',
  });
```

Run: `npx vitest run tests/unit/lib/prices/refresh.test.ts`
Expected: PASS (unchanged behaviour so far).

- [ ] **Step 2: Write the failing tests**

Add a helper after `held()`:

```ts
/** A feed security held in a Plaid account whose first Plaid holdings day is 2026-10-01. */
async function heldViaPlaid(symbol: string) {
  const account = await seedInvestmentAccount(prisma);
  const security = await seedSecurity(prisma, { priceSymbol: symbol });
  await seedSnapshot(prisma, {
    accountId: account.id,
    securityId: security.id,
    date: '2026-10-01',
    quantity: 1,
    price: 100,
  });
  return { account, security };
}
const fetchedFrom = async (id: string) =>
  (await prisma.security.findUniqueOrThrow({ where: { id } })).pricesFetchedFrom;
```

Add a `describe('history start and backward fetch', ...)` block inside `describe('PriceRefresher', ...)`:

```ts
  describe('history start and backward fetch', () => {
    // 2026-10-01 minus Plaid's 730-day trade history.
    const WINDOW_START = '2024-10-01';

    it('first prices a Plaid-held security from the start of the trade window', async () => {
      const { security } = await heldViaPlaid('AAA');
      const { provider, calls } = fakeProvider({
        closes: { AAA: { [WINDOW_START]: 50, '2026-10-09': 103 } },
      });
      const result = await refresher(provider).refresh();
      expect(calls).toEqual([{ symbol: 'AAA', from: WINDOW_START, to: '2026-10-09' }]);
      expect(result.fetched).toBe(1);
      expect(isoDay((await fetchedFrom(security.id))!)).toBe(WINDOW_START);
    });

    it('fetches back to the trade window once for a security priced before it existed', async () => {
      const { security } = await heldViaPlaid('AAA');
      for (const d of ['2026-10-01', '2026-10-09']) await seedPrice(prisma, security.id, d, 100);
      const { provider, calls } = fakeProvider({ closes: { AAA: { [WINDOW_START]: 50 } } });

      const first = await refresher(provider).refresh();
      expect(calls).toEqual([{ symbol: 'AAA', from: WINDOW_START, to: '2026-09-30' }]);
      expect(first).toMatchObject({ fetched: 1, upToDate: 0 });
      expect((await yahooRows(security.id))[0]).toEqual([WINDOW_START, 50]);

      const second = await refresher(provider).refresh();
      expect(calls).toHaveLength(1);
      expect(second).toMatchObject({ fetched: 0, upToDate: 1 });
    });

    it('marks the backward fetch done even when the provider has nothing that early', async () => {
      const { security } = await heldViaPlaid('AAA');
      for (const d of ['2026-10-01', '2026-10-09']) await seedPrice(prisma, security.id, d, 100);
      const { provider, calls } = fakeProvider({ closes: { AAA: {} } });
      await refresher(provider).refresh();
      await refresher(provider).refresh();
      expect(calls).toHaveLength(1);
      expect(isoDay((await fetchedFrom(security.id))!)).toBe(WINDOW_START);
    });

    it('retries a stopped backward fetch on the next run', async () => {
      const { security } = await heldViaPlaid('AAA');
      for (const d of ['2026-10-01', '2026-10-09']) await seedPrice(prisma, security.id, d, 100);
      const down = () => new PriceProviderError('network', 'offline');
      const { provider } = fakeProvider({ closes: { AAA: {} }, errors: { AAA: [down(), down()] } });
      const result = await expectWarning('stopping', () => refresher(provider).refresh());
      expect(result.stopped).toBe(true);
      expect(await fetchedFrom(security.id)).toBeNull();
    });

    it('prices a proxy back to the history start of the fund that follows it', async () => {
      const account = await seedInvestmentAccount(prisma);
      const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
      const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
      await prisma.security.update({
        where: { id: fund.id },
        data: { proxySecurityId: proxy.id },
      });
      await seedSnapshot(prisma, {
        accountId: account.id,
        securityId: fund.id,
        date: '2026-10-01',
        quantity: 1,
        price: 20,
      });
      const { provider, calls } = fakeProvider({ closes: { PRXY: { '2026-10-09': 100 } } });
      await refresher(provider).refresh();
      expect(calls).toEqual([{ symbol: 'PRXY', from: WINDOW_START, to: '2026-10-09' }]);
    });
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/prices/refresh.test.ts`
Expected: FAIL. First fetches start at `2026-10-01`, there's no backward call, the proxy isn't selected, and `pricesFetchedFrom` stays null.

- [ ] **Step 4: Implement**

In `src/lib/prices/refresh.ts`:

Add imports:

```ts
import type { Security } from '@prisma/client';
import { PLAID_TRADE_HISTORY_DAYS } from '@/lib/investments/plaid-mapping';
```

Replace the class doc comment's first sentence with: `Brings stored daily closes up to the last completed trading day, and once back to each security's history start (see historyStart), one provider call per range, sequentially.`

Replace the body of `refresh` from `const securities = await this.prisma.security.findMany({` to the end of the `for` loop with:

```ts
    const securities = await this.prisma.security.findMany({
      where: {
        pricing: 'feed',
        priceSymbol: { not: null },
        ...(opts.securityIds
          ? { id: { in: opts.securityIds } }
          : {
              OR: [
                { holdings: { some: {} } },
                { transactions: { some: {} } },
                { proxyFor: { some: {} } },
              ],
            }),
      },
      orderBy: { priceSymbol: 'asc' },
    });

    let calls = 0;
    /** One paced provider call over [from, to], stored; failures are recorded on `result`. */
    const fetchAndStore = async (
      security: Security,
      from: Date,
      to: Date
    ): Promise<'stored' | 'skipped' | 'stopped'> => {
      const symbol = security.priceSymbol!;
      if (calls++ > 0) await this.sleep(SYMBOL_GAP_MS);
      let history: DailyHistory;
      try {
        history = await this.fetchWithRetry(symbol, from, to);
      } catch (error) {
        if (error instanceof PriceProviderError && error.kind === 'unknown_symbol') {
          await this.prisma.security.update({
            where: { id: security.id },
            data: { pricing: 'none' },
          });
          result.unknownSymbols.push(symbol);
          return 'skipped';
        }
        if (error instanceof PriceProviderError && error.kind === 'bad_response') {
          console.warn(`[prices] skipping ${symbol}: ${error.message}`);
          result.failedSymbols.push(symbol);
          return 'skipped';
        }
        result.stopped = true;
        result.error = `${symbol}: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`[prices] stopping price refresh: ${result.error}`);
        return 'stopped';
      }
      await this.storeHistory(security.id, history);
      return 'stored';
    };

    for (const security of securities) {
      const target = lastCompletedTradingDay(now, marketOf(security.type));
      const start = await this.historyStart(security.id, today);
      const latest = await this.latestStoredClose(security.id);
      let stored = false;

      // Forward: the day after the latest close (or the history start) through the target.
      const from = latest ? addDays(latest, 1) : start;
      if (from <= target) {
        const outcome = await fetchAndStore(security, from, target);
        if (outcome === 'stopped') break;
        if (outcome === 'skipped') continue;
        stored = true;
        if (!latest) await this.markFetchedFrom(security.id, start);
      }

      // Backward, once: the days before the earliest stored close, back to the history start.
      if (latest && (!security.pricesFetchedFrom || security.pricesFetchedFrom > start)) {
        const earliest = await this.earliestStoredClose(security.id);
        if (earliest && start < earliest) {
          const outcome = await fetchAndStore(security, start, addDays(earliest, -1));
          if (outcome === 'stopped') break;
          if (outcome === 'skipped') continue;
          stored = true;
        }
        await this.markFetchedFrom(security.id, start);
      }

      if (stored) result.fetched++;
      else result.upToDate++;
    }
```

Add `earliestStoredClose` and `markFetchedFrom` next to `latestStoredClose`:

```ts
  private async earliestStoredClose(securityId: string): Promise<Date | null> {
    const row = await this.prisma.securityPrice.findFirst({
      where: { securityId, source: 'yahoo' },
      orderBy: { date: 'asc' },
      select: { date: true },
    });
    return row?.date ?? null;
  }

  private async markFetchedFrom(securityId: string, day: Date): Promise<void> {
    await this.prisma.security.update({
      where: { id: securityId },
      data: { pricesFetchedFrom: day },
    });
  }
```

Replace `firstNeededDay` (doc comment and method) with:

```ts
  /**
   * The first day a security needs closes for, over it and the securities following it as a proxy:
   * their earliest holding or trade, and for each Plaid account holding them, that account's first
   * Plaid holdings day minus Plaid's trade history (the backfill window). Else a short lookback.
   */
  private async historyStart(securityId: string, today: Date): Promise<Date> {
    const followers = await this.prisma.security.findMany({
      where: { proxySecurityId: securityId },
      select: { id: true },
    });
    const ids = [securityId, ...followers.map((f) => f.id)];
    const [snapshot, trade, plaidHolders] = await Promise.all([
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
        where: { securityId: { in: ids }, source: 'plaid' },
        distinct: ['accountId'],
        select: { accountId: true },
      }),
    ]);
    const firstPlaidDays = plaidHolders.length
      ? await this.prisma.holdingSnapshot.groupBy({
          by: ['accountId'],
          where: { accountId: { in: plaidHolders.map((h) => h.accountId) }, source: 'plaid' },
          _min: { date: true },
        })
      : [];
    const dates = [
      snapshot?.date,
      trade?.date,
      ...firstPlaidDays.map(
        (a) => a._min.date && addDays(a._min.date, -PLAID_TRADE_HISTORY_DAYS)
      ),
    ].filter((d): d is Date => d != null);
    if (!dates.length) return addDays(today, -FIRST_FETCH_LOOKBACK_DAYS);
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/prices/ tests/unit/lib/investments/refresh.test.ts tests/integration/api/investment-securities-apis.test.ts tests/integration/api/investments-refresh-history.test.ts && npm run typecheck`
Expected: all pass. If a pre-existing test elsewhere now sees an extra backward call because it seeds a Plaid snapshot, fix that test's setup, not the code. Seed `source: 'manual'`, or set `pricesFetchedFrom` to the window start. Don't change its expectation.

- [ ] **Step 6: Commit**

```bash
npm run lint:fix
git add src/lib/prices/refresh.ts tests/unit/lib/prices/refresh.test.ts
git commit -m "feat(prices): fetch closes back to the Plaid trade window once, and price proxies"
```

---

### Task 4: Backfill provider history before the first snapshot

**Files:**
- Modify: `src/lib/investments/history.ts` (`ProviderValueDeriver`)
- Test: `tests/unit/lib/investments/history.test.ts`

**Interfaces:**
- Consumes:
  - `PLAID_TRADE_HISTORY_DAYS` (Task 1)
  - `PriceBook` proxy pricing (Task 2)
- Produces: `ValueHistoryService.accountSeries` returns estimated points before a provider account's first Plaid snapshot, per spec §4. The signature is unchanged.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lib/investments/history.test.ts`, delete the test `'provider: does not derive before the first holdings snapshot'` and add these in its place:

```ts
  describe('provider backfill before the first snapshot', () => {
    it('undoes trades and cash back from the first snapshot; stored days still win', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedBalance(prisma, a.id, '2026-07-12', 900, 'manual');
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000); // no cash outside holdings
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-08-01',
        type: 'buy',
        quantity: 5,
        amount: 400,
      });
      await seedPrice(prisma, s.id, '2026-07-01', 60);
      await seedPrice(prisma, s.id, '2026-09-30', 98);
      expect(await series(a.id, '2026-09-30', '2026-09-30')).toEqual([
        { date: '2026-09-30', value: 980, isEstimated: true }, // 10 × 98
      ]);
      expect(await series(a.id, '2026-07-20', '2026-07-20')).toEqual([
        { date: '2026-07-20', value: 700, isEstimated: true }, // 5 × 60 + 400 cash before the buy
      ]);
      expect(await series(a.id, '2026-07-12', '2026-07-12')).toEqual([
        { date: '2026-07-12', value: 900, isEstimated: false },
      ]);
    });

    it('a backfilled day has the same value whatever the range', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1250); // 250 implicit cash
      await seedPrice(prisma, s.id, '2026-09-01', 90);
      const inside = (await series(a.id, '2026-09-10', '2026-10-01'))[0];
      const before = await series(a.id, '2026-09-10', '2026-09-10');
      expect(before).toEqual([inside]);
      expect(inside).toEqual({ date: '2026-09-10', value: 1150, isEstimated: true });
    });

    it('values positions only when the first snapshot day has no stored balance', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedPrice(prisma, s.id, '2026-09-01', 90);
      expect(await series(a.id, '2026-09-10', '2026-09-10')).toEqual([
        { date: '2026-09-10', value: 900, isEstimated: true },
      ]);
    });

    it('reaches back exactly Plaid’s 730-day trade window', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedPrice(prisma, s.id, '2024-09-01', 50);
      expect(await series(a.id, '2024-09-30', '2024-10-01')).toEqual([
        { date: '2024-10-01', value: 500, isEstimated: true },
      ]);
    });

    it('stops for good at a day the trades can’t explain', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedPrice(prisma, s.id, '2026-09-01', 100);
      // Buying 15 when only 10 are held later means shares arrived without a record.
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-09-15',
        type: 'buy',
        quantity: 15,
        amount: 1500,
      });
      // Before this sell the quantity is positive again, but the line must not resume.
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-09-10',
        type: 'sell',
        quantity: -10,
        amount: -1000,
      });
      expect((await series(a.id, '2026-09-08', '2026-09-16')).map((p) => p.date)).toEqual([
        '2026-09-15',
        '2026-09-16',
      ]);
    });

    it('stops where a position sold before the snapshot has no price', async () => {
      const a = await seedInvestmentAccount(prisma);
      const s = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      const gone = await seedSecurity(prisma, { priceSymbol: 'GONE' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: s.id,
        date: '2026-10-01',
        quantity: 10,
        price: 100,
      });
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedPrice(prisma, s.id, '2026-09-01', 100);
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: gone.id,
        date: '2026-09-20',
        type: 'sell',
        quantity: -2,
        amount: -50,
      });
      expect((await series(a.id, '2026-09-19', '2026-09-20')).map((p) => p.date)).toEqual([
        '2026-09-20',
      ]);
    });

    it('brings back sold positions, moves explicit cash, and prices plan funds', async () => {
      const a = await seedInvestmentAccount(prisma);
      const cash = await seedSecurity(prisma, {
        priceSymbol: null,
        type: 'cash',
        pricing: 'fixed',
        fixedPrice: 1,
      });
      const sold = await seedSecurity(prisma, { priceSymbol: 'BBB' });
      const plan = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
      const follower = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
      const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY' });
      await prisma.security.update({
        where: { id: follower.id },
        data: { proxySecurityId: proxy.id },
      });
      for (const [securityId, quantity, price] of [
        [cash.id, 600, 1],
        [plan.id, 10, 20],
        [follower.id, 10, 20],
      ] as const) {
        await seedSnapshot(prisma, { accountId: a.id, securityId, date: '2026-10-01', quantity, price });
      }
      await seedPrice(prisma, plan.id, '2026-10-01', 20, 'plaid');
      await seedPrice(prisma, follower.id, '2026-10-01', 20, 'plaid');
      await seedPrice(prisma, proxy.id, '2026-09-01', 50);
      await seedPrice(prisma, proxy.id, '2026-10-01', 100);
      await seedPrice(prisma, sold.id, '2026-09-01', 100);
      await seedBalance(prisma, a.id, '2026-10-01', 1000);
      await seedTrade(prisma, {
        accountId: a.id,
        securityId: sold.id,
        date: '2026-09-20',
        type: 'sell',
        quantity: -4,
        amount: -400,
      });
      // 4 BBB × 100 + 200 cash + 10 plan × 20 (first known price) + 10 follower × 10 (proxy moved)
      expect(await series(a.id, '2026-09-19', '2026-09-19')).toEqual([
        { date: '2026-09-19', value: 900, isEstimated: true },
      ]);
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/history.test.ts`
Expected: FAIL. Days before the first snapshot return the carried stored balance or nothing.

- [ ] **Step 3: Implement**

In `src/lib/investments/history.ts`:

Add the import:

```ts
import { PLAID_TRADE_HISTORY_DAYS } from './plaid-mapping';
```

Add next to `QUANTITY_TYPES`:

```ts
/** Quantities within this of zero count as zero (float noise from fractional shares). */
const QUANTITY_EPSILON = 1e-6;
```

Update the class doc comment to:

```ts
/**
 * Estimates a provider account's value on days without a stored balance, from its Plaid holdings
 * snapshots and the trades after them, and before the first snapshot by undoing trades back from
 * it (spec §4). `load` reads everything once; `valueOn` is pure.
 */
```

Give the constructor two more parameters after `storedByDay`, and compute the stop day in its body:

```ts
  /** Latest day before the first snapshot that can't be estimated; it and every earlier day get none. */
  private readonly stopDay: number;

  private constructor(
    private readonly snapshotDays: number[], // ascending
    private readonly setOn: Map<number, Position[]>,
    private readonly flows: Flow[], // non-cancelled, ascending
    private readonly traded: Set<string>,
    private readonly cashSecurityIds: Set<string>,
    private readonly book: PriceBook,
    private readonly toAccount: (amount: number, securityId: string) => number,
    private readonly storedByDay: Map<number, AccountBalance>,
    /** Stored balance on the first snapshot day, read regardless of the requested range. */
    private readonly firstDayBalance: number | null
  ) {
    this.stopDay = this.findStopDay();
  }
```

In `load`, before `return new ProviderValueDeriver(`, read the first day's balance:

```ts
    const firstDayRow = await prisma.accountBalance.findFirst({
      where: { accountId: account.id, date: snapshots[0].date },
      select: { balance: true },
    });
```

and pass `firstDayRow?.balance ?? null` as the last constructor argument (after `storedByDay`).

In `valueOn`, replace

```ts
    const prevDay = lastAtOrBefore(this.snapshotDays, t);
    if (prevDay === undefined) return null;
```

with

```ts
    if (t < this.snapshotDays[0]) return t > this.stopDay ? this.estimateBefore(d) : null;
    const prevDay = lastAtOrBefore(this.snapshotDays, t)!;
```

Add these private methods after `valueOn`:

```ts
  /** First snapshot minus Plaid's trade history, walking back until a day can't be estimated. */
  private findStopDay(): number {
    const first = new Date(this.snapshotDays[0]);
    const windowStart = addDays(first, -PLAID_TRADE_HISTORY_DAYS);
    for (let d = addDays(first, -1); d >= windowStart; d = addDays(d, -1)) {
      if (this.estimateBefore(d) == null) return d.getTime();
    }
    return addDays(windowStart, -1).getTime();
  }

  /**
   * Value on a day before the first snapshot: its quantities and cash with every later trade and
   * cash flow (up to the snapshot) undone. Null when a quantity goes negative (a missing record)
   * or a held security has no price at all.
   */
  private estimateBefore(d: Date): number | null {
    const t = d.getTime();
    const firstDay = this.snapshotDays[0];
    const firstSet = this.setOn.get(firstDay)!;
    const isCash = (securityId: string) => this.cashSecurityIds.has(securityId);
    const later = this.flows.filter((x) => x.date.getTime() > t && x.date.getTime() <= firstDay);
    const undoneCash = later.reduce((sum, x) => sum + x.amount, 0);

    const quantity = new Map(
      firstSet.filter((s) => !isCash(s.securityId)).map((s) => [s.securityId, s.quantity])
    );
    for (const x of later) {
      if (
        !x.securityId ||
        x.quantity == null ||
        !QUANTITY_TYPES.has(x.type) ||
        isCash(x.securityId)
      ) {
        continue;
      }
      quantity.set(x.securityId, (quantity.get(x.securityId) ?? 0) - x.quantity);
    }

    const firstPrice = new Map(firstSet.map((s) => [s.securityId, s.price]));
    let value = 0;
    for (const [securityId, q] of quantity) {
      if (q < -QUANTITY_EPSILON) return null;
      if (q <= QUANTITY_EPSILON) continue;
      const price = this.book.at(securityId, d)?.price ?? firstPrice.get(securityId);
      if (price == null) return null;
      value += this.toAccount(q * price, securityId);
    }
    const cashPosition = firstSet.find((s) => isCash(s.securityId));
    if (cashPosition) {
      const units = cashPosition.quantity + undoneCash;
      const price = this.book.at(cashPosition.securityId, d)?.price ?? cashPosition.price;
      if (units > 0) value += this.toAccount(units * price, cashPosition.securityId);
    } else {
      // Implicit cash: what the first day's balance held beyond its positions, flows undone.
      const held = firstSet.reduce((sum, s) => sum + this.toAccount(s.value, s.securityId), 0);
      value += (this.firstDayBalance == null ? 0 : this.firstDayBalance - held) + undoneCash;
    }
    return roundCents(value);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/ tests/integration/api/investments-overview.test.ts tests/integration/api/investments-refresh-history.test.ts && npm run typecheck`
Expected: all pass. If an existing overview test asserted a flat carried balance before a first snapshot, update its expected values to the backfilled ones. That old behaviour is what this task replaces. Don't loosen any other assertion.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/history.ts tests/unit/lib/investments/history.test.ts
git commit -m "feat(investments): backfill Plaid account history from trades before the first snapshot"
```

---

### Task 5: Follow a fund — service and API

**Files:**
- Modify: `src/lib/prices/securities.ts` (add `setProxy`)
- Modify: `src/lib/investments/refresh.ts` (add `setProxy`, extract `revalueHolders`)
- Modify: `src/app/api/investments/securities/[id]/route.ts`
- Test: `tests/unit/lib/investments/refresh.test.ts`, `tests/integration/api/investment-securities-apis.test.ts`

**Interfaces:**
- Consumes:
  - `Security.proxySecurityId` (Task 1)
  - `SecurityCatalog.findOrCreateFeed(symbol)`
  - the proxy refresh behaviour (Task 3)
- Produces:
  - `SecurityCatalog.setProxy(id: string, symbol: string | null): Promise<Security>`
  - `InvestmentRefreshService.setProxy(id: string, symbol: string | null): Promise<Security>`
  - `PATCH /api/investments/securities/:id` accepts `{ proxySymbol: string | null }` and returns `{ security }`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/lib/investments/refresh.test.ts`, inside `describe('InvestmentRefreshService', ...)`. Add `InvestmentInputError` from `@/lib/investments/account-guard` to the imports:

```ts
  describe('setProxy', () => {
    async function planFund() {
      const a = await seedInvestmentAccount(prisma);
      const fund = await seedSecurity(prisma, { priceSymbol: 'PLAN', pricing: 'plaid' });
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId: fund.id,
        date: '2026-10-01',
        quantity: 10,
        price: 20,
      });
      return fund;
    }

    it("links a Plaid-priced fund and prices the proxy back to the fund's history", async () => {
      const fund = await planFund();
      const { services, calls } = testServices(prisma, {
        closes: { FOLW: { '2024-10-01': 50, '2026-10-09': 60 } },
      });
      const updated = await services.refresh.setProxy(fund.id, 'folw');
      const proxy = await prisma.security.findFirstOrThrow({ where: { priceSymbol: 'FOLW' } });
      expect(updated.proxySecurityId).toBe(proxy.id);
      expect(calls).toEqual([{ symbol: 'FOLW', from: '2024-10-01', to: '2026-10-09' }]);
    });

    it("unlinks with null and keeps the proxy's prices", async () => {
      const fund = await planFund();
      const { services } = testServices(prisma, { closes: { FOLW: { '2026-10-09': 60 } } });
      await services.refresh.setProxy(fund.id, 'FOLW');
      const updated = await services.refresh.setProxy(fund.id, null);
      expect(updated.proxySecurityId).toBeNull();
      expect(await prisma.securityPrice.count({ where: { source: 'yahoo' } })).toBe(1);
    });

    it('keeps the link when pricing the proxy stops', async () => {
      const fund = await planFund();
      const down = () => new PriceProviderError('network', 'offline');
      const { services } = testServices(prisma, {
        closes: { FOLW: { '2026-10-09': 60 } },
        errors: { FOLW: [down(), down()] },
      });
      const updated = await expectWarning('stopping', () =>
        services.refresh.setProxy(fund.id, 'FOLW')
      );
      expect(updated.proxySecurityId).not.toBeNull();
    });

    it('rejects a fund not priced by Plaid, and a fund following itself', async () => {
      const feed = await seedSecurity(prisma, { priceSymbol: 'AAA' });
      const fund = await planFund();
      const { services } = testServices(prisma, {
        closes: { FOLW: { '2026-10-09': 60 }, PLAN: { '2026-10-09': 20 } },
      });
      await expect(services.refresh.setProxy(feed.id, 'FOLW')).rejects.toBeInstanceOf(
        InvestmentInputError
      );
      await expect(services.refresh.setProxy(fund.id, 'PLAN')).rejects.toBeInstanceOf(
        InvestmentInputError
      );
    });
  });
```

Import `expectWarning` from the helpers if it isn't already imported.

Append to `tests/integration/api/investment-securities-apis.test.ts`, inside its `describe`:

```ts
  it('PATCH proxySymbol links and unlinks a proxy fund', async () => {
    vi.mocked(getInvestmentServices).mockResolvedValue(
      testServices(testPrisma, { closes: { FOLW: { '2026-10-09': 60 } } }).services
    );
    const fund = await seedSecurity(testPrisma, { priceSymbol: null, pricing: 'plaid' });
    const linked = await patch(json('PATCH', { proxySymbol: 'FOLW' }), params(fund.id));
    expect(linked.status).toBe(200);
    expect((await linked.json()).security.proxySecurityId).toEqual(expect.any(String));
    const unlinked = await patch(json('PATCH', { proxySymbol: null }), params(fund.id));
    expect((await unlinked.json()).security.proxySecurityId).toBeNull();
  });

  it('PATCH proxySymbol rejects unknown symbols, non-Plaid funds and blanks', async () => {
    vi.mocked(getInvestmentServices).mockResolvedValue(
      testServices(testPrisma, { closes: { FOLW: { '2026-10-09': 60 } } }).services
    );
    const fund = await seedSecurity(testPrisma, { priceSymbol: null, pricing: 'plaid' });
    const feed = await seedSecurity(testPrisma, { priceSymbol: 'AAA' });
    expect((await patch(json('PATCH', { proxySymbol: 'NOPE' }), params(fund.id))).status).toBe(400);
    expect((await patch(json('PATCH', { proxySymbol: 'FOLW' }), params(feed.id))).status).toBe(400);
    expect((await patch(json('PATCH', { proxySymbol: '' }), params(fund.id))).status).toBe(400);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/refresh.test.ts tests/integration/api/investment-securities-apis.test.ts`
Expected: FAIL. `setProxy` is not a function, and the route returns 400 for `proxySymbol`.

- [ ] **Step 3: Implement `SecurityCatalog.setProxy`**

In `src/lib/prices/securities.ts`, add after `setManualPrice`:

```ts
  /**
   * Link a Plaid-priced security to the feed fund whose daily moves fill its days without a Plaid
   * price (validated and created like any feed symbol); null unlinks. Callers price the proxy and
   * revalue under the refresh lock (`InvestmentRefreshService.setProxy`).
   */
  async setProxy(id: string, symbol: string | null): Promise<Security> {
    const security = await this.prisma.security.findUnique({ where: { id } });
    if (!security) throw new InvestmentInputError('Security not found', 404);
    if (security.pricing !== 'plaid') {
      throw new InvestmentInputError('Only a fund priced by Plaid can follow another fund');
    }
    if (symbol == null) {
      return this.prisma.security.update({ where: { id }, data: { proxySecurityId: null } });
    }
    const { security: proxy } = await this.findOrCreateFeed(symbol);
    if (proxy.id === id) throw new InvestmentInputError('A fund can’t follow itself');
    if (proxy.pricing !== 'feed') {
      throw new InvestmentInputError(`${proxy.priceSymbol} has no price feed to follow`);
    }
    return this.prisma.security.update({ where: { id }, data: { proxySecurityId: proxy.id } });
  }
```

Make sure `InvestmentInputError` is imported in that file. It is already used by `requireSecurity`.

- [ ] **Step 4: Implement `InvestmentRefreshService.setProxy`**

In `src/lib/investments/refresh.ts`:
- change the catalog dependency type to `Pick<SecurityCatalog, 'setPriceSymbol' | 'setManualPrice' | 'setProxy'>`;
- replace the last three lines of `setPriceSymbol`'s callback (`const holders = …`, `if (holders) …`, `return security;`) with `await this.revalueHolders(id);` followed by `return security;`;
- add:

```ts
  /**
   * Make a Plaid-priced fund follow a public fund (null stops following), price that fund back to
   * the follower's history start, and revalue valued accounts that hold the follower. If pricing
   * stops, the link stays and the next refresh prices it.
   */
  setProxy(id: string, symbol: string | null): Promise<Security> {
    return withSyncLock(REFRESH_LOCK, async () => {
      const security = await this.catalog.setProxy(id, symbol);
      if (security.proxySecurityId) {
        const prices = await this.prices.refresh({ securityIds: [security.proxySecurityId] });
        if (prices.stopped) return security;
      }
      await this.revalueHolders(id);
      return security;
    });
  }

  /** Revalue every valued account that has held `securityId`, from the first day it did. */
  private async revalueHolders(securityId: string): Promise<void> {
    const holders = await this.valuation.holdersOf(securityId);
    if (holders) await this.valuation.writeBalances(holders);
  }
```

- [ ] **Step 5: Accept `proxySymbol` in the route**

Replace `src/app/api/investments/securities/[id]/route.ts`'s schema and dispatch:

```ts
const bodySchema = z.union([
  z.object({ priceSymbol: z.string().trim().min(1).max(20) }),
  z.object({ manualPrice: z.number().positive() }),
  z.object({ proxySymbol: z.string().trim().min(1).max(20).nullable() }),
]);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(
    request,
    bodySchema,
    'Provide priceSymbol, a positive manualPrice, or proxySymbol'
  );
  if ('response' in body) return body.response;
  try {
    const { refresh } = await getInvestmentServices();
    const data = body.data;
    const security =
      'priceSymbol' in data
        ? await refresh.setPriceSymbol(id, data.priceSymbol)
        : 'manualPrice' in data
          ? await refresh.setManualPrice(id, data.manualPrice)
          : await refresh.setProxy(id, data.proxySymbol);
    return NextResponse.json({ security });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to update security');
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/refresh.test.ts tests/integration/api/investment-securities-apis.test.ts tests/unit/lib/prices/securities.test.ts && npm run typecheck`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add src/lib/prices/securities.ts src/lib/investments/refresh.ts "src/app/api/investments/securities/[id]/route.ts" tests/unit/lib/investments/refresh.test.ts tests/integration/api/investment-securities-apis.test.ts
git commit -m "feat(investments): let a Plaid-priced fund follow a public fund"
```

---

### Task 6: Price targets in the read model

**Files:**
- Modify: `src/lib/investments/holdings-view.ts`
- Modify: `src/lib/investments/current-holdings.ts`
- Modify: `src/lib/investments/overview.ts`
- Modify: `tests/helpers/investment-overview.ts`
- Test: `tests/unit/lib/investments/current-holdings.test.ts`, `tests/unit/lib/investments/holdings-view.test.ts`, `tests/unit/lib/investments/overview.test.ts`

**Interfaces:**
- Consumes: `Security.proxy` relation (Task 1).
- Produces (in `holdings-view.ts`):
  - `export type PlaidQuote = { price: number; currency: string; date: string; proxy: { symbol: string; name: string } | null }`
  - `export type PriceTarget = { securityId: string; label: string; plaid: PlaidQuote | null }`
  - `HoldingRow.plaid: PlaidQuote | null` and `HoldingLine.plaid: PlaidQuote | null`
  - `InvestmentOverview.from: string` (`YYYY-MM-DD`, the range start)

- [ ] **Step 1: Write the failing tests**

In `tests/unit/lib/investments/current-holdings.test.ts`, add inside its `describe`, mirroring the existing test `'keeps Plaid’s reported price and computes gain from cost basis'` for how it builds the reader and options:

```ts
  it('gives a Plaid-priced fund its Plaid price and the fund it follows', async () => {
    const a = await seedInvestmentAccount(prisma);
    const proxy = await seedSecurity(prisma, { priceSymbol: 'PRXY', name: 'Proxy Fund' });
    const fund = await seedSecurity(prisma, { priceSymbol: null, pricing: 'plaid' });
    const etf = await seedSecurity(prisma, { priceSymbol: 'AAA' });
    await prisma.security.update({ where: { id: fund.id }, data: { proxySecurityId: proxy.id } });
    for (const securityId of [fund.id, etf.id]) {
      await seedSnapshot(prisma, {
        accountId: a.id,
        securityId,
        date: '2026-10-01',
        quantity: 2,
        price: 28.34,
      });
    }
    const rows = await read([a]);
    const byId = new Map(rows.map((r) => [r.securityId, r]));
    expect(byId.get(fund.id)!.plaid).toEqual({
      price: 28.34,
      currency: 'USD',
      date: '2026-10-01',
      proxy: { symbol: 'PRXY', name: 'Proxy Fund' },
    });
    expect(byId.get(etf.id)!.plaid).toBeNull();
  });
```

In `tests/unit/lib/investments/holdings-view.test.ts`, add:

```ts
  it('carries the first member’s Plaid quote onto the line, never onto cash', () => {
    const quote = { price: 20, currency: 'USD', date: '2026-10-01', proxy: null };
    const lines = holdingLines([
      row({ securityId: 'f', label: 'FUND', plaid: quote, valueBase: 200 }),
      row({ securityId: 'cash', kind: 'cash', type: 'cash', label: 'Cash', valueBase: 50 }),
    ]);
    expect(lines.find((l) => l.key === 'f')!.plaid).toEqual(quote);
    expect(lines.find((l) => l.key === 'cash')!.plaid).toBeNull();
  });
```

(`row` is that file's existing row factory. Add `plaid: null` to its defaults.)

In `tests/unit/lib/investments/overview.test.ts` (whose `overview(range)` helper loads with the test clock at `2026-10-09`), add:

```ts
  it('reports the first day of the range', async () => {
    expect((await overview('1M')).from).toBe('2026-09-09');
    expect((await overview('YTD')).from).toBe('2026-01-01');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/lib/investments/current-holdings.test.ts tests/unit/lib/investments/holdings-view.test.ts tests/unit/lib/investments/overview.test.ts`
Expected: FAIL. `plaid` and `from` are undefined.

- [ ] **Step 3: Implement**

In `src/lib/investments/holdings-view.ts`, add above `HoldingRow`:

```ts
/** A Plaid-priced security's latest Plaid price and the public fund it follows, if any. */
export type PlaidQuote = {
  price: number;
  currency: string;
  date: string;
  proxy: { symbol: string; name: string } | null;
};

/** What the price window needs for one security; `plaid` only when Plaid prices it. */
export type PriceTarget = { securityId: string; label: string; plaid: PlaidQuote | null };
```

Add `plaid: PlaidQuote | null;` as the last field of `HoldingRow` and of `HoldingLine`. In `holdingLines`, add to the line object after `unpriced: ...`:

```ts
      plaid: isCash ? null : first.plaid,
```

In `src/lib/investments/current-holdings.ts`:
- change the snapshot query's `include: { security: true }` to `include: { security: { include: { proxy: { select: { priceSymbol: true, name: true } } } } }`;
- import `isoDay` from `./dates` and `PlaidQuote` from `./holdings-view`;
- add to the returned row object after `rangeChangePct: …`:

```ts
        plaid: plaidQuote(s.security, kind, price, isoDay(s.date)),
```

- add this module function after `labelOf`:

```ts
function plaidQuote(
  security: Security & { proxy: { priceSymbol: string | null; name: string } | null },
  kind: HoldingKind,
  price: number,
  date: string
): PlaidQuote | null {
  if (kind !== 'security' || security.pricing !== 'plaid') return null;
  const proxy = security.proxy;
  return {
    price,
    currency: security.currency,
    date,
    proxy: proxy ? { symbol: proxy.priceSymbol ?? proxy.name, name: proxy.name } : null,
  };
}
```

In `src/lib/investments/overview.ts`:
- add `from: string;` to `InvestmentOverview`, after `today: string;`, with the doc comment `/** First day of the range (YYYY-MM-DD). */`;
- in `load`'s returned object, add `from: isoDay(from),` after `today`.

In `tests/helpers/investment-overview.ts`:
- add `plaid: null,` to `makeHolding`'s defaults, after `rangeChangePct`;
- add `from: '2026-07-09',` to `makeOverview`'s defaults, after `today`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/lib/investments/ tests/unit/components/investments/ tests/integration/api/investments-overview.test.ts && npm run typecheck`
Expected: all pass. Existing `toEqual` assertions on whole rows or lines need `plaid: null` added; that's the only change allowed to them.

- [ ] **Step 5: Commit**

```bash
npm run lint:fix
git add src/lib/investments/holdings-view.ts src/lib/investments/current-holdings.ts src/lib/investments/overview.ts tests/helpers/investment-overview.ts tests/unit/lib/investments/current-holdings.test.ts tests/unit/lib/investments/holdings-view.test.ts tests/unit/lib/investments/overview.test.ts
git commit -m "feat(investments): expose Plaid quotes and the range start to the page"
```

(Add any other test file you had to touch for `plaid: null` to the `git add`.)

---

### Task 7: Pricing pills open the price window

**Files:**
- Modify: `src/components/investments/pills.tsx`
- Modify: `src/components/investments/holdings-table.tsx`
- Modify: `src/components/investments/set-symbol-modal.tsx`
- Modify: `src/components/investments/account-detail.tsx`
- Modify: `src/app/(routes)/investments/page.tsx`
- Test: `tests/unit/components/investments/display.test.tsx`, `tests/unit/components/investments/editors.test.tsx`, `tests/unit/components/investments/navigator-detail.test.tsx`

**Interfaces:**
- Consumes:
  - `PriceTarget`, `PlaidQuote`, `HoldingLine.plaid` (Task 6)
  - `PATCH { proxySymbol }` (Task 5)
- Produces:
  - `HoldingsTable` prop `onSetPrice: (target: PriceTarget) => void`
  - `SetSymbolModal` prop `security: PriceTarget`
  - `DetailProps.onSetSymbol: (target: PriceTarget) => void`

- [ ] **Step 1: Write the failing tests**

In `tests/unit/components/investments/display.test.tsx`:
- add `userEvent` (`import userEvent from '@testing-library/user-event';`) and `vi` to the imports;
- add `plaid: null` to the `line()` factory defaults;
- add `onSetPrice={vi.fn()}` to every existing `<HoldingsTable …>` render.

Then add inside `describe('HoldingsTable', …)`:

```tsx
  it('opens the price window from pricing pills, and only from them', async () => {
    const onSetPrice = vi.fn();
    const quote = { price: 28.34, currency: 'USD', date: '2026-10-01', proxy: null };
    render(
      <HoldingsTable
        currency="USD"
        lines={[
          line({ key: 'f', securityId: 'f', label: 'PLAN', plaid: quote }),
          line({ key: 'u', securityId: 'u', label: 'OLD', unpriced: true }),
          line({ key: 'a', securityId: 'a', label: 'AAA' }),
        ]}
        multiAccount={false}
        onSetPrice={onSetPrice}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Plaid price' }));
    expect(onSetPrice).toHaveBeenLastCalledWith({ securityId: 'f', label: 'PLAN', plaid: quote });
    await userEvent.click(screen.getByRole('button', { name: 'No price source' }));
    expect(onSetPrice).toHaveBeenLastCalledWith({ securityId: 'u', label: 'OLD', plaid: null });
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('names the fund a Plaid-priced holding follows', () => {
    const quote = {
      price: 28.34,
      currency: 'USD',
      date: '2026-10-01',
      proxy: { symbol: 'PRXY', name: 'Proxy Fund' },
    };
    render(
      <HoldingsTable
        currency="USD"
        lines={[line({ plaid: quote })]}
        multiAccount={false}
        onSetPrice={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Plaid price · follows PRXY' })).toBeInTheDocument();
  });
```

In `tests/unit/components/investments/editors.test.tsx`, change `describe('SetSymbolModal', …)`'s `const security = { securityId: 'sec-z', label: 'ZZZ' };` to `const security = { securityId: 'sec-z', label: 'ZZZ', plaid: null };` and add:

```tsx
  describe('for a fund priced by Plaid', () => {
    const quote = { price: 28.34, currency: 'USD', date: '2026-10-10', proxy: null };
    const fund = { securityId: 'sec-p', label: 'PLAN', plaid: quote };

    it('shows the Plaid price and follows a fund', async () => {
      replies['PATCH /api/investments/securities/sec-p'] = ok({ security: {} });
      const onSaved = vi.fn();
      render(<SetSymbolModal security={fund} onClose={vi.fn()} onSaved={onSaved} />);
      expect(screen.getByText(/Priced by Plaid/)).toHaveTextContent(
        'Priced by Plaid: $28.34 on Oct 10.'
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
        plaid: { ...quote, proxy: { symbol: 'PRXY', name: 'Proxy Fund' } },
      };
      render(<SetSymbolModal security={following} onClose={vi.fn()} onSaved={vi.fn()} />);
      expect(screen.getByText(/Following/)).toHaveTextContent('Following PRXY · Proxy Fund');
      await userEvent.click(screen.getByRole('button', { name: 'Stop following' }));
      await waitFor(() => expect(calls()[0]?.body).toEqual({ proxySymbol: null }));
    });
  });

  it('offers no fund to follow for a security Plaid does not price', () => {
    render(<SetSymbolModal security={security} onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.queryByText('No public ticker? Follow a similar fund')).not.toBeInTheDocument();
  });
```

In `tests/unit/components/investments/navigator-detail.test.tsx`, change line 219's expectation to `toHaveBeenCalledWith({ securityId: 'sec-z', label: 'ZZZ', plaid: null })`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/`
Expected: FAIL. The pills aren't buttons, the modal has no Plaid section, and the notice target lacks `plaid`.

- [ ] **Step 3: Add `PricePillButton`**

In `src/components/investments/pills.tsx`, replace `FlagPill` with:

```tsx
const PILL_TONES = {
  accent: 'border-[color-mix(in_srgb,var(--accent)_35%,transparent)] text-[var(--accent)]',
  blue: 'border-[color-mix(in_srgb,var(--tag-blue)_30%,transparent)] text-[var(--tag-blue)]',
};

export function FlagPill({ children }: { children: ReactNode }) {
  return <span className={`${PILL} ml-1.5 font-sans ${PILL_TONES.accent}`}>{children}</span>;
}

/** A pricing pill on a holdings row; opens the price window. */
export function PricePillButton({
  tone,
  onClick,
  children,
}: {
  tone: keyof typeof PILL_TONES;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`${PILL} ml-1.5 font-sans transition-[filter] hover:brightness-125 ${PILL_TONES[tone]}`}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Make the holdings table's pills open the window**

In `src/components/investments/holdings-table.tsx`:
- import `type PriceTarget` from `@/lib/investments/holdings-view`;
- replace the `FlagPill` import with `PricePillButton`;
- add the prop `onSetPrice: (target: PriceTarget) => void;` to the props type, documented as `/** Opens the price window for a holding's pricing pill. */`, and destructure it;
- replace `{l.unpriced && <FlagPill>No price source</FlagPill>}` with:

```tsx
              {l.securityId && l.unpriced && (
                <PricePillButton
                  tone="accent"
                  onClick={() =>
                    onSetPrice({ securityId: l.securityId!, label: l.label, plaid: null })
                  }
                >
                  No price source
                </PricePillButton>
              )}
              {l.securityId && !l.unpriced && l.plaid && (
                <PricePillButton
                  tone="blue"
                  onClick={() =>
                    onSetPrice({ securityId: l.securityId!, label: l.label, plaid: l.plaid })
                  }
                >
                  {l.plaid.proxy ? `Plaid price · follows ${l.plaid.proxy.symbol}` : 'Plaid price'}
                </PricePillButton>
              )}
```

- [ ] **Step 5: Add the Plaid section to the price window**

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
  onClose,
  onSaved,
}: {
  security: PriceTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [symbol, setSymbol] = useState('');
  const [price, setPrice] = useState('');
  const [proxy, setProxy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const plaid = security.plaid;

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
      {plaid && (
        <p className={`${HINT} mb-3`}>
          Priced by Plaid:{' '}
          <span className="font-mono text-[var(--text-secondary)]">
            {fmtMoney(plaid.price, { cents: true, currency: plaid.currency })}
          </span>{' '}
          on {fmtDay(plaid.date)}.
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
      <p className={HINT}>
        Use Yahoo Finance symbols: add .TO for Toronto listings, -USD for crypto.
      </p>
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
      {plaid && (
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          <p className={FIELD_LABEL}>No public ticker? Follow a similar fund</p>
          {plaid.proxy ? (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2.5 py-2 text-xs text-[var(--text-primary)]">
              <span>
                Following <span className="font-mono">{plaid.proxy.symbol}</span>{' '}
                <span className="text-[var(--text-muted)]">· {plaid.proxy.name}</span>
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
            Plaid’s price stays the real price. On days without one, this holding moves with the
            fund you pick, which fills in history before the first sync and any days the app
            didn’t sync.
          </p>
        </div>
      )}
      {error && <p className={ERROR}>{error}</p>}
    </Modal>
  );
}
```

- [ ] **Step 6: Wire the detail view and page**

In `src/components/investments/account-detail.tsx`:
- import `type PriceTarget` from `@/lib/investments/holdings-view`, extending the existing import;
- change `onSetSymbol: (security: { securityId: string; label: string }) => void;` to `onSetSymbol: (target: PriceTarget) => void;`;
- change the `unpriced` notice action's `onClick` to `() => p.onSetSymbol({ ...a.status.unpriced[0], plaid: null })`;
- add `onSetPrice={props.onSetSymbol}` to `<HoldingsTable …>`, keeping props sorted.

In `src/app/(routes)/investments/page.tsx`:
- import `type PriceTarget` from `@/lib/investments/holdings-view`;
- change the dialog union member to `| { kind: 'symbol'; security: PriceTarget };`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments/ && npm run typecheck`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
npm run lint:fix
git add src/components/investments/pills.tsx src/components/investments/holdings-table.tsx src/components/investments/set-symbol-modal.tsx src/components/investments/account-detail.tsx "src/app/(routes)/investments/page.tsx" tests/unit/components/investments/display.test.tsx tests/unit/components/investments/editors.test.tsx tests/unit/components/investments/navigator-detail.test.tsx
git commit -m "feat(investments): open the price window from pricing pills; follow a similar fund"
```

---

### Task 8: Chart hover and range-aligned axis

**Files:**
- Modify: `src/components/investments/chart-geometry.ts`
- Modify: `src/components/investments/format.ts`
- Modify: `src/components/investments/value-chart.tsx`
- Modify: `src/components/investments/account-detail.tsx` (`ChartLegend`, `<ValueChart>`)
- Test: `tests/unit/components/investments/chart-geometry.test.ts`, `tests/unit/components/investments/format.test.ts`, `tests/unit/components/investments/display.test.tsx`

**Interfaces:**
- Consumes: `InvestmentOverview.from` (Task 6).
- Produces:
  - `ChartBox.lead?: number`
  - `nearestIndex(fraction: number, count: number, lead?: number): number | null`
  - `tooltipSide(fraction: number, flipAt?: number): 'left' | 'right'`
  - `fmtLongDay(iso: string): string`
  - `SERIES_LABELS`
  - `ValueChart` props `{ points; manual?; from: string; currency: string }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/components/investments/chart-geometry.test.ts`. Extend the import from `@/components/investments/chart-geometry` with `nearestIndex, tooltipSide`:

```ts
describe('chartGeometry lead', () => {
  it('leaves the lead empty and closes the area under the first point', () => {
    const g = chartGeometry(
      [
        { value: 1, isEstimated: false },
        { value: 2, isEstimated: false },
      ],
      { width: 100, height: 50, pad: 0, lead: 2 }
    )!;
    expect(g.points.map((p) => p.x)).toEqual([66.67, 100]);
    expect(g.area.endsWith('L100,50L66.67,50Z')).toBe(true);
  });
});

describe('nearestIndex', () => {
  it('snaps to the nearest point and clamps to the ends', () => {
    expect(nearestIndex(0.5, 3)).toBe(1);
    expect(nearestIndex(0, 3)).toBe(0);
    expect(nearestIndex(1.4, 3)).toBe(2);
  });
  it('is null over the empty lead', () => {
    expect(nearestIndex(0.1, 3, 10)).toBeNull();
    expect(nearestIndex(0.9, 3, 10)).toBe(1);
  });
});

describe('tooltipSide', () => {
  it('flips left near the right edge', () => {
    expect(tooltipSide(0.5)).toBe('right');
    expect(tooltipSide(0.8)).toBe('left');
  });
});
```

Append to `tests/unit/components/investments/format.test.ts`, extending its import with `fmtLongDay`:

```ts
describe('fmtLongDay', () => {
  it('reads weekday, month, day and year in UTC', () => {
    expect(fmtLongDay('2026-10-02')).toBe('Fri, Oct 2, 2026');
  });
});
```

In `tests/unit/components/investments/display.test.tsx`:
- add `fireEvent` to the Testing Library import;
- add `currency="USD" from="2026-10-01"` to the existing three `<ValueChart …>` renders. Their dates start Oct 1, so their expectations are unchanged.

Then add:

```tsx
describe('ValueChart hover', () => {
  const pts = [point('2026-10-01', 100), point('2026-10-02', 120, true), point('2026-10-03', 150)];
  const plot = () => {
    const el = screen.getByTestId('chart-plot');
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 820,
      height: 170,
      right: 820,
      bottom: 170,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    return el;
  };

  it('shows the nearest day’s date, value and status, and hides on leave', () => {
    render(<ValueChart currency="USD" from="2026-10-01" points={pts} />);
    const el = plot();
    fireEvent.pointerMove(el, { clientX: 400 });
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Fri, Oct 2, 2026');
    expect(tip).toHaveTextContent('$120');
    expect(tip).toHaveTextContent('Estimated');
    fireEvent.pointerLeave(el);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('labels a manual account’s days Entered or Carried forward', () => {
    render(<ValueChart manual currency="USD" from="2026-10-01" points={pts} />);
    const el = plot();
    fireEvent.pointerMove(el, { clientX: 820 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Entered');
    fireEvent.pointerMove(el, { clientX: 410 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Carried forward');
  });

  it('leaves the part of the range before the first point empty, without hover', () => {
    render(<ValueChart currency="USD" from="2026-09-21" points={pts} />);
    expect(screen.getByText('No history before Oct 1')).toBeInTheDocument();
    expect(screen.getByText('Sep 21')).toBeInTheDocument();
    expect(screen.getByText('Sep 27')).toBeInTheDocument();
    fireEvent.pointerMove(plot(), { clientX: 100 });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/components/investments/`
Expected: FAIL. `nearestIndex`, `tooltipSide` and `fmtLongDay` are missing, and there's no plot test id or tooltip.

- [ ] **Step 3: Implement the geometry helpers**

In `src/components/investments/chart-geometry.ts`:

Change `ChartBox` to:

```ts
/** `lead`: days of the range before the first point, left empty at the chart's start. */
export type ChartBox = { width: number; height: number; pad: number; yMin?: number; lead?: number };
```

In `chartGeometry`, replace the `xy` mapping's `x:` line with:

```ts
    x: r((((box.lead ?? 0) + i) / ((box.lead ?? 0) + points.length - 1)) * box.width),
```

and the return with:

```ts
  return {
    solid,
    dashed,
    area: `${line}L${box.width},${box.height}L${xy[0].x},${box.height}Z`,
    points: xy,
  };
```

Append:

```ts
/** Index of the point nearest a pointer at `fraction` (0–1) of the width; null over the lead. */
export function nearestIndex(fraction: number, count: number, lead = 0): number | null {
  if (count < 1) return null;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const i = Math.round(clamped * (lead + count - 1)) - lead;
  return i < 0 ? null : Math.min(i, count - 1);
}

/** The tooltip sits right of the crosshair, or left once past `flipAt` of the width. */
export const tooltipSide = (fraction: number, flipAt = 0.72): 'left' | 'right' =>
  fraction > flipAt ? 'left' : 'right';
```

In `src/components/investments/format.ts`, add after `fmtDay`:

```ts
/** `Wed, Sep 16, 2026` for a `YYYY-MM-DD` day. */
export const fmtLongDay = (iso: string): string =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
```

- [ ] **Step 4: Add hover, the gap note and range labels to `ValueChart`**

In `src/components/investments/value-chart.tsx`:

Replace the imports with:

```tsx
'use client';

import { useState, type PointerEvent } from 'react';
import { addDays, isoDay, utcDay } from '@/lib/investments/dates';
import type { SeriesPoint } from '@/lib/investments/history';
import { chartGeometry, nearestIndex, tooltipSide } from './chart-geometry';
import { daysBetween, fmtDay, fmtLongDay, fmtMoney } from './format';
```

Add after `const HEIGHT = 170;`:

```tsx
/** A range whose history starts more than this many days late says so in the gap. */
const GAP_NOTE_DAYS = 3;

/** What a recorded or estimated point is called, for the legend and the hover tooltip. */
export const SERIES_LABELS = {
  manual: { exact: 'Entered', estimated: 'Carried forward' },
  synced: { exact: 'Synced', estimated: 'Estimated' },
};

const pointLabel = (p: SeriesPoint, manual: boolean) => {
  const labels = manual ? SERIES_LABELS.manual : SERIES_LABELS.synced;
  return p.isEstimated ? labels.estimated : labels.exact;
};
```

Replace the `ValueChart` function with:

```tsx
/**
 * Balance history over the range from `from`: solid where recorded, dashed where estimated, dots
 * on manual entries, and the day under the pointer in a tooltip. Values are in `currency`.
 */
export function ValueChart({
  points,
  manual = false,
  from,
  currency,
}: {
  points: SeriesPoint[];
  manual?: boolean;
  from: string;
  currency: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const last = points.at(-1)?.value ?? 0;
  const lead = points.length ? Math.max(0, daysBetween(from, points[0].date)) : 0;
  const geo = chartGeometry(points, {
    width: WIDTH,
    height: HEIGHT,
    pad: 8,
    yMin: manual ? last * 0.8 : undefined,
    lead,
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
  const span = lead + lastIndex;
  const labels = [from, isoDay(addDays(utcDay(from), Math.floor(span / 2))), points[lastIndex].date];
  const track = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    setHover(box.width ? nearestIndex((e.clientX - box.left) / box.width, points.length, lead) : null);
  };
  const hovered = hover == null ? null : { point: points[hover], at: geo.points[hover] };
  const hoverPct = hovered ? (hovered.at.x / WIDTH) * 100 : 0;
  return (
    <div className="mt-3">
      <div
        className="relative h-[170px] touch-pan-y"
        data-testid="chart-plot"
        onPointerDown={track}
        onPointerLeave={() => setHover(null)}
        onPointerMove={track}
      >
        {/* existing <svg>…</svg> block, unchanged */}
        {/* existing markers.map(…) block, unchanged */}
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
      <div className="mt-1 flex justify-between font-mono text-[10px] text-[var(--text-muted)]">
        {labels.map((d, i) => (
          <span key={`${d}-${i}`}>{fmtDay(d)}</span>
        ))}
      </div>
    </div>
  );
}
```

The two `{/* existing … unchanged */}` lines mean: keep the current `<svg …>…</svg>` element and the current `{markers.map((m) => (…))}` element exactly as they are now, in that order. Don't write the comments into the file.

- [ ] **Step 5: Use the shared labels in the legend and pass the range**

In `src/components/investments/account-detail.tsx`:
- import `SERIES_LABELS` from `./value-chart`, extending the `ValueChart` import;
- in `ChartLegend`:
  - replace `{manual ? 'Entered' : 'Synced'}` with `{labels.exact}`;
  - replace `{manual ? 'Carried forward' : 'Estimated between syncs'}` with `{labels.estimated}`;
  - add `const labels = manual ? SERIES_LABELS.manual : SERIES_LABELS.synced;` at the top of the function;
- change `<ValueChart manual={manual} points={series} />` to `<ValueChart currency={currency} from={overview.from} manual={manual} points={series} />`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/components/investments/ && npm run typecheck`
Expected: all pass. If a navigator-detail test looked for the legend text "Estimated between syncs", change it to "Estimated"; that's the approved copy.

- [ ] **Step 7: Commit**

```bash
npm run lint:fix
git add src/components/investments/chart-geometry.ts src/components/investments/format.ts src/components/investments/value-chart.tsx src/components/investments/account-detail.tsx tests/unit/components/investments/chart-geometry.test.ts tests/unit/components/investments/format.test.ts tests/unit/components/investments/display.test.tsx
git commit -m "feat(investments): hover the value chart for a day's value; show where history starts"
```

(Include `tests/unit/components/investments/navigator-detail.test.tsx` if Step 6 touched it.)

---

### Task 9: Verify against real data (user-gated)

This task runs only after the controller stops and the user agrees. It touches the user's own database and Yahoo.

- [ ] **Step 1:** Run the full suite, `npm run typecheck && npm run lint && npm run test:unit && npm run test:integration`. Everything must pass, with lint showing 0 errors.
- [ ] **Step 2:** Ask the user to:
  - run `npx prisma db push` (two new `Security` columns);
  - restart their dev server and open `/investments`. The page's price refresh performs the one-time backward fetches;
  - open a Plaid-only plan fund's **Plaid price** pill, enter a similar public fund's ticker and click **Follow fund**;
  - check the chart on 1Y for a Plaid account: a dashed line reaching back, close to an earlier hand-entered balance, with hover working;
  - say what looks wrong.
- [ ] **Step 3:** Fix anything they report through the normal task loop: implement, review, then re-check.
