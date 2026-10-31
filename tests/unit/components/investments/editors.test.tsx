import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RecordBalanceModal } from '@/components/investments/record-balance-modal';
import { HoldingsEditorModal } from '@/components/investments/holdings-editor-modal';
import { PriceWindow } from '@/components/investments/price-window';
import { makeHolding, makeSecurityItem } from '../../../helpers/investment-overview';
import type { SecurityListItem } from '@/lib/investments/security-list';
import { Pricing } from '@/lib/investments/codes';

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
      security: { id: 'sec-bbb', ticker: 'BBB', name: 'B Fund', pricing: Pricing.Market },
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
      security: { id: 'sec-aaa', ticker: 'AAA', name: 'Triple A Fund', pricing: Pricing.Market },
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
          security: { id: 'sec-cash', ticker: null, name: 'USD cash', pricing: Pricing.Fixed },
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
      security: { id: 'sec-cash', ticker: null, name: 'USD cash', pricing: Pricing.Fixed },
    });
    renderEditor();
    await userEvent.click(screen.getByRole('button', { name: '+ Add cash' }));
    expect(await screen.findByLabelText('Units for Cash')).toBeInTheDocument();
    expect(calls()[0]).toEqual({ key: 'POST /api/investments/securities', body: { cash: 'USD' } });
  });
});

