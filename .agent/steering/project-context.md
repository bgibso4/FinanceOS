---
inclusion: always
---

# FinanceOS Project Context

## Project Overview
FinanceOS is a local-first personal finance app built with Next.js 16, React, TypeScript, Prisma, and SQLite. It's designed for passive tracking with auto-categorization, analytics-first dashboard, and intelligent transaction management.

## Key Principles
- **Local-first:** All data stored in SQLite, no external dependencies
- **Privacy-focused:** User data never leaves their machine
- **Analytics-first:** Focus on insights, not just transaction lists
- **Automation:** Auto-categorize, detect transfers, link returns
- **Clean UX:** Minimal, fast, intuitive interface

## Tech Stack
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript
- **Styling:** Tailwind CSS 3.4 with custom design system
- **Database:** Prisma 5.22 + SQLite
- **Charts:** Recharts
- **Validation:** Zod

## Architecture Decisions

### Design System
- **Location:** `src/lib/design-system.ts`
- **Usage:** Always use `ds.*` tokens instead of hardcoded Tailwind classes
- **Why:** Centralized theming, dark mode support, maintainability
- **Exception:** Financial colors (green-600, red-600) are semantic and can be hardcoded

### Date Handling
- **Storage:** All dates stored as UTC midnight (no time component)
- **Display:** Show date strings (YYYY-MM-DD) to avoid timezone conversion
- **Why:** Prevents timezone bugs, consistent across all views
- **Implementation:** Use `Date.UTC()` when creating dates, `date.split('T')[0]` when displaying

### Transaction Deduplication
- **Three-tier approach:**
  1. `externalId` (bank-provided ID) - perfect deduplication
  2. `importHash` (SHA256 of accountId + date + amount + merchantNormalized) - fast lookup
  3. `merchantNormalized` matching - fuzzy fallback
- **Merchant normalization:** Strips transaction codes, store numbers, keeps first 2-3 meaningful words

### Linked Transactions
- **Purpose:** Track returns, reimbursements, splits, offsets
- **Schema:** `isOffset`, `linkedTransactionId`, `offsetTransactions` relation
- **Analytics:** Linked transactions reduce spending in the original purchase month
- **UI:** Purple color for linked transactions, blue for transfers

### Color Coding
- 🔵 **Blue:** Transfers (money between your accounts)
- 🟣 **Purple:** Linked transactions (returns, reimbursements)
- 🟢 **Green:** Income/credits
- 🔴 **Red:** Expenses
- 🟡 **Yellow:** Warnings/uncategorized

## File Structure

### Core Libraries
- `src/lib/prisma.ts` - Database client
- `src/lib/categorization.ts` - Auto-categorization logic
- `src/lib/import.ts` - CSV import with deduplication
- `src/lib/analytics.ts` - Dashboard analytics calculations
- `src/lib/filters.ts` - Date range and filter utilities
- `src/lib/reviewQueue.ts` - Review queue logic
- `src/lib/returns.ts` - Linked transaction matching
- `src/lib/design-system.ts` - Centralized styling tokens
- `src/lib/theme.ts` - Dark mode management

### Pages
- `src/app/page.tsx` - Dashboard (overview, charts, quick stats)
- `src/app/(routes)/transactions/page.tsx` - Review queue & all transactions
- `src/app/(routes)/analytics/page.tsx` - Monthly analytics & category breakdown
- `src/app/(routes)/settings/page.tsx` - Accounts, categories, rules, budgets, import

### Components
- `src/components/ui/*` - Reusable UI primitives (Card, Button, Input, etc.)
- `src/components/app-shell.tsx` - Layout with nav and header
- `src/components/side-nav.tsx` - Navigation sidebar
- `src/components/filter-ribbon.tsx` - Date range filters
- `src/components/chart-renderer.tsx` - Chart display

## Database Schema

### Key Models
- **Transaction:** Core transaction data with linked transaction support
- **Account:** Bank accounts/credit cards
- **Category:** Hierarchical categories (groups → categories)
- **Rule:** Auto-categorization rules
- **CategoryBudget:** Monthly budget limits
- **MonthlySnapshot:** Closed month reports

### Important Fields
- `merchantNormalized` - Cleaned merchant name for matching
- `importHash` - Deduplication fingerprint
- `isOffset` - Marks linked transactions (returns, reimbursements)
- `linkedTransactionId` - Links to original transaction
- `confidenceScore` - Auto-categorization confidence (1.0 = manual)

## Common Patterns

### Adding a New Feature
1. Update schema if needed (add fields to Prisma)
2. Create/update API routes in `src/app/api/`
3. Add business logic to `src/lib/`
4. Update UI components
5. Use design system tokens for styling
6. Test in both light and dark modes

### Styling Guidelines
- Use `ds.*` tokens from design system
- Keep financial colors semantic (green = positive, red = negative)
- Neutral backgrounds in modals (`bg-slate-50 dark:bg-slate-900`)
- Colored text headers for sections
- Use `!bg-*` for Button color overrides

### Date Handling
```typescript
// Creating dates (always UTC)
const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

// Displaying dates (avoid timezone conversion)
const dateStr = tx.date.split('T')[0]; // "2025-12-23"

// Parsing CSV dates
const [year, month, day] = dateStr.split(/[-\/]/).map(Number);
const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
```

## Known Issues & Quirks

### Prisma Version
- Staying on Prisma 5.22 (v7 requires Node 20.19+ and major breaking changes)
- Using `url: env("DATABASE_URL")` in schema
- No adapter needed for SQLite in v5

### Tailwind Version
- Staying on Tailwind 3.4 (v4 requires complete config rewrite)
- Using PostCSS plugin approach

### Next.js 16 Changes
- All dynamic route params are now Promises (must await)
- Server Actions enabled by default
- Turbopack is default dev server

## Development Workflow

### Running the App
```bash
npm run dev          # Start dev server
npx prisma studio    # View database
npx prisma generate  # Regenerate client after schema changes
```

### Database Migrations
```bash
# Manual approach (we use this to preserve data)
sqlite3 prisma/dev.db 'ALTER TABLE "Transaction" ADD COLUMN newField TEXT;'
npx prisma generate
npx prisma migrate resolve --applied <migration-name>
```

### Testing Features
- Use browser console for debugging
- Check server logs for API issues
- Use test scripts in `test-*.js` for backend testing

## Future Considerations

### Scalability
- Current SQLite approach works great for personal use
- If scaling to multiple users, consider PostgreSQL
- Current schema supports 100k+ transactions easily

### Data Privacy
- All data is local
- No analytics or tracking
- User has full control
- Easy to backup (just copy dev.db)

### Extensibility
- Modular architecture makes features easy to add
- API routes are RESTful and well-structured
- Design system makes UI changes easy
- Prisma makes schema changes safe

## Contact & Collaboration
This is a personal project for solo use. The codebase is clean and well-documented for future development.

---

**Last Updated:** December 24, 2025  
**Version:** 0.1.0  
**Status:** Active Development
