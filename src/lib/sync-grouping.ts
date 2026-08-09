/**
 * Grouping rules for "Sync All".
 *
 * Teller fetches transactions per account, so each account is its own sync unit.
 * Plaid's `transactionsSync` shares ONE cursor across every account in an item, so a
 * single request already covers all of them. Issuing one request per Plaid account
 * returns the same item-wide numbers N times — which the Sync All modal then summed,
 * reporting five times the real figure — and spends N API calls against the Plaid
 * quota where one would do.
 */

export type GroupableAccount = {
  id: string;
  tellerConnection?: { id: string } | null;
  plaidConnection?: { plaidEnrollmentId: string } | null;
};

export type SyncUnit = {
  provider: 'teller' | 'plaid';
  /** The account whose id is sent to the sync endpoint. */
  entryAccountId: string;
  /** Every account this one request covers, including the entry account. */
  accountIds: string[];
};

export function syncUnits(accounts: GroupableAccount[]): SyncUnit[] {
  const units: SyncUnit[] = [];
  const plaidByEnrollment = new Map<string, string[]>();

  for (const account of accounts) {
    if (account.tellerConnection) {
      units.push({ provider: 'teller', entryAccountId: account.id, accountIds: [account.id] });
      continue;
    }
    if (!account.plaidConnection) continue;

    const key = account.plaidConnection.plaidEnrollmentId;
    const ids = plaidByEnrollment.get(key) ?? [];
    ids.push(account.id);
    plaidByEnrollment.set(key, ids);
  }

  for (const ids of plaidByEnrollment.values()) {
    units.push({ provider: 'plaid', entryAccountId: ids[0], accountIds: ids });
  }

  return units;
}

export type ItemStats = {
  added: number;
  merged: number;
  skippedDuplicates: number;
  skippedPending?: number;
  byAccount?: Array<{
    accountId: string;
    added: number;
    merged: number;
    skippedDuplicates: number;
  }>;
};

export type AccountStats = {
  added: number;
  merged: number;
  skippedDuplicates: number;
  skippedPending: number;
};

/**
 * Pull one account's numbers out of an item-wide result.
 *
 * Falls back to the item totals ONLY when the unit covers a single account, where the
 * two are the same thing. For a multi-account unit with no breakdown available, returns
 * zeros rather than attributing the item's totals to one account — overstating is what
 * produced the 5x bug, and a zero is honest about not knowing.
 */
export function statsForAccount(
  stats: ItemStats,
  accountId: string,
  unitSize: number
): AccountStats {
  const row = stats.byAccount?.find((b) => b.accountId === accountId);
  if (row) {
    return {
      added: row.added,
      merged: row.merged,
      skippedDuplicates: row.skippedDuplicates,
      skippedPending: stats.skippedPending ?? 0,
    };
  }

  if (unitSize === 1) {
    return {
      added: stats.added,
      merged: stats.merged,
      skippedDuplicates: stats.skippedDuplicates,
      skippedPending: stats.skippedPending ?? 0,
    };
  }

  return { added: 0, merged: 0, skippedDuplicates: 0, skippedPending: 0 };
}
