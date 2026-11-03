# Travel: trips, a yearly view and the travel budget

**Status:** design approved in brainstorm (mocks) · 2026-11-02
**Mock:** `~/Documents/FinanceOS-design-archive/design-mocks/travel-trips.html` (v3, approved; has a light/dark toggle). Earlier rounds are in `.superpowers/brainstorm/` (`trips-overview.html`, `trips-v2.html`).

## Why

Travel is a large part of the user's life, and today trips are tracked with tags. Of the 9 tags, 7 are trips ("2026 - Whistler", …). That has three problems:

1. **Tagging is one transaction at a time.** Flights and lodging are booked 2 weeks to 4 months early, and friends' settle-ups and refunds arrive up to 3 weeks after the trip, so finding a trip's transactions means hunting.
2. **The tag list grows with every trip**, crowding out the tags that aren't trips.
3. **Analysis goes through the Finance Analyst.** The user asks it things like "compare the costs of my trips this year, with a category breakdown of each". That should be built in.

The user also keeps a yearly travel budget as a Goal ("2026 Travel Budget", $10,000, which counts the Travel category group). It belongs with the trips.

## What the data showed (dev.db, Nov 2025 – Oct 2026)

- Trip tags cover 227 transactions on 7 trips. 94% of that spend is in the Travel category group (Flights, Lodging, Drinks and Food, Transportation, Other).
- Inside a trip's dates, about a third of the transactions are not trip spending: salary, gym, subscriptions, groceries at home. **Dates alone are not enough.**
- There are $2.2k of Travel-category transactions on no trip. The user says these are small trips they didn't bother tagging.
- Paying friends (e.g. "Adrian Fekete 'Whis'" −$1,280) is categorized as Lodging or Food. The app cannot tell that money went to a friend.

## Goals

- A **trip** is a first-class thing: name, start and end dates, optional note. It replaces trip tags.
- **Adding transactions to a trip is a review, not a hunt.** The app suggests candidates with fixed, explainable rules, and the user ticks them. Nothing is added automatically.
- A **Travel page**: the year's trips, cost per day, totals, where the money went, and the travel budget, with a year-over-year comparison.
- A **trip page**: totals, per day, booked ahead, money back, the category breakdown and every transaction, each one editable through the shared transaction drawer.
- The **travel budget is owned by Travel**: created, changed and prompted for there.

## Non-goals

- Side-by-side trip comparison. The user said "not too much comparison side by side"; one yearly list is enough.
- Automatically assigning transactions to trips (no AI, no auto-add).
- Detecting money paid to friends.
- Moving Analytics from its modal to the shared transaction drawer. That's a follow-up, but it's the same principle (see Constraints).
- Other time ranges in Analytics, and spend in one category across many periods. Those are the user's other two ideas, to be brainstormed separately.

## Anti-goals

- A **read-only** transaction list. If the user sees a wrong row, they must be able to fix it right there.
- A new colour palette. Use only the existing design tokens (`src/app/globals.css`, light and `.dark`).
- Nagging. The budget prompt must be easy to put off.

## Constraints

- **One transaction editor.** Every transaction row in Travel opens the existing `TransactionDrawer` (`src/components/transactions/transaction-drawer.tsx`), the same component the Transactions page uses, fully editable, with ‹ › stepping through the list being shown. No bespoke editor and no modal.
- Push drawers over modals (the existing `Drawer`, `DRAWER_PUSH_CLASS`). The trip drawer is a push drawer.
- Design tokens only, and it must work in light and dark.
- Schema changes go through `prisma db push`, not `migrate dev` (migrate fails with P3006 on this repo).
- **Cloud sync exports and imports each table explicitly** (`src/lib/cloud-sync/sync.ts`, `types.ts`). Every new table and column must be added to export, import and the Zod payload schema, or it is silently lost on another device.
- Vendor-neutral naming: no bank or aggregator names in domain code.
- Amounts: negative = spend, positive = money in. Dates are stored in UTC.
- **Currency** *(my call)*: every Travel total (trip totals, per day, category bars, the budget) converts to the base currency the way Analytics does (`src/lib/analytics.ts`, `convertAmount`). 27 of the 227 trip transactions are on CAD accounts.
- **Net, not gross** *(my call)*: every Travel figure, including the budget, is spend net of money in. A $72 payback on a trip lowers the trip total and the budget's spent figure by $72. This differs from tag goals today, which add absolute values.
- PR against `main`; no stacked PRs.

