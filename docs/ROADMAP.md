# FinanceOS Roadmap

All feature planning and task tracking for FinanceOS development.

**Philosophy:** Keep it local-first, privacy-focused, and fast. Only add external services when the value is clear and the cost is reasonable.

> Items sorted by **impact-to-effort ratio** (highest first).

---

## 1. AI Chat Analyst (Full Redesign)
**Impact:** Huge | **Effort:** High | **Status:** Needs full rebuild with LLM

A basic heuristic agent exists (drawer UI, canned query patterns, pin-to-dashboard) but it's too limited to be useful. Needs a ground-up redesign with real LLM integration.

**What exists (to be replaced):**
- Drawer UI with text input
- Heuristic query matching (no LLM)
- Chart rendering + pin to dashboard

**Tasks:**
- [ ] Design new conversational UI
- [ ] Integrate LLM API (OpenAI / Anthropic)
- [ ] Build query-to-Prisma translation layer
- [ ] Generate chart specs dynamically from LLM output
- [ ] Add conversation history and context
- [ ] Pin insights to dashboard
- [ ] Budget recommendations based on spending patterns

---

## 2. Transaction Splitting (Blocked - Needs Design)
**Impact:** Medium | **Effort:** Medium-High | **Status:** Blocked on design

A basic split API exists but the approach needs rethinking. The current implementation deletes the parent transaction, which breaks sync deduplication. This is more complex than expected and needs a proper design before building further.

**Problem:** Current split API deletes the parent transaction, losing its `externalId`. On next Plaid/Teller sync, the original transaction would be re-imported as a duplicate.

**Possible solutions:**
1. Keep parent as hidden "shell" with `isSplit: true` - preserves `externalId` for dedup, children reference parent
2. Preserve `externalId` on first child only - dedup works but loses parent-child relationship
3. Track consumed `externalId`s in separate table - skip during sync even if no transaction has them

**Tasks (once design is decided):**
- [ ] Choose and document the design approach
- [ ] Update schema to support split relationships
- [ ] Rewrite split API to preserve `externalId` for dedup
- [ ] Build split UI in transaction modal
- [ ] Show split indicator in transaction list
- [ ] Allow editing/undoing splits

---

## 3. Mobile App / PWA
**Impact:** High | **Effort:** High | **Status:** Not started

Huge daily usability win — makes the app useful throughout the week instead of just at a desk. PWA approach builds on the existing Next.js app rather than starting from scratch.

- [ ] Progressive Web App (installable)
- [ ] Mobile-optimized UI
- [ ] Quick transaction entry
- [ ] Receipt photo capture
- [ ] Offline support with sync

---

## 4. Bill Reminders & Due Dates
**Impact:** Medium | **Effort:** Medium | **Status:** Not started

- [ ] Mark transactions as bills with due dates
- [ ] Upcoming bills dashboard
- [ ] Notifications for upcoming due dates
- [ ] Track paid vs unpaid bills
- [ ] Late payment alerts

---

## 5. Data Backup & Export
**Impact:** Medium | **Effort:** Medium | **Status:** Not started

Cloud sync handles device-to-device transfer. This is about user-facing export and portability.

- [ ] Export all data (JSON, CSV)
- [ ] Import from other finance apps (Mint, YNAB, etc.)
- [ ] Automatic local backups
- [ ] Data portability

---

## 6. Goals & Spending/Savings Tracking
**Impact:** Medium | **Effort:** Medium | **Status:** Not started

Flexible goal tracking that goes beyond monthly category budgets. Goals can track spending OR saving, tied to tags or categories, over custom timeframes. This is distinct from category budgets (recurring monthly caps) — goals are for projects, events, and longer-term targets.

**Use cases:**
- "2026 Travel Budget" — spending goal of $5,000/year, tracked by the "Travel" category
- "Ontario Camping Trip" — spending goal of $2,000, tracked by the "Ontario Camping Trip" tag, open-ended
- "Emergency Fund" — savings goal of $10,000, tracked by account balance or manual progress
- "Wedding" — spending goal of $15,000, tracked by "Wedding" tag, spans multiple categories (venue, catering, attire)
- "Business Expenses Q1" — spending goal of $3,000, tracked by "Business" tag, Jan–Mar timeframe

**Goal model:**
- Name, type (spending/saving), target amount
- Track by: tag, category, or manual
- Timeframe: yearly, custom date range, or open-ended
- Progress: sum of matching transactions vs target

