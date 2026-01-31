import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const rates = await prisma.inflationRate.findMany({
      orderBy: { year: 'desc' },
    });

    return NextResponse.json({ rates });
  } catch (error) {
    console.error('Failed to fetch inflation rates:', error);
    return NextResponse.json({ error: 'Failed to fetch inflation rates' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { year, rate } = body;

    if (year === undefined || rate === undefined) {
      return NextResponse.json({ error: 'year and rate are required' }, { status: 400 });
    }

    if (typeof year !== 'number' || year < 1900 || year > 2100) {
      return NextResponse.json({ error: 'Year must be between 1900 and 2100' }, { status: 400 });
    }

    if (typeof rate !== 'number' || rate < -50 || rate > 100) {
      return NextResponse.json(
        { error: 'Rate must be between -50 and 100 (percentage)' },
        { status: 400 }
      );
    }

    const inflationRate = await prisma.inflationRate.upsert({
      where: { year },
      update: { rate },
      create: { year, rate },
    });

    return NextResponse.json({ inflationRate });
  } catch (error) {
    console.error('Failed to create/update inflation rate:', error);
    return NextResponse.json({ error: 'Failed to create/update inflation rate' }, { status: 500 });
  }
}
