'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { fmtDay, fmtMoney } from '@/components/investments/format';
import { leftOutText, parseAmount, rowTag, scaleNotes } from '@/components/investments/invest-view';
import { TD, TH, fraction } from '@/components/investments/targets-kit';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { InvestPlan, PlanRow } from '@/lib/investments/targets/planner';

const QUICK_AMOUNTS = [500, 1000, 2500, 5000];
const DEBOUNCE_MS = 250;
const MUTED = 'text-[var(--text-muted)]';
const MONO = 'font-mono text-[13px]';

type Ready = Extract<InvestPlan, { ready: true }>;
type PlanState = { plan: InvestPlan | null; failed: boolean };

/** The plan for the typed amount, refetched 250 ms after the last change; stale replies are dropped. */
function usePlan(open: boolean, amount: number, sells: boolean): PlanState {
  const [state, setState] = useState<PlanState>({ plan: null, failed: false });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const query = `amount=${amount}${sells ? '&sells=1' : ''}`;
        const res = await fetch(`/api/investments/targets/plan?${query}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('plan failed');
        const plan: InvestPlan = await res.json();
        if (!controller.signal.aborted) setState({ plan, failed: false });
      } catch {
        if (!controller.signal.aborted) setState((s) => ({ ...s, failed: true }));
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, amount, sells]);
  return state;
}

export function InvestDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [sells, setSells] = useState(false);
  const amount = parseAmount(text) ?? 0;
  const { plan, failed } = usePlan(open, amount, sells);
  const ready = plan?.ready ? plan : null;

  return (
    <Drawer
      footer={<Footer />}
      open={open}
      subtitle={
        ready &&
        `Toward your targets · ${ready.accountsCounted} accounts counted · ${fmtMoney(ready.countedTotal, { currency: ready.baseCurrency })} counted`
      }
      title="Invest"
      onClose={onClose}
    >
      <div className="space-y-4">
        <AmountCard
          currency={ready?.baseCurrency ?? 'USD'}
          sells={sells}
          text={text}
          onSells={setSells}
          onText={setText}
        />
        {failed && <p className="text-sm text-[var(--red)]">Couldn’t load the plan.</p>}
        {plan && !plan.ready && (
          <Card className="p-5 text-sm">
            <h4 className="font-semibold text-[var(--text-primary)]">
              Set your investing targets first
            </h4>
            <p className={`mt-1 ${MUTED}`}>
              The plan needs class targets and country weights to split your money.
            </p>
          </Card>
        )}
        {ready && <PlanBody plan={ready} />}
      </div>
    </Drawer>
  );
}

function Footer() {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-[12px] ${MUTED}`}>
        Nothing is saved. Your next sync brings in the buys.
      </span>
      <Link
        className="shrink-0 text-[13px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        href="/settings?tab=targets"
      >
        Edit investing targets →
      </Link>
    </div>
  );
}

function AmountCard({
  currency,
  sells,
  text,
  onSells,
  onText,
}: {
  currency: string;
  sells: boolean;
  text: string;
  onSells: (on: boolean) => void;
  onText: (text: string) => void;
}) {
  return (
    <Card className="space-y-3 p-4">
      <label className="block text-[13px] font-medium text-[var(--text-primary)]" htmlFor="amt">
        Amount to invest
      </label>
      <div className="flex items-center gap-2">
        <span className={MUTED}>$</span>
        <Input
          autoComplete="off"
          id="amt"
          inputMode="decimal"
          placeholder="0"
          value={text}
          onChange={(e) => onText(e.target.value)}
        />
        <span className={`text-[12px] ${MUTED}`}>{currency}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {QUICK_AMOUNTS.map((n) => (
          <Button
            key={n}
            className="px-3 py-1 text-[13px]"
            variant="outline"
            onClick={() => onText(String(n))}
          >
            {fmtMoney(n)}
          </Button>
        ))}
      </div>
      <div className="flex items-start justify-between gap-4 border-t border-[var(--border)] pt-3">
        <div>
          <div className="text-[13px] font-medium text-[var(--text-primary)]">Allow sells</div>
          <div className={`text-[12px] ${MUTED}`}>
            {sells
              ? 'Full rebalance: sells what’s over target so every target lands on it.'
              : 'Off: the amount only goes to targets below.'}
          </div>
        </div>
        <button
          aria-checked={sells}
          aria-label="Allow sells"
          className={cn(
            'relative mt-0.5 h-5 w-9 shrink-0 rounded-full border border-[var(--border-hover)] transition-colors',
            sells ? 'bg-[var(--text-secondary)]' : 'bg-[var(--bg-elevated)]'
          )}
          role="switch"
          type="button"
          onClick={() => onSells(!sells)}
        >
          <span
            className={cn(
              'absolute top-0.5 h-3.5 w-3.5 rounded-full bg-[var(--bg-card)] transition-all',
              sells ? 'left-[18px]' : 'left-0.5'
            )}
          />
        </button>
      </div>
    </Card>
  );
}

