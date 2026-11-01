# Transactions Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Transactions page's edit, create, link and split modals with one autosaving push drawer.

**Architecture:**
- **Components:** `src/components/transactions/` holds small presentational sections plus one composition component, `TransactionDrawer`. A `useAutosave` hook owns the debounce/diff/serialise/flush logic.
- **Page:** the page keeps the data and passes the drawer the transaction, the list to page through, and callbacks.
- **Back end:** no API or schema changes.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Tailwind with CSS vars, vitest + Testing Library (jsdom), user-event.

**Spec:** `docs/superpowers/specs/2026-10-31-transactions-drawer-design.md`. The approved mock is `~/Documents/FinanceOS-design-archive/design-mocks/transactions-drawer-autosave.html`; it is the visual reference only, so never copy data from it.

## Global Constraints

- Reorganization only: no Prisma schema changes and no API route changes.
- Autosave timing:
  - merchant, amount and note save `700` ms after the last keystroke;
  - date, category, tags and the Transaction | Transfer switch save immediately.
- Autosave sends **only changed fields**: never `categoryId` unless the category changed.
- One PATCH in flight at a time; latest values win.
- Copy, verbatim:
  - **Status:** `Editing…`, `Saving…`, `Saved`, `Couldn't save · Try again`, `Merchant can't be empty · not saved`, `Amount must be a number · not saved`.
  - **Transfer hints:** `Money moving between your own accounts, like a card payment.` and `Transfers are left out of spending totals, so the category isn't counted.`
  - **Split part:** `Unsplit to change amounts`, `Unsplit · restore the original`, `Remove the parts and restore the original?`
  - **Delete:** `Delete transaction`, `Delete this transaction for good?`, `Keep it`, `Delete`.
  - **Header:** `N of M`, tooltips `Previous · ↑`, `Next · ↓`, `Close · Esc`.
- Every successful write calls `triggerSync()` from `@/lib/cloud-sync`.
- Tests use synthetic data only: no real account names or values, and nothing from `prisma/dev.db` or mocks.
- Run single test files with `npx vitest run <path>`. `npm run test:unit -- <filter>` does not narrow the run.
- Do not run E2E locally.
- Formatting and colours:
  - Single quotes, semicolons, 100-char lines.
  - `console.log` is not allowed.
  - Use `var(--…)` CSS vars for colours (as in `src/components/ui/drawer.tsx`).
- `docs/` is gitignored: `git add -f` for plan/spec files only. Never stage `.claude/` or `.superpowers/`.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Paging off a transaction mid-typing:** with a 700 ms debounce pending, ↓ or clicking another row must save the pending edit first. Pinned in Task 8 (`flushes pending edit before stepping`).
2. **The open transaction leaves the list:** on the Review tab a structural refresh (link, transfer) can drop it from the queue. The drawer keeps showing it and hides the `N of M` counter instead of crashing or jumping. Pinned in Task 9 (`keeps the drawer open when the transaction leaves the list`).
3. **Amount typed as `-` or `12.`:** intermediate keystrokes must not save NaN, and must not save a truncated value before typing pauses. Pinned in Task 2 (`does not send NaN amount`) and in Task 4 (`amount input keeps raw text`).
4. **A save that fails, then a new edit:** the retry must send the merged pending fields (old + new), not lose the failed ones. Pinned in Task 2 (`failed fields are kept and merged into the next save`).
5. **Arrow keys while typing in the note or a select:** must not page. Pinned in Task 8 (`ignores arrow keys while typing`).

---

### Task 1: Shared `sendJson` and drawer header/footer slots

**Files:**
- Create: `src/lib/send-json.ts`
- Modify: `src/components/investments/editor-kit.ts` (re-export instead of define)
- Modify: `src/components/ui/drawer.tsx`
- Test: `tests/unit/components/ui/drawer.test.tsx`

**Interfaces:**
- **Produces `src/lib/send-json.ts`:**
  - `sendJson<T>(url: string, method: string, body?: unknown): Promise<T>`, moved verbatim from editor-kit;
  - `errorText(e: unknown): string`.

  `editor-kit.ts` keeps exporting both names via `export { sendJson, errorText } from '@/lib/send-json';`, so existing imports keep working.
- **Produces `Drawer` props:** `{ open; onClose; title: string; subtitle?: React.ReactNode; headerExtra?: React.ReactNode; actions?: React.ReactNode; footer?: React.ReactNode; children }`.
  - `headerExtra` renders under the subtitle.
  - `actions` renders left of the close button.
  - `footer` renders below the scrolling body, outside it, with `border-t`.
