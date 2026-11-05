'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  DrawerState,
  OpenOpts,
  TransactionDrawerHandle,
  TransactionDrawerProps,
} from './transaction-drawer';
import { applyFields } from './types';
import type { Category, TripOption, Tx, TxFields } from './types';

type DrawerTarget = { mode: 'edit'; id: string; linkRequest?: number } | { mode: 'new' } | null;

type Options = {
  /** What the drawer pages through. */
  list: Tx[];
  /** Also searched for an id before reaching past the page. */
  lookup: Tx[];
  refresh: () => Promise<void>;
  categories: Category[];
  /** Applies a patch to every list the page holds. */
  patchRows: (patch: (l: Tx[]) => Tx[]) => void;
};

type UseTransactionDrawer = {
  ref: RefObject<TransactionDrawerHandle | null>;
  state: DrawerState;
  openId: string | null;
  isOpen: boolean;
  openTransaction: (id: string, opts?: OpenOpts) => void;
  openNew: () => void;
  drawerProps: Omit<
    TransactionDrawerProps,
    'accounts' | 'availableTags' | 'baseCurrency' | 'categories' | 'onCreateTag'
  >;
};

// Reaches past the page's filter, e.g. to a refund's original from months back.
async function fetchLastYear(): Promise<Tx[] | null> {
  try {
    const res = await fetch('/api/transactions?preset=last-12-months');
    const data: { transactions?: Tx[] } = await res.json();
    return data.transactions ?? [];
  } catch {
    return null;
  }
}

// Null means no answer, so the caller keeps what it has. A 404 is expected, not a failure:
// the trips API may not be there.
async function fetchTrips(): Promise<TripOption[] | null> {
  try {
    const res = await fetch('/api/travel/trips');
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`Failed to load trips: HTTP ${res.status}`);
      return null;
    }
    const data: { trips?: TripOption[] } = await res.json();
    return data.trips ?? [];
  } catch (err) {
    console.warn('Failed to load trips', err);
    return null;
  }
}

const patchRow = (list: Tx[], id: string, fields: TxFields, categories: Category[]) =>
  list.map((t) => (t.id === id ? applyFields(t, fields, categories) : t));

