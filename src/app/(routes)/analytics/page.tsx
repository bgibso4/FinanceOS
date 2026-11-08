'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { DRAWER_PUSH_CLASS } from '@/components/ui/drawer';
import { MonthGrid, PeriodStepper, YearList } from '@/components/ui/period-stepper';
import { TransactionDrawer } from '@/components/transactions/transaction-drawer';
import {
  CategoryBreakdown,
  type BreakdownBudget,
  type BreakdownRow,
} from '@/components/analytics/category-breakdown';
import { changeText } from '@/components/analytics/change';
import { FilterChips } from '@/components/analytics/filter-chips';
import { FilterPanel } from '@/components/analytics/filter-panel';
import {
  OverTimeChart,
  finishedSentence,
  soFarSentence,
} from '@/components/analytics/over-time-chart';
import { WhereItWent } from '@/components/analytics/where-it-went';
import type { Tx } from '@/components/transactions/types';
import { useDrawerReferenceData } from '@/components/transactions/use-drawer-reference-data';
import { useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import type { DaySpend } from '@/lib/analytics';
import {
  COMPARE_SHORT,
  columnLabel,
  compareChartRange,
  compareRange,
  dayCount,
  fullRange,
  isDaily,
  isLatest,
  periodLabel,
  periodRange,
  stepPeriod,
  type DayRange,
} from '@/lib/analytics-period';
import {
  activeFilterCount,
  filterParamsFor,
  parseAnalyticsQuery,
  toSearchParams,
  type AnalyticsQuery,
} from '@/lib/analytics-query';
import {
  assignColors,
  buildSeries,
  groupTotals,
  picksFor,
  rankPicks,
  soFar,
} from '@/lib/analytics-series';
import { cn } from '@/lib/cn';
import { fmtMoney } from '@/lib/currency';
import { localDay } from '@/lib/dates';
import { filterSearchParams } from '@/lib/filters';
import { sendJson } from '@/lib/send-json';
import { UNCATEGORIZED } from '@/lib/transaction-filters';

type Days = { current: DaySpend[]; compare: DaySpend[] | null };
const NO_DAYS: Days = { current: [], compare: null };
type Totals = { spending: number; prevSpending: number };
const NO_TOTALS: Totals = { spending: 0, prevSpending: 0 };
/** Average month length, for "per month" over periods that end part-way through one. */
const MONTH_DAYS = 365.25 / 12;
/** P4: the year list offers this year and the four before it. */
const YEARS_LISTED = 5;

/** The API query for a range: the shared filters, plus the comparison range when there is one. */
function apiQuery(q: AnalyticsQuery, range: DayRange, compare: DayRange | null): string {
  const sp = filterSearchParams(filterParamsFor(q, range));
  if (compare) {
    sp.set('compareStart', compare.start);
    sp.set('compareEnd', compare.end);
  }
  return sp.toString();
}

function Figure({
  label,
  value,
  sub,
  subClass = 'text-[var(--text-muted)]',
}: {
  label: string;
  value: string;
  sub: string;
  subClass?: string;
}) {
  return (
    <Card className="min-w-0 px-5 py-[18px]">
      <div className="text-xs text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 truncate font-mono text-2xl text-[var(--text-primary)]">{value}</div>
      <div className={`mt-0.5 truncate text-xs ${subClass}`}>{sub}</div>
    </Card>
  );
}

function FunnelIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="18"
    >
      <path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" />
    </svg>
  );
}

