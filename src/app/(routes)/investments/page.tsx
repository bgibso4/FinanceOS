'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccountDetail } from '@/components/investments/account-detail';
import { AccountNavigator } from '@/components/investments/account-navigator';
import { fmtDay } from '@/components/investments/format';
import { HoldingsEditorModal } from '@/components/investments/holdings-editor-modal';
import { RecordBalanceModal } from '@/components/investments/record-balance-modal';
import { SetSymbolModal } from '@/components/investments/set-symbol-modal';
import { Card } from '@/components/ui/card';
import { triggerSync } from '@/lib/cloud-sync';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';
import { DEFAULT_RANGE, RANGES, type Range } from '@/lib/investments/portfolio-view';

type Dialog =
  | { kind: 'record'; account: AccountSummary }
  | { kind: 'holdings'; account: AccountSummary }
  | { kind: 'symbol'; security: { securityId: string; label: string } };

type RefreshState = { running: boolean; failed: boolean };

/** Runs the price refresh; `failed` drives the header wording, `wrote` whether to cloud-sync. */
async function runPriceRefresh(): Promise<{ failed: boolean; wrote: boolean }> {
  try {
    const res = await fetch('/api/investments/refresh', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    return {
      failed: !res.ok || data.stopped === true || (data.failedSymbols?.length ?? 0) > 0,
      wrote: res.ok && ((data.fetched ?? 0) > 0 || (data.valuationRows ?? 0) > 0),
    };
  } catch {
    return { failed: true, wrote: false };
  }
}

export default function InvestmentsPage() {
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [overview, setOverview] = useState<InvestmentOverview | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState<RefreshState>({ running: false, failed: false });
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  /** Id of the newest overview request; older responses are dropped. */
  const latestLoad = useRef(0);

  const load = useCallback(async (r: Range) => {
    const id = ++latestLoad.current;
    try {
      const res = await fetch(`/api/investments/overview?range=${r}`);
      if (!res.ok) throw new Error('overview failed');
      const data: InvestmentOverview = await res.json();
      if (id !== latestLoad.current) return;
      setOverview(data);
      setLoadFailed(false);
    } catch {
      if (id === latestLoad.current) setLoadFailed(true);
    }
  }, []);

  const refreshPrices = useCallback(async () => {
    setRefresh({ running: true, failed: false });
    const { failed, wrote } = await runPriceRefresh();
    setRefresh({ running: false, failed });
    if (wrote) triggerSync();
    await load(rangeRef.current);
  }, [load]);

  useEffect(() => {
    void load(range);
  }, [range, load]);

  useEffect(() => {
    void refreshPrices();
  }, [refreshPrices]);

  useEffect(() => {
    if (selected && overview && !overview.accounts.some((a) => a.id === selected)) {
      setSelected(null);
    }
  }, [overview, selected]);

  const saved = async () => {
    setDialog(null);
    triggerSync();
    await load(rangeRef.current);
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-[-0.3px] text-[var(--text-primary)]">
          Investments
        </h1>
        <div className="flex items-center gap-3.5">
          <PricesNote overview={overview} refresh={refresh} onRetry={refreshPrices} />
          <div className="inline-flex gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
            {RANGES.map((r) => (
              <button
                key={r}
                aria-pressed={r === range}
                className={`rounded-md px-2.5 py-[3px] text-[11px] font-medium ${
                  r === range
                    ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)]'
                }`}
                type="button"
                onClick={() => setRange(r)}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {!overview && loadFailed && (
        <Card className="p-6 text-sm text-[var(--text-secondary)]">
          Couldn’t load investments.{' '}
          <button
            className="font-medium text-[var(--accent)]"
            type="button"
            onClick={() => load(range)}
          >
            Try again
          </button>
        </Card>
      )}

      {overview && overview.accounts.length === 0 && (
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">
            No investment accounts yet
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Set an account’s tracking mode to Investment in{' '}
            <Link className="text-[var(--accent)]" href="/settings?tab=accounts">
              Settings → Accounts
            </Link>
            .
          </p>
        </Card>
      )}

      {overview && overview.accounts.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[400px_1fr]">
          <Card className="px-5 pb-[18px] pt-4 lg:sticky lg:top-6">
            <AccountNavigator overview={overview} selected={selected} onSelect={setSelected} />
          </Card>
          <Card className="px-[26px] pb-7 pt-6">
            <AccountDetail
              overview={overview}
              selected={selected}
              onEditHoldings={(account) => setDialog({ kind: 'holdings', account })}
              onReconnected={() => load(range)}
              onRecordBalance={(account) => setDialog({ kind: 'record', account })}
              onRetryPrices={refreshPrices}
              onSetSymbol={(security) => setDialog({ kind: 'symbol', security })}
            />
          </Card>
        </div>
      )}

      {dialog?.kind === 'record' && (
        <RecordBalanceModal
          key={dialog.account.id}
          account={dialog.account}
          today={overview?.today ?? new Date().toISOString().slice(0, 10)}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === 'holdings' && overview && (
        <HoldingsEditorModal
          key={dialog.account.id}
          account={dialog.account}
          holdings={overview.holdings.filter((h) => h.accountId === dialog.account.id)}
          pricesAsOf={dialog.account.prices?.asOf ?? null}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
      {dialog?.kind === 'symbol' && (
        <SetSymbolModal
          key={dialog.security.securityId}
          security={dialog.security}
          onClose={() => setDialog(null)}
          onSaved={saved}
        />
      )}
    </div>
  );
}

function PricesNote({
  overview,
  refresh,
  onRetry,
}: {
  overview: InvestmentOverview | null;
  refresh: RefreshState;
  onRetry: () => void;
}) {
  if (refresh.running) {
    return <span className="text-[11.5px] text-[var(--text-muted)]">Updating prices…</span>;
  }
  const asOf = overview?.prices.asOf;
  if (!asOf) return null;
  if (!overview.prices.stale) {
    return (
      <span className="text-[11.5px] text-[var(--text-muted)]">
        Prices as of {fmtDay(asOf)} close
      </span>
    );
  }
  return (
    <span className="inline-flex gap-2 text-[11.5px] text-[var(--accent)]">
      <span>
        {`Prices as of ${fmtDay(asOf)} close${refresh.failed ? ' · couldn’t reach price source' : ''}`}
      </span>
      <button className="font-medium" type="button" onClick={onRetry}>
        Retry
      </button>
    </span>
  );
}
