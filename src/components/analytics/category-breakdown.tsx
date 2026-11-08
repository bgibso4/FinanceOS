import type { ComponentProps } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { TransactionTable } from '@/components/transactions/transaction-table';
import type { Category, Tx } from '@/components/transactions/types';
import { ds } from '@/lib/design-system';
import { fmtMoney } from '@/lib/currency';
import { changeText } from './change';

export type BreakdownRow = {
  category: string;
  categoryId?: string;
  amount: number;
  prevAmount: number;
  txCount: number;
};

export type BreakdownBudget = { categoryId: string; limitAmount: number };

type Props = {
  rows: BreakdownRow[];
  categories: Category[];
  budgets: BreakdownBudget[];
  /** Budget bars only mean something for a single month with no account, tag or merchant filter. */
  showBudgets: boolean;
  columns: { current: string; compare: string | null };
  expanded: string | null;
  onToggle: (category: string) => void;
  list: Tx[];
  loading: boolean;
  table: Omit<ComponentProps<typeof TransactionTable>, 'rows' | 'groups'>;
};

const changeColor = (now: number, then: number) =>
  now > then ? 'text-[var(--red)]' : now < then ? 'text-[var(--green)]' : ds.text.muted;

/** Figures that share the columns: this period, then (with a comparison) the comparison and change. */
function Figures({
  now,
  then,
  compare,
  strong,
}: {
  now: number;
  then: number;
  compare: boolean;
  strong?: boolean;
}) {
  const change = changeText(now, then);
  return (
    <>
      <span className={`text-right font-bold ${strong ? 'text-lg' : ''} ${ds.text.primary}`}>
        {fmtMoney(now)}
      </span>
      {compare && (
        <>
          <span className={`text-right ${ds.text.secondary}`}>{fmtMoney(then)}</span>
          <span className={`text-right text-sm font-medium ${changeColor(now, then)}`}>
            {change.amount} <span className="text-xs">{change.percent}</span>
          </span>
        </>
      )}
    </>
  );
}

