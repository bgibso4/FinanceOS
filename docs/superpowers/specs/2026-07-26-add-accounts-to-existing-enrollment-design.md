# Add Accounts to an Existing Institution Enrollment

**Date:** 2026-07-26
**Status:** Approved, ready for implementation planning

## Problem

A bank account opened after an institution was enrolled cannot be tracked without
deleting that institution's enrollment first. `DELETE /api/teller/enrollment`
cascade-deletes every `TellerConnection` under the enrollment, so adding one new
Chase card means unlinking all four existing Chase accounts and re-linking them by
hand.

Two capabilities are missing:

1. **No way to refresh an enrollment's account set in place.** `TellerReconnectButton`
   already opens Teller Connect in update mode with the existing `enrollmentId`, but
   `ConnectedInstitutions.tsx` only renders it when enrollment status is `disconnected`
   or `needs_reauth`. A healthy institution offers only **Disconnect**.
2. **No way to turn a newly-visible bank account into a tracked account.** The expanded
   institution panel lists bank accounts read-only. Linking requires manually creating a
   FinanceOS `Account`, opening its modal, and using the dropdown in
   `TellerAccountLinkSelector`.

There is also a latent trap. PR #23 established that re-enrolling mints fresh external
IDs. If Teller returns a **new** `enrollment_id` when Connect is re-run for an
already-enrolled institution, `POST /api/teller/enrollment` creates a second row for
that institution and the existing connections stay pinned to the old, now-stale token.

## Approach

### 1. Trigger: "Add accounts" on healthy enrollments

Every institution row gets an **Add accounts** action regardless of status, opening the
provider's flow in update mode.

**Teller.** Reuse the existing update-mode path (`enrollmentId` passed to
`TellerConnect.setup`). `TellerReconnectButton` gains a `mode: 'reconnect' | 'add-accounts'`
prop controlling the label and the success-handler target; script loading and setup stay
single-sourced. `PlaidReconnectButton` is generalized the same way.

**Plaid.** Add `update: { account_selection_enabled: true }` to the update-mode
`linkTokenCreate` call in `src/app/api/plaid/link-token/route.ts`. This is Plaid's
supported mechanism for letting a user add or remove accounts on an existing Item.

The existing **Reconnect** button for broken enrollments remains — same component,
different mode.

### 2. Reconciliation

Plaid keeps the same Item and access token through update mode, so it needs no merge
logic — re-fetching accounts is sufficient.

Teller must handle both possible outcomes. `POST /api/teller/enrollment/update` receives
`{ enrollmentId, accessToken }` from the Connect success payload.

**Same `enrollmentId` returned** — update the stored token in place and set status
`connected`. This is the current reconnect behavior.

**New `enrollmentId` returned** — create the new enrollment row, fetch `/accounts` with
the new token, then re-point every `TellerConnection` from the old row onto the new one.
Matching lives in a pure module, `src/lib/bank-account-matching.ts`, and is tried in
order:

1. exact `tellerAccountId`
2. `lastFour` + `subtype`
3. `lastFour` alone
4. normalized name + type

If a single candidate account matches two different connections, **both** are treated as
unmatched rather than guessed at.

Stale-row disposal depends on the result:

- **All connections matched** — delete the stale enrollment row.
- **Any connection unmatched** — keep the stale row and mark it `disconnected`. Deleting
  it would cascade and destroy those connections along with their account linkage.

Transaction history is unaffected: it hangs off `Account`, not the connection, and the
`importHash` dedup tier added in PR #23 absorbs the fresh `externalId`s on the next sync.

The route returns `{ reconnected, discovered, unmatched }`. The UI renders a summary
("4 accounts reconnected · 1 new account found") and lists any unmatched accounts
explicitly with a path to re-map them by hand.

### 3. Discovery and adoption

`GET /api/teller/enrollment` already fetches the live account list on every Settings
load, so discovery costs nothing extra — it only needs the set difference the Teller
route does not currently compute. Note the existing inconsistency: Plaid's
`availableAccounts` is already filtered to unlinked accounts, Teller's is every account.
Both providers are normalized to return **unlinked-only**.

