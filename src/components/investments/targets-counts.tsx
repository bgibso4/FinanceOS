'use client';

import { fmtMoney } from '@/lib/currency';
import type { FinalTarget } from '@/lib/investments/targets/allocation';
import type { TargetSettingsView } from '@/lib/investments/targets/settings';
import {
  CardShell,
  Dot,
  FieldSelect,
  HINT_TEXT,
  MONO,
  Pill,
  TH,
  fraction,
  type BuyOption,
} from './targets-kit';

type Account = TargetSettingsView['accounts'][number];
type Fund = TargetSettingsView['funds'][number];

/** An account counts when it is ticked and has holdings behind its balance. */
const counts = (a: Account, ticked: boolean) => ticked && !a.balanceOnly;

/** The resulting split across every target, live as the drafts change. */
export function SummaryCard({
  accounts,
  buyOptions,
  colorOf,
  currency,
  final,
  isTicked,
}: {
  accounts: Account[];
  buyOptions: BuyOption[];
  colorOf: (targetKey: string) => string;
  currency: string;
  final: FinalTarget[];
  isTicked: (accountId: string) => boolean;
}) {
  const live = final.filter((t) => t.target > 0);
  const counted = accounts.filter((a) => counts(a, isTicked(a.id)));
  const buyLabel = (id: string | null) => buyOptions.find((o) => o.id === id)?.label;
  return (
    <CardShell
      pill={
        <span className={HINT_TEXT}>
          {fmtMoney(
            counted.reduce((s, a) => s + a.valueBase, 0),
            { currency }
          )}{' '}
          in {counted.length} counted {counted.length === 1 ? 'account' : 'accounts'}
        </span>
      }
      title="Your targets"
    >
      <div
        aria-label="Target allocation"
        className="mt-3 flex h-2.5 gap-0.5 overflow-hidden rounded-[5px] bg-[var(--border)]"
        role="img"
      >
        {live.map((t) => (
          <i key={t.key} style={{ flex: `${t.target} 0 0`, background: colorOf(t.key) }} />
        ))}
      </div>
      <ul className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-x-[18px] gap-y-2.5">
        {live.map((t) => (
          <li key={t.key} className="grid grid-cols-[8px_minmax(0,1fr)] items-baseline gap-x-2">
            <Dot color={colorOf(t.key)} />
            <b className="truncate text-[12.5px] font-medium text-[var(--text-primary)]">
              {t.name}
            </b>
            <span className="col-start-2 text-[11.5px] text-[var(--text-muted)]">
              <span className={`${MONO} mr-1.5 text-[13px] text-[var(--text-primary)]`}>
                {fraction(t.target)}
              </span>
              {buyLabel(t.buySecurityId) ? `buy ${buyLabel(t.buySecurityId)}` : 'no fund picked'}
            </span>
          </li>
        ))}
      </ul>
    </CardShell>
  );
}

export function AccountsCard({
  accounts,
  currency,
  isTicked,
  onToggle,
}: {
  accounts: Account[];
  currency: string;
  isTicked: (accountId: string) => boolean;
  onToggle: (accountId: string, ticked: boolean) => void;
}) {
  const counted = accounts.filter((a) => counts(a, isTicked(a.id))).length;
  return (
    <CardShell
      collapseKey="accounts"
      pill={
        <Pill>
          {counted} of {accounts.length} counted
        </Pill>
      }
      subtitle="Ticked accounts count toward your targets."
      title="Accounts"
    >
      <ul>
        {accounts.map((a) => {
          const ticked = isTicked(a.id);
          const note = [a.institution, a.balanceOnly && 'Balance only, no funds to count']
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={a.id} className="border-t border-[var(--border)]">
              <label className="grid cursor-pointer grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-3 py-2">
                <input
                  checked={ticked}
                  className="size-4 accent-[var(--accent)]"
                  type="checkbox"
                  onChange={(e) => onToggle(a.id, e.target.checked)}
                />
                <span className="min-w-0">
                  <span
                    className={`block truncate text-[13px] font-medium ${ticked ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                  >
                    {a.name}
                  </span>
                  {note && (
                    <span className="block text-[11.5px] text-[var(--text-muted)]">{note}</span>
                  )}
                </span>
                <span
                  className={`${MONO} ${counts(a, ticked) ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}
                >
                  {fmtMoney(a.valueBase, { currency })}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </CardShell>
  );
}

const FUND_GRID =
  'grid min-w-[420px] grid-cols-[minmax(0,1fr)_78px_minmax(160px,210px)] items-center gap-x-3';

export function FundsCard({
  accounts,
  currency,
  final,
  funds,
  isTicked,
  onAssign,
  shownKey,
}: {
  accounts: Account[];
  currency: string;
  final: FinalTarget[];
  funds: Fund[];
  isTicked: (accountId: string) => boolean;
  onAssign: (securityId: string, targetKey: string) => void;
  /** The target a fund's picker shows: '' when it is not counted. */
  shownKey: (fund: Fund) => string;
}) {
  // Accounts that share a name are told apart by their institution.
  const label = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    if (!a) return '';
    const shared = accounts.filter((x) => x.name === a.name).length > 1;
    return shared && a.institution ? `${a.name} (${a.institution})` : a.name;
  };
  const assigned = funds.filter((f) => shownKey(f)).length;
  const leftOut = (f: Fund) => !f.heldIn.some(isTicked);
  return (
    <CardShell
      collapseKey="funds"
      pill={
        <Pill tone={funds.some((f) => !shownKey(f) && !leftOut(f)) ? 'warn' : undefined}>
          {assigned} of {funds.length} assigned
        </Pill>
      }
      subtitle="Which target each fund you hold counts toward."
      title="Funds"
    >
      <div className="overflow-x-auto">
        <div className={FUND_GRID}>
          <div className={TH}>Fund</div>
          <div className={`${TH} text-right`}>Value</div>
          <div className={TH}>Counts toward</div>
        </div>
        {funds.map((f) => {
          const off = leftOut(f);
          const tone = off ? 'text-[var(--text-muted)]' : 'text-[var(--text-primary)]';
          return (
            <div
              key={f.securityId}
              className={`${FUND_GRID} min-h-[42px] border-t border-[var(--border)] py-[5px]`}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className={`${MONO} font-medium ${tone}`}>{f.label}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--text-muted)]">
                    {f.name}
                  </span>
                  {off && (
                    <span className="whitespace-nowrap rounded border border-[var(--border-hover)] px-[5px] text-[10.5px] text-[var(--text-muted)]">
                      account left out
                    </span>
                  )}
                </div>
                <span className="block truncate text-[11.5px] text-[var(--text-muted)]">
                  {f.heldIn.map(label).join(', ')}
                </span>
              </div>
              <div
                className={`${MONO} text-right ${off ? 'text-[var(--text-muted)]' : 'text-[var(--text-secondary)]'}`}
              >
                {fmtMoney(f.valueBase, { currency })}
              </div>
              <FieldSelect
                aria-label={`Target for ${f.label}`}
                muted={!shownKey(f)}
                value={shownKey(f)}
                onChange={(e) => onAssign(f.securityId, e.target.value)}
              >
                <option value="">Not counted</option>
                {final.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.className ? `${t.className} · ${t.name}` : t.name}
                  </option>
                ))}
              </FieldSelect>
            </div>
          );
        })}
      </div>
    </CardShell>
  );
}
