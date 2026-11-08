import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { utcDay } from '@/lib/investments/dates';

export async function GET() {
  try {
    const rates = await prisma.exchangeRate.findMany({
      orderBy: [{ fromCurrency: 'asc' }, { toCurrency: 'asc' }],
    });

    return NextResponse.json({ rates });
  } catch (error) {
    console.error('Failed to fetch exchange rates:', error);
    return NextResponse.json({ error: 'Failed to fetch exchange rates' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fromCurrency, toCurrency, rate } = body;

    if (!fromCurrency || !toCurrency || rate === undefined) {
      return NextResponse.json(
        { error: 'fromCurrency, toCurrency, and rate are required' },
        { status: 400 }
      );
    }

    if (rate <= 0) {
      return NextResponse.json({ error: 'Rate must be greater than 0' }, { status: 400 });
    }

    // Upsert today's exchange rate
    const date = utcDay(new Date());
    const exchangeRate = await prisma.exchangeRate.upsert({
      where: {
        fromCurrency_toCurrency_date: {
          fromCurrency,
          toCurrency,
          date,
        },
      },
      update: { rate },
      create: { fromCurrency, toCurrency, date, rate },
    });

    return NextResponse.json({ exchangeRate });
  } catch (error) {
    console.error('Failed to create/update exchange rate:', error);
    return NextResponse.json({ error: 'Failed to create/update exchange rate' }, { status: 500 });
  }
}
