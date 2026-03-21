# Friedrik Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign FinanceOS UI from generic slate/gray Tailwind to the "Friedrik" quiet luxury aesthetic — warm cognac accent, generous spacing, refined typography — across all 6 pages in both dark and light themes.

**Architecture:** CSS-variable-driven theming via `globals.css`, consumed by an updated `ds` object in `design-system.ts` and Tailwind config. Components switch from hardcoded slate classes to CSS variable references. Pages are restyled one at a time, verified against the feature inventory checklist after each.

**Tech Stack:** Next.js 14 + React 19 + TypeScript + Tailwind CSS + Recharts. New deps: `lucide-react` for sidebar icons, `next/font/google` for JetBrains Mono.

**Key Reference Docs:**
- Design spec: `docs/superpowers/specs/2026-03-20-carbon-redesign-design.md`
- Feature inventory: `docs/superpowers/specs/2026-03-21-page-feature-inventory.md`
- Approved dark mock: `design-mocks/dashboard-friedrik-dark-b.html`
- Approved light mock: `design-mocks/dashboard-friedrik.html`
- Page mocks: `design-mocks/pages/*.html`

---

## Phase 1: Design Tokens

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install lucide-react**

```bash
npm install lucide-react
```

- [ ] **Step 2: Verify install succeeded**

```bash
npm ls lucide-react
```
Expected: `lucide-react@X.X.X`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add lucide-react for sidebar icons"
```

---

### Task 2: Update globals.css with Friedrik tokens

**Files:**
- Modify: `src/app/globals.css`

Replace the entire `:root` and `.dark` blocks with the Friedrik palette. Keep chat-markdown styles. Remove `.glass` class.

- [ ] **Step 1: Replace CSS variables and remove .glass**

Replace the `:root { ... }` block with:
```css
:root {
  --bg-base: #f5f3f0;
  --bg-surface: #ebe8e4;
  --bg-card: #ffffff;
  --bg-elevated: #efece9;
  --border: rgba(0,0,0,0.06);
  --border-hover: rgba(0,0,0,0.10);
  --text-primary: #2a2826;
  --text-secondary: #6a6460;
  --text-muted: #a8a098;
  --accent: #8a6040;
  --green: #5a7a5a;
  --red: #984a42;
  --track-bg: rgba(0,0,0,0.05);
  --grid-line: rgba(0,0,0,0.04);
  --card-shadow: 0 1px 3px rgba(0,0,0,0.04);

  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
  --space-2xl: 48px;

  --text-xs: 11px;
  --text-sm: 13px;
  --text-base: 15px;
  --text-lg: 20px;
  --text-metric: 28px;
}
```

Replace the `.dark { ... }` block with:
```css
.dark {
  --bg-base: #0b0b0b;
  --bg-surface: #101010;
  --bg-card: #171717;
  --bg-elevated: #1e1e1e;
  --border: rgba(255,255,255,0.06);
  --border-hover: rgba(255,255,255,0.10);
  --text-primary: #e8e4de;
  --text-secondary: #9a9690;
  --text-muted: #6a6660;
  --accent: #9a7a58;
  --green: #6a9a68;
  --red: #a06058;
  --track-bg: rgba(255,255,255,0.04);
  --grid-line: rgba(255,255,255,0.03);
  --card-shadow: none;

  /* Spacing and font-size tokens inherit from :root — same in both themes */
}
```

Update the `body` rule:
```css
body {
  background: var(--bg-base);
  color: var(--text-primary);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}
```

Remove the `.glass` and `.dark .glass` rules entirely.

Add skeleton animation at the end (before chat-markdown):
```css
@keyframes skeleton-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.skeleton {
  background: var(--bg-elevated);
  animation: skeleton-pulse 1.5s ease infinite;
}
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit
```
Expected: All tests pass (CSS changes don't affect unit tests)

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "feat: replace CSS variables with Friedrik design tokens"
```

---

### Task 3: Update tailwind.config.js

**Files:**
- Modify: `tailwind.config.js`

- [ ] **Step 1: Replace color mappings and update shadow**

Replace the entire `colors` object in `theme.extend` with:
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
},
```

Replace `boxShadow`:
```javascript
boxShadow: {
  card: 'var(--card-shadow)',
},
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: Pass (no TS changes yet)

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.js
git commit -m "feat: update Tailwind config for Friedrik CSS variables"
```

---

### Task 4: Update design-system.ts

**Files:**
- Modify: `src/lib/design-system.ts`

- [ ] **Step 1: Replace entire ds object**

Replace the full file contents with:
```typescript
// Design system - centralized styling classes
// Uses CSS custom properties defined in globals.css
// Automatically adapts to light/dark mode via .dark class