describe('PriceWindow', () => {
  const hint = 'Use test symbols.';
  const market = makeSecurityItem({
    id: 'sec-z',
    label: 'ZZZ',
    priceSymbol: 'ZZZ',
    latest: { price: 11, date: '2026-10-08' },
  });
  const open = (security: SecurityListItem, onSaved = vi.fn()) =>
    render(<PriceWindow hint={hint} security={security} onClose={vi.fn()} onSaved={onSaved} />);
  const currently = () => screen.getByText('Currently').parentElement;

  it('titles the window and says how the security is priced now', () => {
    open(market);
    expect(screen.getByRole('heading', { name: 'How ZZZ is priced' })).toBeInTheDocument();
    expect(currently()).toHaveTextContent('Currently Market · ZZZ · $11.00 on Oct 8');
  });

  it('leaves out the price when there is none, and the date when the source has none', () => {
    const { unmount } = open(makeSecurityItem({ pricing: Pricing.None, latest: null }));
    expect(currently()).toHaveTextContent(/^Currently No price source$/);
    unmount();
    open(
      makeSecurityItem({ pricing: Pricing.Fixed, fixedPrice: 2, latest: { price: 2, date: null } })
    );
    expect(currently()).toHaveTextContent(/^Currently Fixed · \$2\.00$/);
  });

  it('names a manual price once, with the day it was entered', () => {
    open(
      makeSecurityItem({ pricing: Pricing.Manual, latest: { price: 64.3, date: '2026-09-30' } })
    );
    expect(currently()).toHaveTextContent(/^Currently Manual · \$64\.30 on Sep 30$/);
  });

  const radio = (name: string) => screen.getByRole('radio', { name });
  const save = () => screen.getByRole('button', { name: 'Save' });

  it('saves a new symbol once, under the provider’s symbol hint', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    const onSaved = vi.fn();
    open(market, onSaved);
    expect(radio('Market symbol')).toBeChecked();
    expect(screen.getByLabelText('Symbol')).toHaveValue('ZZZ');
    expect(save()).toBeDisabled();
    expect(screen.getByText('Use test symbols.')).toBeInTheDocument();
    expect(screen.queryByText(/Yahoo/)).toBeNull();
    await userEvent.type(screen.getByLabelText('Symbol'), '.TO');
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls()).toHaveLength(1);
    expect(calls()[0].body).toEqual({ priceSymbol: 'ZZZ.TO' });
  });

  it('sets a manual price, and validates it', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    open(market);
    await userEvent.click(radio('Manual price'));
    expect(screen.getByLabelText('Price per unit')).toBeInTheDocument();
    await userEvent.click(save());
    expect(screen.getByText('Enter a positive price')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Price per unit'), '50.73');
    await userEvent.click(save());
    await waitFor(() => expect(calls()[0]?.body).toEqual({ manualPrice: 50.73 }));
  });

  it('needs a symbol', async () => {
    open(market);
    await userEvent.clear(screen.getByLabelText('Symbol'));
    await userEvent.click(save());
    expect(screen.getByText('Enter a symbol')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('prefills a manual price', () => {
    open(
      makeSecurityItem({ pricing: Pricing.Manual, latest: { price: 64.3, date: '2026-09-30' } })
    );
    expect(radio('Manual price')).toBeChecked();
    expect(screen.getByLabelText('Price per unit')).toHaveValue('64.3');
    expect(save()).toBeDisabled();
  });

  it('offers no institution price for a security its institution has not priced', () => {
    open(market);
    expect(screen.queryByRole('radio', { name: 'Institution price' })).toBeNull();
  });

  it('lets a market security with an institution price switch back to it', async () => {
    replies['PATCH /api/investments/securities/sec-z'] = ok({ security: {} });
    const held = { ...market, hasInstitutionPrice: true };
    const { unmount } = open(held);
    await userEvent.click(radio('Institution price'));
    expect(save()).toBeEnabled();
    await userEvent.click(save());
    await waitFor(() => expect(calls()[0]?.body).toEqual({ proxySymbol: null }));
    unmount();

    open(held);
    await userEvent.click(radio('Institution price'));
    await userEvent.type(screen.getByLabelText(/Follow a similar fund/), 'FOLW');
    await userEvent.click(save());
    await waitFor(() => expect(calls()[1]?.body).toEqual({ proxySymbol: 'FOLW' }));
  });

  describe('for a fund priced by its institution', () => {
    const fund = makeSecurityItem({
      id: 'sec-p',
      label: 'PLAN',
      name: 'Example Plan Trust',
      pricing: Pricing.Institution,
      priceSymbol: null,
      proxySymbol: 'PRXY',
      latest: { price: 28.34, date: '2026-10-10' },
    });

    it('shows the followed fund, and stops following when it is cleared', async () => {
      replies['PATCH /api/investments/securities/sec-p'] = ok({ security: {} });
      open(fund);
      expect(currently()).toHaveTextContent(
        'Currently Institution · follows PRXY · $28.34 on Oct 10'
      );
      expect(radio('Institution price')).toBeChecked();
      expect(screen.getByText(/stays the real price/)).toHaveTextContent(
        'The institution’s price stays the real price. On days without one, this holding moves with the fund you pick.'
      );
      const field = screen.getByLabelText(/Follow a similar fund/);
      expect(field).toHaveValue('PRXY');
      expect(save()).toBeDisabled();
      await userEvent.clear(field);
      await userEvent.click(save());
      await waitFor(() => expect(calls()[0]?.body).toEqual({ proxySymbol: null }));
    });
  });

  it('selects nothing for a security with no price source', () => {
    open(makeSecurityItem({ pricing: Pricing.None, latest: null }));
    expect(screen.queryAllByRole('radio', { checked: true })).toHaveLength(0);
    expect(save()).toBeDisabled();
  });

  it('describes each source, and marks the fund to follow optional', async () => {
    open({ ...market, hasInstitutionPrice: true });
    expect(radio('Institution price')).toHaveAccessibleDescription(
      'The price your institution reports for it.'
    );
    expect(radio('Market symbol')).toHaveAccessibleDescription(
      'Daily closes from the market data provider.'
    );
    expect(radio('Manual price')).toHaveAccessibleDescription(
      'A price per unit you enter. It stays until you change it.'
    );
    const group = screen.getByRole('radiogroup', { name: 'Price it with' });
    expect(group).toHaveAttribute('aria-labelledby');
    expect(group).not.toHaveAttribute('aria-label');
    await userEvent.click(radio('Institution price'));
    expect(screen.getByText('· optional')).toBeInTheDocument();
  });

  it("focuses an option's field on a click on its head, not on arrow keys", async () => {
    open(market);
    await userEvent.click(screen.getByText('Manual price'));
    expect(screen.getByLabelText('Price per unit')).toHaveFocus();
    radio('Manual price').focus();
    await userEvent.keyboard('{ArrowUp}');
    expect(radio('Market symbol')).toBeChecked();
    expect(radio('Market symbol')).toHaveFocus();
  });

  it('announces an error', async () => {
    open(market);
    await userEvent.clear(screen.getByLabelText('Symbol'));
    await userEvent.click(save());
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a symbol');
  });

  it('cannot be cancelled while saving', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    global.fetch = vi.fn(async () => {
      await gate; // the PATCH stays in flight
      return { ok: true, status: 200, json: async () => ({ security: {} }) } as Response;
    }) as unknown as typeof fetch;
    const onSaved = vi.fn();
    open(market, onSaved);
    await userEvent.type(screen.getByLabelText('Symbol'), '.TO');
    await userEvent.click(save());
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('cancels without sending anything', async () => {
    const onClose = vi.fn();
    render(<PriceWindow hint={hint} security={market} onClose={onClose} onSaved={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
