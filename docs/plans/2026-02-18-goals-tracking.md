# Goals & Spending/Savings Tracking — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add flexible goal tracking (spending and saving) tied to categories, tags, or accounts, with custom timeframes, a dedicated goals page, and a dashboard widget.

**Architecture:** Single `Goal` model with a `trackingMethod` discriminator (`category` | `tag` | `account`). Progress is computed live at query time — no stored progress values. Category goals support groups (parent categories with children). Tags are reused for transaction-to-goal association. Goals are fully independent from the existing monthly `CategoryBudget` system.

**Tech Stack:** Prisma (SQLite), Next.js App Router API routes, Zod validation, React, Tailwind + `ds` design system, Vitest for testing.

---

### Task 1: Add Goal model to Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

**Step 1: Add the Goal model**

Add after the `CategoryBudget` model (around line 213):

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
  startDate       String?   // ISO date string, null = open-ended start
  endDate         String?   // ISO date string, null = open-ended end
  status          String    @default("active") // "active" | "completed" | "archived"
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

Also add `goals Goal[]` relation field to:
- `Category` model (after the `budgets` line)
- `Tag` model (after `color`)
- `Account` model (after `transactions`)

**Step 2: Run the migration**

Run: `npx prisma migrate dev --name add_goals`
Expected: Migration applies successfully, `prisma/migrations/` gets a new folder.

**Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(goals): add Goal model to database schema"
```

---

### Task 2: Add Goal factory to test helpers

**Files:**
- Modify: `tests/helpers/factories.ts`
- Modify: `tests/helpers/db.ts`

**Step 1: Add GoalData factory to `tests/helpers/factories.ts`**

Add at the end of the file:

```typescript
export interface GoalData {
  id?: string;
  name: string;
  type: string;
  targetAmount: number;
  trackingMethod: string;
  categoryId?: string;
  tagId?: string;
  accountId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

export function createGoalData(overrides: Partial<GoalData> = {}): GoalData {
  return {
    id: uuid(),
    name: 'Test Goal',
    type: 'spending',
    targetAmount: 1000,
    trackingMethod: 'category',
    status: 'active',
    ...overrides,
  };
}
```

**Step 2: Add Goal to `resetTestDb()` in `tests/helpers/db.ts`**

Add `await prisma.goal.deleteMany();` before `await prisma.categoryBudget.deleteMany();` (line 79) to respect foreign key order.

**Step 3: Commit**

```bash
git add tests/helpers/factories.ts tests/helpers/db.ts
git commit -m "feat(goals): add test factory and db cleanup for Goal model"
```

---

### Task 3: Build goal progress calculation helper

**Files:**
- Create: `src/lib/goals.ts`
- Create: `tests/unit/lib/goals.test.ts`

**Step 1: Write the failing tests**

Create `tests/unit/lib/goals.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import {
  createAccountData,
  createCategoryData,
  createGoalData,
  createTransactionData,
  createCategoryHierarchy,
} from '../../helpers/factories';
import { calculateGoalProgress } from '@/lib/goals';
import type { PrismaClient } from '@prisma/client';

describe('calculateGoalProgress', () => {
  let prisma: PrismaClient;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();
    const account = await prisma.account.create({
      data: createAccountData({ name: 'Checking' }),
    });
    accountId = account.id;
  });

