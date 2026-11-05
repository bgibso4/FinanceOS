import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTransactionDrawer } from '@/components/transactions/use-transaction-drawer';
import type { Category, TripOption, Tx } from '@/components/transactions/types';

const tx: Tx = {
  id: 't1',
  date: '2026-03-04T00:00:00.000Z',
  merchant: 'Test Merchant',
  amount: -42.5,
  confidenceScore: 0.72,
  isTransfer: false,
};
const trip: TripOption = { id: 'trip1', name: 'Test Trip', startDate: '2026-03-01' };
const categories: Category[] = [];

const fetchMock = () => vi.mocked(global.fetch);
const tripGets = () =>
  fetchMock().mock.calls.filter(([url]) => String(url) === '/api/travel/trips').length;
const reply = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

// Failures worth reporting: each should warn, and neither wipe nor invent trips.
const FAILURES: [string, () => Promise<Response>][] = [
  ['a 500', async () => reply({ trips: [trip] }, 500)],
  ['a 404', async () => reply({}, 404)],
  ['a network error', async () => Promise.reject(new Error('Test network failure'))],
  [
    'an unparseable body',
    async () =>
      ({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Test bad JSON')),
      }) as unknown as Response,
  ],
];

function setup() {
  return renderHook(() =>
    useTransactionDrawer({
      list: [tx],
      lookup: [tx],
      refresh: vi.fn().mockResolvedValue(undefined),
      categories,
      patchRows: vi.fn(),
    })
  );
}

beforeEach(() => {
  global.fetch = vi.fn(async () => reply({ trips: [trip] })) as unknown as typeof fetch;
});

describe('useTransactionDrawer trips', () => {
  it('loads trips into drawerProps on mount', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.drawerProps.trips).toEqual([trip]));
    expect(tripGets()).toBe(1);
  });

  it('reloads trips each time the drawer goes from closed to open, not on close', async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.drawerProps.trips).toEqual([trip]));

    const created: TripOption = { id: 'trip2', name: 'Test Trip 2', startDate: '2026-04-01' };
    fetchMock().mockImplementation(async () => reply({ trips: [trip, created] }));
    act(() => result.current.drawerProps.onOpen('t1'));
    expect(result.current.isOpen).toBe(true);
    await waitFor(() => expect(result.current.drawerProps.trips).toEqual([trip, created]));
    expect(tripGets()).toBe(2);

    act(() => result.current.drawerProps.onClose());
    await waitFor(() => expect(result.current.isOpen).toBe(false));
    expect(tripGets()).toBe(2);

    act(() => result.current.drawerProps.onOpen('t1'));
    await waitFor(() => expect(tripGets()).toBe(3));
  });

  it('a slower, older response does not overwrite a newer one', async () => {
    let releaseMount = () => {};
    const held = new Promise<void>((r) => (releaseMount = r));
    fetchMock().mockImplementationOnce(async () => {
      await held;
      return reply({ trips: [] });
    });
    const { result } = setup();
    act(() => result.current.drawerProps.onOpen('t1'));
    await waitFor(() => expect(result.current.drawerProps.trips).toEqual([trip]));
    await act(async () => releaseMount());
    expect(result.current.drawerProps.trips).toEqual([trip]);
  });

  async function settleFirstLoad(respond: () => Promise<Response>) {
    fetchMock().mockImplementation(respond);
    const hook = setup();
    await waitFor(() => expect(tripGets()).toBe(1));
    await act(async () => {});
    return hook;
  }

  async function settleReload(respond: () => Promise<Response>) {
    const hook = setup();
    await waitFor(() => expect(hook.result.current.drawerProps.trips).toEqual([trip]));
    fetchMock().mockImplementation(respond);
    act(() => hook.result.current.drawerProps.onOpen('t1'));
    await waitFor(() => expect(tripGets()).toBe(2));
    await act(async () => {});
    return hook;
  }

  it.each(FAILURES)('%s on first load warns and gives no trips', async (_name, respond) => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await settleFirstLoad(respond);
    expect(result.current.drawerProps.trips).toEqual([]);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    consoleWarn.mockRestore();
  });

  it.each(FAILURES)('%s on reload warns and keeps the previous trips', async (_name, respond) => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = await settleReload(respond);
    expect(result.current.drawerProps.trips).toEqual([trip]);
    expect(consoleWarn).toHaveBeenCalledTimes(1);
    consoleWarn.mockRestore();
  });

  it('a missing trips key gives no trips, quietly', async () => {
    const consoleWarn = vi.spyOn(console, 'warn');
    const { result } = await settleFirstLoad(async () => reply({}));
    expect(result.current.drawerProps.trips).toEqual([]);
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });
});

describe('useTransactionDrawer refresh', () => {
  it('a rejected refresh is logged, not thrown, and closing still works', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const refresh = vi.fn().mockRejectedValue(new Error('Test refresh failure'));
    const { result } = renderHook(() =>
      useTransactionDrawer({ list: [tx], lookup: [tx], refresh, categories, patchRows: vi.fn() })
    );
    act(() => result.current.drawerProps.onOpen('t1'));
    await act(async () => result.current.drawerProps.onClose());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result.current.isOpen).toBe(false);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('a saved row is patched through patchRows and on the open snapshot', async () => {
    const patchRows = vi.fn();
    const { result, rerender } = renderHook(
      ({ rows }) =>
        useTransactionDrawer({
          list: rows,
          lookup: rows,
          refresh: vi.fn().mockResolvedValue(undefined),
          categories,
          patchRows,
        }),
      { initialProps: { rows: [tx] } }
    );
    act(() => result.current.drawerProps.onOpen('t1'));
    // Off every list, the open transaction lives on in the snapshot alone.
    rerender({ rows: [] });
    act(() => result.current.drawerProps.onRowSaved('t1', { merchant: 'Test Renamed' }));
    await act(async () => {});

    expect(patchRows).toHaveBeenCalledTimes(1);
    const patch = patchRows.mock.calls[0][0] as (l: Tx[]) => Tx[];
    expect(patch([tx])[0].merchant).toBe('Test Renamed');
    expect(result.current.state).toMatchObject({ mode: 'edit', tx: { merchant: 'Test Renamed' } });
  });
});
