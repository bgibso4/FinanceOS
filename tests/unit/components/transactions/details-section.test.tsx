import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DetailsSection } from '@/components/transactions/details-section';
import type { Category, Tx } from '@/components/transactions/types';

const tx: Tx = {
  id: 't1',
  date: '2026-03-04T00:00:00.000Z',
  merchant: 'Test Merchant',
  amount: -42.5,
  category: { id: 'c1', name: 'Groceries' },
  account: { id: 'a1', name: 'Test Card' },
  confidenceScore: 1,
  isTransfer: false,
  note: null,
  tags: [],
};

const categories: Category[] = [
  { id: 'g1', name: 'Food', type: 'expense', parentId: null },
  { id: 'c1', name: 'Groceries', type: 'expense', parentId: 'g1' },
  { id: 'c2', name: 'Dining', type: 'expense', parentId: 'g1' },
];

const HINT_ONE = 'Money moving between your own accounts, like a card payment.';
const HINT_TWO = "Transfers are left out of spending totals, so the category isn't counted.";

function setup(overrides: Partial<Tx> = {}, props: Record<string, unknown> = {}) {
  const onEdit = vi.fn();
  render(
    <DetailsSection
      availableTags={[]}
      categories={categories}
      tx={{ ...tx, ...overrides }}
      onCreateTag={vi.fn()}
      onEdit={onEdit}
      {...props}
    />
  );
  return onEdit;
}

describe('DetailsSection', () => {
  it('transfer switch saves immediately', async () => {
    const onEdit = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(onEdit).toHaveBeenCalledWith({ isTransfer: true }, { immediate: true });
  });

  it('clicking the selected segment sends nothing', async () => {
    const onEdit = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Transaction' }));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('date edits are debounced so a hand-typed year is not saved per keystroke', () => {
    const onEdit = setup();
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-04-05' } });
    expect(onEdit.mock.calls.at(-1)).toEqual([{ date: '2026-04-05' }]);
  });

  it('typing the merchant edits without immediate', async () => {
    const onEdit = setup();
    await userEvent.type(screen.getByLabelText('Merchant'), 'X');
    expect(onEdit.mock.calls.at(-1)).toEqual([{ merchant: 'Test MerchantX' }]);
  });

  it('amount input keeps raw text', async () => {
    const onEdit = setup();
    const amount = screen.getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '-12.');
    expect(amount).toHaveValue('-12.');
    expect(onEdit.mock.calls.at(-1)).toEqual([{ amount: -12 }]);
  });

  it('split part amount is read only with hint', () => {
    setup({ parentTransactionId: 'p1' });
    expect(screen.getByLabelText('Amount')).toHaveAttribute('readonly');
    expect(screen.getByText('Unsplit to change amounts')).toBeInTheDocument();
  });

  it('category change saves immediately', async () => {
    const onEdit = setup();
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'c2');
    expect(onEdit).toHaveBeenCalledWith({ categoryId: 'c2' }, { immediate: true });
  });

  it('category select shows the new choice while the tx prop is unchanged', async () => {
    setup();
    const select = screen.getByLabelText('Category');
    await userEvent.selectOptions(select, 'c2');
    expect(select).toHaveValue('c2');
  });

  it('formats the date for the date input', () => {
    setup();
    expect(screen.getByLabelText('Date')).toHaveValue('2026-03-04');
  });

  it('shows transfer hints only for transfers', () => {
    const { unmount } = render(
      <DetailsSection
        availableTags={[]}
        categories={categories}
        tx={tx}
        onCreateTag={vi.fn()}
        onEdit={vi.fn()}
      />
    );
    expect(screen.queryByText(HINT_ONE)).not.toBeInTheDocument();
    expect(screen.queryByText(HINT_TWO)).not.toBeInTheDocument();
    unmount();
    setup({ isTransfer: true });
    expect(screen.getByText(HINT_ONE)).toBeInTheDocument();
    expect(screen.getByText(HINT_TWO)).toBeInTheDocument();
  });

  it('no split button without onStartSplit', async () => {
    setup();
    expect(screen.queryByRole('button', { name: /Split/ })).not.toBeInTheDocument();
  });

  it('split button calls onStartSplit and renders splitSlot', async () => {
    const onStartSplit = vi.fn();
    setup({}, { onStartSplit, splitSlot: <div>slot</div> });
    await userEvent.click(screen.getByRole('button', { name: /Split/ }));
    expect(onStartSplit).toHaveBeenCalled();
    expect(screen.getByText('slot')).toBeInTheDocument();
  });
});
