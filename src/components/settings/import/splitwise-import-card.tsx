'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SettingsGroup, SettingsRow } from '@/components/settings/general/settings-group';
import { useDrawerReferenceData } from '@/components/transactions/use-drawer-reference-data';
import { triggerSync } from '@/lib/cloud-sync';
import { errorText, sendJson } from '@/lib/send-json';
import { groupFromFileName } from '@/lib/splitwise/export';
import { FirstImportPanel } from './first-import-panel';
import { API, ImportResultView, type ImportView } from './import-result-view';

type PickedFile = { fileName: string; text: string };

type Phase =
  | { kind: 'ready' }
  | { kind: 'first'; file: PickedFile; group: string }
  | { kind: 'done'; result: ImportView }
  | { kind: 'undone' };

const READY: Phase = { kind: 'ready' };

/** P6: the institution of the account Splitwise imports default to. */
const SPLITWISE_INSTITUTION = 'Splitwise';

/** Settings → Import: imports a Splitwise export into one account, then shows what it did. */
export function SplitwiseImportCard() {
  const { refs, error: refsError } = useDrawerReferenceData();
  /** The remembered or chosen account; see `chosenId` for the one actually used. */
  const [accountId, setAccountId] = useState('');
  const [person, setPerson] = useState('');
  const [phase, setPhase] = useState<Phase>(READY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sendJson<{ accountId: string | null; person: string }>(API, 'GET')
      .then((d) => {
        setAccountId(d.accountId ?? '');
        setPerson(d.person);
      })
      .catch((e) => setError(errorText(e)));
  }, []);

  // Only active accounts can be chosen. A remembered account that has since been closed falls
  // back to the active Splitwise account, else to none.
  const activeAccounts = refs.accounts.filter((a) => a.isActive !== false);
  const chosenId =
    accountId === '' || activeAccounts.some((a) => a.id === accountId)
      ? accountId
      : (activeAccounts.find((a) => a.institution === SPLITWISE_INSTITUTION)?.id ?? '');

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: PickedFile, skipBefore?: string) => {
    const result = await sendJson<ImportView>(API, 'POST', {
      accountId: chosenId,
      person: person.trim(),
      ...file,
      skipBefore,
    });
    setPhase({ kind: 'done', result });
    triggerSync();
  };

  // A group seen before imports at once; a new one asks first. A file not named like an
  // export goes straight to the route, which says what's wrong with it.
  const pick = async (picked: File) => {
    setError(null);
    if (!chosenId || !person.trim()) {
      setError('Choose the account and type your name as it is in Splitwise, then pick the file.');
      return;
    }
    const file = { fileName: picked.name, text: await picked.text() };
    const group = groupFromFileName(file.fileName);
    await act(async () => {
      if (!group) return importFile(file);
      const query = new URLSearchParams({ accountId: chosenId, group });
      const { known } = await sendJson<{ known: boolean }>(`${API}?${query}`, 'GET');
      if (known) await importFile(file);
      else setPhase({ kind: 'first', file, group });
    });
  };

  const picker = (label: string) => (
    <label className="inline-flex cursor-pointer items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]">
      {label}
      <input
        accept=".csv,text/csv"
        aria-label="Splitwise export file"
        className="sr-only"
        disabled={busy}
        type="file"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          // Cleared so picking the same file again still counts as a change.
          e.target.value = '';
          if (picked) void pick(picked);
        }}
      />
    </label>
  );

  const accountName = refs.accounts.find((a) => a.id === chosenId)?.name ?? 'the account';
  const errors = [refsError, error].filter(Boolean);

  return (
    <SettingsGroup caption="Splitwise">
      {errors.map((message) => (
        <p
          key={message}
          className="border-b border-[var(--border)] px-[18px] py-3 text-sm text-[var(--red)]"
          role="alert"
        >
          {message}
        </p>
      ))}

      {phase.kind === 'done' ? (
        <ImportResultView
          accountName={accountName}
          act={act}
          busy={busy}
          refs={refs}
          result={phase.result}
          update={(change) =>
            setPhase((p) => (p.kind === 'done' ? { ...p, result: change(p.result) } : p))
          }
          onAnother={() => setPhase(READY)}
          onUndone={() => setPhase({ kind: 'undone' })}
        />
      ) : phase.kind === 'undone' ? (
        <SettingsRow
          control={
            <Button variant="outline" onClick={() => setPhase(READY)}>
              Start over
            </Button>
          }
          description="The transactions it created are gone and changed rows are back to their earlier amounts. FinanceOS no longer remembers this file, so the next import starts fresh."
          label="Import undone"
        />
      ) : (
        <>
          <SettingsRow
            control={
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <label htmlFor="splitwise-account">Into</label>
                <Select
                  className="h-9 w-40"
                  id="splitwise-account"
                  value={chosenId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  <option value="">Choose account</option>
                  {activeAccounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
                <label htmlFor="splitwise-person">as</label>
                <Input
                  className="h-9 w-36"
                  id="splitwise-person"
                  placeholder="Your name"
                  value={person}
                  onChange={(e) => setPerson(e.target.value)}
                />
              </div>
            }
            description="A group or friend export from splitwise.com. Only your column is read; it imports into your Splitwise account straight away."
            label="Import a Splitwise export"
          />
          {phase.kind === 'first' ? (
            <FirstImportPanel
              busy={busy}
              fileName={phase.file.fileName}
              group={phase.group}
              person={person}
              picker={picker('Choose another file')}
              text={phase.file.text}
              onImport={(skipBefore) => void act(() => importFile(phase.file, skipBefore))}
            />
          ) : (
            <SettingsRow
              control={picker('Choose file')}
              description="The CSV Splitwise saves, named like group_2026-11-08_export.csv."
              label="Export file"
            />
          )}
        </>
      )}
    </SettingsGroup>
  );
}