export function useTransactionDrawer({
  list,
  lookup,
  refresh,
  categories,
  patchRows,
}: Options): UseTransactionDrawer {
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const [drawerSnapshot, setDrawerSnapshot] = useState<Tx | null>(null);
  const ref = useRef<TransactionDrawerHandle>(null);
  // An id the drawer asked for that the lists don't hold yet, and the refresh that should bring it.
  const [pendingOpen, setPendingOpen] = useState<{
    id: string;
    opts?: OpenOpts;
    after: number;
  } | null>(null);
  const refreshesStarted = useRef(0);
  const [refreshesDone, setRefreshesDone] = useState(0);
  // Bumped per link request so asking again on the already-open transaction reopens the search.
  const linkRequests = useRef(0);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const tripRequests = useRef(0);

  const trackedRefresh = async () => {
    const seq = ++refreshesStarted.current;
    try {
      await refresh();
    } catch (err) {
      console.error('Failed to refresh transactions', err);
    } finally {
      // A pending open waits on this count, so a failed refresh must advance it too.
      setRefreshesDone((done) => Math.max(done, seq));
    }
  };

  const openId = drawer?.mode === 'edit' ? drawer.id : null;
  const listedTx = openId
    ? (list.find((t) => t.id === openId) ?? lookup.find((t) => t.id === openId))
    : undefined;
  // A refresh can drop the open transaction from every list; the drawer stays on it regardless.
  const drawerTx = listedTx ?? (drawerSnapshot?.id === openId ? drawerSnapshot : null);

  useEffect(() => {
    if (listedTx) setDrawerSnapshot(listedTx);
  }, [listedTx]);

  const isListed = (id: string) => list.some((t) => t.id === id) || lookup.some((t) => t.id === id);

  const editTarget = (id: string, opts?: OpenOpts): DrawerTarget =>
    opts?.startLinking
      ? { mode: 'edit', id, linkRequest: ++linkRequests.current }
      : { mode: 'edit', id };

  // Ids outside the lists (new split parts, an unsplit original, an older refund original)
  // resolve after a refresh or a wider lookup; meanwhile the drawer stays where it is.
  const onOpen = (id: string, opts?: OpenOpts) => {
    if (drawer?.mode === 'edit' && !isListed(id)) {
      if (refreshesDone >= refreshesStarted.current) void trackedRefresh();
      setPendingOpen({ id, opts, after: refreshesStarted.current });
      return;
    }
    setPendingOpen(null);
    setDrawer(editTarget(id, opts));
  };

  const pendingListed = pendingOpen ? isListed(pendingOpen.id) : false;
  const currentListed = openId ? isListed(openId) : false;
  useEffect(() => {
    if (!pendingOpen) return;
    const { id, opts } = pendingOpen;
    if (pendingListed) {
      setDrawer(editTarget(id, opts));
      setPendingOpen(null);
      return;
    }
    if (refreshesDone < pendingOpen.after) return;
    // Still missing after the refresh: look wider; the snapshot then carries it outside the list.
    let stale = false;
    void fetchLastYear().then((year) => {
      if (stale) return;
      const tx = year?.find((t) => t.id === id);
      if (tx) {
        setDrawerSnapshot(tx);
        setDrawer(editTarget(id, opts));
      } else if (year && !currentListed && !year.some((t) => t.id === openId)) {
        // A miss stays on the current transaction, unless that is gone too (e.g. after unsplit).
        setDrawer(null);
      }
      setPendingOpen(null);
    });
    return () => {
      stale = true;
    };
  }, [pendingOpen, pendingListed, refreshesDone, openId, currentListed]);

  const state: DrawerState =
    drawer?.mode === 'new'
      ? drawer
      : drawer && drawerTx
        ? { mode: 'edit', tx: drawerTx, linkRequest: drawer.linkRequest }
        : null;
  // Layout follows what is shown: an opened id that never loads leaves the page unpushed.
  const isOpen = state !== null;

  const loadTrips = () => {
    const seq = ++tripRequests.current;
    void fetchTrips().then((loaded) => {
      if (loaded && seq === tripRequests.current) setTrips(loaded);
    });
  };
  useEffect(loadTrips, []);
  // Each open reloads, so a trip created on the same page shows up in the Trip field.
  useEffect(() => {
    if (isOpen) loadTrips();
  }, [isOpen]);

  // Opens go through the drawer so a pending edit is saved before it switches.
  // Clicking the row that is already open closes the drawer.
  const openTransaction = (id: string, opts?: OpenOpts) => {
    if (!opts && state?.mode === 'edit' && state.tx.id === id) {
      void ref.current?.close();
      return;
    }
    void ref.current?.open(id, opts);
  };
  const openNew = () => void ref.current?.openNew();

  // Applied to the current rows, not the drawer's copy: a queued save may hold a stale one.
  const onRowSaved = (id: string, fields: TxFields) => {
    const patch = (rows: Tx[]) => patchRow(rows, id, fields, categories);
    patchRows(patch);
    setDrawerSnapshot((prev) => prev && patch([prev])[0]);
  };

  const onClose = () => {
    setPendingOpen(null);
    setDrawer(null);
    void trackedRefresh();
  };

  return {
    ref,
    state,
    openId,
    isOpen,
    openTransaction,
    openNew,
    drawerProps: {
      state,
      list,
      trips,
      onOpen,
      onNew: () => {
        setPendingOpen(null);
        setDrawer({ mode: 'new' });
      },
      onClose,
      onRowSaved,
      onChanged: trackedRefresh,
      onCreated: onClose,
    },
  };
}