  describe('category tracking', () => {
    it('sums spending for a leaf category within date range', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Travel', type: 'expense' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel',
          type: 'spending',
          targetAmount: 5000,
          trackingMethod: 'category',
          categoryId: category.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -200,
            categoryId: category.id,
            date: new Date('2026-03-15'),
          }),
          createTransactionData(accountId, {
            amount: -300,
            categoryId: category.id,
            date: new Date('2026-06-01'),
          }),
          // Outside date range — should NOT count
          createTransactionData(accountId, {
            amount: -100,
            categoryId: category.id,
            date: new Date('2025-12-15'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(500);
      expect(progress.percentage).toBeCloseTo(10);
      expect(progress.remaining).toBe(4500);
    });

    it('sums spending across all children of a category group', async () => {
      const { parent, children } = createCategoryHierarchy('Travel', [
        'Flights',
        'Hotels',
        'Car Rental',
      ]);
      await prisma.category.create({ data: parent });
      for (const child of children) {
        await prisma.category.create({ data: child });
      }

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel',
          type: 'spending',
          targetAmount: 5000,
          trackingMethod: 'category',
          categoryId: parent.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -400,
            categoryId: children[0].id,
            date: new Date('2026-02-01'),
          }),
          createTransactionData(accountId, {
            amount: -600,
            categoryId: children[1].id,
            date: new Date('2026-03-01'),
          }),
          createTransactionData(accountId, {
            amount: -200,
            categoryId: children[2].id,
            date: new Date('2026-04-01'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(1200);
      expect(progress.percentage).toBeCloseTo(24);
    });
  });

  describe('tag tracking', () => {
    it('sums spending for transactions with matching tag', async () => {
      const tag = await prisma.tag.create({
        data: { name: 'Camping Trip', color: 'green' },
      });

      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Travel' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Ontario Camping Trip',
          type: 'spending',
          targetAmount: 2000,
          trackingMethod: 'tag',
          tagId: tag.id,
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -150,
            categoryId: category.id,
            tags: JSON.stringify(['Camping Trip']),
            date: new Date('2026-05-01'),
          }),
          createTransactionData(accountId, {
            amount: -300,
            categoryId: category.id,
            tags: JSON.stringify(['Camping Trip', 'Outdoor']),
            date: new Date('2026-05-15'),
          }),
          // No matching tag — should NOT count
          createTransactionData(accountId, {
            amount: -50,
            categoryId: category.id,
            tags: JSON.stringify(['Outdoor']),
            date: new Date('2026-05-20'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(450);
      expect(progress.percentage).toBeCloseTo(22.5);
    });
  });

  describe('account tracking', () => {
    it('uses account balance for savings goal progress', async () => {
      // Create transactions to build up a balance
      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: 5000,
            merchant: 'Paycheck',
            date: new Date('2026-01-15'),
          }),
          createTransactionData(accountId, {
            amount: 2000,
            merchant: 'Paycheck',
            date: new Date('2026-02-15'),
          }),
        ],
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Emergency Fund',
          type: 'saving',
          targetAmount: 10000,
          trackingMethod: 'account',
          accountId: accountId,
        }),
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(7000);
      expect(progress.percentage).toBeCloseTo(70);
      expect(progress.remaining).toBe(3000);
    });
  });

  describe('open-ended goals', () => {
    it('includes all transactions when no date range is set', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Wedding' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Wedding',
          type: 'spending',
          targetAmount: 15000,
          trackingMethod: 'category',
          categoryId: category.id,
          // No startDate or endDate
        }),
      });

      await prisma.transaction.createMany({
        data: [
          createTransactionData(accountId, {
            amount: -1000,
            categoryId: category.id,
            date: new Date('2025-06-01'),
          }),
          createTransactionData(accountId, {
            amount: -2000,
            categoryId: category.id,
            date: new Date('2026-03-01'),
          }),
        ],
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.currentAmount).toBe(3000);
    });
  });

  describe('pace status', () => {
    it('returns "ahead" for spending goal under pace', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Travel' }),
      });

      // Goal: $12,000 for 2026. At mid-year, should have spent $6,000 to be on pace.
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel',
          type: 'spending',
          targetAmount: 12000,
          trackingMethod: 'category',
          categoryId: category.id,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      // Spent only $2,000 by mid-year — under pace (good for spending)
      await prisma.transaction.create({
        data: createTransactionData(accountId, {
          amount: -2000,
          categoryId: category.id,
          date: new Date('2026-03-01'),
        }),
      });

      const progress = await calculateGoalProgress(goal, prisma, new Date('2026-07-01'));
      expect(progress.paceStatus).toBe('ahead');
    });

    it('returns null for open-ended goals', async () => {
      const category = await prisma.category.create({
        data: createCategoryData({ name: 'Wedding' }),
      });

      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Wedding',
          type: 'spending',
          targetAmount: 15000,
          trackingMethod: 'category',
          categoryId: category.id,
        }),
      });

      const progress = await calculateGoalProgress(goal, prisma);
      expect(progress.paceStatus).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm run test:unit -- goals`
Expected: FAIL — module `@/lib/goals` does not exist.

**Step 3: Write the implementation**

Create `src/lib/goals.ts`:

```typescript
import type { PrismaClient, Goal } from '@prisma/client';

export type GoalProgress = {
  currentAmount: number;
  percentage: number;
  remaining: number;
  paceStatus: 'on_track' | 'ahead' | 'behind' | null;
};

export async function calculateGoalProgress(
  goal: Goal,
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<GoalProgress> {
  let currentAmount = 0;

  if (goal.trackingMethod === 'category' && goal.categoryId) {
    currentAmount = await calculateCategoryProgress(goal, prisma);
  } else if (goal.trackingMethod === 'tag' && goal.tagId) {
    currentAmount = await calculateTagProgress(goal, prisma);
  } else if (goal.trackingMethod === 'account' && goal.accountId) {
    currentAmount = await calculateAccountProgress(goal, prisma);
  }

  const percentage = goal.targetAmount > 0 ? (currentAmount / goal.targetAmount) * 100 : 0;
  const remaining = Math.max(0, goal.targetAmount - currentAmount);
  const paceStatus = calculatePaceStatus(goal, percentage, now);

  return { currentAmount, percentage, remaining, paceStatus };
}

async function calculateCategoryProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  // Check if this category is a group (has children)
  const children = await prisma.category.findMany({
    where: { parentId: goal.categoryId! },
    select: { id: true },
  });

  const categoryIds =
    children.length > 0 ? children.map((c) => c.id) : [goal.categoryId!];

  const dateFilter = buildDateFilter(goal);

  const result = await prisma.transaction.aggregate({
    where: {
      categoryId: { in: categoryIds },
      ...dateFilter,
    },
    _sum: { amount: true },
  });

  return Math.abs(result._sum.amount ?? 0);
}

