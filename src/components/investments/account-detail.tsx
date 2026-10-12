'use client';

import { useState, type ReactNode } from 'react';
import { PlaidReconnectButton } from '@/components/plaid/PlaidReconnectButton';
import { ACTIVITY_SHOWN } from '@/lib/investments/activity';
import {
  allocation,
  holdingLines,
  type AllocationDimension,
} from '@/lib/investments/holdings-view';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';
import { GROUP_ORDER } from '@/lib/investments/portfolio-view';
import {
  accountNotices,
  activityEmptyText,
  freshnessText,
  plural,
  type NoticeKind,
} from './account-states';
import { ActivityList } from './activity-list';
import { AllocationBars } from './allocation-bars';
import { fmtDay, fmtMoney } from './format';
import { HoldingsMap } from './holdings-map';
import { HoldingsTable } from './holdings-table';
import { ChangeChip, Notice, SourcePill } from './pills';
import { ValueChart } from './value-chart';

const BUTTON =
  'rounded-lg border border-[var(--border-hover)] bg-[var(--bg-elevated)] px-[11px] py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]';
const ACCENT_BUTTON =
  'rounded-lg border border-[color-mix(in_srgb,var(--accent)_40%,transparent)] px-[11px] py-1.5 text-xs font-medium text-[var(--accent)]';
const LINK = 'font-medium text-[var(--accent)] hover:underline';

const DIMENSIONS: { id: AllocationDimension; label: string }[] = [
  { id: 'type', label: 'Type' },
  { id: 'account', label: 'Account' },
  { id: 'currency', label: 'Currency' },
];

type DetailProps = {
  overview: InvestmentOverview;
  selected: string | null;
  onRecordBalance: (account: AccountSummary) => void;
  onEditHoldings: (account: AccountSummary) => void;
  onSetSymbol: (security: { securityId: string; label: string }) => void;
  onRetryPrices: () => void;
  onReconnected: () => void;
};

const NOTICE_ACTIONS: Record<NoticeKind, (a: AccountSummary, p: DetailProps) => ReactNode> = {
  reauth: (a, p) =>
    a.enrollmentId ? (
      <PlaidReconnectButton
        buttonText="Reconnect"
        className={ACCENT_BUTTON}
        enrollmentId={a.enrollmentId}
        onSuccess={p.onReconnected}
      />
    ) : null,
  waiting: () => null,
  stale: (_a, p) => (
    <button className={LINK} type="button" onClick={p.onRetryPrices}>
      Retry
    </button>
  ),
  unpriced: (a, p) => (
    <button className={BUTTON} type="button" onClick={() => p.onSetSymbol(a.status.unpriced[0])}>
      Set symbol
    </button>
  ),
};

function SectionTitle({ title, hint }: { title: string; hint?: ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
      <span>{title}</span>
      {hint && (
        <span className="text-[10.5px] font-medium uppercase tracking-[0.6px] text-[var(--text-muted)]">
          {hint}
        </span>
      )}
    </div>
  );
}

function ChartLegend({ manual }: { manual: boolean }) {
  const solid = <span className="inline-block h-0 w-4 border-t-[1.5px] border-[var(--accent)]" />;
  const dashed = (
    <span className="inline-block h-0 w-4 border-t-[1.5px] border-dashed border-[var(--accent)] opacity-70" />
  );
  return (
    <div className="flex gap-3.5 text-[10.5px] text-[var(--text-muted)]">
      <span className="flex items-center gap-1.5">
        {manual ? <span className="h-[7px] w-[7px] rounded-full bg-[var(--accent)]" /> : solid}
        {manual ? 'Entered' : 'Synced'}
      </span>
      <span className="flex items-center gap-1.5">
        {dashed}
        {manual ? 'Carried forward' : 'Estimated between syncs'}
      </span>
    </div>
  );
}

