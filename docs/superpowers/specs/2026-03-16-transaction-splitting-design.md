# Transaction Splitting Design

## Overview

Add the ability to split a single transaction into multiple parts, each with its own category and amount. This enables accurate categorization when a single purchase spans multiple budget categories (e.g., a -$100 Walmart receipt where -$60 is groceries and -$40 is household supplies).

This replaces the existing destructive split implementation (`/api/transactions/split`) which deletes the parent transaction. The new design preserves the parent for deduplication and reversibility.

## Requirements

- **Category splitting**: Split a transaction into 2+ parts with different categories
- **Preserve parent**: The original transaction stays in the database for dedup integrity (`externalId`, `importHash`)
- **Strict sum**: Split part amounts must sum exactly to the original transaction amount
- **Reversible**: Users can unsplit to restore the original transaction
- **Parts are first-class transactions**: Split parts appear in all views, analytics, budgets, and reports; the parent is hidden

## Data Model

Add two fields and a self-relation to the `Transaction` model in `prisma/schema.prisma`:

```prisma
isSplitParent       Boolean      @default(false)
parentTransactionId String?
parentTransaction   Transaction? @relation("TransactionSplit", fields: [parentTransactionId], references: [id], onDelete: Cascade)
splitParts          Transaction[] @relation("TransactionSplit")
```

Defaults (`isSplitParent = false`, `parentTransactionId = null`) are safe for all existing data — no data migration needed beyond the schema migration.

### Field behavior