- **Close button:** a 34×32 bordered square with an inline SVG ✕, `aria-label="Close"` and `title="Close · Esc"`. Classes:
  - `grid h-8 w-[34px] place-items-center rounded-[9px] border border-[var(--border-hover)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:bg-[var(--bg-card)] hover:text-[var(--text-primary)]`.
- **Header layout:** `items-center` (was `items-start`).

- [ ] **Step 1: Write failing tests** in `drawer.test.tsx`:

```tsx
it('renders actions before the close button and headerExtra under the subtitle', () => {
  render(
    <Drawer open actions={<button type="button">Prev</button>} headerExtra={<div>−$1.00</div>}
      subtitle="2026-01-02 · Test Card" title="Test Merchant" onClose={vi.fn()}>body</Drawer>
  );
  const buttons = screen.getAllByRole('button');
  expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Prev', 'Close']);
  expect(screen.getByText('−$1.00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('title', 'Close · Esc');
});

it('renders a footer outside the scrolling body', () => {
  render(<Drawer open footer={<button type="button">Add</button>} title="New" onClose={vi.fn()}>body</Drawer>);
  expect(screen.getByText('body').closest('.overflow-y-auto')).not.toContainElement(
    screen.getByRole('button', { name: 'Add' })
  );
});
```

- [ ] **Step 2:** Run `npx vitest run tests/unit/components/ui/drawer.test.tsx`. Expected: the 2 new tests FAIL; the old ones pass.
- [ ] **Step 3:** Create `src/lib/send-json.ts`, switch `editor-kit.ts` to re-export it, then add the props and restyle the close button in `drawer.tsx`.
- [ ] **Step 4:** Run the drawer tests, then `npx vitest run tests/unit/components/settings-accounts-drawer.test.tsx` and `npm run typecheck`. Expected: all PASS.
- [ ] **Step 5:** Commit: `refactor(ui): drawer header actions, footer slot and bordered close; shared sendJson`.

---

### Task 2: Transaction types, field helpers and `useAutosave`

**Files:**
- Create: `src/components/transactions/types.ts`
- Create: `src/components/transactions/use-autosave.ts`
- Test: `tests/unit/components/transactions/use-autosave.test.ts`
- Test: `tests/unit/components/transactions/types.test.ts`

**Interfaces:**
- **Produces `types.ts`:**
  - `Tx` and `Category`, moved verbatim from `src/app/(routes)/transactions/page.tsx:20-63`.
  - `type Account = { id: string; name: string }`.
  - `type TxFields = { date?: string; amount?: number; merchant?: string; categoryId?: string | null; note?: string | null; tags?: string[]; isTransfer?: boolean }`.
  - `validateFields(f: TxFields): string | null`:
    - returns `Merchant can't be empty · not saved` when `merchant !== undefined && !merchant.trim()`;
    - returns `Amount must be a number · not saved` when `amount !== undefined && !Number.isFinite(amount)`;
    - otherwise returns `null`.
  - `applyFields(tx: Tx, f: TxFields, categories: Category[]): Tx`:
    - copies the scalar fields;
    - `categoryId` sets `category` to `{ id, name }` from `categories`, or `null`, and also sets `confidenceScore = 1`, mirroring the PATCH route.
- **Produces `use-autosave.ts`:**
  - `export const AUTOSAVE_DELAY_MS = 700;`
  - `export type SaveStatus = 'saved' | 'editing' | 'saving' | 'error' | 'invalid';`
  - `useAutosave(save: (fields: TxFields) => Promise<void>, delayMs = AUTOSAVE_DELAY_MS): { status: SaveStatus; message: string | null; edit(fields: TxFields, opts?: { immediate?: boolean }): void; flush(): Promise<boolean>; retry(): void }`
- **Algorithm (not determined by the signature):**
  - `edit` merges `fields` into a `pending` ref.
  - If `validateFields(pending)` fails: status `invalid`, `message` set, no timer, nothing sent.
  - Otherwise status becomes `editing` and the debounce timer restarts, or the save runs now when `immediate`.
  - A run takes and clears `pending`, sets status `saving` and awaits `save`.
  - If a save is already in flight, the run waits for it, then sends whatever `pending` has by then.
  - On failure, the sent fields are merged back **under** any newer pending fields, so newer values win. Status becomes `error` with message `Couldn't save · Try again`.
  - On success with nothing pending: status `saved`.
  - `flush()` cancels the timer, runs any valid pending save, awaits the in-flight one, and resolves `true` iff nothing is pending or failed afterwards. An `invalid` pending state resolves `false`.
  - `retry()` is `flush()` without awaiting.
  - The timer is cleared on unmount.

