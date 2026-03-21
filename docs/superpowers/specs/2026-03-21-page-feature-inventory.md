# FinanceOS Page Feature Inventory — Redesign Safety Net

> Every feature in the current app, documented as a checklist.
> Check off each item during implementation to ensure nothing is lost.

## Dashboard — Feature Inventory

### Net Worth Card (Conditional: when balanceData exists)
- [ ] Large formatted currency display with conditional color (green/red)
- [ ] Breakdown: Assets (green) + Liabilities (red)
- [ ] Top 5 Accounts by Balance (2-column grid, name + balance, "+X more" if >5)

### Main Stats Row (4 cards)
- [ ] Net Cashflow: large number, sparkline, % change indicator
- [ ] Income: large green number, % change
- [ ] Spending: large red number, sparkline, % change (inverted: down=good)
- [ ] Savings Rate: percentage, delta in pts

### Quick Stats Row (4 cards)
- [ ] Transaction Count
- [ ] Avg Daily Spend
- [ ] Top Merchant (truncated)
- [ ] 3-Month Savings Average

### Charts Row (2 columns)
- [ ] Income vs Spending area chart (monthly)
- [ ] Spending by Category pie chart (top 6, "Details →" link to /analytics)

### Bottom Row (3 columns)
- [ ] Top Categories: name, amount, % of total, MoM change badge, progress bar (amber if outlier)
- [ ] Top Merchants: numbered 1-5, name (truncated), amount
- [ ] Notable Changes: alert title, delta amount (green/red), sign prefix

### Goals Section (Conditional: goalsData.length > 0)
- [ ] Up to 4 goals with name, current/target, progress bar (green/red/blue by pace), percentage
- [ ] "View All →" link to /goals

### Pinned Insights (Conditional: pinned.length > 0)
- [ ] Grid of pinned chart specs

### States
- [ ] Loading: "Loading dashboard..."
- [ ] Empty: dashes/zeros in cards (no explicit empty state)

---

## Analytics Page — Feature Inventory

### Header
- [ ] "Monthly Analytics" title
- [ ] Future month warning banner (conditional)
- [ ] Base currency indicator badge (conditional)

### Month Selector
- [ ] ← Previous / Next → arrows (next disabled if future)
- [ ] Month button with dropdown picker (year nav + 4x3 month grid)
- [ ] Future months disabled in picker

### Summary Stats (3 cards)
- [ ] Total Spending with MoM change %
- [ ] Transaction count
- [ ] Avg per Transaction

### Pie Chart + Top Categories (2 columns)
- [ ] Spending distribution pie (top 10 + "Other")
- [ ] Top 6 categories list (ranked, with progress bars)

### Category Breakdown
- [ ] Groups sorted by total (descending)
- [ ] Expandable category rows with chevron
- [ ] Each row: name, transaction count badge, MoM change badge, amount
- [ ] Budget progress (conditional): "X% of budget", remaining/over, colored bar
- [ ] Expanded view: stats row, transaction table (date, merchant, account, amount)
- [ ] Offset indicator, linked transaction info, net amount calculation

### Edit Transaction Modal
- [ ] Date, Amount, Merchant, Category (grouped), Account (disabled), Note inputs
- [ ] Confidence Score display
- [ ] Transfer Status: mark/unmark toggle, status badge
- [ ] Linked Transactions: unlink button, link button, linked list
- [ ] Danger Zone: Delete Transaction button

### Link Transaction Modal
- [ ] Info box (type, merchant, amount, date)
- [ ] Suggested Matches (scrollable, match %, amount diff)
- [ ] Manual Search (input + search button)
- [ ] "Click to link" help text

---

## Transactions Page — Feature Inventory

### Tab Navigation
- [ ] Review | All | Subscriptions tabs

### Review Tab
- [ ] Sections: Uncategorized, Low Confidence, Unlinked Credits, Auto-categorized, Outliers
- [ ] Each section: title + count badge, transaction cards
- [ ] Auto-categorized section: "Approve All" button
- [ ] Transaction Review Card:
  - [ ] Merchant (with Split badge if split)
  - [ ] Date, confidence badge, linked/offset badges
  - [ ] Current category badge, pending category indicator (green arrow)
  - [ ] Amount (right-aligned)
  - [ ] Current note display (conditional)
  - [ ] Category select dropdown (grouped) + confirm button
  - [ ] Note input
  - [ ] Unlink/Link buttons (conditional)
  - [ ] Green border when pending changes
- [ ] Submit All Changes card (conditional): summary text + submit button

### All Transactions Tab
- [ ] Bulk Edit Bar (conditional: when selections exist)
  - [ ] Selection count, category apply, tag add/remove, delete, clear
- [ ] Transaction Table
  - [ ] Checkbox column (header select all)
  - [ ] Date, Merchant (with offset ↩, split badge, linked info, note, tags), Category (transfer/linked/uncategorized badges), Account, Amount
  - [ ] Row colors: blue=transfer, purple=offset, green=income, red=expense
  - [ ] Net amount display for offset transactions
- [ ] "+ New Transaction" button

### Create Transaction Modal
- [ ] Date, Amount (with +/- guidance), Account (required), Merchant (required), Category, Note, Tags
- [ ] "Use negative amounts for expenses" helper

### Edit Transaction Modal (same as Analytics + Split features)
- [ ] Split Transaction button (conditional)
- [ ] Split Context section (conditional): original amount, split parts list, unsplit button

### Subscriptions Tab
- [ ] SubscriptionsTab component

---

## Reports Page — Feature Inventory

### Tab Navigation
- [ ] Net Worth | Cash Flow | Monthly tabs

### Net Worth Tab
- [ ] NetWorthSnapshots component

