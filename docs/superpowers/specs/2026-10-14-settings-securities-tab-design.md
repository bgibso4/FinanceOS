# Settings → Securities Tab — Design (Plan 4a)

**Status:** approved in conversation 2026-10-14. This is the first of three Plan 4 specs:
- 4a: this spec, Settings → Securities.
- 4b: Manage account for investment accounts, with past balances.
- 4c: transfer chips in Transactions.

**Mock:** `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/holdings-securities.html`, screen 2 (copy updated to neutral terms 2026-10-14). Its names and numbers are synthetic.

## 1. Goal

One place to see how every security is priced and change it. The price window moves here, and the
investments page no longer opens it. The first use is pointing an institution-priced fund with no
public ticker at a similar fund to follow.

## 2. Scope

**In scope:**
- a new Settings tab;
- a read endpoint for the list;
- the price window, reused with a new title and a "Currently" line;
- the investments-page notice linking to the tab.

**Out of scope:**
- Manage account (4b) and transfer chips (4c);
- adding or deleting securities from this tab, since securities are created by holdings and trades;
- the account-aggregator abstraction (a separate PR).

## 3. The tab

`/settings?tab=securities`, labelled **Securities**, placed between Accounts and Categories.

**Rows.** Every security referenced by a holding snapshot or an investment transaction of any
investment account. That includes inactive (closed) accounts, because their history still needs
prices. Each cash currency is its own row. Rows are sorted by ticker or label, case-insensitive.

**Columns:**

| Column | Content |
|---|---|
| Security | ticker, or the name when there is no ticker (mono); the name on a small muted second line |
| Type | Stock, ETF, Fund, Money market, Cash, Crypto, Other (from `SecurityType`) |
| Held in | "1 account" / "N accounts": active accounts whose latest snapshot holds a non-zero quantity; "Not held" when none |
| Price source | one main label plus an optional small second line (table below) |
| Latest price | the price the source last gave, in the security's currency (mono), with its date on a small second line; "—" when none |
| (edit) | pencil icon button, tooltip and aria-label "Change how {label} is priced"; absent for fixed-price securities |

**Price source labels.** Codes come from `Pricing` in `src/lib/investments/codes.ts`.

| Pricing | Main label | Second line |
|---|---|---|
| Market | `Market · {priceSymbol}` | — |
| Institution, with a proxy | `Institution` | `Follows {proxy symbol} on days without an institution price` |
| Institution, no proxy | `Institution` | `Not following a fund` |
| Manual | `Manual · {price}` | `Entered {date}` |
| Fixed | `Fixed · {fixedPrice}` | — |
| None | `No price source` (warning colour) | `Valued at its last known price` |

**Latest price.** This is the latest stored close the security's own pricing mode uses: market
closes for Market, institution closes for Institution, manual prices for Manual. For Fixed it is
`fixedPrice`, with no date. For None it is "—".

**Toolbar:**
- a segmented toggle, **All · N** / **Needs attention · N**, where Needs attention means pricing
  None;
- a search box (placeholder "Search ticker or name") that filters by ticker or name,
  case-insensitive.

Both filters run on the client over the loaded list.

**Empty state.** With no securities, the card shows: "No securities yet. They appear once an
investment account has holdings or trades."

**Deep link.** `?tab=securities&security={id}` scrolls that row into view and highlights it (accent
border and background) until the next click. The Needs attention filter is not forced on.

## 4. The price window

The existing `SetSymbolModal` is reused (rename allowed in the plan).
- **Title:** `How {label} is priced`.
- **First line:** `Currently {source} · {latest price} on {date}`. `{source}` is the main label,
  except that Manual and Fixed drop their price (`Manual`, `Fixed`), so the price is not shown twice.
  The price and date are left out when there is none, and the date when the source has none
  (Fixed). Examples: `Currently Manual · $64.30 on Sep 30`, `Currently Fixed · $1.00`.
- **Sections, unchanged:**
  - **Price symbol**, with the provider's `symbolHint`;
  - **Or set a price per unit**;
  - for institution-priced securities only, **No public ticker? Follow a similar fund** (Follow fund
    / Stop following), with the hint "The institution's price stays the real price. On days without
    one, this holding moves with the fund you pick."
- **Saving.** It still uses `PATCH /api/investments/securities/:id`. After a successful save the
  window closes, the list reloads and cloud sync is triggered, matching the investments page's
  `saved()` pattern.
- **Fixed securities** have no pencil, so they never open the window.

## 5. Investments page

- The account notice "{labels} has/have no price source." keeps its text. Its action becomes a link,
  **Set up pricing**, to `/settings?tab=securities&security={first unpriced id}`.
- The price window and its dialog state are removed from the investments page. `AccountDetail`
  loses `onSetSymbol`.
- The overview's `symbolHint` moves to the securities list response, since the window now lives in
  Settings. Remove it from the overview if nothing else reads it.

## 6. API

`GET /api/investments/securities` returns `{ securities: SecurityListItem[], symbolHint: string }`.