- [ ] **Step 1: Write failing tests.** In `use-autosave.test.ts` use `renderHook` + `vi.useFakeTimers()`; `save = vi.fn().mockResolvedValue(undefined)`.
  - `debounces text edits by 700 ms`: `edit({ merchant: 'A' })`, `edit({ merchant: 'AB' })`. Advance 699 → `save` not called and status `'editing'`. Advance 1 → `save` called once with `{ merchant: 'AB' }`.
  - `immediate edits save at once`: `edit({ categoryId: 'c1' }, { immediate: true })` → `save` called with `{ categoryId: 'c1' }` with no timer advance.
  - `sends only edited fields`: `edit({ note: 'n' })` + advance 700 → `Object.keys(save.mock.calls[0][0])` equals `['note']`.
  - `serialises saves and sends the latest pending fields after the in-flight one`: the first `save` returns a manually resolved promise. Call `edit({ note: 'a' }, { immediate: true })`, then `edit({ note: 'b' }, { immediate: true })` while it is in flight → `save` called once. Resolve it → `save` called a 2nd time with `{ note: 'b' }`.
  - `does not send NaN amount`: `edit({ amount: NaN })` + advance 700 → `save` not called, status `'invalid'`, message `Amount must be a number · not saved`.
  - `blank merchant is invalid`: `edit({ merchant: '  ' })` → status `'invalid'`, message `Merchant can't be empty · not saved`.
  - `failed fields are kept and merged into the next save`: `save` rejects once. `edit({ note: 'a' }, { immediate: true })` → status `'error'`, message `Couldn't save · Try again`. Then `edit({ merchant: 'M' }, { immediate: true })` → last call `{ note: 'a', merchant: 'M' }`.
  - `flush sends the pending edit and resolves true`: `edit({ note: 'x' })`, then `await flush()` before the timer → `save` called with `{ note: 'x' }`, result `true`.
  - `flush resolves false when the save fails`.

  In `types.test.ts`:
  - `applyFields sets category and confidence`: category `{ id: 'c1', name: 'Test Cat' }` → `category` is `{ id: 'c1', name: 'Test Cat' }` and `confidenceScore` is `1`.
  - `applyFields with categoryId null clears category`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/components/transactions`. Expected: FAIL, because the modules are missing.
- [ ] **Step 3:** Implement `types.ts` and `use-autosave.ts`. Replace the page's local `Tx`/`Category` type definitions with imports from `@/components/transactions/types`.
- [ ] **Step 4:** Run the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(transactions): autosave hook and shared transaction types`.

---

### Task 3: Drawer nav, save status, delete zone

**Files:**
- Create: `src/components/transactions/drawer-nav.tsx`
- Create: `src/components/transactions/save-status.tsx`
- Create: `src/components/transactions/delete-zone.tsx`
- Test: `tests/unit/components/transactions/drawer-bits.test.tsx`

**Interfaces:**
- **`DrawerNav({ index, count, onStep }: { index: number; count: number; onStep: (delta: -1 | 1) => void })`**
  - Renders `{index + 1} of {count}` in mono muted text.
  - Two buttons in one bordered group with chevron SVGs:
    - aria-labels `Previous transaction` and `Next transaction`;
    - `title`s `Previous · ↑` and `Next · ↓`;
    - disabled at index 0 and at `count - 1`.
  - Then a 1px divider.
  - Renders nothing when `index < 0`.
- **`SaveStatus({ status, message, onRetry }: { status: SaveStatus; message: string | null; onRetry: () => void })`**
  - A right-aligned row.
  - `saved` shows a check SVG + `Saved`; `editing` shows `Editing…`; `saving` shows a spinner + `Saving…`.
  - `error` shows `Couldn't save · ` + a `Try again` button calling `onRetry`; `invalid` shows `message` in `var(--red)`.
  - The row has `aria-live="polite"`.
- **`DeleteZone({ onDelete }: { onDelete: () => Promise<void> })`**
  - A quiet button with a trash SVG + `Delete transaction`.
  - Clicking it shows `Delete this transaction for good?` with `Keep it` (restores the button) and `Delete` (red, calls `onDelete`).
  - The `Delete` button is disabled while that call is pending.

- [ ] **Step 1: Write failing tests:**
  - `nav shows position and disables ends`: `index 0, count 3` → text `1 of 3`; Previous is disabled and Next enabled. Clicking Next calls `onStep(1)`.
  - `nav renders nothing for index -1`.
  - `status shows Try again on error and calls onRetry`.
  - `status shows invalid message`.
  - `delete asks before deleting`: click `Delete transaction` → `Delete this transaction for good?` is visible and `onDelete` not called. `Keep it` → the button is back. Click again, then `Delete` → `onDelete` called once.
