'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { errorText, sendJson } from '@/lib/send-json';
import { money } from './format';

type BudgetCardProps = {
  year: number;
  spent: number;
  /** The year's budget target, or null when none is set. */
  target: number | null;
  currency: string;
  onSaved: () => void;
};

export function BudgetCard({ year, spent, target, currency, onSaved }: BudgetCardProps) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const showInput = target === null || editing;
  const over = target !== null && spent > target;
  const value = Number(amount);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await sendJson('/api/travel/budget', 'PUT', { year, amount: value });
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-secondary)]">Travel budget</span>
        {target !== null && !showInput && (
          <span className="flex items-center gap-3 text-xs">
            <span className={over ? 'text-[var(--red)]' : 'text-[var(--green)]'}>
              {over
                ? `${money(spent - target, currency)} over`
                : `${money(target - spent, currency)} left`}
            </span>
            <button
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              type="button"
              onClick={() => {
                setAmount(String(target));
                setEditing(true);
              }}
            >
              Edit
            </button>
          </span>
        )}
      </div>
      <div className="mt-1 font-mono text-2xl text-[var(--text-primary)]">
        {money(spent, currency)}
        {target !== null && (
          <span className="ml-1 text-sm text-[var(--text-muted)]">{`of ${money(target, currency)}`}</span>
        )}
      </div>
      {showInput ? (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            aria-label="Travel budget amount"
            min={1}
            placeholder="Yearly budget"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Button
            className="whitespace-nowrap"
            disabled={pending || !(value > 0)}
            type="submit"
            variant="outline"
          >
            Set budget
          </Button>
          {editing && (
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </form>
      ) : (
        <div className="my-3 h-[7px] overflow-hidden rounded-full bg-[var(--track-bg)]">
          <i
            className="block h-full rounded-full"
            style={{
              width: `${Math.min(100, (spent / (target ?? 1)) * 100)}%`,
              background: over ? 'var(--red)' : 'var(--accent)',
              opacity: over ? 0.6 : 0.55,
            }}
          />
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        Counts trips plus Travel spending not on a trip
      </p>
    </Card>
  );
}
