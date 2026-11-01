import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from '@/components/transactions/use-autosave';
import type { TxFields } from '@/components/transactions/types';

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(save = vi.fn<(f: TxFields) => Promise<void>>().mockResolvedValue(undefined)) {
    const hook = renderHook(() => useAutosave(save));
    return { save, hook };
  }

  it('debounces text edits by 700 ms', async () => {
    const { save, hook } = setup();
    act(() => {
      hook.result.current.edit({ merchant: 'A' });
      hook.result.current.edit({ merchant: 'AB' });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(699);
    });
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('editing');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ merchant: 'AB' });
    expect(hook.result.current.status).toBe('saved');
  });

  it('immediate edits save at once', async () => {
    const { save, hook } = setup();
    await act(async () => {
      hook.result.current.edit({ categoryId: 'c1' }, { immediate: true });
    });
    expect(save).toHaveBeenCalledWith({ categoryId: 'c1' });
  });

  it('sends only edited fields', async () => {
    const { save, hook } = setup();
    act(() => hook.result.current.edit({ note: 'n' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(Object.keys(save.mock.calls[0][0])).toEqual(['note']);
  });

  it('serialises saves and sends the latest pending fields after the in-flight one', async () => {
    let resolveFirst!: () => void;
    const save = vi
      .fn<(f: TxFields) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);
    const { hook } = setup(save);
    await act(async () => {
      hook.result.current.edit({ note: 'a' }, { immediate: true });
    });
    expect(hook.result.current.status).toBe('saving');
    await act(async () => {
      hook.result.current.edit({ note: 'b' }, { immediate: true });
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveFirst();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ note: 'b' });
    expect(hook.result.current.status).toBe('saved');
  });

  it('does not send NaN amount', async () => {
    const { save, hook } = setup();
    act(() => hook.result.current.edit({ amount: NaN }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(save).not.toHaveBeenCalled();
    expect(hook.result.current.status).toBe('invalid');
    expect(hook.result.current.message).toBe('Amount must be a number · not saved');
  });

  it('blank merchant is invalid', () => {
    const { hook } = setup();
    act(() => hook.result.current.edit({ merchant: '  ' }));
    expect(hook.result.current.status).toBe('invalid');
    expect(hook.result.current.message).toBe("Merchant can't be empty · not saved");
  });

  it('failed fields are kept and merged into the next save', async () => {
    const save = vi
      .fn<(f: TxFields) => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const { hook } = setup(save);
    await act(async () => {
      hook.result.current.edit({ note: 'a' }, { immediate: true });
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.message).toBe("Couldn't save · Try again");
    await act(async () => {
      hook.result.current.edit({ merchant: 'M' }, { immediate: true });
    });
    expect(save).toHaveBeenLastCalledWith({ note: 'a', merchant: 'M' });
    expect(hook.result.current.status).toBe('saved');
    expect(hook.result.current.message).toBeNull();
  });

  it('newer pending values win over failed ones', async () => {
    let rejectFirst!: (e: Error) => void;
    const save = vi
      .fn<(f: TxFields) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((_r, j) => (rejectFirst = j)))
      .mockResolvedValue(undefined);
    const { hook } = setup(save);
    await act(async () => {
      hook.result.current.edit({ note: 'old', merchant: 'M' }, { immediate: true });
    });
    act(() => hook.result.current.edit({ note: 'new' }));
    await act(async () => {
      rejectFirst(new Error('boom'));
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.result.current.flush();
    });
    expect(save).toHaveBeenLastCalledWith({ note: 'new', merchant: 'M' });
    expect(ok).toBe(true);
  });

  it('flush sends the pending edit and resolves true', async () => {
    const { save, hook } = setup();
    act(() => hook.result.current.edit({ note: 'x' }));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.result.current.flush();
    });
    expect(save).toHaveBeenCalledWith({ note: 'x' });
    expect(ok).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush resolves false when the save fails', async () => {
    const save = vi.fn<(f: TxFields) => Promise<void>>().mockRejectedValue(new Error('boom'));
    const { hook } = setup(save);
    act(() => hook.result.current.edit({ note: 'x' }));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.result.current.flush();
    });
    expect(ok).toBe(false);
    expect(hook.result.current.status).toBe('error');
  });

  it('a synchronously throwing save is an error, keeps fields and does not hang', async () => {
    const save = vi
      .fn<(f: TxFields) => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error('x');
      })
      .mockResolvedValue(undefined);
    const { hook } = setup(save);
    await act(async () => {
      hook.result.current.edit({ note: 'a' }, { immediate: true });
    });
    expect(hook.result.current.status).toBe('error');
    expect(hook.result.current.message).toBe("Couldn't save · Try again");
    await act(async () => {
      hook.result.current.edit({ merchant: 'M' }, { immediate: true });
    });
    expect(save).toHaveBeenLastCalledWith({ note: 'a', merchant: 'M' });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.result.current.flush();
    });
    expect(ok).toBe(true);
    expect(hook.result.current.status).toBe('saved');
  });

  it('flush awaits an in-flight save and the pending edit queued behind it', async () => {
    let resolveFirst!: () => void;
    const save = vi
      .fn<(f: TxFields) => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((r) => (resolveFirst = r)))
      .mockResolvedValue(undefined);
    const { hook } = setup(save);
    await act(async () => {
      hook.result.current.edit({ note: 'a' }, { immediate: true });
    });
    act(() => hook.result.current.edit({ note: 'b' }));
    let ok: boolean | undefined;
    let settled = false;
    await act(async () => {
      const p = hook.result.current.flush().then((v) => {
        settled = true;
        ok = v;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      resolveFirst();
      await p;
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ note: 'b' });
    expect(ok).toBe(true);
  });

  it('flush resolves false while pending fields are invalid', async () => {
    const { save, hook } = setup();
    act(() => hook.result.current.edit({ merchant: '' }));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.result.current.flush();
    });
    expect(ok).toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  it('flush with nothing pending resolves true without saving', async () => {
    const { save, hook } = setup();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.result.current.flush();
    });
    expect(ok).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it('retry resends failed fields', async () => {
    const save = vi
      .fn<(f: TxFields) => Promise<void>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(undefined);
    const { hook } = setup(save);
    await act(async () => {
      hook.result.current.edit({ note: 'a' }, { immediate: true });
    });
    await act(async () => {
      hook.result.current.retry();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith({ note: 'a' });
    expect(hook.result.current.status).toBe('saved');
  });

  it('clears the debounce timer on unmount', async () => {
    const { save, hook } = setup();
    act(() => hook.result.current.edit({ note: 'x' }));
    hook.unmount();
    await vi.advanceTimersByTimeAsync(700);
    expect(save).not.toHaveBeenCalled();
  });
});
