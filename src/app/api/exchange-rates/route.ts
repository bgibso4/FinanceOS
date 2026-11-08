import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { summarizePair, type ExchangeRatesResponse } from '@/lib/fx/rate-summary';

/** Every currency pair with its newest rate, sparkline points, one-year change and month ends. */
export async function GET() {
  try {
    const rows = await prisma.exchangeRate.findMany({
      orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }, { date: 'asc' }],
    });
    const byPair = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.fromCurrency}_${row.toCurrency}`;
      const pair = byPair.get(key);
      if (pair) pair.push(row);
      else byPair.set(key, [row]);
    }
    const body: ExchangeRatesResponse = {
      rates: [...byPair.values()].map((pair) => {
        const summary = summarizePair(pair);
        return {
          fromCurrency: pair[0].fromCurrency,
          toCurrency: pair[0].toCurrency,
          updatedAt: pair[pair.length - 1].updatedAt.toISOString(),
          ...summary,
          // Callers of this route have always received a full timestamp here.
          date: `${summary.date}T00:00:00.000Z`,
        };
      }),
    };
    return NextResponse.json(body);
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    return NextResponse.json({ error: 'Failed to fetch exchange rates' }, { status: 500 });
  }
}
