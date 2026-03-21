# FinanceOS "Carbon" Redesign — Design Spec

## Overview

A UI redesign of FinanceOS with a "quiet strength" aesthetic: monochrome base, precision over decoration, one muted accent color used surgically. The design should feel like a matte black watch — clearly high-quality, zero flash.

Reference mocks: `design-mocks/dashboard-carbon.html` (dark), `design-mocks/dashboard-carbon-light-sunrise.html` (light).

### Departures from REDESIGN-BRIEF.md

The original brief suggested display fonts (Plus Jakarta Sans), atmospheric grid backgrounds, accent-colored card borders, glow effects, and count-up animations. These were all explored during brainstorming and **intentionally rejected** in favor of the "quiet strength" direction. Specifically:

- **Typography**: Two fonts (Inter + JetBrains Mono) instead of three. No display/heading font — Inter at different weights provides enough hierarchy without decoration.
- **Backgrounds**: Pure neutral, no grid pattern or noise texture. The quality comes from restraint.
- **Card borders**: Neutral only, no accent coloring. Border-hover is just slightly more visible, not colored.
- **Animations**: Fade-in only. No count-up, no scale on hover, no glow.

This spec takes precedence over the brief wherever they conflict.

## What Changes

- Design tokens (colors, typography, spacing) in `design-system.ts` and `globals.css`
- All UI components in `src/components/ui/`
- Side navigation in `src/components/side-nav.tsx`
- All page layouts (dashboard, analytics, transactions, reports, goals, settings)

## What Does NOT Change

