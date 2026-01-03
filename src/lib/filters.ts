import { endOfMonth, startOfMonth, subMonths } from "date-fns";
import { DateRangePreset, FilterParams } from "./types";

export function resolveDateRange(
  preset: DateRangePreset,
  start?: string,
  end?: string
): { startDate: Date; endDate: Date } {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  
  switch (preset) {
    case "this-month":
      return { 
        startDate: new Date(Date.UTC(year, month, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
      };
    case "last-month": {
      const prevMonth = month === 0 ? 11 : month - 1;
      const prevYear = month === 0 ? year - 1 : year;
      return { 
        startDate: new Date(Date.UTC(prevYear, prevMonth, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(prevYear, prevMonth + 1, 0, 23, 59, 59, 999))
      };
    }
    case "last-3-months":
      return { 
        startDate: new Date(Date.UTC(year, month - 2, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
      };
    case "ytd":
      return { 
        startDate: new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
      };
    case "last-12-months":
      return { 
        startDate: new Date(Date.UTC(year, month - 11, 1, 0, 0, 0, 0)),
        endDate: new Date(Date.UTC(year, month + 1, 0, 23, 59, 59, 999))
      };
    case "custom":
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
      
      console.log('resolveDateRange custom:', { start, end, startDate: startDate.toISOString(), endDate: endDate.toISOString() });
      return { startDate, endDate };
    }
  }
}

export function parseFilters(searchParams: URLSearchParams): FilterParams {
  const startDate = searchParams.get("startDate") ?? undefined;
  const endDate = searchParams.get("endDate") ?? undefined;
  const accounts = searchParams.getAll("account");
  const categories = searchParams.getAll("category");
  const merchant = searchParams.get("merchant") ?? undefined;
  const tags = searchParams.getAll("tag");

  return {
    startDate,
    endDate,
    accounts: accounts.length ? accounts : undefined,
    categories: categories.length ? categories : undefined,
    merchant,
    tags: tags.length ? tags : undefined
  };
}

export function applyFilters<T extends { accountId?: string; categoryId?: string; merchant?: string; tags?: any }>(
  rows: T[],
  filters: FilterParams
): T[] {
  return rows.filter((row) => {
    if (filters.accounts && row.accountId && !filters.accounts.includes(row.accountId)) return false;
    if (filters.categories && row.categoryId && !filters.categories.includes(row.categoryId)) return false;
    if (filters.merchant && row.merchant && !row.merchant.toLowerCase().includes(filters.merchant.toLowerCase())) return false;
    if (filters.tags && Array.isArray(row.tags)) {
      const tagList = row.tags as string[];
      if (!filters.tags.every((t) => tagList.includes(t))) return false;
    }
    return true;
  });
}
