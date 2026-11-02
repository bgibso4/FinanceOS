import { useCallback, useEffect, useRef, useState } from 'react';
import { validateFields } from './types';
import type { TxFields } from './types';

export const AUTOSAVE_DELAY_MS = 700;

export type SaveStatus = 'saved' | 'editing' | 'saving' | 'error' | 'invalid';

const SAVE_FAILED_MESSAGE = "Couldn't save · Try again";

const isEmpty = (f: TxFields) => Object.keys(f).length === 0;

export function useAutosave(
  save: (fields: TxFields) => Promise<void>,
  delayMs = AUTOSAVE_DELAY_MS
) {
  const [state, setState] = useState<{ status: SaveStatus; message: string | null }>({
    status: 'saved',
    message: null,
  });
  const saveRef = useRef(save);
  const pendingRef = useRef<TxFields>({});
  const inFlightRef = useRef<Promise<void> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const awaitInFlight = useCallback(async () => {
    // Re-check after each wake: another queued run may have started a new save meanwhile.
    while (inFlightRef.current) await inFlightRef.current;
  }, []);

  const run = useCallback(async () => {
    await awaitInFlight();
    const fields = pendingRef.current;
    if (isEmpty(fields) || validateFields(fields)) return;
    pendingRef.current = {};
    setState({ status: 'saving', message: null });
    // Deferred a tick so inFlightRef is assigned before save runs; a synchronous throw would
    // otherwise hit finally first and leave the ref pointing at a settled promise.
    const attempt = Promise.resolve().then(async () => {
      try {
        await saveRef.current(fields);
        if (isEmpty(pendingRef.current)) setState({ status: 'saved', message: null });
      } catch {
        // Newer edits made while this save was in flight take precedence.
        pendingRef.current = { ...fields, ...pendingRef.current };
        setState({ status: 'error', message: SAVE_FAILED_MESSAGE });
      } finally {
        inFlightRef.current = null;
      }
    });
    inFlightRef.current = attempt;
    await attempt;
  }, [awaitInFlight]);

  const edit = useCallback(
    (fields: TxFields, opts?: { immediate?: boolean }) => {
      clearTimer();
      pendingRef.current = { ...pendingRef.current, ...fields };
      const invalid = validateFields(pendingRef.current);
      if (invalid) {
        setState({ status: 'invalid', message: invalid });
        return;
      }
      setState({ status: 'editing', message: null });
      if (opts?.immediate) void run();
      else timerRef.current = setTimeout(() => void run(), delayMs);
    },
    [clearTimer, run, delayMs]
  );

  const flush = useCallback(async () => {
    clearTimer();
    await run();
    await awaitInFlight();
    return isEmpty(pendingRef.current);
  }, [clearTimer, run, awaitInFlight]);

  const retry = useCallback(() => {
    void flush();
  }, [flush]);

  useEffect(() => clearTimer, [clearTimer]);

  return { status: state.status, message: state.message, edit, flush, retry };
}
