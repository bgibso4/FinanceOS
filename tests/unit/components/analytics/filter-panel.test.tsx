import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState, type RefObject } from 'react';
import { FilterPanel } from '@/components/analytics/filter-panel';
import { FilterChips } from '@/components/analytics/filter-chips';
import { defaultQuery, type AnalyticsQuery } from '@/lib/analytics-query';
import { UNCATEGORIZED } from '@/lib/transaction-filters';
import type { Category } from '@/components/transactions/types';

const TODAY = '2026-11-07';

const categories: Category[] = [
  { id: 'food', name: 'Food', type: 'expense', parentId: null },
  { id: 'groceries', name: 'Groceries', type: 'expense', parentId: 'food' },
  { id: 'dining', name: 'Dining', type: 'expense', parentId: 'food' },
  { id: 'golf', name: 'Golf', type: 'expense', parentId: null },
  { id: 'fees', name: 'Green Fees', type: 'expense', parentId: 'golf' },
  { id: 'rent', name: 'Rent', type: 'expense', parentId: null },
];
const accounts = [
  { id: 'amex', name: 'Amex' },
  { id: 'chase', name: 'Chase' },
];

/** The panel with its query held in state, as the page will hold it. */
function setup(initial: Partial<AnalyticsQuery> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  const toggleRef = createRef<HTMLButtonElement>();
  function Harness() {
    const [query, setQuery] = useState<AnalyticsQuery>({ ...defaultQuery(TODAY), ...initial });
    return (
      <>
        <button ref={toggleRef} type="button">
          Filters
        </button>
        <p>Page</p>
        <FilterPanel
          open
          accounts={accounts}
          categories={categories}
          groupTotals={{ food: 512, golf: 80, rent: 1500, [UNCATEGORIZED]: 12 }}
          query={query}
          tags={['Vacation', 'Shared']}
          today={TODAY}
          toggleRef={toggleRef as RefObject<HTMLElement>}
          onChange={(q) => {
            onChange(q);
            setQuery(q);
          }}
          onClose={onClose}
        />
      </>
    );
  }
  render(<Harness />);
  const last = (): AnalyticsQuery => onChange.mock.calls.at(-1)![0];
  return { onChange, onClose, toggleRef, last };
}

const box = (name: string) => screen.getByRole('checkbox', { name: new RegExp(`^${name}`) });

afterEach(() => {
  vi.useRealTimers();
});

