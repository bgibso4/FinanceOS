# Investments: Vendor-Neutral Codes and Page Polish — Design

**Status:** approved in conversation 2026-10-13. This is a second spec on branch
`feat/investment-history-backfill`, shipped in the same PR as
`2026-10-12-investment-history-backfill-design.md`.
**Mocks (approved):**
- `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/ranges-yaxis.html`, section 1 (range chips, y axis).
- `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/holdings-securities.html`, screen 1 (holdings rows).

Screen 2 of that mock (Settings → Securities) belongs to Plan 4, not this spec.

## 1. Goals

1. **No vendor names outside integration boundaries** in the investment and price code. Plaid
   (the account aggregator) and Yahoo (the market data provider) appear only in their gateways:
   `src/lib/prices/yahoo.ts`, `src/lib/investments/plaid-mapping.ts`,
   `src/lib/investments/plaid-investment-sync.ts`, `src/app/api/plaid/*` and
   `src/components/plaid/*`. Stored values, types, functions, comments and UI copy elsewhere use
   neutral terms.
2. **No bare stored-value strings in code.** Every stored code (pricing mode, price source, record
   source, balance-row source, account balance source, security type) comes from one typed
   `as const` enum object. Database columns stay strings.
3. **Holdings rows** have no pills. A security held in more than one account expands to one line
   per account.
4. **Range chips gain 3Y and All. Value charts get a light y axis.**

## 2. Out of scope

- The account-aggregator abstraction for Plaid/Teller bank connections: `PlaidConnection`,
  `TellerConnection`, the Settings forks, Connected Institutions, the adopt and ignored-account
  routes, `bank-errors`, `sync-grouping`, and `PLAID_ENCRYPTION_KEY`. That is the next PR, with
  its own spec.
- Settings → Securities, past balances and the rest of Plan 4.
- `overview.ts`'s read of `plaidConnection` and `plaidEnrollment` (connection status and
  institution name). It moves behind the aggregator abstraction in the next PR. Leave it as is,
  except for stored-value codes.

## 3. Neutral codes

One module, `src/lib/investments/codes.ts`, owns every stored code for investment data. Each code
is an `as const` object plus a union type of its values. Zod enums are built from the same objects
wherever input is validated.

| Enum (key → stored value) | Column(s) | Old stored values → new |
|---|---|---|
| `Pricing`: Market→`market`, Institution→`institution`, Fixed→`fixed`, Manual→`manual`, None→`none` | `Security.pricing` | `feed`→`market`, `plaid`→`institution` |
| `PriceSource`: Market→`market`, Institution→`institution`, Manual→`manual` | `SecurityPrice.source`, `SecurityEvent.source` | `yahoo`→`market`, `plaid`→`institution` |
| `RecordSource`: Synced→`synced`, Manual→`manual`, Import→`import` | `HoldingSnapshot.source`, `InvestmentTransaction.source` | `plaid`→`synced` |
| `BalanceRowSource`: Synced→`synced`, Valuation→`valuation`, Manual→`manual` | `AccountBalance.source` | `plaid`→`synced` |
| `BalanceSource`: Provider→`provider`, Valuation→`valuation`, Manual→`manual` | `Account.balanceSource` | unchanged; replaces `BALANCE_SOURCES` in `account-defaults.ts` |
| `SecurityType`: Etf, Equity, MutualFund, MoneyMarket, Cash, Crypto, Other | `Security.type` | unchanged; moves out of `plaid-mapping.ts` |

Rules:
- The gateways write these codes through the enums too. For example, the Plaid sync writes
  `RecordSource.Synced`.
- The `ResolvedBalance.source` union in `src/lib/balances.ts` uses `BalanceRowSource` (`'plaid'` →
  `'synced'`).
- **Existing data:** an idempotent rename (one `updateMany` per column per legacy value; a legacy
  price row whose new-code twin already exists for that security and day is dropped) runs
  **automatically once per server process**, inside `getInvestmentServices()` before any service
  is returned, so no device can run investment code against old values. It is also exported for
  tests and for a thin `scripts/rename-stored-codes.ts` wrapper (manual re-run, prints counts).
- **Cloud sync:** import translates legacy values **after** the checksum check (translating
  inside the checksummed schema would make every old snapshot fail its checksum), so snapshots
  uploaded before the change restore correctly. Export writes the new values. A device still on
  the old build that pulls a new snapshot would see unknown codes; the PR says to update every
  device before syncing.