| Field | On parent | On split part |
|-------|-----------|---------------|
| `isSplitParent` | `true` | `false` |
| `parentTransactionId` | `null` | parent's ID |
| `externalId` | preserved | `null` |
| `importHash` | preserved | `null` |
| `date` | original | inherited from parent |
| `merchant` | original | inherited from parent |
| `merchantNormalized` | original | inherited from parent |
| `accountId` | original | inherited from parent |
| `tags` | original | inherited from parent |
| `isTransfer` | original | inherited from parent |
| `transferGroupId` | original | `null` (see Transfers edge case) |
| `isOffset` | original | `false` |
| `linkedTransactionId` | original | `null` (see Linked transactions edge case) |
| `amount` | original total | part amount (same sign convention as parent — negative for expenses, positive for income) |
| `categoryId` | original (irrelevant when hidden) | per-part category |
| `note` | original | per-part note (optional) |
| `confidenceScore` | original | 1.0 (user-initiated; deliberate change from current impl which copies parent's score) |

### Index

Add an index on `parentTransactionId` for efficient lookups:

```prisma
@@index([parentTransactionId])
```

## API Design

### Replace: `POST /api/transactions/split`

The existing endpoint is destructive (deletes parent, creates standalone parts). This redesign replaces it entirely with the parent-preserving approach.

**Request:**

```typescript
{
  transactionId: string,
  parts: [
    { amount: number, categoryId?: string | null, note?: string },
    // ... min 2 parts
  ]
}
```

**Validation:**

- `parts.length >= 2`
- Sum of `parts[].amount` must equal the parent transaction's `amount` exactly (same sign — e.g., parts of a -$100 expense must sum to -$100)
- Parent must not already be a split parent (`isSplitParent === false`)
- Parent must not be a split part itself (`parentTransactionId === null`)
- Parent must not have linked transactions (`linkedTransactionId === null` and no `offsetTransactions`) — unsplit or unlink first
- `categoryId` values validated by Prisma FK constraints; invalid IDs return an error

**Logic (in a Prisma `$transaction`):**

1. Set `isSplitParent = true` on the parent
2. Create N child transactions with:
   - `parentTransactionId` = parent ID
   - `date`, `merchant`, `merchantNormalized`, `accountId`, `tags`, `isTransfer` inherited from parent
   - `transferGroupId` = `null`, `isOffset` = `false`, `linkedTransactionId` = `null`
   - `amount`, `categoryId`, `note` from the request
   - `externalId` = `null`, `importHash` = `null`
   - `confidenceScore` = 1.0 (user-initiated)

**Response:** `{ parts: Transaction[] }`

### New: `POST /api/transactions/unsplit`

**Request:**

```typescript
{ transactionId: string }  // the parent's ID
```

**Validation:**

- Transaction must exist and have `isSplitParent === true`

**Logic (in a Prisma `$transaction`):**

1. Delete all transactions where `parentTransactionId === transactionId`
2. Set `isSplitParent = false` on the parent

**Response:** The restored parent transaction (with its original `categoryId` intact — it was never modified)

### Query changes

All transaction queries that feed into display or aggregation must add `isSplitParent: false` to their `where` clause. This affects:

- `GET /api/transactions` — transaction list
- Dashboard queries — spending/income totals
- Analytics queries — category breakdowns, merchant totals, trends
- Budget queries — category spending vs limits
- Goal queries — spending/saving tracking
- Report queries — summaries

**Cloud sync**: Both parents and parts are exported. The export/import Zod schemas (`TransactionExport` in `sync.ts`) must be updated to include `isSplitParent` and `parentTransactionId`. Old exports lacking these fields default to `isSplitParent = false` and `parentTransactionId = null` on import (backward compatible).

The parent is a "ghost" record existing only for deduplication and as the anchor for unsplitting.

## UI Design

### Split parts in transaction list

- Each split part appears as its own row, identical to regular transactions
- A visual indicator (small badge or fork icon) next to the merchant name signals it's part of a split
- Clicking a split part opens the normal edit modal with added split context

### Split action entry point

- In the transaction edit modal, add a "Split" button
- Only shown for standalone transactions (not a split parent, not a split part, and not linked/offset)

### Split modal

- Header: original transaction details (merchant, date, total amount)
- Body: list of split part rows, each with:
  - Amount input (absolute value displayed; sign inherited from parent)
  - Category dropdown
  - Optional note field
- Starts with 2 empty rows
- "Add another part" button for additional rows
- Running total display: sum of parts vs. original amount
- Validation: submit button disabled until amounts sum exactly to original
- Submit button: "Split Transaction"

### Unsplit action

- Available from any split part's edit modal (via split context section)
- Split context section shows: sibling parts list and "Unsplit" button
- Confirmation prompt: "This will remove all split parts and restore the original $X transaction. Continue?"
- On confirm: calls unsplit API, refreshes transaction list

## Edge Cases

- **Re-splitting**: Not supported. To change a split, unsplit first, then re-split. The split button is hidden on split parts and split parents.
- **Editing split part amounts**: The PATCH endpoint for transactions will enforce the sum constraint when editing a split part's amount — the new amount plus sibling amounts must still equal the parent's amount. This prevents silent data inconsistency.
- **Deleting split parts**: Deleting a single split part is blocked. Users must unsplit the entire transaction. This keeps the sum constraint intact.
- **Bank sync**: Parent retains `externalId`/`importHash`, so re-syncing will find the parent and skip it. Split parts have no external identifiers and won't conflict.
- **Transfers**: Splitting is allowed on transfer transactions. Parts inherit `isTransfer = true` but get `transferGroupId = null`. The parent retains the transfer pairing. This is an uncommon case.
- **Linked transactions (returns/offsets)**: Splitting is blocked on transactions that have `linkedTransactionId` set or that have `offsetTransactions`. The user must unlink first, then split. This avoids ambiguity about which part the return applies to.
- **Amount sign convention**: Part amounts follow the same sign as the parent. A -$100 expense splits into parts like -$60 and -$40. The UI displays absolute values for readability but submits with correct signs.
- **Migration from old splits**: Any transactions previously split with the old destructive API are now standalone transactions with no parent. They are unaffected by this change and will continue to work normally. There is no automated migration path for these.
