import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PastBalancesPaste } from '@/components/investments/past-balances-paste';
import { BalanceSource } from '@/lib/investments/codes';

const url = '/api/investments/accounts/acc-1/balances';
const account = { id: 'acc-1', currency: 'USD', balanceSource: BalanceSource.Provider };
const view = {
  balances: [
    { id: 'b1', date: '2025-06-30', balance: 50 },
    { id: 'b2', date: '2025-09-30', balance: 70 },
  ],
  enterBefore: '2026-03-03',
  today: '2026-10-09',
};
const SEVEN = [
  '2025-03-31\t10',
  '2025-06-30\t55',
  '2025-09-30\t70',
  '2026-03-03\t1',
  '2026-12-01\t1',
  '2025-03-31\t11',
  'nope',
].join('\n');

let reply: { status: number; body: unknown };
beforeEach(() => {
  reply = { status: 200, body: { saved: 2, skipped: [] } };
  global.fetch = vi.fn(
    async () =>
      ({ ok: reply.status < 400, status: reply.status, json: async () => reply.body }) as Response
  ) as unknown as typeof fetch;
});
const calls = () =>
  vi.mocked(global.fetch).mock.calls.map(([u, init]) => ({
    key: `${init?.method ?? 'GET'} ${String(u)}`,
    body: init?.body ? JSON.parse(init.body as string) : undefined,
  }));

function setup(onSaved = vi.fn()) {
  render(<PastBalancesPaste account={account} view={view} onCancel={vi.fn()} onSaved={onSaved} />);
  const textarea = screen.getByLabelText('Paste past balances');
  return { textarea, onSaved };
}
const paste = (el: HTMLElement, text: string) => fireEvent.change(el, { target: { value: text } });

describe('PastBalancesPaste', () => {
  it('previews each line with its status and counts', () => {
    const { textarea } = setup();
    expect(
      screen.getByText(
        'One per line: a date and a balance, separated by a tab or comma. Dates like 2025-03-31 or 3/31/2025.'
      )
    ).toBeInTheDocument();
    paste(textarea, SEVEN);
    expect(screen.getByText('7 lines read · 2 to save · 5 skipped')).toBeInTheDocument();
    for (const t of [
      'New',
      'Replaces $50.00',
      'Already entered',
      'Skipped: synced from 2026-03-03',
      'In the future',
      'Date repeated',
      'Can’t read this line',
    ])
      expect(screen.getByText(t)).toBeInTheDocument();
  });

  it('disables Save when nothing would be saved', () => {
    const { textarea } = setup();
    paste(textarea, 'nope');
    expect(screen.getByRole('button', { name: 'Save 0 balances' })).toBeDisabled();
  });

  it('saves only the savable lines', async () => {
    const { textarea, onSaved } = setup();
    paste(textarea, SEVEN);
    await userEvent.click(screen.getByRole('button', { name: 'Save 2 balances' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ saved: 2, skipped: [] }));
    expect(calls().at(-1)).toEqual({
      key: `POST ${url}`,
      body: {
        balances: [
          { date: '2025-03-31', balance: 10 },
          { date: '2025-06-30', balance: 55 },
        ],
      },
    });
  });

  it('names one balance in the singular', () => {
    const { textarea } = setup();
    paste(textarea, '2025-03-31,10');
    expect(screen.getByRole('button', { name: 'Save 1 balance' })).toBeEnabled();
  });

  it('shows a save error', async () => {
    reply = { status: 400, body: { error: 'Nope' } };
    const { textarea, onSaved } = setup();
    paste(textarea, '2025-03-31,10');
    await userEvent.click(screen.getByRole('button', { name: 'Save 1 balance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Nope');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
