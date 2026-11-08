/**
 * One value per server process, kept on globalThis. The production build bundles a module once per
 * entry that imports it (instrumentation and the API routes each get their own copy), and dev hot
 * reload re-runs modules, so module-level state is NOT one-per-process. State that must be shared
 * across those copies (the sync locks, the database client) lives here instead.
 */
export function processGlobal<T>(key: string, create: () => T): T {
  const store = globalThis as unknown as Record<string, T | undefined>;
  return (store[key] ??= create());
}
