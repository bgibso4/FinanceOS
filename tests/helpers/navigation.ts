import { useMemo, useSyncExternalStore } from 'react';
import { vi } from 'vitest';

/**
 * A stand-in for next/navigation whose address is real state: `router.replace` and `router.push`
 * change what `useSearchParams` returns and re-render its readers, as Next does.
 * Use with `vi.mock('next/navigation', () => import('<path>/helpers/navigation'))`.
 */
let search = '';
const listeners = new Set<() => void>();

/** Sets the address's query string (no leading "?") and re-renders readers. */
export function setSearch(next: string) {
  search = next;
  listeners.forEach((l) => l());
}

const go = (href: string) => setSearch(href.split('?')[1] ?? '');

export const router = {
  push: vi.fn(go),
  replace: vi.fn(go),
  prefetch: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
};

/** Clears the address and the router's call history; call in beforeEach. */
export function resetNavigation(initial = '') {
  router.push.mockClear();
  router.replace.mockClear();
  search = initial;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useSearchParams(): URLSearchParams {
  const s = useSyncExternalStore(subscribe, () => search);
  return useMemo(() => new URLSearchParams(s), [s]);
}

export const useRouter = () => router;
export const usePathname = () => '/analytics';
