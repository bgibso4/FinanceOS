# Investment Accounts (Stage 1) — Design

**Date:** 2026-10-09
**Status:** Design approved in chat; awaiting high-fidelity mock approval (see §9)
**Branch:** `feat/plaid-investments-link`

## 1. Goal

Bring investment accounts into FinanceOS as first-class citizens: Plaid-synced balances, holdings,
and investment transactions for Fidelity and Schwab, plus valued/manual investment accounts for
institutions Plaid can't reach — without polluting cash-flow features (spending, budgets, review
queue, recurring detection).

This is **stage 1** of a two-stage effort. Stage 2 ports the Google Sheets "Investment Portfolio
Tracker" (Trade Log import, categories/targets, Re-Balancing, performance, dividends, realized
gains). Stage 1's data model is designed so stage 2 builds on it without restructuring.

### In scope

- Plaid Investments sync (balances, holdings, investment transactions) for linked investment accounts
- Separate investment data model; investment accounts never write to `Transaction`
- Daily holding snapshots and balance history, with gap derivation for days the app wasn't used
- Price service (Yahoo via `yahoo-finance2`) with cached daily prices and dividend/split events
- Valuation accounts (holdings × price) and manual accounts (entered balance)
- Transfer linking between bank transactions and investment deposits/withdrawals
- In-place migration of existing manual `balance_only` investment accounts
- Minimal UI: `/investments` page, Settings modal/mapping changes, linked-transfer display

### Out of scope (stage 2 or later)

- Importing the Sheets Trade Log; reconstructing pre-go-live holdings from trades
- Categories, targets, Re-Balancing, performance/benchmark dashboards, realized gains
- Auto-sync / background sync for any account (separate future effort)
- Automatic FX rates (existing manual `ExchangeRate` stays)
- Secondary price providers (adapter interface allows adding later)
- Unvested RSU accounts (left unlinked; not owned)

## 2. Background & findings

- **Approach B chosen** over a shared-ledger hybrid (C). Investment activity (buys, dividends,
  sweeps) is not cash flow; keeping it out of `Transaction` means no cash-flow feature can leak it.
  Only four call sites derive balances from transactions (`api/accounts/balances`,
  `api/snapshots` POST, `lib/goals.ts` account progress, `lib/agent/tools.ts`
  `get_account_balances`), and no balance history is derived from transactions (net-worth
  history is stored `NetWorthSnapshot` rows), so B's blast radius is small.
- **Plaid probe** (`scripts/probe-plaid-investments.ts`):
  - Schwab: holdings with cost basis that sum exactly to balances; 24 months of trades.
  - Fidelity: holdings for all accounts arrived ~a week after linking (initial extraction lag);
    401k, HSA and the vested-stock account report **no trades**; the plan-only 401k fund has no
    public ticker but Plaid provides its price; "Emergency Savings" is a depository
    (cash management) account that also holds a Treasury ETF.
  - Real cash flows into/out of investment accounts are rare (a few transfers per year).
- **Link config:** investment links use `products: [investments]`,
  `optional_products: [transactions]` (implemented on this branch; Transactions in `products`
  hides brokerage/IRA/401k/HSA accounts).
- **Billing:** Plaid bills per Item (institution connection) per month per product; call volume
  does not change cost. The app must never call `/investments/refresh` or `/transactions/refresh`
  (per-request fees).
