'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const SNOOZE_KEY = 'travelBudgetBannerSnoozedUntil';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function isSnoozed(): boolean {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) > Date.now();
  } catch {
    return false;
  }
}

/** Slim app-wide prompt to set this year's travel budget. */
export function BudgetBanner() {
  const pathname = usePathname();
  const [year, setYear] = useState<number | null>(null);

  useEffect(() => {
    if (isSnoozed()) return;
    let cancelled = false;
    fetch('/api/travel/budget')
      .then((res) => {
        if (!res.ok) throw new Error(`Budget status failed (${res.status})`);
        return res.json() as Promise<{ year: number; hasBudget: boolean }>;
      })
      .then((status) => {
        if (!cancelled && !status.hasBudget) setYear(status.year);
      })
      .catch((error) => console.warn('Travel budget banner unavailable', error));
    return () => {
      cancelled = true;
    };
  }, []);

  if (year === null || pathname.startsWith('/travel')) return null;

  const snooze = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      // Storage unavailable: hide for this visit only.
    }
    setYear(null);
  };

  return (
    <div className="mb-6 flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm">
      <Link
        className="font-medium text-[var(--accent)] hover:underline"
        href={`/travel?year=${year}`}
      >
        Set your {year} travel budget
      </Link>
      <button
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
        type="button"
        onClick={snooze}
      >
        Not now
      </button>
    </div>
  );
}