- [ ] **Step 2:** Run `npx vitest run tests/unit/components/transactions/drawer-bits.test.tsx` → FAIL.
- [ ] **Step 3:** Implement the three components.
- [ ] **Step 4:** Run the tests → PASS.
- [ ] **Step 5:** Commit: `feat(transactions): drawer nav, save status and delete zone`.

---

### Task 4: Details section

**Files:**
- Create: `src/components/transactions/category-select.tsx`
- Create: `src/components/transactions/details-section.tsx`
- Modify: `src/app/(routes)/transactions/page.tsx` (import `sortByName` from the new file; delete the local copy)
- Test: `tests/unit/components/transactions/details-section.test.tsx`

**Interfaces:**
- **`category-select.tsx`:**
  - Exports `sortByName` (moved from page.tsx with `stripEmojis`).
  - Exports `CategorySelect({ categories, value, onChange, id, 'aria-label'? }: { categories: Category[]; value: string; onChange: (id: string | null) => void; id?: string; 'aria-label'?: string })`.
  - Uses `Select` from `@/components/ui/select`: a `No category` option, then `optgroup` per top-level group with its children sorted, exactly the grouping at page.tsx:1356-1379.
- **`DetailsSection({ tx, categories, availableTags, onCreateTag, onEdit, splitSlot, onStartSplit }: { tx: Tx; categories: Category[]; availableTags: TagDef[]; onCreateTag: (name: string) => Promise<void> | void; onEdit: (f: TxFields, opts?: { immediate?: boolean }) => void; splitSlot?: React.ReactNode; onStartSplit?: () => void })`**
  - **Card:** heading `Details`, styled like `SECTION_CARD`/`SECTION_HEAD` in `src/components/investments/account-drawer.ts` (reuse those constants).
  - **Transfer switch:** a two-button switch `Transaction` | `Transfer`, `aria-pressed` on each. Clicking one calls `onEdit({ isTransfer }, { immediate: true })`. When `tx.isTransfer`, the first transfer hint shows under it.
  - **Date:** `<Input type="date">` with the label `Date`; on change `onEdit({ date }, { immediate: true })`.
  - **Amount:** `<Input inputMode="decimal">` with the label `Amount`.
    - Local **string** state, initialised from `tx.amount.toFixed(2)`.
    - On change: `onEdit({ amount: parseFloat(text) })`, debounced. NaN is validated by the hook.
    - When `tx.parentTransactionId`: read-only, with the hint `Unsplit to change amounts`.
  - **Merchant:** `<Input>` with the label `Merchant`; `onEdit({ merchant })`, debounced.
  - **Category:**
    - `CategorySelect` → `onEdit({ categoryId }, { immediate: true })`.
    - Next to it, a dashed `⑂ Split` button when `onStartSplit` is provided.
    - `splitSlot`, when provided, renders under the Category field: the split editor or summary from Task 5.
    - When `tx.isTransfer`, the second transfer hint renders under the category.
  - **Note:** a textarea → `onEdit({ note })`, debounced.
  - **Tags:** `TagInput` → `onEdit({ tags }, { immediate: true })`.
  - Inputs hold local state keyed to the transaction. The parent remounts the section with `key={tx.id}`, so props are never re-synced mid-edit.

- [ ] **Step 1: Write failing tests:**
  - `transfer switch saves immediately`: click `Transfer` → `onEdit` called with `({ isTransfer: true }, { immediate: true })`.
  - `typing the merchant edits without immediate`: type `X` → the last call is `[{ merchant: 'Test MerchantX' }]`.
  - `amount input keeps raw text`: clear + type `-12.` → input value `-12.`; last call `onEdit({ amount: -12 })`.
  - `split part amount is read only with hint`: `tx.parentTransactionId = 'p1'` → the amount input has the `readonly` attribute and the text `Unsplit to change amounts` shows.
  - `category change saves immediately`.
  - `shows transfer hints only for transfers`.
  - `no split button without onStartSplit`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement both files and update the page import.
- [ ] **Step 4:** Run the tests and `npm run typecheck` → PASS.
- [ ] **Step 5:** Commit: `feat(transactions): details section with transfer switch`.

---

### Task 5: Split editor and split summary

**Files:**
- Create: `src/components/transactions/split-editor.tsx`
- Create: `src/components/transactions/split-summary.tsx`
- Test: `tests/unit/components/transactions/split.test.tsx`

