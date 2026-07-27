export type UpdateResult = {
  reconnected: number;
  discovered: Array<{ externalId: string; name: string; lastFour: string }>;
  unmatched: Array<{ connectionId: string; name: string | null; lastFour: string | null }>;
};

export type Provider = 'teller' | 'plaid';

export type DiscoveredAccount = {
  externalId: string;
  name: string;
  type: string;
  subtype: string;
  lastFour: string;
};

export type LinkedAccount = {
  connectionId: string;
  externalId: string;
  bankAccountName: string | null;
  linkedAccountName: string;
  status: string;
};

export type InstitutionView = {
  key: string; // `${provider}-${id}`, for React keys and expansion state
  provider: Provider;
  id: string; // FinanceOS enrollment DB id
  updateTargetId: string; // what the update button needs: Teller's enrollmentId, Plaid's DB id
  institutionId: string;
  institutionName: string;
  status: string;
  linked: LinkedAccount[];
  discovered: DiscoveredAccount[];
  hidden: DiscoveredAccount[];
  totalAccountCount: number;
};