async function calculateTagProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  const tag = await prisma.tag.findUnique({ where: { id: goal.tagId! } });
  if (!tag) return 0;

  const dateFilter = buildDateFilter(goal);

  // Tags are stored as JSON string arrays, use LIKE for SQLite
  const transactions = await prisma.transaction.findMany({
    where: {
      tags: { contains: `"${tag.name}"` },
      ...dateFilter,
    },
    select: { amount: true },
  });

  return transactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
}

async function calculateAccountProgress(goal: Goal, prisma: PrismaClient): Promise<number> {
  // Sum all transactions in the account to get current balance
  const result = await prisma.transaction.aggregate({
    where: { accountId: goal.accountId! },
    _sum: { amount: true },
  });

  return Math.abs(result._sum.amount ?? 0);
}

function buildDateFilter(goal: Goal): Record<string, unknown> {
  const filter: Record<string, unknown> = {};

  if (goal.startDate || goal.endDate) {
    const dateCondition: Record<string, Date> = {};
    if (goal.startDate) dateCondition.gte = new Date(goal.startDate);
    if (goal.endDate) dateCondition.lte = new Date(goal.endDate + 'T23:59:59.999Z');
    filter.date = dateCondition;
  }

  return filter;
}

function calculatePaceStatus(
  goal: Goal,
  percentage: number,
  now: Date,
): 'on_track' | 'ahead' | 'behind' | null {
  if (!goal.startDate || !goal.endDate) return null;

  const start = new Date(goal.startDate);
  const end = new Date(goal.endDate + 'T23:59:59.999Z');
  const totalDuration = end.getTime() - start.getTime();

  if (totalDuration <= 0) return null;

  const elapsed = Math.max(0, Math.min(now.getTime() - start.getTime(), totalDuration));
  const timePercentage = (elapsed / totalDuration) * 100;

  const tolerance = 5; // 5% tolerance band

  if (goal.type === 'spending') {
    // For spending: being under pace is good (ahead), over pace is bad (behind)
    if (percentage < timePercentage - tolerance) return 'ahead';
    if (percentage > timePercentage + tolerance) return 'behind';
    return 'on_track';
  } else {
    // For saving: being over pace is good (ahead), under pace is bad (behind)
    if (percentage > timePercentage + tolerance) return 'ahead';
    if (percentage < timePercentage - tolerance) return 'behind';
    return 'on_track';
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npm run test:unit -- goals`
Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/lib/goals.ts tests/unit/lib/goals.test.ts
git commit -m "feat(goals): add goal progress calculation with tests"
```

---

### Task 4: Build Goals CRUD API routes

**Files:**
- Create: `src/app/api/goals/route.ts`
- Create: `src/app/api/goals/[id]/route.ts`
- Create: `tests/integration/api/goals.test.ts`

**Step 1: Write the failing integration tests**

Create `tests/integration/api/goals.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createAccountData, createCategoryData, createGoalData } from '../../helpers/factories';
import type { PrismaClient } from '@prisma/client';

describe('goals API integration', () => {
  let prisma: PrismaClient;
  let categoryId: string;
  let tagId: string;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await resetTestDb();

    const [category, tag, account] = await Promise.all([
      prisma.category.create({
        data: createCategoryData({ name: 'Travel', type: 'expense' }),
      }),
      prisma.tag.create({ data: { name: 'Camping', color: 'green' } }),
      prisma.account.create({
        data: createAccountData({ name: 'Savings' }),
      }),
    ]);

    categoryId = category.id;
    tagId = tag.id;
    accountId = account.id;
  });

  describe('CRUD operations', () => {
    it('creates a spending goal with category tracking', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: '2026 Travel Budget',
          type: 'spending',
          targetAmount: 5000,
          trackingMethod: 'category',
          categoryId,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        }),
      });

      expect(goal.name).toBe('2026 Travel Budget');
      expect(goal.type).toBe('spending');
      expect(goal.trackingMethod).toBe('category');
      expect(goal.categoryId).toBe(categoryId);
      expect(goal.status).toBe('active');
    });

    it('creates a savings goal with account tracking', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Emergency Fund',
          type: 'saving',
          targetAmount: 10000,
          trackingMethod: 'account',
          accountId,
        }),
      });

      expect(goal.type).toBe('saving');
      expect(goal.trackingMethod).toBe('account');
      expect(goal.accountId).toBe(accountId);
    });

    it('creates a spending goal with tag tracking', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Camping Trip',
          type: 'spending',
          targetAmount: 2000,
          trackingMethod: 'tag',
          tagId,
        }),
      });

      expect(goal.trackingMethod).toBe('tag');
      expect(goal.tagId).toBe(tagId);
    });

    it('lists only active goals by default', async () => {
      await prisma.goal.createMany({
        data: [
          createGoalData({ name: 'Active Goal', status: 'active', categoryId, trackingMethod: 'category' }),
          createGoalData({ name: 'Completed Goal', status: 'completed', categoryId, trackingMethod: 'category' }),
          createGoalData({ name: 'Archived Goal', status: 'archived', categoryId, trackingMethod: 'category' }),
        ],
      });

      const activeGoals = await prisma.goal.findMany({
        where: { status: 'active' },
      });

      expect(activeGoals).toHaveLength(1);
      expect(activeGoals[0].name).toBe('Active Goal');
    });

    it('updates a goal', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({
          name: 'Travel',
          targetAmount: 5000,
          categoryId,
          trackingMethod: 'category',
        }),
      });

      const updated = await prisma.goal.update({
        where: { id: goal.id },
        data: { name: 'Travel 2026', targetAmount: 6000, status: 'completed' },
      });

      expect(updated.name).toBe('Travel 2026');
      expect(updated.targetAmount).toBe(6000);
      expect(updated.status).toBe('completed');
    });

    it('deletes a goal', async () => {
      const goal = await prisma.goal.create({
        data: createGoalData({ name: 'To Delete', categoryId, trackingMethod: 'category' }),
      });

      await prisma.goal.delete({ where: { id: goal.id } });

      const found = await prisma.goal.findUnique({ where: { id: goal.id } });
      expect(found).toBeNull();
    });
  });
});
```

**Step 2: Run tests to verify they pass** (these are Prisma-level tests)

Run: `npm run test:integration -- goals`
Expected: All tests PASS.

**Step 3: Create `src/app/api/goals/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { calculateGoalProgress } from '@/lib/goals';

const createGoalSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['spending', 'saving']),
  targetAmount: z.number().positive(),
  trackingMethod: z.enum(['category', 'tag', 'account']),
  categoryId: z.string().optional(),
  tagId: z.string().optional(),
  accountId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') || 'active';

  const where = status === 'all' ? {} : { status };

  const goals = await prisma.goal.findMany({
    where,
    include: { category: true, tag: true, account: true },
    orderBy: { createdAt: 'desc' },
  });

  const goalsWithProgress = await Promise.all(
    goals.map(async (goal) => {
      const progress = await calculateGoalProgress(goal, prisma);
      return { ...goal, ...progress };
    }),
  );

  return NextResponse.json({ goals: goalsWithProgress });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createGoalSchema.parse(body);

  // Validate tracking field matches method
  if (parsed.trackingMethod === 'category' && !parsed.categoryId) {
    return NextResponse.json(
      { error: 'categoryId is required for category tracking' },
      { status: 400 },
    );
  }
  if (parsed.trackingMethod === 'tag' && !parsed.tagId) {
    return NextResponse.json(
      { error: 'tagId is required for tag tracking' },
      { status: 400 },
    );
  }
  if (parsed.trackingMethod === 'account' && !parsed.accountId) {
    return NextResponse.json(
      { error: 'accountId is required for account tracking' },
      { status: 400 },
    );
  }

  const goal = await prisma.goal.create({
    data: {
      name: parsed.name,
      type: parsed.type,
      targetAmount: parsed.targetAmount,
      trackingMethod: parsed.trackingMethod,
      categoryId: parsed.trackingMethod === 'category' ? parsed.categoryId : null,
      tagId: parsed.trackingMethod === 'tag' ? parsed.tagId : null,
      accountId: parsed.trackingMethod === 'account' ? parsed.accountId : null,
      startDate: parsed.startDate ?? null,
      endDate: parsed.endDate ?? null,
    },
    include: { category: true, tag: true, account: true },
  });

  const progress = await calculateGoalProgress(goal, prisma);
  return NextResponse.json({ ...goal, ...progress });
}
```

**Step 4: Create `src/app/api/goals/[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { calculateGoalProgress } from '@/lib/goals';

const updateGoalSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(['spending', 'saving']).optional(),
  targetAmount: z.number().positive().optional(),
  trackingMethod: z.enum(['category', 'tag', 'account']).optional(),
  categoryId: z.string().nullable().optional(),
  tagId: z.string().nullable().optional(),
  accountId: z.string().nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateGoalSchema.parse(body);

  const goal = await prisma.goal.update({
    where: { id },
    data: parsed,
    include: { category: true, tag: true, account: true },
  });

  const progress = await calculateGoalProgress(goal, prisma);
  return NextResponse.json({ ...goal, ...progress });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  await prisma.goal.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
```

**Step 5: Commit**

```bash
git add src/app/api/goals/ tests/integration/api/goals.test.ts
git commit -m "feat(goals): add CRUD API routes with integration tests"
```

---

### Task 5: Add Goals page and sidebar nav entry

**Files:**
- Create: `src/app/(routes)/goals/page.tsx`
- Modify: `src/components/side-nav.tsx`

**Step 1: Add Goals to sidebar nav**

In `src/components/side-nav.tsx`, add a new entry to the `links` array after the Reports entry (line 29) and before Settings:

```typescript
{ href: '/goals', label: 'Goals' },
```

Also add `/goals` to the auto-expand logic if needed (it's a simple link, not a submenu, so no expansion needed).

**Step 2: Create the Goals page**

Create `src/app/(routes)/goals/page.tsx`:

```typescript
'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { ds } from '@/lib/design-system';

type GoalWithProgress = {
  id: string;
  name: string;
  type: string;
  targetAmount: number;
  trackingMethod: string;
  categoryId: string | null;
  tagId: string | null;
  accountId: string | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
  currentAmount: number;
  percentage: number;
  remaining: number;
  paceStatus: 'on_track' | 'ahead' | 'behind' | null;
  category?: { id: string; name: string; parentId: string | null } | null;
  tag?: { id: string; name: string; color: string } | null;
  account?: { id: string; name: string; type: string } | null;
};

type CategoryOption = { id: string; name: string; parentId: string | null };
type TagOption = { id: string; name: string; color: string };
type AccountOption = { id: string; name: string; type: string };

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

const formatDateRange = (start: string | null, end: string | null) => {
  if (!start && !end) return 'Open-ended';
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return `From ${fmt(start)}`;
  return `Until ${fmt(end!)}`;
};

const paceColors: Record<string, string> = {
  ahead: 'bg-green-500',
  on_track: 'bg-blue-500',
  behind: 'bg-red-500',
};

const paceLabels: Record<string, string> = {
  ahead: 'Ahead',
  on_track: 'On Track',
  behind: 'Behind',
};

function GoalCard({
  goal,
  onEdit,
}: {
  goal: GoalWithProgress;
  onEdit: (goal: GoalWithProgress) => void;
}) {
  const trackingLabel =
    goal.trackingMethod === 'category'
      ? `${goal.category?.name ?? 'Unknown'} category`
      : goal.trackingMethod === 'tag'
        ? `${goal.tag?.name ?? 'Unknown'} tag`
        : `${goal.account?.name ?? 'Unknown'} account`;

  const barColor = goal.paceStatus ? paceColors[goal.paceStatus] : 'bg-blue-500';
  const cappedPercentage = Math.min(goal.percentage, 100);

  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onEdit(goal)}>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className={`font-semibold ${ds.text.primary}`}>{goal.name}</h3>
            <p className={`text-xs ${ds.text.muted} mt-0.5`}>{trackingLabel}</p>
          </div>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              goal.type === 'spending'
                ? `${ds.status.error.bg} ${ds.status.error.text}`
                : `${ds.status.success.bg} ${ds.status.success.text}`
            }`}
          >
            {goal.type === 'spending' ? 'Spending' : 'Saving'}
          </span>
        </div>

        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className={`text-sm font-semibold ${ds.text.primary}`}>
              {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
            </span>
            <span className={`text-xs font-medium ${ds.text.muted}`}>
              {goal.percentage.toFixed(0)}%
            </span>
          </div>
          <div className={`h-2 ${ds.bg.tertiary} rounded-full overflow-hidden`}>
            <div
              className={`h-full rounded-full transition-all ${barColor}`}
              style={{ width: `${cappedPercentage}%` }}
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className={`text-xs ${ds.text.muted}`}>
            {formatDateRange(goal.startDate, goal.endDate)}
          </span>
          <div className="flex items-center gap-2">
            {goal.paceStatus && (
              <span
                className={`text-xs font-medium ${
                  goal.paceStatus === 'ahead'
                    ? 'text-green-600'
                    : goal.paceStatus === 'behind'
                      ? 'text-red-600'
                      : ds.status.info.text
                }`}
              >
                {paceLabels[goal.paceStatus]}
              </span>
            )}
            <span className={`text-xs ${ds.text.muted}`}>
              {formatCurrency(goal.remaining)} left
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function GoalFormModal({
  isOpen,
  onClose,
  onSave,
  goal,
  categories,
  tags,
  accounts,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  goal: GoalWithProgress | null;
  categories: CategoryOption[];
  tags: TagOption[];
  accounts: AccountOption[];
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'spending' | 'saving'>('spending');
  const [targetAmount, setTargetAmount] = useState('');
  const [trackingMethod, setTrackingMethod] = useState<'category' | 'tag' | 'account'>('category');
  const [categoryId, setCategoryId] = useState('');
  const [tagId, setTagId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [timeframe, setTimeframe] = useState<'year' | 'quarter' | 'custom' | 'open'>('year');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [status, setStatus] = useState('active');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (goal) {
      setName(goal.name);
      setType(goal.type as 'spending' | 'saving');
      setTargetAmount(String(goal.targetAmount));
      setTrackingMethod(goal.trackingMethod as 'category' | 'tag' | 'account');
      setCategoryId(goal.categoryId ?? '');
      setTagId(goal.tagId ?? '');
      setAccountId(goal.accountId ?? '');
      setStatus(goal.status);
      if (goal.startDate || goal.endDate) {
        setTimeframe('custom');
        setStartDate(goal.startDate ?? '');
        setEndDate(goal.endDate ?? '');
      } else {
        setTimeframe('open');
        setStartDate('');
        setEndDate('');
      }
    } else {
      // Defaults for new goal
      setName('');
      setType('spending');
      setTargetAmount('');
      setTrackingMethod('category');
      setCategoryId('');
      setTagId('');
      setAccountId('');
      setStatus('active');
      setTimeframe('year');
      const year = new Date().getFullYear();
      setStartDate(`${year}-01-01`);
      setEndDate(`${year}-12-31`);
    }
  }, [goal, isOpen]);

  const applyPreset = (preset: string) => {
    const year = new Date().getFullYear();
    const month = new Date().getMonth(); // 0-indexed
    setTimeframe(preset as 'year' | 'quarter' | 'custom' | 'open');

    if (preset === 'year') {
      setStartDate(`${year}-01-01`);
      setEndDate(`${year}-12-31`);
    } else if (preset === 'quarter') {
      const qStart = Math.floor(month / 3) * 3;
      const qStartMonth = String(qStart + 1).padStart(2, '0');
      const qEndMonth = String(qStart + 3).padStart(2, '0');
      const qEndDay = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][qStart + 2];
      setStartDate(`${year}-${qStartMonth}-01`);
      setEndDate(`${year}-${qEndMonth}-${qEndDay}`);
    } else if (preset === 'open') {
      setStartDate('');
      setEndDate('');
    }
  };

  const handleSubmit = async () => {
    setSaving(true);
    const data = {
      name,
      type,
      targetAmount: parseFloat(targetAmount),
      trackingMethod,
      categoryId: trackingMethod === 'category' ? categoryId : undefined,
      tagId: trackingMethod === 'tag' ? tagId : undefined,
      accountId: trackingMethod === 'account' ? accountId : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      ...(goal ? { status } : {}),
    };

    const url = goal ? `/api/goals/${goal.id}` : '/api/goals';
    const method = goal ? 'PATCH' : 'POST';

    await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    setSaving(false);
    onSave();
    onClose();
  };

  const handleDelete = async () => {
    if (!goal) return;
    await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' });
    onSave();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} title={goal ? 'Edit Goal' : 'New Goal'} onClose={onClose}>
      <div className="space-y-4">
        {/* Name */}
        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Name</label>
          <input
            className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
            placeholder="e.g. 2026 Travel Budget"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        {/* Type */}
        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Type</label>
          <div className="flex gap-2">
            {(['spending', 'saving'] as const).map((t) => (
              <button
                key={t}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  type === t ? 'bg-slate-900 dark:bg-slate-600 text-white' : `${ds.bg.tertiary} ${ds.text.secondary}`
                }`}
                onClick={() => setType(t)}
              >
                {t === 'spending' ? 'Spending' : 'Saving'}
              </button>
            ))}
          </div>
        </div>

        {/* Target Amount */}
        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>
            Target Amount
          </label>
          <input
            className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
            placeholder="5000"
            type="number"
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
          />
        </div>

        {/* Tracking Method */}
        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Track By</label>
          <div className="flex gap-2">
            {(['category', 'tag', 'account'] as const).map((m) => (
              <button
                key={m}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  trackingMethod === m
                    ? 'bg-slate-900 dark:bg-slate-600 text-white'
                    : `${ds.bg.tertiary} ${ds.text.secondary}`
                }`}
                onClick={() => setTrackingMethod(m)}
              >
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Tracking Target */}
        <div>
          {trackingMethod === 'category' && (
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">Select category...</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.parentId ? '  ' : ''}{c.name}
                </option>
              ))}
            </select>
          )}
          {trackingMethod === 'tag' && (
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={tagId}
              onChange={(e) => setTagId(e.target.value)}
            >
              <option value="">Select tag...</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          )}
          {trackingMethod === 'account' && (
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value="">Select account...</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* Timeframe */}
        <div>
          <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Timeframe</label>
          <div className="flex gap-2 mb-2">
            {[
              { key: 'year', label: 'This Year' },
              { key: 'quarter', label: 'This Quarter' },
              { key: 'custom', label: 'Custom' },
              { key: 'open', label: 'Open-ended' },
            ].map((p) => (
              <button
                key={p.key}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  timeframe === p.key
                    ? 'bg-slate-900 dark:bg-slate-600 text-white'
                    : `${ds.bg.tertiary} ${ds.text.secondary}`
                }`}
                onClick={() => applyPreset(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {timeframe !== 'open' && (
            <div className="flex gap-2">
              <input
                className={`flex-1 rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setTimeframe('custom'); }}
              />
              <input
                className={`flex-1 rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setTimeframe('custom'); }}
              />
            </div>
          )}
        </div>

        {/* Status (edit only) */}
        {goal && (
          <div>
            <label className={`block text-sm font-medium ${ds.text.secondary} mb-1`}>Status</label>
            <select
              className={`w-full rounded-lg border ${ds.border.default} px-3 py-2 text-sm ${ds.bg.primary} ${ds.text.primary}`}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="active">Active</option>
              <option value="completed">Completed</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between pt-2">
          {goal ? (
            <button className="text-sm text-red-600 hover:text-red-700 font-medium" onClick={handleDelete}>
              Delete Goal
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button disabled={!name || !targetAmount || saving} onClick={handleSubmit}>
              {saving ? 'Saving...' : goal ? 'Update' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function GoalsPageContent() {
  const searchParams = useSearchParams();
  const [goals, setGoals] = useState<GoalWithProgress[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [tags, setTags] = useState<TagOption[]>([]);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<GoalWithProgress | null>(null);
  const statusFilter = searchParams.get('status') || 'active';

  const loadData = useCallback(async () => {
    const [goalsRes, catsRes, tagsRes, accsRes] = await Promise.all([
      fetch(`/api/goals?status=${statusFilter}`).then((r) => r.json()),
      fetch('/api/categories').then((r) => r.json()),
      fetch('/api/tags').then((r) => r.json()),
      fetch('/api/accounts').then((r) => r.json()),
    ]);
    setGoals(goalsRes.goals);
    setCategories(catsRes.categories);
    setTags(tagsRes.tags);
    setAccounts(accsRes.accounts);
  }, [statusFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleEdit = (goal: GoalWithProgress) => {
    setEditingGoal(goal);
    setShowModal(true);
  };

  const handleNew = () => {
    setEditingGoal(null);
    setShowModal(true);
  };

  const tabs = [
    { label: 'Active', value: 'active' },
    { label: 'Completed', value: 'completed' },
    { label: 'Archived', value: 'archived' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className={`text-2xl font-bold ${ds.text.heading}`}>Goals</h1>
        <Button onClick={handleNew}>New Goal</Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {tabs.map((tab) => (
          <a
            key={tab.value}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              statusFilter === tab.value
                ? 'bg-slate-900 dark:bg-slate-700 text-white'
                : `${ds.text.secondary} hover:bg-slate-100 dark:hover:bg-slate-700`
            }`}
            href={`/goals?status=${tab.value}`}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Goal Cards Grid */}
      {goals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className={`${ds.text.muted} mb-4`}>
              {statusFilter === 'active'
                ? 'No active goals yet. Create one to start tracking.'
                : `No ${statusFilter} goals.`}
            </p>
            {statusFilter === 'active' && (
              <Button onClick={handleNew}>Create Your First Goal</Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {goals.map((goal) => (
            <GoalCard key={goal.id} goal={goal} onEdit={handleEdit} />
          ))}
        </div>
      )}

      <GoalFormModal
        accounts={accounts}
        categories={categories}
        goal={editingGoal}
        isOpen={showModal}
        tags={tags}
        onClose={() => setShowModal(false)}
        onSave={loadData}
      />
    </div>
  );
}

