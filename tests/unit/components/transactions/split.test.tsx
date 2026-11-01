import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SplitEditor } from '@/components/transactions/split-editor';
import { SplitSummary } from '@/components/transactions/split-summary';
import type { Category, Tx } from '@/components/transactions/types';
import { triggerSync } from '@/lib/cloud-sync';

vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

const tx: Tx = {
  id: 't1',
  date: '2026-03-04T00:00:00.000Z',
  merchant: 'Test Merchant',
  amount: -100,
  category: { id: 'c1', name: 'Test A' },
  confidenceScore: 1,
  isTransfer: false,
};

const categories: Category[] = [
  { id: 'g1', name: 'Group', type: 'expense', parentId: null },
  { id: 'c1', name: 'Test A', type: 'expense', parentId: 'g1' },
  { id: 'c2', name: 'Test B', type: 'expense', parentId: 'g1' },
];

const amountInput = (n: number) => screen.getByLabelText(`Part ${n} amount`);
const setAmount = async (n: number, v: string) => {
  await userEvent.clear(amountInput(n));
  if (v) await userEvent.type(amountInput(n), v);
};

function setup() {
  const onSaved = vi.fn();
  render(<SplitEditor categories={categories} tx={tx} onCancel={vi.fn()} onSaved={onSaved} />);
  return onSaved;
}

describe('SplitEditor', () => {
  beforeEach(() => {
    vi.mocked(triggerSync).mockClear();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ parts: [{ id: 'p1' }, { id: 'p2' }] }),
    }) as unknown as typeof fetch;
  });

  it('starts with the full amount in row 1 and Save disabled while row 2 is empty', () => {
    setup();
    expect(amountInput(1)).toHaveValue('100.00');
    expect(amountInput(2)).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled();
  });

  it('shows left to assign', async () => {
    setup();
    await setAmount(1, '60');
    await setAmount(2, '30');
    expect(screen.getByText('$10.00 left to assign')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save split' })).toBeDisabled();
  });

  it('shows too much', async () => {
    setup();
    await setAmount(1, '60');
    await setAmount(2, '50');
    expect(screen.getByText('$10.00 too much')).toBeInTheDocument();
  });

  it('posts signed parts', async () => {
    const onSaved = setup();
    await setAmount(1, '60');
    await setAmount(2, '40');
    await userEvent.selectOptions(screen.getByLabelText('Part 2 category'), 'c2');
    expect(screen.getByText('Adds up to −$100.00 ✓')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save split' }));
    const body = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    );
    expect(body).toEqual({
      transactionId: 't1',
      parts: [
        { amount: -60, categoryId: 'c1', note: null },
        { amount: -40, categoryId: 'c2', note: null },
      ],
    });
    expect(onSaved).toHaveBeenCalledWith(['p1', 'p2']);
    expect(triggerSync).toHaveBeenCalledTimes(1);
  });

  it('cannot remove below two rows', async () => {
    setup();
    expect(screen.getByRole('button', { name: 'Remove part 1' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a part' }));
    const remove = screen.getByRole('button', { name: 'Remove part 3' });
    expect(remove).toBeEnabled();
    await userEvent.click(remove);
    expect(screen.getByRole('button', { name: 'Remove part 1' })).toBeDisabled();
  });
});

describe('SplitSummary', () => {
  const part: Tx = {
    ...tx,
    id: 'p1',
    amount: -60,
    parentTransactionId: 'orig',
    parentTransaction: {
      id: 'orig',
      amount: -100,
      merchant: 'Test Merchant',
      splitParts: [
        {
          id: 'p1',
          amount: -60,
          categoryId: 'c1',
          note: null,
          category: { id: 'c1', name: 'Test A' },
        },
        { id: 'p2', amount: -40, categoryId: null, note: 'extra', category: null },
      ],
    },
  };

  it('emphasises this part and confirms unsplit', async () => {
    const onUnsplit = vi.fn().mockResolvedValue(undefined);
    render(<SplitSummary tx={part} onUnsplit={onUnsplit} />);
    expect(screen.getByText('Part of a split · −$100.00')).toBeInTheDocument();
    expect(screen.getByText('Test A').closest('li')).toHaveClass('font-semibold');
    expect(screen.getByText('Uncategorized · extra').closest('li')).not.toHaveClass(
      'font-semibold'
    );

    await userEvent.click(screen.getByRole('button', { name: 'Unsplit · restore the original' }));
    expect(screen.getByText('Remove the parts and restore the original?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(onUnsplit).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Unsplit · restore the original' }));
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit' }));
    expect(onUnsplit).toHaveBeenCalledTimes(1);
  });

  const confirm = async () => {
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit · restore the original' }));
  };

  it('shows the error when unsplit fails', async () => {
    const onUnsplit = vi.fn().mockRejectedValue(new Error('Test failure'));
    render(<SplitSummary tx={part} onUnsplit={onUnsplit} />);
    await confirm();
    await userEvent.click(screen.getByRole('button', { name: 'Unsplit' }));
    expect(await screen.findByText('Test failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsplit' })).toBeEnabled();
  });

  it('disables Keep and Unsplit while unsplitting', async () => {
    const onUnsplit = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<SplitSummary tx={part} onUnsplit={onUnsplit} />);
    await confirm();
    const unsplit = screen.getByRole('button', { name: 'Unsplit' });
    await userEvent.click(unsplit);
    expect(unsplit).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Keep' })).toBeDisabled();
    await userEvent.click(unsplit);
    expect(onUnsplit).toHaveBeenCalledTimes(1);
  });
});
