# Manage Account Drawer & Investment Account Settings (Plan 4b) — Design

Status: draft for review · 2026-10-29
Parent: `2026-10-09-investment-accounts-design.md` §8 (Settings → Manage account), Plan 4 scope.
Mock (approved 2026-10-29): `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/manage-account.html`.
It replaces screen 1 of `layouts/settings-investments.html`. Screen 2 (Add from a connected
institution) of that mock still applies, with neutral copy (§6).

## 1. Goal

Make Settings → Accounts work for investment accounts, and stop managing accounts in a modal:

- **Manage opens a drawer** on the right for every account. It pushes the page aside, stays open
  while you click other accounts (it swaps to the clicked one), and closes with ✕ or Esc.
- Investment accounts get the sections their **balance source** needs instead of *Reconcile
  Balance*: connection, holdings, and **Balances you entered**.
- **Balances you entered** works on every investment account: add one balance, or paste several
  past balances from a spreadsheet (e.g. quarterly statement values), with a preview before saving.
- **New investment accounts** start as Investment. That covers brokerage, retirement and crypto
  accounts added by hand, and investment accounts added from a connected institution.

## 2. Non-goals

- Converting an existing everyday account (cash flow or net worth only) into an investment account,
  or the reverse. The drawer does not offer it, and the API refuses it (§5.1).
- Transfer chips in Transactions (Plan 4c).
- Editing holdings inside the drawer. **Edit holdings** opens the existing `HoldingsEditorModal`.
- Labelling balances migrated from adjustment transactions. Nothing stored distinguishes them, so
  they are listed like any other entered balance.

## 3. The drawer

### 3.1 Behaviour

- Closed by default; the Accounts tab looks exactly as it does today.
- Clicking an account card opens the drawer on that account and highlights the card (accent border
  and ring). Clicking another card while it is open swaps the drawer to that account. Unsaved edits
  in *Edit Details* are dropped on a swap, just as they are on close today.
- ✕ in the drawer header, or Esc, closes it. There is no backdrop. The page behind stays scrollable
  and clickable.
- **Width 540px.** At ≥1100px viewport width the page is pushed. The Settings content gets right
  padding equal to the drawer width while it is open, so the card grid reflows (4 → 3 or 2
  columns). Below 1100px the drawer overlays the page at `min(540px, 100vw)`.
- Header: `Manage <name>`, then a sub-line `<institution>`, plus ` · Investment · <Source>` for
  investment accounts. The body scrolls on its own.
- Accessibility: `role="dialog"` with `aria-modal="false"`, labelled by the title. Focus moves to the
  drawer when it opens and returns to the card when it closes.

### 3.2 Component

`src/components/ui/drawer.tsx` already exists, is unused, and renders a dimmed overlay. Rework it
into the push drawer:

```ts
type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};
export const DRAWER_WIDTH = 540; // px; pages pad by this while a drawer is open (≥1100px)
```

The Settings page replaces the account `<Modal>` with `<Drawer>`. The sections inside keep today's
order and code. Only the investment-specific parts below are new, and they live in
`src/components/investments/` rather than growing `settings/page.tsx`.

## 4. Sections by account kind

Order, top to bottom:

| Section | Cash flow / Net worth only | Investment · Synced | Investment · Valued | Investment · Manual |
|---|---|---|---|---|
| Edit Details (with tracking mode, plus balance source for investment accounts) | ✓ | ✓ | ✓ | ✓ |
| Account Info | ✓ (today) | ✓ | ✓ | ✓ |
| Bank Connection (existing section) | when connected | ✓ | when connected¹ | when connected¹ |
| Holdings (read-only) | — | ✓ | ✓ + **Edit holdings** | — |
| Balances you entered | — | ✓ | ✓ | ✓ |
| Reconcile Balance | ✓ (today) | — | — | — |
| Archive / Restore / Delete (existing) | ✓ | ✓ | ✓ | ✓ |

¹ A previously synced account that was disconnected.

### 4.1 Edit Details

- **Tracking mode.** For an everyday account the select offers *Cash flow* and *Net worth only*,
  as today. For an investment account it is shown as fixed text: "Investment: holdings and balance
  history". There is no select (§2).