export const ds = {
  text: {
    primary: 'text-[var(--text-primary)]',
    secondary: 'text-[var(--text-secondary)]',
    muted: 'text-[var(--text-muted)]',
    heading: 'text-[var(--text-primary)]',
  },

  bg: {
    base: 'bg-[var(--bg-base)]',
    surface: 'bg-[var(--bg-surface)]',
    card: 'bg-[var(--bg-card)]',
    elevated: 'bg-[var(--bg-elevated)]',
    // Legacy aliases
    primary: 'bg-[var(--bg-card)]',
    secondary: 'bg-[var(--bg-base)]',
    tertiary: 'bg-[var(--bg-elevated)]',
    hover: 'hover:bg-[var(--bg-elevated)]',
  },

  border: {
    default: 'border-[var(--border)]',
    hover: 'hover:border-[var(--border-hover)]',
  },

  status: {
    success: {
      bg: 'bg-[var(--green)]/10',
      bgRow: 'bg-[var(--green)]/10',
      text: 'text-[var(--green)]',
      border: 'border-[var(--green)]/30',
      accent: 'border-l-4 border-l-[var(--green)]',
    },
    warning: {
      bg: 'bg-[var(--accent)]/10',
      bgRow: 'bg-[var(--accent)]/10',
      text: 'text-[var(--accent)]',
      border: 'border-[var(--accent)]/30',
      accent: 'border-l-4 border-l-[var(--accent)]',
    },
    error: {
      bg: 'bg-[var(--red)]/10',
      bgRow: 'bg-[var(--red)]/10',
      text: 'text-[var(--red)]',
      border: 'border-[var(--red)]/30',
      accent: 'border-l-4 border-l-[var(--red)]',
    },
    info: {
      bg: 'bg-[var(--accent)]/10',
      bgRow: 'bg-[var(--accent)]/10',
      text: 'text-[var(--accent)]',
      border: 'border-[var(--accent)]/30',
      accent: 'border-l-4 border-l-[var(--accent)]',
    },
    purple: {
      bg: 'bg-[var(--accent)]/10',
      bgRow: 'bg-[var(--accent)]/10',
      text: 'text-[var(--accent)]',
      border: 'border-[var(--accent)]/30',
      accent: 'border-l-4 border-l-[var(--accent)]',
    },
  },

  interactive: {
    default:
      'text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]',
    active: 'bg-[var(--bg-elevated)] text-[var(--text-primary)]',
  },

  card: {
    default: 'bg-[var(--bg-card)] border-[var(--border)]',
    hover: 'hover:border-[var(--border-hover)]',
  },

  table: {
    header: 'bg-[var(--bg-base)] text-[var(--text-muted)]',
    row: 'border-[var(--border)] hover:bg-[var(--bg-elevated)]',
    rowAlt: 'bg-[var(--bg-base)]/30',
  },
};

