/** JSON request; resolves to the parsed body, or throws an Error carrying the API's `error`. */
export async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'Something went wrong');
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

export const FIELD_LABEL = 'mb-1 block text-[12.5px] font-medium text-[var(--text-secondary)]';
export const HINT = 'mt-1.5 text-[11.5px] text-[var(--text-muted)]';
export const ERROR = 'mt-2 text-xs text-[var(--red)]';
