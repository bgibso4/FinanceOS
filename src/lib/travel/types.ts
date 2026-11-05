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
  firstYear: number | null;
};
