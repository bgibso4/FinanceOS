/** A route's `details`: a message, or validation issues that each carry one. */
function detailText(details: unknown): string | undefined {
  if (typeof details === 'string') return details;
  if (!Array.isArray(details)) return undefined;
  const messages = details.map((d: { message?: unknown }) => d?.message).filter(Boolean);
  return messages.length > 0 ? messages.join(', ') : undefined;
}

/** JSON request; resolves to the parsed body, or throws an Error with the API's `error` and `details`. */
export async function sendJson<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const details = detailText(data.details);
    const error = data.error ?? 'Something went wrong';
    throw new Error(details ? `${error}: ${details}` : error);
  }
  return data as T;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
