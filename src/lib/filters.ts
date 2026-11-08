import { endOfMonth, startOfMonth, subMonths } from 'date-fns';
import type { DateRange } from './analytics';
import { DateRangePreset, FilterParams } from './types';

export function resolveDateRange(
  preset: DateRangePreset,
  start?: string,
  end?: string
): { startDate: Date; endDate: Date } {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  switch (preset) {
    case 'this-month':
      return {
        startDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
      };
    case 'last-month': {
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      return {
        startDate: new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(prevYear, prevMonth + 1, 0, 23, 59, 59, 999)),
      };
    }
    case 'last-3-months':
      return {
        startDate: new Date(Date.UTC(year, month - 2, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
      };
    case 'ytd':
      return {
        startDate: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
      };
    case 'last-12-months':
      return {
        startDate: new Date(Date.UTC(year, month - 11, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999)),
      };
    case 'custom':
    default: {
      // For custom date ranges, parse as UTC
      let startDate: Date;
      let endDate: Date;

      if (start) {
        const [y, m, d] = start.split('-').map(Number);
        startDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
      } else {
        startDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      }

      if (end) {
        const [y, m, d] = end.split('-').map(Number);
        endDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999));
      } else {
        endDate = new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999));
      }

      console.log('resolveDateRange custom:', {
        start,
        end,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });
      return { startDate, endDate };
    }
  }
}

export function parseFilters(searchParams: URLSearchParams): FilterParams {
  const startDate = searchParams.get('startDate') ?? undefined;
  const endDate = searchParams.get('endDate') ?? undefined;
  const accounts = searchParams.getAll('account');
  const categories = searchParams.getAll('category');
  const merchant = searchParams.get('merchant') ?? undefined;
  const tags = searchParams.getAll('tag');

  return {
    startDate,
    endDate,
    accounts: accounts.length ? accounts : undefined,
    categories: categories.length ? categories : undefined,
    merchant,
    tags: tags.length ? tags : undefined,
  };
}

/** The query string parseFilters reads back: the inverse of parseFilters. */
export function filterSearchParams(f: FilterParams): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.startDate) sp.set('startDate', f.startDate);
  if (f.endDate) sp.set('endDate', f.endDate);
  f.accounts?.forEach((a) => sp.append('account', a));
  f.categories?.forEach((c) => sp.append('category', c));
  if (f.merchant) sp.set('merchant', f.merchant);
  f.tags?.forEach((t) => sp.append('tag', t));
  return sp;
}

/** The comparison range named by `compareStart` and `compareEnd`, when both are given. */
export function compareRangeParam(searchParams: URLSearchParams): DateRange | undefined {
  const start = searchParams.get('compareStart');
  const end = searchParams.get('compareEnd');
  return start && end ? resolveDateRange('custom', start, end) : undefined;
}