// Helper to combine design system classes
export function combine(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit
```
Expected: All pass. The ds object has same shape — just different class strings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/design-system.ts
git commit -m "feat: update design-system.ts to use CSS variable references"
```

---

### Task 5: Add JetBrains Mono font

**Files:**
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Import and configure JetBrains Mono**

Add import alongside Inter:
```typescript
import { Inter, JetBrains_Mono } from 'next/font/google';
```

Add font config:
```typescript
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500'],
});
```

Update the body className:
```tsx
<body className={`${inter.className} ${jetbrainsMono.variable}`}>
```

- [ ] **Step 2: Add the CSS utility class**

In `globals.css`, add after the `body` rule:
```css
.font-mono {
  font-family: var(--font-mono), ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.animate-fade-in {
  animation: fade-in 0.5s ease both;
}
```

- [ ] **Step 3: Run dev server briefly to verify fonts load**

```bash
npm run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/layout.tsx src/app/globals.css
git commit -m "feat: add JetBrains Mono font for numeric data display"
```

---

### Task 6: Verify Phase 1 — run full test suite

- [ ] **Step 1: Run all checks**

```bash
npm run check
```
Expected: typecheck + lint + format all pass.

- [ ] **Step 2: Run unit tests**

```bash
npm run test:unit
```
Expected: All 18+ unit test files pass.

- [ ] **Step 3: Run integration tests**

```bash
npm run test:integration
```
Expected: All 12 API tests pass.

---

## Phase 2: Components

### Task 7: Redesign Card component

**Files:**
- Modify: `src/components/ui/card.tsx`

- [ ] **Step 1: Update Card, CardHeader, CardContent**

Replace entire file:
```typescript
import React from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-card transition-colors duration-[250ms]',
        'hover:border-[var(--border-hover)]',
        className
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 px-7 py-5 text-[var(--text-primary)]',
        className
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('px-7 pb-7 text-[var(--text-secondary)]', className)}
      {...props}
    />
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm run test:unit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "feat: update Card component with Friedrik design tokens"
```

---

### Task 8: Redesign Button component

**Files:**
- Modify: `src/components/ui/button.tsx`

- [ ] **Step 1: Update Button variants**

Replace the variants object:
```typescript
const variants: Record<string, string> = {
  primary:
    'bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-[var(--border)] focus-visible:outline-[var(--accent)]',
  ghost:
    'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-[var(--border)]',
  outline:
    'border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-[var(--border)]',
  destructive:
    'bg-[var(--red)] text-white hover:opacity-90 focus-visible:outline-[var(--red)]',
};
```

- [ ] **Step 2: Run tests and commit**

```bash
npm run test:unit
git add src/components/ui/button.tsx
git commit -m "feat: update Button component with Friedrik tokens"
```

---

### Task 9: Redesign Input and Select components

**Files:**
- Modify: `src/components/ui/input.tsx`
- Modify: `src/components/ui/select.tsx`

- [ ] **Step 1: Update Input**

Replace the className string:
```typescript
'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] px-3 text-sm shadow-sm transition-colors duration-[250ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]'
```

- [ ] **Step 2: Update Select**

Same className as Input (they should match).

- [ ] **Step 3: Run tests and commit**

```bash
npm run test:unit
git add src/components/ui/input.tsx src/components/ui/select.tsx
git commit -m "feat: update Input and Select with Friedrik tokens"
```

---

### Task 10: Redesign Badge component

**Files:**
- Modify: `src/components/ui/badge.tsx`

- [ ] **Step 1: Update Badge colors**

Replace the colors object:
```typescript
const colors: Record<string, string> = {
  default: 'bg-[var(--track-bg)] text-[var(--text-secondary)]',
  positive: 'bg-[var(--green)]/10 text-[var(--green)]',
  warning: 'bg-[var(--accent)]/10 text-[var(--accent)]',
};
```

Update border-radius in base class from `rounded-full` to `rounded`:

- [ ] **Step 2: Run tests**

```bash
npm run test:unit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/badge.tsx
git commit -m "feat: update Badge with Friedrik tokens"
```

---

### Task 11: Redesign Modal component

**Files:**
- Modify: `src/components/ui/modal.tsx`

- [ ] **Step 1: Update Modal colors**

Replace hardcoded slate classes:
- Backdrop: `bg-black/50 dark:bg-black/70` (remove bg-opacity utilities)
- Modal container: `bg-[var(--bg-card)] border border-[var(--border)]`
- Header: `bg-[var(--bg-base)] border-b border-[var(--border)]`
- Title: `text-[var(--text-primary)]`
- Close button: `text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]`

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/modal.tsx
git commit -m "feat: update Modal with Friedrik tokens"
```

---

### Task 12: Redesign Tabs component

**Files:**
- Modify: `src/components/ui/tabs.tsx`

- [ ] **Step 1: Update to underline-style tabs**

Replace the Tabs component to use text-only tabs with cognac underline:
```typescript
export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-6 text-sm font-medium', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={cn(
            'pb-2 transition-colors duration-[250ms] border-b-2',
            active === tab.id
              ? 'text-[var(--text-primary)] border-[var(--accent)]'
              : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]'
          )}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/tabs.tsx
git commit -m "feat: update Tabs to underline style with Friedrik tokens"
```

---

### Task 13: Redesign Drawer component

**Files:**
- Modify: `src/components/ui/drawer.tsx`

- [ ] **Step 1: Update Drawer colors**

Replace hardcoded classes:
- Overlay: `bg-black/50` (replace `bg-slate-900/30`)
- Panel: `bg-[var(--bg-card)] border-l border-[var(--border)]` (replace `bg-white`)
- Header: `border-b border-[var(--border)]`
- Title: `text-[var(--text-primary)]`
- Close button: `text-[var(--text-muted)] hover:text-[var(--text-primary)]`

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/drawer.tsx
git commit -m "feat: update Drawer with Friedrik tokens"
```

