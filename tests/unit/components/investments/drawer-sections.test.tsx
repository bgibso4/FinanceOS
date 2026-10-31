import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BalanceSourcePicker } from '@/components/investments/balance-source-picker';
import { AccountHoldingsSection } from '@/components/investments/account-holdings-section';
import { EnteredBalancesSection } from '@/components/investments/entered-balances-section';
import { BalanceSource } from '@/lib/investments/codes';
import { makeHolding } from '../../../helpers/investment-overview';

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply>;
const ok = (body: unknown): Reply => ({ body });

beforeEach(() => {
  replies = {};
  global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(url)}`;
    const match = Object.keys(replies).find((k) => key.startsWith(k));
    const reply = match ? replies[match] : { status: 404, body: { error: 'Not mocked' } };
    return {
      ok: (reply.status ?? 200) < 400,
      status: reply.status ?? 200,
      json: async () => reply.body,
    } as Response;
  }) as unknown as typeof fetch;
});

const calls = () =>
  vi.mocked(global.fetch).mock.calls.map(([url, init]) => ({
    key: `${init?.method ?? 'GET'} ${String(url)}`,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));

describe('BalanceSourcePicker', () => {
  it('locks Synced when the account can sync', () => {
    render(<BalanceSourcePicker canSync value={BalanceSource.Provider} onChange={vi.fn()} />);
    expect(screen.getByRole('radiogroup', { name: 'Balance source' })).toBeInTheDocument();
    const synced = screen.getByRole('radio', { name: /Synced/ });
    expect(synced).toHaveAttribute('aria-checked', 'true');
    expect(synced).toHaveAttribute('aria-disabled', 'false');
    expect(screen.getByRole('radio', { name: /Valued/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('radio', { name: /Manual/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('From your institution through its connection.')).toBeInTheDocument();
    expect(screen.getByText('The units you hold × daily market prices.')).toBeInTheDocument();
    expect(screen.getByText('You enter the balance from statements.')).toBeInTheDocument();
    expect(
      screen.getByText('Disconnect to value it or enter balances yourself.')
    ).toBeInTheDocument();
  });

  it('offers Valued and Manual to a disconnected synced account', async () => {
    const onChange = vi.fn();
    render(
      <BalanceSourcePicker canSync={false} value={BalanceSource.Provider} onChange={onChange} />
    );
    const synced = screen.getByRole('radio', { name: /Synced/ });
    expect(synced).toHaveAttribute('aria-checked', 'true');
    expect(synced).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('radio', { name: /Valued/ })).toHaveAttribute('aria-disabled', 'false');
    expect(
      screen.getByText('Synced needs a connection to this account’s institution.')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: /Synced/ }));
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('radio', { name: /Manual/ }));
    expect(onChange).toHaveBeenCalledWith(BalanceSource.Manual);
  });
});

describe('AccountHoldingsSection', () => {
  const account = { id: 'acc-1', name: 'Test Fund Account', currency: 'USD' };
  const holdingsReply = () =>
    ok({
      holdings: [
        makeHolding({ accountId: 'acc-1', quantity: 10, priceInAccount: 110, value: 1100 }),
      ],
      pricesAsOf: '2026-10-08',
    });

  it('lists holdings with the valued sub-label and opens the editor', async () => {
    replies['GET /api/investments/accounts/acc-1/holdings'] = holdingsReply();
    render(
      <AccountHoldingsSection
        account={{ ...account, balanceSource: BalanceSource.Valuation }}
        onChanged={vi.fn()}
      />
    );
    expect(await screen.findByText('AAA')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Holdings/ })).toBeInTheDocument();
    expect(screen.getByText('valued at daily closes')).toBeInTheDocument();
    expect(screen.getByText('Triple A Fund')).toBeInTheDocument();
    for (const h of ['Security', 'Units', 'Price', 'Value'])
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.getByText('$110.00')).toBeInTheDocument();
    expect(screen.getByText('$1,100.00')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit holdings' }));
    expect(
      screen.getByRole('dialog', { name: 'Edit holdings · Test Fund Account' })
    ).toBeInTheDocument();
  });

  it('closes the editor after a save, refetches and tells the page', async () => {
    replies['GET /api/investments/accounts/acc-1/holdings'] = holdingsReply();
    replies['PUT /api/investments/accounts/acc-1/holdings'] = ok({ success: true });
    const onChanged = vi.fn();
    render(
      <AccountHoldingsSection
        account={{ ...account, balanceSource: BalanceSource.Valuation }}
        onChanged={onChanged}
      />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Edit holdings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save holdings' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      calls().filter((c) => c.key === 'GET /api/investments/accounts/acc-1/holdings')
    ).toHaveLength(2);
  });

  it('shows synced holdings without an edit button', async () => {
    replies['GET /api/investments/accounts/acc-1/holdings'] = holdingsReply();
    render(
      <AccountHoldingsSection
        account={{ ...account, balanceSource: BalanceSource.Provider }}
        onChanged={vi.fn()}
      />
    );
    expect(await screen.findByText('AAA')).toBeInTheDocument();
    expect(screen.getByText('from the connection')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit holdings' })).not.toBeInTheDocument();
  });

  it('shows the empty state', async () => {
    replies['GET /api/investments/accounts/acc-1/holdings'] = ok({
      holdings: [],
      pricesAsOf: null,
    });
    render(
      <AccountHoldingsSection
        account={{ ...account, balanceSource: BalanceSource.Provider }}
        onChanged={vi.fn()}
      />
    );
    expect(await screen.findByText('No holdings yet.')).toBeInTheDocument();
  });
});

describe('EnteredBalancesSection', () => {
  const url = '/api/investments/accounts/acc-1/balances';
  const row = (id: string, date: string, balance: number) => ({
    id,
    accountId: 'acc-1',
    date: `${date}T00:00:00.000Z`,
    balance,
    source: 'manual',
  });

  it('shows the cutoff hint for a synced account and counts entries', async () => {
    replies[`GET ${url}`] = ok({
      balances: [row('b-1', '2025-12-31', 1000), row('b-2', '2025-09-30', 900)],
      enterBefore: '2026-03-03',
      today: '2026-10-09',
    });
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Provider }}
        onChanged={vi.fn()}
      />
    );
    expect(await screen.findByText('2 entries')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Balances you entered/ })).toBeInTheDocument();
    expect(
      screen.getByText(
        'For days before syncing began on 2026-03-03, from old statements. Each one is exact on its date.'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('2025-12-31')).toBeInTheDocument();
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();
  });

  it('says valuing for a valued account and counts one entry', async () => {
    replies[`GET ${url}`] = ok({
      balances: [row('b-1', '2025-12-31', 1000)],
      enterBefore: '2026-03-03',
      today: '2026-10-09',
    });
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Valuation }}
        onChanged={vi.fn()}
      />
    );
    expect(await screen.findByText('1 entry')).toBeInTheDocument();
    expect(
      screen.getByText(
        'For days before valuing began on 2026-03-03, from old statements. Each one is exact on its date.'
      )
    ).toBeInTheDocument();
  });

  it('shows the manual hint and empty state', async () => {
    replies[`GET ${url}`] = ok({ balances: [], enterBefore: null, today: '2026-10-09' });
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Manual }}
        onChanged={vi.fn()}
      />
    );
    expect(await screen.findByText('none yet')).toBeInTheDocument();
    expect(screen.getByText('No balances entered yet.')).toBeInTheDocument();
    expect(
      screen.getByText('From your statements. The balance holds until the next entry.')
    ).toBeInTheDocument();
    const asOf = screen.getByLabelText('As of');
    expect(asOf).toHaveValue('2026-10-09');
    expect(asOf).toHaveAttribute('max', '2026-10-09');
  });

  it('adds a balance and tells the page', async () => {
    replies[`GET ${url}`] = ok({ balances: [], enterBefore: null, today: '2026-10-09' });
    replies[`POST ${url}`] = { status: 201, body: { balance: {} } };
    const onChanged = vi.fn();
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'CAD', balanceSource: BalanceSource.Manual }}
        onChanged={onChanged}
      />
    );
    await screen.findByText('none yet');
    await userEvent.type(screen.getByLabelText('Balance (CAD)'), '1,234.50');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    const keys = calls().map((c) => c.key);
    expect(calls().find((c) => c.key === `POST ${url}`)?.body).toEqual({
      date: '2026-10-09',
      balance: 1234.5,
    });
    expect(keys.filter((k) => k === `GET ${url}`)).toHaveLength(2);
    expect(screen.getByLabelText('Balance (CAD)')).toHaveValue('');
  });

  it('needs a readable balance', async () => {
    replies[`GET ${url}`] = ok({ balances: [], enterBefore: null, today: '2026-10-09' });
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Manual }}
        onChanged={vi.fn()}
      />
    );
    await screen.findByText('none yet');
    await userEvent.type(screen.getByLabelText('Balance (USD)'), 'abc');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a balance');
    expect(calls().filter((c) => c.key.startsWith('POST'))).toHaveLength(0);
  });

  it('deletes an entry', async () => {
    replies[`GET ${url}`] = ok({
      balances: [row('b-1', '2025-12-31', 1000)],
      enterBefore: null,
      today: '2026-10-09',
    });
    replies[`DELETE ${url}/b-1`] = ok({ success: true });
    const onChanged = vi.fn();
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Manual }}
        onChanged={onChanged}
      />
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Delete balance 2025-12-31' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls().map((c) => c.key)).toContain(`DELETE ${url}/b-1`);
    expect(calls().filter((c) => c.key === `GET ${url}`)).toHaveLength(2);
  });

  it('defaults the date to the day before the cutoff on a synced account', async () => {
    replies[`GET ${url}`] = ok({ balances: [], enterBefore: '2026-03-03', today: '2026-10-09' });
    replies[`POST ${url}`] = { status: 201, body: { balance: {} } };
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Provider }}
        onChanged={vi.fn()}
      />
    );
    await screen.findByText('none yet');
    const asOf = screen.getByLabelText('As of');
    expect(asOf).toHaveValue('2026-03-02');
    expect(asOf).toHaveAttribute('max', '2026-03-02');
    await userEvent.type(screen.getByLabelText('Balance (USD)'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(calls().find((c) => c.key === `POST ${url}`)?.body).toEqual({
        date: '2026-03-02',
        balance: 500,
      })
    );
  });

  it('shows a refusal under the form', async () => {
    replies[`GET ${url}`] = ok({ balances: [], enterBefore: '2026-03-03', today: '2026-10-09' });
    replies[`POST ${url}`] = {
      status: 400,
      body: { error: 'Balances you enter must be dated before 2026-03-03' },
    };
    const onChanged = vi.fn();
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Provider }}
        onChanged={onChanged}
      />
    );
    await screen.findByText('none yet');
    await userEvent.type(screen.getByLabelText('Balance (USD)'), '500');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Balances you enter must be dated before 2026-03-03');
    expect(onChanged).not.toHaveBeenCalled();
    expect(within(alert).queryByRole('button')).toBeNull();
  });

  it('opens and cancels the paste panel', async () => {
    replies[`GET ${url}`] = ok({ balances: [], enterBefore: null, today: '2026-10-09' });
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Manual }}
        onChanged={vi.fn()}
      />
    );
    await screen.findByText('none yet');
    await userEvent.click(screen.getByRole('button', { name: 'Paste several from a spreadsheet' }));
    expect(
      screen.queryByRole('button', { name: 'Paste several from a spreadsheet' })
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Paste past balances'), {
      target: { value: '2025-03-31,10' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Paste past balances')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Paste several from a spreadsheet' }));
    expect(screen.getByLabelText('Paste past balances')).toHaveValue('');
  });

  it('reports pasted rows the server kept', async () => {
    replies[`GET ${url}`] = ok({ balances: [], enterBefore: null, today: '2026-10-09' });
    replies[`POST ${url}`] = {
      body: { saved: 0, skipped: [{ date: '2025-03-31', reason: 'kept' }] },
    };
    const onChanged = vi.fn();
    render(
      <EnteredBalancesSection
        account={{ id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Manual }}
        onChanged={onChanged}
      />
    );
    await screen.findByText('none yet');
    await userEvent.click(screen.getByRole('button', { name: 'Paste several from a spreadsheet' }));
    fireEvent.change(screen.getByLabelText('Paste past balances'), {
      target: { value: '2025-03-31,10' },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 balance' }));
    expect(
      await screen.findByText('1 not saved: a synced or valued balance is already on that day.')
    ).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Paste past balances')).not.toBeInTheDocument();
  });
});
