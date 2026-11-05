'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { DeleteZone } from '@/components/transactions/delete-zone';
import { SECTION_CARD, SECTION_HEAD } from '@/components/investments/account-drawer';
import { ERROR, FIELD_LABEL, errorText, sendJson } from '@/components/investments/editor-kit';
import { triggerSync } from '@/lib/cloud-sync';
import type { Suggestion, TripRecord } from '@/lib/travel/types';
import { SuggestionList } from './suggestion-list';

export type TripDrawerMode =
  | { kind: 'new' }
  | { kind: 'edit'; trip: TripRecord }
  | { kind: 'review'; trip: TripRecord }
  | null;

type TripDrawerProps = {
  baseCurrency: string;
  mode: TripDrawerMode;
  onClose: () => void;
  onSaved: (tripId: string) => void;
  onDeleted: () => void;
};

const BUTTON = 'h-10 px-[18px] text-sm';
const TRIPS_URL = '/api/travel/trips';

const plural = (n: number) => `${n} transaction${n === 1 ? '' : 's'}`;

export function TripDrawer({ baseCurrency, mode, onClose, onSaved, onDeleted }: TripDrawerProps) {
  const existing = mode && mode.kind !== 'new' ? mode.trip : null;
  const [trip, setTrip] = useState<TripRecord | null>(existing);
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [step, setStep] = useState<1 | 2>(1);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // False until the suggestions arrive: review opens on step 2 before the fetch returns.
  const [loaded, setLoaded] = useState(false);

  const kind = mode?.kind;
  const existingId = existing?.id;

  const loadSuggestions = async (tripId: string) => {
    const { suggestions: list } = await sendJson<{ suggestions: Suggestion[] }>(
      `${TRIPS_URL}/${tripId}/suggestions`,
      'GET'
    );
    setSuggestions(list);
    setTicked(new Set(list.filter((s) => s.preTicked).map((s) => s.tx.id)));
    setLoaded(true);
    setStep(2);
  };

  // A different trip or mode starts from scratch; review opens straight on the suggestions.
  useEffect(() => {
    if (!kind) return;
    setTrip(existing);
    setName(existing?.name ?? '');
    setStartDate(existing?.startDate ?? '');
    setEndDate(existing?.endDate ?? '');
    setSuggestions([]);
    setTicked(new Set());
    setError(null);
    setPending(false);
    setLoaded(false);
    setStep(1);
    if (kind === 'review' && existingId) {
      setStep(2);
      loadSuggestions(existingId).catch((e) => setError(errorText(e)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the target changes
  }, [kind, existingId]);

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  };

  /** Creates the trip on first save, updates it afterwards. */
  const saveDetails = async (): Promise<TripRecord | null> => {
    if (!name.trim() || !startDate || !endDate) {
      setError('Give the trip a name and both dates.');
      return null;
    }
    const body = { name, startDate, endDate };
    const saved = trip
      ? await sendJson<TripRecord>(`${TRIPS_URL}/${trip.id}`, 'PATCH', body)
      : await sendJson<TripRecord>(TRIPS_URL, 'POST', body);
    setTrip(saved);
    triggerSync();
    return saved;
  };

  const save = () =>
    run(async () => {
      const saved = await saveDetails();
      if (saved) onSaved(saved.id);
    });

  const findTransactions = () =>
    run(async () => {
      const saved = await saveDetails();
      if (saved) await loadSuggestions(saved.id);
    });

  const retry = () => {
    if (trip) run(() => loadSuggestions(trip.id));
  };

  const submit = () =>
    run(async () => {
      if (!trip) return;
      const add = suggestions.filter((s) => ticked.has(s.tx.id)).map((s) => s.tx.id);
      const dismiss = suggestions.filter((s) => !ticked.has(s.tx.id)).map((s) => s.tx.id);
      await sendJson(`${TRIPS_URL}/${trip.id}/suggestions`, 'POST', { add, dismiss });
      triggerSync();
      onSaved(trip.id);
    });

  const remove = async () => {
    if (!trip) return;
    try {
      await sendJson(`${TRIPS_URL}/${trip.id}`, 'DELETE');
      triggerSync();
      onDeleted();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const toggle = (txId: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(txId)) next.add(txId);
      return next;
    });

  const isEdit = kind === 'edit';
  const inReview = kind === 'review';
  const count = ticked.size;

  const footer = (
    <div className="flex flex-col items-end gap-2">
      {error && (
        <p className={ERROR} role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {step === 1 ? (
          <>
            <Button className={BUTTON} type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {isEdit && (
              <Button
                className={BUTTON}
                disabled={pending}
                type="button"
                variant="outline"
                onClick={save}
              >
                Save
              </Button>
            )}
            <Button className={BUTTON} disabled={pending} type="button" onClick={findTransactions}>
              {isEdit ? 'Find transactions' : 'Next: find transactions'}
            </Button>
          </>
        ) : (
          <>
            <Button
              className={BUTTON}
              type="button"
              variant="ghost"
              onClick={inReview ? onClose : () => setStep(1)}
            >
              {inReview ? 'Cancel' : 'Back'}
            </Button>
            {loaded && suggestions.length === 0 && (
              <Button className={BUTTON} type="button" onClick={onClose}>
                Done
              </Button>
            )}
            {loaded && suggestions.length > 0 && (
              <Button className={BUTTON} disabled={pending} type="button" onClick={submit}>
                {count === 0 ? 'Done' : `Add ${plural(count)}`}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <Drawer
      footer={footer}
      open={mode !== null}
      subtitle={
        inReview ? undefined : (
          <span>
            <b className={step === 1 ? 'text-[var(--text-primary)]' : undefined}>1</b> Details ·{' '}
            <b className={step === 2 ? 'text-[var(--text-primary)]' : undefined}>2</b> Add
            transactions
          </span>
        )
      }
      title={isEdit || inReview ? (existing?.name ?? '') : 'New trip'}
      onClose={onClose}
    >
      {step === 1 ? (
        <div>
          <section className={SECTION_CARD}>
            <h3 className={SECTION_HEAD}>Trip</h3>
            <div className="flex flex-col gap-4">
              <div>
                <label className={FIELD_LABEL} htmlFor="trip-name">
                  Name
                </label>
                <Input id="trip-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={FIELD_LABEL} htmlFor="trip-start">
                    Leave
                  </label>
                  <Input
                    id="trip-start"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className={FIELD_LABEL} htmlFor="trip-end">
                    Return
                  </label>
                  <Input
                    id="trip-end"
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>
          {isEdit && (
            <div className="mt-4">
              <DeleteZone
                confirmText="Delete this trip? Its transactions are kept."
                label="Delete trip"
                onDelete={remove}
              />
            </div>
          )}
        </div>
      ) : (
        <>
          {!loaded && error && (
            <div className="flex flex-col items-start gap-3 text-sm text-[var(--text-secondary)]">
              <span>Could not load suggestions.</span>
              <Button className={BUTTON} disabled={pending} type="button" onClick={retry}>
                Retry
              </Button>
            </div>
          )}
          {!loaded && !error && (
            <p className="text-sm text-[var(--text-muted)]">Finding transactions…</p>
          )}
          {loaded && suggestions.length === 0 && (
            <p className="text-sm text-[var(--text-muted)]">Nothing to review</p>
          )}
          {loaded && suggestions.length > 0 && (
            <SuggestionList
              baseCurrency={baseCurrency}
              suggestions={suggestions}
              ticked={ticked}
              onToggle={toggle}
            />
          )}
        </>
      )}
    </Drawer>
  );
}
