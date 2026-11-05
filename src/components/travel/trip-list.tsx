'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import type { TripSummary } from '@/lib/travel/types';
import { dateRange, money, plural } from './format';
import { TonalBar } from './tonal-bar';

const TH = 'px-3 py-2 text-xs font-normal text-[var(--text-muted)]';

type TripListProps = {
  trips: TripSummary[];
  year: number;
  currency: string;
};

/** The year's trips, biggest first; a row opens the trip. */
export function TripList({ trips, year, currency }: TripListProps) {
  const router = useRouter();
  if (trips.length === 0) {
    return (
      <Card className="p-8 text-center text-sm text-[var(--text-muted)]">
        {`No trips in ${year} yet`}
      </Card>
    );
  }
  const sorted = [...trips].sort((a, b) => b.spend - a.spend);
  return (
    <Card className="px-2 py-1.5">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-left">
            <th className={TH}>Trip</th>
            <th className={TH}>Dates</th>
            <th className={`${TH} w-[38%]`}>Where it went</th>
            <th className={`${TH} text-right`}>Per day</th>
            <th className={`${TH} text-right`}>Total</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((trip) => (
            <tr
              key={trip.id}
              className="cursor-pointer border-t border-[var(--border)] hover:bg-[var(--bg-elevated)]"
              onClick={() => router.push(`/travel/${trip.id}`)}
            >
              <td className="px-3 py-3 font-medium text-[var(--text-primary)]">
                <Link href={`/travel/${trip.id}`} onClick={(e) => e.stopPropagation()}>
                  {trip.name}
                </Link>
              </td>
              <td className="px-3 py-3 text-[var(--text-secondary)]">
                {dateRange(trip.startDate, trip.endDate)}
              </td>
              <td className="px-3 py-3">
                <TonalBar slices={trip.categories} />
              </td>
              <td className="px-3 py-3 text-right font-mono text-[var(--text-secondary)]">
                {money(trip.perDay, currency)}
              </td>
              <td className="px-3 py-3 text-right font-mono text-[var(--text-primary)]">
                {money(trip.spend, currency)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

type NotOnTripProps = {
  spend: number;
  count: number;
  currency: string;
  expanded: boolean;
  onToggle: () => void;
  /** The expanded transactions. */
  children: ReactNode;
};

/** Travel spending that belongs to no trip; expands to its transactions. */
export function NotOnTrip({
  spend,
  count,
  currency,
  expanded,
  onToggle,
  children,
}: NotOnTripProps) {
  return (
    <Card className="mt-3">
      <button
        aria-expanded={expanded}
        className="flex w-full items-center justify-between px-5 py-3 text-left text-sm"
        type="button"
        onClick={onToggle}
      >
        <span className="font-medium text-[var(--text-primary)]">
          {`Not on a trip · ${money(spend, currency)} · ${plural(count, 'transaction')}`}
        </span>
        <span className="text-[var(--text-muted)]">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && <div className="border-t border-[var(--border)] p-2">{children}</div>}
    </Card>
  );
}