**Interfaces:**
- **`SplitEditor({ tx, categories, onCancel, onSaved }: { tx: Tx; categories: Category[]; onCancel: () => void; onSaved: (partIds: string[]) => void })`**
  - **Initial rows:** `[{ categoryId: tx.category?.id ?? '', amount: Math.abs(tx.amount).toFixed(2), note: '' }, { categoryId: '', amount: '', note: '' }]`. This is today's `openSplitModal`.
  - **Row:** a colour swatch, `CategorySelect`, an amount input, and a ✕ that is disabled when there are only 2 rows. A `Note (optional)` input sits under each row.
  - **Bar:** one coloured segment per row, width `amount / |tx.amount|`, colours cycling `var(--accent)`, `var(--tag-teal)`, `var(--tag-blue)`, `var(--green)`.
  - **Sum line** (the sum matches when within `0.01`):
    - `Adds up to {formatted signed total} ✓`;
    - `$X.XX left to assign`;
    - `$X.XX too much`.
  - `+ Add a part`, `Cancel`, and `Save split`, which is disabled until the sum matches.
  - **Save:**
    - `sendJson('/api/transactions/split', 'POST', { transactionId: tx.id, parts })`;
    - each part is `{ amount: n * sign, categoryId: id || null, note: note || null }`, with `sign = tx.amount < 0 ? -1 : 1`;
    - then `triggerSync()`, then `onSaved(response.parts.map(p => p.id))`;
    - on error, shows `errorText(err)` in `var(--red)`.
- **`SplitSummary({ tx, onUnsplit }: { tx: Tx; onUnsplit: () => Promise<void> })`**
  - Renders only when `tx.parentTransaction`.
  - Heading `Part of a split · {signed total}`.
  - Bar plus a row per `parentTransaction.splitParts`: swatch, category name or `Uncategorized`, `· note` when set, signed amount. The row whose `id === tx.id` is emphasised.
  - Button `Unsplit · restore the original` → inline `Remove the parts and restore the original?` with `Keep` / `Unsplit` → `onUnsplit()`.