- **Prices:** Google Finance has no API (Sheets-only; historical data blocked via Sheets API).
  Yahoo's chart endpoint via `yahoo-finance2` works from the user's machine (raw curl gets 429
  because it lacks Yahoo's session cookie). Plan-only and Canadian group funds have no public
  price source anywhere.

## 3. Data model

All schema changes via `prisma db push` (see migration-drift note in project memory). All new
tables are included in cloud-sync export/import.

### `Account` changes

- `trackingMode`: add `'investment'` (alongside `cash_flow`, `balance_only`)
- `balanceSource String?`: `'provider' | 'valuation' | 'manual'` — required when
  `trackingMode = 'investment'`, null otherwise
- `account-defaults.ts`: Plaid accounts of type `investment` (and depository accounts the user
  marks as investment) default to `investment` mode

### New tables

| Model | Purpose | Fields |
|---|---|---|
| `AccountBalance` | Balance history | `id`, `accountId`, `date` (UTC day), `balance`, `currency`, `source` (`plaid`\|`valuation`\|`manual`), `createdAt` (stored rows are always observed/exact; estimates are derived at read time, §6); `@@unique([accountId, date])` |
| `Security` | Instrument | `id`, `plaidSecurityId?` (unique), `ticker?`, `name`, `type` (`etf`\|`equity`\|`mutual_fund`\|`money_market`\|`cash`\|`crypto`\|`other`), `currency`, `exchangeMic?`, `priceSymbol?` (provider symbol, e.g. `VIU.TO`, `BTC-CAD`), `priceSymbolOverride Boolean`, `pricing` (`feed`\|`plaid`\|`fixed`\|`manual`\|`none`), `fixedPrice?` |
| `SecurityPrice` | Daily close cache | `id`, `securityId`, `date`, `close`, `source` (`yahoo`\|`plaid`\|`manual`), `@@unique([securityId, date, source])` |
| `SecurityEvent` | Dividends/splits | `id`, `securityId`, `date`, `type` (`dividend`\|`split`), `amount?`, `ratio?`, `source`; unique on `(securityId, date, type)` |
| `HoldingSnapshot` | Daily positions | `id`, `accountId`, `securityId`, `date`, `quantity`, `price`, `value`, `costBasis?`, `source` (`plaid`\|`manual`), `@@unique([accountId, securityId, date])` |
| `InvestmentTransaction` | Trades & cash events | `id`, `accountId`, `securityId?`, `externalId?`, `date`, `type`, `subtype`, `name`, `quantity?`, `price?`, `amount`, `fees?`, `currency`, `source` (`plaid`\|`manual`\|`import`), `isCancelled`, `linkedTransactionId?` (FK → `Transaction`, `SetNull`), `createdAt`; `@@unique([accountId, externalId])` |

Conventions:

- `InvestmentTransaction.type/subtype` store Plaid's values verbatim (`buy`, `sell`, `cash`,
  `fee`, `transfer`, `cancel`; subtypes such as `dividend`, `deposit`). Interpretation happens in
  queries, not at ingestion.
- `InvestmentTransaction.amount` keeps Plaid's sign convention (positive = cash leaves the
  account to buy; negative = cash enters, e.g. sales, deposits).
- "Current holdings" = latest `HoldingSnapshot.date` per account. There is no separate
  current-holdings table.
- `SecurityPrice` stores **raw** closes. Dividend/split adjustment is computed from
  `SecurityEvent` when needed (providers restate adjusted closes).

### Balance resolver

New `lib/balances.ts` exports `getAccountBalances(accountIds?, asOf?)`:

- `investment` accounts → latest `AccountBalance` on or before `asOf`
  (plus `asOf` date and `isEstimated` for display)
- all other accounts → sum of `Transaction.amount` excluding split parents

The four balance call sites switch to it. This also fixes an existing bug where
`api/snapshots` POST and the agent balance tool double-count split transactions.

## 4. Plaid investment sync

Runs from the existing Settings sync (per enrollment), for connections whose account is in
`investment` mode. Existing per-enrollment serialization guards against concurrent runs.
Non-investment connections on the same enrollment sync exactly as today.

1. **Balance** — `accountsGet` → upsert today's `AccountBalance` (`source: plaid`).
2. **Holdings** — `investmentsHoldingsGet` → upsert `Security` by `plaidSecurityId`
   (set `priceSymbol` from ticker + MIC unless overridden; `pricing` = `fixed` 1.00 for money
   market/cash, `feed` for tickers with a public listing, else `plaid`); upsert today's
   `HoldingSnapshot` rows; upsert `SecurityPrice` (`source: plaid`) from
   `institution_price`/`close_price`.
3. **Investment transactions** — `investmentsTransactionsGet` from (last successful investment
   sync − 30 days) to today; first sync requests the full 24 months. Paginate by
   `count`/`offset`. Upsert by `(accountId, externalId)`. Rows referenced by a
   `cancel_transaction_id` get `isCancelled = true`.
