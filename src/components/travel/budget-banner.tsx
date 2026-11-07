'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const SNOOZE_KEY = 'travelBudgetBannerSnoozedUntil';
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

const isTravelPath = (pathname: string) =>
  pathname === '/travel' || pathname.startsWith('/travel/');

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

  const onTravel = isTravelPath(pathname);

  // Re-check on every navigation: the shell outlives pages, so a budget set on /travel
  // must clear the banner elsewhere, and snooze expiry or a new year are picked up.
  useEffect(() => {
    if (onTravel) return;
    if (isSnoozed()) {
      setYear(null);
      return;
    }
    let cancelled = false;
    fetch('/api/travel/budget')
      .then((res) => {
        if (!res.ok) throw new Error(`Budget status failed (${res.status})`);
        return res.json() as Promise<{ year: number; hasBudget: boolean }>;
      })
      .then((status) => {
        if (!cancelled) setYear(status.hasBudget ? null : status.year);
      })
      .catch((error) => {
        if (!cancelled) setYear(null);
        console.warn('Travel budget banner unavailable', error);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname, onTravel]);

  if (year === null || onTravel) return null;

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