**Tasks:**
- [ ] Goal model (name, type, target, trackBy, timeframe)
- [ ] Goals API (CRUD)
- [ ] Goals dashboard page with progress bars
- [ ] Goal creation/edit UI
- [ ] Progress calculation (sum transactions by tag or category within timeframe)
- [ ] Goal progress display on tag cards in Settings
- [ ] Cloud sync support for goals

---

## 7. Enhanced Reports & Month-End Closing
**Impact:** Medium-High | **Effort:** Medium | **Status:** Basic monthly/cash flow reports exist, needs closing workflow

Monthly detail, cash flow trailing-12, and net worth reports are built. Missing the structured closing workflow and additional report types.

**Month-end closing workflow:**
- [ ] Review all uncategorized transactions
- [ ] Reconcile account balances
- [ ] Confirm all linked transactions
- [ ] Generate comprehensive report

**Report types:**
- [x] Monthly summary (income, spending by category)
- [x] Cash flow trailing 12 months with averages
- [ ] Year-over-year comparison
- [ ] Tax preparation report (categorized by tax category)
- [ ] Custom date range reports

**Export options:**
- [ ] PDF reports
- [ ] CSV exports
- [ ] Charts as images

---

## 8. Tax Preparation Helper
**Impact:** Medium | **Effort:** Medium | **Status:** Not started

Seasonal value. Overlaps with tags and reports — best built after those.

- [ ] Tag transactions as tax-deductible
- [ ] Generate tax category reports
- [ ] Export for tax software
- [ ] Track business expenses
- [ ] Mileage tracking

---

## 9. Multi-Currency Enhancements
**Impact:** Low-Medium | **Effort:** Medium | **Status:** Core features complete

Niche — only matters for users with foreign accounts. Core currency support (5 currencies, manual rates, conversion, per-account config) is done.

- [ ] Automatic rate pulling from live APIs (e.g., exchangerate-api.io)
- [ ] Historical exchange rates (use rate from transaction date, not current rate)
- [ ] Rate update scheduling (daily/weekly auto-refresh)
- [ ] Exchange rate history tracking
- [ ] Multi-currency budgets

---

## 10. Advanced Analytics
**Impact:** Medium | **Effort:** High | **Status:** Not started

- [ ] Spending trends over time
- [ ] Seasonal spending patterns
- [ ] Merchant loyalty analysis
- [ ] Category drift detection
- [ ] Anomaly detection (beyond outliers)
- [ ] Predictive budgeting

---

## 11. Investment Tracking (Net Worth Phase 3+)
**Impact:** Medium | **Effort:** High | **Status:** Planned
**Design Doc:** `docs/feature/NET_WORTH_EVOLUTION.md`

- [ ] Holdings/positions tracking
- [ ] Performance vs benchmarks
- [ ] Portfolio performance & dividend tracking
- [ ] Asset allocation visualization
- [ ] LLM-powered analysis

---

## 12. Shared Finances / Multi-User

**Impact:** Medium | **Effort:** Very High | **Status:** Not started

Foundational architecture change — auth, permissions, data isolation.

- [ ] Multiple user accounts
- [ ] Shared and personal transactions
- [ ] Split expenses between users
- [ ] Permission levels
- [ ] Individual and combined views

---

## Technical Improvements

### Performance
- [x] Connection pooling and query optimization
- [ ] Add pagination to transaction lists
- [ ] Lazy load charts
- [ ] Cache analytics calculations

### Testing
- [x] Unit tests for core logic (categorization, import, analytics, currency, filters, returns, sync, recurring detection)
- [x] Integration tests for all API routes (accounts, transactions, categories, rules, budgets, analytics, reports, review queue, settings, exchange rates, splits, cloud sync, recurring)
- [x] E2E tests (dashboard, CSV import)
- [ ] Expand E2E coverage for more flows
- [ ] Test coverage reporting and thresholds

### Developer Experience
- [x] ESLint 9 + Prettier + Husky pre-commit hooks
- [x] GitHub Actions CI (lint, typecheck, unit, integration, E2E, build)
- [ ] Better error handling
- [ ] Loading states
- [ ] Optimistic updates
- [ ] Better TypeScript types (reduce `any` usage)

---

## Completed ✅