## Naming

- The page and nav item are **Travel** (`/travel`). The individual items are **trips** ("+ New trip").
- In the side nav, Travel goes after Analytics.

## Data

- **Trip:** id, name, startDate, endDate (inclusive, calendar days), note (optional), createdAt.
- **Transaction → trip:** each transaction belongs to **at most one** trip, via a nullable trip reference on Transaction. Deleting a trip clears it from its transactions; the transactions themselves are kept.
- **Dismissed suggestions:** the (trip, transaction) pairs the user left unticked in a review, so they are not suggested again for that trip.
- Split transactions: the parts are what get assigned and counted, never the split parent (the same rule as goals: `isSplitParent: false`).

## Converting the existing trip tags

A one-time conversion:

1. A tag is a trip when its name matches `^\d{4} - ` *(my call; it matches exactly the 7 trip tags in dev.db and neither of the others)*: "2026 - Austria/Italy", "2026 - Bayfield", "2026 - California", "2026 - Costa Rica", "2026 - Miami", "2026 - Mt Tremblant" and "2026 - Whistler". Each becomes a trip and its transactions are assigned to it. The "2026 - " prefix is dropped from the trip name.
2. A trip's dates come from its own Travel-category spending, excluding Flights and Lodging, since those are booked early. If it has none, they come from all of its transactions. This is a first guess, and the trip page shows "Check these dates" until the user confirms or edits them.
3. **Safety** *(my call)*: the conversion copies `dev.db` to a timestamped backup first, is idempotent (a second run changes nothing), and prints a dry-run summary (trips, counts, guessed dates) before it writes.
4. The converted tags are removed from those transactions and deleted. Non-trip tags (Green Card, Tax Deductable) are untouched.

Goals tracking a converted tag: none exist today, but the conversion must not leave a dangling `tagId`.

## Suggestions (step 2 of creating a trip, and "Review suggestions")

Candidates are transactions that are **not on any trip**, are not transfers between the user's own accounts, are not split parents, and haven't been dismissed for this trip. They come in groups, in this order:

| Group | Rule | Pre-ticked? |
|---|---|---|
| **Booked before** | Flights or Lodging, dated in the 4 months before the start date | Yes |
| **During** | Travel-category group, dated start–end | Yes |
| **Other spending during the trip** | any other spending dated start–end, except recurring things (income, subscriptions/recurring transactions) | No |
| **After** | in the 3 weeks after the end date: money coming in (positive amounts, excluding income-type categories and recurring transactions), plus Travel-category spending (late charges like a rental car bill, settle-ups like Anthony "Bills" −$165, which is filed under Drinks and Food) | Yes |

Each row shows the merchant, date, category, amount and why it is suggested (e.g. "46 days before"). The footer button reads **Add N transactions**, where N is the number ticked. Rows left unticked are recorded as dismissed for that trip.

**"Review suggestions · N"** on the trip page opens the same list with only the current candidates. N is the number of candidates: anything not yet added or dismissed. The button is hidden when N is 0.

Nothing is ever added without the user ticking it.

**When trip dates are edited** *(my call)*: dismissals stay dismissed and assigned transactions stay assigned. The trip page groups each transaction by its date against the current dates: before the start is Before, after the end is After.

## Travel page (`/travel`, mock A)

- **Header:** "Trips" caption, the year as the title, a year chip (‹ 2026 ▾ ›) that works like the Analytics month picker but for years, and **+ New trip**.
- **Three cards:**
  - **Travel budget:** spent, the target, a bar (red when over) and "$X over" or "$X left". If the year has no budget, the card offers to set one.
  - **Trips:** the count of trips starting that year and their total days.
  - **vs last year:** this year's budget-spent figure (trips + not on a trip, as above) against the previous year's, or "—" with a note when there's no previous year of data.
- **Trip list, biggest total first.** Columns: Trip, Dates, **Where it went**, Per day, Total.
  - Where it went is a split bar of the trip's categories, biggest first, in **one hue at decreasing strength**: the darkest shade is that trip's biggest category. A legend underneath names the top three with their percentages. Hover shows a segment's category and amount.
  - Per day = total ÷ days (inclusive).
  - Clicking a row opens the trip page.
- **"Not on a trip" row** below the trips: Travel-category spending that year on no trip, with its total and count. It opens a list whose rows open the transaction drawer.