export function AccountDetail(props: DetailProps) {
  const { overview, selected } = props;
  const currency = overview.baseCurrency;
  const [dimension, setDimension] = useState<AllocationDimension>('type');
  const account = overview.accounts.find((a) => a.id === selected) ?? null;
  const rows = account
    ? overview.holdings.filter((h) => h.accountId === account.id)
    : overview.holdings;
  const lines = holdingLines(rows);
  const series = account ? account.series : overview.portfolio.series;
  const change = account ? account.change : overview.portfolio.change;
  const manual = account?.balanceSource === 'manual';
  const value = account ? account.valueBase : overview.portfolio.value;
  const facts = overview.accounts.map((a) => ({
    id: a.id,
    wrapper: a.wrapper,
    currency: a.currency,
  }));
  const slices = allocation(rows, facts, account ? 'type' : dimension);
  const activity = (
    account ? overview.activity.filter((i) => i.accountId === account.id) : overview.activity
  ).slice(0, account ? ACTIVITY_SHOWN.account : ACTIVITY_SHOWN.all);
  const byId = new Map(overview.accounts.map((a) => [a.id, a]));
  const entries = manual ? series.filter((p) => !p.isEstimated) : [];
  const showMap = lines.length > 1;

  return (
    <section aria-label="Account detail">
      <div className="flex justify-between gap-4">
        <div>
          <h2 className="mb-0.5 text-base font-semibold text-[var(--text-primary)]">
            {account ? account.name : 'All accounts'}
          </h2>
          <div className="flex min-h-5 flex-wrap items-center gap-2 text-[11.5px] text-[var(--text-muted)]">
            {account ? (
              <>
                <span>
                  {account.institution} · {account.wrapper}
                </span>
                <SourcePill source={account.balanceSource} />
                <span>{freshnessText(account, overview.today)}</span>
              </>
            ) : (
              <span>{GROUP_ORDER.join(' · ')}</span>
            )}
          </div>
        </div>
        {account?.balanceSource === 'manual' && (
          <button
            className={ACCENT_BUTTON}
            type="button"
            onClick={() => props.onRecordBalance(account)}
          >
            Record balance
          </button>
        )}
        {account?.balanceSource === 'valuation' && (
          <button className={BUTTON} type="button" onClick={() => props.onEditHoldings(account)}>
            Edit holdings
          </button>
        )}
      </div>

      {account &&
        accountNotices(account).map((n) => (
          <Notice
            key={n.kind}
            action={NOTICE_ACTIONS[n.kind](account, props)}
            lead={n.lead}
            text={n.text}
            tone={n.tone}
          />
        ))}

      <div className="mt-[18px] flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="font-mono text-[32px] font-medium tracking-[-0.8px] text-[var(--text-primary)]">
            {fmtMoney(value, { currency })}
          </div>
          <div className="mt-1.5 flex items-center gap-2.5 text-xs text-[var(--text-muted)]">
            {manual ? (
              <span>Manual balance</span>
            ) : (
              change && (
                <>
                  <ChangeChip change={change} currency={currency} />
                  <span>balance change · {overview.range}</span>
                </>
              )
            )}
            {account && account.currency !== currency && (
              <span className="font-mono">
                {fmtMoney(account.value, { currency: account.currency })}
              </span>
            )}
          </div>
        </div>
        <ChartLegend manual={manual} />
      </div>

      <ValueChart manual={manual} points={series} />

      {entries.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-[18px] text-[11px] text-[var(--text-muted)]">
          <span>Entries:</span>
          {entries.map((e) => (
            <span key={e.date}>
              {fmtDay(e.date)}{' '}
              <span className="font-mono text-[var(--text-secondary)]">
                {fmtMoney(e.value, { currency })}
              </span>
            </span>
          ))}
          <span>· carried forward between entries</span>
        </div>
      )}

      {showMap && (
        <div className="mt-7 grid grid-cols-1 gap-7 xl:grid-cols-[1.55fr_1fr]">
          <div>
            <SectionTitle
              hint={`size = value · color = ${overview.range} change`}
              title="Holdings map"
            />
            <HoldingsMap currency={currency} height={account ? 200 : 250} lines={lines} />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-[var(--text-secondary)]">
              <span>Allocation</span>
              <span className="inline-flex gap-0.5 rounded-[7px] border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
                {(account ? DIMENSIONS.slice(0, 1) : DIMENSIONS).map((d) => {
                  const on = (account ? 'type' : dimension) === d.id;
                  return (
                    <button
                      key={d.id}
                      aria-pressed={on}
                      className={`rounded-[5px] px-2 py-0.5 text-[10.5px] font-medium ${
                        on
                          ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)]'
                          : 'text-[var(--text-muted)]'
                      }`}
                      type="button"
                      onClick={() => setDimension(d.id)}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </span>
            </div>
            <AllocationBars slices={slices} />
          </div>
        </div>
      )}

      <div className="mt-7 grid grid-cols-1 gap-7 xl:grid-cols-[1.55fr_1fr]">
        <div>
          <SectionTitle
            hint={account ? plural(lines.length, 'position') : 'combined across accounts'}
            title="Holdings"
          />
          {lines.length ? (
            <HoldingsTable currency={currency} lines={lines} multiAccount={!account} />
          ) : (
            <p className="mt-2.5 text-xs text-[var(--text-muted)]">No holdings reported.</p>
          )}
        </div>
        <div>
          <SectionTitle hint={account ? 'recent' : 'all accounts'} title="Activity" />
          <ActivityList
            emptyText={activityEmptyText(account)}
            items={activity}
            sourceOf={
              account
                ? undefined
                : (id) => {
                    const a = byId.get(id);
                    return a ? `${a.name} · ${a.institution}` : null;
                  }
            }
          />
        </div>
      </div>
    </section>
  );
}
