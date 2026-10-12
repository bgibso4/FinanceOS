'use client';

import { TrendingUp } from 'lucide-react';
import type { AccountSummary, InvestmentOverview } from '@/lib/investments/overview';
import { GROUP_ORDER } from '@/lib/investments/portfolio-view';
import { accountDots, navMeta, plural, sparkTone } from './account-states';
import { fmtMoney } from './format';
import { institutionMark } from './institution-mark';
import { StatusDot } from './pills';
import { Sparkline } from './value-chart';

const rowClass = (on: boolean) =>
  `-mx-2.5 w-[calc(100%+20px)] items-center gap-3 rounded-lg px-2.5 text-left transition-colors hover:bg-[var(--bg-elevated)] ${
    on ? 'bg-[var(--bg-elevated)] shadow-[inset_2px_0_0_var(--accent)]' : ''
  }`;

export function AccountNavigator({
  overview,
  selected,
  onSelect,
}: {
  overview: InvestmentOverview;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { accounts, baseCurrency: currency } = overview;
  const institutions = new Set(accounts.map((a) => a.institution)).size;
  return (
    <nav aria-label="Investment accounts">
      <button
        aria-current={selected === null ? 'true' : undefined}
        className={`${rowClass(selected === null)} mb-1 grid grid-cols-[28px_1fr_84px] py-2.5`}
        type="button"
        onClick={() => onSelect(null)}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[var(--border-hover)] text-[var(--accent)]">
          <TrendingUp size={14} />
        </span>
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-[var(--text-primary)]">
            All accounts
          </span>
          <span className="block text-[11px] text-[var(--text-muted)]">
            {plural(accounts.length, 'account')} · {plural(institutions, 'institution')}
          </span>
        </span>
        <span className="text-right font-mono text-[13px] font-medium text-[var(--text-primary)]">
          {fmtMoney(overview.portfolio.value, { currency })}
        </span>
      </button>
      {GROUP_ORDER.map((group) => {
        const members = accounts
          .filter((a) => a.group === group)
          .sort((x, y) => y.valueBase - x.valueBase);
        if (!members.length) return null;
        const total = members.reduce((sum, a) => sum + a.valueBase, 0);
        return (
          <section key={group} aria-label={group}>
            <div className="flex justify-between pb-1.5 pt-3.5 text-[10.5px] font-medium uppercase tracking-[0.7px] text-[var(--text-muted)]">
              <span>{group}</span>
              <span className="font-mono">{fmtMoney(total, { currency })}</span>
            </div>
            {members.map((a) => (
              <AccountRow
                key={a.id}
                account={a}
                currency={currency}
                selected={selected === a.id}
                onSelect={() => onSelect(a.id)}
              />
            ))}
          </section>
        );
      })}
    </nav>
  );
}

function AccountRow({
  account: a,
  currency,
  selected,
  onSelect,
}: {
  account: AccountSummary;
  currency: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const mark = institutionMark(a.institution);
  return (
    <button
      aria-current={selected ? 'true' : undefined}
      className={`${rowClass(selected)} grid grid-cols-[28px_1fr_64px_84px] py-[9px]`}
      type="button"
      onClick={onSelect}
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[11px] font-semibold text-[var(--bg-base)]"
        style={{ background: mark.color }}
      >
        {mark.initials}
      </span>
      <span className="min-w-0">
        <span className="flex items-center">
          <span className="truncate text-[13px] font-medium text-[var(--text-primary)]">
            {a.name}
          </span>
          {accountDots(a).map((d) => (
            <StatusDot key={d.title} title={d.title} tone={d.tone} />
          ))}
        </span>
        <span className="block truncate text-[11px] text-[var(--text-muted)]">{navMeta(a)}</span>
      </span>
      {a.valueBase === 0 ? <span /> : <Sparkline points={a.series} tone={sparkTone(a)} />}
      <span className="text-right font-mono text-[13px] font-medium text-[var(--text-primary)]">
        {fmtMoney(a.valueBase, { currency })}
      </span>
    </button>
  );
}