export default function GoalsPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading goals...</div>}>
      <GoalsPageContent />
    </Suspense>
  );
}
```

**Step 3: Commit**

```bash
git add src/app/\(routes\)/goals/ src/components/side-nav.tsx
git commit -m "feat(goals): add goals page with cards, form modal, and sidebar nav"
```

---

### Task 6: Add Goals dashboard widget

**Files:**
- Modify: `src/app/page.tsx`

**Step 1: Add the Goals widget to the dashboard**

Add a goals state and fetch to `DashboardPageContent`, alongside the existing `Promise.all`:

```typescript
const [goalsData, setGoalsData] = useState<GoalWithProgress[]>([]);
```

Add `fetch('/api/goals?status=active').then((r) => r.json())` to the existing `Promise.all`, and set `setGoalsData(goalsRes.goals)`.

Then add a new section before the Pinned Insights block (before line ~511). The widget only renders if there are active goals:

```typescript
{goalsData.length > 0 && (
  <Card>
    <CardHeader>
      <div className="flex items-center justify-between">
        <div className={`text-sm font-semibold ${ds.text.secondary}`}>Goals</div>
        <a
          className={`text-xs ${ds.status.info.text} hover:text-blue-700 font-medium`}
          href="/goals"
        >
          View All →
        </a>
      </div>
    </CardHeader>
    <CardContent>
      <div className="space-y-3">
        {goalsData.slice(0, 4).map((goal) => {
          const barColor =
            goal.paceStatus === 'ahead'
              ? 'bg-green-500'
              : goal.paceStatus === 'behind'
                ? 'bg-red-500'
                : 'bg-blue-500';
          return (
            <div key={goal.id}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm font-medium ${ds.text.secondary} truncate`}>
                  {goal.name}
                </span>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${ds.text.primary}`}>
                    {formatCurrency(goal.currentAmount)} / {formatCurrency(goal.targetAmount)}
                  </span>
                  <span className={`text-xs ${ds.text.muted}`}>
                    {goal.percentage.toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className={`h-1.5 ${ds.bg.tertiary} rounded-full overflow-hidden`}>
                <div
                  className={`h-full rounded-full ${barColor}`}
                  style={{ width: `${Math.min(goal.percentage, 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </CardContent>
  </Card>
)}
```

Add the `GoalWithProgress` type at the top of the file (or inline it).

**Step 2: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(goals): add goals progress widget to dashboard"
```

---

### Task 7: Add Goals to cloud sync

**Files:**
- Modify: `src/lib/cloud-sync/types.ts`
- Modify: `src/lib/cloud-sync/sync.ts`
- Modify: `tests/helpers/db.ts` (already done in Task 2)

**Step 1: Add GoalExportSchema to `src/lib/cloud-sync/types.ts`**

Add after `TagExportSchema` (around line 113):

```typescript
export const GoalExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  targetAmount: z.number(),
  trackingMethod: z.string(),
  categoryId: z.string().nullable(),
  tagId: z.string().nullable(),
  accountId: z.string().nullable(),
  startDate: z.string().nullable(),
  endDate: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type GoalExport = z.infer<typeof GoalExportSchema>;
```

Add `goals: z.array(GoalExportSchema).optional()` to `SyncDataSchema` (after the tags line).

Add `goals: z.number().optional()` to the `recordCounts` object in `SyncMetadataSchema`.

**Step 2: Update export in `src/lib/cloud-sync/sync.ts`**

Add `GoalExport` to the import from `./types`.

Add `getPrisma().goal.findMany()` to the `Promise.all` in `exportDatabase()`.

Add the goals mapping to the `data` object:

```typescript
goals: goals.map(
  (g): GoalExport => ({
    id: g.id,
    name: g.name,
    type: g.type,
    targetAmount: g.targetAmount,
    trackingMethod: g.trackingMethod,
    categoryId: g.categoryId,
    tagId: g.tagId,
    accountId: g.accountId,
    startDate: g.startDate,
    endDate: g.endDate,
    status: g.status,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  })
),
```

Add `goals: (data.goals || []).length` to `metadata.recordCounts`.

**Step 3: Update import in `src/lib/cloud-sync/sync.ts`**

Add `await tx.goal.deleteMany();` to the delete block (before `await tx.categoryBudget.deleteMany()`).

Add the import block after the tags import:

```typescript
if (data.goals) {
  for (const goal of data.goals) {
    await tx.goal.create({
      data: {
        id: goal.id,
        name: goal.name,
        type: goal.type,
        targetAmount: goal.targetAmount,
        trackingMethod: goal.trackingMethod,
        categoryId: goal.categoryId,
        tagId: goal.tagId,
        accountId: goal.accountId,
        startDate: goal.startDate,
        endDate: goal.endDate,
        status: goal.status,
        createdAt: new Date(goal.createdAt),
        updatedAt: new Date(goal.updatedAt),
      },
    });
  }
}
```

**Step 4: Commit**

```bash
git add src/lib/cloud-sync/types.ts src/lib/cloud-sync/sync.ts
git commit -m "feat(goals): add goals to cloud sync export/import"
```

---

### Task 8: Lint, typecheck, and fix issues

**Files:**
- All modified files

**Step 1: Run full check**

Run: `npm run check`
Expected: All checks pass (typecheck, lint, format).

**Step 2: Fix any issues**

Run: `npm run lint:fix` to auto-fix formatting.
Address any remaining TypeScript or lint errors manually.

**Step 3: Run all tests**

Run: `npm run test`
Expected: All existing tests still pass, new goal tests pass.

**Step 4: Commit if any fixes were needed**

```bash
git add -A
git commit -m "chore: fix lint and type issues from goals implementation"
```

---

### Task 9: Update ROADMAP.md

**Files:**
- Modify: `docs/ROADMAP.md`

**Step 1: Mark Goals tasks as complete**

Update the Goals & Spending/Savings Tracking section in the roadmap to check off the completed tasks.

**Step 2: Commit**

```bash
git add -f docs/ROADMAP.md
git commit -m "docs: mark goals tracking tasks as complete in roadmap"
```
