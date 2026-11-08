import type { PrismaClient } from '@prisma/client';
import { isoDay } from '@/lib/investments/dates';

export interface RateRow {
  fromCurrency: string;
  toCurrency: string;
  date: Date;
  rate: number;
}

interface DayRate {
  day: string;
  rate: number;
}

/** Every dated exchange rate, answering "rate from A to B on day D". */
export class RateBook {
  private constructor(private readonly byPair: Map<string, DayRate[]>) {}

  static async load(prisma: PrismaClient): Promise<RateBook> {
    return RateBook.of(await prisma.exchangeRate.findMany());
  }

  static of(rows: RateRow[]): RateBook {
    const byPair = new Map<string, DayRate[]>();
    for (const r of rows) {
      const key = pairKey(r.fromCurrency, r.toCurrency);
      const list = byPair.get(key) ?? [];
      list.push({ day: isoDay(r.date), rate: r.rate });
      byPair.set(key, list);
    }
    for (const list of byPair.values()) list.sort((a, b) => a.day.localeCompare(b.day));
    return new RateBook(byPair);
  }

  /**
   * Rate on `day` (YYYY-MM-DD): the latest stored day at or before it, else the earliest.
   * No day means the latest. A missing pair warns and returns 1 (no conversion).
   */
  rate(from: string, to: string, day?: string): number {
    if (from === to) return 1;
    const direct = this.lookup(from, to, day);
    if (direct !== undefined) return direct;
    const reverse = this.lookup(to, from, day);
    if (reverse !== undefined) return 1 / reverse;
    console.warn(`No exchange rate found for ${from} -> ${to}`);
    return 1;
  }

  convert(amount: number, from: string, to: string, day?: string): number {
    return amount * this.rate(from, to, day);
  }

  /** Newest stored row for the pair, in either direction. */
  latest(from: string, to: string): { rate: number; date: string } | null {
    const list = this.byPair.get(pairKey(from, to));
    const last = list?.[list.length - 1];
    return last ? { rate: last.rate, date: last.day } : null;
  }

  private lookup(from: string, to: string, day?: string): number | undefined {
    const list = this.byPair.get(pairKey(from, to));
    if (!list) return undefined;
    if (day === undefined) return list[list.length - 1].rate;
    let found = list[0];
    for (const entry of list) {
      if (entry.day > day) break;
      found = entry;
    }
    return found.rate;
  }
}

const pairKey = (from: string, to: string) => `${from}_${to}`;
