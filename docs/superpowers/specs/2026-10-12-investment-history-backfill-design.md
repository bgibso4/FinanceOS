# Investment History Backfill, Proxy Pricing & Chart Hover — Design

**Status:** approved in conversation 2026-10-12; follow-up to the investments page (PR #34).
**Builds on:** `2026-10-09-investment-accounts-design.md` (Plans 1–3).
**Mock:** `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/history-hover.html` (approved).

## 1. Problem

Plaid investment accounts only have value history from their first Plaid holdings snapshot (the first
investments sync). Before that, the chart repeats the last hand-entered balance, so 3M/YTD/1Y views
are a flat line and then a jump. That's despite the app already storing 24 months of Plaid
trades and, for most held securities, daily closes over the same period.

Two smaller gaps:
- A fund priced only by Plaid (no Yahoo ticker, e.g. a 401(k) collective trust) has no price history
  at all, and its price is flat on any day the app didn't sync.
- Charts can't be inspected: there is no way to read the value on a given day.

## 2. Goals

1. **Backfill:** Plaid accounts show estimated daily value history back up to 24 months before their
   first Plaid holdings snapshot, worked out at read time from stored data.
2. **Backward price fetch:** feed-priced securities get Yahoo closes back to the start of the history
   window, fetched once.
3. **Proxy pricing:** a Plaid-priced security can follow a similar public fund. Plaid's price stays the
   real price; days without one move with the proxy's daily changes.
4. **Chart hover:** the investments value chart shows the date, value and synced/estimated status for
   the day under the cursor.

## 3. Non-goals

- Click a holding to chart its own price (deferred).
- Backfilling manual or valued accounts.
- Hover on account-list sparklines or on non-investment (dashboard) charts.
- Historical exchange rates. Conversion uses today's rates, as elsewhere.
- Detecting or repairing missing transfer records beyond stopping the line (§4.3).

## 4. Backfill (read-time, provider accounts)

### 4.1 Where

`ProviderValueDeriver` in `src/lib/investments/history.ts` already estimates days *after* a snapshot.
Today it returns null for days before the first snapshot. It now estimates those days by walking
backward from the first snapshot. Nothing new is stored.

### 4.2 Rules for a day `d` before the first Plaid snapshot `S0` (date `t0`)

- **Window:** `d` must be on or after `t0 − FIRST_SYNC_DAYS` (730, Plaid's trade-history limit; reuse
  the existing constant). Earlier days are null.
- **Quantities:** for each security in `S0`, quantity(d) = `S0` quantity − Σ quantity of non-cancelled
  `buy`/`sell`/`transfer` trades with date in `(d, t0]`. Securities not in `S0` but traded in the
  window start from 0 and are reversed the same way (a position sold before `t0` reappears). Cash
  securities are excluded from quantity reversal (same rule as forward derivation).
- **Cash:** an explicit cash position in `S0` is reversed through cash flows:
  cash(d) = cash(t0) + Σ `amount` of flows in `(d, t0]` (the sign convention mirrors the forward
  `cashFlow = −Σ amount`). With no explicit cash position, implicit cash = (stored balance on `t0`
  − Σ `S0` position values) reversed the same way. This mirrors the forward rule.
- **Prices:** `PriceBook.at(securityId, d)` (the security's pricing strategy). If null, use the
  security's `S0` snapshot price (holds the first known price flat). A security that is not in `S0`
  and has no price on `d` makes the day unpriceable (see stop rules).
- **Value:** Σ quantity × price, converted to the account currency at today's rates, rounded to cents.
  Positions with quantity ≤ 0 within epsilon contribute nothing.
- **Marked estimated** (`isEstimated: true`, dashed).

### 4.3 Stop rules

Compute once per account in `load`, walking backward from `t0`. The **stop day** is the latest
day `< t0` on which any of these holds:
1. it is before the window start (`t0 − 730`);
2. some non-cash security's reversed quantity is below `−1e-6` (a missing record, e.g. shares
   transferred in without a trade);
3. a security with non-zero reversed quantity has no price (§4.2).

That day and every earlier day return null. The line never resumes earlier.

### 4.4 Precedence (unchanged order, new middle tier for pre-`t0` days)

1. Stored `AccountBalance` on that exact day (synced or hand-entered) wins.
2. Derived estimate (forward between snapshots, or backward per §4.2).
3. Otherwise the existing carry-forward of the previous stored balance, which only applies before
   the stop day now.

Days before `t0` that today repeat an earlier hand-entered balance will show the backfilled
estimate instead. The hand entries remain as exact points.

### 4.5 All accounts

`portfolioSeries` is unchanged. An account with no point on a day contributes nothing, so the total
can step where an account's history starts. This is accepted and is the same behaviour as today.

## 5. Backward price fetch

`PriceRefresher` only fetches forward from a security's latest stored close. Add a one-time backward
fetch:

- **History start** for a feed security = the earliest of:
  - its first trade or holding snapshot;
  - for each Plaid account holding it (in any Plaid snapshot), that account's first Plaid snapshot
    date − 730 days;
  - the history start of every security that uses it as a proxy (§6).
- New field `Security.pricesFetchedFrom DateTime?`: the earliest day already requested from the
  provider. A security needs a backward fetch when `pricesFetchedFrom` is null or later than its
  history start. After a successful fetch, set it to the history start, even when Yahoo returned
  nothing that early (a fund younger than the window), so the fetch is not repeated.
- The existing forward fetch sets `pricesFetchedFrom` when it first prices a security (`from` of
  that call). For existing rows, null means "needs the check once".
- Runs inside the normal `refresh()` run, after forward fetches, with the same pacing
  (`SYMBOL_GAP_MS`), retry and stop rules. A stopped run leaves `pricesFetchedFrom` untouched for
  securities it didn't finish.
- Price rows are stored with the existing `storeHistory` (source `yahoo`, idempotent).
- After a backward fetch that stored rows, valued accounts holding those securities are revalued
  from the earliest new day (`writeBalances({ from })`), the same as after a symbol fix.

## 6. Proxy pricing

### 6.1 Data

- New field `Security.proxySecurityId String?`, a self-relation to the proxy's `Security`
  (`onDelete: SetNull`).
- The proxy is an ordinary feed security, created or found with `SecurityCatalog.findOrCreateFeed`.
  That validates the symbol against the quote source, as the holdings editor does.
- Only securities with `pricing === 'plaid'` may have a proxy. A security can't proxy itself, and the
  proxy must be feed-priced. Proxy chains are not followed.
- The refresher prices proxies like held securities: the forward and backward selection includes
  feed securities that are some security's proxy.

### 6.2 Pricing rule (`ProxiedPlaidPricing` strategy in `src/lib/prices/pricing.ts`)

For a Plaid-priced security with a proxy, on day `d`:
1. A Plaid price on `d` → that price, not estimated.
2. Otherwise **anchor** = the latest Plaid price on or before `d`, else the earliest Plaid price after
   `d`. price = anchor.close × proxy(d) / proxy(anchor.date), estimated. `proxy(x)` is the proxy's
   Yahoo close carried forward to `x`.
3. If either proxy close is missing → fall back to `PlaidPricing` (today's behaviour).

`pricingFor` and `PriceBook.load` gain the proxy: `PriceBook` loads the proxy's points alongside and
hands them to the strategy. `pricingFor`'s signature grows an optional `proxyPoints`. It stays the
one place a pricing mode becomes behaviour. Without a proxy, `plaid` keeps `PlaidPricing`.

Currency: the ratio is unitless, so a proxy in another currency still works but carries that
currency's FX moves. This is accepted, and the UI doesn't restrict it.

### 6.3 API & service

- `PATCH /api/investments/securities/[id]` body union gains `{ proxySymbol: string | null }`
  (trimmed, 1–20 chars, or null to stop following).
- `InvestmentRefreshService.setProxy(id, symbol | null)` runs under the shared refresh lock:
  1. validate (400 `InvestmentInputError` if the security isn't Plaid-priced or the proxy is itself);
  2. find or create the proxy;
  3. link it, or unlink on null;
  4. price the proxy, forward and backward (`prices.refresh({ securityIds: [proxyId] })`). If that
     stops, keep the link and return. The next refresh prices it;
  5. revalue valued-account holders, as `setPriceSymbol` does. Share that "revalue holders" step
     rather than duplicate it.
- An unknown proxy symbol → 400 with the catalog's existing message. Rate limit or network → 502,
  matching the existing symbol-fix route.

## 7. UI

### 7.1 Pricing pills open the price window (mock §2)

- `HoldingLine` gains `pricing` (the security's pricing mode) and `proxyLabel: string | null`.
- Holdings table: the existing **No price source** pill (accent) becomes a button that opens
  `SetSymbolModal` for that security. A new blue **Plaid price** pill (`pricing === 'plaid'`) does the
  same and reads **Plaid price · follows {proxyLabel}** when a proxy is set. Ordinary feed, fixed and
  manual holdings show no pill. This applies to both single-account and All-accounts views.
- The account header's existing **Set symbol** action is unchanged.

### 7.2 Price window (mock §2 overlay)

- Title `Price {label}`; the two existing sections are unchanged.
- For a Plaid-priced security only:
  - a top hint "Priced by Plaid: {price} on {date}" from the latest Plaid price;
  - a divider and a **No public ticker? Follow a similar fund** section;
  - if no proxy is set: a ticker input and an accent **Follow fund** button;
  - if a proxy is set: "Following {SYMBOL} · {name}" with a **Stop following** link;
  - the hint copy from the mock.
- Saving or stopping calls the PATCH and then the existing `onSaved` (page reload of the overview).
  Errors show in the existing `ERROR` line.

### 7.3 Chart hover (mock §1)

`ValueChart` (`src/components/investments/value-chart.tsx`):
- Pointer move or touch drag over the plot snaps to the nearest point's day. It shows a vertical
  crosshair, a dot on the line, and a tooltip with the full date (`Wed, Sep 16, 2026`), the value
  (`fmtMoney`, base or account currency as the chart already uses), and a legend swatch with
  **Synced** or **Estimated** (or **Entered** for manual accounts, matching the existing legend).
- The tooltip sits right of the cursor, flipping left when it would overflow. It hides on leave.
- **Range-aligned x axis:** `ValueChart` takes the range start date. When the series' first point is
  more than a few days after it, the x axis still spans the whole range. The empty part shows
  "No history before {date}" and has no hover. Axis labels use the range dates.
- Pure geometry (nearest index, tooltip side) lives in `chart-geometry.ts` and is unit-tested.

## 8. Testing

All fixtures synthetic (public repo; never copy values from mocks or the DB).

- **Unit:**
  - `ProxiedPlaidPricing`: exact Plaid day, anchored before and after, missing proxy closes,
    multiple Plaid points;
  - backward derivation: quantity reversal, sold-before-`t0` positions, explicit and implicit cash,
    each stop rule, precedence over stored rows, window limit;
  - the hover geometry helpers;
  - the pill and modal rendering and their actions.
- **Integration (Prisma test DB, fake price provider):**
  - a refresh performs the backward fetch once, sets `pricesFetchedFrom`, and doesn't repeat it;
  - a stopped run leaves it unset;
  - a refresh prices proxies;
  - the `setProxy` route: success, unlink, unknown symbol, a non-Plaid security, and that the
    lock is held;
  - `accountSeries` across `t0` for an account with snapshots, trades and prices.
- No real Yahoo or Plaid calls in tests.

## 9. Schema & rollout

- Two `Security` fields: `pricesFetchedFrom DateTime?` and `proxySecurityId String?` with a
  self-relation. Apply with `npx prisma db push` and `npx prisma generate`, never `migrate dev`.
  Every device runs `db push`; the PR notes this.
- The first refresh after deploy performs the backward fetches: one call per held feed security,
  paced as usual.
- To have a Plaid-only plan fund follow a similar public fund, the user opens the fund's
  **Plaid price** pill → **Follow fund**. No data is seeded in code.

## 10. Risks

- **Missing transfer records:** the line stops early (§4.3 rule 2) rather than drawing wrong values.
- **Plaid snapshot price vs. Yahoo close on `t0`:** a small step can appear at `t0`. Accepted.
- **Today's FX applied to old days:** same as the existing estimate. Automating FX is already a
  tracked follow-up.
