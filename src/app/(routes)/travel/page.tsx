'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { PeriodPicker } from '@/components/ui/period-picker';
import { BudgetCard } from '@/components/travel/budget-card';
import { plural } from '@/components/travel/format';
import { NotOnTrip, TripList } from '@/components/travel/trip-list';
import { TripDrawer } from '@/components/travel/trip-drawer';
import { TransactionDrawer } from '@/components/transactions/transaction-drawer';
import { TransactionTable } from '@/components/transactions/transaction-table';
import type { Category, Tx } from '@/components/transactions/types';
import { useDrawerReferenceData } from '@/components/transactions/use-drawer-reference-data';
import { useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import { sendJson, errorText } from '@/lib/send-json';
import type { YearView } from '@/lib/travel/types';

type TravelResponse = { view: YearView; budget: { target: number; spent: number } | null };

/** The Travel group and its children, as the totals count them. */
function travelCategoryIds(categories: Category[]): string[] {
  const group = categories.find((c) => c.name === 'Travel' && c.type === 'expense' && !c.parentId);
  if (!group) return [];
  return [group.id, ...categories.filter((c) => c.parentId === group.id).map((c) => c.id)];
}

/** Travel-group transactions on no trip, dated in the year: the rows behind "Not on a trip". */
async function fetchLoose(year: number, categoryIds: string[]): Promise<Tx[]> {
  if (categoryIds.length === 0) return [];
  const params = new URLSearchParams({
    preset: 'custom',
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  });
  categoryIds.forEach((id) => params.append('category', id));
  const { transactions } = await sendJson<{ transactions?: Tx[] }>(
    `/api/transactions?${params}`,
    'GET'
  );
  return (transactions ?? []).filter((tx) => !tx.tripId);
}

function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="p-5">
      <div className="text-[var(--text-secondary)]">{label}</div>
      <div className={cn('mt-1 font-mono text-2xl', tone ?? 'text-[var(--text-primary)]')}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div>}
    </Card>
  );
}

function lastYearCard(view: YearView) {
  const label = `vs ${view.year - 1}`;
  const { previousYearSpent: prev } = view;
  if (prev === null || prev <= 0) {
    const sub =
      prev === null && view.firstYear !== null
        ? `History starts ${view.firstYear}`
        : `No travel spending in ${view.year - 1}`;
    return <SummaryCard label={label} sub={sub} tone="text-[var(--text-muted)]" value="—" />;
  }
  const change = Math.round(((view.spent - prev) / prev) * 100);
  return (
    <SummaryCard
      label={label}
      // More travel spending than last year reads as a warning, less as a win.
      tone={change > 0 ? 'text-[var(--red)]' : 'text-[var(--green)]'}
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
  const [error, setError] = useState<string | null>(null);
  const [newTrip, setNewTrip] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [loose, setLoose] = useState<Tx[] | null>(null);

  const refs = useDrawerReferenceData();

  const loadYear = useCallback(async () => {
    try {
      setData(await sendJson<TravelResponse>(`/api/travel?year=${year}`, 'GET'));
      setError(null);
    } catch (e) {
      setError(errorText(e));
    }
  }, [year]);

  const loadLoose = useCallback(async () => {
    try {
      setLoose(await fetchLoose(year, travelCategoryIds(refs.categories)));
    } catch (e) {
      setError(errorText(e));
    }
  }, [year, refs.categories]);

  useEffect(() => {
    setData(null);
    setLoose(null);
    setExpanded(false);
    void loadYear();
  }, [loadYear]);

  // Loaded on first expand, once the categories that define the Travel group are known.
  useEffect(() => {
    if (expanded && loose === null && refs.categories.length > 0) void loadLoose();
  }, [expanded, loose, refs.categories, loadLoose]);

  const drawer = useTransactionDrawer({
    list: loose ?? [],
    lookup: loose ?? [],
    refresh: async () => {
      await Promise.all([loadYear(), loose === null ? undefined : loadLoose()]);
    },
    categories: refs.categories,
    patchRows: (patch) => setLoose((prev) => prev && patch(prev)),
  });

  const setYear = (value: string) => router.push(`/travel?year=${value}`);
  const view = data?.view;
  const currency = refs.baseCurrency;

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
            minYear={view?.firstYear ?? undefined}
            mode="year"
            value={String(year)}
            onChange={setYear}
          />
          <Button onClick={() => setNewTrip(true)}>+ New trip</Button>
        </div>
      </div>

      {error && <p className="text-sm text-[var(--red)]">{error}</p>}

      {view && (
        <>
          <div className="grid gap-3 lg:grid-cols-[1.5fr_1fr_1fr]">
            <BudgetCard
              currency={currency}
              spent={view.spent}
              target={data?.budget?.target ?? null}
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
              <TransactionTable
                compact
                availableTags={refs.availableTags}
                baseCurrency={currency}
                openId={drawer.openId}
                rows={loose ?? []}
                onOpen={drawer.openTransaction}
              />
            </NotOnTrip>
          )}
        </>
      )}

      <TripDrawer
        baseCurrency={currency}
        mode={newTrip ? { kind: 'new' } : null}
        onClose={() => setNewTrip(false)}
        onDeleted={() => setNewTrip(false)}
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
