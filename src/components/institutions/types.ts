export type UpdateResult = {
  reconnected: number;
  discovered: Array<{ externalId: string; name: string; lastFour: string }>;
  unmatched: Array<{ connectionId: string; name: string | null; lastFour: string | null }>;
};