- Architecture (App Router, API routes, Prisma)
- Feature set (no new features)
- Data model (Prisma schema untouched)
- Cloud sync / bank integrations
- The `design-system.ts` pattern (expand it, don't replace it)

---

## Design System

### Color Palette

All colors defined as CSS custom properties in `globals.css` using hex/rgba values directly (not RGB triplets). This is a breaking change from the current format (`--background: 255, 255, 255` consumed via `rgb(var(--background))`).

**Migration strategy**: Replace old RGB-triplet variables with the new hex-based tokens in one atomic step. Update `tailwind.config.js` to consume hex values directly. Remove the old `rgb(var(...))` wrappers. All components switch to the new `ds` object simultaneously.

**Dark mode (default):**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#09090b` | Page background |
| `--bg-surface` | `#0f0f11` | Sidebar background |
| `--bg-card` | `#141416` | Card backgrounds |
| `--bg-elevated` | `#1a1a1d` | Hover states on cards |
| `--border` | `rgba(255,255,255,0.06)` | Default borders |
| `--border-hover` | `rgba(255,255,255,0.1)` | Hover borders |
| `--text-primary` | `#fafafa` | Headings, merchant names, key data |
| `--text-secondary` | `#a1a1aa` | Expense amounts, chart lines |
| `--text-muted` | `#52525b` | Labels, dates, meta text |
| `--accent` | `#6882a0` | Net Worth value, active nav indicator, income chart line |
| `--accent-dim` | `rgba(104,130,160,0.1)` | Reserved for subtle accent backgrounds |
| `--green` | `#4ade80` | Income amounts, positive changes |
| `--red` | `#f87171` | Expense warnings, negative changes |

**Light mode ("sunrise"):**

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-base` | `#f4f2f0` | Page background (warm off-white) |
| `--bg-surface` | `#ece9e6` | Sidebar background |
| `--bg-card` | `#fdfcfb` | Card backgrounds (near-cream) |
| `--bg-elevated` | `#efece9` | Hover states |
| `--border` | `rgba(0,0,0,0.06)` | Default borders |
| `--border-hover` | `rgba(0,0,0,0.11)` | Hover borders |
| `--text-primary` | `#1a1a1e` | Headings, key data |
| `--text-secondary` | `#52525b` | Secondary text, expense amounts |
| `--text-muted` | `#a1a1aa` | Labels, meta text |
| `--accent` | `#4a6a8a` | Net Worth, active nav, chart line |
| `--green` | `#16a34a` | Income (deeper for light bg contrast) |
| `--red` | `#dc2626` | Expenses/warnings (deeper for light bg contrast) |

### Color Usage Rules

- **Accent color** is used in exactly 3 places: Net Worth metric value, active sidebar indicator, income line on cash flow chart. Nowhere else.
- **Green** only for income amounts and positive change indicators.
- **Red** only for budget warnings (>80% used) and negative change indicators. Expense amounts use `--text-secondary`, not red.
- **No color tints** on backgrounds. All backgrounds are pure neutral (no blue, green, or warm cast in dark mode).
- **No glow effects, no colored borders, no gradient backgrounds.**

### Typography

| Role | Font | Weight | Example sizes |
|------|------|--------|---------------|
| All UI text | Inter | 400, 500, 600, 700 | 11-20px |
| Numbers/data | JetBrains Mono | 400, 500, 600 | 11-28px |

- `font-variant-numeric: tabular-nums` on all monospace numbers for alignment.
- `letter-spacing: -1px` on large metric values (28px+).
- `-webkit-font-smoothing: antialiased` on body.
- No serif fonts. No display fonts.

### Spacing

All spacing values defined as CSS custom properties for future scalability:

| Token | Default | Usage |
|-------|---------|-------|
| `--space-xs` | `4px` | Tight gaps |
| `--space-sm` | `8px` | Inner element spacing |
| `--space-md` | `16px` | Card gaps, section spacing |
| `--space-lg` | `24px` | Card padding, content gap |
| `--space-xl` | `32px` | Section margins, vertical page padding |
| `--space-2xl` | `40px` | Horizontal page padding |

### Sizing Variables

Font sizes also as CSS variables to enable future "zoom" without structural changes:

```css
--text-xs: 11px;
--text-sm: 13px;
--text-base: 15px;
--text-lg: 20px;
--text-metric: 28px;
```

### Theme-Aware Utility Tokens

Some values must differ between dark and light mode but are used in components without explicit theme checks. Define these as CSS variables that switch per theme:

```css
:root {
  --track-bg: rgba(0,0,0,0.05);    /* budget bar, progress tracks */
  --grid-line: rgba(0,0,0,0.04);   /* chart grid lines */
}
.dark {
  --track-bg: rgba(255,255,255,0.04);
  --grid-line: rgba(255,255,255,0.03);
}
```

### design-system.ts Mapping

The `ds` object switches from hardcoded Tailwind classes to CSS variable references. New structure:

```typescript
export const ds = {
  text: {
    primary: 'text-[var(--text-primary)]',
    secondary: 'text-[var(--text-secondary)]',
    muted: 'text-[var(--text-muted)]',
  },
  bg: {
    base: 'bg-[var(--bg-base)]',
    surface: 'bg-[var(--bg-surface)]',
    card: 'bg-[var(--bg-card)]',
    elevated: 'bg-[var(--bg-elevated)]',
  },
  border: {
    default: 'border-[var(--border)]',
    hover: 'hover:border-[var(--border-hover)]',
  },
  status: {
    success: { text: 'text-[var(--green)]', bg: 'bg-[var(--green)]/10' },
    error: { text: 'text-[var(--red)]', bg: 'bg-[var(--red)]/10' },
  },
  // interactive, table, card patterns follow the same approach
};
```

The `status`, `interactive`, and `table` categories from the existing `ds` are preserved and mapped to the new variables. No categories are removed.

### tailwind.config.js Updates

```javascript
colors: {
  'bg-base': 'var(--bg-base)',
  'bg-surface': 'var(--bg-surface)',
  'bg-card': 'var(--bg-card)',
  'bg-elevated': 'var(--bg-elevated)',
  'text-primary': 'var(--text-primary)',
  'text-secondary': 'var(--text-secondary)',
  'text-muted': 'var(--text-muted)',
  accent: 'var(--accent)',
  green: 'var(--green)',
  red: 'var(--red)',
}
```

Old color names (`background`, `foreground`, `muted`, `card`, `card-foreground`) are removed. The `.glass` class in globals.css is removed.

---

## Layout

### Page Shell

- **Max-width**: 1200px
- **Left-aligned** (not centered) when viewport exceeds max-width
- **Padding**: 32px 40px
- **Content grid**: 2 columns, `1.6fr 1fr`, 24px gap

### Sidebar

- **Collapsed**: 56px wide, icon-only, fixed position
- **Expanded**: 200px wide, shows labels + submenus (toggle via pin button at sidebar bottom)
- **Default state**: collapsed
- **Persistence**: collapsed/expanded state saved to `localStorage`
- **Active indicator**: 2px bar on left edge, colored `--accent`
- **Icons**: Lucide React (already in project dependencies)
- **Bottom**: AI Analyst button (lightbulb icon from Lucide, same style as other nav items) with `⌘K` hint text below in 9px JetBrains Mono at 50% opacity. Triggers `onToggleAnalyst` prop. In expanded mode, shows "Finance Analyst" label with ⌘K badge right-aligned.
- **Dark mode toggle**: Sun/Moon icon (Lucide), placed above the AI Analyst button. Toggles `.dark` class on `<html>`, saves preference to `localStorage`. Same behavior as current implementation.

### Responsive Behavior

| Breakpoint | Behavior |
|------------|----------|
| < 768px | Sidebar hidden, hamburger menu, single-column layout |
| 768-1024px | Sidebar collapsed (no expand option), 2-column layout |
| > 1024px | Sidebar with pin toggle, full 2-column layout |

---

## Components

### Metric Cards (Dashboard Hero)

- **Layout**: 4 cards joined as one strip with 1px divider gaps
- **Background**: `--bg-card`, hover: `--bg-elevated`
- **Border-radius**: 12px on outer corners only
- **Content**: uppercase label (11px, `--text-muted`), large value (28px JetBrains Mono), change indicator, optional sparkline at 40% opacity
- **Animation**: fade-in with 50ms stagger between cards

### Content Cards

- **Background**: `--bg-card`
- **Border**: 1px solid `--border`, hover: `--border-hover`
- **Border-radius**: 12px
- **Padding**: 24px
- **Title**: 13px Inter 600, with optional "View All" link in `--text-muted`

### Transaction List Items

- **Layout**: flex row, merchant+meta left, amount right
- **Separator**: 1px `--border` bottom (not on last item)
- **Merchant**: 13px Inter 500, `--text-primary`
- **Meta**: 11px, `--text-muted`, format: `Category · Date`
- **Amount**: 13px JetBrains Mono 500, tabular-nums
  - Expense: `--text-secondary` (not red)
  - Income: `--green`
- **No category badges** — category is plain text inline with date

### Budget Progress Bars

- **Track**: 3px height, `var(--track-bg)` background
- **Fill**: `--text-muted` default, `--red` at 0.6 opacity when >80%
- **Labels**: category name in `--text-secondary`, amount in JetBrains Mono `--text-muted`

### Upcoming Bills

- **Layout**: same as transaction items (name+date left, amount right)
- **Separator**: 1px borders like transactions
- **Amount**: `--text-secondary`

### Charts (Recharts)

- **Income line**: solid, `--accent` at 0.7 opacity, 1.5px stroke
- **Expense line**: dashed (4 3 pattern), `--text-muted`, 1.5px stroke
- **Fill/gradient**: very subtle, `--accent` at 0.06 opacity fading to 0
- **Grid lines**: `var(--grid-line)`
- **Axis labels**: 10px JetBrains Mono, `--text-muted`
- **No colored backgrounds on chart area**

### Buttons, Inputs, Modals

- Follow the same neutral palette
- Primary button: `--text-primary` on `--bg-elevated`, no accent color
- Input borders: `--border`, focus: `--border-hover`
- Modals: `--bg-card` background, `--border` border
- Focus rings: 2px `--accent` outline with 2px offset for keyboard navigation (`focus-visible` only, not on click)

### Select, Tabs, Drawer, Badge

- **Select**: Same styling as Input. Dropdown uses `--bg-card` with `--border`. Selected item background: `--bg-elevated`.
- **Tabs**: Text-only, no background on inactive tabs. Active tab: `--text-primary` with 2px `--accent` underline. Inactive: `--text-muted`.
- **Drawer**: Slides from right, `--bg-card` background, `--border` left border. Overlay: `rgba(0,0,0,0.5)`.
- **Badge**: Still used for status indicators (e.g., account types, rule match types) but NOT for transaction categories. Neutral style: `--text-secondary` text on `--track-bg` background, 3px border-radius. Status variants (success/error) use the respective `ds.status` colors.

### Chart Tooltips

- Background: `--bg-card`
- Border: 1px `--border`
- Border-radius: 8px
- Label: `--text-muted`, 11px
- Value: `--text-primary`, 13px JetBrains Mono
- No shadow, no arrow/caret

---

## Page Guidelines

The dashboard has a pixel-precise mock. Other pages follow the same design language without individual mocks — the Carbon tokens and components are the spec. General rules for all pages:

### Transactions Page

- **Filter bar**: row of Select dropdowns + text Input for search, same neutral styling
- **Table**: full-width, same row styling as dashboard transaction list but with additional columns (date, account, category, amount). Row hover: `--bg-elevated`.
- **Review Queue tab**: same table with a left accent bar (`--accent`, 2px) on items needing review
- **Subscriptions tab**: grouped by frequency, same list styling

### Settings Page

- Keep existing tab-based layout
- **Forms**: Label above input, `--text-secondary` labels, standard Input/Select components
- **Tables** (accounts list, rules list): same neutral styling, hover rows

### Analytics, Reports, Goals

- Apply Carbon tokens to existing layouts
- Charts follow the Recharts spec above
- Cards follow the Content Card spec

### Empty States

- Centered in content area
- Icon: Lucide icon in `--text-muted`, 48px
- Heading: 16px `--text-primary`
- Description: 13px `--text-muted`
- Optional action button: standard Button component

### Loading/Skeleton States

- Skeleton blocks: `--bg-elevated` with subtle pulse animation (opacity 0.5 to 1, 1.5s ease infinite)
- Match the shape/size of the content they replace (metric cards, transaction rows, chart area)

### Error States

- Same layout as empty states
- Icon: AlertCircle from Lucide in `--red`
- "Try Again" button if applicable

---

## Animation

- **Page load**: fade-in (0.4s ease) with 50ms stagger on metric cards
- **Card hover**: background color transition (0.15s) only. No scale, no shadow change, no glow.
- **Sparklines**: 40% opacity default, 80% on card hover
- **No page transitions** (keep navigation instant)
- **No count-up animations on numbers** (data appears immediately)

---

## Implementation Order

Following the mock-driven workflow from REDESIGN-BRIEF.md:

### Phase 1: Design Tokens
1. Update `globals.css` with all CSS custom properties (dark + light mode)
2. Update `design-system.ts` to reference CSS variables instead of hardcoded Tailwind classes
3. Update `tailwind.config.js` to map CSS variables
4. Verify: `npm run test:unit` + visual check both themes

### Phase 2: Components
Priority order:
1. Side Navigation (`side-nav.tsx`) — collapsed/expanded, icons, pin toggle, dark mode toggle
2. Card component (`card.tsx`) — new variants including joined metric strip
3. Button, Input, Select, Badge, Modal, Tabs, Drawer — neutral palette update
4. Skeleton/loading component — pulse animation
5. Verify: `npm run test:unit` + visual check

### Phase 3: Pages
1. Dashboard (most important — matches the approved mock)
2. Transactions
3. Analytics
4. Reports
5. Goals
6. Settings
7. After each page: `npx playwright test` + visual review

### Phase 4: Polish
1. Loading/skeleton states
2. Empty states
3. Error states
4. Responsive behavior verification (375px, 768px, 1280px)
5. Final: `npm run check` (typecheck + lint + format)

---

## Test Strategy

### Existing Tests (44 files — must keep passing)
- `npm run test:unit` after every component change
- `npm run test:integration` after any data flow changes
- `npx playwright test` after page-level changes
- `npm run check` before any commit

### New Tests (build coverage during redesign)
- Add component unit tests in `tests/unit/components/ui/` as each component is redesigned
- Test: default render, dark/light mode variants, hover states, loading states

### E2E Guardrails
- Dashboard renders with content
- Dark mode toggle works
- Zero JS console errors
- Dashboard loads under 10 seconds
- Responsive at 375px, 768px, 1280px

---

## Reference Files

| File | Purpose |
|------|---------|
| `design-mocks/dashboard-carbon.html` | Approved dark mode dashboard mock |
| `design-mocks/dashboard-carbon-light-sunrise.html` | Approved light mode dashboard mock |
| `src/lib/design-system.ts` | Design token source (expand, don't replace) |
| `src/app/globals.css` | CSS variable definitions |
| `tailwind.config.js` | Tailwind theme extension |
| `src/app/layout.tsx` | Font loading, theme script |
