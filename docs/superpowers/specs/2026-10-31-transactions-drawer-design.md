# Transactions: edit in a push drawer with autosave

**Status:** design approved (mocks) · 2026-10-31
**Mock:** `~/Documents/FinanceOS-design-archive/design-mocks/transactions-drawer-autosave.html` (approved). Earlier explorations: `transactions-drawer.html`, `transactions-drawer-actions.html`.

## Goal

Replace the Transactions page's four modals (edit, create, link, split) with one right-side push drawer, the same pattern as Settings → Accounts. Editing autosaves so the user can work through many transactions quickly. This is a **reorganization**: every capability below already exists in the page or API today; nothing new is stored and no API changes.

## What exists today (and where it moves)

| Today (modal) | Drawer |
|---|---|
| Edit modal → Transaction Details: date, amount, merchant, category, read-only account, note, tags, Save Changes | **Details** section, autosaved. Account moves to the header subtitle. |
| Edit modal → Transaction Info: confidence score, "Created" (actually shows the transaction date) | **Categorization** row showing confidence only. "Created" is dropped (it duplicated the date). |
| Edit modal → Transfer Status: Mark / Unmark as Transfer | **Transaction \| Transfer** switch at the top of Details. |
| Split Transaction button → split modal (rows of amount, category, note; must add up) | **⑂ Split** button beside Category → inline split editor. |
| Edit modal → Split context on a part: all parts + Unsplit (`window.confirm`) | **Part of a split** box under Category, Unsplit with inline confirm. |
| Edit modal → Linked Transactions → Link modal (suggested matches, manual search), Unlink, View Original | **Refunds & paybacks** section with matches and search inline. |
| Review card "🔗 Link Transaction" → Link modal | Opens the drawer on that transaction with the matches already showing. |
| Delete Transaction (`window.confirm`) | **Delete transaction** at the bottom of the drawer, inline confirm. |
| "+ New transaction" → create modal | The same drawer in "new" mode, explicit **Add transaction**. |

## Layout

The drawer pushes the page (`DRAWER_PUSH_CLASS`) at ≥1100px and overlays below that, like the account drawer. While it is open the table hides the Account column and highlights the open row.

**Header:** merchant (title), `date · account` (subtitle), the signed amount below in mono (green when positive). Right side: `N of M` counter, a bordered pair of chevron buttons (previous / next, disabled at the ends, tooltips "Previous · ↑" / "Next · ↓"), a thin divider, then a bordered close button (tooltip "Close · Esc").

**Body, top to bottom:**

1. **Save status**, right-aligned above the Details card: `Editing…` → `Saving…` (spinner) → `✓ Saved`; `Couldn't save · Try again` on failure; `Merchant can't be empty · not saved` when invalid.
2. **Details** card
   - Transaction | Transfer switch. Transfer adds the hint "Money moving between your own accounts, like a card payment." and, under Category, "Transfers are left out of spending totals, so the category isn't counted."
   - Date · Amount (two columns), Merchant, Category (+ ⑂ Split), Note, Tags (`TagInput`).
3. **Refunds & paybacks** card: hidden when the transaction is a transfer (as today).
4. **Categorization** card: `N% confident`.
5. **Delete transaction**: a quiet button at the very bottom; hidden on split parts.

New mode shows Account (required) · Date · Amount · Merchant · Category · Note · Tags, with a footer of **Cancel** and **Add transaction**. No paging, status, or other sections.

## Autosave

- **Debounce:** merchant, amount, note and date save 700 ms after the last keystroke (a hand-typed date passes through years like 0002 and 0020 on its way). Category, tags and the Transaction | Transfer switch save immediately.
- **Only changed fields are sent.** The PATCH route sets `confidenceScore = 1.0` whenever `categoryId` is present, so sending the whole form (as the old Save did) would mark a category confirmed just because the note changed.
- **One request at a time.** Edits made during an in-flight save are merged into the next request; the latest values win.
- **Flush before leaving.** Paging, clicking another row, closing, or opening New transaction first flushes any pending save. If that flush fails the drawer stays on the transaction and shows the error, so edits are never silently dropped.
- **Validation (client, before sending):** merchant must not be blank; amount must parse to a finite number. Invalid values are not sent; the field turns red and the status explains.
- **Failure:** status shows `Couldn't save · Try again`; retry resends the pending changes.
- **Refreshing data:** after a field save, the row in the page's list is updated in place from the PATCH response (no full reload per keystroke). Structural actions (transfer switch, split, unsplit, link, unlink, delete, create) and closing the drawer call the existing `refreshTransactionsAndQueue()`. Every successful write calls `triggerSync()`, as today.
- No Discard and no ⌘S.

## Split

