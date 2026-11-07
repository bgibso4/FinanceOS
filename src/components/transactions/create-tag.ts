import type { TagDef } from '@/components/tag-input';

/** Creates a tag; null when the request fails. */
export async function postTag(name: string): Promise<TagDef | null> {
  try {
    const res = await fetch('/api/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: 'blue' }),
    });
    return res.ok ? ((await res.json()) as TagDef) : null;
  } catch {
    return null;
  }
}
