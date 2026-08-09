# Planned Payments — Design Spec

**Date:** 2026-05-03
**Status:** Draft, awaiting user review
**Implements:** new `/transactions?tab=planned` surface plus dashboard forecast widget plus Analytics "Reserved" section

---

## 1. Problem

Annual and other irregular obligations (credit-card fees, property tax, insurance premiums, Costco membership, holiday gifts) cause two real pains today:

1. **Surprise** — they hit without enough advance warning to feel comfortable.
2. **Budget distortion** — the month they land looks blown out in the Analytics budget view, even though the spend was anticipated.

The existing `RecurringTransaction` model can detect annual cadences but only after ≥2 historical occurrences, and it doesn't influence the budget view at all. There's no way to manually plan for a known future charge, no forecast surface, and no smoothing of large irregular charges across the months between them.

## 2. Conceptual frame

This is **not** an "annual bills" feature. It is a **Planned Payments** tracker — a record of known future financial obligations regardless of cadence (annual, quarterly, semi-annual, irregular, one-off). Frequency is a forecasting hint, not a constraint.

Three layers, each independently removable:

1. **Core (always in):** `PlannedObligation` model + management UI at `/transactions?tab=planned` + the linking layer that binds real transactions to obligations.
2. **Forecast layer (rip-out-able):** dashboard widget showing "next 90 days of planned charges."
3. **Accrual layer (rip-out-able):** virtual "Reserved" smoothing section on the Analytics page.

Relationship to existing `RecurringTransaction`: kept separate. A planned obligation can be promoted from a recurring entry via a one-way, non-destructive bridge. The two models stay distinct — `RecurringTransaction` is detection metadata, `PlannedObligation` is user-curated planning.

## 3. Data model

Two new Prisma models. Both clean and self-contained so removal is a focused migration.

### 3.1 PlannedObligation

```prisma
model PlannedObligation {
  id                    String    @id @default(uuid())
  name                  String    // Display name, e.g. "Amex annual fee"
  accountId             String
  account               Account   @relation(fields: [accountId], references: [id], onDelete: Cascade)
  categoryId            String?
  category              Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  // Cadence — frequency is a forecasting hint, not a constraint
  frequency             String    // "monthly" | "quarterly" | "semiannual" | "annual" | "irregular" | "oneoff"
  expectedMonth         Int?      // 1-12, null for monthly/irregular
  expectedDayOfMonth    Int?      // 1-31, optional — refines forecast if known
  nextExpectedDate      DateTime? // Computed and cached on write

  // Amount — single estimate, history accumulates from linked txs
  expectedAmount        Float     // Latest estimate (defaults from last linked tx)
  amountHistory         String    @default("[]") // JSON: [{ date, amount, transactionId? }]

  // Accrual layer (rip-out-able by setting all to false)
  accrualEnabled        Boolean   @default(true)

  // Lifecycle
  status                String    @default("active") // "active" | "paused" | "archived"

  // Provenance — for observability, not behavior
  sourceRecurringId     String?   // Set when promoted from a RecurringTransaction
  sourceTransactionId   String?   // Set when created from a single transaction

  notes                 String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  links                 PlannedObligationLink[]

  @@index([accountId])
  @@index([status])
  @@index([nextExpectedDate])
}
```

### 3.2 PlannedObligationLink

Join row binding a real transaction to a planned obligation. Every downstream consumer (Reserved bucket math, obligation history view, dashboard widget) reads only from this table — no consumer cares how the link was created.

```prisma
model PlannedObligationLink {
  id              String              @id @default(uuid())
  obligationId    String
  obligation      PlannedObligation   @relation(fields: [obligationId], references: [id], onDelete: Cascade)
  transactionId   String              @unique // A tx fulfills at most one obligation
  transaction     Transaction         @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  linkSource      String              // "manual" | "auto" (future) | "promoted"
  createdAt       DateTime            @default(now())

  @@index([obligationId])
}
```

### 3.3 Schema notes

- `frequency` enum includes `"irregular"` and `"oneoff"` so the model isn't restricted to clean cadences.
- `expectedMonth` is nullable because monthly obligations don't need it.
- `transactionId @unique` on the link table prevents accrual double-counting; can relax later if a real use case emerges.
- Back-relations (`PlannedObligation[]` on `Account`, `Category`, `Transaction`) get added; nothing breaking.

