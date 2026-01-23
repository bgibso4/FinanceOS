# FinanceOS (local-first personal finance cockpit)

React/Next.js app for Mint-style passive tracking: auto-categorization, analytics-first dashboard, review queue for exceptions, soft budgets, monthly snapshots, and a read-only chat analyst with validated query specs.

## Stack

- Next.js 14 (App Router) + React + TypeScript
- Tailwind CSS + minimal shadcn-style primitives
- Prisma + SQLite
- Recharts for charts
- Zod for validation

## Getting started

1. Install dependencies (Node 18+): `npm install`
2. Generate Prisma client + migrate: `npx prisma migrate dev --name init`
3. Seed demo data: `npx prisma db seed`
4. Run dev server: `npm run dev`

## Environment

No external services. Uses SQLite file at `prisma/dev.db`.

## Prisma

- Schema: `prisma/schema.prisma`
- Seed script: `prisma/seed.ts` (accounts, categories, rules, sample transactions)

## API routes (App Router)

- `POST /api/import/transactions` – CSV string + mapping + accountId, dedupe + auto-categorize + transfer detect
- `GET /api/transactions?preset=&startDate=&endDate=&account=&category=&merchant=&tag=` – filtered list
- `POST /api/transactions` – create with optional category
- `PATCH /api/transactions/:id` – update category/tags/note
- `POST /api/transactions/split` – replace a transaction with split parts
- `GET /api/review-queue` – uncategorized / low-confidence / outliers
- `GET|POST /api/accounts`, `PATCH /api/accounts/:id`
- `GET|POST /api/categories`
- `GET|POST /api/rules`, `PATCH /api/rules/:id`
- `GET /api/budgets/:month`, `PUT /api/budgets/:month/:categoryId`
- `POST /api/reports/close-month`, `GET /api/reports/monthly`
- `GET /api/analytics/dashboard` – dashboard blocks with filters
- `POST /api/agent/query` – question → validated AnalyticQuerySpec → computed answer + optional chartSpec

## CSV import mapping example

```json
{
  "csv": "Date,Amount,Description,Memo\n2024-05-01,-42.50,Trader Joes,Groceries\n",
  "mapping": { "date": "Date", "amount": "Amount", "merchant": "Description", "note": "Memo" },
  "accountId": "<account-id>"
}
```

Deduping: date + amount + merchant (with fuzzy contains). Transfer detection: opposite-signed pairs same day across accounts get `isTransfer=true` and linked group id.

## Frontend surfaces

- **Dashboard** (`/`): net cashflow, savings rate, spend by category, top merchants, income vs spend, trend alerts, pinned charts.
- **Transactions** (`/transactions`): Review Queue (uncategorized, low confidence, outliers) + All Transactions table with bulk category apply.
- **Settings** (`/settings`): accounts, categories, rules, budgets, monthly reports, import guidance.
- Persistent nav + filter ribbon + chat analyst drawer with chart pinning (localStorage).

## Testing

Run lint: `npm run lint`. You can add Playwright/React Testing Library as needed.