- [ ] **Step 1: Write failing tests**, mocking `global.fetch` and `@/lib/cloud-sync`. Use a synthetic tx `{ id: 't1', amount: -100, category: { id: 'c1', name: 'Test A' } }`.
  - `starts with the full amount in row 1 and Save disabled while row 2 is empty`: row 1 value `100.00`, row 2 empty, `Save split` disabled (an empty amount is invalid even though the sum matches).
  - `shows left to assign`: set row 1 to `60`, row 2 to `30` → `$10.00 left to assign`, Save disabled.
  - `posts signed parts`: row 1 `60`, row 2 `40` with category `c2`, Save → fetch body `{ transactionId: 't1', parts: [{ amount: -60, categoryId: 'c1', note: null }, { amount: -40, categoryId: 'c2', note: null }] }`; `onSaved` gets `['p1','p2']` from the mocked `{ parts: [{ id: 'p1' }, { id: 'p2' }] }`.
  - `cannot remove below two rows`.
  - `summary emphasises this part and confirms unsplit`: Keep does not call `onUnsplit`; Unsplit calls it once.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.

  **Save split** is enabled only when every row has a finite amount > 0 **and** the sum matches.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(transactions): inline split editor and split summary`.

---

### Task 6: Refunds & paybacks section

**Files:**
- Create: `src/components/transactions/refunds-section.tsx`
- Test: `tests/unit/components/transactions/refunds-section.test.tsx`

**Interfaces:**
- **Props:** `RefundsSection({ tx, currency, baseCurrency, startOpen, onChanged, onOpen }: { tx: Tx; currency?: string; baseCurrency: string; startOpen?: boolean; onChanged: () => void; onOpen: (id: string) => void })`
  - Returns `null` when `tx.isTransfer`.
  - Money is formatted with `formatAmountCompact` from `@/lib/currency`, as the page's `formatCurrency` does.
  - A `MiniTx` card shows merchant, signed amount, and `date` (YYYY-MM-DD).
- **States:**
  - **`tx.isOffset && tx.linkedTransaction`:** heading `Refunds & paybacks` + `linked`. Shows the original MiniTx, `↑ paid back by this`, then this tx. Buttons:
    - `Open the original` → `onOpen(tx.linkedTransactionId)`;
    - `Unlink` → `DELETE /api/transactions/{tx.id}/returns`, then `triggerSync()`, `onChanged()`.
  - **`tx.offsetTransactions?.length`:** this tx, then per offset `↑ paid back by` + its MiniTx + `Unlink`, which DELETEs that offset's returns route. Then a `Net` line with `tx.amount + Σ offset.amount`.
  - **Otherwise, closed:** a hint, then a link-styled button:
    - for a credit (`amount > 0`): hint `A refund or payback? Link it to the purchase it pays back so that purchase nets out.`, button `+ Link to a purchase`;
    - for anything else: hint `When money comes back for this (a refund, or friends paying you back), link it so the purchase nets out.`, button `+ Link a refund or payback`.
  - **Opened (by click, or `startOpen`):**
    - Fetches `GET /api/transactions/{id}/returns` → `matches`.
    - Shows `Suggested matches` as rows: merchant, `date · N days before|after`, amount, `NN% match`, `$X.XX diff` when `amountDiff > 0.01`, and a `Link` button.
    - `Finding matches…` while loading; `No likely matches found.` when there are none.
    - A `Search by merchant…` input + `Search` button:
      - fetches `/api/transactions?merchant={encoded}&preset=last-12-months`;
      - filters out the same id, `isOffset` and `linkedTransactionId`;
      - maps to `{ ...t, score: 0.5, amountDiff, daysDiff }` exactly as page.tsx does today.
    - `Link` → `POST /api/transactions/{tx.id}/returns` `{ originalTransactionId: match.id }` (today's semantics, unchanged), then `triggerSync()`, `onChanged()`.
    - `Cancel` collapses it.

- [ ] **Step 1: Write failing tests** (fetch mocked, synthetic data):
  - `hidden for transfers`.
  - `credit: opening lists suggested matches and links with today's payload`: tx `{ id: 'r1', amount: 20 }`; GET returns `{ matches: [{ id: 'p1', merchant: 'Test Store', amount: -50, date: '2026-01-01T00:00:00.000Z', daysDiff: 3, score: 0.9, amountDiff: 30 }] }`. Click `+ Link to a purchase` → `Test Store` visible, `90% match`, `$30.00 diff`. Click `Link` → POST to `/api/transactions/r1/returns` with `{ originalTransactionId: 'p1' }`; `onChanged` called.
  - `startOpen fetches matches without a click`.
  - `offset shows original, opens it, and unlinks`: `Open the original` → `onOpen('p1')`; `Unlink` → DELETE `/api/transactions/r1/returns`.
  - `original shows each offset and the net`: amount −50 with offsets +20 and +10 → the Net text contains `20.00`, and there are two `Unlink` buttons.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(transactions): refunds and paybacks section`.

---

### Task 7: New transaction form

**Files:**
- Create: `src/components/transactions/new-transaction-form.tsx`
- Test: `tests/unit/components/transactions/new-transaction-form.test.tsx`

**Interfaces:**
- **Produces:** `useNewTransactionForm({ accounts, categories, availableTags, onCreateTag, onCancel, onCreated }: { accounts: Account[]; categories: Category[]; availableTags: TagDef[]; onCreateTag: (name: string) => Promise<void> | void; onCancel: () => void; onCreated: () => void }): { body: React.ReactNode; footer: React.ReactNode }`. A hook, so the body goes in the drawer's scrolling area and the footer in its `footer` slot (Task 8).
- **Fields:**
  - `Account` select, required, with first option `Choose an account…`;
  - `Date`, default today `YYYY-MM-DD`;
  - `Amount`, signed, as today;
  - `Merchant`;
  - `Category` (`CategorySelect`);
  - `Note`;
  - `Tags`.
- **Footer:** `Cancel` (calls `onCancel`) and `Add transaction`. Tests render a harness: `function H(p) { const { body, footer } = useNewTransactionForm(p); return <>{body}{footer}</>; }`.
- **Add transaction:**
  - When account, merchant or amount is missing, shows `Choose an account, and enter a merchant and amount.` in red and does not post. This replaces today's `alert`.
  - Otherwise POSTs `/api/transactions` with today's body (page.tsx `createTransaction`), then `triggerSync()`, `onCreated()`.
  - On error, shows `errorText`.

- [ ] **Step 1: Write failing tests:**
  - `requires account, merchant and amount`.
  - `posts the new transaction`: body `{ date, amount: -12.5, merchant: 'Test Shop', accountId: 'a1', categoryId: null, note: null }`; `tags` is omitted when empty; `onCreated` is called.
  - `cancel calls onCancel`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(transactions): new transaction form for the drawer`.

---

### Task 8: `TransactionDrawer` composition

**Files:**
- Create: `src/components/transactions/transaction-drawer.tsx`
- Test: `tests/unit/components/transactions/transaction-drawer.test.tsx`

