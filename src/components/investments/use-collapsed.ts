'use client';

import { useState } from 'react';

/** The ids collapsed under `storageKey`, remembered in this browser. */
function readCollapsed(storageKey: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as string[];
  } catch {
    return [];
  }
}

/**
 * Whether the section `id` is collapsed, and a toggle that remembers the choice under
 * `storageKey`. Without an `id` the section never collapses.
 */
export function useCollapsed(storageKey: string, id?: string): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => !!id && readCollapsed(storageKey).includes(id));
  const toggle = () => {
    if (!id) return;
    setCollapsed(!collapsed);
    try {
      const rest = readCollapsed(storageKey).filter((k) => k !== id);
      localStorage.setItem(storageKey, JSON.stringify(collapsed ? rest : [...rest, id]));
    } catch {
      // Not remembered; the section still folds.
    }
  };
  return [collapsed, toggle];
}