export function CategoryBreakdown({
  rows,
  categories,
  budgets,
  showBudgets,
  columns,
  expanded,
  onToggle,
  list,
  loading,
  table,
}: Props) {
  const compare = columns.compare !== null;
  const grid = `grid items-center gap-3 ${
    compare ? 'grid-cols-[1fr_6rem_6rem_9rem]' : 'grid-cols-[1fr_6rem]'
  }`;

  // Only categories with spending in either period show.
  const grouped: Record<string, BreakdownRow[]> = {};
  rows
    .filter((cat) => cat.amount !== 0 || cat.prevAmount !== 0)
    .forEach((cat) => {
      const category = categories.find((c) => c.name === cat.category);
      const parentGroup = category?.parentId
        ? categories.find((c) => c.id === category.parentId)
        : null;
      // A parent names the group; a category with no parent is its own group; no match is Uncategorized.
      const groupName = parentGroup?.name || (category ? category.name : 'Uncategorized');
      (grouped[groupName] ||= []).push(cat);
    });

  const sum = (cats: BreakdownRow[], key: 'amount' | 'prevAmount') =>
    cats.reduce((total, c) => total + c[key], 0);
  const sortedGroups = Object.entries(grouped).sort(
    ([, a], [, b]) => Math.abs(sum(b, 'amount')) - Math.abs(sum(a, 'amount'))
  );

  return (
    <Card>
      <CardHeader>
        <div className={`text-sm font-semibold ${ds.text.secondary}`}>
          Category Breakdown by Group
        </div>
      </CardHeader>
      {/* Narrow screens: the columns scroll sideways inside the card, never the page. */}
      <CardContent className="overflow-x-auto">
        <div className="min-w-fit space-y-4">
          <div className={`${grid} px-3 text-xs ${ds.text.muted}`}>
            <span>Category</span>
            <span className="text-right">{columns.current}</span>
            {compare && (
              <>
                <span className="text-right">{columns.compare}</span>
                <span className="text-right">Change</span>
              </>
            )}
          </div>

          {sortedGroups.map(([groupName, cats]) => (
            <div
              key={groupName}
              className={`border ${ds.border.default} rounded-lg overflow-hidden`}
            >
              <div className={`p-3 ${ds.bg.tertiary} ${grid}`}>
                <span className={`font-bold ${ds.text.primary}`}>{groupName}</span>
                <Figures
                  strong
                  compare={compare}
                  now={Math.abs(sum(cats, 'amount'))}
                  then={Math.abs(sum(cats, 'prevAmount'))}
                />
              </div>

              <div className="divide-y divide-[var(--border)]">
                {cats.map((cat) => {
                  const isExpanded = expanded === cat.category;
                  const budget =
                    showBudgets && cat.categoryId
                      ? budgets.find((b) => b.categoryId === cat.categoryId)
                      : undefined;
                  const budgetPercentage = budget ? (cat.amount / budget.limitAmount) * 100 : null;
                  const isOverBudget = budgetPercentage !== null && budgetPercentage > 100;

                  return (
                    <div key={cat.category}>
                      <div
                        className={`p-4 cursor-pointer transition-all ${isExpanded ? ds.bg.secondary : ds.bg.hover}`}
                        onClick={() => onToggle(cat.category)}
                      >
                        <div className={grid}>
                          <div className="flex items-center gap-3">
                            <span
                              className={`text-sm transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            >
                              ▶
                            </span>
                            <span className={`font-semibold ${ds.text.primary}`}>
                              {cat.category}
                            </span>
                            <span className={`text-sm ${ds.text.muted}`}>
                              {cat.txCount} transactions
                            </span>
                          </div>
                          <Figures compare={compare} now={cat.amount} then={cat.prevAmount} />
                        </div>

                        {budget && (
                          <div className="mt-3 ml-7">
                            <div className="flex items-center justify-between text-xs mb-1">
                              <span
                                className={
                                  isOverBudget ? 'text-[var(--red)] font-medium' : ds.text.secondary
                                }
                              >
                                {budgetPercentage!.toFixed(0)}% of {fmtMoney(budget.limitAmount)}{' '}
                                budget
                              </span>
                              <span
                                className={
                                  isOverBudget ? 'text-[var(--red)] font-medium' : ds.text.muted
                                }
                              >
                                {isOverBudget
                                  ? `${fmtMoney(cat.amount - budget.limitAmount)} over`
                                  : `${fmtMoney(budget.limitAmount - cat.amount)} left`}
                              </span>
                            </div>
                            <div className={`h-2 ${ds.bg.tertiary} rounded-full overflow-hidden`}>
                              <div
                                className={`h-full rounded-full transition-all ${
                                  isOverBudget
                                    ? 'bg-[var(--red)]'
                                    : budgetPercentage! > 80
                                      ? 'bg-[var(--accent)]'
                                      : 'bg-[var(--green)]'
                                }`}
                                style={{ width: `${Math.min(budgetPercentage!, 100)}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {isExpanded && (
                        <div className={`border-t ${ds.border.default} ${ds.bg.primary}`}>
                          <div
                            className={`grid grid-cols-4 gap-4 p-4 ${ds.bg.secondary} border-b ${ds.border.default}`}
                            data-testid="category-stats"
                          >
                            <div>
                              <div className={`text-xs ${ds.text.muted}`}>This period</div>
                              <div className="font-semibold">{fmtMoney(cat.amount)}</div>
                            </div>
                            <div>
                              <div className={`text-xs ${ds.text.muted}`}>
                                {budget ? 'Budget' : 'Comparison'}
                              </div>
                              <div className="font-semibold">
                                {budget
                                  ? fmtMoney(budget.limitAmount)
                                  : compare
                                    ? fmtMoney(cat.prevAmount)
                                    : '—'}
                              </div>
                            </div>
                            <div>
                              <div className={`text-xs ${ds.text.muted}`}>
                                {budget ? 'Remaining' : 'Change'}
                              </div>
                              <div
                                className={`font-semibold ${
                                  budget
                                    ? budget.limitAmount - cat.amount >= 0
                                      ? 'text-[var(--green)]'
                                      : 'text-[var(--red)]'
                                    : changeColor(cat.amount, cat.prevAmount)
                                }`}
                              >
                                {budget
                                  ? fmtMoney(budget.limitAmount - cat.amount)
                                  : compare
                                    ? changeText(cat.amount, cat.prevAmount).amount
                                    : '—'}
                              </div>
                            </div>
                            <div>
                              <div className={`text-xs ${ds.text.muted}`}>Avg per transaction</div>
                              <div className="font-semibold">
                                {cat.txCount > 0 ? fmtMoney(cat.amount / cat.txCount) : '—'}
                              </div>
                            </div>
                          </div>

                          {loading ? (
                            <div className={`p-4 text-center ${ds.text.muted}`}>
                              Loading transactions...
                            </div>
                          ) : list.length === 0 ? (
                            <div className={`p-4 text-center ${ds.text.muted}`}>
                              No transactions found
                            </div>
                          ) : (
                            <div className="max-h-96 overflow-y-auto">
                              <TransactionTable {...table} rows={list} />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
