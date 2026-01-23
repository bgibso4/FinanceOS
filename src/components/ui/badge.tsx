import React from 'react';
import { cn } from '@/lib/cn';

type Props = React.HTMLAttributes<HTMLDivElement> & {
  tone?: 'default' | 'positive' | 'warning';
};

export function Badge({ className, tone = 'default', ...props }: Props) {
  const colors: Record<string, string> = {
    default: 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200',
    positive: 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400',
    warning: 'bg-amber-50 dark:bg-amber-950 text-amber-800 dark:text-amber-400',
  };
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold',
        colors[tone],
        className
      )}
      {...props}
    />
  );
}