- **Balance source** (investment accounts only). Three option cards in the price-window style:
  - **Synced**: "From your institution through its connection."
  - **Valued**: "The units you hold × daily market prices."
  - **Manual**: "You enter the balance from statements."
- Rules:
  - An account with an active aggregator connection shows **Synced** selected and locked, with the
    hint "Disconnect to value it or enter balances yourself."
  - An account without one can choose between **Valued** and **Manual**. Synced is disabled, with
    the hint "Synced needs a connection to this account’s institution."
- Saved with the existing **Save changes**. Switching between Valued and Manual keeps every stored
  balance and holding, and the new source writes from then on (§5.2).

### 4.2 Holdings (Synced, Valued)

- A read-only table of the account's current holdings: security (ticker or symbol plus name),
  units, price and value, in the account currency. The sub-label is "from the connection" (Synced)
  or "valued at daily closes" (Valued).
- Data comes from the same current-holdings reader the Investments page uses. Don't write a second
  query.
- Valued adds **Edit holdings**, which opens `HoldingsEditorModal` over the drawer. Saving it
  refreshes the drawer's holdings and the account balance.

### 4.3 Balances you entered (every investment account)

- **Add row:** *As of* (date, default today) · *Balance (CUR)* · **Add**.
- **List:** every stored balance with the `manual` row source for the account, newest first, each
  with ✕ to delete. Sub-label: "N entries", or "none yet".
- **Hint:**
  - Synced and Valued: "For days before syncing (or valuing) began on `<date>`, from old
    statements. Each one is exact on its date."
  - Manual: "From your statements. The balance holds until the next entry."
- **Cutoff (`enterBefore`).** Entered balances must be dated before the day the account's own
  history begins. After that day, synced or valued balances own every day:
  - **Synced:** the earliest stored `synced` balance or synced holding snapshot. If there is none
    yet, today.
  - **Valued:** the earliest real holding snapshot (excluding the manual-holding mirror). That is
    where valuation starts writing, so a manual row on or after it would be overwritten. If there
    is none, today.
  - **Manual:** no cutoff; any date up to today.
  - All sources: future dates are refused.
- **Manual accounts:** an add or delete keeps the account's single mirror holding in step, as
  `ManualHoldingService` does today.

### 4.4 Paste past balances

"Paste several from a spreadsheet" (below the list) expands, inside the same section:

1. A textarea. One per line: a date and a balance. Hint: "One per line: a date and a balance,
   separated by a tab or comma. Dates like 2025-03-31 or 3/31/2025."
2. A live preview table (Date · Balance · status) with a summary line: "N lines read · N to save
   · N skipped".
3. **Cancel** and **Save N balances**. Save is disabled when N = 0.

**Parsing:** a pure function `parsePastBalances(text): ParsedLine[]`.

- Blank lines are ignored.
- A line is read as a leading date followed by a balance. Everything after the date, less any
  separator (tab, comma, spaces), is the balance text.
