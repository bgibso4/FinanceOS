import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** The newest stored rate for each currency pair. */
export async function GET() {
  try {
    const rows = await prisma.exchangeRate.findMany({
      orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }, { date: 'desc' }],
    });
    const seen = new Set<string>();
    const rates = rows
      .filter((r) => {
        const key = `${r.fromCurrency}_${r.toCurrency}`;
        return !seen.has(key) && seen.add(key);
      })
      .map(({ fromCurrency, toCurrency, rate, date, updatedAt }) => ({
        fromCurrency,
        toCurrency,
        rate,
        date,
        updatedAt,
      }));
    return NextResponse.json({ rates });
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    return NextResponse.json({ error: 'Failed to fetch exchange rates' }, { status: 500 });
  }
}