---

### Task 14: Redesign Side Navigation

**Files:**
- Modify: `src/components/side-nav.tsx`

This is the biggest component change. The sidebar goes from 208px text-only to 56px collapsed with icons, expandable to 200px.

- [ ] **Step 1: Add Lucide icon imports**

```typescript
import {
  LayoutGrid, BarChart3, List, FileText, Target, Settings, Lightbulb,
  ChevronRight, PanelLeftClose, PanelLeft,
} from 'lucide-react';
```

- [ ] **Step 2: Add icon mapping to links array**

Update the links array to include icons:
```typescript
const links = [
  { href: '/', label: 'Dashboard', icon: LayoutGrid },
  { href: '/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/transactions', label: 'Transactions', icon: List, submenu: [...] },
  { href: '/reports', label: 'Reports', icon: FileText, submenu: [...] },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/settings', label: 'Settings', icon: Settings, submenu: [...] },
];
```

- [ ] **Step 3: Add collapsed/expanded state**

```typescript
const [isExpanded, setIsExpanded] = useState(() => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('sidebar-expanded') === 'true';
  }
  return false;
});

const toggleExpanded = () => {
  const next = !isExpanded;
  setIsExpanded(next);
  localStorage.setItem('sidebar-expanded', String(next));
};
```

- [ ] **Step 4: Rewrite sidebar JSX**

Replace the `<aside>` with the new collapsed/expanded layout:
- Width: `w-14` collapsed, `w-[200px]` expanded, with `transition-all duration-[250ms]`
- Background: `bg-[var(--bg-surface)]`
- Border: `border-r border-[var(--border)]`
- Logo: "F" collapsed, "FinanceOS" expanded
- Nav items: icon only when collapsed, icon + label when expanded
- Active indicator: 2px left bar in `bg-[var(--accent)]`
- Active icon color: `text-[var(--accent)]`
- Inactive: `text-[var(--text-muted)]` hover `text-[var(--text-secondary)]`
- Submenus: only visible when expanded
- Bottom: theme toggle (Sun/Moon), AI analyst button, pin/unpin toggle
- ⌘K hint in JetBrains Mono, 9px, 50% opacity

- [ ] **Step 5: Run tests**

```bash
npm run test:unit
```

- [ ] **Step 6: Commit**

```bash
git add src/components/side-nav.tsx
git commit -m "feat: redesign sidebar with collapsed/expanded, icons, Friedrik theme"
```

---

### Task 15: Update AppShell for centered layout

**Files:**
- Modify: `src/components/app-shell.tsx`

- [ ] **Step 1: Update layout wrapper**

The main content area should center within the remaining space after the sidebar. Wrap children in a flex container:
```tsx
<div className="flex min-h-screen">
  <SideNav onToggleAnalyst={...} />
  <div className="flex-1 flex justify-center">
    <main className="w-full max-w-[1200px] px-12 py-8">
      {children}
    </main>
  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "feat: center main content layout for Friedrik redesign"
```

---

### Task 16: Verify Phase 2 — full test suite

- [ ] **Step 1: Run all checks**

```bash
npm run check
```

- [ ] **Step 2: Run unit + integration tests**

```bash
npm run test:unit && npm run test:integration
```
Expected: All pass.

- [ ] **Step 3: Visual check**

Start dev server and visually verify:
- Both themes toggle correctly
- Sidebar collapses/expands
- Cards render with correct background/borders
- Buttons, inputs, modals all use new token colors
- No slate/gray remnants visible

---

## Phase 3: Pages

**IMPORTANT:** Before modifying each page, cross-reference against the feature inventory at `docs/superpowers/specs/2026-03-21-page-feature-inventory.md`. Every feature listed there must be preserved. If any features are missing from the mock, add them to the implementation.

### Task 17: Redesign Dashboard page

**Files:**
- Modify: `src/app/page.tsx`

- [ ] **Step 1: Identify all hardcoded slate/color classes in the dashboard**

Search for: `slate-`, `bg-white`, `bg-black`, `text-white`, `text-green-`, `text-red-`, `text-blue-`, `text-amber-`, `border-slate-`

