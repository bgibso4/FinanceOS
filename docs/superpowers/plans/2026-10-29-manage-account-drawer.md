# Manage Account Drawer & Investment Account Settings (Plan 4b) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings → Accounts manages every account in a push drawer, and investment accounts get balance-source settings, read-only holdings and "Balances you entered" (single add plus spreadsheet paste) in place of Reconcile.

**Architecture:**
- **Backend:** pure parsing and classification in `src/lib/investments/past-balances.ts`, shared by client preview and server. `ManualHoldingService` becomes `EnteredBalanceService`, which works on every investment account and owns the entry cutoff. The account mode rules go in one guard in `account-guard.ts`. Source switches run under the refresh lock through `InvestmentRefreshService`. Creation defaults go in `account-defaults.ts`.
- **API:** the balances route gains `enterBefore`/`today` and a batch POST. A new `GET …/holdings` reuses `CurrentHoldingsReader` through `InvestmentOverviewService.accountHoldings`. The accounts PATCH enforces the guard.
- **UI:** `ui/drawer.tsx` is reworked into a non-modal push drawer, with a shared `ui/option-cards.tsx`. The investment sections live in `src/components/investments/`. `settings/page.tsx` only swaps `<Modal>` for `<Drawer>` and mounts those sections, as decided by the pure `drawerSections()`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma + SQLite, Zod v4, Vitest + Testing Library (jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-10-29-manage-account-drawer-design.md`. Approved mock: `~/Documents/FinanceOS-design-archive/design-mocks/investments/followups/manage-account.html`. Its numbers and names are synthetic display data; never copy them into fixtures.

## Spec notes (rulings where the spec meets the code)

1. **"Connection" for the Synced lock and the guard means a connection that syncs investment balances.** Today that is only the Plaid connection: `/api/plaid/sync` runs the investment sync for *every* investment-mode Plaid account, depository included (`plaid-investment-sync.ts` has a depository path), and writes `synced` balance rows daily. Teller has no investment sync. So:
   - **Adopt:** a Plaid account that becomes an investment account is `provider`, including a brokerage-typed depository account. The spec says `manual` here, but the next sync would overwrite a Manual balance. A Teller account typed brokerage/retirement/crypto becomes `investment`/`manual`, as the spec says. The integration boundary (adopt route, accounts PATCH route, settings page) computes `synced` = "has a Plaid connection". The guard, `defaultBalanceSource` and the UI only see a neutral boolean (`canSync` / `synced`).
   - A Teller connection on an investment account only shows the Bank Connection section. It does not lock Synced.
2. **Bank Connection for everyday accounts is unchanged.** It is always shown, with the link selectors when the account isn't connected. The spec table's "when connected" applies to investment accounts only. Linking an investment account from the drawer would attach a connection without going through the source rules.
3. **Mirror sync must stop deleting real holdings.** Today `sync()` deletes *every* holding snapshot of the account. Valued → Manual would then destroy holdings history, which contradicts §4.1/§5.2 ("keeps every stored balance and holding"). Now:
   - `sync()` touches only the mirror security's snapshots and prices.
   - The mirror is one snapshot per `manual` row, plus one at the latest stored balance (any source) when that row is newer than the newest manual row. That is how "the mirror is written from the latest stored balance" on a switch.
   - `CurrentHoldingsReader` shows only the mirror for Manual accounts, just as it already hides the mirror for Valued ones.
4. **Manual → Valued:** valuation owns every day from the first real holdings day (that is §4.3's Valued cutoff). Entered balances dated on or after that day are replaced as valuation writes. The switch calls `writeBalances({ accountIds: [id] })` under the lock, which does nothing while the account has no real holdings.
5. **`GET …/balances` also returns `today`** (the server's UTC day), so the default *As of* date and the "In the future" status match the server's check. The spec defines no holdings endpoint for the drawer, so the plan adds `GET /api/investments/accounts/[id]/holdings`. It reuses the current-holdings reader, as §4.2 asks.
6. **`price-window.tsx` does not exist.** The option-card look comes from the mock (`.opt` styles). A new shared `src/components/ui/option-cards.tsx` provides it.
7. **A Manual account can hold `synced`/`valuation` rows** (for example a Synced account that was disconnected and switched). Entered writes never overwrite them. A single entry is refused (400). In a batch, the row is skipped with reason `kept`. The preview can't predict this because GET lists `manual` rows only, so the paste panel reports what the server skipped.
8. **Esc with a modal open over the drawer** (Edit holdings) must not close the drawer. `Modal` gains `role="dialog" aria-modal="true"`, and the drawer ignores Esc while any `[aria-modal="true"]` element is in the document.
9. **Save changes keeps the drawer open.** It used to close the modal. Now it refreshes the account in place, and refusals show under the button.

## Global Constraints

- **The GitHub repo is public.** Synthetic test data only (`Test Brokerage`, `AAA`, round amounts). Never use values from `prisma/dev.db` or the mocks' display data. Never read `.env`.
- **Schema:** no change is expected. If one becomes necessary, run `npx prisma db push` then `npx prisma generate`. Never run `prisma migrate dev`.
- **Design: DRY > YAGNI > SOLID.**
  - Reuse before writing: `sendJson`/`errorText`/`FIELD_LABEL`/`HINT`/`ERROR` (`editor-kit.ts`), `fmtMoney`/`fmtQty` (`format.ts`), `utcDay`/`isoDay` (`dates.ts`), `roundCents` (`money.ts`), `isoDateSchema`/`parseJsonBody`/`investmentErrorResponse` (`api/investments/_lib/http.ts`).
  - Services are classes with injected deps, wired only in `src/lib/investments/services.ts`. Pure helpers stay functions.
- **Vendor-neutral naming and copy.** Plaid/Teller/Yahoo appear only at integration boundaries: adopt route, accounts routes, settings page bank code, `bank-account-matching.ts`. Elsewhere say "connection", "account aggregator", "market data provider". `tests/unit/lint/vendor-literals.test.ts` must stay green.
- **Stored codes only through the enums** in `src/lib/investments/codes.ts` (`BalanceSource`, `BalanceRowSource`, `RecordSource`). No bare `'provider'`/`'manual'` strings in new code. `'investment'` tracking mode comes from `TrackingMode` in `account-defaults.ts`.
- **Don't grow `settings/page.tsx` with investment logic.**
  - New UI lives in `src/components/investments/`; the drawer and option cards live in `src/components/ui/`.
  - The page only wires: state, `<Drawer>`, the conditionals from `drawerSections()`, the props.
- **UI conventions:**
  - `'use client'` on client components. Colours only via CSS vars (`var(--accent)`, `var(--text-muted)`, `var(--border-hover)`, `var(--green)`, `var(--red)` …).
  - `font-mono` for numbers and dates. Copy is verbatim from this plan; curly apostrophes (`’`) where shown.
- **Dates:** UTC days; `YYYY-MM-DD` strings in API payloads.
- **Lint:** only `console.warn`/`console.error`; prefix unused vars with `_`; single quotes, 100-char lines, JSX props sorted. Run `npm run lint:fix` before each commit.
- **Commands:**
  - `npm run typecheck`, `npm run lint`, `npm run test:unit -- <filter>`, `npm run test:integration -- <filter>`.
  - Run tests in the foreground. A DB `beforeAll` timeout under load is environmental: rerun the file.
- **Git:**
  - Stage explicit paths only; never stage `.claude/` or `.superpowers/`. `docs/` needs `git add -f` (lint-staged's "paths are ignored" FAILED line is harmless).
  - Commit messages end with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Line numbers** are as of `4d7a7f0`; the quoted code is the anchor.
- **Tests:**
  - DB tests use `setupTestDb`/`resetTestDb`/`teardownTestDb` (`tests/helpers/db.ts`) and the seeders in `tests/helpers/investments.ts`.
  - Route tests mock only `@/lib/prisma` and `@/lib/investments/services`, following the `investment-account-apis.test.ts` pattern.
  - Component tests mock `global.fetch` using the `editors.test.tsx` pattern.

## Review Focus

1. **Esc while Edit holdings is open over the drawer.** Expect only the modal's own close paths to act; the drawer stays open. *Task 6 test: "ignores Esc while a modal dialog is open over it".*
2. **Pastes copied from real spreadsheets and from the app itself.** That means CRLF line endings, a header row (`Date,Balance`), `CA$ 1,200`, `(1,234.56)` and the app's own `−` (U+2212) minus. Expect them to be read, or marked "Can’t read this line", never to crash or turn into a wrong number. *Task 1 tests: "reads CRLF pastes and marks a header row unreadable" and "parses balances with symbols, codes, commas and negatives".*
3. **Swapping accounts while the paste panel or a fetch is in flight.** Account B's drawer must show B's balances, with the paste panel closed, never A's late response. *Task 9 test: "clicking another card swaps the drawer and resets its sections".* Sections are keyed by account id.
4. **A Manual account that already holds synced or valued rows** (switched after a disconnect). Entering or pasting onto such a date keeps the existing row. *Task 2 tests: "never overwrites a synced or valued row" and "recordMany keeps a synced or valued row on the same date".*
5. **A Synced account whose connection was removed** (`provider`, no connection). The drawer must offer Valued/Manual, and PATCH must allow leaving Synced. *Task 5 test: "allows leaving Synced once the connection is gone". Task 7 test: "offers Valued and Manual to a disconnected synced account".*

---

### Task 1: Past-balance parsing and classification (pure)

**Files:**
- Create: `src/lib/investments/past-balances.ts`
- Test: `tests/unit/lib/investments/past-balances.test.ts`

**Interfaces:**
- Consumes: `BalanceSource` (`codes.ts`), `roundCents` (`money.ts`), `utcDay`/`isoDay` (`dates.ts`).
- Produces:

```ts
export type ParsedLine =
  | { kind: 'ok'; text: string; date: string; balance: number }
  | { kind: 'unreadable'; text: string };
export type PastBalanceStatus =
  | { kind: 'new' }
  | { kind: 'replaces'; previous: number }
  | { kind: 'already' }
  | { kind: 'skipped'; source: BalanceSource; from: string }
  | { kind: 'future' }
  | { kind: 'repeated' }
  | { kind: 'unreadable' };
export type ClassifiedLine = { line: ParsedLine; status: PastBalanceStatus; saves: boolean };
export type ClassifyContext = {
  entered: { date: string; balance: number }[]; // existing `manual` rows, YYYY-MM-DD
  enterBefore: string | null;                    // YYYY-MM-DD; null = no cutoff (Manual)
  source: BalanceSource;                         // for the "Skipped: <source>" label
  today: string;                                 // YYYY-MM-DD, server UTC day
};
export function parseDayText(text: string): string | null;     // YYYY-MM-DD or M/D/YYYY → YYYY-MM-DD
export function parseBalanceText(text: string): number | null; // also used by the single Add row
export function parsePastBalances(text: string): ParsedLine[];
export function classifyPastBalances(lines: ParsedLine[], ctx: ClassifyContext): ClassifiedLine[];
```

- [ ] **Step 1: Write the failing tests**

```ts
describe('parseDayText', () => {
  it('reads ISO and US dates and refuses invalid calendar days', () => {
    expect(parseDayText('2025-03-31')).toBe('2025-03-31');
    expect(parseDayText('3/31/2025')).toBe('2025-03-31');
    expect(parseDayText('12/1/2025')).toBe('2025-12-01');
    for (const bad of ['2025-02-30', '2/30/2025', '31/3/2025', '2025-3-31', 'Q4 total', ''])
      expect(parseDayText(bad)).toBeNull();
  });
});

describe('parseBalanceText', () => {
  it('parses balances with symbols, codes, commas and negatives', () => {
    expect(parseBalanceText('31,904.22')).toBe(31904.22);
    expect(parseBalanceText('$36,950.10')).toBe(36950.1);
    expect(parseBalanceText('CA$ 1,200')).toBe(1200);
    expect(parseBalanceText('1200 CAD')).toBe(1200);
    expect(parseBalanceText('USD 5')).toBe(5);
    expect(parseBalanceText('-12.5')).toBe(-12.5);
    expect(parseBalanceText('(1,234.56)')).toBe(-1234.56);
    expect(parseBalanceText('−40')).toBe(-40); // U+2212, as the app formats
    expect(parseBalanceText('10.256')).toBe(10.26);
    for (const bad of ['—', '', '12abc', '1.2.3', '$']) expect(parseBalanceText(bad)).toBeNull();
  });
});

describe('parsePastBalances', () => {
  it('splits a leading date from the balance on tab, comma or spaces', () => {
    expect(parsePastBalances('2025-03-31\t31,904.22\n9/30/2025, $36,950.10\n2025-12-31   100')).toEqual([
      { kind: 'ok', text: '2025-03-31\t31,904.22', date: '2025-03-31', balance: 31904.22 },
      { kind: 'ok', text: '9/30/2025, $36,950.10', date: '2025-09-30', balance: 36950.1 },
      { kind: 'ok', text: '2025-12-31   100', date: '2025-12-31', balance: 100 },
    ]);
  });
  it('ignores blank lines', () => {
    expect(parsePastBalances('\n2025-01-31,1\n\n  \n')).toHaveLength(1);
  });
  it('reads CRLF pastes and marks a header row unreadable', () => {
    const lines = parsePastBalances('Date,Balance\r\n2025-01-31,1\r\n');
    expect(lines.map((l) => l.kind)).toEqual(['unreadable', 'ok']);
    expect(lines[1]).toMatchObject({ text: '2025-01-31,1', balance: 1 });
  });
  it('marks lines missing either part unreadable', () => {
    expect(parsePastBalances('2025-01-31\nQ4 total\t—\n100').map((l) => l.kind)).toEqual([
      'unreadable', 'unreadable', 'unreadable',
    ]);
  });
});

describe('classifyPastBalances', () => {
  const ctx: ClassifyContext = {
    entered: [{ date: '2025-06-30', balance: 50 }, { date: '2025-09-30', balance: 70 }],
    enterBefore: '2026-03-03',
    source: BalanceSource.Provider,
    today: '2026-10-09',
  };
  it('gives every line one status and saves only new and replacing ones', () => {
    const text = [
      '2025-03-31,10',  // new
      '2025-06-30,55',  // replaces 50
      '2025-09-30,70',  // already entered
      '2026-03-03,1',   // skipped: on the cutoff
      '2026-12-01,1',   // future (checked before the cutoff)
      '2025-03-31,11',  // repeated
      'nope',           // unreadable
    ].join('\n');
    const out = classifyPastBalances(parsePastBalances(text), ctx);
    expect(out.map((c) => c.status)).toEqual([
      { kind: 'new' },
      { kind: 'replaces', previous: 50 },
      { kind: 'already' },
      { kind: 'skipped', source: BalanceSource.Provider, from: '2026-03-03' },
      { kind: 'future' },
      { kind: 'repeated' },
      { kind: 'unreadable' },
    ]);
    expect(out.map((c) => c.saves)).toEqual([true, true, false, false, false, false, false]);
  });
  it('has no cutoff for a manual account and allows today', () => {
    const out = classifyPastBalances(parsePastBalances('2026-10-09,5\n2026-05-01,6'), {
      ...ctx, enterBefore: null, source: BalanceSource.Manual,
    });
    expect(out.map((c) => c.status.kind)).toEqual(['new', 'new']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:unit -- past-balances` (expected: FAIL, module not found).

- [ ] **Step 3: Implement `past-balances.ts`**
  - **Parsing:**
    - Trim each line, including `\r`, and drop blank lines.
    - Split with `/^(\S+?)[\t, ]+(.+)$/`, then run `parseDayText` on part 1 and `parseBalanceText` on part 2. If either is null, the line is `unreadable`.
    - `parseDayText` round-trips through `utcDay`/`isoDay` to reject invalid calendar days.
  - **`parseBalanceText`:**
    - Map `−` to `-`. Wrapping `( )` means negative.
    - Strip `[A-Z]{2}\$`, `$`, standalone `[A-Z]{3}` codes, commas and whitespace.
    - Then require `/^-?\d+(\.\d+)?$/` and return `roundCents`.
  - **Classification:**
    - Check order: unreadable → future (`date > today`) → skipped (`enterBefore && date >= enterBefore`) → repeated (the date appeared on an earlier readable line) → already (the entered amount equals the balance after `roundCents`) → replaces → new.
    - `saves` is true for `new` and `replaces` only.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:unit -- past-balances` (expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add src/lib/investments/past-balances.ts tests/unit/lib/investments/past-balances.test.ts
git commit -m "feat(investments): parse and classify pasted past balances"
```

---

### Task 2: `EnteredBalanceService` (rename and generalise `ManualHoldingService`)

**Files:**
- Rename: `src/lib/investments/manual-holding.ts` → `src/lib/investments/entered-balances.ts` (`git mv`)
- Rename: `tests/unit/lib/investments/manual-holding.test.ts` → `tests/unit/lib/investments/entered-balances.test.ts`
- Modify:
  - `src/lib/investments/account-guard.ts:14-26`: `requireInvestmentAccount`, third param optional.
  - `src/lib/investments/services.ts`: key `manualHoldings` → `enteredBalances`.
  - `src/lib/investments/valuation.ts:7,17`: ctor type.
  - `src/lib/investments/current-holdings.ts:5,30-33`: Manual accounts show only the mirror.
  - Import paths that name `manual-holding`: `current-holdings.ts`, `valuation.ts`, `tests/unit/lib/investments/{valuation,current-holdings}.test.ts`.
  - Callers of `manualHoldings`: `src/app/api/transactions/adjustment/route.ts:39-40`, both `balances` routes. Rename only here; Task 3 changes their shapes.
- Test: `tests/unit/lib/investments/entered-balances.test.ts`, `tests/unit/lib/investments/current-holdings.test.ts`

**Interfaces:**
- Consumes: `classifyPastBalances`, `ParsedLine`, `PastBalanceStatus` (Task 1).
- Produces:

```ts
export const manualHoldingSecurityId: (accountId: string) => string; // unchanged
export type EnteredSkipReason = 'already' | 'skipped' | 'future' | 'repeated' | 'unreadable' | 'kept';
export class EnteredBalanceService {
  constructor(prisma: PrismaClient, clock?: Clock);
  list(accountId: string): Promise<{ balances: AccountBalance[]; enterBefore: Date | null }>;
  record(accountId: string, input: { date: string | Date; balance: number }): Promise<AccountBalance>;
  recordMany(accountId: string, rows: { date: string; balance: number }[]):
    Promise<{ saved: number; skipped: { date: string; reason: EnteredSkipReason }[] }>;
  delete(accountId: string, balanceId: string): Promise<void>;
  sync(accountId: string): Promise<boolean>;   // Manual accounts only (unchanged contract)
  syncAll(): Promise<number>;                  // unchanged
  removalOps(accountId: string): Prisma.PrismaPromise<unknown>[]; // unchanged
}
// account-guard.ts
export async function requireInvestmentAccount(
  prisma: PrismaClient, accountId: string, balanceSource?: BalanceSource
): Promise<Account>; // omitted → any investment account; message "Account is not an investment account"
// InvestmentServices: { …, enteredBalances: EnteredBalanceService } (replaces manualHoldings)
```

**Rules:**
- **`enterBefore`** (private `enterBefore(account)`):
  - Provider: the earliest of the first `BalanceRowSource.Synced` balance and the first `RecordSource.Synced` snapshot. Today if there is neither.
  - Valuation: the first snapshot whose `securityId` is not the mirror. Today if there is none.
  - Manual: `null`.
- **`record`:**
  - Not finite → 400 `Balance must be a number`. Future → 400 `Balance date cannot be in the future`. Both exist today.
  - On or after the cutoff → 400 `` `Balances you enter must be dated before ${isoDay(enterBefore)}` ``.
  - An existing non-manual row that day → 400 `` `This day already has a ${row.source === BalanceRowSource.Synced ? 'synced' : 'valued'} balance` ``.
  - Otherwise upsert as today. `sync` runs only for Manual accounts.
- **`recordMany`:**
  - Map the rows to `ParsedLine` `ok` lines and classify them against the account's manual rows, `enterBefore`, the source and today. The rows that save, minus dates holding a non-manual row (`kept`), are upserted in **one** `prisma.$transaction([...])`.
  - Then `sync` for Manual accounts. `skipped` lists every other row with its status kind, in input order.
- **`delete`:** works on any investment account, removes only that account's `manual` rows (404 otherwise), and syncs for Manual.
- **`sync`:**
  - The entries are the manual rows, plus the latest stored balance of any source when it is newer than the newest manual row.
  - The in-sync check compares only snapshots on the mirror security.
  - Deletes are scoped to `{ accountId, securityId: mirror }`; real snapshots are never touched.
  - Update the doc comment.
- **`CurrentHoldingsReader`:** `isLeftoverMirror` becomes `isHidden(accountId, securityId)`. It hides the mirror for Valuation accounts and every non-mirror security for Manual accounts.

- [ ] **Step 1: Rename files and symbols; existing tests still pass**

`git mv` both files and rename the class, the `manual` test variable and the `describe` to `EnteredBalanceService`. Point imports at `./entered-balances` and change the services key. Run `npm run typecheck` and `npm run test:unit -- entered-balances valuation current-holdings` (expected: PASS, a behaviour-free rename).

- [ ] **Step 2: Write the failing tests** (in `entered-balances.test.ts`; clock fixed at `2026-10-09T15:00:00Z`)

```ts
it('enterBefore is the first synced balance or synced holdings day for a synced account', async () => {
  const p = await seedInvestmentAccount(prisma, { balanceSource: BalanceSource.Provider });
  expect((await svc.list(p.id)).enterBefore).toEqual(day('2026-10-09'));
  await seedBalance(prisma, p.id, '2026-03-05', 10, BalanceRowSource.Synced);
  const s = await seedSecurity(prisma);
  await seedSnapshot(prisma, { accountId: p.id, securityId: s.id, date: '2026-03-03', quantity: 1, price: 10 });
  expect((await svc.list(p.id)).enterBefore).toEqual(day('2026-03-03'));
});
it('enterBefore is the first real holdings day for a valued account, ignoring the mirror', async () => {
  // a mirror snapshot on 2026-01-01 (seed via sync while Manual, then flip to Valuation), a real one on 2026-05-01
  expect((await svc.list(v.id)).enterBefore).toEqual(day('2026-05-01'));
});
it('a manual account has no cutoff', async () => {
  expect((await svc.list(m.id)).enterBefore).toBeNull();
});
it('records before a synced account’s cutoff and refuses on or after it', async () => {
  // synced balance on 2026-03-03
  await expect(svc.record(p.id, { date: '2026-03-02', balance: 9 })).resolves.toMatchObject({ source: BalanceRowSource.Manual });
  await expect(svc.record(p.id, { date: '2026-03-03', balance: 9 })).rejects.toMatchObject({
    status: 400, message: 'Balances you enter must be dated before 2026-03-03',
  });
  expect(await prisma.holdingSnapshot.count({ where: { accountId: p.id } })).toBe(0); // no mirror on Synced
});
it('never overwrites a synced or valued row', async () => {
  // Manual account with a synced row on 2026-05-01
  await expect(svc.record(m.id, { date: '2026-05-01', balance: 1 })).rejects.toMatchObject({
    status: 400, message: 'This day already has a synced balance',
  });
});
it('recordMany saves new and replacing rows and reports the rest in input order', async () => {
  // Manual; entered 2026-01-31 = 100
  const r = await svc.recordMany(m.id, [
    { date: '2026-01-31', balance: 100 }, { date: '2026-02-28', balance: 200 },
    { date: '2026-03-31', balance: 300 }, { date: '2026-02-28', balance: 999 },
    { date: '2026-12-31', balance: 5 },
  ]);
  expect(r).toEqual({ saved: 2, skipped: [
    { date: '2026-01-31', reason: 'already' }, { date: '2026-02-28', reason: 'repeated' },
    { date: '2026-12-31', reason: 'future' },
  ] });
  expect((await snapshots(m.id)).map((s) => [s[0], s[3]])).toEqual([
    ['2026-01-31', 100], ['2026-02-28', 200], ['2026-03-31', 300],
  ]);
});
it('recordMany writes every saved row through one transaction', async () => {
  const tx = vi.spyOn(prisma, '$transaction');
  await svc.recordMany(m.id, [{ date: '2026-01-31', balance: 1 }, { date: '2026-02-28', balance: 2 }]);
  expect(tx.mock.calls.filter(([ops]) => Array.isArray(ops) && ops.length === 2)).toHaveLength(1);
  tx.mockRestore();
});
it('recordMany keeps a synced or valued row on the same date', async () => {
  // Manual account with a valuation row on 2026-05-01
  expect((await svc.recordMany(m.id, [{ date: '2026-05-01', balance: 1 }])).skipped)
    .toEqual([{ date: '2026-05-01', reason: 'kept' }]);
});
it('delete removes only that account’s entered rows', async () => {
  // a synced row on p, a manual row on another account → both 404
});
it('mirror sync keeps real holdings and mirrors the latest balance when newer than the last entry', async () => {
  // Manual account: real snapshot (security s) on 2026-05-01; manual row 2026-04-01 = 600; valuation row 2026-06-01 = 700
  expect(await svc.sync(m.id)).toBe(true);
  expect(await prisma.holdingSnapshot.count({ where: { accountId: m.id, securityId: s.id } })).toBe(1);
  expect((await snapshots(m.id)).filter((x) => x[1] === manualHoldingSecurityId(m.id)).map((x) => [x[0], x[3]]))
    .toEqual([['2026-04-01', 600], ['2026-06-01', 700]]);
  expect(await svc.sync(m.id)).toBe(false);
});
```

Change the existing test "rejects future dates, non-numbers and non-manual accounts". A Provider account is now accepted before its cutoff, so assert a **non-investment** account (`createAccountData` with `trackingMode: 'cash_flow'`) is refused with 400 instead. Keep the 404 case.

In `current-holdings.test.ts`, add:

```ts
it('shows only the mirror for a manual account that still has real holdings', async () => {
  // Manual account with a real snapshot and a mirror snapshot on a later day
  expect(rows.map((r) => r.securityId)).toEqual([manualHoldingSecurityId(m.id)]);
});
```

- [ ] **Step 3: Run to verify the new tests fail**

Run: `npm run test:unit -- entered-balances current-holdings` (expected: FAIL on the new cases).

- [ ] **Step 4: Implement the rules above** in `entered-balances.ts`, `account-guard.ts` and `current-holdings.ts`.

- [ ] **Step 5: Run to verify they pass**

Run: `npm run test:unit -- entered-balances current-holdings valuation` and `npm run test:integration -- investment-adjustment`, then `npm run typecheck` (expected: PASS).

- [ ] **Step 6: Commit**

```bash
git add src/lib/investments/entered-balances.ts src/lib/investments/manual-holding.ts \
  src/lib/investments/account-guard.ts src/lib/investments/services.ts src/lib/investments/valuation.ts \
  src/lib/investments/current-holdings.ts src/app/api/transactions/adjustment/route.ts \
  "src/app/api/investments/accounts/[id]/balances/route.ts" \
  "src/app/api/investments/accounts/[id]/balances/[balanceId]/route.ts" \
  tests/unit/lib/investments/entered-balances.test.ts tests/unit/lib/investments/manual-holding.test.ts \
  tests/unit/lib/investments/valuation.test.ts tests/unit/lib/investments/current-holdings.test.ts
git commit -m "feat(investments): entered balances for every investment account"
```

---

### Task 3: Balances and holdings API

**Files:**
- Modify: `src/app/api/investments/accounts/[id]/balances/route.ts`
- Modify: `src/app/api/investments/accounts/[id]/holdings/route.ts` (add `GET`)
- Modify: `src/lib/investments/overview.ts` (add `accountHoldings`)
- Test: `tests/integration/api/investment-account-apis.test.ts`, `tests/unit/lib/investments/overview.test.ts`

**Interfaces:**
- Consumes: `EnteredBalanceService.list/record/recordMany` (Task 2), `CurrentHoldingsReader.read`, `PriceRefresher.freshness`.
- Produces (HTTP):
  - `GET …/balances` → `{ balances: AccountBalance[]; enterBefore: string | null; today: string }`
  - `POST …/balances` with `{ date, balance }` → 201 `{ balance }`
  - `POST …/balances` with `{ balances: { date, balance }[] }` (1–1000 rows) → 200 `{ saved, skipped }`
  - `GET …/holdings` → `AccountHoldings`
- Produces (TS):

```ts
export type AccountHoldings = { holdings: HoldingRow[]; pricesAsOf: string | null };
// InvestmentOverviewService
accountHoldings(accountId: string): Promise<AccountHoldings>;
```

`accountHoldings` checks the account with `requireInvestmentAccount(prisma, id)`, so archived accounts are allowed. It reads with `rangeStart = today` and the settings' base currency and FX rates. `pricesAsOf` comes from `freshness({ securityIds })` for Valuation accounts and is null otherwise. `today` in GET balances is `isoDay(utcDay(clock.now()))`: expose it as `EnteredBalanceService.today(): string` (public, one line) so the route doesn't build its own clock.

- [ ] **Step 1: Write the failing tests** (route file; clock `2026-10-09T22:00Z`)

```ts
it('GET balances returns entered rows newest first with the cutoff and today', async () => {
  // provider account: synced balance 2026-03-03; manual rows 2025-12-31 and 2026-01-31
  expect(await res.json()).toMatchObject({
    enterBefore: '2026-03-03', today: '2026-10-09',
    balances: [{ balance: 2 }, { balance: 1 }],
  });
});
it('POST balances saves a batch and reports skipped rows', async () => {
  const res = await postBalance(req('POST', { balances: [
    { date: '2026-01-31', balance: 1 }, { date: '2026-12-01', balance: 2 },
  ] }), params({ id: m.id }));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ saved: 1, skipped: [{ date: '2026-12-01', reason: 'future' }] });
});
it('POST balances refuses a single entry on or after the cutoff', async () => {
  // → 400 { error: 'Balances you enter must be dated before 2026-03-03' }
});
it('POST balances rejects an empty batch and a malformed date', async () => {
  // { balances: [] } → 400; { date: '2026-02-30', balance: 1 } → 400
});
it('GET holdings returns the current holdings and price date, archived accounts included', async () => {
  // valued, isActive false, snapshot AAA ×2 on 2026-10-09, price 25 on 2026-10-09
  expect(await res.json()).toMatchObject({
    holdings: [{ securityId: s.id, quantity: 2, value: 50 }], pricesAsOf: '2026-10-09',
  });
});
```

Update the existing GET-balances assertions from `toEqual({ balances })` to `toMatchObject`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:integration -- investment-account-apis` (expected: FAIL).

- [ ] **Step 3: Implement**
  - In the balances route: `const single = z.object({ date: isoDateSchema, balance: z.number() })` and the body `z.union([single, z.object({ balances: z.array(single).min(1).max(1000) })])`. Branch on `'balances' in body.data`.
  - Add `GET` to the holdings route, calling `overview.accountHoldings`, with error fallback `'Failed to load holdings'`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:integration -- investment-account-apis` and `npm run test:unit -- overview` (expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add "src/app/api/investments/accounts/[id]/balances/route.ts" \
  "src/app/api/investments/accounts/[id]/holdings/route.ts" src/lib/investments/overview.ts \
  src/lib/investments/entered-balances.ts tests/integration/api/investment-account-apis.test.ts
git commit -m "feat(investments): balances batch POST, entry cutoff and account holdings API"
```

---

### Task 4: New investment accounts start as Investment (create, adopt, adopt note)

**Files:**
- Modify:
  - `src/lib/account-defaults.ts`
  - `src/lib/bank-account-matching.ts`: add `isInvestmentProviderType`.
  - `src/app/api/accounts/route.ts:46-63`
  - `src/app/api/bank-accounts/adopt/route.ts:60-70`
  - `src/components/institutions/AdoptAccountModal.tsx`
- Test:
  - `tests/unit/lib/account-defaults.test.ts` (create)
  - `tests/unit/lib/bank-account-matching.test.ts`
  - `tests/integration/api/accounts.test.ts`
  - `tests/integration/api/bank-accounts-adopt.test.ts`
  - `tests/unit/components/adopt-account-modal.test.tsx` (create)

**Interfaces:**
- Produces:

```ts
// account-defaults.ts (BALANCE_ONLY_TYPES is deleted; nothing else uses it)
export const INVESTMENT_TYPES = ['brokerage', 'retirement', 'crypto'] as const;
export function getDefaultTrackingMode(type: string): TrackingMode; // investment | balance_only (loan) | cash_flow
export function defaultBalanceSource(trackingMode: TrackingMode, opts: { synced: boolean }): BalanceSource | null;
//   investment + synced → Provider; investment → Manual; otherwise null
// bank-account-matching.ts (integration boundary)
export function isInvestmentProviderType(providerType: string | null | undefined): boolean; // 'investment', case-insensitive
```

- **Create:** `trackingMode = parsed.trackingMode ?? getDefaultTrackingMode(parsed.type)` and `balanceSource = parsed.balanceSource ?? defaultBalanceSource(trackingMode, { synced: false })`.
- **Adopt:**
  - `trackingMode = isInvestmentProviderType(parsed.providerType) ? 'investment' : getDefaultTrackingMode(parsed.type)`.
  - `balanceSource = defaultBalanceSource(trackingMode, { synced: parsed.provider === 'plaid' })`, with a one-line comment pointing at Spec note 1 (only the Plaid connection runs the investment sync).
- **Adopt note:** when `isInvestmentProviderType(account.type)`, render under the Type select, with the `HINT`-like muted style:

```tsx
<p className={`text-xs ${ds.text.muted}`} data-testid="adopt-investment-note">
  Your institution reports this as an <strong>investment account</strong>, so it will track a
  balance history, holdings and activity, and stay out of budgets and spending. Balance
  source: <strong>Synced</strong>.
</p>
```

- [ ] **Step 1: Write the failing tests**

```ts
// account-defaults.test.ts
it.each([['brokerage', 'investment'], ['retirement', 'investment'], ['crypto', 'investment'],
  ['loan', 'balance_only'], ['checking', 'cash_flow'], ['other', 'cash_flow']])(
  'getDefaultTrackingMode(%s) is %s', (type, mode) => expect(getDefaultTrackingMode(type)).toBe(mode));
it('defaultBalanceSource is Synced only for a synced investment account', () => {
  expect(defaultBalanceSource('investment', { synced: true })).toBe(BalanceSource.Provider);
  expect(defaultBalanceSource('investment', { synced: false })).toBe(BalanceSource.Manual);
  expect(defaultBalanceSource('cash_flow', { synced: true })).toBeNull();
});
// bank-account-matching.test.ts
it('isInvestmentProviderType recognises only the aggregator’s investment type', () => {
  expect(isInvestmentProviderType('investment')).toBe(true);
  expect(isInvestmentProviderType('Investment')).toBe(true);
  for (const t of ['depository', 'credit', '', undefined, null]) expect(isInvestmentProviderType(t)).toBe(false);
});
// accounts.test.ts
it('POST creates brokerage, retirement and crypto accounts as manual investment accounts', …);
//   → { trackingMode: 'investment', balanceSource: BalanceSource.Manual }
it('POST creates a loan as net-worth-only with no balance source', …);
// bank-accounts-adopt.test.ts (Plaid enrollment seeded as the file's Plaid test does, ~line 193)
it('adopts an aggregator investment account as a synced investment account whatever type is picked', …);
//   plaid, providerType 'investment', type 'other' → investment / Provider
it('adopts a brokerage-typed Plaid depository account as synced', …);       // investment / Provider
it('adopts a brokerage-typed Teller account as a manual investment account', …); // investment / Manual
// adopt-account-modal.test.tsx
it('explains an investment account before adding it', …);  // account.type 'investment' → note text present
it('shows no note for a bank account', …);                  // account.type 'depository' → absent
```

The existing loan test ("applies the balance_only tracking default…") stays as is.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit -- account-defaults bank-account-matching adopt-account-modal` and `npm run test:integration -- accounts bank-accounts-adopt` (expected: FAIL).

- [ ] **Step 3: Implement** as specified above.

- [ ] **Step 4: Run to verify they pass** (same commands; expected: PASS), then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/account-defaults.ts src/lib/bank-account-matching.ts src/app/api/accounts/route.ts \
  src/app/api/bank-accounts/adopt/route.ts src/components/institutions/AdoptAccountModal.tsx \
  tests/unit/lib/account-defaults.test.ts tests/unit/lib/bank-account-matching.test.ts \
  tests/integration/api/accounts.test.ts tests/integration/api/bank-accounts-adopt.test.ts \
  tests/unit/components/adopt-account-modal.test.tsx
git commit -m "feat(accounts): new brokerage, retirement and crypto accounts start as investment accounts"
```

---

### Task 5: Account mode guard and balance-source switches

**Files:**
- Modify: `src/lib/investments/account-guard.ts` (add `checkAccountUpdate`)
- Modify: `src/lib/investments/entered-balances.ts` (add `switchSource`)
- Modify: `src/lib/investments/refresh.ts` (add `switchBalanceSource`, ctor param)
- Modify: `src/lib/investments/services.ts` (pass `enteredBalances` to the refresh service)
- Modify: `src/app/api/accounts/[id]/route.ts` (`PATCH`)
- Test: `tests/unit/lib/investments/account-guard.test.ts` (create), `tests/integration/api/account-source-switch.test.ts` (create)

**Interfaces:**
- Consumes: `EnteredBalanceService.sync` (Task 2), `ValuationService.writeBalances`, `investmentErrorResponse`.
- Produces:

```ts
// account-guard.ts (pure; throws InvestmentInputError 400)
export function checkAccountUpdate(
  current: { trackingMode: string; balanceSource: string | null },
  update: { trackingMode?: string; balanceSource?: BalanceSource | null },
  ctx: { synced: boolean } // the account has a connection that syncs investment balances
): { switchTo: BalanceSource | null };
// EnteredBalanceService
switchSource(accountId: string, to: BalanceSource): Promise<void>; // update balanceSource; Manual → sync()
// InvestmentRefreshService(prices, valuation, catalog, entered: Pick<EnteredBalanceService, 'switchSource'>)
switchBalanceSource(accountId: string, to: BalanceSource): Promise<void>;
//   withSyncLock(REFRESH_LOCK): entered.switchSource; if Valuation → valuation.writeBalances({ accountIds: [id] })
```

**Guard messages (exact):**
- Mode change across investment: `An account can’t be converted to or from an investment account`
- A source change on a non-investment account: `Only investment accounts have a balance source`
- Investment source set to null: `An investment account needs a balance source`
- To Provider while not synced: `Synced needs a connection to this account’s institution.`
- Away from Provider while synced: `Disconnect to value it or enter balances yourself.`
- An unchanged value (including a null source on an everyday account) is not a change: `switchTo: null`.

**PATCH route:**
- Load the account with `plaidConnection` (404 `Account not found` if it is missing). `synced = !!account.plaidConnection`, with a comment pointing at Spec note 1.
- Run `checkAccountUpdate`. If `switchTo`, call `(await getInvestmentServices()).refresh.switchBalanceSource(id, switchTo)`.
- Then `prisma.account.update` with the other fields (`balanceSource` omitted) and return the account.
- Catch with `investmentErrorResponse(error, 'Failed to update account')`, imported from `@/app/api/investments/_lib/http`.

- [ ] **Step 1: Write the failing tests**

```ts
// account-guard.test.ts
const inv = (balanceSource: BalanceSource) => ({ trackingMode: 'investment', balanceSource });
const everyday = { trackingMode: 'cash_flow', balanceSource: null };
it('refuses converting to or from an investment account', () => {
  expect(() => checkAccountUpdate(everyday, { trackingMode: 'investment' }, { synced: false }))
    .toThrow('An account can’t be converted to or from an investment account');
  expect(() => checkAccountUpdate(inv(BalanceSource.Manual), { trackingMode: 'balance_only' }, { synced: false }))
    .toThrow('An account can’t be converted to or from an investment account');
});
it('allows an unchanged tracking mode and source', () => {
  expect(checkAccountUpdate(inv(BalanceSource.Manual), { trackingMode: 'investment', balanceSource: BalanceSource.Manual }, { synced: false }))
    .toEqual({ switchTo: null });
  expect(checkAccountUpdate(everyday, { trackingMode: 'cash_flow', balanceSource: null }, { synced: false }))
    .toEqual({ switchTo: null });
});
it('refuses a balance source on an everyday account', …);   // 'Only investment accounts have a balance source'
it('refuses clearing an investment account’s source', …);   // 'An investment account needs a balance source'
it('refuses Synced without a connection', …);
it('refuses leaving Synced while connected', …);
it('allows leaving Synced once the connection is gone', () => {
  expect(checkAccountUpdate(inv(BalanceSource.Provider), { balanceSource: BalanceSource.Valuation }, { synced: false }))
    .toEqual({ switchTo: BalanceSource.Valuation });
});
it('allows switching between Valued and Manual', …);         // both directions → switchTo
// account-source-switch.test.ts (mock prisma + services as investment-account-apis.test.ts does)
it('PATCH refuses converting an everyday account to investment', …);    // 400 + message
it('PATCH refuses Synced on an account without a connection', …);      // 400 + message
it('PATCH Valued → Manual keeps history and writes the mirror', async () => {
  // valued account: real snapshot 2026-10-01 (AAA ×2), valuation rows 2026-10-01 = 50 and 2026-10-09 = 60
  const res = await PATCH(patchReq({ balanceSource: BalanceSource.Manual }), params({ id: v.id }));
  expect(res.status).toBe(200);
  expect(await testPrisma.accountBalance.count({ where: { accountId: v.id } })).toBe(2);
  expect(await testPrisma.holdingSnapshot.count({ where: { accountId: v.id, securityId: s.id } })).toBe(1);
  expect(await testPrisma.holdingSnapshot.findMany({ where: { accountId: v.id, securityId: manualHoldingSecurityId(v.id) } }))
    .toMatchObject([{ date: day('2026-10-09'), value: 60 }]);
});
it('PATCH Manual → Valued keeps entered balances and leaves the mirror until holdings are saved', …);
it('PATCH still saves ordinary fields alongside an unchanged source', …); // name change → 200, name updated
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit -- account-guard` and `npm run test:integration -- account-source-switch` (expected: FAIL).

- [ ] **Step 3: Implement** as specified above. Update `services.ts`: `new InvestmentRefreshService(prices, valuation, catalog, enteredBalances)`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:unit -- account-guard refresh` and `npm run test:integration -- account-source-switch accounts` (expected: PASS), then `npm run typecheck`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/investments/account-guard.ts src/lib/investments/entered-balances.ts \
  src/lib/investments/refresh.ts src/lib/investments/services.ts "src/app/api/accounts/[id]/route.ts" \
  tests/unit/lib/investments/account-guard.test.ts tests/integration/api/account-source-switch.test.ts
git commit -m "feat(investments): guard account mode changes and switch balance sources under the refresh lock"
```

---

### Task 6: Push drawer, option cards, modal semantics

**Files:**
- Modify: `src/components/ui/drawer.tsx` (rework; currently unused)
- Modify: `src/components/ui/modal.tsx` (`role="dialog"`, `aria-modal="true"`, `aria-labelledby` on the title)
- Create: `src/components/ui/option-cards.tsx`
- Test: `tests/unit/components/ui/drawer.test.tsx`, `tests/unit/components/ui/option-cards.test.tsx`

**Interfaces:**
- Produces:

```ts
// drawer.tsx
export const DRAWER_WIDTH = 540; // px
export const DRAWER_PUSH_CLASS = 'min-[1100px]:pr-[540px]'; // literal for Tailwind; pages add it while open
type DrawerProps = { open: boolean; onClose: () => void; title: string; subtitle?: string; children: React.ReactNode };
export function Drawer(props: DrawerProps): JSX.Element | null;
// option-cards.tsx
export type OptionCard<T extends string> = { value: T; title: string; description: string; disabled?: boolean };
export function OptionCards<T extends string>(props: {
  label: string; value: T; options: OptionCard<T>[]; onChange: (value: T) => void;
}): JSX.Element;
```

**Drawer behaviour:**
- Returns `null` when closed.
- When open it is an `<aside role="dialog" aria-modal="false" aria-labelledby={titleId}>`, `fixed right-0 top-0 bottom-0 z-40`, `w-[min(540px,100vw)]`, `bg-[var(--bg-elevated)]`, with a left border and the mock's shadow. There is no backdrop.
- The header holds `<h3 id={titleId}>` and the subtitle (muted, 12.5px), plus a ✕ button with `aria-label="Close"`. The body is `overflow-y-auto`.
- On open it remembers `document.activeElement` and focuses the panel (`tabIndex={-1}`). On close or unmount it restores focus to that element when it is still connected.
- A document `keydown` Escape calls `onClose`, unless `document.querySelector('[aria-modal="true"]')` is truthy.

**OptionCards:**
- A `role="radiogroup"` with `aria-label={label}`. Each card is a `<button type="button" role="radio" aria-checked aria-disabled>`, laid out in a 3-column grid.
- Styling follows the mock: `.opt`, `.opt.on` (accent border plus inset ring), `.opt.off` (opacity 45%). The title is 12.5px semibold with a radio dot, the description 11px muted.
- Clicking a disabled card does nothing.

- [ ] **Step 1: Write the failing tests**

```tsx
it('renders nothing when closed', …);                  // queryByRole('dialog') null
it('is a non-modal dialog labelled by its title, with the subtitle', () => {
  render(<Drawer open subtitle="Test Bank" title="Manage Test Checking" onClose={vi.fn()}>body</Drawer>);
  const d = screen.getByRole('dialog', { name: 'Manage Test Checking' });
  expect(d).toHaveAttribute('aria-modal', 'false');
  expect(screen.getByText('Test Bank')).toBeInTheDocument();
});
it('moves focus into the drawer on open and back to the opener on close', …);
  // focus a <button>Open</button>, rerender open → dialog contains activeElement; rerender closed → button focused
it('closes on Esc and on ✕', …);                       // onClose called twice
it('ignores Esc while a modal dialog is open over it', () => {
  render(<><Drawer open title="Manage A" onClose={onClose}>x</Drawer><Modal isOpen title="Edit" onClose={vi.fn()}>y</Modal></>);
  await userEvent.keyboard('{Escape}');
  expect(onClose).not.toHaveBeenCalled();
});
// option-cards.test.tsx
it('marks the selected card and reports a choice', …);  // getByRole('radio', { name: /Valued/ }) aria-checked; click Manual → onChange('manual')
it('a disabled card cannot be chosen', …);             // aria-disabled true; click → onChange not called
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit -- drawer option-cards` (expected: FAIL).

- [ ] **Step 3: Implement** as specified above.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:unit -- drawer option-cards editors investments-page` (the last two check that the Modal change breaks nothing; expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/drawer.tsx src/components/ui/modal.tsx src/components/ui/option-cards.tsx \
  tests/unit/components/ui/drawer.test.tsx tests/unit/components/ui/option-cards.test.tsx
git commit -m "feat(ui): push drawer and option cards; modals announce themselves as modal dialogs"
```

---

### Task 7: Investment drawer sections (source picker, holdings, balances you entered)

**Files:**
- Create:
  - `src/components/investments/account-drawer.ts`: pure section and label rules.
  - `src/components/investments/balance-source-picker.tsx`
  - `src/components/investments/account-holdings-section.tsx`
  - `src/components/investments/entered-balances-section.tsx`
- Modify: `src/components/investments/format.ts` (add `SOURCE_LABEL`), `src/components/investments/pills.tsx` (use it)
- Test: `tests/unit/components/investments/account-drawer.test.ts`, `tests/unit/components/investments/drawer-sections.test.tsx`

**Interfaces:**
- Consumes: `OptionCards` (Task 6), `HoldingsEditorModal` (existing), `parseBalanceText` (Task 1), the Task 3 endpoints, `sendJson`/`errorText`/`FIELD_LABEL`/`HINT`/`ERROR`.
- Produces:

```ts
// format.ts
export const SOURCE_LABEL: Record<BalanceSource, 'Synced' | 'Valued' | 'Manual'>;
// account-drawer.ts
export type DrawerAccount = {
  trackingMode?: string; balanceSource?: string | null; institution?: string | null;
  hasConnection: boolean; // any bank connection
};
export type DrawerSection = 'connection' | 'holdings' | 'entered' | 'reconcile';
export function drawerSections(a: DrawerAccount): DrawerSection[];
export function drawerSubtitle(a: DrawerAccount): string;     // 'Test Bank' | 'Test Bank · Investment · Valued'
export function investmentBadge(a: DrawerAccount): string | null; // 'Investment · Valued' | null
export const TRACKING_INVESTMENT_TEXT = 'Investment: holdings and balance history';
// balance-source-picker.tsx
export function BalanceSourcePicker(p: { value: BalanceSource; canSync: boolean; onChange: (s: BalanceSource) => void }): JSX.Element;
// account-holdings-section.tsx
export function AccountHoldingsSection(p: {
  account: { id: string; name: string; currency: string; balanceSource: BalanceSource }; onChanged: () => void;
}): JSX.Element;
// entered-balances-section.tsx
export type EnteredBalancesView = { balances: { id: string; date: string; balance: number }[]; enterBefore: string | null; today: string };
export function EnteredBalancesSection(p: {
  account: { id: string; currency: string; balanceSource: BalanceSource }; onChanged: () => void;
}): JSX.Element;
```

**Rules and copy:**
- **`drawerSections`:**
  - Everyday: `['connection', 'reconcile']`. Connection always shows for everyday accounts (Spec note 2).
  - Investment: `connection` only if `hasConnection`, `holdings` for Provider/Valuation, then `entered`.
  - Details, Info and Archive are always rendered by the page and are not in the list.
- **Picker:**
  - Label "Balance source". Cards are Synced "From your institution through its connection.", Valued "The units you hold × daily market prices." and Manual "You enter the balance from statements."
  - `canSync`: every card is disabled except the checked Synced card. Hint: `Disconnect to value it or enter balances yourself.`
  - Not `canSync`: Synced is disabled; `value` stays checked even when it is Provider (a disconnected account). Hint: `Synced needs a connection to this account’s institution.`
- **Holdings:**
  - `h4` "Holdings", with sub-label `from the connection` (Provider) or `valued at daily closes` (Valuation).
  - Table header Security · Units · Price · Value. Security is `label` in mono plus `name` muted. Units use `fmtQty`. Price is `priceInAccount` and value is `value`, both `fmtMoney(…, { cents: true, currency })`.
  - Empty state: `No holdings yet.`
  - Valuation adds a `Edit holdings` button, which opens `HoldingsEditorModal` with the fetched rows and `pricesAsOf`. `onSaved` closes it, refetches and calls `onChanged()`.
- **Balances you entered:**
  - `h4` "Balances you entered" with sub-label `N entries` (`1 entry`), or `none yet`.
  - The add row is a form with *As of* (`type="date"`, default and `max` = `today` from the API), `Balance (CUR)`, and `Add`. It parses with `parseBalanceText`; null gives the error `Enter a balance`.
  - Hint text:
    - Provider/Valuation: `For days before syncing began on <enterBefore>, from old statements. Each one is exact on its date.` (Valuation says `valuing`.)
    - Manual: `From your statements. The balance holds until the next entry.`
  - Each list row shows date (mono), balance and a ✕ button with `aria-label="Delete balance <date>"`. Empty list: `No balances entered yet.`
  - API refusals render in `<p role="alert" className={ERROR}>`.
  - After any write: refetch, then `onChanged()`.

- [ ] **Step 1: Write the failing tests**

```ts
// account-drawer.test.ts
it.each([
  ['everyday, unconnected', { trackingMode: 'cash_flow', hasConnection: false }, ['connection', 'reconcile']],
  ['synced', { trackingMode: 'investment', balanceSource: BalanceSource.Provider, hasConnection: true }, ['connection', 'holdings', 'entered']],
  ['synced, disconnected', { trackingMode: 'investment', balanceSource: BalanceSource.Provider, hasConnection: false }, ['holdings', 'entered']],
  ['valued', { trackingMode: 'investment', balanceSource: BalanceSource.Valuation, hasConnection: false }, ['holdings', 'entered']],
  ['manual, connected', { trackingMode: 'investment', balanceSource: BalanceSource.Manual, hasConnection: true }, ['connection', 'entered']],
])('drawerSections: %s', (_n, a, expected) => expect(drawerSections(a)).toEqual(expected));
it('subtitle and badge name the source for investment accounts only', () => {
  expect(drawerSubtitle({ trackingMode: 'investment', balanceSource: BalanceSource.Valuation, institution: 'Test Bank', hasConnection: false }))
    .toBe('Test Bank · Investment · Valued');
  expect(drawerSubtitle({ trackingMode: 'cash_flow', institution: 'Test Bank', hasConnection: false })).toBe('Test Bank');
  expect(investmentBadge({ trackingMode: 'cash_flow', hasConnection: false })).toBeNull();
});
// drawer-sections.test.tsx
it('locks Synced when the account can sync', …);   // Synced checked; Valued, Manual aria-disabled; hint 'Disconnect to value it…'
it('offers Valued and Manual to a disconnected synced account', …);
  // value Provider, canSync false → Synced checked+disabled; hint 'Synced needs a connection…'; click Manual → onChange(Manual)
it('lists holdings with the valued sub-label and opens the editor', …);
  // GET …/holdings → one AAA row; 'valued at daily closes'; click 'Edit holdings' → dialog 'Edit holdings · Test Fund Account'
it('shows synced holdings without an edit button', …); // 'from the connection'; no 'Edit holdings'
it('shows the cutoff hint for a synced account and counts entries', …);
  // GET balances → enterBefore '2026-03-03', 2 rows → '2 entries' and
  // 'For days before syncing began on 2026-03-03, from old statements. Each one is exact on its date.'
it('shows the manual hint and empty state', …); // 'none yet', 'No balances entered yet.', manual hint
it('adds a balance and tells the page', async () => {
  // type '1,234.50', submit → POST body { date: '2026-10-09', balance: 1234.5 }; onChanged called; GET refetched
});
it('deletes an entry', …); // click 'Delete balance 2025-12-31' → DELETE …/balances/b-1
it('shows a refusal under the form', …); // POST 400 { error: 'Balances you enter must be dated before 2026-03-03' } → role alert
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit -- account-drawer drawer-sections` (expected: FAIL).

- [ ] **Step 3: Implement** as specified above; `pills.tsx` reads its labels from `SOURCE_LABEL`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:unit -- account-drawer drawer-sections display vendor-literals` (expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add src/components/investments/account-drawer.ts src/components/investments/balance-source-picker.tsx \
  src/components/investments/account-holdings-section.tsx src/components/investments/entered-balances-section.tsx \
  src/components/investments/format.ts src/components/investments/pills.tsx \
  tests/unit/components/investments/account-drawer.test.ts tests/unit/components/investments/drawer-sections.test.tsx
git commit -m "feat(investments): drawer sections for balance source, holdings and entered balances"
```

---

### Task 8: Paste past balances

**Files:**
- Create: `src/components/investments/past-balances-paste.tsx`
- Modify: `src/components/investments/entered-balances-section.tsx` (toggle link and panel)
- Test: `tests/unit/components/investments/past-balances-paste.test.tsx`

**Interfaces:**
- Consumes: `parsePastBalances`, `classifyPastBalances`, `ClassifiedLine` (Task 1), `EnteredBalancesView` (Task 7), batch POST (Task 3).
- Produces:

```ts
export function PastBalancesPaste(p: {
  account: { id: string; currency: string; balanceSource: BalanceSource };
  view: EnteredBalancesView;
  onCancel: () => void;
  onSaved: (result: { saved: number; skipped: { date: string; reason: string }[] }) => void;
}): JSX.Element;
```

**Copy and behaviour:**
- **Toggle:** below the list, a link-style button `Paste several from a spreadsheet` opens the panel; it is hidden while the panel is open. `Cancel` closes the panel and clears the text.
- **Input:** label `Paste past balances` on a `<textarea>`. Hint: `One per line: a date and a balance, separated by a tab or comma. Dates like 2025-03-31 or 3/31/2025.`
- **Preview:**
  - The preview is `useMemo` over the text: `classifyPastBalances(parsePastBalances(text), { entered, enterBefore, source, today })`.
  - Summary: `${n} lines read · ${toSave} to save · ${n - toSave} skipped`.
  - Table Date · Balance · status. Dimmed rows are those not saved; unreadable rows show the raw text across the two columns.
- **Status tags:**
  - `New` (green)
  - `Replaces <fmtMoney(previous, {cents, currency})>` (accent)
  - `Already entered`
  - `Skipped: <synced|valued> from <date>`, using the lower-cased `SOURCE_LABEL`
  - `In the future`
  - `Date repeated`
  - `Can’t read this line` (red)
- **Save:**
  - Button `Save ${toSave} balance${toSave === 1 ? '' : 's'}`, disabled when `toSave === 0` or while saving.
  - It POSTs `{ balances: <saving lines' { date, balance }> }`. On success it calls `onSaved(result)`; the section closes the panel, refetches and calls `onChanged()`.
  - If `result.skipped` holds any `kept`, the section shows `${k} not saved: a synced or valued balance is already on that day.` (muted hint, Spec note 7).
  - Errors go to `role="alert"`.

- [ ] **Step 1: Write the failing tests**

```tsx
const view = { balances: [{ id: 'b1', date: '2025-06-30', balance: 50 }, { id: 'b2', date: '2025-09-30', balance: 70 }],
  enterBefore: '2026-03-03', today: '2026-10-09' };
it('previews each line with its status and counts', async () => {
  await userEvent.type(textarea, …); // the 7 lines from Task 1's classify test (use fireEvent.change for tabs)
  expect(screen.getByText('7 lines read · 2 to save · 5 skipped')).toBeInTheDocument();
  for (const t of ['New', 'Replaces $50.00', 'Already entered', 'Skipped: synced from 2026-03-03',
    'In the future', 'Date repeated', 'Can’t read this line']) expect(screen.getByText(t)).toBeInTheDocument();
});
it('disables Save when nothing would be saved', …);   // 'Save 0 balances' disabled
it('saves only the savable lines', async () => {
  // reply POST → { saved: 2, skipped: [] }; click 'Save 2 balances'
  expect(calls().at(-1)).toEqual({ key: 'POST /api/investments/accounts/acc-1/balances',
    body: { balances: [{ date: '2025-03-31', balance: 10 }, { date: '2025-06-30', balance: 55 }] } });
  expect(onSaved).toHaveBeenCalledWith({ saved: 2, skipped: [] });
});
it('names one balance in the singular', …);           // 'Save 1 balance'
// in drawer-sections.test.tsx (EnteredBalancesSection)
it('opens and cancels the paste panel', …);
it('reports pasted rows the server kept', …);        // reply skipped [{ reason: 'kept' }] → '1 not saved: a synced or valued balance is already on that day.'
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit -- past-balances-paste drawer-sections` (expected: FAIL).

- [ ] **Step 3: Implement** as specified above.

- [ ] **Step 4: Run to verify they pass** (same command; expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add src/components/investments/past-balances-paste.tsx src/components/investments/entered-balances-section.tsx \
  tests/unit/components/investments/past-balances-paste.test.tsx tests/unit/components/investments/drawer-sections.test.tsx
git commit -m "feat(investments): paste past balances with a preview before saving"
```

---

### Task 9: Settings → Accounts uses the drawer

**Files:**
- Modify: `src/app/(routes)/settings/page.tsx`. Anchors:
  - `Account` type (~70-80)
  - `SortableAccountCard` (~255-420)
  - `openAccountModal` / `closeAccountModal` (~761-790)
  - `updateModalAccount` (~1390-1410)
  - the page root `return (` (~1903)
  - the accounts grid (~2390-2405)
  - the account `<Modal>` (~2614-3204)
- Test: `tests/unit/components/settings-accounts-drawer.test.tsx` (create)

**Interfaces:**
- Consumes: `Drawer`, `DRAWER_PUSH_CLASS` (Task 6). `drawerSections`, `drawerSubtitle`, `investmentBadge`, `TRACKING_INVESTMENT_TEXT`, `BalanceSourcePicker`, `AccountHoldingsSection`, `EnteredBalancesSection` (Task 7). `TrackingMode` (`account-defaults.ts`), `BalanceSource`.

**Changes (wiring only):**
1. **`Account` type:** `trackingMode?: TrackingMode; balanceSource?: BalanceSource | null`.
2. **Derived booleans:** add `const drawerAccount = (a: Account) => ({ ...a, hasConnection: !!(a.plaidConnection || a.tellerConnection) })` and `const canSync = (a: Account) => !!a.plaidConnection`. The latter sits at the bank boundary; comment it with Spec note 1.
3. **`SortableAccountCard` gets `selected: boolean`:**
   - When selected, both card variants get `border-[var(--accent)] ring-[3px] ring-[color-mix(in_srgb,var(--accent)_18%,transparent)]` and `data-selected="true"`.
   - The clickable area gets `role="button" tabIndex={0} aria-pressed={selected}`, and Enter/Space open it.
   - Render `investmentBadge(...)` where the `balance_only` badge renders today, with the same badge style.
4. **Replace the account `<Modal>` with `<Drawer>`:**
   - `open={accountModalOpen}`, `title={\`Manage ${modalAccount.name}\`}`, `subtitle={drawerSubtitle(drawerAccount(modalAccount))}`.
   - Add `DRAWER_PUSH_CLASS` to the Settings root `className` while `accountModalOpen`.
   - Switch the drawer body to `space-y-4`, keeping today's section order.
   - Compute `const sections = drawerSections(drawerAccount(modalAccount))` and gate the existing *Bank Connection* block on `sections.includes('connection')` and *Reconcile Balance* on `'reconcile'`.
   - Insert after Bank Connection, each with `key={modalAccount.id}`: `{sections.includes('holdings') && <AccountHoldingsSection … />}` and `{sections.includes('entered') && <EnteredBalancesSection … />}`. Their `onChanged={refreshAccounts}`.
5. **Edit Details:**
   - For investment accounts the Tracking Mode `<Select>` becomes `<div className={…muted text}>{TRACKING_INVESTMENT_TEXT}</div>`.
   - Below it goes `<BalanceSourcePicker value={modalAccount.balanceSource ?? BalanceSource.Manual} canSync={canSync(modalAccount)} onChange={(s) => setModalAccount({ ...modalAccount, balanceSource: s })} />`.
   - Everyday accounts keep today's select. Its `onChange` cast becomes `TrackingMode`.
6. **`updateModalAccount`:**
   - Send `balanceSource` only for investment accounts.
   - On `!res.ok`, set `accountSaveError` from `data.error`, rendered as `<p role="alert">` under Save Changes.
   - On success, clear the error, `await refreshAccounts()`, and set `modalAccount` to the fresh row with the same id. Don't close (Spec note 9).
   - `refreshAccounts` returns the fetched accounts so this needs no second fetch.
7. **Account Info balances:** read the balance values from `accountBalances`/`accountNativeBalances` by `modalAccount.id` at render time, so they update after writes. Delete `modalAccountBalance`/`modalNativeBalance`/`modalAccountCurrency` state and their setters. Reconcile reads the same derived values.
8. **Opening another card:** `openAccountModal(other)` while open just replaces `modalAccount` and clears `accountSaveError`/`reconcileTarget`. That is today's flow; unsaved edits are dropped. `closeAccountModal` is unchanged apart from the removed state.

- [ ] **Step 1: Write the failing tests**

Setup:
- `vi.mock('next/navigation')`: `useSearchParams` → `new URLSearchParams('tab=accounts')`, `useRouter` → `{ push: vi.fn(), replace: vi.fn() }`.
- `vi.mock` stub components for `@/components/institutions/ConnectedInstitutions`, `@/components/sync-settings`, `@/components/rules/RulesTab`, `@/components/plaid/PlaidAccountLinkSelector`, `@/components/plaid/PlaidReconnectButton` and `@/components/teller/TellerAccountLinkSelector`. Mock `@/lib/cloud-sync` → `{ triggerSync: vi.fn() }`.
- The fetch mock answers `/api/accounts` with three synthetic accounts: `Test Checking` (cash_flow), `Test Valued` (investment / Valuation) and `Test Manual` (investment / Manual). It answers the investments balances/holdings URLs with empty views (`today: '2026-10-09'`) and everything else with `{}`.

```tsx
it('clicking a card opens the drawer on that account and highlights the card', async () => {
  await userEvent.click(await screen.findByText('Test Checking'));
  expect(screen.getByRole('dialog', { name: 'Manage Test Checking' })).toBeInTheDocument();
  expect(cardFor('Test Checking')).toHaveAttribute('data-selected', 'true');
  expect(pageRoot()).toHaveClass(DRAWER_PUSH_CLASS);
});
it('clicking another card swaps the drawer and resets its sections', async () => {
  // open Test Manual, click 'Paste several from a spreadsheet', then click Test Valued
  expect(screen.getByRole('dialog', { name: 'Manage Test Valued' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Paste past balances')).toBeNull();
  expect(fetchedUrls()).toContain('GET /api/investments/accounts/acc-valued/balances');
});
it('Esc closes the drawer and the page stops making room for it', …); // no dialog; root lacks DRAWER_PUSH_CLASS; card focused
it('an investment account shows its source sections and no Reconcile', …);
  // Test Valued: 'Investment: holdings and balance history', radio 'Valued' checked, 'Holdings', 'Balances you entered';
  // no 'Reconcile Balance'; subtitle '… · Investment · Valued'
it('an everyday account keeps Reconcile and the tracking select', …);
it('Save changes sends the balance source and keeps the drawer open', …);
  // Test Valued → click Manual card → Save Changes → PATCH body includes balanceSource 'manual'; dialog still open
it('shows a refused save under Save changes', …);
  // PATCH 400 { error: 'Synced needs a connection to this account’s institution.' } → role alert with that text
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:unit -- settings-accounts-drawer` (expected: FAIL).

- [ ] **Step 3: Implement changes 1–8.**

- [ ] **Step 4: Run to verify they pass, then the full gate**

Run: `npm run test:unit -- settings-accounts-drawer`, then `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration` (expected: all PASS; rerun any file whose DB `beforeAll` times out).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(routes)/settings/page.tsx" tests/unit/components/settings-accounts-drawer.test.tsx
git commit -m "feat(settings): manage accounts in a push drawer with investment sections"
```

- [ ] **Step 6: Check in the browser (user-gated)**

Run `npm run dev` and open `/settings?tab=accounts`. Ask the user to check the following against the mock:
- The drawer pushes the grid at ≥1100px and overlays it below that.
- Clicking cards swaps the drawer; ✕ and Esc close it.
- A Valued account's Edit holdings opens over the drawer, and Esc there leaves the drawer open.
- The paste preview works on a short synthetic paste.

Don't read or print real account data while doing so.