**Interfaces:**
- **Props:** `TransactionDrawer(props: { state: { mode: 'edit'; tx: Tx; startLinking?: boolean } | { mode: 'new' } | null; list: Tx[]; categories: Category[]; accounts: Account[]; availableTags: TagDef[]; baseCurrency: string; onCreateTag: (name: string) => Promise<void> | void; onOpen: (id: string, opts?: { startLinking?: boolean }) => void; onClose: () => void; onRowSaved: (tx: Tx) => void; onChanged: () => void; onCreated: () => void })`
- **Drawer wiring:** `open = state !== null`; Drawer `onClose` = flush, then `props.onClose()`.
- **Edit mode:** renders an inner `EditBody` with `key={tx.id}`. EditBody owns `useAutosave`, whose `save` is:
  - `sendJson('/api/transactions/{id}', 'PATCH', fields)`;
  - then `triggerSync()`;
  - then `onRowSaved(applyFields(tx, fields, categories))`;
  - then `onChanged()` **only if** `'isTransfer' in fields`, since that is structural.
- **Header (edit mode):**
  - `title` = merchant;
  - `subtitle` = `{YYYY-MM-DD} · {account name}`;
  - `headerExtra` = the signed amount in mono 20px, `var(--green)` when > 0;
  - `actions` = `DrawerNav` with `index = list.findIndex(t => t.id === tx.id)`.
- **Body order:**
  1. `SaveStatus`.
  2. `DetailsSection`:
     - `onStartSplit` only when there is no `parentTransactionId`, no `linkedTransactionId`, no offsets and no `isSplitParent`;
     - `splitSlot` = `SplitEditor` while splitting, `SplitSummary` for parts.
  3. `RefundsSection` (`startOpen` from state).
  4. A `Categorization` card showing `{round(confidenceScore*100)}% confident`.
  5. `DeleteZone`, except for split parts.
- **Navigation:**
  - `step(delta)` and `open(id)` both run `await flush()` first; if it returns `false` they stay put.
  - `step` targets `list[index + delta]`.
  - A `document` `keydown` listener handles ArrowUp/ArrowDown when `!(e.target as Element).closest('input, textarea, select, [contenteditable]')`, calls `preventDefault`, and steps.
- **Structural actions:**
  - **Split saved:** `onChanged()`, then `onOpen(partIds[0])`.
  - **Unsplit:** `POST /api/transactions/unsplit` `{ transactionId: tx.parentTransactionId }` → `triggerSync()`, `onChanged()`, `onOpen(restored.id)`.
  - **Delete:**
    - `DELETE /api/transactions/{id}` → `triggerSync()`;
    - the next target is `list[index + 1] ?? list[index - 1]`;
    - then `onChanged()`;
    - then `onOpen(next.id)`, or `onClose()` when there is no next.
  - **Refunds `onOpen`** goes through the flushing `open`.
- **New mode:**
  - title `New transaction`, subtitle `Entered by hand`;
  - body and footer from `useNewTransactionForm`;
  - `onCreated` → `props.onCreated()`.

- [ ] **Step 1: Write failing tests** (fetch mocked, timers faked where noted, synthetic list of 3 txs `t1..t3`):
  - `shows position and steps to the next transaction`: open t1 → `1 of 3`; click Next → `onOpen('t2')`.
  - `flushes pending edit before stepping`: with fake timers, type into Merchant, then click Next at once → the PATCH to `/api/transactions/t1` is called **before** `onOpen('t2')`.
  - `stays put when the flush fails`: PATCH rejects → `onOpen` is not called and `Couldn't save` is visible.
  - `ignores arrow keys while typing`: focus the Note textarea and press ArrowDown → `onOpen` is not called. Blur to `document.body` and press ArrowDown → `onOpen('t2')`.
  - `autosave patches only the merchant and updates the row`: PATCH body `{ merchant: 'Test MerchantX' }`; `onRowSaved` gets a tx with `merchant` `Test MerchantX`.
  - `transfer switch triggers a full refresh`: `onChanged` called.
  - `split parts have no delete and show the summary`.
  - `delete opens the next row`: delete t2 → DELETE `/api/transactions/t2`, then `onOpen('t3')`; deleting t3 opens `t2`.
  - `new mode shows Add transaction footer`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit: `feat(transactions): transaction drawer with autosave and paging`.

---

### Task 9: Wire the page and delete the modals

**Files:**
- Modify: `src/app/(routes)/transactions/page.tsx`
- Test: `tests/unit/components/transactions-page-drawer.test.tsx`