Because the Teller route's `availableAccounts` currently carries every account, the
"_n_ of _m_ accounts linked" line in the institution header must read `m` from
`totalAccountCount` (already returned separately) rather than from the length of
`availableAccounts`, and Plaid's branch — which today derives `m` from
`linkedCount + availableCount` — needs the same field added to its response.

- The institution header shows a badge: **1 new account**.
- Expanding shows each discovered account with **Add** and **Ignore**.
- **Add** opens a `Modal` prefilled from bank data — name, mapped type, institution,
  currency — and on confirm calls `POST /api/bank-accounts/adopt` (shared across
  providers via a `provider` param), which creates the `Account` and its connection in a
  single transaction, reusing `getDefaultTrackingMode` from
  `src/app/api/accounts/route.ts`.
- **Ignore** writes an `IgnoredBankAccount` row. Ignored accounts collapse under
  **Hidden (n)** with a Restore link.

Type mapping: `credit` → `credit`, `depository` → `checking`, everything else → `other`.

New Prisma model:

```prisma
model IgnoredBankAccount {
  id                String   @id @default(uuid())
  provider          String   // 'teller' | 'plaid'
  institutionId     String
  externalAccountId String
  lastFour          String?
  createdAt         DateTime @default(now())

  @@unique([provider, externalAccountId])
  @@index([provider, institutionId])
}
```

A row matches a discovered account by `externalAccountId` **or** by
`(institutionId, lastFour)` when `lastFour` is present. The fallback is required because
external IDs are not stable across enrollments — without it, an ignored account
reappears after every merge.

### 4. Component split

`ConnectedInstitutions.tsx` is 583 lines with the Teller and Plaid branches duplicated
nearly line-for-line; adding discovery UI to both would push it past 800. Since both
branches are being edited anyway, split it into:

- `InstitutionCard` — provider-agnostic shell driven by a normalized view model
- `BankAccountRow` — a linked account
- `DiscoveredAccountRow` — an unlinked account with Add/Ignore
- `ConnectedInstitutions` — remains the list container

It also moves from `src/components/teller/` to `src/components/institutions/`, since it
renders both providers.

## Testing

**Unit — `bank-account-matching.ts`.** Each tier in order; the ambiguity rule (one
candidate matching two connections leaves both unmatched); all-matched vs. partial-match
outcomes. Pure function, no mocks.

**Unit.** Provider type → FinanceOS type mapping. Unlinked-account filtering with
ignores applied, covering both the external-ID and `(institutionId, lastFour)` match
paths.

**Integration — against a test DB.**

- Same-ID update path: token replaced, connections untouched.
- New-ID path, full match: connections re-pointed, stale enrollment deleted.
- New-ID path, one connection unmatched: stale row kept and marked `disconnected`, all
  connections still present and linked.
- Idempotency: replaying the same payload twice produces the same end state.

**Manual.** Chase in Settings → Add accounts → new card appears as discovered → Add →
sync pulls its transactions with no duplicates on the other four accounts.

## Files affected

| File                                                 | Change                                      |
| ---------------------------------------------------- | ------------------------------------------- |
| `prisma/schema.prisma` + migration                    | `IgnoredBankAccount` model                  |
| `src/lib/bank-account-matching.ts`                    | New — pure matcher + type mapping           |
| `src/app/api/teller/enrollment/update/route.ts`       | New — same-ID and new-ID reconciliation     |
| `src/app/api/teller/enrollment/route.ts`              | GET returns unlinked-only `availableAccounts` |
| `src/app/api/plaid/link-token/route.ts`               | `account_selection_enabled` on update mode  |
| `src/app/api/bank-accounts/adopt/route.ts`            | New — create account + connection           |
| `src/app/api/ignored-accounts/route.ts`               | New — GET/POST/DELETE                       |
| `src/components/teller/TellerReconnectButton.tsx`     | `mode` prop                                 |
| `src/components/plaid/PlaidReconnectButton.tsx`       | `mode` prop                                 |
| `src/components/institutions/*`                       | Split out of `ConnectedInstitutions.tsx`    |

## Out of scope

- Automatic background polling for new accounts. Discovery happens on Settings load and
  after an explicit **Add accounts** run.
- Any change to sync or dedup logic. The `importHash` tier from PR #23 already covers the
  token-swap case this design introduces.
