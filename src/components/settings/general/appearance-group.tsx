import { useEffect, useState } from 'react';
import { getTheme, setTheme, type Theme } from '@/lib/theme';
import { SegmentedControl } from '@/components/ui/segmented-control';
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
          <SegmentedControl label="Theme" options={THEMES} value={theme} onChange={choose} />
        }
        label="Theme"
      />
    </SettingsGroup>
  );
}
