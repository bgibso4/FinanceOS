import type { TxRow } from '@/lib/transaction-rows';

export type TripRecord = { id: string; name: string; startDate: string; endDate: string };

export type CategorySlice = {
  categoryId: string | null;
  name: string;
  spend: number;
  share: number;
};

export type TripSummary = TripRecord & {
  days: number;
  spend: number;
  perDay: number;
  bookedAhead: number;
  moneyBack: number;
  moneyBackCount: number;
  txCount: number;
  categories: CategorySlice[];
};

export type YearView = {
  year: number;
  trips: TripSummary[];
  notOnTrip: { spend: number; count: number };
  spent: number;
  daysAway: number;
  perDayAverage: number;
  previousYearSpent: number | null;
  /** Date of the earliest transaction, 'YYYY-MM-DD' (UTC); null with no history. */
  firstDate: string | null;
  /** Latest year worth browsing: the later of this year and the latest trip's start year. */
  lastYear: number;
};

export type SuggestionGroup = 'before' | 'during' | 'other' | 'after';

export type Suggestion = {
  tx: TxRow;
  group: SuggestionGroup;
  preTicked: boolean;
  reason: string;
};
