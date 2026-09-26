/**
 * Pure helpers for reconciling a provider's account list against the connections
 * we already store. Used when a bank hands back a NEW enrollment covering the same
 * underlying accounts (Teller mints fresh account ids on re-enrollment, so the old
 * `tellerAccountId` values no longer resolve).
 *
 * No I/O here on purpose — the matching rules are the part worth testing exhaustively.
 */

export type ProviderAccount = {
  externalId: string;
  name: string;
  type: string;
  subtype: string;
  lastFour: string;
};

export type ExistingConnection = {
  id: string;
  externalId: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
  lastFour: string | null;
};

export type MatchResult = {
  matched: Array<{ connectionId: string; account: ProviderAccount }>;
  unmatchedConnections: ExistingConnection[];
};

export type IgnoredRecord = {
  externalAccountId: string;
  institutionId: string;
  lastFour: string | null;
};

/** Lowercase, strip anything that isn't a letter/digit/space, collapse runs of whitespace. */
export function normalizeAccountName(name: string | null): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Provider account type -> FinanceOS account type. Deliberately narrow: anything we
 * aren't certain about becomes `other` so the user corrects it in the adopt dialog
 * rather than silently getting a wrong tracking mode.
 */
export function mapBankAccountType(type: string): string {
  const normalized = (type || '').toLowerCase();
  if (normalized === 'credit') return 'credit';
  if (normalized === 'depository') return 'checking';
  return 'other';
}

type Tier = (conn: ExistingConnection, acc: ProviderAccount) => boolean;

// Tried in order. Each is strictly weaker than the one before it.
const TIERS: Tier[] = [
  (conn, acc) => conn.externalId === acc.externalId,
  (conn, acc) =>
    !!conn.lastFour &&
    conn.lastFour === acc.lastFour &&
    !!conn.subtype &&
    conn.subtype === acc.subtype,
  (conn, acc) => !!conn.lastFour && conn.lastFour === acc.lastFour,
  (conn, acc) =>
    normalizeAccountName(conn.name) !== '' &&
    normalizeAccountName(conn.name) === normalizeAccountName(acc.name) &&
    conn.type === acc.type,
];

/**
 * Pair each existing connection with at most one account from the new enrollment.
 *
 * A pairing is only accepted when it is unambiguous in BOTH directions: the
 * connection has exactly one candidate at this tier, and no other connection has
 * that same account as its sole candidate. Two cards sharing a last four would
 * otherwise get silently swapped, which quietly attaches months of transaction
 * history to the wrong account.
 */
export function matchConnectionsToAccounts(
  connections: ExistingConnection[],
  accounts: ProviderAccount[]
): MatchResult {
  const matched: MatchResult['matched'] = [];
  const claimedAccountIds = new Set<string>();
  const matchedConnectionIds = new Set<string>();

  for (const tier of TIERS) {
    const pending = connections.filter((c) => !matchedConnectionIds.has(c.id));
    const available = accounts.filter((a) => !claimedAccountIds.has(a.externalId));

    // Candidate set per still-unmatched connection at this tier.
    const candidates = new Map<string, ProviderAccount[]>();
    for (const conn of pending) {
      candidates.set(
        conn.id,
        available.filter((acc) => tier(conn, acc))
      );
    }

    for (const conn of pending) {
      const list = candidates.get(conn.id) ?? [];
      if (list.length !== 1) continue;

      const target = list[0];
      if (claimedAccountIds.has(target.externalId)) continue;

      const contested = pending.some((other) => {
        if (other.id === conn.id) return false;
        const otherList = candidates.get(other.id) ?? [];
        return otherList.length === 1 && otherList[0].externalId === target.externalId;
      });
      if (contested) continue;

      matched.push({ connectionId: conn.id, account: target });
      claimedAccountIds.add(target.externalId);
      matchedConnectionIds.add(conn.id);
    }
  }

  return {
    matched,
    unmatchedConnections: connections.filter((c) => !matchedConnectionIds.has(c.id)),
  };
}

/**
 * True when the user has dismissed this bank account. Matches on external id OR on
 * (institution, last four) — provider account ids are not stable across enrollments,
 * so without the second check an ignored account reappears after every merge.
 */
export function isAccountIgnored(
  account: { externalId: string; lastFour: string },
  institutionId: string,
  ignored: IgnoredRecord[]
): boolean {
  return ignored.some((row) => {
    if (row.externalAccountId === account.externalId) return true;
    return (
      row.institutionId === institutionId && !!row.lastFour && row.lastFour === account.lastFour
    );
  });
}