- [ ] **Step 2: Replace with design system tokens**

For each match, replace with the corresponding `ds.*` class or CSS variable reference. Key mappings:
- `bg-white dark:bg-slate-800` → `bg-[var(--bg-card)]`
- `bg-slate-50 dark:bg-slate-900` → `bg-[var(--bg-base)]`
- `text-slate-900 dark:text-slate-100` → `text-[var(--text-primary)]`
- `text-slate-600 dark:text-slate-400` → `text-[var(--text-secondary)]`
- `text-slate-500` → `text-[var(--text-muted)]`
- `text-green-*` → `text-[var(--green)]`
- `text-red-*` → `text-[var(--red)]`
- `border-slate-*` → `border-[var(--border)]`
- All amounts/numbers: add `font-mono` class for JetBrains Mono

- [ ] **Step 3: Update metric cards to use joined strip layout**

The top 4 metric cards should use the joined strip pattern from the mock: `gap-px`, shared border-radius on outer corners.

- [ ] **Step 4: Add sparklines to metric cards**

Each metric card gets a sparkline SVG at 55% opacity, 1.5px stroke.

- [ ] **Step 5: Update Recharts chart colors**

Income line: `var(--accent)` at 0.7 opacity
Expense line: `var(--text-muted)` dashed
Grid: `var(--grid-line)`
Axis labels: `var(--text-muted)`

- [ ] **Step 6: Run E2E tests**

```bash
npx playwright test tests/e2e/dashboard.spec.ts
```
Expected: All dashboard E2E tests pass.

- [ ] **Step 7: Cross-reference feature inventory**

Check every item under "Dashboard" in the feature inventory. Verify no features were lost.