## Trip page (`/travel/[id]`, mock C)

- **Header:** a "Trips · 2026" caption, the name, dates and day count, **Edit trip**, and **Review suggestions · N** when N > 0.
- **Four cards:**
  - **Total:** net of money in, with the transaction count.
  - **Per day:** with the year's average per day across trips.
  - **Booked ahead:** spend dated before the start date.
  - **Money back:** the sum of positive amounts on the trip, with the count and "already taken off the total".
- **By category:** a list with bars in the same tonal scale, biggest first.
- **Transactions:** the same columns as the Transactions table (Date, Merchant, Category, Amount), grouped into **Before / During / After** by date against the trip's dates. A row click pushes in the shared transaction drawer. The open row is highlighted, and ‹ › step through this trip's transactions in display order.

## Trip drawer (mock B)

One push drawer for **New trip** and **Edit trip**.

- **Step 1, Details:** Name, Leave and Return dates, an optional Note. Cancel / Next: find transactions. A trip can be created before the trip, and transactions are then suggested as they arrive.
- **Step 2, Add transactions:** the suggestions list above.
- **Edit trip** opens step 1 filled in, with **Delete trip** at the bottom. It uses the same inline-confirm pattern as Delete transaction, and deleting keeps the transactions.

## Transaction drawer change

`DetailsSection` gains a **Trip** field: a select of trips, most recent first, plus "None". It saves immediately, like category and tags. This is how a transaction joins or leaves a trip from anywhere, including the Transactions page and the review queue.

## Travel budget

**Travel owns it.** It is still stored as a `Goal`, so goal progress and pace come from one place (`src/lib/goals.ts`).

- **Which year spending belongs to (decided with the user): by trip.** A trip belongs to the year it **starts** in, and all of its transactions count in that year, whatever their dates. That includes flights booked the previous December and settle-ups in the next January. Travel-category spending on no trip counts in the year it happened. So the page adds up: budget spent = sum of that year's trip totals + "Not on a trip". A booking made before its trip exists counts in its own year under "Not on a trip", and moves to the trip's year once it is added to the trip. Only the travel budget works this way. Analytics, Goals' other methods and Reports keep counting by transaction date.
- **What it counts:** every transaction on a trip that starts in the budget's year **plus** every Travel-category transaction on no trip dated in that year, each counted once. So lazy small trips still count through their category, and trip spend outside the Travel categories (green fees, a spa) counts through the trip. This needs a new tracking method for goals; it can't be expressed as category, tag or account.
- **Where it is managed:** created and edited only from the Travel page's budget card, as one budget per calendar year: amount only, dates fixed to the year. The Goals page still lists it so all goals show together, marked "Managed in Travel" with a link, and it can't be edited there.
- **The existing "2026 Travel Budget"** (category tracking, Travel group) moves to the new tracking method during the conversion, so the Travel page picks it up.
- **The yearly prompt:** when the current year has no travel budget, a slim app-wide banner says "Set your <year> travel budget" and links to Travel. **Not now** hides it for 14 days. It disappears once a budget exists. The Travel page's budget card keeps offering until it's set.

## Finance Analyst

The analyst's `queryTransactions` tool currently filters by tag. It must also filter by trip, and it needs a way to list trips, so the question it answers today keeps working once trip tags are gone.

## Left to the builder

- API shape, file layout, component split, and whether the trip list and the trip page share loaders.
- Exactly how the conversion runs: a script, or on first visit to Travel. It must be idempotent and must go through sync.
- How the year chip's picker is shared with Analytics: extract it or copy the pattern. DRY is preferred.
- How the shades are generated from `--accent` (the mock uses `color-mix`).
- Empty states: no trips in a year, a trip with no transactions.

## Testing

- **Unit:**
  - the suggestion rules: each group's window and categories, and the exclusions (already on a trip, dismissed, transfers, split parents);
  - per-day and total maths, Money back, booked ahead;
  - the budget's counting rule, including no double counting of a trip transaction in a Travel category;
  - tag conversion and its date guess.
- **Component:**
  - the trip drawer steps, Add N, and that unticked rows are dismissed;
  - the review button's count and that it hides at 0;
  - a trip page row opens the shared transaction drawer;
  - the Trip field in the transaction drawer saves immediately;
  - the Goals page shows the travel budget as managed in Travel.
- **Integration:** sync round-trip includes trips, assignments and dismissals.
