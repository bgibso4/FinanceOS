import type { DiscoveredAccount, InstitutionView } from './types';

type RawConnection = {
  id: string;
  status?: string;
  account: { id: string; name: string };
};

type RawTellerEnrollment = {
  id: string;
  enrollmentId: string;
  institutionId: string;
  institutionName: string;
  status: string;
  totalAccountCount?: number;
  connections: Array<RawConnection & { tellerAccountId: string; tellerAccountName: string | null }>;
  availableAccounts?: DiscoveredAccount[];
  hiddenAccounts?: DiscoveredAccount[];
};

type RawPlaidEnrollment = {
  id: string;
  plaidItemId: string;
  institutionId: string | null;
  institutionName: string;
  status: string;
  totalAccountCount?: number;
  connections: Array<RawConnection & { plaidAccountId: string; plaidAccountName: string | null }>;
  availableAccounts?: DiscoveredAccount[];
  hiddenAccounts?: DiscoveredAccount[];
};

export function normalizeTellerEnrollment(raw: RawTellerEnrollment): InstitutionView {
  return {
    key: `teller-${raw.id}`,
    provider: 'teller',
    id: raw.id,
    // Teller Connect's update mode keys off the provider's enrollment id, not ours.
    updateTargetId: raw.enrollmentId,
    institutionId: raw.institutionId,
    institutionName: raw.institutionName,
    status: raw.status,
    linked: raw.connections.map((c) => ({
      connectionId: c.id,
      externalId: c.tellerAccountId,
      bankAccountName: c.tellerAccountName,
      linkedAccountName: c.account.name,
      status: c.status ?? 'connected',
    })),
    discovered: raw.availableAccounts ?? [],
    hidden: raw.hiddenAccounts ?? [],
    totalAccountCount: raw.totalAccountCount ?? raw.connections.length,
  };
}

export function normalizePlaidEnrollment(raw: RawPlaidEnrollment): InstitutionView {
  return {
    key: `plaid-${raw.id}`,
    provider: 'plaid',
    id: raw.id,
    // Plaid's update mode takes our DB id; the route resolves the access token.
    updateTargetId: raw.id,
    institutionId: raw.institutionId ?? '',
    institutionName: raw.institutionName,
    status: raw.status,
    linked: raw.connections.map((c) => ({
      connectionId: c.id,
      externalId: c.plaidAccountId,
      bankAccountName: c.plaidAccountName,
      linkedAccountName: c.account.name,
      status: c.status ?? 'connected',
    })),
    discovered: raw.availableAccounts ?? [],
    hidden: raw.hiddenAccounts ?? [],
    totalAccountCount: raw.totalAccountCount ?? raw.connections.length,
  };
}
