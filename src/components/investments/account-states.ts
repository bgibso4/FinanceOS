import type { AccountSummary, BalanceSource } from '@/lib/investments/overview';
import { daysBetween, fmtDay, fmtSyncTime } from './format';

export type NoticeKind = 'reauth' | 'waiting' | 'stale' | 'unpriced';
export type NoticeView = { kind: NoticeKind; tone: 'warn' | 'err'; lead: string; text: string };

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const NOTICE_RULES: {
  kind: NoticeKind;
  applies: (a: AccountSummary) => boolean;
  view: (a: AccountSummary) => Omit<NoticeView, 'kind'>;
}[] = [
  {
    kind: 'reauth',
    applies: (a) => a.status.needsReauth != null,
    view: (a) => ({
      tone: 'err',
      lead: `${a.institution} needs to be reconnected.`,
      text: `Authorization expired on ${fmtDay(a.status.needsReauth!.since)}, so balances and holdings stopped updating. Nothing is lost — reconnecting resumes from where it left off.`,
    }),
  },
  {
    kind: 'waiting',
    applies: (a) => a.status.waiting != null,
    view: (a) => {
      const from = a.status.waiting!.showingFrom;
      return {
        tone: 'warn',
        lead: `Waiting on ${a.institution}.`,
        text: `${a.institution} hasn’t finished preparing holdings and activity for this connection. ${
          from
            ? `Showing data from ${fmtDay(from)}; the balance is current.`
            : 'The balance is current.'
        }`,
      };
    },
  },
  {
    kind: 'stale',
    applies: (a) => a.balanceSource === 'valuation' && a.prices?.stale === true,
    view: (a) => ({
      tone: 'warn',
      lead: a.prices?.asOf
        ? `Prices are from ${fmtDay(a.prices.asOf)}.`
        : 'Prices are out of date.',
      text: 'The price source didn’t respond, so this balance uses the last stored prices.',
    }),
  },
  {
    kind: 'unpriced',
    applies: (a) => a.status.unpriced.length > 0,
    view: (a) => {
      const many = a.status.unpriced.length > 1;
      return {
        tone: 'warn',
        lead: `${a.status.unpriced.map((u) => u.label).join(', ')} ${many ? 'have' : 'has'} no price source.`,
        text: many
          ? 'They’re valued at their last known prices. Check the symbols or set prices manually.'
          : 'It’s valued at its last known price. Check the symbol or set a price manually.',
      };
    },
  },
];

export const accountNotices = (a: AccountSummary): NoticeView[] =>
  NOTICE_RULES.filter((r) => r.applies(a)).map((r) => ({ kind: r.kind, ...r.view(a) }));

export function accountDots(a: AccountSummary): { tone: 'warn' | 'err'; title: string }[] {
  const dots: { tone: 'warn' | 'err'; title: string }[] = [];
  if (a.status.needsReauth)
    dots.push({ tone: 'err', title: `${a.institution} needs reconnection` });
  if (a.status.waiting) dots.push({ tone: 'warn', title: `Waiting on ${a.institution}` });
  if (a.status.unpriced.length) dots.push({ tone: 'warn', title: 'A holding has no price source' });
  return dots;
}

const ago = (days: number) =>
  days === 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;

const FRESHNESS: Record<BalanceSource, (a: AccountSummary, today: string) => string> = {
  provider: (a) => {
    if (!a.lastSyncAt) return 'Not synced yet';
    return a.status.needsReauth
      ? `Last synced ${fmtDay(a.lastSyncAt)}`
      : `Synced ${fmtSyncTime(a.lastSyncAt)}`;
  },
  valuation: (a) =>
    a.prices?.asOf ? `Prices as of ${fmtDay(a.prices.asOf)} close` : 'Not priced yet',
  manual: (a, today) =>
    a.asOf ? `Last entry ${fmtDay(a.asOf)} · ${ago(daysBetween(a.asOf, today))}` : 'No entries yet',
};

export const freshnessText = (a: AccountSummary, today: string) =>
  FRESHNESS[a.balanceSource](a, today);

export const navMeta = (a: AccountSummary) =>
  `${a.institution} · ${a.wrapper}${
    a.balanceSource === 'manual' && a.asOf ? ` · as of ${fmtDay(a.asOf)}` : ''
  }`;

export function sparkTone(a: AccountSummary): 'up' | 'down' | 'muted' {
  if (a.balanceSource === 'manual' || !a.change) return 'muted';
  return a.change.delta >= 0 ? 'up' : 'down';
}

export const activityEmptyText = (a: AccountSummary | null) =>
  a && !a.status.tradesReported
    ? `${a.institution} doesn’t report trades for this account — changes show as balance movement.`
    : 'No activity reported.';
