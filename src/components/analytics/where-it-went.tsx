'use client';

import { Pie, PieChart } from 'recharts';
import { Card } from '@/components/ui/card';
import { fmtMoney } from '@/lib/currency';
import { prefersReducedMotion } from '@/lib/motion';

type Slice = { key: string; label: string; amount: number; color: string };

const SHOWN = 5;
const REST: Omit<Slice, 'amount'> = {
  key: 'rest',
  label: 'Everything else',
  color: 'var(--text-muted)',
};

/**
 * A ring and the top five (slices ranked biggest first, coloured by the caller), plus "Everything
 * else". `showAll` lists every slice, so each chart line keeps its colour in the ring (M7).
 */
export function WhereItWent({ slices, showAll = false }: { slices: Slice[]; showAll?: boolean }) {
  // Net credits can leave a category below zero; it took nothing, so it has no slice.
  const spent = slices.filter((s) => s.amount > 0);
  const restAmount = showAll ? 0 : spent.slice(SHOWN).reduce((sum, s) => sum + s.amount, 0);
  const shown =
    restAmount > 0 ? [...spent.slice(0, SHOWN), { ...REST, amount: restAmount }] : spent;
  const total = shown.reduce((sum, s) => sum + s.amount, 0);

  return (
    <Card className="p-5">
      <span className="text-[13px] font-semibold text-[var(--text-secondary)]">Where it went</span>
      {shown.length ? (
        <div className="mt-3 flex items-center gap-[18px]">
          <PieChart className="flex-none" height={130} width={130}>
            <Pie
              data={shown.map((s) => ({ ...s, fill: s.color }))}
              dataKey="amount"
              endAngle={-270}
              innerRadius={39}
              isAnimationActive={!prefersReducedMotion()}
              nameKey="label"
              outerRadius={65}
              startAngle={90}
              stroke="var(--bg-card)"
              strokeWidth={2}
            />
          </PieChart>
          <ul aria-label="Top categories" className="flex min-w-0 flex-1 flex-col gap-2">
            {shown.map((s) => (
              <li key={s.key} className="text-[13px]">
                <div className="flex justify-between gap-2 text-[var(--text-primary)]">
                  <span className="truncate">{s.label}</span>
                  <span className="font-mono">{fmtMoney(s.amount)}</span>
                </div>
                <div className="mt-[3px] h-[5px] overflow-hidden rounded-[3px] bg-[var(--track-bg)]">
                  <i
                    className="block h-full rounded-[3px]"
                    style={{ width: `${(s.amount / total) * 100}%`, background: s.color }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="p-7 text-center text-[var(--text-muted)]">Nothing to show</p>
      )}
    </Card>
  );
}