function AnalyticsContent() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const today = localDay();
  const query = useMemo(
    () => parseAnalyticsQuery(new URLSearchParams(search), today),
    [search, today]
  );
  const { period } = query;

  const { refs, error: refsError } = useDrawerReferenceData();
  const { categories } = refs;
  const [spendByCategory, setSpendByCategory] = useState<BreakdownRow[]>([]);
  // The whole period's spend and the comparison's, from the same rule the daily data uses.
  const [totals, setTotals] = useState<Totals>(NO_TOTALS);
  const [budgets, setBudgets] = useState<BreakdownBudget[]>([]);
  const [days, setDays] = useState<Days>(NO_DAYS);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [categoryTransactions, setCategoryTransactions] = useState<Tx[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  // The row the drawer is on stays listed until you leave it, so a save can't lose your place.
  const [heldRowId, setHeldRowId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [split, setSplit] = useState(false);
  const filterButton = useRef<HTMLButtonElement>(null);
  // Only the latest request of each kind may land.
  const figureRequests = useRef(0);
  const dayRequests = useRef(0);
  const rowRequests = useRef(0);

  const range = periodRange(period, today);
  const shown = fullRange(period);
  const daily = isDaily(shown);
  const compare = compareRange(period, query.vs, today);
  const chartCompare = compareChartRange(period, query.vs, today);
  // M5: a budget covers the whole category, so it only means something for a plain month.
  const showBudgets =
    period.kind === 'month' && !query.accounts.length && !query.tags.length && !query.merchant;

  const categoryIdFor = (name: string) => categories.find((c) => c.name === name)?.id;
  const breakdownRows = spendByCategory.map((cat) => ({
    ...cat,
    categoryId: categoryIdFor(cat.category),
  }));
  const expandedCategoryId = expandedCategory ? categoryIdFor(expandedCategory) : undefined;

  const dashboardUrl = `/api/analytics/dashboard?preset=custom&${apiQuery(query, range, compare)}`;
  // P10: no category filter, so the panel gets every group's total; the chart applies the picks.
  const dailyUrl = `/api/analytics/daily?${apiQuery({ ...query, categories: [] }, range, chartCompare)}`;
  const budgetsUrl = showBudgets ? `/api/budgets/${period.anchor}` : null;
  const rowsUrl = expandedCategory
    ? `/api/transactions?preset=custom&${apiQuery(
        { ...query, categories: [expandedCategoryId ?? UNCATEGORIZED] },
        range,
        null
      )}`
    : null;

  const loadFigures = useCallback(async () => {
    const seq = ++figureRequests.current;
    const [budgetData, analyticsData] = await Promise.all([
      budgetsUrl
        ? sendJson<{ budgets?: BreakdownBudget[] }>(budgetsUrl, 'GET')
        : { budgets: [] as BreakdownBudget[] },
      sendJson<{ spendByCategory?: BreakdownRow[]; netCashflow?: Totals }>(dashboardUrl, 'GET'),
    ]);
    if (seq !== figureRequests.current) return;
    setBudgets(budgetData.budgets ?? []);
    setSpendByCategory(analyticsData.spendByCategory ?? []);
    setTotals(analyticsData.netCashflow ?? NO_TOTALS);
  }, [budgetsUrl, dashboardUrl]);

  const loadDays = useCallback(async () => {
    const seq = ++dayRequests.current;
    const data = await sendJson<Partial<Days>>(dailyUrl, 'GET');
    if (seq !== dayRequests.current) return;
    setDays({ current: data.current ?? [], compare: data.compare ?? null });
  }, [dailyUrl]);

  const loadRows = useCallback(async () => {
    if (!rowsUrl) return;
    const seq = ++rowRequests.current;
    try {
      const data = await sendJson<{ transactions?: Tx[] }>(rowsUrl, 'GET');
      if (seq === rowRequests.current) setCategoryTransactions(data.transactions ?? []);
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      if (seq === rowRequests.current) setLoadingTransactions(false);
    }
  }, [rowsUrl]);

  const loadTotals = useCallback(
    () =>
      Promise.all([loadFigures(), loadDays()]).catch((err) =>
        console.error('Failed to load analytics:', err)
      ),
    [loadFigures, loadDays]
  );

  useEffect(() => {
    void loadTotals();
  }, [loadTotals]);

  useEffect(() => {
    setCategoryTransactions([]);
    setLoadingTransactions(Boolean(rowsUrl));
    void loadRows();
  }, [rowsUrl, loadRows]);

  // Matches what the figures count: transfers and offsets are left out.
  const list = categoryTransactions.filter(
    (t) => t.id === heldRowId || (!t.isOffset && !t.isTransfer)
  );

  const drawer = useTransactionDrawer({
    list,
    lookup: list,
    refresh: async () => {
      await Promise.all([loadTotals(), loadRows()]);
    },
    categories,
    patchRows: (patch) => {
      setCategoryTransactions(patch);
      // The row is right already; the totals come from the server.
      void loadTotals();
    },
  });

  useEffect(() => setHeldRowId(drawer.openId), [drawer.openId]);

  /** M6: the query lives in the address, replaced rather than pushed so Back leaves the page. */
  const setQuery = (q: AnalyticsQuery) =>
    void drawer.closeThen(() => {
      const qs = toSearchParams(q, today).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });

  // The panel and the drawer are never open together.
  const togglePanel = () =>
    panelOpen ? setPanelOpen(false) : void drawer.closeThen(() => setPanelOpen(true));
  const openTransaction = (id: string) => {
    setPanelOpen(false);
    drawer.openTransaction(id);
  };

  // One list at a time: the drawer steps through the open category's rows.
  const toggleCategory = (categoryName: string) =>
    void drawer.closeThen(() =>
      setExpandedCategory((current) => (current === categoryName ? null : categoryName))
    );

  const setPeriod = (anchor: string) => setQuery({ ...query, period: { ...period, anchor } });

  // Chart: picks narrow it; with 2–6 of them "Each category" draws one line per pick (M4).
  const picks = picksFor(query.categories, categories);
  const canSplit = picks.length >= 2 && picks.length <= 6;
  const splitOn = split && canSplit;
  const labels = {
    current: columnLabel(range, period),
    compare: chartCompare ? columnLabel(chartCompare, period) : '',
  };
  const series = buildSeries({
    current: days.current,
    compare: days.compare,
    shown,
    through: range.end,
    compareRange: chartCompare,
    running,
    categoryIds: query.categories.length ? picks.flatMap((p) => p.categoryIds) : null,
    picks: splitOn ? picks : undefined,
    labels,
  });
  const progress = daily && !splitOn ? soFar(series.points, series.lines) : null;
  const summary = progress
    ? range.partial
      ? soFarSentence(progress, labels.compare)
      : finishedSentence(progress.now, labels.current, {
          label: labels.compare,
          total: progress.thenTotal,
        })
    : null;

  // Where it went (M7): the picks when there are 2+, ranked as the lines are; else categories.
  const ranked =
    picks.length >= 2
      ? rankPicks(picks, days.current).map((e) => ({
          key: e.pick.key,
          label: e.pick.label,
          amount: e.total,
        }))
      : [...spendByCategory]
          .sort((a, b) => b.amount - a.amount)
          .map((c) => ({ key: c.category, label: c.category, amount: c.amount }));
  const colors = assignColors(ranked.map((s) => s.key));
  const slices = ranked.map((s) => ({ ...s, color: colors[s.key] }));

  // Figures.
  const { spending: spent, prevSpending: was } = totals;
  const txCount = spendByCategory.reduce((sum, c) => sum + c.txCount, 0);
  const periodDays = dayCount(range);
  const months = periodDays / MONTH_DAYS;
  const change = changeText(spent, was);

  const accountName = new Map(refs.accounts.map((a) => [a.id, a.name]));
  const thisYear = Number(today.slice(0, 4));
  const filterCount = activeFilterCount(query);

  return (
    <>
      <div className={cn('space-y-3', drawer.isOpen && DRAWER_PUSH_CLASS)}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 text-[11px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
              Spending
            </div>
            <h1 className="font-serif text-[28px] text-[var(--text-primary)]">Analytics</h1>
          </div>
          <div className="flex items-center gap-3">
            <PeriodStepper
              label={periodLabel(period)}
              nextDisabled={isLatest(period, today)}
              popover={(close) =>
                period.kind === 'year' ? (
                  <YearList
                    value={period.anchor.slice(0, 4)}
                    years={Array.from({ length: YEARS_LISTED }, (_, k) => String(thisYear - k))}
                    onPick={(year) => {
                      close();
                      setPeriod(`${year}-12`);
                    }}
                  />
                ) : (
                  <MonthGrid
                    today={new Date()}
                    value={period.anchor}
                    onPick={(month) => {
                      close();
                      setPeriod(month);
                    }}
                  />
                )
              }
              onLabelClick={period.kind === 'custom' ? togglePanel : undefined}
              onNext={() => setQuery({ ...query, period: stepPeriod(period, 1, today) })}
              onPrev={() => setQuery({ ...query, period: stepPeriod(period, -1, today) })}
            />
            <button
              ref={filterButton}
              aria-expanded={panelOpen}
              aria-label="Filters"
              className={cn(
                'relative grid h-11 w-11 flex-none place-items-center rounded-full border shadow-[0_4px_14px_rgba(0,0,0,0.10)] transition-[background-color,color,transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_8px_26px_rgba(0,0,0,0.2)] motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                panelOpen
                  ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                  : 'border-[var(--border-hover)] bg-[var(--bg-card)] text-[var(--text-primary)]'
              )}
              title="Filters"
              type="button"
              onClick={togglePanel}
            >
              <FunnelIcon />
              {filterCount > 0 && (
                <span
                  className={cn(
                    'absolute -right-1 -top-1 rounded-[9px] border-2 border-[var(--bg-base)] px-1.5 text-[11px] font-semibold leading-4',
                    panelOpen ? 'bg-white text-[var(--accent)]' : 'bg-[var(--accent)] text-white'
                  )}
                >
                  {filterCount}
                </span>
              )}
            </button>
          </div>
        </div>

        <FilterChips
          accountNames={query.accounts.map((id) => accountName.get(id) ?? id)}
          categoryNames={picks.map((p) => p.label)}
          query={query}
          onChange={setQuery}
        />

        {refsError && (
          <p className="text-sm text-[var(--red)]" role="alert">
            {refsError}
          </p>
        )}

        <section
          aria-label="Figures"
          className="grid grid-cols-2 gap-3 pt-1 min-[720px]:grid-cols-4"
        >
          <Figure label="Spent" sub={labels.current} value={fmtMoney(spent)} />
          {compare ? (
            <Figure
              label={COMPARE_SHORT[query.vs]}
              sub={`${change.amount} · ${change.percent}`}
              subClass={
                spent > was
                  ? 'text-[var(--red)]'
                  : spent < was
                    ? 'text-[var(--green)]'
                    : 'text-[var(--text-muted)]'
              }
              value={fmtMoney(was)}
            />
          ) : (
            <Figure label="Compared with" sub="Nothing picked" value="—" />
          )}
          {/* P5: per day exactly when the chart is daily, so the two always agree. */}
          {daily ? (
            <Figure
              label="Per day"
              sub={`over ${periodDays} days`}
              value={fmtMoney(spent / periodDays)}
            />
          ) : (
            <Figure
              label="Per month"
              sub={`over ${months.toFixed(1)} months`}
              value={fmtMoney(spent / months)}
            />
          )}
          <Figure
            label="Transactions"
            sub={txCount ? `avg ${fmtMoney(spent / txCount)}` : ''}
            value={String(txCount)}
          />
        </section>

        <div className="grid grid-cols-1 gap-3 min-[860px]:grid-cols-[1.5fr_1fr]">
          <OverTimeChart
            canSplit={canSplit}
            running={running}
            series={series}
            shown={shown}
            split={splitOn}
            summary={summary}
            onRunning={setRunning}
            onSplit={setSplit}
          />
          <WhereItWent showAll={canSplit} slices={slices} />
        </div>

        <CategoryBreakdown
          budgets={budgets}
          categories={categories}
          columns={{
            current: labels.current,
            compare: compare ? columnLabel(compare, period) : null,
          }}
          expanded={expandedCategory}
          list={list}
          loading={loadingTransactions}
          rows={breakdownRows}
          showBudgets={showBudgets}
          table={{
            availableTags: refs.availableTags,
            baseCurrency: refs.baseCurrency,
            compact: drawer.isOpen,
            openId: drawer.openId,
            onOpen: openTransaction,
          }}
          onToggle={toggleCategory}
        />

        <TransactionDrawer ref={drawer.ref} {...refs} {...drawer.drawerProps} />
      </div>

      <FilterPanel
        accounts={refs.accounts}
        categories={categories.filter((c) => c.type === 'expense')}
        groupTotals={groupTotals(days.current, categories)}
        open={panelOpen}
        query={query}
        tags={refs.availableTags.map((t) => t.name)}
        today={today}
        toggleRef={filterButton}
        onChange={setQuery}
        onClose={() => setPanelOpen(false)}
      />
    </>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense fallback={<div className="p-4">Loading analytics...</div>}>
      <AnalyticsContent />
    </Suspense>
  );
}