### Account Sync & Bank Connections
- [x] **Sync All Accounts** - One-click sync with lookback window, parallel dry-run preview, per-account breakdown, simultaneous sync with progressive status, partial failure handling
- [x] **Sync Hardening** - Retry with exponential backoff, 429 rate-limit handling with Retry-After, request timeouts, AbortSignal support
- [x] **Plaid Integration** - Bank account linking, sync, reconnect flows, shared sync utilities
- [x] **Teller Integration** - Bank account linking with encrypted token storage, transaction sync, reconnect
- [x] **Import & Deduplication** - CSV import with 3-tier dedup (`externalId`, `importHash`, normalized merchant), date format detection, duplicate reporting

### Cloud Sync
- [x] **E2E Encrypted Sync** - AES-256-GCM + PBKDF2 with Cloudflare R2, auto-sync with 2s debounce, settings UI, sync ID + passphrase flow

### Tags & Custom Fields
- [x] **Custom Tagging** - Tag model with color support, TagInput component with autocomplete/inline creation, tag management settings (create/rename/recolor/delete with cascade), bulk add/remove tags, filter ribbon tag filter, colored pill display in transaction list, cloud sync

### Recurring Transactions & Subscriptions
- [x] **Recurring Detection Algorithm** - Strategy-pattern-based median interval matching with amount sub-clustering (±10%), billing day consistency (±3 days), two-signal confirmation (interval regularity + amount consistency), active/lapsed detection, price history tracking
- [x] **Subscriptions Tab** - Tab under Transactions with summary cards (monthly/annual cost, active count), filter tabs (All/Active/Lapsed/Cancelled), grouped list by frequency, edit/add modals, price change alerts
- [x] **Soft-delete for dismissed items** - Prevents false-positive subscriptions from reappearing after re-detection via `isManualOverride` flag
- [x] **Detection triggers** - Auto-runs after Sync All and CSV import; manual "Run Detection" button
- [x] **Cloud sync integration** - RecurringTransaction data included in export/import payloads

### Transactions & Categorization
- [x] **Rules Engine v2** - Compound conditions (merchant, note, amount, account) with AND logic, regex support, negation. AI-powered rule suggestions via OpenAI. Bulk management UI with drag-and-drop reorder, search/filter, rule tester, live preview. 65+ keyword catalog with dynamic DB category resolution
- [x] **Auto-categorization** - Three-tier pipeline: custom rules (0.98), keyword catalog (0.72), uncategorized fallback (0.3). Manual override to 1.0
- [x] **Transaction Returns/Linking** - 4-tier matching with scoring, link/unlink UI
- [x] **Review Queue** - 5-category queue (uncategorized, low confidence, recent, unlinked returns, outliers)

### Reports & Analytics
- [x] **Dashboard** - Account balances, net worth, sparklines, pinned charts, filters
- [x] **Analytics page** - Monthly breakdown, budget tracking, category drill-down, outlier flagging
- [x] **Net Worth Reports** - Snapshots, trend visualization, grouped breakdowns, comparison mode, backfill historical data, inflation-adjusted calculations (manual annual rates), forecasting/projections (strategy pattern, linear projection)
- [x] **Cash Flow Reports** - Trailing 12-month summary with averages, monthly detail, backfill
- [x] **Account Classification & Net Worth Tracking** - trackingMode (cash_flow/balance_only), net worth snapshots, trend charts, comparison, backfill

### Budgets & Finance
- [x] **Budgets** - Default + monthly overrides, budget vs actual tracking in analytics
- [x] **Multi-currency support (core)** - 5 currencies, manual exchange rates, conversion, per-account config, smart display

### UI & UX
- [x] **Dark mode** with design system
- [x] Expandable sidebar navigation
- [x] Drag-and-drop account reordering (@dnd-kit integration in settings)
- [x] Custom date range filtering
- [x] Account visibility in transaction lists and modals
- [x] Import duplicate transaction visibility
- [x] Manual categorization confidence boost

### Technical
- [x] **Comprehensive test suite** - 552 tests (unit, integration, E2E) across 26 test files
- [x] **CI/CD pipeline** - GitHub Actions (lint, typecheck, unit, integration, E2E, build)
- [x] **Linting & formatting** - ESLint 9, Prettier, Husky pre-commit hooks
- [x] **Memory optimization** - Connection pooling, query optimization, selective field loading
- [x] Fixed timezone issues (UTC storage)
- [x] Updated to Next.js 16 & React 19