## 4. Linking strategy architecture

The point of this section is the modularity: ship with manual-link only; auto-match drops in later with no consumer rewrites.

### 4.1 Interface

`src/lib/planned/linking.ts`:

```ts
export interface ObligationLinkingStrategy {
  name: string;
  match(tx: Transaction, obligations: PlannedObligation[]): LinkSuggestion[];
}

export interface LinkSuggestion {
  obligationId: string;
  source: 'auto' | 'promoted';
  confidence?: number;
}
```

### 4.2 Default: ManualOnlyStrategy

`match()` returns `[]`. Links are only created via explicit user action through the API.

### 4.3 Future: MerchantMonthAmountStrategy

Drops in later. Implements `match()` by comparing merchant pattern, expected month, and amount range. No consumer changes needed when swapping.

### 4.4 Configuration

`src/lib/planned/config.ts` exports `getActiveLinkingStrategy()`. Today returns `new ManualOnlyStrategy()`. Switching strategies is a one-line change.

### 4.5 Strategy invocation

After a transaction is created (CSV import, manual create, bank sync), call `applyLinkingStrategy(prisma, tx)`. The helper fetches active obligations, calls the active strategy's `match()`, and writes any returned suggestions as links. Strategies stay pure — they return suggestions, they don't write.

The hook is wired into all three create paths in v1 even though `ManualOnlyStrategy` makes it a no-op, so swapping the strategy later requires no consumer changes.

### 4.6 Manual link API (always available)

- `POST /api/planned/[id]/links` — body `{ transactionId }`, creates a link with `linkSource: "manual"`.
- `DELETE /api/planned/[id]/links/[transactionId]` — removes the link.

These work regardless of the active strategy.

## 5. Accrual computation

Lives in `src/lib/planned/accrual.ts`. Pure function over the obligation, link, and transaction tables. No persistent state.

### 5.1 Core function

```ts
computeReservedForMonth(
  obligations: PlannedObligation[],
  links: PlannedObligationLink[],
  transactions: Transaction[],
  month: string  // "YYYY-MM"
): ReservedSummary
```

### 5.2 Per-obligation cycle math

For each obligation with `accrualEnabled = true` and `status = "active"`:

1. **Determine the current cycle** — the window between the previous occurrence and the next expected occurrence, derived from `frequency` and `nextExpectedDate`. Annual due Feb 2026 → cycle is Mar 2025 → Feb 2026 (12 months). Quarterly due May → Mar–May (3 months). Monthly: cycle is just the current month.
2. **Per-month accrual rate** = `expectedAmount / monthsInCycle`.
3. **Months elapsed in cycle** as of `month` = inclusive count from cycle start through `month`.
4. **Accrued so far** = `perMonthRate × monthsElapsed`.
5. **Drawdown** = sum of absolute amounts of linked transactions that fall within the current cycle.
6. **Reserved balance** = `max(0, accrued − drawdown)`.

### 5.3 Output shape

```ts
type ReservedSummary = {
  month: string;
  totalReserved: number;
  perObligation: Array<{
    obligationId: string;
    name: string;
    accruedThisCycle: number;
    drawdownThisCycle: number;
    reservedBalance: number;
    nextExpectedDate: string | null;
  }>;
};
```

### 5.4 Behavior decisions