### Cash Flow Tab
- [ ] Summary cards (4): Avg Income, Avg Spending, Avg Savings, Avg Rate (conditional colors)
- [ ] Monthly Detail table:
  - [ ] Month range navigation (← range →)
  - [ ] "Backfill Historical" button
  - [ ] Sticky left column with row labels
  - [ ] 12 month columns (scrollable)
  - [ ] Rows: Income (green), Spending (red), Savings (conditional), Rate (conditional, bold)
- [ ] Backfill Modal: year select, month select, income input, spending input

### Monthly Detail Tab
- [ ] Month selector dropdown (last 24 months)
- [ ] Summary cards (3): Cash In (green), Cash Out (red), Savings Rate (conditional)
- [ ] Category Breakdown Grid (responsive 1-5 columns):
  - [ ] Group cards with name, total amount (green/red), subcategory list
  - [ ] "No transactions this month" empty state per group

---

## Goals Page — Feature Inventory

### Header
- [ ] "Goals" title + "New Goal" button

### Tab Navigation
- [ ] Active | Completed | Archived (URL param)

### Goal Cards (2-column grid)
- [ ] Goal name (truncated)
- [ ] Tracking label (category/tag/account)
- [ ] Type badge: Spending (red) or Saving (green)
- [ ] Current/Target amounts
- [ ] Progress percentage + progress bar (green=ahead, blue=on_track, red=behind)
- [ ] Date range display
- [ ] Pace status badge (conditional)
- [ ] Remaining amount
- [ ] Click to edit

### Goal Form Modal
- [ ] Name input
- [ ] Type buttons: Spending / Saving
- [ ] Target Amount input
- [ ] Track By: Category / Tag / Account (conditional dropdown)
- [ ] Timeframe: Year / Quarter / Custom / Open-ended (conditional date inputs)
- [ ] Status select (edit mode only)
- [ ] Delete button (edit mode only, red)
- [ ] Cancel / Create or Update buttons

### Empty State
- [ ] Message varies by tab ("No active goals yet..." / "No [status] goals.")
- [ ] "Create Your First Goal" button (active tab only)

---

## Settings Page — Feature Inventory

### Tab Navigation (8 tabs)
- [ ] General | Accounts | Categories | Rules | Budgets | Import | Tags | Sync

### General Tab
- [ ] Base Currency select (USD/CAD/EUR/GBP with flags)
- [ ] Exchange Rates table (from, to, rate, last updated, delete) + add form
- [ ] Inflation Rates table (year, rate, last updated, delete) + add form

### Accounts Tab
- [ ] Drag-and-drop sortable account cards (dnd-kit)
- [ ] Account card: name, type badge, institution, balance, drag handle
- [ ] Connected account indicators (Plaid/Teller)
- [ ] Account modal: name, type, institution, currency, balance (read-only), transaction count, tracking mode, invert amounts toggle
- [ ] Plaid/Teller section: institution, last sync, sync/preview/reconnect/disconnect buttons
- [ ] Preview modal: date range, stats, transaction list
- [ ] Reconcile balance section: target input, reconcile button, difference calc
- [ ] Archive/Restore, Delete, Save buttons
- [ ] Sync All modal: account selection, days input, preview, per-account status, confirm

### Budgets Tab
- [ ] View selector (all months / specific month)
- [ ] Default budgets + monthly overrides
- [ ] Budget table: category, limit, spent, remaining
- [ ] Add form: category select, limit input
- [ ] Edit/delete per row, override badges

### Categories Tab
- [ ] Groups by type (Income/Expenses/Transfers)
- [ ] Group creation form
- [ ] Nested category list with edit/delete
- [ ] Add category form (name, parent group)
- [ ] Category detail modal: name, type, recent transactions, unclassify all, delete

### Import Tab
- [ ] File upload (drag-and-drop / input)
- [ ] Column mapping interface (auto-detect + manual override)
- [ ] Account select (required)
- [ ] Invert amounts toggle
- [ ] Preview table
- [ ] Import summary: created, skipped, auto-categorized, uncategorized, transfers

### Rules Tab
- [ ] RulesTab component

### Tags Tab
- [ ] Tag list with colors + transaction counts
- [ ] Add form (name, color picker)
- [ ] Edit/delete per tag

### Cloud Sync Tab
- [ ] SyncSettings component
- [ ] Sync ID display + copy
- [ ] Passphrase management
- [ ] Push/Pull buttons
- [ ] Auto-sync toggle
- [ ] Sync history

---

## Side Navigation

- [ ] Logo
- [ ] 6 main nav links with active highlighting
- [ ] Expandable submenus for Transactions (3), Reports (3), Settings (8)
- [ ] Auto-expand for current page
- [ ] Finance Analyst button with ⌘K shortcut (conditional)

---

## Cross-Cutting Concerns

### Responsive Breakpoints
- [ ] Mobile: single column
- [ ] md: 2 columns
- [ ] lg: 3-4 columns
- [ ] xl: 5+ columns for dense layouts
- [ ] Table horizontal scroll on mobile

### Loading States
- [ ] Suspense fallbacks per page
- [ ] "Loading..." text in lists
- [ ] "Saving..." button states
- [ ] Spinner animations

### Empty States
- [ ] Per-section empty messages
- [ ] CTA buttons where appropriate

### Error Handling
- [ ] Alert dialogs for failures
- [ ] Confirmation dialogs for destructive actions
- [ ] Disabled buttons when invalid
- [ ] Inline validation

### Data Formatting
- [ ] Currency: $, thousand separators, 2 decimal places
- [ ] Percentages: with % suffix
- [ ] Dates: localized display
- [ ] Amounts: negative=expense (red), positive=income (green)
- [ ] Confidence: score * 100 as percentage
