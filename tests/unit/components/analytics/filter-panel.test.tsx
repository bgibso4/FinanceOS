import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
function setup(
  initial: Partial<AnalyticsQuery> = {},
  accountList = accounts,
  categoryList = categories,
  tagList = ['Vacation', 'Shared']
) {
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
          accounts={accountList}
          categories={categoryList}
          groupTotals={{ food: 512, golf: 80, rent: 1500, [UNCATEGORIZED]: 12 }}
          query={query}
          tags={tagList}
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
const header = (title: string) => screen.getByRole('button', { name: new RegExp(`^${title}`) });
const openSection = (title: string) => userEvent.click(header(title));
const openGroup = (name: string) =>
  userEvent.click(screen.getByRole('button', { name: `Show ${name}` }));
/** The row labels in DOM order, without the totals. */
const rowLabels = () =>
  screen
    .getAllByRole('checkbox')
    .map((b) => b.querySelector('span:not([aria-hidden])')?.textContent ?? '');

afterEach(() => {
  vi.useRealTimers();
});

describe('FilterPanel', () => {
  it('pickingKeepsPanelOpen', async () => {
    const { onClose, last } = setup();
    await openSection('Categories');
    await openGroup('Food');
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
    await openSection('Categories');
    await openGroup('Food');
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

  it('groupRowsShowTotalsAndUncategorizedIsLast', async () => {
    setup({}, accounts, categories, []);
    await openSection('Categories');
    expect(box('Food')).toHaveTextContent('$512');
    expect(box('Rent')).toHaveTextContent('$1,500');
    expect(rowLabels().at(-1)).toBe('Uncategorized');
  });

  it('categoriesAndAccountsAreAlphabetical', async () => {
    const shuffled = [categories[5], ...categories.slice(0, 5)];
    setup(
      {},
      [
        { id: 'chase', name: 'Chase' },
        { id: 'amex', name: 'Amex' },
      ],
      shuffled,
      []
    );
    await openSection('Categories');
    await openGroup('Food');
    await openGroup('Golf');
    await openSection('Accounts');
    expect(rowLabels()).toEqual([
      'Food',
      'Dining',
      'Groceries',
      'Golf',
      'Green Fees',
      'Rent',
      'Uncategorized',
      'Amex',
      'Chase',
    ]);
  });

  it('searchNarrowsCategories', async () => {
    setup();
    await openSection('Categories');
    await userEvent.type(screen.getByPlaceholderText('Search categories…'), 'gro');
    expect(box('Groceries')).toBeInTheDocument();
    expect(box('Food')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Dining/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^Golf/ })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^Uncategorized/ })).toBeNull();
    // Accounts aren't narrowed by the category search.
    await openSection('Accounts');
    expect(box('Amex')).toBeInTheDocument();
  });

  it('categoriesAndAccountsStartCollapsed', () => {
    setup();
    expect(header('Categories')).toHaveAttribute('aria-expanded', 'false');
    expect(header('Accounts')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByPlaceholderText('Search categories…')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /^Amex/ })).toBeNull();
    expect(header('Categories')).toHaveTextContent('Any · 6');
    expect(header('Accounts')).toHaveTextContent('Any · 2');
  });

  it('collapsedHeaderShowsPicks', () => {
    setup({ categories: ['dining'] });
    expect(header('Categories')).toHaveTextContent('Dining');
    expect(header('Categories')).not.toHaveTextContent('Any');
  });

  it('clearAllUpdatesCollapsedSummary', async () => {
    setup({ accounts: ['amex'] });
    expect(header('Accounts')).toHaveTextContent('Amex');
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(header('Accounts')).toHaveTextContent('Any · 2');
  });

  it('groupsFoldUntilOpenedPickedOrSearched', async () => {
    setup();
    await openSection('Categories');
    expect(screen.queryByRole('checkbox', { name: /^Groceries/ })).toBeNull();
    await openGroup('Food');
    expect(box('Groceries')).toBeInTheDocument();
    // Ticking the group row still ticks the whole group; the chevron is separate.
    await userEvent.click(box('Food'));
    expect(box('Food')).toHaveAttribute('aria-checked', 'true');
  });

  it('pickedChildShowsWithItsGroupFolded', async () => {
    setup({ categories: ['fees'] });
    await openSection('Categories');
    expect(box('Green Fees')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /^Groceries/ })).toBeNull();
  });

  it('searchShowsMatchesInFoldedGroups', async () => {
    setup();
    await openSection('Categories');
    const search = screen.getByPlaceholderText('Search categories…');
    await userEvent.type(search, 'groc');
    expect(box('Groceries')).toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, 'golf');
    expect(box('Green Fees')).toBeInTheDocument();
  });

  it('tagsCollapseOnlyPastEight', () => {
    setup();
    expect(screen.queryByRole('button', { name: /^Tags/ })).toBeNull();
    cleanup();
    setup({}, accounts, categories, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(header('Tags')).toHaveAttribute('aria-expanded', 'false');
  });

  it('sectionsReopenClosed', async () => {
    const props = {
      accounts,
      categories,
      groupTotals: {},
      query: defaultQuery(TODAY),
      tags: [],
      today: TODAY,
      toggleRef: createRef<HTMLElement>() as RefObject<HTMLElement>,
      onChange: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<FilterPanel {...props} open />);
    await openSection('Categories');
    expect(header('Categories')).toHaveAttribute('aria-expanded', 'true');
    rerender(<FilterPanel {...props} open={false} />);
    rerender(<FilterPanel {...props} open />);
    expect(header('Categories')).toHaveAttribute('aria-expanded', 'false');
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

  it('merchantHeadingShowsWhatIsPicked', () => {
    setup({ merchant: 'starbucks' });
    const heading = screen.getByRole('heading', { name: /Merchant/ });
    expect(heading).toHaveTextContent('Merchant“starbucks”');
  });

  it('merchantSurvivesEscape', () => {
    vi.useFakeTimers();
    const { onClose, last } = setup();
    const input = screen.getByPlaceholderText('Name contains…');
    // A search box would be cleared by Esc in Chrome/Safari (jsdom doesn't emulate that).
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.change(input, { target: { value: 'star' } });
    act(() => vi.advanceTimersByTime(300));
    expect(last().merchant).toBe('star');
    fireEvent.keyDown(input, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(1000));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(last().merchant).toBe('star');
    expect(input).toHaveValue('star');
  });

  it('merchantIsTrimmedAndSpacesAloneAreNoFilter', () => {
    vi.useFakeTimers();
    const { onChange, last } = setup();
    const input = screen.getByPlaceholderText('Name contains…');
    fireEvent.change(input, { target: { value: '   ' } });
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ' star ' } });
    act(() => vi.advanceTimersByTime(300));
    expect(last().merchant).toBe('star');
    expect(input).toHaveValue(' star ');
  });

  it('clearingCancelsPendingMerchant', () => {
    vi.useFakeTimers();
    const { last } = setup({ accounts: ['amex'] });
    const input = screen.getByPlaceholderText('Name contains…');
    // Clear all while the merchant is still empty in the query.
    fireEvent.change(input, { target: { value: 'sta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    act(() => vi.advanceTimersByTime(1000));
    expect(last()).toEqual(defaultQuery(TODAY));
    expect(screen.getByPlaceholderText('Name contains…')).toHaveValue('');
  });

  it('outsideMerchantClearCancelsPendingTyping', () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const props = {
      open: true,
      accounts,
      categories,
      groupTotals: {},
      tags: [],
      today: TODAY,
      toggleRef: createRef<HTMLElement>() as RefObject<HTMLElement>,
      onChange,
      onClose: vi.fn(),
    };
    const { rerender } = render(
      <FilterPanel {...props} query={{ ...defaultQuery(TODAY), merchant: 'star' }} />
    );
    const input = screen.getByPlaceholderText('Name contains…');
    fireEvent.change(input, { target: { value: 'starb' } });
    // A chip's ✕ clears the merchant before the typing applies.
    rerender(<FilterPanel {...props} query={defaultQuery(TODAY)} />);
    act(() => vi.advanceTimersByTime(1000));
    expect(onChange).not.toHaveBeenCalled();
    expect(input).toHaveValue('');
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
      'vs Period before',
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

  it('chipsMarkAddedFilters', () => {
    render(
      <FilterChips
        accountNames={[]}
        categoryNames={[]}
        query={{ ...defaultQuery(TODAY), tags: ['Vacation'] }}
        onChange={vi.fn()}
      />
    );
    const [period, vs, tag] = screen.getAllByRole('listitem');
    expect(tag).toHaveAttribute('data-added', 'true');
    expect(period).not.toHaveAttribute('data-added');
    expect(vs).not.toHaveAttribute('data-added');
  });
});
