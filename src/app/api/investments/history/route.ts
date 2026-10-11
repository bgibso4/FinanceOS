import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { addDays, utcDay } from '@/lib/investments/dates';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, isoDateSchema } from '../_lib/http';

const MAX_DAYS = 3660;

const querySchema = z.object({
  accountId: z.string().min(1).optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid query', details: parsed.error.issues },
      { status: 400 }
    );
  }
  const to = parsed.data.to ? utcDay(parsed.data.to) : utcDay(new Date());
  const from = parsed.data.from ? utcDay(parsed.data.from) : addDays(to, -30);
  if (from > to || to.getTime() - from.getTime() > MAX_DAYS * 86_400_000) {
    return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
  }

  try {
    const { history } = await getInvestmentServices();
    if (parsed.data.accountId) {
      const account = await prisma.account.findUnique({ where: { id: parsed.data.accountId } });
      if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      if (account.trackingMode !== 'investment') {
        return NextResponse.json({ error: 'Not an investment account' }, { status: 400 });
      }
      const points = await history.accountSeries(account.id, from, to);
      return NextResponse.json({ currency: account.currency, points });
    }
    const settings = await prisma.userSettings.findFirst();
    const currency = settings?.baseCurrency || 'USD';
    const points = await history.portfolioSeries(from, to, currency);
    return NextResponse.json({ currency, points });
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to load investment history');
  }
}