- [ ] **Step 8: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: redesign Dashboard with Friedrik theme"
```

---

### Task 18: Redesign Transactions page

**Files:**
- Modify: `src/app/(routes)/transactions/page.tsx`

- [ ] **Step 1: Replace all hardcoded color classes with CSS variable references**
- [ ] **Step 2: Update tabs to use underline style (Tabs component handles this)**
- [ ] **Step 3: Update filter bar inputs to use new Input/Select components**
- [ ] **Step 4: Update transaction table rows — add `font-mono` to amounts**
- [ ] **Step 5: Update review queue cards — category badges use new Badge component**
- [ ] **Step 6: Cross-reference feature inventory — verify all 3 tabs (Review, All, Subscriptions) work**
- [ ] **Step 7: Run E2E tests**

```bash
npx playwright test
```

- [ ] **Step 8: Commit**

```bash
git add src/app/(routes)/transactions/page.tsx
git commit -m "feat: redesign Transactions page with Friedrik theme"
```

---

### Task 19: Redesign Analytics page

**Files:**
- Modify: `src/app/(routes)/analytics/page.tsx`

- [ ] **Step 1: Replace color classes**
- [ ] **Step 2: Update month selector styling**
- [ ] **Step 3: Update category breakdown rows — progress bars use `var(--track-bg)` track**
- [ ] **Step 4: Update chart colors to match Recharts spec**
- [ ] **Step 5: Cross-reference feature inventory**
- [ ] **Step 6: Run tests and commit**

```bash
npm run test:unit && npx playwright test
git add src/app/(routes)/analytics/page.tsx
git commit -m "feat: redesign Analytics page with Friedrik theme"
```

---

### Task 20: Redesign Reports page

**Files:**
- Modify: `src/app/(routes)/reports/page.tsx`

- [ ] **Step 1: Replace color classes**
- [ ] **Step 2: Update trailing 12-month table grid lines to `var(--grid-line)`**
- [ ] **Step 3: Update summary metric strip**
- [ ] **Step 4: Add `font-mono` to all monetary values in table**
- [ ] **Step 5: Cross-reference feature inventory — verify Net Worth, Cash Flow, Monthly tabs**
- [ ] **Step 6: Run tests and commit**

```bash
npx playwright test
git add src/app/(routes)/reports/page.tsx
git commit -m "feat: redesign Reports page with Friedrik theme"
```

---

### Task 21: Redesign Goals page

**Files:**
- Modify: `src/app/(routes)/goals/page.tsx`

- [ ] **Step 1: Replace color classes**
- [ ] **Step 2: Update goal cards — progress bars 4px height, pace badges use Friedrik colors**
- [ ] **Step 3: Update goal form modal — uses new Input/Select/Button/Modal components**
- [ ] **Step 4: Verify empty state styling**
- [ ] **Step 5: Cross-reference feature inventory**
- [ ] **Step 6: Commit**

```bash
git add src/app/(routes)/goals/page.tsx
git commit -m "feat: redesign Goals page with Friedrik theme"
```

---

### Task 22: Redesign Settings page

**Files:**
- Modify: `src/app/(routes)/settings/page.tsx`

This is the largest page (single file with tabs). Use `max-width: 960px` for this page.

- [ ] **Step 1: Replace all hardcoded color classes**
- [ ] **Step 2: Update tab bar (8 tabs) to underline style**
- [ ] **Step 3: Update account cards, budget tables, category trees, import UI**
- [ ] **Step 4: Update all form elements to use new Input/Select/Button components**
- [ ] **Step 5: Cross-reference feature inventory — verify all 8 tabs**
- [ ] **Step 6: Run tests and commit**

```bash
npm run test:unit && npm run test:integration
git add src/app/(routes)/settings/page.tsx
git commit -m "feat: redesign Settings page with Friedrik theme"
```

---

### Task 22b: Restyle extracted sub-components

**Files:**
- Modify: `src/components/subscriptions-tab.tsx`
- Modify: `src/components/reports/NetWorthSnapshots.tsx`
- Modify: `src/components/rules/RulesTab.tsx`
- Modify: `src/components/rules/ConditionBuilder.tsx`
- Modify: `src/components/sync-settings.tsx`
- Modify: `src/components/chat-analyst.tsx`
- Modify: `src/components/plaid/PlaidAccountLinkSelector.tsx`
- Modify: `src/components/teller/ConnectedInstitutions.tsx`
- Modify: `src/components/teller/TellerAccountLinkSelector.tsx`
- Modify: `src/components/teller/TellerAccountSelector.tsx`

These components are used by the main page files but contain their own hardcoded slate/color classes.

- [ ] **Step 1: For each file, search for hardcoded color classes**

```bash
grep -n "slate-\|bg-white\|text-white\|bg-black" src/components/subscriptions-tab.tsx src/components/reports/NetWorthSnapshots.tsx src/components/rules/RulesTab.tsx src/components/rules/ConditionBuilder.tsx src/components/sync-settings.tsx src/components/chat-analyst.tsx
```

- [ ] **Step 2: Replace with CSS variable references using same patterns as page tasks**
- [ ] **Step 3: Verify each component renders correctly in both themes**
- [ ] **Step 4: Run tests and commit**

```bash
npm run test:unit && npm run test:integration
git add src/components/subscriptions-tab.tsx src/components/reports/ src/components/rules/ src/components/sync-settings.tsx src/components/chat-analyst.tsx src/components/plaid/ src/components/teller/
git commit -m "feat: restyle extracted sub-components with Friedrik tokens"
```

---

### Task 22c: Add ds.bg legacy alias verification

- [ ] **Step 1: Search for all usages of ds.bg.primary, ds.bg.secondary, ds.bg.tertiary, ds.bg.hover**

```bash
grep -rn "ds\.bg\.\(primary\|secondary\|tertiary\|hover\)" src/ --include="*.tsx" --include="*.ts"
```

- [ ] **Step 2: For each usage, verify the new CSS variable mapping is semantically correct**

Mapping:
- `ds.bg.primary` (was `bg-white dark:bg-slate-800`) → now `bg-[var(--bg-card)]` — correct for card surfaces
- `ds.bg.secondary` (was `bg-slate-50 dark:bg-slate-900`) → now `bg-[var(--bg-base)]` — correct for page backgrounds
- `ds.bg.tertiary` (was `bg-slate-100 dark:bg-slate-700`) → now `bg-[var(--bg-elevated)]` — correct for hover/emphasis

If any usage doesn't match the new semantic (e.g., something using `ds.bg.primary` for a page background instead of a card), fix it.

- [ ] **Step 3: Commit any fixes**

---

### Task 22d: Create shared Recharts tooltip component

**Files:**
- Create: `src/components/ui/chart-tooltip.tsx`

- [ ] **Step 1: Create custom tooltip component**

```typescript
import { cn } from '@/lib/cn';

