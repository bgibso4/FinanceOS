# Goals & Spending/Savings Tracking — Design

## Overview

Flexible goal tracking that goes beyond monthly category budgets. Goals track spending or saving, tied to categories (including groups), tags, or accounts, over custom timeframes. Completely independent from the existing `CategoryBudget` system.

## Use Cases

1. **"2026 Travel Budget"** — $5,000/year spending goal, tracked by the Travel category group (sums all child categories)
2. **"Ontario Camping Trip"** — $2,000 spending goal, tracked by tag, open-ended
3. **"Emergency Fund"** — $10,000 savings goal, tracked by account balance or tagged transactions

## Data Model

```prisma
model Goal {
  id              String    @id @default(uuid())
  name            String
  type            String    // "spending" | "saving"
  targetAmount    Float
  trackingMethod  String    // "category" | "tag" | "account"
  categoryId      String?
  category        Category? @relation(fields: [categoryId], references: [id])
  tagId           String?
  tag             Tag?      @relation(fields: [tagId], references: [id])
  accountId       String?
  account         Account?  @relation(fields: [accountId], references: [id])
  startDate       String?   // ISO date, null = open-ended start
  endDate         String?   // ISO date, null = open-ended end
  status          String    @default("active") // "active" | "completed" | "archived"
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

- Dates stored as strings (consistent with `CategoryBudget.month`)
- Only the tracking field matching `trackingMethod` is populated; others are null
- No stored progress — always computed at query time

## Progress Calculation

Three strategies based on `trackingMethod`, computed live in a `calculateGoalProgress()` helper:

### Category

1. Look up `goal.categoryId`
2. Find all child categories where `parentId = goal.categoryId`
3. If children exist (group): `SUM(ABS(amount))` across all child category IDs within date range
4. If no children (leaf): `SUM(ABS(amount))` for just that category within date range

Groups dynamically include any new child categories added after goal creation.

### Tag

```sql
SUM(ABS(amount)) FROM Transaction
WHERE tags LIKE '%"tagName"%'
  AND date >= goal.startDate
  AND date <= goal.endDate
```

### Account

```sql
SELECT balance FROM Account WHERE id = goal.accountId
```

No date filtering — uses current account balance.

### On-Track Calculation

For goals with date ranges:
- Calculate percentage of timeframe elapsed
- Compare to progress percentage
- **Spending:** behind if spent more than expected pace, ahead if under
- **Saving:** behind if saved less than expected pace, ahead if over
- Open-ended goals skip this — just show raw progress

## API

Standard CRUD at `/api/goals`:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/goals` | List goals with computed progress. Filter: `?status=active\|completed\|archived\|all` |
| POST | `/api/goals` | Create goal. Zod validates tracking field matches method. |
| PATCH | `/api/goals/[id]` | Update goal (name, target, dates, status, tracking target) |
| DELETE | `/api/goals/[id]` | Delete goal |

No bulk endpoints — goals are low-volume (5-15 at a time).

Response shape for GET:
```typescript
{
  goals: Array<Goal & {
    currentAmount: number;
    percentage: number;
    remaining: number;
    paceStatus: 'on_track' | 'ahead' | 'behind' | null; // null for open-ended
  }>
}
```

## UI — Goals Page

Dedicated page at `/goals` with sidebar nav entry.

### Layout
- Header: "Goals" title + "New Goal" button
- Filter tabs: Active | Completed | Archived
- Goal cards in a grid (2 columns desktop, 1 mobile)

### Goal Card
- Name + type badge (Spending / Saving)
- Tracking source label (e.g. "Travel category", "Camping Trip tag", "Savings Account")
- Date range or "Open-ended"
- Progress bar with percentage
- Current amount vs target (e.g. "$2,300 / $5,000")
- Remaining amount
- Pace indicator (on track / ahead / behind) as color on progress bar

### Creation/Edit Modal
- Name input
- Type toggle: Spending / Saving
- Target amount
- Tracking method selector (Category / Tag / Account)
  - Category: dropdown showing groups and leaf categories
  - Tag: dropdown of existing tags
  - Account: dropdown of accounts
- Timeframe: preset buttons (This Year, This Quarter, Custom) + date pickers
- Open-ended checkbox (clears dates)

## UI — Dashboard Widget

Compact widget on the main dashboard:
- Section header: "Goals" with "View All" link to `/goals`
- Up to 3-4 active goals, sorted by most relevant (closest deadline or most active)
- Each row: name, compact progress bar, percentage, current/target
- Pace status as subtle color on progress bar (green/yellow/red)
- Widget hidden if no goals exist

Placed alongside existing dashboard blocks, using the same card styling from the design system.

## Cloud Sync

Following established patterns:
- Export: add `goal.findMany()` in `src/lib/cloud-sync/sync.ts`
- Schema: add `GoalExportSchema` in `src/lib/cloud-sync/types.ts`
- Include in `SyncData` type and `SyncMetadata` record counts
- Import: upsert goals by ID on pull