4. **Depository investment accounts** (e.g. Fidelity cash management) — Plaid returns no
   investment transactions/holdings; their Transactions-product rows are fetched with
   `transactionsGet` and stored as `InvestmentTransaction` (`type: cash`, subtype from Plaid
   category) — never as `Transaction`. Known limit: securities bought inside such an account do
   not appear as holdings in stage 1.
5. **Transfer linking** — for `InvestmentTransaction`s with `type = transfer` or
   `type = cash` and subtype in (`deposit`, `withdrawal`, `contribution`): find an unlinked bank
   `Transaction` with the opposite cash direction, equal absolute amount, within ±5 days; set
   `linkedTransactionId` and mark the bank transaction `isTransfer = true`. Ambiguous matches
   (more than one candidate) are left unlinked. Linking is retried on later syncs of either side.
6. Investment-mode accounts **never** write `Transaction` rows; `transactionsSync` is skipped
   for them.

Errors:

- Auth errors → existing `classifyPlaidError` / `needs_reauth` flow.
- `PRODUCT_NOT_READY` (or empty first extraction) → step marked `pending`; prior data kept;
  Settings shows "Waiting on institution".
- Steps are independent: a failed step does not roll back earlier steps. The sync response
  reports per-step status.

## 5. Price service

`lib/prices/` with a `PriceProvider` interface (`getDailyCloses(symbol, from, to)`,
`getQuote(symbol)`, `getEvents(symbol, from, to)`) and a Yahoo implementation via
`yahoo-finance2` (`chart()` with `events: div|split`).

- **When it runs** (never in the background): after an investment sync; when an investment
  view loads; when a fresh quote is requested (quote cached 15 min in memory).
- **Staleness:** a security needs fetching when its latest stored `yahoo` price is older than
  the last completed trading day.
- **Call discipline:** symbols processed sequentially, ~0.5 s apart; one `chart()` call per
  symbol covering (last stored date + 1 → today); stored days are never refetched. Bars whose
  `close` is null (today's unfinished session) are dropped.
- **Failures:** on 429/network error retry once after a few seconds; if it fails again, stop the
  run (keep prices already saved). Next trigger tries again. No persisted cooldown. A symbol
  Yahoo doesn't recognize sets `pricing = none` (UI flags it; user can fix the symbol or set
  manual pricing).
- **Non-feed pricing:** `fixed` (money market = 1.00), `plaid` (plan-only funds; from
  `SecurityPrice` source `plaid`), `manual` (user-entered unit price).
- **Symbol mapping:** ticker + MIC → provider symbol (`XTSE` → `.TO`; crypto → `BTC-USD` /
  `BTC-CAD`); user override via `priceSymbolOverride`.

## 6. Valuation & history derivation

### Valuation accounts (`balanceSource = valuation`)

Holdings are user-entered (`HoldingSnapshot` `source: manual`, carried forward until edited).
After a price run, write one `AccountBalance` (`source: valuation`) per trading day since the
last row: Σ quantity × close (converted to account currency via `ExchangeRate` if needed).
These rows are exact (quantities only change on edit).

### Manual accounts (`balanceSource = manual`)

User records a balance (amount + date) → `AccountBalance` (`source: manual`). Optionally units +
unit price for a single fund.

### Derived history for provider accounts (read-time, not stored)

