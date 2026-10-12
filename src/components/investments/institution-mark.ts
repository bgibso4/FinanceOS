import { PIE_COLORS } from '@/components/chart-renderer';

/** Initials (first letters of up to two words) and a stable palette colour for an institution. */
export function institutionMark(name: string): { initials: string; color: string } {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const initials =
    words
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?';
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { initials, color: PIE_COLORS[hash % PIE_COLORS.length] };
}
