import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useNewTransactionForm } from '@/components/transactions/new-transaction-form';
import { sendJson } from '@/lib/send-json';
import { triggerSync } from '@/lib/cloud-sync';

vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));
vi.mock('@/lib/send-json', async (orig) => ({
  ...(await orig<typeof import('@/lib/send-json')>()),
  sendJson: vi.fn(),
}));

type Props = Parameters<typeof useNewTransactionForm>[0];

function H(p: Props) {
  const { body, footer } = useNewTransactionForm(p);
  return (
    <>
      {body}
      {footer}
    </>
  );
}

function setup() {
  const onCancel = vi.fn();
  const onCreated = vi.fn();
  render(
    <H
      accounts={[{ id: 'a1', name: 'Test Card' }]}
      availableTags={[]}
      categories={[]}
      onCancel={onCancel}
      onCreateTag={vi.fn()}
      onCreated={onCreated}
    />
  );
  return { onCancel, onCreated };
}

const REQUIRED = 'Choose an account, and enter a merchant and amount.';

describe('useNewTransactionForm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires account, merchant and amount', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('heads the body card Details', () => {
    setup();
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
  });

  it('rejects a non-numeric amount', async () => {
    setup();
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a1');
    await userEvent.type(screen.getByLabelText('Amount'), 'abc');
    await userEvent.type(screen.getByLabelText('Merchant'), 'Test Shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(screen.getByText(REQUIRED)).toBeInTheDocument();
    expect(sendJson).not.toHaveBeenCalled();
  });

  it('posts the new transaction', async () => {
    vi.mocked(sendJson).mockResolvedValue({});
    const { onCreated } = setup();
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a1');
    await userEvent.type(screen.getByLabelText('Amount'), '-12.5');
    await userEvent.type(screen.getByLabelText('Merchant'), 'Test Shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(sendJson).toHaveBeenCalledWith('/api/transactions', 'POST', {
      date: new Date().toISOString().split('T')[0],
      amount: -12.5,
      merchant: 'Test Shop',
      accountId: 'a1',
      categoryId: null,
      note: null,
    });
    expect(triggerSync).toHaveBeenCalled();
  });

  it('shows the error when the post fails', async () => {
    vi.mocked(sendJson).mockRejectedValue(new Error('Nope'));
    const { onCreated } = setup();
    await userEvent.selectOptions(screen.getByLabelText('Account'), 'a1');
    await userEvent.type(screen.getByLabelText('Amount'), '5');
    await userEvent.type(screen.getByLabelText('Merchant'), 'Test Shop');
    await userEvent.click(screen.getByRole('button', { name: 'Add transaction' }));
    expect(await screen.findByText('Nope')).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('cancel calls onCancel', async () => {
    const { onCancel } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
