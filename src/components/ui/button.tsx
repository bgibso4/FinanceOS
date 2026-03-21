import React from 'react';
import { cn } from '@/lib/cn';

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'outline' | 'destructive';
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  { className, variant = 'primary', ...props },
  ref
) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 disabled:cursor-not-allowed';
  const variants: Record<string, string> = {
    primary:
      'bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:bg-[var(--bg-card)] border border-[var(--border)] focus-visible:outline-[var(--accent)]',
    ghost:
      'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-[var(--border)]',
    outline:
      'border border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] focus-visible:outline-[var(--border)]',
    destructive: 'bg-[var(--red)] text-white hover:opacity-90 focus-visible:outline-[var(--red)]',
  };
  return <button ref={ref} className={cn(base, variants[variant], className)} {...props} />;
});
