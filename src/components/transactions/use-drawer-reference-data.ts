'use client';

import { useCallback, useEffect, useState } from 'react';
import type { TagDef } from '@/components/tag-input';
import { postTag } from './create-tag';
import type { Account, Category } from './types';

export type DrawerReferenceData = {
  accounts: Account[];
  availableTags: TagDef[];
  baseCurrency: string;
  categories: Category[];
  onCreateTag: (name: string) => Promise<TagDef | null>;
};

type Loaded<T> = { data: T | null; failed: boolean };

async function getJson<T>(url: string): Promise<Loaded<T>> {
  try {
    const res = await fetch(url);
    if (res.ok) return { data: (await res.json()) as T, failed: false };
    console.warn(`Failed to load ${url}: HTTP ${res.status}`);
  } catch (err) {
    console.warn(`Failed to load ${url}`, err);
  }
  return { data: null, failed: true };
}

/**
 * What the shared TransactionDrawer needs beside its list; spread `refs` onto it.
 * `currency` is the base currency once settings have loaded, never a guess: render
 * figures only when it is set. `error` names whatever failed to load.
 */
export function useDrawerReferenceData(): {
  refs: DrawerReferenceData;
  currency: string | null;
  error: string | null;
} {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availableTags, setAvailableTags] = useState<TagDef[]>([]);
  const [currency, setCurrency] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      getJson<{ accounts?: Account[] }>('/api/accounts'),
      getJson<{ categories?: Category[] }>('/api/categories'),
      getJson<{ tags?: TagDef[] }>('/api/tags'),
      getJson<{ settings?: { baseCurrency?: string } }>('/api/settings'),
    ]).then(([acc, cat, tags, settings]) => {
      setAccounts(acc.data?.accounts ?? []);
      setCategories(cat.data?.categories ?? []);
      setAvailableTags(tags.data?.tags ?? []);
      setCurrency(settings.data?.settings?.baseCurrency ?? null);
      const failed = [
        acc.failed && 'accounts',
        cat.failed && 'categories',
        tags.failed && 'tags',
        (settings.failed || !settings.data?.settings?.baseCurrency) && 'settings',
      ].filter(Boolean);
      setError(failed.length > 0 ? `Could not load ${failed.join(', ')}.` : null);
    });
  }, []);

  const onCreateTag = useCallback(async (name: string) => {
    const tag = await postTag(name);
    if (tag)
      setAvailableTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)));
    return tag;
  }, []);

  return {
    refs: { accounts, availableTags, baseCurrency: currency ?? 'USD', categories, onCreateTag },
    currency,
    error,
  };
}