function PlanBody({ plan }: { plan: Ready }) {
  const hasAmt = plan.amount > 0;
  const money = (v: number, cents = false) => fmtMoney(v, { currency: plan.baseCurrency, cents });
  const notes = useMemo(() => {
    const lines = scaleNotes(plan.totals);
    if (plan.pricesAsOf) lines.push(`Prices from ${fmtDay(plan.pricesAsOf)} close.`);
    if (!plan.sells && hasAmt && plan.rows.some((r) => r.trade === 0 && r.targetPct > 0))
      lines.push('Targets already over get nothing. Turn on sells to rebalance fully.');
    return lines;
  }, [plan, hasAmt]);

  return (
    <>
      <Card className="p-4">
        <h4 className="mb-3 flex items-baseline justify-between text-[13.5px] font-semibold text-[var(--text-primary)]">
          {hasAmt ? (plan.sells ? 'Rebalance' : 'Buy list') : 'Where you stand'}
          <span className={`text-[11px] font-normal ${MUTED}`}>
            {`bar: now ${hasAmt ? '· after ' : ''}· tick = target`}
          </span>
        </h4>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={TH}>Fund · target</th>
              <th className={TH}>{hasAmt ? 'Now → after' : 'Now'}</th>
              <th className={`${TH} text-right`}>Target</th>
              <th className={`${TH} text-right`}>{plan.sells ? 'Trade' : 'Buy'}</th>
            </tr>
          </thead>
          <tbody>
            {plan.rows.map((row) => (
              <RowView key={row.key} hasAmt={hasAmt} money={money} row={row} />
            ))}
            {hasAmt && (
              <tr className="border-t border-[var(--border)]">
                <td className={`${TD} text-[13px] text-[var(--text-secondary)]`} colSpan={3}>
                  Total
                </td>
                <td className={`${TD} text-right ${MONO}`}>{money(plan.amount, true)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {!hasAmt && (
          <p className={`mt-3 text-[12px] ${MUTED}`}>Type an amount above to see what to buy.</p>
        )}
      </Card>
      {notes.length > 0 && (
        <Card className="space-y-1 p-4 text-[12.5px] text-[var(--text-secondary)]">
          {notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </Card>
      )}
      <LeftOut items={plan.leftOut} money={money} />
    </>
  );
}

type Money = (v: number, cents?: boolean) => string;

function RowView({ hasAmt, money, row }: { hasAmt: boolean; money: Money; row: PlanRow }) {
  const selling = hasAmt && row.trade < 0;
  return (
    <>
      <tr className="border-t border-[var(--border)] align-top">
        <td className={TD}>
          {row.fund ? (
            <div className="font-mono text-[13.5px] text-[var(--text-primary)]">
              {row.fund.ticker}
            </div>
          ) : (
            <div className={`text-[13px] ${MUTED}`}>Pick a fund</div>
          )}
          {row.fund && <div className={`text-[11.5px] ${MUTED}`}>{row.fund.name}</div>}
          <span className="mt-1 inline-block rounded-full border border-[var(--border-hover)] px-1.5 text-[10.5px] text-[var(--text-secondary)]">
            {rowTag(row)}
          </span>
        </td>
        <td className={TD}>
          <div className={`${MONO} text-[var(--text-secondary)]`}>
            {fraction(row.currentPct)}
            {hasAmt && ` → ${fraction(row.afterPct)}`}
          </div>
          <Bar after={hasAmt ? row.afterPct : null} now={row.currentPct} target={row.targetPct} />
        </td>
        <td className={`${TD} text-right ${MONO} text-[var(--text-secondary)]`}>
          {fraction(row.targetPct)}
        </td>
        <td className={`${TD} text-right`}>
          <TradeCell hasAmt={hasAmt} money={money} row={row} />
        </td>
      </tr>
      {selling && (
        <tr>
          <td className="px-2 pb-2" colSpan={4}>
            <div className="rounded-lg bg-[var(--bg-surface)] p-2.5 text-[12px] text-[var(--text-secondary)]">
              <div className={`mb-1 flex justify-between ${MUTED}`}>
                <span>What you hold here</span>
                <span>Value</span>
              </div>
              {row.holdings.map((h) => (
                <div key={`${h.accountName}-${h.label}`} className="flex justify-between">
                  <span>{`${h.label} · ${h.accountName}`}</span>
                  <span className="font-mono">{money(h.value)}</span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Bar({ after, now, target }: { after: number | null; now: number; target: number }) {
  const w = (f: number) => `${Math.min(100, f * 100).toFixed(1)}%`;
  return (
    <div className="relative mt-1.5 h-1 rounded-full bg-[var(--border)]">
      <div
        className="absolute inset-y-0 left-0 rounded-full bg-[var(--text-muted)]"
        style={{ width: w(now) }}
      />
      {after !== null && (
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-[var(--text-secondary)] opacity-50"
          style={{ width: w(after) }}
        />
      )}
      <div
        className="absolute -top-0.5 h-2 w-0.5 bg-[var(--text-primary)]"
        style={{ left: `calc(${w(target)} - 1px)` }}
      />
    </div>
  );
}

function TradeCell({ hasAmt, money, row }: { hasAmt: boolean; money: Money; row: PlanRow }) {
  if (!hasAmt) return <span className={`${MONO} ${MUTED}`}>—</span>;
  const sub = 'block text-[11.5px] text-[var(--text-muted)]';
  if (row.trade < 0) {
    return (
      <>
        <span className={`${MONO} text-[var(--red)]`}>{`Sell ${money(-row.trade, true)}`}</span>
        <span className={sub}>pick from below</span>
      </>
    );
  }
  const price = row.fund?.price;
  return (
    <>
      <span className={`${MONO} ${row.trade === 0 ? MUTED : 'text-[var(--text-primary)]'}`}>
        {money(row.trade, true)}
      </span>
      {row.trade === 0 ? (
        <span className={sub}>over target</span>
      ) : !row.fund ? (
        <span className={sub}>Pick a fund to buy</span>
      ) : price == null || row.shares == null ? (
        <span className={sub}>No price yet</span>
      ) : (
        <span className={sub}>
          <span>{`${row.shares.toFixed(3)} sh @ ${fmtMoney(price, { cents: true, currency: row.fund.currency })}`}</span>
          {row.fund.stale && row.fund.priceDate && (
            <span className="ml-1.5 text-[var(--accent)]">{`price from ${fmtDay(row.fund.priceDate)}`}</span>
          )}
        </span>
      )}
    </>
  );
}

function LeftOut({ items, money }: { items: Ready['leftOut']; money: Money }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const total = items.reduce((sum, i) => sum + i.value, 0);
  return (
    <Card className="p-4">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between text-left"
        type="button"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[13.5px] font-semibold text-[var(--text-primary)]">
          Left out
          <span className={`ml-1.5 inline-block transition-transform ${open ? 'rotate-90' : ''}`}>
            ›
          </span>
        </span>
        <span className={`${MONO} text-[var(--text-secondary)]`}>
          {`${money(total)} · ${items.length} items`}
        </span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          {[...items]
            .sort((a, b) => b.value - a.value)
            .map((i) => (
              <div
                key={`${i.label}-${i.reason}`}
                className="flex justify-between gap-3 text-[13px]"
              >
                <div className="min-w-0">
                  <div className="text-[var(--text-primary)]">{i.label}</div>
                  <div className={`text-[12px] ${MUTED}`}>{leftOutText(i.reason)}</div>
                </div>
                <span className={`${MONO} text-[var(--text-secondary)]`}>{money(i.value)}</span>
              </div>
            ))}
        </div>
      )}
    </Card>
  );
}
