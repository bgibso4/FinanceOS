import React from 'react';
import { cn } from '@/lib/cn';

type Props = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: Props) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] px-3 text-sm shadow-sm transition-colors duration-[250ms] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}
