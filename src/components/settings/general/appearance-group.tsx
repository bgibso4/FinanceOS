'use client';

import { useEffect, useState } from 'react';
import { getTheme, setTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/cn';
import { SettingsGroup, SettingsRow } from './settings-group';

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

/** Theme, applied the moment it is picked. */
export function AppearanceGroup() {
  const [theme, setChosen] = useState<Theme | null>(null);
  // Read after mount: the stored theme lives in the browser, not in the server render.
  useEffect(() => setChosen(getTheme()), []);

  const choose = (t: Theme) => {
    setTheme(t);
    setChosen(t);
  };

  return (
    <SettingsGroup caption="Appearance">
      <SettingsRow
        control={
          <div
            aria-label="Theme"
            className="inline-flex rounded-[9px] bg-[var(--track-bg)] p-0.5"
            role="radiogroup"
          >
            {THEMES.map((t) => (
              <button
                key={t.value}
                aria-checked={theme === t.value}
                className={cn(
                  'rounded-[7px] px-3.5 py-[5px] text-[13px]',
                  theme === t.value
                    ? 'bg-[var(--bg-card)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-[var(--bg-elevated)] dark:shadow-none'
                    : 'text-[var(--text-secondary)]'
                )}
                role="radio"
                type="button"
                onClick={() => choose(t.value)}
              >
                {t.label}
              </button>
            ))}
          </div>
        }
        label="Theme"
      />
    </SettingsGroup>
  );
}
