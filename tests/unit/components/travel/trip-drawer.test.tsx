import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/cloud-sync', () => ({ triggerSync: vi.fn() }));

import { triggerSync } from '@/lib/cloud-sync';
import { TripDrawer } from '@/components/travel/trip-drawer';
import type { Suggestion, TripRecord } from '@/lib/travel/types';

const trip: TripRecord = {
  id: 'trip1',
  name: 'Test Lisbon',
  startDate: '2026-05-10',
  endDate: '2026-05-17',
};

const sug = (
  id: string,
  group: Suggestion['group'],
  preTicked: boolean,
  merchant = `Test ${id}`
): Suggestion =>
  ({
    group,
    preTicked,
    reason: 'test reason',
    tx: {
      id,
      merchant,
      amount: -25,
      date: new Date('2026-05-12T00:00:00.000Z'),
      category: { id: 'c1', name: 'Test Cat' },
      account: { id: 'a1', name: 'Test Card', currency: 'USD' },
    },
  }) as unknown as Suggestion;

const suggestions = [
  sug('b1', 'before', true),
  sug('d1', 'during', true),
  sug('o1', 'other', false),
  sug('a1', 'after', true),
];

type Call = { url: string; method: string; body: unknown };
let calls: Call[];

function mockFetch(overrides: Record<string, unknown> = {}, failing: string[] = []) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const key = `${method} ${url}`;
      if (failing.includes(key))
        return { ok: false, status: 500, json: async () => ({ error: 'Test boom' }) };
      const body =
        key in overrides
          ? overrides[key]
          : method === 'POST' && url === '/api/travel/trips'
            ? trip
            : url.endsWith('/suggestions') && method === 'GET'
              ? { suggestions }
              : method === 'DELETE'
                ? { success: true }
                : trip;
      return { ok: true, status: 200, json: async () => body };
    })
  );
}

function setup(mode: Parameters<typeof TripDrawer>[0]['mode']) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onDeleted = vi.fn();
  render(
    <TripDrawer
      baseCurrency="USD"
      mode={mode}
      onClose={onClose}
      onDeleted={onDeleted}
      onSaved={onSaved}
    />
  );
  return { onClose, onSaved, onDeleted };
}