## 4. Neutral names and copy

| Now | Becomes |
|---|---|
| `FeedPricing`, `PlaidPricing`, `ProxiedPlaidPricing` | `MarketPricing`, `InstitutionPricing`, `ProxiedInstitutionPricing` |
| `PLAID_TRADE_HISTORY_DAYS` used by history and refresh | `BACKFILL_DAYS = 730`, exported by the history domain. The Plaid sync keeps its own constant internally. |
| Neutral types (`SecurityType`, `Pricing`) exported from `plaid-mapping.ts` | `codes.ts`. Price code no longer imports from a Plaid file. |
| Hint "Use Yahoo Finance symbols: add .TO …" hard-coded in the price window | `PriceProvider.symbolHint` (Yahoo's gateway supplies the text). The overview carries it to the page. |
| Account source pill "Plaid" | "Synced" |
| "Priced by Plaid: …" / "Plaid's price stays the real price" | "Priced by the institution: …" / "The institution's price stays the real price" |
| API error "Only a fund priced by Plaid can follow another fund" | "Only a fund priced by its institution can follow another fund" |
| Adjustment error naming Plaid | "… is set by its connection" (keep the sentence otherwise) |
| Comments in shared code saying Plaid/Yahoo | "the aggregator" / "the market data provider" |

## 5. Holdings rows (mock: holdings-securities screen 1)

- **Pills go.** The "No price source" pill and the "Plaid price" pill come off holdings rows.
  - The price window opens only from the account's "has no price source" notice, as before.
  - Its Plaid-only section stays in the component for Plan 4's Settings → Securities to reuse,
    renamed to an institution section.
  - The holdings read model drops the per-row Plaid quote (`HoldingRow.plaid`, `HoldingLine.plaid`,
    `plaidQuote()`) because nothing on the page uses it any more.
- **Collapsible rows.** A line held in more than one account (`accountCount > 1`) shows a chevron
  and is a button.
  - Expanding it lists one sub-line per member account, in value order:
    - account name, with institution and quantity on a small second line;
    - value and gain in the base currency;
    - weight of the whole portfolio.
  - The sub-lines sum to the parent line.
  - Single-account lines, and every line in a single-account view, have no chevron and look as
    today.
  - Expanded state is kept per line key. It survives a range change or a reload of the overview,
    and is reset by switching to another account and back.
- **The account-count pill goes.** The chevron signals that a line spans several accounts.

## 6. Ranges and y axis (mock: ranges-yaxis section 1)

- **Ranges** become `1M · 3M · YTD · 1Y · 3Y · All`.
  - **3Y** = 1,095 days.
  - **All** starts at the earliest day any investment account can have a value:
    - the earliest stored `AccountBalance` date;
    - for each account with synced holdings, its first synced snapshot minus `BACKFILL_DAYS`;
    - today when there's neither.
  - Days before an account's history starts add nothing, as now. The chart's "No history before …"
    note covers a late start.
  - The change chip reads "balance change · All".
- **Date labels** under the chart include a two-digit year (`Oct 14, 23`) when the range is a year
  or longer.
- **Y axis:**
  - three labels in a 52px left gutter, aligned to the three existing gridlines (25 %, 50 %,
    75 % of the plot height);
  - each label is the value at that gridline, in compact money (`fmtCompact`, base currency);
  - they recompute with the range;
  - the hover tooltip and gap note are unchanged;
  - manual accounts show it too.

## 7. Testing

All fixtures are synthetic. Tests use the enums, never bare stored strings, except to check the
legacy translation.
- **Unit tests:**
  - every stored-value enum round-trips its zod enum;
  - the cloud-sync import maps every legacy value to its new value;
  - the rename script is idempotent and reports counts, run against the test DB;
  - "All" range start from mixed data;
  - y-axis label values for a known series;
  - expandable rows: chevron only when `accountCount > 1`, sub-lines and their sums, expanded state
    kept across rerender with new data.
- **Lint guard:** a test that greps `src/` outside the boundary files listed in §1 for
  `'plaid'`, `'yahoo'` and `'feed'` string literals and fails if any appear. Scope it to
  investments, prices, components/investments and balances, so the out-of-scope bank-connection
  code in §2 doesn't trip it.
