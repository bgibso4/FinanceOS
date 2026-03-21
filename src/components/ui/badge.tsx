import React from 'react';
import { cn } from '@/lib/cn';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  tone?: 'default' | 'positive' | 'warning';
};

export function Badge({ className, tone = 'default', ...props }: Props) {
  const colors: Record<string, string> = {
    default: 'bg-[var(--track-bg)] text-[var(--text-secondary)]',
    positive: 'bg-[var(--green)]/10 text-[var(--green)]',
    warning: 'bg-[var(--accent)]/10 text-[var(--accent)]',
  };
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded px-3 py-1 text-xs font-semibold',
        colors[tone],
        className
      )}
      {...props}
    />
  );
}
