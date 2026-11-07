import { Card } from '@/components/ui/card';
import { fmtMoney } from '@/lib/currency';
import { plural } from '@/lib/plural';
import type { TripSummary } from '@/lib/travel/types';
import { shortDate } from './format';
import { SummaryCard } from './summary-card';
import { tonalShade } from './tonal-bar';

type TripStatsProps = {
  trip: TripSummary;
  currency: string;
  /** The start year's trips average per day; null when it could not be loaded. */
  yearAverage: number | null;
};

/** A trip's four headline figures. */
export function TripStats({ trip, currency, yearAverage }: TripStatsProps) {
  const money = (v: number) => fmtMoney(v, { currency });
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label="Total"
        sub={plural(trip.txCount, 'transaction')}
        value={money(trip.spend)}
      />
      <SummaryCard
        label="Per day"
        sub={
          yearAverage === null
            ? undefined
            : `${trip.startDate.slice(0, 4)} trips average ${money(yearAverage)}`
        }
        value={money(trip.perDay)}
      />
      <SummaryCard
        label="Booked ahead"
        sub={`before ${shortDate(trip.startDate)}`}
        value={money(trip.bookedAhead)}
      />
      <SummaryCard
        label="Money back"
        sub={`${plural(trip.moneyBackCount, 'payback')} · already taken off the total`}
        tone="text-[var(--green)]"
        value={`+${money(trip.moneyBack)}`}
      />
    </div>
  );
}

/** Spend per category, biggest first, each bar sized against the biggest. */
export function CategoryBreakdown({ trip, currency }: Pick<TripStatsProps, 'trip' | 'currency'>) {
  const biggest = Math.max(...trip.categories.map((c) => c.spend), 0);
  return (
    <Card className="p-5">
      <div className="mb-2.5 text-[var(--text-secondary)]">By category</div>
      <div className="text-[13px]">
        {trip.categories.map((slice, rank) => (
          <div key={slice.categoryId ?? slice.name} className="mb-2.5">
            <div className="flex justify-between">
              <span>{slice.name}</span>
              <span className="font-mono">{fmtMoney(slice.spend, { currency })}</span>
            </div>
            <div className="mt-1 h-[7px] overflow-hidden rounded-[4px] bg-[var(--track-bg)]">
              <i
                className="block h-full"
                style={{
                  width: `${biggest > 0 ? Math.max(+((slice.spend / biggest) * 100).toFixed(2), 0) : 0}%`,
                  background: tonalShade(rank),
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
