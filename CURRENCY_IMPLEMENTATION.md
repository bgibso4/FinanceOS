# Multi-Currency Implementation

## Overview
Added comprehensive multi-currency support to FinanceOS with automatic conversion to base currency for analytics.

## What's Been Implemented

### 1. Database Schema ✅
- **ExchangeRate model**: Stores currency conversion rates (e.g., CAD → USD)
- **UserSettings model**: Stores user's base currency preference (default: USD)
- **Account.currency field**: Already existed, now fully utilized

### 2. Currency Utility Library ✅
**Location**: `src/lib/currency.ts`

Key functions:
- `formatAmount()` - Smart formatting that shows currency only when needed
- `convertAmount()` - Convert between currencies using exchange rates
- `formatAmountWithConversion()` - Show both native and converted amounts
- `getCurrencySymbol()` / `getCurrencyFlag()` - Display helpers
- `getExchangeRate()` - Retrieve rates with fallback logic

### 3. API Endpoints ✅
- `GET/POST /api/exchange-rates` - Manage exchange rates
- `DELETE /api/exchange-rates/[id]` - Remove exchange rates
- `GET/PATCH /api/settings` - User settings (base currency)

### 4. Settings UI ✅
**Location**: Settings → General tab

Features:
- **Base Currency selector**: Choose USD, CAD, EUR, or GBP
- **Exchange Rates table**: View all configured rates with last updated date
- **Add Exchange Rate form**: Simple 3-field form (From, To, Rate)
- **Quick link to Google**: Check current exchange rates
- **Account currency field**: Added to both account creation and edit modal

### 5. Account Management ✅
- Currency dropdown in account creation form (4-column grid now)
- Currency field in account edit modal
- Warning when changing currency on accounts with existing transactions
- Default currency: USD

## How It Works

### Display Strategy
1. **USD transactions** (base currency): Show as `$1,234.56` (no currency code)
2. **CAD transactions** (non-base): Show as `$1,234.56 CAD`
3. **With conversion enabled**: Show as `$1,234.56 CAD ($889.68 USD)`

### Analytics Strategy
- All amounts converted to base currency before aggregation
- User sees holistic view of spending across all currencies
- Individual transactions still show native currency

### Exchange Rates
- **Manual management**: User sets rates in settings
- **No historical rates**: Single current rate per currency pair
- **Bidirectional**: Can convert both ways (e.g., CAD→USD or USD→CAD)
- **Default rates included**: CAD→USD = 0.72

## Next Steps (Completed in Phase 2!)

### Phase 2: Update Transaction Displays ✅
- ✅ Updated transaction list to show currency using smart formatting
- ✅ Added account currency to transaction type
- ✅ Updated transaction page currency formatter to use new utilities
- ✅ Fetch and use user settings for base currency

### Phase 3: Update Analytics ✅
- ✅ Convert all amounts to base currency in analytics calculations
- ✅ Updated dashboard to show "All amounts in USD" note (dynamic based on base currency)
- ✅ Updated all analytics calculations to convert currencies
- ✅ Merchant totals, category breakdowns, and month buckets all converted

### Phase 4: Import Flow (Future)
- [ ] Respect account currency during CSV import
- [ ] Validate imported amounts match account currency

### Phase 5: Filters & Search (Future)
- [ ] Add currency filter to filter ribbon
- [ ] Allow filtering by account currency
- [ ] Show currency in search results

## Usage Examples

### Setting Up Exchange Rates
1. Go to Settings → General
2. Scroll to "Currency" section
3. Click "Check current rates →" to see live rates
4. Enter: From=CAD, To=USD, Rate=0.72
5. Click "Add Rate"

### Creating a CAD Account
1. Go to Settings → Accounts
2. Enter account details
3. Select "CAD 🇨🇦" from currency dropdown
4. Click "Add account"

### Changing Base Currency
1. Go to Settings → General
2. Select desired base currency from dropdown
3. All analytics will now show in that currency

## Technical Notes

- Exchange rates stored with 4 decimal precision
- Currency codes follow ISO 4217 standard
- Supports USD, CAD, EUR, GBP out of the box
- Easy to add more currencies by updating the dropdowns

## Migration
Run `npx prisma db push` to apply schema changes (already done if you followed the setup).
