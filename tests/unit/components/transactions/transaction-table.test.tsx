import { describe, it, expect, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionTable } from '@/components/transactions/transaction-table';
import type { Tx } from '@/components/transactions/types';

const tx = (id: string, merchant: string): Tx => ({
  id,
  date: '2026-03-04T00:00:00.000Z',
  merchant,
  amount: -42.5,
  category: { id: 'c1', name: 'Test A' },
  account: { id: 'a1', name: 'Test Card', currency: 'USD' },
  confidenceScore: 0.72,
  isTransfer: false,
  note: null,
  tags: [],
});

const t1 = tx('t1', 'Test Merchant 1');
const t2 = tx('t2', 'Test Merchant 2');
const t3 = tx('t3', 'Test Merchant 3');

function setup(props: Partial<ComponentProps<typeof TransactionTable>> = {}) {
  const onOpen = vi.fn();
  render(
    <TransactionTable
      availableTags={[]}
      baseCurrency="USD"
      compact={false}
      openId={null}
      rows={[t1, t2]}
      onOpen={onOpen}
      {...props}
    />
  );
  return { onOpen };
}

const rowFor = (merchant: string) => screen.getByText(merchant).closest('tr')!;

describe('TransactionTable', () => {
  it('rendersRowsWithAccountColumn', () => {
    setup();
    expect(screen.getByRole('columnheader', { name: 'Account' })).not.toHaveClass('hidden');
    const row = within(rowFor('Test Merchant 1'));
    expect(row.getByText('2026-03-04')).toBeInTheDocument();
    expect(row.getByText('Test A')).toBeInTheDocument();
    expect(row.getByText('Test Card')).not.toHaveClass('hidden');
    expect(screen.getByText('Test Merchant 2')).toBeInTheDocument();
  });

  it('compactHidesAccount', () => {
    setup({ compact: true });
    expect(screen.getByRole('columnheader', { name: 'Account' })).toHaveClass('hidden');
    expect(within(rowFor('Test Merchant 1')).getByText('Test Card')).toHaveClass('hidden');
  });

  it('groupsRenderHeadingsInOrder', () => {
    setup({
      groups: [
        { label: 'Before', rows: [t1] },
        { label: 'During', rows: [t2] },
        { label: 'After', rows: [t3] },
      ],
    });
    const body = screen.getAllByRole('rowgroup')[1];
    const order = within(body)
      .getAllByRole('row')
      .map((r) => r.textContent ?? '');
    expect(order).toHaveLength(6);
    ['Before', 'Test Merchant 1', 'During', 'Test Merchant 2', 'After', 'Test Merchant 3'].forEach(
      (text, i) => expect(order[i]).toContain(text)
    );
    expect(screen.getByText('Before')).toHaveClass('uppercase');
  });

  it('group headings span the visible columns', () => {
    const groups = [{ label: 'Before', rows: [t1] }];
    setup({ groups });
    expect(screen.getByText('Before')).toHaveAttribute('colspan', '6');
  });

  it('group headings skip the hidden Account column when compact', () => {
    setup({ groups: [{ label: 'Before', rows: [t1] }], compact: true });
    expect(screen.getByText('Before')).toHaveAttribute('colspan', '5');
  });

  it('clickingARowCallsOnOpen', async () => {
    const { onOpen } = setup();
    await userEvent.click(screen.getByText('Test Merchant 2'));
    expect(onOpen).toHaveBeenCalledWith('t2');
  });

  it('openRowIsMarked', () => {
    setup({ openId: 't2' });
    expect(rowFor('Test Merchant 2')).toHaveAttribute('aria-selected', 'true');
    expect(rowFor('Test Merchant 1')).not.toHaveAttribute('aria-selected');
  });

  it('in select mode a click toggles the row instead of opening it', async () => {
    const toggle = vi.fn();
    const { onOpen } = setup({ select: { active: true, selected: new Set(), toggle } });
    await userEvent.click(screen.getByText('Test Merchant 1'));
    expect(toggle).toHaveBeenCalledWith('t1');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('with select inactive a click opens the row', async () => {
    const toggle = vi.fn();
    const { onOpen } = setup({ select: { active: false, selected: new Set(), toggle } });
    await userEvent.click(screen.getByText('Test Merchant 1'));
    expect(onOpen).toHaveBeenCalledWith('t1');
    expect(toggle).not.toHaveBeenCalled();
  });

  it('annotateRendersUnderTheMerchantOfEachRow', () => {
    setup({ annotate: (t) => <span>{`note for ${t.id}`}</span> });
    expect(within(rowFor('Test Merchant 1')).getByText('note for t1')).toBeInTheDocument();
    expect(within(rowFor('Test Merchant 2')).getByText('note for t2')).toBeInTheDocument();
  });
});
