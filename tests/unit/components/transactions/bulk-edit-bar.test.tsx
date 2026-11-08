import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BulkEditBar } from '@/components/transactions/bulk-edit-bar';
import type { Category, TripOption, Tx } from '@/components/transactions/types';

const tx = (id: string, tags: string[] = []): Tx => ({
  id,
  date: '2026-03-04T00:00:00.000Z',
  merchant: `Merchant ${id}`,
  amount: -5,
  confidenceScore: 1,
  isTransfer: false,
  tags,
});
const rows = [tx('a', ['x']), tx('b'), tx('c', ['x', 'y'])];
const categories: Category[] = [
  { id: 'grp', name: 'Food', type: 'expense' },
  { id: 'cat1', name: 'Dining', type: 'expense', parentId: 'grp' },
];
const trips: TripOption[] = [{ id: 'trip1', name: 'Lisbon', startDate: '2026-03-01' }];
const tags = [
  { id: 't1', name: 'x', color: '#000' },
  { id: 't2', name: 'y', color: '#000' },
];

const fetchMock = vi.fn();
const calls = () =>
  fetchMock.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body as string) }));

function setup(selectedIds = ['a', 'b']) {
  const props = {
    selected: new Set(selectedIds),
    rows,
    categories,
    availableTags: tags,
    trips,
    onSelectAll: vi.fn(),
    onClear: vi.fn(),
    onDone: vi.fn(),
    onExit: vi.fn(),
  };
  render(<BulkEditBar {...props} />);
  return props;
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal('fetch', fetchMock);
});

describe('BulkEditBar', () => {
  it('setCategoryPostsSelectedIds', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(screen.getByLabelText('Set category'), 'cat1');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(calls()).toEqual([
      {
        url: '/api/transactions/bulk',
        body: { action: 'update', transactionIds: ['a', 'b'], data: { categoryId: 'cat1' } },
      },
    ]);
    expect(props.onClear).toHaveBeenCalled();
  });

  it('setTripPostsTripId', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.selectOptions(screen.getByLabelText('Set trip'), 'trip1');
    await user.click(screen.getByRole('button', { name: 'Apply Trip' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(calls()[0].body).toEqual({
      action: 'update',
      transactionIds: ['a', 'b'],
      data: { tripId: 'trip1' },
    });
  });

  it('tagAddKeepsExistingTags', async () => {
    const user = userEvent.setup();
    const props = setup(['a', 'b', 'c']);
    await user.selectOptions(screen.getByLabelText('Tag'), 'y');
    await user.click(screen.getByRole('button', { name: 'Apply Tag' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    const byIds = Object.fromEntries(
      calls().map((c) => [c.body.transactionIds.join(','), c.body.data.tags])
    );
    // a gains y beside its x, c already has both, b had none.
    expect(byIds).toEqual({ 'a,c': ['x', 'y'], b: ['y'] });
  });

  it('deleteAsksFirst', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const props = setup();

    confirmSpy.mockReturnValueOnce(false);
    await user.click(screen.getByRole('button', { name: 'Delete (2)' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(props.onDone).not.toHaveBeenCalled();

    confirmSpy.mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Delete (2)' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(calls()[0].body).toEqual({ action: 'delete', transactionIds: ['a', 'b'] });
    confirmSpy.mockRestore();
  });

  it('failedRequestShowsTheErrorAndKeepsTheSelection', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Trip not found' }),
    });
    const props = setup();
    await user.selectOptions(screen.getByLabelText('Set trip'), 'trip1');
    await user.click(screen.getByRole('button', { name: 'Apply Trip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Trip not found');
    expect(props.onClear).not.toHaveBeenCalled();
    expect(props.onDone).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Set trip')).toHaveValue('trip1');

    await user.click(screen.getByRole('button', { name: 'Apply Trip' }));
    await waitFor(() => expect(props.onDone).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
