import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import {
  defaultBalanceSource,
  getDefaultTrackingMode,
  TRACKING_MODES,
} from '@/lib/account-defaults';
import { BalanceSource } from '@/lib/investments/codes';

const accountSchema = z.object({
  name: z.string().min(1),
  type: z.string(),
  institution: z.string().optional(),
  currency: z.string().default('USD'),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
  trackingMode: z.enum(TRACKING_MODES).optional(),
  balanceSource: z.enum(BalanceSource).optional().nullable(),
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
  const balanceSource =
    parsed.balanceSource ?? defaultBalanceSource(trackingMode, { synced: false });

  // Get the maximum sortOrder to place new account at the end
  const maxSortOrder = await prisma.account.aggregate({
    _max: { sortOrder: true },
  });
  const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

  const account = await prisma.account.create({
    data: {
      ...parsed,
      trackingMode,
      balanceSource,
      sortOrder: nextSortOrder,
    },
  });
  return NextResponse.json(account);
}
