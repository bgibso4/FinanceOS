# FinanceOS Roadmap

## High Priority Features

### 1. AI Chat Analyst (Conversational Analytics)
**Status:** Placeholder exists, needs implementation  
**Value:** Huge - natural language queries for spending insights

**Features:**
- Ask questions like "How much did I spend on groceries last month?"
- "Show me my top 5 expenses this quarter"
- "Am I spending more on dining out than last year?"
- Generate custom charts from queries
- Trend analysis and predictions
- Budget recommendations based on spending patterns

**Implementation:**
- Use OpenAI API or similar for natural language processing
- Convert queries to SQL/Prisma queries
- Generate chart specs dynamically
- Add conversation history
- Pin insights to dashboard

---

### 2. Automatic Bank Imports (Plaid Integration)
**Status:** Not started  
**Cost:** Free tier available, ~$1-2/month for personal use  
**Value:** High - eliminates manual CSV imports

**Features:**
- Connect bank accounts via Plaid Link
- Daily automatic transaction sync
- Support for checking, savings, credit cards
- Secure token storage
- Error handling and reconnection flow

**Implementation:**
- Add Plaid SDK
- Create connection flow UI
- Store encrypted access tokens
- Set up daily sync job (cron or webhook)
- Map Plaid transaction format to our schema
- Use `externalId` field for deduplication

---

### 3. Recurring Transactions & Subscription Management
**Status:** Not started  
**Value:** High - visibility into recurring costs

**Features:**
- Auto-detect recurring transactions (same merchant, similar amount, regular interval)
- Subscription dashboard showing all recurring charges
- Alerts for price changes
- Cancellation reminders for unused subscriptions
- Annual cost projections
- Categorize by type (streaming, utilities, memberships, etc.)

**Detection algorithm:**
- Find transactions with same merchant
- Check for regular intervals (weekly, monthly, annual)
- Allow amount variance (±10%)
- Manual override to mark/unmark as recurring

---

### 4. Enhanced Reports & Month-End Closing
**Status:** Basic monthly snapshots exist, needs expansion  
**Value:** Medium-High - better financial tracking

**Features:**
- **Month-end closing workflow:**
  - Review all uncategorized transactions
  - Reconcile account balances
  - Confirm all linked transactions
  - Generate comprehensive report

- **Report types:**
  - Monthly summary (income, spending, savings rate, top categories)
  - Year-over-year comparison
  - Quarterly reports
  - Tax preparation report (categorized by tax category)
  - Net worth tracking over time
  - Custom date range reports

- **Export options:**
  - PDF reports
  - CSV exports
  - Charts as images

---

## Additional Feature Ideas

### 5. Goals & Savings Tracking
**Value:** Medium

**Features:**
- Set savings goals (emergency fund, vacation, down payment)
- Track progress toward goals
- Allocate income to specific goals
- Visual progress indicators
- Projected completion dates

---

### 6. Bill Reminders & Due Dates
**Value:** Medium

**Features:**
- Mark transactions as bills with due dates
- Upcoming bills dashboard
- Notifications for upcoming due dates
- Track paid vs unpaid bills
- Late payment alerts

---

### 7. Multi-Currency Support
**Status:** Core features complete, enhancements planned  
**Value:** Low-Medium (depends on use case)

**Completed Features:** ✅
- ✅ Support multiple currencies (USD, CAD, EUR, GBP)
- ✅ Manual exchange rate management
- ✅ Automatic conversion to base currency in analytics
- ✅ Display in home currency with original currency shown
- ✅ Currency settings in General settings
- ✅ Per-account currency configuration
- ✅ Smart display (base currency hidden, others labeled)

**Future Enhancements:**
- [ ] Automatic rate pulling from live APIs (e.g., exchangerate-api.io)
- [ ] Historical exchange rates (use rate from transaction date, not current rate)
- [ ] Rate update scheduling (daily/weekly auto-refresh)
- [ ] Exchange rate history tracking
- [ ] Multi-currency budgets

---

### 8. Tags & Custom Fields
**Status:** Tags field exists but not fully utilized  
**Value:** Medium

**Features:**
- Custom tags for transactions (travel, business, reimbursable, etc.)
- Filter and analyze by tags
- Tag-based budgets
- Bulk tagging
- Tag suggestions based on patterns

---

### 9. Split Transactions (Enhanced)
**Status:** Basic split exists in API, not in UI  
**Value:** Medium

**Features:**
- Split a single transaction into multiple categories
- Example: $100 Target purchase → $60 groceries + $40 household
- Show split transactions in analytics
- Edit/delete splits

---

### 10. Mobile App / PWA
**Value:** High (for on-the-go access)

**Features:**
- Progressive Web App (installable)
- Mobile-optimized UI
- Quick transaction entry
- Receipt photo capture
- Offline support with sync

---

### 11. Shared Finances / Multi-User
**Value:** Medium (for couples/families)

**Features:**
- Multiple user accounts
- Shared and personal transactions
- Split expenses between users
- Permission levels
- Individual and combined views

---

### 12. Investment Tracking
**Value:** Medium

**Features:**
- Track brokerage accounts
- Stock/crypto holdings
- Portfolio performance
- Dividend tracking
- Asset allocation visualization

---

### 13. Tax Preparation Helper
**Value:** Medium (seasonal)

**Features:**
- Tag transactions as tax-deductible
- Generate tax category reports
- Export for tax software
- Track business expenses
- Mileage tracking

---

### 14. Data Backup & Export
**Value:** Medium (peace of mind)

**Features:**
- Automatic backups
- Export all data (JSON, CSV)
- Import from other finance apps
- Data portability

---

### 15. Advanced Analytics
**Value:** Medium

**Features:**
- Spending trends over time
- Seasonal spending patterns
- Merchant loyalty analysis
- Category drift detection
- Anomaly detection (beyond outliers)
- Predictive budgeting

---

## Technical Improvements

### Performance
- Optimize large transaction queries
- Add pagination to transaction lists
- Lazy load charts
- Cache analytics calculations

### Testing
- Add unit tests for core logic
- E2E tests for critical flows
- Test coverage for deduplication

### Developer Experience
- Better error handling
- Loading states
- Optimistic updates
- Better TypeScript types

---

## Recently Completed ✅

- ✅ **Multi-currency support (core features)** - Manual exchange rates, conversion, and smart display
- ✅ Improved deduplication system (merchantNormalized, importHash, externalId)
- ✅ Linked transaction tracking (returns, reimbursements, offsets)
- ✅ Net spending calculations (linked transactions reduce original month)
- ✅ Dark mode with design system
- ✅ Fixed timezone issues (UTC storage)
- ✅ Updated to Next.js 16 & React 19
- ✅ Manual categorization confidence boost
- ✅ Improved outliers detection
- ✅ Review queue for unlinked credits
- ✅ Expandable sidebar navigation for Settings and Transactions
- ✅ Custom date range filtering
- ✅ Account visibility in transaction lists and modals
- ✅ Import duplicate transaction visibility

---

## Notes

**Philosophy:** Keep it local-first, privacy-focused, and fast. Only add external services when the value is clear and the cost is reasonable.

**Next Session Priorities:**
1. AI Chat Analyst (biggest value add)
2. Recurring transactions detection
3. Enhanced reports
4. Plaid integration (if desired)
