import { cn } from '@/lib/cn';

type TabsProps = {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
};

export function Tabs({ tabs, active, onChange, className }: TabsProps) {
  return (
    <div className={cn('flex items-center gap-6 text-sm font-medium', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={cn(
            'pb-2 transition-colors duration-[250ms] border-b-2',
            active === tab.id
              ? 'text-[var(--text-primary)] border-[var(--accent)]'
              : 'text-[var(--text-muted)] border-transparent hover:text-[var(--text-secondary)]'
          )}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
