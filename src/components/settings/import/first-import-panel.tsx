'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SettingsFooter, SettingsRow } from '@/components/settings/general/settings-group';
import { localDay } from '@/lib/dates';
import { plural } from '@/lib/plural';
import { errorText } from '@/lib/send-json';
import { readSplitwiseExport } from '@/lib/splitwise/export';

type Base = 'all' | 'cut';

const BASES: { value: Base; label: string }[] = [
  { value: 'all', label: 'Import everything' },
  { value: 'cut', label: 'Skip rows before' },
];

/** The one question a group's first import asks: import everything, or skip rows before a date. */
export function FirstImportPanel({
  fileName,
  text,
  person,
  group,
  busy,
  picker,
  onImport,
}: {
  fileName: string;
  text: string;
  person: string;
  group: string;
  busy: boolean;
  /** The control that picks another file. */
  picker: ReactNode;
  onImport: (skipBefore?: string) => void;
}) {
  const [base, setBase] = useState<Base>('all');
  const [cut, setCut] = useState(localDay);

  // Read in the browser for the counts; a wrong name or file says why here, before importing.
  const file = useMemo(() => {
    try {
      return { export: readSplitwiseExport(text, person), error: null };
    } catch (e) {
      return { export: null, error: errorText(e) };
    }
  }, [text, person]);

  const people = file.export?.people.length ?? 0;
  const summary = file.export
    ? ` · ${people} ${people === 1 ? 'person' : 'people'} · ${plural(
        file.export.rows.length + file.export.others.length,
        'row'
      )}`
    : '';

  return (
    <>
      <div className="flex items-center justify-between gap-5 border-t border-[var(--border)] px-[18px] py-[15px]">
        <div className="text-sm">
          <span className="font-mono text-[var(--text-primary)]">{fileName}</span>
          <span className="text-xs text-[var(--text-muted)]">{summary}</span>
        </div>
        {picker}
      </div>
      {file.error && (
        <p className="border-t border-[var(--border)] px-[18px] py-3 text-sm text-[var(--red)]">
          {file.error}
        </p>
      )}
      <SettingsRow
        control={
          <div className="flex items-center gap-2">
            <SegmentedControl
              label="Rows to import"
              options={BASES}
              value={base}
              onChange={setBase}
            />
            <input
              aria-label="Skip rows dated before"
              className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-2 text-sm text-[var(--text-primary)] disabled:opacity-50"
              disabled={base !== 'cut'}
              type="date"
              value={cut}
              onChange={(e) => setCut(e.target.value)}
            />
          </div>
        }
        description="Did you already type some of these into FinanceOS by hand? Rows before the date are left out, now and on every later import."
        label={`First import of ${group}`}
      />
      <SettingsFooter
        action={
          <Button
            disabled={busy || !file.export || (base === 'cut' && !cut)}
            variant="accent"
            onClick={() => onImport(base === 'cut' ? cut : undefined)}
          >
            Import
          </Button>
        }
      >
        {null}
      </SettingsFooter>
    </>
  );
}
