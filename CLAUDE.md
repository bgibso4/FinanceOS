# FinanceOS - Project Context

Local-first personal finance app for Mint-style passive tracking with auto-categorization, analytics dashboard, and review queue for exceptions.

## Tech Stack

- **Framework**: Next.js 14 (App Router) + React 19 + TypeScript
- **Styling**: Tailwind CSS + custom design system (`src/lib/design-system.ts`)
- **Database**: Prisma ORM + SQLite (`prisma/dev.db`)
- **Charts**: Recharts
- **Validation**: Zod

## Quick Start

```bash
npm install
npx prisma generate
npm run dev
```

App runs at http://localhost:3000

## Project Structure

```
src/
├── app/
│   ├── (routes)/           # Page routes
│   │   ├── page.tsx        # Dashboard (/)
│   │   ├── transactions/   # Transaction views
│   │   └── settings/       # Settings page (single large file with tabs)
│   └── api/                # API routes
│       ├── accounts/
│       ├── transactions/
│       ├── categories/
│       ├── rules/
│       ├── budgets/
│       ├── import/         # CSV import
│       └── analytics/
├── components/
│   ├── ui/                 # Reusable components (Button, Modal, Card, etc.)
│   └── side-nav.tsx        # Navigation sidebar
├── lib/
│   ├── prisma.ts           # Prisma client
│   ├── design-system.ts    # Centralized styling (ds.text, ds.bg, ds.border)
│   ├── import.ts           # CSV import + deduplication logic
│   └── categorization.ts   # Auto-categorization + merchant normalization
prisma/
├── schema.prisma           # Database schema
├── seed.js                 # Demo data seeder
└── dev.db                  # SQLite database
```

## Key Database Models

### Account

- `id`, `name`, `type`, `institution`, `currency`, `isActive`
- Types: checking, credit, brokerage, retirement, crypto, cash, loan, other

### Transaction

- `id`, `date`, `amount`, `merchant`, `merchantNormalized`
- `accountId`, `categoryId`, `confidenceScore`
- `externalId` - for external integrations (unique per account)
- `importHash` - SHA256 for deduplication
- `isTransfer`, `transferGroupId` - transfer detection
- `linkedTransactionId` - for returns/reimbursements

### Category

- `id`, `name`, `type` (income/expense), `parentId` (for grouping)

### Rule

- Auto-categorization rules with `matchType`, `matchValue`, `priority`

## API Patterns

All routes use Next.js App Router with Zod validation:

```typescript
// Dynamic params
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ...
}
```

Standard responses:

- GET lists: `{ accounts: [...] }`
- POST create: returns created object
- PATCH update: returns updated object
- DELETE: `{ success: true }`

## Import & Deduplication

CSV import (`src/lib/import.ts`) uses three-tier deduplication:

1. **externalId** - unique constraint on (accountId, externalId)
2. **importHash** - SHA256 of accountId|date|amount|merchantNormalized
3. **Normalized merchant match** - date + amount + merchantNormalized

## Auto-Categorization

In `src/lib/categorization.ts`:

1. Apply custom rules (confidence: 0.98)
2. Check keyword catalog (confidence: 0.72)
3. Return uncategorized (confidence: 0.3)

Manual categorization sets confidence to 1.0.

## Design System

Use `ds` object from `src/lib/design-system.ts`:

```typescript
ds.text.primary; // Text colors
ds.bg.secondary; // Background colors
ds.border.default; // Border colors
ds.status.success; // Status colors (bg, text, border)
```

## UI Patterns

- **Settings page**: Single file with tab-based navigation (`?tab=accounts`)
- **Modals**: Use `<Modal isOpen={} onClose={} title="">` component
- **Forms**: Controlled inputs with state, submit via fetch to API
- **Refresh pattern**: Call `refresh()` after mutations to reload all data

## Environment

Uses `.env` with `DATABASE_URL` for Prisma.

Required for cloud sync:

```
NEXT_PUBLIC_SYNC_WORKER_URL=https://financeos-sync.bgibso4.workers.dev
SYNC_ENCRYPTION_KEY=<base64-encoded 256-bit key>
```

Generate an encryption key with: `npx tsx scripts/generate-sync-key.ts`

## Cloud Sync

End-to-end encrypted sync using Cloudflare R2. Data is encrypted server-side with AES-256-GCM before upload.

### Architecture