type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color?: string }>;
  label?: string;
  formatter?: (value: number) => string;
};

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  const format = formatter || ((v: number) => v.toLocaleString());
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2">
      {label && <div className="text-[var(--text-muted)] text-[11px] mb-1">{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="text-[var(--text-primary)] text-[13px] font-mono">
          {format(entry.value)}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/chart-tooltip.tsx
git commit -m "feat: add shared Recharts tooltip component with Friedrik styling"
```

---

## Phase 4: Polish

### Task 22e: Implement responsive sidebar behavior

**Files:**
- Modify: `src/components/side-nav.tsx`

- [ ] **Step 1: Add responsive behavior**

Use Tailwind responsive classes + a `useMediaQuery` hook or window.innerWidth check:
- `< 768px`: Sidebar renders as an overlay triggered by a hamburger button (fixed top-left). Add a hamburger icon button that shows/hides the sidebar as a slide-over panel.
- `768-1024px`: Sidebar always collapsed (56px), pin toggle hidden.
- `> 1024px`: Full behavior (collapsed/expanded with pin toggle).

- [ ] **Step 2: Run E2E tests at different viewports**
- [ ] **Step 3: Commit**

```bash
git add src/components/side-nav.tsx
git commit -m "feat: add responsive sidebar (hamburger mobile, forced-collapse tablet)"
```

---

### Task 22f: Implement empty and error state patterns

**Files:**
- Create: `src/components/ui/empty-state.tsx`
- Create: `src/components/ui/error-state.tsx`

- [ ] **Step 1: Create EmptyState component**

```typescript
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="w-12 h-12 text-[var(--text-muted)] mb-4" strokeWidth={1.5} />
      <h3 className="text-[16px] font-medium text-[var(--text-primary)] mb-1">{title}</h3>
      {description && <p className="text-[13px] text-[var(--text-muted)] mb-4">{description}</p>}
      {action}
    </div>
  );
}
```

- [ ] **Step 2: Create ErrorState component**

Same pattern but with `AlertCircle` icon in `text-[var(--red)]` and optional "Try Again" button.

- [ ] **Step 3: Apply to pages that need them** (Goals empty state, Settings empty states)
- [ ] **Step 4: Commit**

```bash
git add src/components/ui/empty-state.tsx src/components/ui/error-state.tsx
git commit -m "feat: add EmptyState and ErrorState components"
```

### Task 23: Sweep for remaining hardcoded colors

- [ ] **Step 1: Search entire codebase for remnants**

```bash
grep -r "slate-" src/ --include="*.tsx" --include="*.ts" -l
grep -r "bg-white" src/ --include="*.tsx" --include="*.ts" -l
```

- [ ] **Step 2: Replace any remaining hardcoded colors with CSS variable references**
- [ ] **Step 3: Commit**

Stage only the changed files (review `git diff --name-only` first):
```bash
git diff --name-only
git add [specific files that changed]
git commit -m "fix: remove remaining hardcoded slate/white color classes"
```

---

### Task 24: Responsive verification

- [ ] **Step 1: Test at 375px (mobile)**
- [ ] **Step 2: Test at 768px (tablet)**
- [ ] **Step 3: Test at 1280px (desktop)**
- [ ] **Step 4: Test at 2560px (4K)**
- [ ] **Step 5: Fix any layout issues found**
- [ ] **Step 6: Commit fixes**

---

### Task 25: Final verification

- [ ] **Step 1: Run full check suite**

```bash
npm run check
```

- [ ] **Step 2: Run all tests**

```bash
npm run test:unit && npm run test:integration
```

- [ ] **Step 3: Run E2E tests**

```bash
npx playwright test
```

- [ ] **Step 4: Visual review — both themes**

Open every page in dark mode and light mode. Verify:
- No slate/gray remnants
- Cognac accent appears only where specified
- Warm ivory text in dark mode
- All numbers use JetBrains Mono
- Sparklines visible at 55% opacity
- Tabs use underline style with cognac active indicator
- Sidebar collapses/expands correctly
- Content is centered
- Budget warning bars use muted red, not cognac
- Income amounts are green, expense amounts are secondary gray

- [ ] **Step 5: Cross-reference complete feature inventory one final time**

Go through every checkbox in `docs/superpowers/specs/2026-03-21-page-feature-inventory.md`.

- [ ] **Step 6: Final commit**

Stage and commit any remaining fixes:
```bash
git diff --name-only
git add [specific files]
git commit -m "feat: complete Friedrik redesign — all pages, both themes"
```
