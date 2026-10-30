import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The Plaid Link SDK cannot run in jsdom; the button is replaced by a plain one.
vi.mock('@/components/plaid/PlaidReconnectButton', () => ({
  PlaidReconnectButton: ({ buttonText }: { buttonText?: string }) => (
    <button type="button">{buttonText}</button>
  ),
}));

import { AccountNavigator } from '@/components/investments/account-navigator';
import { AccountDetail } from '@/components/investments/account-detail';
import {
  makeAccount,
  makeHolding,
  makeOverview,
  series,
} from '../../../helpers/investment-overview';
import { BalanceSource } from '@/lib/investments/codes';

const handlers = () => ({
  onRecordBalance: vi.fn(),
  onEditHoldings: vi.fn(),
  onRetryPrices: vi.fn(),
  onReconnected: vi.fn(),
});

const retirement = makeAccount({
  id: 'acc-ret',
  name: 'Workplace Plan',
  group: 'Retirement',
  wrapper: '401(k)',
  valueBase: 5000,
  value: 5000,
});
const manual = makeAccount({
  id: 'acc-man',
  name: 'Pension',
  institution: 'Test Life',
  group: 'Retirement',
  wrapper: 'Retirement',
  balanceSource: BalanceSource.Manual,
  asOf: '2026-10-01',
  value: 900,
  valueBase: 900,
  change: null,
  series: series([800, 800, 900], [1]),
  enrollmentId: null,
  lastSyncAt: null,
});