```
src/lib/cloud-sync/
├── encryption.ts    # AES-256-GCM encryption with env var key
├── sync.ts          # Database export/import
├── r2-client.ts     # Cloudflare Worker API client
├── auto-sync.ts     # Debounced auto-sync (2s after writes)
├── use-sync.ts      # React hook
├── types.ts         # Zod schemas for sync payload
└── index.ts         # Module exports

workers/sync-api/    # Cloudflare Worker (separate tsconfig)
└── src/index.ts     # R2 upload/download endpoints
```

### Security Model

- **Server-side encryption**: Data encrypted with AES-256-GCM before upload
- **Auto-generated key**: 256-bit key stored in `.env` (no passphrase to remember)
- **Unguessable paths**: UUID v4 sync IDs (128-bit entropy)
- **Zero-knowledge**: Cloudflare cannot read your data
- **Bank tokens NOT synced**: Plaid/Teller credentials stay device-local

### User Flow

1. **Setup**: One-click enable → generates Sync ID → initial push
2. **Auto-sync**: Every database write triggers sync after 2s debounce
3. **Connect new device**: Copy Sync ID + `SYNC_ENCRYPTION_KEY` to new device's `.env` → pull from cloud

### Key APIs

```typescript
// Manual sync trigger
import { triggerSync } from '@/lib/cloud-sync';
await triggerSync('push'); // or 'pull'

// Check sync status
import { useSync } from '@/lib/cloud-sync';
const { status, lastSync, error } = useSync();
```

### Cloudflare Worker Deployment

```bash
cd workers/sync-api
npm install
npx wrangler login
npx wrangler r2 bucket create financeos-sync
npx wrangler deploy
```

Worker URL will be: `https://financeos-sync.<subdomain>.workers.dev`

### Testing

```bash
npm run test:unit -- encryption    # Encryption tests
npm run test:integration           # Full sync round-trip tests
```

For testing, use `setPrismaClient()` to inject test database:

```typescript
import { setPrismaClient, resetPrismaClient } from '@/lib/cloud-sync';
setPrismaClient(testPrisma);
// ... run tests
resetPrismaClient();
```

### Troubleshooting

**Check if sync is working:**

```bash
curl "https://financeos-sync.bgibso4.workers.dev/metadata?syncId=YOUR_SYNC_ID"
```

**Find Sync ID in browser:**

```javascript
localStorage.getItem('financeos-sync-id');
```

**Lost encryption key:** Cloud data is unrecoverable without the key. Disable sync and set up again with a new key (local data preserved).

## Code Quality & Linting

This project uses a comprehensive linting and formatting setup that runs automatically.

### Available Commands

```bash
npm run lint          # Check for ESLint issues (errors block, warnings allowed)
npm run lint:fix      # Auto-fix ESLint issues
npm run format        # Format all files with Prettier
npm run format:check  # Check formatting without changes
npm run typecheck     # Run TypeScript type checking
npm run check         # Run all checks (typecheck + lint + format)
```

### Pre-commit Hooks

Husky + lint-staged automatically runs on every commit:

- **JS/TS files**: ESLint fix + Prettier format
- **JSON/CSS/MD files**: Prettier format

Commits will fail if there are ESLint errors (warnings are allowed).

### Configuration Files

| File                | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `eslint.config.mjs` | ESLint 9 flat config (TypeScript, React, Prettier)         |
| `.prettierrc`       | Prettier rules (single quotes, semicolons, 100 char width) |
| `.editorconfig`     | Cross-editor consistency (indentation, line endings)       |
| `.husky/pre-commit` | Pre-commit hook running lint-staged                        |

### Key Rules

- **Formatting**: Single quotes, semicolons, 2-space indent, 100 char line width
- **Unused variables**: Prefix with `_` to ignore (e.g., `_unused`, `catch (_err)`)
- **Console logs**: Only `console.warn` and `console.error` allowed (others trigger warnings)
- **React**: Self-closing components, no useless fragments, props sorted
- **TypeScript**: `any` types trigger warnings, unused vars trigger warnings

### Agent Workflow

When making code changes:

1. Write your code
2. Run `npm run lint:fix` to auto-fix formatting and simple issues
3. Address any remaining errors manually
4. Commit - the pre-commit hook will verify everything passes

For CI/automated workflows:

```bash
npm run check  # Fails if typecheck, lint errors, or formatting issues
```

## Key Conventions

- All dates stored in UTC
- Amounts: negative = expense, positive = income
- Tags stored as JSON string: `"[]"`
- merchantNormalized: lowercase, cleaned of common prefixes/suffixes