describe('FilterPanel', () => {
  it('pickingKeepsPanelOpen', async () => {
    const { onClose, last } = setup();
    await userEvent.click(box('Groceries'));
    expect(last().categories).toEqual(['groceries']);
    await userEvent.click(screen.getByRole('button', { name: 'Year' }));
    expect(last().period).toEqual({ kind: 'year', anchor: '2026-12' });
    expect(last().categories).toEqual(['groceries']);
    await userEvent.click(screen.getByRole('button', { name: 'Same time last year' }));
    expect(last().vs).toBe('lastYear');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeVisible();
  });

  it('doneCloseEscAndOutsideClose', async () => {
    const { onClose, toggleRef } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Close filters' }));
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.pointerDown(screen.getByText('Page'));
    expect(onClose).toHaveBeenCalledTimes(4);
    // The toggle button handles its own click; inside the card is not "outside".
    fireEvent.pointerDown(toggleRef.current!);
    fireEvent.pointerDown(screen.getByText('Merchant'));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('tickingGroupTicksItsCategories', async () => {
    const { last } = setup();
    await userEvent.click(box('Food'));
    expect(new Set(last().categories)).toEqual(new Set(['food', 'groceries', 'dining']));
    expect(box('Food')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(box('Dining'));
    expect(last().categories).toEqual(['groceries']);
    expect(box('Food')).toHaveAttribute('aria-checked', 'mixed');
    expect(box('Groceries')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(box('Dining'));
    expect(new Set(last().categories)).toEqual(new Set(['food', 'groceries', 'dining']));
    expect(box('Food')).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(box('Food'));
    expect(last().categories).toEqual([]);
    expect(box('Food')).toHaveAttribute('aria-checked', 'false');
  });

  it('groupRowsShowTotalsAndUncategorizedIsLast', () => {
    setup();
    expect(box('Food')).toHaveTextContent('$512');
    expect(box('Rent')).toHaveTextContent('$1,500');
    const list = screen.getAllByRole('checkbox').map((b) => b.textContent);
    const cats = list.slice(
      0,
      list.findIndex((t) => t?.startsWith('Amex'))
    );
    expect(cats.at(-1)).toMatch(/^Uncategorized/);
  });

  it('searchNarrowsCategories', async () => {
    setup();
    await userEvent.type(screen.getByPlaceholderText('Search categories…'), 'gro');
    expect(box('Groceries')).toBeInTheDocument();
    expect(box('Food')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Dining/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^Golf/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^Uncategorized/ })).toBeNull();
    // Accounts aren't narrowed by the category search.
    expect(box('Amex')).toBeInTheDocument();
  });

  it('customShowsDateFields', async () => {
    const { last } = setup();
    expect(screen.queryByLabelText('From')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Custom' }));
    const from = screen.getByLabelText('From');
    const to = screen.getByLabelText('To');
    expect(from).toHaveValue('2026-11-01');
    expect(to).toHaveValue('2026-11-07');
    expect(to).toHaveAttribute('max', TODAY);
    expect(from).toHaveAttribute('max', '2026-11-07');

    fireEvent.change(from, { target: { value: '2026-06-01' } });
    expect(last().period).toEqual({
      kind: 'custom',
      anchor: '2026-11',
      custom: { start: '2026-06-01', end: '2026-11-07' },
    });
    fireEvent.change(to, { target: { value: '2026-10-31' } });
    expect(last().period).toEqual({
      kind: 'custom',
      anchor: '2026-10',
      custom: { start: '2026-06-01', end: '2026-10-31' },
    });
    expect(screen.getByLabelText('From')).toHaveAttribute('max', '2026-10-31');
    expect(screen.getByLabelText('To')).toHaveAttribute('min', '2026-06-01');

    // From after to, or a day past today, is not applied.
    const before = last();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-08' } });
    expect(last()).toBe(before);
  });

  it('merchantAppliesAfterTypingStops', () => {
    vi.useFakeTimers();
    const { onChange, last } = setup();
    const input = screen.getByPlaceholderText('Name contains…');
    fireEvent.change(input, { target: { value: 'sta' } });
    act(() => vi.advanceTimersByTime(200));
    fireEvent.change(input, { target: { value: 'star' } });
    act(() => vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(last().merchant).toBe('star');
  });

  it('clearAllKeepsPeriodAndComparison', async () => {
    const { last } = setup({
      vs: 'none',
      categories: ['rent'],
      accounts: ['amex'],
      tags: ['Shared'],
      merchant: 'star',
    });
    expect(screen.getByPlaceholderText('Name contains…')).toHaveValue('star');
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(last()).toEqual({ ...defaultQuery(TODAY), vs: 'none' });
    expect(screen.getByPlaceholderText('Name contains…')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled();
  });

  it('closedPanelIsHiddenAndIgnoresOutsideClicks', () => {
    const onClose = vi.fn();
    render(
      <FilterPanel
        accounts={accounts}
        categories={categories}
        groupTotals={{}}
        open={false}
        query={defaultQuery(TODAY)}
        tags={[]}
        today={TODAY}
        toggleRef={createRef<HTMLElement>() as RefObject<HTMLElement>}
        onChange={vi.fn()}
        onClose={onClose}
      />
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.pointerDown(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FilterChips', () => {
  const query: AnalyticsQuery = {
    ...defaultQuery(TODAY),
    categories: ['groceries', 'dining'],
    accounts: ['amex'],
    tags: ['Vacation', 'Shared', 'Work'],
    merchant: 'star',
  };

  it('chipsCapToFirstPlusCount', () => {
    render(
      <FilterChips
        accountNames={['Amex']}
        categoryNames={['Groceries', 'Dining']}
        query={query}
        onChange={vi.fn()}
      />
    );
    const chips = screen.getAllByRole('listitem').map((c) => c.textContent);
    expect(chips).toEqual([
      'Period November 2026',
      'vs The period before',
      'Category Groceries +1',
      'Account Amex',
      'Tag Vacation +2',
      'Merchant contains “star”',
    ]);
    // Period and comparison chips can't be cleared.
    const [period, vs] = screen.getAllByRole('listitem');
    expect(within(period).queryByRole('button')).toBeNull();
    expect(within(vs).queryByRole('button')).toBeNull();
  });

  it('chipsShowOnlyFiltersInUse', () => {
    render(
      <FilterChips
        accountNames={[]}
        categoryNames={[]}
        query={{ ...defaultQuery(TODAY), vs: 'none' }}
        onChange={vi.fn()}
      />
    );
    expect(screen.getAllByRole('listitem').map((c) => c.textContent)).toEqual([
      'Period November 2026',
      'vs Nothing',
    ]);
  });

  it('chipClearRemovesOnlyThatFilter', async () => {
    const onChange = vi.fn();
    render(
      <FilterChips
        accountNames={['Amex']}
        categoryNames={['Groceries', 'Dining']}
        query={query}
        onChange={onChange}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Clear Category filter' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...query, categories: [] });
    await userEvent.click(screen.getByRole('button', { name: 'Clear Merchant filter' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...query, merchant: '' });
  });
});
