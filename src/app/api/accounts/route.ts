import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getDefaultTrackingMode } from '@/lib/account-defaults';

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  institution: z.string().optional(),
  currency: z.string().default('USD'),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
  trackingMode: z.enum(['cash_flow', 'balance_only']).optional(),
});

export async function GET() {
  const accounts = await prisma.account.findMany({
    orderBy: { sortOrder: 'asc' },
    include: {
      plaidConnection: {
        include: {
          plaidEnrollment: {
            select: {
              id: true,
              institutionName: true,
              status: true,
            },
          },
        },
      },
      tellerConnection: {
        include: {
          tellerEnrollment: true,
        },
      },
    },
  });
  return NextResponse.json({ accounts });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = accountSchema.parse(body);

  // Set default trackingMode based on account type if not provided
  const trackingMode = parsed.trackingMode ?? getDefaultTrackingMode(parsed.type);

  // Get the maximum sortOrder to place new account at the end
  const maxSortOrder = await prisma.account.aggregate({
    _max: { sortOrder: true },
  });
  const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  const account = await prisma.account.create({
    data: {
      ...parsed,
      trackingMode,
      sortOrder: nextSortOrder,
    },
  });
  return NextResponse.json(account);
}