describe('AccountNavigator', () => {
  it('groups accounts in order with totals and selects', async () => {
    const onSelect = vi.fn();
    render(
      <AccountNavigator
        overview={makeOverview({ accounts: [makeAccount(), retirement, manual] })}
        selected={null}
        onSelect={onSelect}
      />
    );
    const groups = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(groups).toEqual(['Retirement', 'Taxable']);
    const ret = within(screen.getByRole('region', { name: 'Retirement' }));
    expect(ret.getByText('$5,900')).toBeInTheDocument();
    expect(ret.getByText('Test Life · Retirement · as of Oct 1')).toBeInTheDocument();
    expect(screen.getByText('3 accounts · 2 institutions')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Pension'));
    expect(onSelect).toHaveBeenCalledWith('acc-man');
  });

  it('shows status dots', () => {
    const waiting = makeAccount({
      status: {
        needsReauth: null,
        waiting: { showingFrom: null },
        unpriced: [],
        tradesReported: true,
      },
    });
    render(
      <AccountNavigator
        overview={makeOverview({ accounts: [waiting] })}
        selected={null}
        onSelect={vi.fn()}
      />
    );
    expect(screen.getByLabelText('Waiting on Test Bank')).toBeInTheDocument();
  });
});

describe('AccountDetail', () => {
  it('labels the All range and dates its axis with years', () => {
    render(
      <AccountDetail
        {...handlers()}
        overview={makeOverview({ range: 'All', from: '2024-10-01' })}
        selected={null}
      />
    );
    expect(screen.getByText('balance change · All')).toBeInTheDocument();
    expect(screen.getByText('Oct 1, 24')).toBeInTheDocument();
  });

  it('keeps a holding open across a range change and closes it after switching accounts', async () => {
    const o = makeOverview({
      accounts: [makeAccount(), retirement],
      holdings: [makeHolding(), makeHolding({ accountId: 'acc-ret', quantity: 5, valueBase: 500 })],
    });
    const { rerender } = render(<AccountDetail {...handlers()} overview={o} selected={null} />);
    await userEvent.click(screen.getByRole('button', { name: /AAA/ }));
    expect(screen.getAllByTestId('holding-member')).toHaveLength(2);
    expect(screen.getByText('Workplace Plan')).toBeInTheDocument();
    rerender(<AccountDetail {...handlers()} overview={{ ...o, range: '1Y' }} selected={null} />);
    expect(screen.getAllByTestId('holding-member')).toHaveLength(2);
    rerender(<AccountDetail {...handlers()} overview={o} selected="acc-ret" />);
    rerender(<AccountDetail {...handlers()} overview={o} selected={null} />);
    expect(screen.queryByTestId('holding-member')).toBeNull();
  });

  it('shows all accounts combined', () => {
    const overview = makeOverview({
      accounts: [makeAccount(), retirement],
      holdings: [
        makeHolding(),
        makeHolding({ accountId: 'acc-ret', valueBase: 500 }),
        makeHolding({
          accountId: 'acc-ret',
          securityId: 'sec-bbb',
          label: 'BBB',
          name: 'B Fund',
          valueBase: 400,
        }),
      ],
      activity: [
        {
          id: 't1',
          accountId: 'acc-ret',
          date: '2026-10-05',
          title: 'Buy · AAA',
          trade: null,
          amount: -5,
          currency: 'USD',
        },
      ],
    });
    render(<AccountDetail {...handlers()} overview={overview} selected={null} />);
    expect(screen.getByRole('heading', { name: 'All accounts' })).toBeInTheDocument();
    expect(screen.getByText('$6,100')).toBeInTheDocument();
    expect(screen.getByText('combined across accounts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AAA/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('size = value · color = 3M change')).toBeInTheDocument();
    expect(screen.getByText('Workplace Plan · Test Bank')).toBeInTheDocument();
    expect(screen.getByText('balance change · 3M')).toBeInTheDocument();
  });

  it('renders a manual account’s entries, legend and freshness', async () => {
    const h = handlers();
    render(
      <AccountDetail
        {...h}
        overview={makeOverview({ accounts: [manual], holdings: [] })}
        selected="acc-man"
      />
    );
    expect(screen.getByText('Manual balance')).toBeInTheDocument();
    expect(screen.getByText('Entered')).toBeInTheDocument();
    expect(screen.getByText('Carried forward')).toBeInTheDocument();
    expect(screen.getByText('Last entry Oct 1 · 8 days ago')).toBeInTheDocument();
    expect(screen.getByText('Entries:')).toBeInTheDocument();
    expect(screen.queryByText(/balance change/)).toBeNull();
    expect(screen.getByText('No holdings reported.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Record balance' }));
    expect(h.onRecordBalance).toHaveBeenCalledWith(manual);
  });

  it('shows the native balance for a non-base account', () => {
    const cad = makeAccount({ id: 'acc-cad', currency: 'CAD', value: 2000, valueBase: 1000 });
    render(
      <AccountDetail
        {...handlers()}
        overview={makeOverview({ accounts: [cad] })}
        selected="acc-cad"
      />
    );
    expect(screen.getByText('CA$2,000')).toBeInTheDocument();
  });

  it('formats base amounts in a non-USD base currency', () => {
    const overview = makeOverview({
      baseCurrency: 'CAD',
      accounts: [makeAccount(), retirement],
      holdings: [
        makeHolding(),
        makeHolding({ securityId: 'sec-bbb', label: 'BBB', gainBase: -5, valueBase: 400 }),
      ],
    });
    render(
      <>
        <AccountNavigator overview={overview} selected={null} onSelect={vi.fn()} />
        <AccountDetail {...handlers()} overview={overview} selected={null} />
      </>
    );
    expect(screen.getAllByText('CA$6,100')).toHaveLength(2);
    expect(screen.getAllByText('CA$5,000')).toHaveLength(2); // group total and row
    expect(screen.getByText('+CA$100')).toBeInTheDocument();
    expect(screen.getByText('−CA$5')).toBeInTheDocument();
    // The chart's y-axis may print the same compact value, so leave the axis out.
    const outsideAxis = screen
      .getAllByText('CA$1.1k')
      .filter((el) => !el.closest('[data-testid="chart-y-axis"]'));
    expect(outsideAxis).toHaveLength(1);
    expect(screen.getByText('↗ CA$100 · +10.0%')).toBeInTheDocument();
    expect(screen.queryByText(/(^|[^A])\$\d/)).toBeNull();
  });

  it('offers Reconnect, Retry and Set up pricing from notices', async () => {
    const h = handlers();
    const broken = makeAccount({
      status: {
        needsReauth: { since: '2026-10-01' },
        waiting: null,
        unpriced: [],
        tradesReported: true,
      },
    });
    const { unmount } = render(
      <AccountDetail {...h} overview={makeOverview({ accounts: [broken] })} selected="acc-plaid" />
    );
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    unmount();

    const valued = makeAccount({
      id: 'acc-val',
      balanceSource: BalanceSource.Valuation,
      prices: { asOf: '2026-10-06', stale: true },
      status: {
        needsReauth: null,
        waiting: null,
        unpriced: [{ securityId: 'sec-z', label: 'ZZZ' }],
        tradesReported: true,
      },
    });
    render(
      <AccountDetail {...h} overview={makeOverview({ accounts: [valued] })} selected="acc-val" />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.onRetryPrices).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Set up pricing' })).toHaveAttribute(
      'href',
      '/settings?tab=securities&security=sec-z'
    );
    expect(screen.queryByRole('button', { name: 'Set symbol' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
    expect(h.onEditHoldings).toHaveBeenCalledWith(valued);
  });

  it('shows the empty activity copy', () => {
    const quiet = makeAccount({
      status: { needsReauth: null, waiting: null, unpriced: [], tradesReported: false },
    });
    render(
      <AccountDetail
        {...handlers()}
        overview={makeOverview({ accounts: [quiet] })}
        selected="acc-plaid"
      />
    );
    expect(
      screen.getByText(
        'Test Bank doesn’t report trades for this account — changes show as balance movement.'
      )
    ).toBeInTheDocument();
    // A single position hides the holdings map and allocation (spec §8).
    expect(screen.queryByText('Holdings map')).toBeNull();
    expect(screen.queryByText('Allocation')).toBeNull();
  });

  it('renders an empty overview', () => {
    render(
      <AccountDetail
        {...handlers()}
        overview={makeOverview({
          accounts: [],
          holdings: [],
          portfolio: { value: 0, series: [], change: null },
        })}
        selected={null}
      />
    );
    expect(screen.getByText('Not enough history in this range yet.')).toBeInTheDocument();
    expect(screen.getByText('No holdings reported.')).toBeInTheDocument();
  });
});
