'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { dateRange } from '@/components/travel/format';
import { CategoryBreakdown, TripStats } from '@/components/travel/trip-stats';
import { TripDrawer } from '@/components/travel/trip-drawer';
import { TransactionDrawer } from '@/components/transactions/transaction-drawer';
import { TransactionTable } from '@/components/transactions/transaction-table';
import type { Tx } from '@/components/transactions/types';
import { useDrawerReferenceData } from '@/components/transactions/use-drawer-reference-data';
import { useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import { plural } from '@/lib/plural';
import { errorText, sendJson } from '@/lib/send-json';
import { groupByTripDates } from '@/lib/travel/trip-groups';
import type { TripSummary, YearView } from '@/lib/travel/types';

type TripResponse = { trip: TripSummary; transactions: Tx[]; suggestionCount: number };

// The message the trip endpoint answers an unknown id with.
const NOT_FOUND = 'Trip not found';

function TripPageContent({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<TripResponse | null>(null);
  const [tripError, setTripError] = useState<string | null>(null);
  const [yearAverage, setYearAverage] = useState<number | null>(null);
  const [tripMode, setTripMode] = useState<'edit' | 'review' | null>(null);
  // Only the latest request of each kind may land.
  const tripRequests = useRef(0);
  const yearRequests = useRef(0);

  const { refs, currency, error: refsError } = useDrawerReferenceData();

  const loadTrip = useCallback(async () => {
    const seq = ++tripRequests.current;
    try {
      const next = await sendJson<TripResponse>(`/api/travel/trips/${id}`, 'GET');
      if (seq !== tripRequests.current) return;
      setData(next);
      setTripError(null);
    } catch (e) {
      if (seq === tripRequests.current) setTripError(errorText(e));
    }
  }, [id]);

  useEffect(() => {
    // A different trip drops the old one's figures and orphans anything in flight for it.
    setData(null);
    setYearAverage(null);
    void loadTrip();
  }, [loadTrip]);

  const startYear = data?.trip.startDate.slice(0, 4);
  const loadYearAverage = useCallback(async () => {
    if (!startYear) return;
    const seq = ++yearRequests.current;
    try {
      const { view } = await sendJson<{ view: YearView }>(`/api/travel?year=${startYear}`, 'GET');
      if (seq === yearRequests.current) setYearAverage(view.perDayAverage);
    } catch (e) {
      // The comparison is a nicety: without it the card just has no second line.
      console.warn('Failed to load the year average', e);
    }
  }, [startYear]);

  useEffect(() => {
    void loadYearAverage();
  }, [loadYearAverage]);

  const reload = async () => {
    await Promise.all([loadTrip(), loadYearAverage()]);
  };

  const trip = data?.trip;
  const groups = data && trip ? groupByTripDates(trip, data.transactions) : [];
  const drawer = useTransactionDrawer({
    // Arrow keys step in the order the rows are shown.
    list: groups.flatMap((g) => g.rows),
    lookup: data?.transactions ?? [],
    refresh: reload,
    categories: refs.categories,
    patchRows: (patch) => {
      setData((prev) => prev && { ...prev, transactions: patch(prev.transactions) });
      // The row is right already; the figures come from the server.
      void reload();
    },
  });

  const closeTripDrawer = () => {
    setTripMode(null);
    // Editing, reviewing or leaving may all have changed the trip.
    void reload();
  };

  // One drawer at a time: both sit in the same spot, so the later one would hide the other.
  const openTripDrawer = (mode: 'edit' | 'review') =>
    void drawer.closeThen(() => setTripMode(mode));
  const openRow = (id: string) => {
    if (tripMode) closeTripDrawer();
    drawer.openTransaction(id);
  };

  if (tripError === NOT_FOUND) {
    return (
      <Card className="mx-auto max-w-md space-y-3 p-8 text-center">
        <p className="text-[var(--text-primary)]">{NOT_FOUND}</p>
        <Link className="text-sm text-[var(--accent)]" href="/travel">
          Back to travel
        </Link>
      </Card>
    );
  }

  const errors = [refsError, tripError].filter(Boolean);
  const year = trip?.startDate.slice(0, 4);

  return (
    <div className={cn('space-y-4', (drawer.isOpen || tripMode) && DRAWER_PUSH_CLASS)}>
      {errors.map((message) => (
        <p key={message} className="text-sm text-[var(--red)]" role="alert">
          {message}
        </p>
      ))}

      {trip && data && currency && (
        <>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Link
                className="mb-1.5 block text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]"
                href={`/travel?year=${year}`}
              >
                {`Travel · ${year}`}
              </Link>
              <h1 className="font-serif text-[28px] text-[var(--text-primary)]">{trip.name}</h1>
              <div className="mt-0.5 text-[var(--text-secondary)]">
                {`${dateRange(trip.startDate, trip.endDate)}, ${trip.endDate.slice(0, 4)} · ${plural(trip.days, 'day')}`}
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => openTripDrawer('edit')}>
                Edit trip
              </Button>
              {data.suggestionCount > 0 && (
                <Button onClick={() => openTripDrawer('review')}>
                  {`Review suggestions · ${data.suggestionCount}`}
                </Button>
              )}
            </div>
          </div>

          <TripStats currency={currency} trip={trip} yearAverage={yearAverage} />

          {data.transactions.length === 0 ? (
            <Card className="p-8 text-center text-sm text-[var(--text-muted)]">
              No transactions on this trip yet
            </Card>
          ) : (
            <div className="grid items-start gap-3 lg:grid-cols-[240px_1fr]">
              <CategoryBreakdown currency={currency} trip={trip} />
              <Card className="px-1.5 py-1">
                <TransactionTable
                  compact
                  availableTags={refs.availableTags}
                  baseCurrency={currency}
                  groups={groups}
                  openId={drawer.openId}
                  rows={data.transactions}
                  onOpen={openRow}
                />
              </Card>
            </div>
          )}
        </>
      )}

      <TripDrawer
        baseCurrency={currency ?? refs.baseCurrency}
        mode={trip && tripMode ? { kind: tripMode, trip } : null}
        onClose={closeTripDrawer}
        onDeleted={() => router.push(`/travel?year=${year}`)}
        onSaved={closeTripDrawer}
      />
      <TransactionDrawer ref={drawer.ref} {...refs} {...drawer.drawerProps} />
    </div>
  );
}

export default function TripPage() {
  const { id } = useParams<{ id: string }>();
  return <TripPageContent key={id} id={id} />;
}