- **Dates:** `YYYY-MM-DD` and `M/D/YYYY` (US order, matching the app's locale). Invalid calendar
  dates are unreadable.
- **Balance:** strip currency symbols and codes (`$`, `CA$`, `USD`, `CAD`…), thousands commas and
  spaces, then parse. A leading `-` or wrapping parentheses mean negative. Two decimals at most
  after rounding.
- A line without both parts is **unreadable**.

**Classification:** a pure function, `classifyPastBalances(lines, { entered, enterBefore, today })`.

| Status | When | Saved? |
|---|---|---|
| New | no entered balance on that date | ✓ |
| Replaces `<amount>` | an entered balance exists on that date with a different amount | ✓ (overwrites) |
| Already entered | same date, same amount | — |
| Skipped: `<source>` from `<date>` | on or after `enterBefore` | — |
| In the future | after today | — |
| Date repeated | a date appears again further down the paste (the later line is skipped) | — |
| Can't read this line | parse failure | — |

Both pure functions live in `src/lib/investments/past-balances.ts`. The client uses them for the
preview, and the server uses the same classification to validate.

## 5. Backend

### 5.1 Account creation and mode rules

- `getDefaultTrackingMode(type)` returns `investment` for `brokerage`, `retirement` and `crypto`;
  `balance_only` for `loan`; `cash_flow` otherwise.
- A new helper `defaultBalanceSource(trackingMode, { synced })` returns `provider` for an investment
  account created from an aggregator account the aggregator reports as an investment account, and
  `manual` for other investment accounts. `POST /api/accounts` and
  `POST /api/bank-accounts/adopt` both use it.
- **Adopt:** when the aggregator's raw type (`providerType`) is its investment type, the account
  becomes `investment` / `provider`, whatever FinanceOS type the user picked. Otherwise it keeps the
  type-based default; a brokerage-typed depository account becomes `investment` / `manual`.
- `PATCH /api/accounts/[id]` enforces:
  - `trackingMode` cannot move into or out of `investment` (400, "An account can’t be converted to
    or from an investment account").
  - `balanceSource` is only valid on investment accounts. It cannot be set to `provider` without an
    active aggregator connection, or changed away from `provider` while one exists (400).
  - The rules live in one guard in `src/lib/investments/account-guard.ts`, not in the route.

### 5.2 Source switches

- **Valued ↔ Manual:** history is kept. Valuation only runs for Valued accounts. Manual accounts
  keep a mirror holding of the latest entered balance (existing behaviour). On switching to Manual,
  the mirror is written from the latest stored balance, so current holdings and allocation show one
  line. On switching to Valued, the mirror stays until the first real holdings are saved (existing
  behaviour in `ValuationService`).
- Every switch runs under the investment refresh lock (`InvestmentRefreshService`), like other
  writes that change balances.

### 5.3 Entered balances API

Generalise `ManualHoldingService` (rename it `EnteredBalanceService`; update `services.ts`)
from manual-only to every investment account:

- `list(accountId) → { balances: AccountBalance[]; enterBefore: Date | null }`. Rows with source
  `manual`, newest first. `enterBefore` is null for Manual accounts.
- `record(accountId, { date, balance })`: an upsert on `(accountId, date)`. Refused (400) on or
  after `enterBefore`, and for future dates. It never overwrites a `synced` or `valuation` row:
  that can't happen before the cutoff, but it is still checked.
- `recordMany(accountId, rows)`: validates every row with `classifyPastBalances`, then writes the
  savable rows in one transaction. Returns `{ saved, skipped: { date, reason }[] }`.
- `delete(accountId, balanceId)`: only `manual` rows of that account.
- Manual accounts sync the mirror holding after each write (existing `sync`).
- Routes:
  - `GET /api/investments/accounts/[id]/balances` returns `{ balances, enterBefore }`.
  - `POST` takes `{ date, balance }` or `{ balances: { date, balance }[] }`.
  - `DELETE …/balances/[balanceId]` is unchanged.
- After writes the client refreshes the account list balance and the drawer.

The Investments page's existing Record balance window (Manual accounts) keeps working through the
same service.

## 6. Add from a connected institution

In the adopt window, when the aggregator reports the account as an investment account, show a note
under the type select:

> Your institution reports this as an **investment account**, so it will track a balance history,
> holdings and activity, and stay out of budgets and spending. Balance source: **Synced**.

## 7. Copy

Neutral wording only: "connection", "your institution", "market prices". No aggregator or market
data provider names outside integration code.

## 8. Error handling

- Balance writes: refusals arrive as `InvestmentInputError` → 400 with a readable message, which
  the section shows under its form (`role="alert"`).
- A paste with nothing to save: Save is disabled, so no request is sent.
- Account PATCH guard refusals show in the Edit Details section as today's save errors do.

## 9. Testing

- **Unit:**
  - `past-balances.ts`: every parse format and every classification status, including repeated
    dates, negative values and invalid calendar dates.
  - The account mode guard.
  - `defaultBalanceSource` and `getDefaultTrackingMode`.
  - `EnteredBalanceService`: the cutoff for each source, `recordMany` atomicity, delete scoping,
    mirror sync for Manual.
- **Components:**
  - `Drawer`: open and closed, Esc, focus.
  - Settings Accounts tab: clicking a card opens the drawer; clicking another swaps it; investment
    sections appear by source; Reconcile is hidden for investment accounts.
  - Paste flow: preview statuses, the Save count, and the request body.
- **Integration:**
  - Balances API (GET with `enterBefore`, single POST, batch POST, refusals).
  - Adopt and create defaults.
  - PATCH guard refusals.
  - A Valued → Manual switch keeps history and writes the mirror.
- Synthetic data only.
