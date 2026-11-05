'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TagDef } from '@/components/tag-input';
import type { Account, Category } from './types';

type ReferenceData = {
  accounts: Account[];
  availableTags: TagDef[];
  baseCurrency: string;
  categories: Category[];
  onCreateTag: (name: string) => Promise<TagDef | null>;
};

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`Failed to load ${url}: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`Failed to load ${url}`, err);
    return null;
  }
}

/** What the shared TransactionDrawer needs beside its list; spread the result onto it. */
export function useDrawerReferenceData(): ReferenceData {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availableTags, setAvailableTags] = useState<TagDef[]>([]);
  const [baseCurrency, setBaseCurrency] = useState('USD');

  useEffect(() => {
    void Promise.all([
      getJson<{ accounts?: Account[] }>('/api/accounts'),
      getJson<{ categories?: Category[] }>('/api/categories'),
      getJson<{ tags?: TagDef[] }>('/api/tags'),
      getJson<{ settings?: { baseCurrency?: string } }>('/api/settings'),
    ]).then(([acc, cat, tags, settings]) => {
      setAccounts(acc?.accounts ?? []);
      setCategories(cat?.categories ?? []);
      setAvailableTags(tags?.tags ?? []);
      setBaseCurrency(settings?.settings?.baseCurrency ?? 'USD');
    });
  }, []);

  const onCreateTag = useCallback(async (name: string) => {
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, color: 'blue' }),
      });
      if (!res.ok) return null;
      const tag: TagDef = await res.json();
      setAvailableTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
      return tag;
    } catch {
      return null;
    }
  }, []);

  return { accounts, availableTags, baseCurrency, categories, onCreateTag };
}