```ts
type SecurityListItem = {
  id: string;
  label: string; // ticker, or name when no ticker
  name: string;
  type: SecurityType;
  currency: string;
  pricing: Pricing;
  priceSymbol: string | null;
  proxySymbol: string | null;
  fixedPrice: number | null;
  latest: { price: number; date: string | null } | null; // date YYYY-MM-DD; null for Fixed
  heldIn: number; // active accounts currently holding it
};
```

- It is served by a `SecurityListReader` class (`prisma`), wired in `src/lib/investments/services.ts`
  and exposed on `InvestmentServices`.
- The route goes through `getInvestmentServices()`, so the stored-code rename has run.
- It reuses existing query and price helpers (pricing strategies, the source filter in
  `src/lib/prices/pricing.ts`) rather than adding new ones.
- No schema change.

## 7. Constraints

- **Design principles.**
  - DRY > YAGNI > SOLID, with classes taking injected dependencies and `services.ts` as the
    composition root.
  - Reviewers treat violations as Important.
- **Vendor neutrality.**
  - No vendor names outside the integration gateways.
  - The only provider-specific text on screen is `symbolHint`, which the gateway supplies.
  - The `vendor-literals` lint guard's scope gains any new in-scope directories.
- **UI.**
  - Settings tab conventions (`src/app/(routes)/settings/page.tsx` tab bar and `?tab=` routing).
  - Put the tab body in its own component file under `src/components/settings/` or
    `src/components/investments/`, not inline in the 4,700-line settings page.
  - CSS variables only, `font-mono` for numbers and tickers, dates formatted in UTC.
  - Reuse `Modal`, `Button` and `Input`.
- **Public repo.** Synthetic test data only.

## 8. Testing

- **Unit (reader, test DB).**
  - Lists securities from snapshots and from trades.
  - Includes inactive accounts' securities.
  - Counts `heldIn` only from active accounts with a non-zero latest quantity.
  - Gives the latest price per pricing mode, including proxy symbol and fixed.
  - Excludes securities no investment account references.
- **Route.** `GET` returns the list and `symbolHint`.
- **Component.**
  - Every source label and second line in §3.
  - No pencil on Fixed.
  - Both filters, with their counts.
  - Search.
  - Empty state.
  - Deep-link highlight.
  - The window title and "Currently" line.
  - Saving reloads the list.
- **Investments page.** The unpriced notice renders a **Set up pricing** link with the right href,
  and no price window opens.

## 9. Amendment 2026-10-16: price window v2 (after the real-data check)

**Mock:** `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/price-window-v2.html`,
approved 2026-10-16. It supersedes §4's sections and §3's Institution and cash labels.

**Why.** On real data, the symbol box (the window's first field) caught an attempt to follow a fund. That
switched an institution-priced trust to Market under the followed fund's symbol, and nothing in the
window offered a way back to the institution's price. The buttons also wrapped onto two lines.

**Price window.**
- Title and "Currently" line unchanged (§4).
- A small uppercase label **Price it with**, then up to three option cards, each a radio with a title
  and a one-line description. Only the selected card shows its fields.
  - **Institution price**: "The price your institution reports for it." Shown when the security is
    priced by its institution or has any stored institution price. Field: "Follow a similar fund
    between institution prices · optional" (placeholder "Ticker", prefilled with the current proxy
    symbol), with the existing hint "The institution's price stays the real price. On days without
    one, this holding moves with the fund you pick."
  - **Market symbol**: "Daily closes from the market data provider." Field "Symbol" (placeholder
    "e.g. VTI or XIU.TO", prefilled with the current price symbol when Market), with `symbolHint`.
  - **Manual price**: "A price per unit you enter. It stays until you change it." Field "Price per
    unit" (prefilled with the latest manual price when Manual).
- The current source's card is selected on open; none is selected for None.
- Footer, right-aligned: **Cancel** (closes, no change) and **Save** (accent). Save is disabled until the
  selection or a field differs from how it opened. Buttons never wrap.
- Saving: Institution → `PATCH { proxySymbol: <ticker> | null }` (blank means not following);
  Market → `{ priceSymbol }`; Manual → `{ manualPrice }`. Validation messages as before. After a
  successful save: close, reload, trigger sync (§4).

**API.**
- `PATCH { proxySymbol }` now means "price by the institution, following this fund (or none)". It
  succeeds for a security priced by its institution or one with any stored institution price. Switching
  back sets pricing Institution, clears the price symbol, keeps the user's choice from being overwritten
  by sync (`priceSymbolOverride`), and drops the old symbol's market prices and events (as a symbol
  change does). Otherwise it is rejected as before.
- `SecurityListItem` gains `hasInstitutionPrice: boolean` (any stored institution price).

**List labels.**
- Institution: main label `Institution · follows {proxy symbol}` when following, else `Institution`. No
  second line.
- Cash rows are labelled `{currency} cash` (e.g. "USD cash"), with no name line.
