import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';

/** A label, a big figure and an optional line underneath. */
export function SummaryCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}) {
  return (
    <Card className="p-5">
      <div className="text-[var(--text-secondary)]">{label}</div>
      <div className={cn('mt-1 font-mono text-2xl', tone ?? 'text-[var(--text-primary)]')}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-[var(--text-muted)]">{sub}</div>}
    </Card>
  );
}