**Interfaces:**
- **Consumes:** `TransactionDrawer` (Task 8), `DRAWER_PUSH_CLASS` (Task 1), `Tx` (Task 2).
- **Page state:** replace the edit/create/return/split modal state and handlers with:
  - `const [drawer, setDrawer] = useState<{ mode: 'edit'; id: string; startLinking?: boolean } | { mode: 'new' } | null>(null)`;
  - `const [drawerSnapshot, setDrawerSnapshot] = useState<Tx | null>(null)`.

  Delete these: `editModalOpen`, `editingTransaction`, `createModalOpen`, `newTransaction`, `splitModalOpen`, `splitParts`, `returnModalOpen`, `returnTransaction`, `potentialMatches`, `loadingMatches`, `updateTransaction`, `deleteTransaction`, the split helpers, `unsplitTransaction`, `toggleTransfer`, `createTransaction`, `openReturnModal`, `linkReturn`, and the four `<Modal>` blocks. Remove the `Modal` import if it becomes unused. **Keep** `unlinkReturn`, which is still used by the review card's inline Unlink.
- **`drawerList`:**
  - `tab === 'review'`: the queue arrays `uncategorized`, `lowConfidence`, `unlinkedReturns`, `highConfidence`, `outliers` concatenated in that order, de-duplicated by id (first wins);
  - otherwise: `transactions`.
- **Resolving the open transaction:**
  - `drawerTx` = `drawerList.find(id) ?? transactions.find(id) ?? drawerSnapshot`.
  - Whenever a match is found, store it as `drawerSnapshot`.
  - When the tx is not in `drawerList`, the drawer still renders. `DrawerNav` gets index −1 and hides itself.
- **Wiring:**
  - Every `openEditModal(tx)` call becomes `setDrawer({ mode: 'edit', id: tx.id })`.
  - The review card's `🔗 Link Transaction` button becomes `setDrawer({ mode: 'edit', id: tx.id, startLinking: true })`.
  - `+ New transaction` becomes `setDrawer({ mode: 'new' })`.
- **Callbacks:**
  - `onRowSaved(t)` replaces that row in `transactions` and in every queue array, in place.
  - `onChanged` = `refreshTransactionsAndQueue`.
  - `onClose` → `setDrawer(null)`, then `refreshTransactionsAndQueue()`.
  - `onCreated` → `setDrawer(null)`, then refresh.
- **Layout while open:**
  - the page content wrapper gets `DRAWER_PUSH_CLASS`;
  - the All table hides the Account `<th>`/`<td>` (`hidden` class);
  - the open row gets the selected style: background `color-mix(in srgb, var(--accent) 9%, transparent)` and an inset 3px accent left bar on the first cell;
  - selected review cards get `ring-1 ring-[var(--accent)]`.

- [ ] **Step 1: Write failing tests.**

  Mock `next/navigation` (`useSearchParams` → `tab=all` or `tab=review` per test), `@/lib/cloud-sync`, `@/components/subscriptions-tab` and `@/components/filter-ribbon` as `() => null`, as `settings-accounts-drawer.test.tsx` does. Route `global.fetch` by URL to synthetic payloads:
  - `/api/transactions?…` → `{ transactions: [t1, t2] }`;
  - `/api/review-queue` → the queue; `/api/categories`, `/api/accounts`, `/api/settings`, `/api/tags` → minimal synthetic payloads.

  Tests:
  - `clicking a row opens the drawer and pushes the page`: dialog `Test Merchant 1` is visible; the content wrapper has `DRAWER_PUSH_CLASS`; the `Account` column header is hidden.
  - `no edit modal remains`: `document.querySelector('[aria-modal="true"]')` is null after opening.
  - `new transaction opens the drawer in new mode`: dialog `New transaction`.
  - `review link button opens the drawer with matches loading`: `tab=review` → clicking `🔗 Link Transaction` fetches `/api/transactions/{id}/returns`.
  - `keeps the drawer open when the transaction leaves the list`: `tab=review`, open t1, then trigger a refresh that removes t1 from the queue. The dialog stays open showing t1, and `of 2` is no longer shown.
  - `closing refreshes the list`: click Close → the transactions GET is called again.
- [ ] **Step 2:** Run `npx vitest run tests/unit/components/transactions-page-drawer.test.tsx` → FAIL.
- [ ] **Step 3:** Implement the page changes.
- [ ] **Step 4:** Run the new test file, then `npx vitest run tests/unit/components`, then `npm run check`. Expected: all PASS, with no lint errors.
- [ ] **Step 5:** Commit: `feat(transactions): edit and create in a push drawer; remove modals`.

---

## Self-review notes

- **Spec coverage:** layout/header (T1, T3, T8), status (T3), autosave rules (T2, T8), split (T5, T8), refunds (T6), delete (T3, T8), new mode (T7, T8), paging/keys (T8, T9), page cleanup and push layout (T9), and the review-card link (T9). Out-of-scope items have no tasks.
