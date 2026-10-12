import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordBalanceModal } from '@/components/investments/record-balance-modal';
import { HoldingsEditorModal } from '@/components/investments/holdings-editor-modal';
import { SetSymbolModal } from '@/components/investments/set-symbol-modal';
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

describe('RecordBalanceModal', () => {
  const account = { id: 'acc-1', name: 'Pension', institution: 'Test Life', currency: 'CAD' };

  it('records a balance for a date', async () => {
    replies['POST /api/investments/accounts/acc-1/balances'] = ok({ balance: {} });
    const onSaved = vi.fn();
    render(
      <RecordBalanceModal
        account={account}
        today="2026-10-09"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );
    expect(
      screen.getByText('From your Test Life statement. Shown as the balance until the next entry.')
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Balance (CAD)'), '1234.5');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0]).toEqual({
      key: 'POST /api/investments/accounts/acc-1/balances',
      body: { date: '2026-10-09', balance: 1234.5 },
    });
  });

  it('shows the API error', async () => {
    replies['POST /api/investments/accounts/acc-1/balances'] = {
      status: 400,
      body: { error: 'Balance date cannot be in the future' },
    };
    render(
      <RecordBalanceModal
        account={account}
        today="2026-10-09"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await userEvent.type(screen.getByLabelText('Balance (CAD)'), '5');
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(await screen.findByText('Balance date cannot be in the future')).toBeInTheDocument();
  });

  it('needs a balance', async () => {
    render(
      <RecordBalanceModal
        account={account}
        today="2026-10-09"
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Record' }));
    expect(screen.getByText('Enter a balance')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('HoldingsEditorModal', () => {
  const account = { id: 'acc-v', name: 'Valued', currency: 'USD' };
  const holdings = [makeHolding({ accountId: 'acc-v', quantity: 10, priceInAccount: 110 })];
  const renderEditor = (onSaved = vi.fn()) =>
    render(
      <HoldingsEditorModal
        account={account}
        holdings={holdings}
        pricesAsOf="2026-10-08"
        onClose={vi.fn()}
        onSaved={onSaved}
      />
    );

  it('saves edited units', async () => {
    replies['PUT /api/investments/accounts/acc-v/holdings'] = ok({ holdings: [] });
    const onSaved = vi.fn();
    renderEditor(onSaved);
    expect(screen.getByText('valued daily · prices as of Oct 8 close')).toBeInTheDocument();
    const units = screen.getByLabelText('Units for AAA');
    await userEvent.clear(units);
    await userEvent.type(units, '12');
    expect(screen.getAllByText('$1,320')).toHaveLength(2); // the row and the total
    await userEvent.click(screen.getByRole('button', { name: 'Save holdings' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls().at(-1)).toEqual({
      key: 'PUT /api/investments/accounts/acc-v/holdings',
      body: { holdings: [{ securityId: 'sec-aaa', quantity: 12 }] },
    });
  });

  it('rejects non-positive units without saving', async () => {
    renderEditor();
    await userEvent.clear(screen.getByLabelText('Units for AAA'));
    await userEvent.type(screen.getByLabelText('Units for AAA'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save holdings' }));
    expect(screen.getByText('Units must be positive numbers')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('adds a security found by search', async () => {
    replies['GET /api/investments/securities/search?q=bb'] = ok({
      results: [{ symbol: 'BBB', name: 'B Fund', type: 'etf', exchange: 'NYQ' }],
    });
    replies['POST /api/investments/securities'] = ok({
      security: { id: 'sec-bbb', ticker: 'BBB', name: 'B Fund', pricing: 'feed' },
    });
    renderEditor();
    await userEvent.type(
      screen.getByPlaceholderText('+ Add security — search ticker (e.g. VTI)'),
      'bb'
    );
    await userEvent.click(await screen.findByRole('button', { name: 'BBB · B Fund · NYQ' }));
    expect(await screen.findByLabelText('Units for BBB')).toBeInTheDocument();
    expect(calls().find((c) => c.key === 'POST /api/investments/securities')?.body).toEqual({
      symbol: 'BBB',
    });
  });

  it('does not add a security twice', async () => {
    replies['GET /api/investments/securities/search?q=aa'] = ok({
      results: [{ symbol: 'AAA', name: 'Triple A Fund', type: 'etf', exchange: null }],
    });
    replies['POST /api/investments/securities'] = ok({
      security: { id: 'sec-aaa', ticker: 'AAA', name: 'Triple A Fund', pricing: 'feed' },
    });
    renderEditor();
    await userEvent.type(
      screen.getByPlaceholderText('+ Add security — search ticker (e.g. VTI)'),
      'aa'
    );
    await userEvent.click(await screen.findByRole('button', { name: 'AAA · Triple A Fund' }));
    expect(await screen.findByText('AAA is already listed')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Units for AAA')).toHaveLength(1);
  });

  it.each([
    [400, 'Unknown symbol'],
    [502, 'Price service unavailable'],
  ])('shows the API error when adding fails (%i)', async (status, message) => {
    replies['GET /api/investments/securities/search?q=zz'] = ok({
      results: [{ symbol: 'ZZZ', name: 'Zed', type: 'etf', exchange: null }],
    });
    replies['POST /api/investments/securities'] = { status, body: { error: message } };
    renderEditor();
    await userEvent.type(
      screen.getByPlaceholderText('+ Add security — search ticker (e.g. VTI)'),
      'zz'
    );
    await userEvent.click(await screen.findByRole('button', { name: 'ZZZ · Zed' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByLabelText('Units for ZZZ')).toBeNull();
  });

  it('does not add cash twice on a double click', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    global.fetch = vi.fn(async () => {
      await gate; // the POST stays in flight across both clicks
      return {
        ok: true,
        status: 200,
        json: async () => ({
          security: { id: 'sec-cash', ticker: null, name: 'USD cash', pricing: 'fixed' },
        }),
      } as Response;
    }) as unknown as typeof fetch;
    renderEditor();
    const button = screen.getByRole('button', { name: '+ Add cash' });
    await userEvent.dblClick(button);
    release();
    expect(await screen.findByLabelText('Units for Cash')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Units for Cash')).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('adds cash in the account currency', async () => {
    replies['POST /api/investments/securities'] = ok({
      security: { id: 'sec-cash', ticker: null, name: 'USD cash', pricing: 'fixed' },
    });
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: '+ Add cash' }));
    expect(await screen.findByLabelText('Units for Cash')).toBeInTheDocument();
    expect(calls()[0]).toEqual({ key: 'POST /api/investments/securities', body: { cash: 'USD' } });
  });
});

describe('SetSymbolModal', () => {
  const security = { securityId: 'sec-z', label: 'ZZZ' };

  it('points the security at a new symbol', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    const onSaved = vi.fn();
    render(<SetSymbolModal security={security} onClose={vi.fn()} onSaved={onSaved} />);
    await userEvent.type(screen.getByLabelText('Price symbol'), 'ZZZ.TO');
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()[0].body).toEqual({ priceSymbol: 'ZZZ.TO' });
  });

  it('sets a manual price, and validates both inputs', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    render(<SetSymbolModal security={security} onClose={vi.fn()} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Use symbol' }));
    expect(screen.getByText('Enter a symbol')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    expect(screen.getByText('Enter a positive price')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Or set a price per unit'), '50.73');
    await userEvent.click(screen.getByRole('button', { name: 'Set price' }));
    await waitFor(() => expect(calls()[0]?.body).toEqual({ manualPrice: 50.73 }));
  });
});
