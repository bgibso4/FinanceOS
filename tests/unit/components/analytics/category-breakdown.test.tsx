import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoryBreakdown, type BreakdownRow } from '@/components/analytics/category-breakdown';
import type { Category, Tx } from '@/components/transactions/types';

const categories: Category[] = [
  { id: 'food', name: 'Food', type: 'expense', parentId: null },
  { id: 'groceries', name: 'Groceries', type: 'expense', parentId: 'food' },
  { id: 'dining', name: 'Dining', type: 'expense', parentId: 'food' },
  { id: 'rent', name: 'Rent', type: 'expense', parentId: null },
];

const row = (category: string, categoryId: string, amount: number, prevAmount: number) => ({
  category,
  categoryId,
  amount,
  prevAmount,
  txCount: 2,
  monthOverMonth: 0,
  isOutlier: false,
});

const rows: BreakdownRow[] = [
  row('Groceries', 'groceries', 100, 60),
  row('Dining', 'dining', 0, 0),
  row('Rent', 'rent', 20, 50),
];

const tx: Tx = {
  id: 't1',
  date: '2026-11-03',
  merchant: 'Corner Shop',
  amount: -40,
  category: { id: 'groceries', name: 'Groceries' },
  account: { id: 'a1', name: 'Card', currency: 'USD' },
  confidenceScore: 1,
  isTransfer: false,
  note: null,
  tags: [],
};

function setup(over: Partial<Parameters<typeof CategoryBreakdown>[0]> = {}) {
  const onToggle = vi.fn();
  const onOpen = vi.fn();
  render(
    <CategoryBreakdown
      showBudgets
      budgets={[{ categoryId: 'groceries', limitAmount: 200 }]}
      categories={categories}
      columns={{ current: 'Nov 2026 so far', compare: 'Oct 1 – Oct 7' }}
      expanded={null}
      list={[tx]}
      loading={false}
      rows={rows}
      table={{
        availableTags: [],
        baseCurrency: 'USD',
        compact: false,
        openId: null,
        onOpen,
      }}
      onToggle={onToggle}
      {...over}
    />
  );
  return { onToggle, onOpen };
}

describe('CategoryBreakdown', () => {
  it('columnsNameThePeriods', () => {
    setup();
    expect(screen.getByText('Nov 2026 so far')).toBeInTheDocument();
    expect(screen.getByText('Oct 1 – Oct 7')).toBeInTheDocument();
    expect(screen.getByText('Change')).toBeInTheDocument();
    expect(screen.getAllByText('+$40')[0]).toBeInTheDocument();
    expect(screen.getAllByText('−$30').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dining')).not.toBeInTheDocument();
  });

  it('noCompareHidesColumns', () => {
    setup({ columns: { current: 'Nov 2026', compare: null } });
    expect(screen.getByText('Nov 2026')).toBeInTheDocument();
    expect(screen.queryByText('Change')).not.toBeInTheDocument();
    expect(screen.queryByText('+$40')).not.toBeInTheDocument();
  });

  it('budgetBarsOnlyWhenAllowed', () => {
    setup({ showBudgets: false });
    expect(screen.queryByText(/budget/)).not.toBeInTheDocument();
  });

  it('showsBudgetBarWhenAllowed', () => {
    setup();
    expect(screen.getByText(/50% of/)).toBeInTheDocument();
  });

  it('statsRowUsesPeriodWords', () => {
    setup({ expanded: 'Rent', showBudgets: false });
    const stats = screen.getByTestId('category-stats');
    for (const label of ['This period', 'Comparison', 'Change', 'Avg per transaction'])
      expect(within(stats).getByText(label)).toBeInTheDocument();
    expect(within(stats).getByText('−$30')).toBeInTheDocument();
  });

  it('rowOpensTransactions', async () => {
    const { onToggle, onOpen } = setup({ expanded: 'Groceries' });
    await userEvent.click(screen.getAllByText('Rent')[1]);
    expect(onToggle).toHaveBeenCalledWith('Rent');
    await userEvent.click(screen.getByText('Corner Shop'));
    expect(onOpen).toHaveBeenCalledWith('t1');
  });
});
