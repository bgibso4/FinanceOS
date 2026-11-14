/** A name without its leading emoji, joiners, symbols or spaces, so "⛽️ Gas" files under G. */
export const nameSortKey = (name: string): string => name.replace(/^[^\p{L}\p{N}]+/u, '').trim();

/** Alphabetical by `nameSortKey`: case-insensitive, numbers in numeric order. */
export function byName<T extends { name: string }>(a: T, b: T): number {
  return nameSortKey(a.name).localeCompare(nameSortKey(b.name), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}