For dates with no stored balance/snapshot (days the app wasn't opened):

- **Quantity** — nearest snapshot adjusted by replaying non-cancelled
  `InvestmentTransaction`s between the snapshot and the date. If the account reports no trades,
  carry forward (or interpolate between two snapshots).
- **Price** — `SecurityPrice` (feed) for listed securities; linear interpolation between
  Plaid-reported prices for plan-only funds; fixed for money market.
- **Value** — Σ quantity × price; marked `isEstimated` in API responses so charts can style it.

Exposed via `lib/investments/history.ts` → `getAccountValueSeries(accountId, from, to)`.

## 7. Migration

`scripts/migrate-investment-accounts.ts` — dry run by default, `--apply` to write. Before
`--apply`, copies `prisma/dev.db` to a timestamped backup. All writes in one Prisma transaction.

Existing accounts are **converted in place** (ids preserved, so `NetWorthSnapshot` JSON and
goals stay valid):

1. Set `trackingMode = 'investment'` and `balanceSource` per the mapping below.
2. Replay the account's "Balance Adjustment" transactions in date order; write the running total
   at each date as an `AccountBalance` (`source: manual`). Then delete those adjustment
   transactions.
3. For provider accounts, create the `PlaidConnection` to the matching Plaid account
   (matched by mask; abort the run if any match is missing or ambiguous), then run the first
   investment sync.

| Existing account | Mode / source |
|---|---|
| Fidelity: Vested Employer Stock, Emergency Savings, HSA, Employer 401(k), Roth IRA, Index Portfolio | investment / provider (Plaid) |
| Schwab: Individual, Roth IRA | investment / provider (Plaid) |
| *(new)* Fidelity Traditional IRA | investment / provider — routes backdoor-Roth transfers |
| Questrade RRSP | investment / valuation (user enters positions) |
| Crypto Wallet | investment / valuation (BTC holding) |
| Canadian group RRSP | investment / manual |
| Student Loan | unchanged (`balance_only`) |

Left unlinked: Fidelity unvested RSU account; closed Schwab Contributory IRA.

## 8. UI (minimal; final visuals per approved mocks)

- **`/investments` page** (new route + side-nav entry): portfolio total; per-account rows with
  balance, source badge (Plaid / Valued / Manual), "as of" date, estimated/stale indicators;
  expand → latest holdings table (security, quantity, price, value, cost basis, unrealized gain
  where known) and investment activity list.
- **Settings → account modal (investment accounts):** balance-source selector; manual →
  "Record balance" (amount + date) replacing adjustment-based reconcile; valuation → holdings
  editor (security search/add, quantity) with price-symbol override.
- **Settings → Plaid account mapping:** investment-type Plaid accounts default to investment
  mode; option to treat a depository account as investment.
- **Transactions list:** bank transactions linked to an investment transfer show
  "→ <investment account>" and remain excluded as transfers.
- **States to design:** stale prices ("Prices as of …"), estimated history, Plaid pending
  ("Waiting on institution"), needs-reauth, `pricing = none` securities.

## 9. Mock-driven design gate

Before the implementation plan is written, high-fidelity HTML mocks (Friedrik design system,
realistic data) are produced and **approved by the user**. Mocks live in
`~/Documents/FinanceOS-design-archive/design-mocks/investments/`. Screens:

1. `/investments` — overview (all accounts)
2. `/investments` — expanded account (holdings + activity)
3. `/investments` — states: stale prices, estimated history, waiting on institution, needs reauth
4. Settings modal — provider / valuation (holdings editor) / manual (record balance)
5. Settings — Plaid mapping for investment accounts
6. Transactions — linked investment-transfer row

This spec is updated with the approved mock filenames before planning.

## 10. Error handling summary

| Failure | Behavior |
|---|---|
| Plaid auth | Existing `needs_reauth` flow + Reconnect |
| Plaid product not ready | Step `pending`, keep prior data, "Waiting on institution" |
| One sync step fails | Others still apply; per-step status returned |
| Duplicate/cancelled trades | Upsert by external id; cancel marks `isCancelled` |
| Yahoo 429/network | Retry once, then stop run; prices shown "as of" last stored |
| Unknown symbol | `pricing = none`, flagged in UI, user fixes symbol or prices manually |
| Migration ambiguity | Abort before writing; DB backed up before `--apply` |

## 11. Testing

TDD with Vitest.

- **Unit:** balance resolver (investment vs cash-flow, split-parent exclusion); adjustment →
  `AccountBalance` replay; Plaid holdings/transactions mapping; cancel handling; transfer
  matcher (match, no match, ambiguous); symbol mapping; price service with mocked
  `yahoo-finance2` (staleness, range, null-close drop, retry-then-stop, unknown symbol);
  history derivation (trade replay, carry-forward, interpolation, `isEstimated`); valuation
  balance rows.
- **Integration:** investment sync route against a test DB via `setPrismaClient`; migration
  script against a fixture DB (dry run output, apply, idempotency guard).
- **Fixtures:** derived from probe output with account numbers/ids scrubbed; no personal data
  committed.
- **Verification before completion:** real sync against Fidelity and Schwab; migration dry-run
  reviewed by the user; built UI compared side-by-side with approved mocks.