async function fillAndNext(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Name'), 'Test Lisbon');
  await user.type(screen.getByLabelText('Leave'), '2026-05-10');
  await user.type(screen.getByLabelText('Return'), '2026-05-17');
  await user.click(screen.getByRole('button', { name: 'Next: find transactions' }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch();
});

describe('TripDrawer', () => {
  it('newTripRequiresNameAndDates', async () => {
    const user = userEvent.setup();
    setup({ kind: 'new' });
    await user.click(screen.getByRole('button', { name: 'Next: find transactions' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it('nextCreatesTripThenShowsSuggestions', async () => {
    const user = userEvent.setup();
    setup({ kind: 'new' });
    await fillAndNext(user);
    expect(await screen.findByText('Test b1')).toBeTruthy();
    expect(calls[0]).toEqual({
      url: '/api/travel/trips',
      method: 'POST',
      body: { name: 'Test Lisbon', startDate: '2026-05-10', endDate: '2026-05-17' },
    });
    expect(calls[1].url).toBe('/api/travel/trips/trip1/suggestions');
    expect(screen.getByText('Other spending during the trip')).toBeTruthy();
  });

  it('preTickedFollowGroups', async () => {
    const user = userEvent.setup();
    setup({ kind: 'new' });
    await fillAndNext(user);
    await screen.findByText('Test b1');
    const checked = (merchant: string) =>
      (screen.getByText(merchant).closest('label')!.querySelector('input') as HTMLInputElement)
        .checked;
    expect([
      checked('Test b1'),
      checked('Test d1'),
      checked('Test o1'),
      checked('Test a1'),
    ]).toEqual([true, true, false, true]);
  });

  it('buttonCountsTicked', async () => {
    const user = userEvent.setup();
    setup({ kind: 'review', trip });
    await screen.findByRole('button', { name: 'Add 3 transactions' });
    await user.click(screen.getByText('Test o1'));
    expect(screen.getByRole('button', { name: 'Add 4 transactions' })).toBeTruthy();
    await user.click(screen.getByText('Test b1'));
    await user.click(screen.getByText('Test d1'));
    await user.click(screen.getByText('Test a1'));
    await user.click(screen.getByText('Test o1'));
    await user.click(screen.getByText('Test o1'));
    expect(screen.getByRole('button', { name: 'Add 1 transaction' })).toBeTruthy();
  });

  it('addPostsTickedAndDismissesUnticked', async () => {
    const user = userEvent.setup();
    const { onSaved } = setup({ kind: 'review', trip });
    await user.click(await screen.findByRole('button', { name: 'Add 3 transactions' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('trip1'));
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.url).toBe('/api/travel/trips/trip1/suggestions');
    expect(post.body).toEqual({ add: ['b1', 'd1', 'a1'], dismiss: ['o1'] });
    expect(triggerSync).toHaveBeenCalled();
  });

  it('doneWithNothingTickedDismissesAll', async () => {
    const user = userEvent.setup();
    const { onSaved } = setup({ kind: 'review', trip });
    await screen.findByText('Test b1');
    for (const m of ['Test b1', 'Test d1', 'Test a1']) await user.click(screen.getByText(m));
    const done = screen.getByRole('button', { name: 'Done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(false);
    await user.click(done);
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls.find((c) => c.method === 'POST')!.body).toEqual({
      add: [],
      dismiss: ['b1', 'd1', 'o1', 'a1'],
    });
  });

  it('editSavesAndDeleteConfirms', async () => {
    const user = userEvent.setup();
    const { onSaved, onDeleted } = setup({ kind: 'edit', trip });
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Test Porto');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('trip1'));
    expect(calls[0]).toEqual({
      url: '/api/travel/trips/trip1',
      method: 'PATCH',
      body: { name: 'Test Porto', startDate: '2026-05-10', endDate: '2026-05-17' },
    });

    await user.click(screen.getByRole('button', { name: 'Delete trip' }));
    expect(screen.getByText('Delete this trip? Its transactions are kept.')).toBeTruthy();
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
    expect(calls.at(-1)).toMatchObject({ url: '/api/travel/trips/trip1', method: 'DELETE' });
  });

  it('reviewOpensStraightOnSuggestions', async () => {
    setup({ kind: 'review', trip });
    expect(await screen.findByText('Test b1')).toBeTruthy();
    expect(screen.queryByLabelText('Name')).toBeNull();
    expect(calls).toEqual([
      { url: '/api/travel/trips/trip1/suggestions', method: 'GET', body: undefined },
    ]);
  });

  it('showsShortDatesAndForeignCurrencyAmounts', async () => {
    const foreign = sug('f1', 'during', true, 'Test Foreign');
    foreign.tx.account = { id: 'a2', name: 'Test CAD', currency: 'CAD' } as never;
    mockFetch({ 'GET /api/travel/trips/trip1/suggestions': { suggestions: [foreign] } });
    setup({ kind: 'review', trip });
    const row = (await screen.findByText('Test Foreign')).closest('label')!;
    expect(row.textContent).toContain('May 12 · Test Cat · test reason');
    expect(row.textContent).toMatch(/CA\$|CAD/);
  });

  it('failedPostKeepsTicks', async () => {
    mockFetch({}, ['POST /api/travel/trips/trip1/suggestions']);
    const user = userEvent.setup();
    const { onSaved } = setup({ kind: 'review', trip });
    await screen.findByText('Test b1');
    await user.click(screen.getByText('Test o1'));
    await user.click(screen.getByRole('button', { name: 'Add 4 transactions' }));
    expect((await screen.findAllByText('Test boom')).length).toBeGreaterThan(0);
    expect(onSaved).not.toHaveBeenCalled();
    expect(triggerSync).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Add 4 transactions' })).toBeTruthy();
  });

  it('failedLoadShowsRetryAndDoesNotSubmit', async () => {
    mockFetch({}, ['GET /api/travel/trips/trip1/suggestions']);
    const user = userEvent.setup();
    const { onSaved } = setup({ kind: 'review', trip });
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
    mockFetch();
    await user.click(retry);
    expect(await screen.findByText('Test b1')).toBeTruthy();
    expect(onSaved).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('emptyLoadSaysNothingToReviewAndDoneJustCloses', async () => {
    mockFetch({ 'GET /api/travel/trips/trip1/suggestions': { suggestions: [] } });
    const user = userEvent.setup();
    const { onClose, onSaved } = setup({ kind: 'review', trip });
    expect(await screen.findByText('Nothing to review')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('failedSaveShowsError', async () => {
    mockFetch({}, ['PATCH /api/travel/trips/trip1']);
    const user = userEvent.setup();
    const { onSaved } = setup({ kind: 'edit', trip });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Test boom');
    expect(onSaved).not.toHaveBeenCalled();
  });
});