- **Back-accrual on creation:** creating an obligation mid-cycle immediately reflects accrued-to-date. Setting up the Amex annual fee in November (due Feb) shows ~$90 reserved that month (10 of 12 months × $10/mo). Makes the feature useful immediately rather than requiring a year of data.
- **Drawdown floors at 0:** an actual charge larger than `expectedAmount` does not push the bucket negative. The overrun is already visible as a real charge in its real category in Analytics; pushing Reserved negative would double-count it. The system self-corrects via `amountHistory` — next year's `expectedAmount` updates to the actual amount.
- **Surplus stays in the bucket** until the cycle resets. (Optional future enhancement: roll surplus into next cycle's accrual.)
- **One-off obligations** auto-archive once linked.
- **Real charges still land in real categories.** The Reserved section is purely additive — a parallel view, not a modification of per-category numbers.

### 5.5 Consumed by

- `GET /api/planned/reserved?month=YYYY-MM`
- The Analytics "Reserved" section (parallel to per-category budget breakdown)

## 6. UI surfaces

### 6.1 Planned tab — `/transactions?tab=planned`

New component `src/components/planned-tab.tsx`, mirroring the structure of `subscriptions-tab.tsx`.

Layout:
- Header row: total monthly accrual estimate, count of active obligations, "+ Add planned payment" button.
- Filter strip: status (active/paused/archived), account, frequency.
- Table columns: name | next expected | amount | frequency | account | category | reserved this month | status. Each row clickable.
- Row click opens a side panel (or modal) with: edit form, amount history (chart), linked transactions list (with unlink), notes.

Add modal: name, account, category, frequency, expected month (when frequency != monthly), expected day (optional), expected amount, accrual on/off toggle, notes. Validation via Zod, mirrors the existing recurring create flow.

Tab list updated in `src/app/(routes)/transactions/page.tsx`: add `'planned'` to the `transactionTabs` array, add a conditional render block for the new tab.

### 6.2 Edit Transaction modal — inline "Planned payment" section

Added to the existing edit modal at `src/app/(routes)/transactions/page.tsx:1289`. No kebab menu (the codebase doesn't use one). No second-level dialog (modal-on-modal is undesirable). Instead, a single inline-expanding section in the same neighborhood as the Split/Return actions:

**Unlinked state (default, single row):**
```
Planned payment    [ + Add to planned ▾ ]
```
Clicking the button reveals an inline panel below with:
- Radio: "Link to existing" → reveals a `<Select>` filtered to active obligations on this account.
- Radio: "Create new" → reveals a minimal inline form (name, frequency, expected month, expected amount; defaults pre-filled from the transaction).

A "Save" button commits and collapses back to the linked state. "Cancel" collapses without saving.

**Linked state:**
```
Planned payment    [Amex annual fee] [Unlink] [↗]
```
Chip with the obligation name, an Unlink button, and a jump-to icon that closes the modal and navigates to `/transactions?tab=planned&id=<obligationId>`.

The expansion is local and small (3-4 form rows max). Keeps the consistent footprint with Split/Return reveals.

### 6.3 Subscriptions tab — "Promote to Planned" button

`src/components/subscriptions-tab.tsx`: add a "Promote to Planned" action in each row. Opens the Add modal pre-filled from the `RecurringTransaction` (merchant → name, account, category, frequency, expectedAmount, expectedDayOfMonth). On save, the new `PlannedObligation` has `sourceRecurringId` set. The recurring entry is not modified — one-way, non-destructive bridge.

### 6.4 Dashboard "Next 90 days" widget

New component `src/components/planned-forecast.tsx`. Compact tile on the dashboard showing upcoming obligations sorted by `nextExpectedDate`, capped at ~5 items, with a "View all" link to `/transactions?tab=planned`. Each item shows name, expected date (or "this month"), amount, account.

Data source: `GET /api/planned/forecast?days=90`.

### 6.5 Analytics "Reserved" section

New section in `src/app/(routes)/analytics/page.tsx`. Default placement is **below the existing per-category budget breakdown** (since "Reserved" is supplemental context, not the primary budget signal). Placement can be swapped during implementation if it visually outweighs the category list.

Shows:
- Total Reserved for the selected month.
- Expandable per-obligation list with `accruedThisCycle / drawdownThisCycle / reservedBalance` and clickable names that jump to obligation detail.

Data source: `GET /api/planned/reserved?month=YYYY-MM`.

### 6.6 Design system

All new UI uses `ds.*` tokens (text/bg/border/status) and the existing `Card`/`Button`/`Modal`/`Badge`/`Input`/`Select` primitives in `src/components/ui/`. No new design primitives.

## 7. API surface

All routes use Next.js App Router with Zod validation. List responses use `{ resource: [...] }`; create/update return the raw object.

### 7.1 Core CRUD

- `GET /api/planned` — list with summary; query params `status`, `accountId`, `frequency`. Returns `{ obligations, summary: { activeCount, totalMonthlyAccrual, totalAnnualAccrual } }`.
- `POST /api/planned` — create. Body fields documented in 3.1. Returns the created obligation with `nextExpectedDate` computed.
- `GET /api/planned/[id]` — detail with linked transactions joined and parsed `amountHistory`.
- `PATCH /api/planned/[id]` — partial update; recomputes `nextExpectedDate` if frequency/month/day changed.
- `DELETE /api/planned/[id]` — soft delete (sets `status = "archived"`, preserves links and history). `?hard=true` for full removal.

### 7.2 Linking

- `POST /api/planned/[id]/links` — body `{ transactionId, source? }`. Defaults to `"manual"`. Returns 409 if `transactionId` is already linked elsewhere.
- `DELETE /api/planned/[id]/links/[transactionId]` — unlink.

### 7.3 Read-side composition (rip-out boundaries)

- `GET /api/planned/forecast?days=90` — used by dashboard widget. Active obligations with `nextExpectedDate` within window, ascending.
- `GET /api/planned/reserved?month=YYYY-MM` — used by Analytics. Calls `computeReservedForMonth()`.

### 7.4 Promotion shortcuts

- `POST /api/planned/promote-recurring` — body `{ recurringId }`. Reads the `RecurringTransaction`, creates an obligation with `sourceRecurringId` set.
- `POST /api/planned/from-transaction` — body `{ transactionId, mode: "create" | "link", obligationId? }`. In `"create"` mode creates obligation pre-filled from the transaction and immediately creates a link with `linkSource: "promoted"`. In `"link"` mode just creates a link to the existing `obligationId`.

### 7.5 Linking strategy hook

The transaction-create code paths (`src/lib/import.ts`, `/api/transactions`, `src/lib/teller-sync.ts`) call `applyLinkingStrategy(prisma, tx)`. With `ManualOnlyStrategy` this is a no-op. The hook is installed in v1 so the codepath exists when we swap strategies later.

### 7.6 Cloud sync

`PlannedObligation` and `PlannedObligationLink` get added to the export/import shape in `src/lib/cloud-sync/types.ts` and `src/lib/cloud-sync/sync.ts`. Auto-sync triggers on writes via the existing mechanism.

## 8. File layout

```
src/lib/planned/
  ├── accrual.ts           # Reserved-bucket math (rip-out: accrual layer)
  ├── linking.ts           # Strategy interface + ManualOnlyStrategy
  ├── config.ts            # getActiveLinkingStrategy()
  ├── obligations.ts       # Shared CRUD helpers used by API routes
  └── RIPOUT.md            # Layered rip-out runbook (see §10)

src/app/api/planned/
  ├── route.ts             # GET list, POST create
  ├── [id]/
  │   ├── route.ts         # GET, PATCH, DELETE
  │   └── links/
  │       ├── route.ts     # POST link
  │       └── [txId]/route.ts  # DELETE link
  ├── forecast/route.ts    # (rip-out: forecast layer)
  ├── reserved/route.ts    # (rip-out: accrual layer)
  ├── promote-recurring/route.ts
  └── from-transaction/route.ts

src/components/
  ├── planned-tab.tsx      # Main management UI
  ├── planned-detail.tsx   # Side panel for detail/edit
  └── planned-forecast.tsx # Dashboard widget (rip-out: forecast layer)
```

## 9. Modularity / rip-out story

The whole feature is structured so each layer can be removed independently. The `RIPOUT.md` runbook lives next to the code so it's discoverable when someone is staring at the directory wondering how to remove it. Spec preserves the same content for archaeology.

Each rip-out anchor file gets a one-line breadcrumb comment at the top:
```ts
// Modularity: this file is part of the accrual layer.
// To remove: see src/lib/planned/RIPOUT.md (section: "Rip out accrual layer only").
```

Same shape on `linking.ts`, `accrual.ts`, and the `forecast` and `reserved` API routes.

### 9.1 Rip out the accrual layer only (most likely)

If the smoothing UX turns out to be confusing but the obligation tracker itself is useful:

1. `UPDATE PlannedObligation SET accrualEnabled = false` (or migration).
2. Delete `src/lib/planned/accrual.ts`.
3. Delete `src/app/api/planned/reserved/route.ts`.
4. Delete the Reserved section from `src/app/(routes)/analytics/page.tsx`.
5. Optionally drop `accrualEnabled` column in a follow-up migration.

**No data loss.** Obligations and links stay intact.

### 9.2 Rip out the forecast layer only

If the dashboard widget feels noisy:

1. Delete `src/app/api/planned/forecast/route.ts`.
2. Delete the dashboard widget component + render call.

**No data loss.**

### 9.3 Rip out the entire feature

1. Delete `src/app/api/planned/` (whole directory).
2. Delete `src/lib/planned/` (whole directory).
3. Delete `src/components/planned-tab.tsx`, `planned-detail.tsx`, `planned-forecast.tsx`.
4. Remove `'planned'` tab entry from `src/app/(routes)/transactions/page.tsx`.
5. Remove the inline "Add to planned" section from the edit modal in the same file.
6. Remove the dashboard forecast widget render call.
7. Remove the Reserved section from Analytics.
8. Remove the "Promote to Planned" button in `subscriptions-tab.tsx`.
9. Remove `PlannedObligation` and `PlannedObligationLink` from `prisma/schema.prisma` + run migration.
10. Remove `applyLinkingStrategy` calls from `src/lib/import.ts`, `/api/transactions`, `src/lib/teller-sync.ts`.
11. Remove the two new tables from cloud sync types and sync logic.

**Data loss:** obligations and links go away. `Transaction`, `RecurringTransaction`, everything else untouched.

## 10. Follow-up issues to file

### Issue: Refactor `src/app/(routes)/transactions/page.tsx`

**Title:** Refactor transactions route — extract modals into dedicated components

**Body:**
> The transactions route file at `src/app/(routes)/transactions/page.tsx` is approaching 2000+ lines and contains four large modals inline (Edit, Create, Split, Return — and now an inline Planned-payment section inside Edit). It's becoming hard to navigate and modify safely.
>
> **Proposed refactor:**
> - Extract `EditTransactionModal`, `CreateTransactionModal`, `SplitModal`, `ReturnModal` into their own component files under `src/components/transactions/`.
> - Hoist shared transaction-form state into a small custom hook (`useTransactionForm`).
> - The route file becomes a thin shell handling tab switching, data fetching, and table rendering.
>
> **Out of scope for the Planned Payments feature** — this is a focused follow-up to make the area more maintainable.
>
> **Acceptance:**
> - File under 800 lines.
> - Each modal has its own file and is independently testable.
> - No behavior change.

## 11. Testing

Following the existing project conventions (Vitest, see `npm run test:unit` and `npm run test:integration` in `package.json`):

### Unit tests
- `src/lib/planned/accrual.test.ts` — cycle math, back-accrual, drawdown floor, surplus carry, edge cases (one-off, irregular, mid-cycle creation).
- `src/lib/planned/linking.test.ts` — `ManualOnlyStrategy.match()` always returns `[]`. Strategy interface contract test.
- `src/lib/planned/obligations.test.ts` — CRUD helpers, `nextExpectedDate` computation per frequency.

### Integration tests
- `tests/integration/planned-crud.test.ts` — full obligation lifecycle including soft + hard delete.
- `tests/integration/planned-linking.test.ts` — manual link/unlink via API; uniqueness constraint enforcement.
- `tests/integration/planned-promotion.test.ts` — promote from recurring + from-transaction flows.
- `tests/integration/planned-reserved.test.ts` — Reserved summary calculation across multiple obligations and a full cycle.
- `tests/integration/planned-cloud-sync.test.ts` — round-trip of new tables through the encrypted sync payload.

## 12. Open follow-ups (not v1)

- `MerchantMonthAmountStrategy` for auto-linking — drop-in to existing strategy interface.
- Surplus-rollover into next cycle's accrual.
- Notifications/heads-up (push or email) for upcoming obligations.
- Real sinking-fund mode (Q4 option B) — link an obligation to a savings account and track real balance.

---

**Approval gate:** before implementation begins, this spec must be reviewed and approved by the user. Once approved, the next step is invoking the writing-plans skill to produce a detailed implementation plan.
