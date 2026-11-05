'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { PeriodPicker } from '@/components/ui/period-picker';
import { BudgetCard } from '@/components/travel/budget-card';
import { SummaryCard } from '@/components/travel/summary-card';
import { monthYear } from '@/components/travel/format';
import { NotOnTrip, TripList } from '@/components/travel/trip-list';
import { TripDrawer } from '@/components/travel/trip-drawer';
import { TransactionDrawer } from '@/components/transactions/transaction-drawer';
import { TransactionTable } from '@/components/transactions/transaction-table';
import type { Tx } from '@/components/transactions/types';
import { useDrawerReferenceData } from '@/components/transactions/use-drawer-reference-data';
import { useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import { plural } from '@/lib/plural';
import { errorText, sendJson } from '@/lib/send-json';
import type { YearView } from '@/lib/travel/types';

type TravelResponse = { view: YearView; budget: { target: number; spent: number } | null };

function lastYearCard(view: YearView) {
  const label = `vs ${view.year - 1}`;
  const { previousYearSpent: prev } = view;
  if (prev === null || prev <= 0) {
    const sub =
      prev === null && view.firstDate !== null
        ? `History starts ${monthYear(view.firstDate)}`
        : `No travel spending in ${view.year - 1}`;
    return <SummaryCard label={label} sub={sub} tone="text-[var(--text-muted)]" value="—" />;
  }
  const change = Math.round(((view.spent - prev) / prev) * 100);
  // More travel spending than last year reads as a warning, less as a win.
  const tone =
    change === 0
      ? 'text-[var(--text-muted)]'
      : change > 0
        ? 'text-[var(--red)]'
        : 'text-[var(--green)]';
  return (
    <SummaryCard
      label={label}
      tone={tone}
      value={`${change < 0 ? '−' : '+'}${Math.abs(change)}%`}
    />
  );
}

function TravelPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const parsedYear = Number(searchParams.get('year'));
  const year =
    Number.isInteger(parsedYear) && parsedYear > 0 ? parsedYear : new Date().getFullYear();

  const [data, setData] = useState<TravelResponse | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);
  const [looseError, setLooseError] = useState<string | null>(null);
  const [newTrip, setNewTrip] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loose, setLoose] = useState<Tx[] | null>(null);
  // Only the latest request of each kind may land, so a slow older year can't overwrite a newer.
  const yearRequests = useRef(0);
  const looseRequests = useRef(0);

  const { refs, currency, error: refsError } = useDrawerReferenceData();

  const loadYear = useCallback(async () => {
    const seq = ++yearRequests.current;
    try {
      const next = await sendJson<TravelResponse>(`/api/travel?year=${year}`, 'GET');
      if (seq !== yearRequests.current) return;
      setData(next);
      setYearError(null);
    } catch (e) {
      if (seq === yearRequests.current) setYearError(errorText(e));
    }
  }, [year]);

  const loadLoose = useCallback(async () => {
    const seq = ++looseRequests.current;
    try {
      const { transactions } = await sendJson<{ transactions: Tx[] }>(
        `/api/travel/not-on-trip?year=${year}`,
        'GET'
      );
      if (seq !== looseRequests.current) return;
      setLoose(transactions);
      setLooseError(null);
    } catch (e) {
      if (seq === looseRequests.current) setLooseError(errorText(e));
    }
  }, [year]);

  useEffect(() => {
    // A new year drops the old one's figures and orphans anything still in flight for it.
    looseRequests.current++;
    setData(null);
    setLoose(null);
    setLooseError(null);
    setExpanded(false);
    void loadYear();
  }, [loadYear]);

  // Loaded on first expand.
  useEffect(() => {
    if (expanded && loose === null && !looseError) void loadLoose();
  }, [expanded, loose, looseError, loadLoose]);

  const drawer = useTransactionDrawer({
    list: loose ?? [],
    lookup: loose ?? [],
    refresh: async () => {
      await Promise.all([loadYear(), loose === null ? undefined : loadLoose()]);
    },
    categories: refs.categories,
    patchRows: (patch) => setLoose((prev) => prev && patch(prev)),
  });

  const closeNewTrip = () => {
    setNewTrip(false);
    // The drawer creates the trip at step 1, so any way out may leave one behind.
    void loadYear();
  };

  const view = data?.view;
  const errors = [refsError, yearError, looseError].filter(Boolean);

  return (
    <div className={cn('space-y-4', (drawer.isOpen || newTrip) && DRAWER_PUSH_CLASS)}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
            Travel
          </div>
          <h1 className="font-serif text-[28px] text-[var(--text-primary)]">{year}</h1>
        </div>
        <div className="flex items-center gap-2.5">
          <PeriodPicker
            maxYear={view?.lastYear}
            minYear={view?.firstDate ? Number(view.firstDate.slice(0, 4)) : undefined}
            mode="year"
            value={String(year)}
            onChange={(value) => router.push(`/travel?year=${value}`)}
          />
          <Button onClick={() => setNewTrip(true)}>+ New trip</Button>
        </div>
      </div>

      {errors.map((message) => (
        <p key={message} className="text-sm text-[var(--red)]" role="alert">
          {message}
        </p>
      ))}

      {view && currency && (
        <>
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr]">
            <BudgetCard
              currency={currency}
              spent={data?.budget?.spent ?? view.spent}
              target={data.budget?.target ?? null}
              year={year}
              onSaved={loadYear}
            />
            <SummaryCard
              label="Trips"
              sub={`${plural(view.daysAway, 'day')} away`}
              value={String(view.trips.length)}
            />
            {lastYearCard(view)}
          </div>

          <TripList currency={currency} trips={view.trips} year={year} />

          {view.notOnTrip.count > 0 && (
            <NotOnTrip
              count={view.notOnTrip.count}
              currency={currency}
              expanded={expanded}
              spend={view.notOnTrip.spend}
              onToggle={() => setExpanded(!expanded)}
            >
              {loose === null ? (
                !looseError && <p className="p-3 text-sm text-[var(--text-muted)]">Loading…</p>
              ) : (
                <TransactionTable
                  compact
                  availableTags={refs.availableTags}
                  baseCurrency={currency}
                  openId={drawer.openId}
                  rows={loose}
                  onOpen={drawer.openTransaction}
                />
              )}
            </NotOnTrip>
          )}
        </>
      )}

      <TripDrawer
        baseCurrency={currency ?? refs.baseCurrency}
        mode={newTrip ? { kind: 'new' } : null}
        onClose={closeNewTrip}
        onDeleted={closeNewTrip}
        onSaved={(id) => router.push(`/travel/${id}`)}
      />
      <TransactionDrawer ref={drawer.ref} {...refs} {...drawer.drawerProps} />
    </div>
  );
}

export default function TravelPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading travel...</div>}>
      <TravelPageContent />
    </Suspense>
  );
}