- **⑂ Split** shows only when splitting is allowed today: not a split part, not linked, no linked offsets (the split API rejects those).
- Editor: a coloured bar showing each part's share; rows of category select, amount, ✕ (min two rows) and a note input under each; `+ Add a part`; `Adds up to <total> ✓` or `$X left to assign` / `$X too much`. **Cancel** and **Save split** (disabled until it adds up) — splits are not autosaved because a half-entered split is invalid. Amounts are entered unsigned and given the original's sign, as today. Calls `POST /api/transactions/split`.
- On a **split part**: Category, note, tags, date and merchant autosave as normal. **Amount is read-only** with the hint "Unsplit to change amounts" (the PATCH route rejects part amounts that break the sum). The **Part of a split** box shows the bar, every part (this one emphasised) with category, note and amount, and `Unsplit · restore the original` → inline "Remove the parts and restore the original? Keep / Unsplit" → `POST /api/transactions/unsplit`, then the drawer opens the restored transaction.

## Refunds & paybacks

Same data and API as today (`isOffset`, `linkedTransactionId`, `/api/transactions/[id]/returns`).

- **Nothing linked:** a hint plus `+ Link a refund or payback` (or `+ Link to a purchase` for a credit). Clicking it loads `GET …/returns` and shows **Suggested matches** inline (merchant, date, "N days before/after", amount, % match, amount difference when > $0.01, **Link**) and the existing merchant search (`/api/transactions?merchant=…&preset=last-12-months`, excluding itself and already-linked rows). `Cancel` collapses it.
- **Linking keeps today's semantics:** `POST /api/transactions/<open transaction>/returns { originalTransactionId: <chosen> }`. (Known quirk, intentionally unchanged: linking from the purchase side marks the purchase as the offset.)
- **This is an offset** (`isOffset`): the original as a mini card, "↑ paid back by this", this one; **Open the original** (switches the drawer to it) and **Unlink**.
- **This has offsets:** this one, then each offset with "↑ paid back by" and its own **Unlink**; a **Net** line (amount + sum of offsets, same formula as the table).

## Delete

At the bottom: `Delete transaction` → inline "Delete this transaction for good? Keep it / Delete" → `DELETE /api/transactions/[id]`. Afterwards the drawer opens the next row (or the previous one at the end; closes if none). Hidden on split parts (the route refuses them).

## Paging and keys

- Previous/next step through the **rows currently shown** in the active view, in display order (All tab: the table; Review tab: the queue cards in order).
- ↑ / ↓ page only when focus is not in an input, textarea or select. Esc closes (the shared `Drawer` already ignores Esc while a modal is open).

## Components

- `src/components/ui/drawer.tsx`: add optional `actions` (rendered before close), `headerExtra` (under the subtitle — the amount), and `footer` props; `subtitle` accepts a node. Restyle the close button to the bordered square from the mock. The account drawer picks up the new close button for free.
- `src/components/transactions/` (new):
  - `types.ts`: `Tx`, `Category` moved out of the page.
  - `use-autosave.ts`: the debounce / diff / serialize / flush / retry hook; returns `{ status, error, edit(fields, { immediate }), flush(), retry() }`.
  - `transaction-drawer.tsx`: header, nav, and section composition for edit and new modes.
  - `drawer-nav.tsx`, `save-status.tsx`, `details-section.tsx`, `split-editor.tsx`, `split-summary.tsx`, `refunds-section.tsx`, `delete-zone.tsx`, `new-transaction-form.tsx`.
- `src/app/(routes)/transactions/page.tsx`: delete the four modals and their state and handlers (`editModalOpen`, `splitModalOpen`, `returnModalOpen`, `createModalOpen`, `splitParts`, `potentialMatches`, …); hold `{ mode: 'edit' | 'new', id }` instead; wire row clicks, review cards, the review-card Link button and "+ New transaction" to the drawer.

## Testing

- **Unit (`use-autosave`, fake timers):** debounce timing; immediate fields; only changed fields in the body; a category-free edit never sends `categoryId`; serialization with edits during an in-flight save (latest wins, one request at a time); flush resolves before navigation; failure → error → retry resends; invalid merchant / amount not sent.
- **Component (Testing Library, mocked fetch):** paging order, disabled ends and ↑/↓ ignored while typing; Transaction | Transfer PATCHes `isTransfer` and hides Refunds; split editor sum states and Save split payload signs; split part shows read-only amount, no Delete, Unsplit confirm; Refunds states (none / offset / has offsets with Net) and Link posting today's payload; Delete confirm then next row; New mode requires account and merchant.
- Existing integration tests for the split, unsplit, returns and PATCH routes still pass unchanged.
- E2E is not run locally (it uses the real `dev.db`).

## Out of scope

Showing or choosing the other side of a transfer; automatic refund suggestions; storing how a transaction was categorized; changing the purchase-side linking quirk; bulk editing; transfer chips (Plan 4c).
