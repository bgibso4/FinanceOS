import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

// Default tracking mode based on account type
function getDefaultTrackingMode(type: string): 'cash_flow' | 'balance_only' {
  const balanceOnlyTypes = ['brokerage', 'retirement', 'crypto', 'loan'];
  return balanceOnlyTypes.includes(type) ? 'balance_only' : 'cash_flow';
}

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
    orderBy: { createdAt: 'desc' },
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

  const account = await prisma.account.create({
    data: {
      ...parsed,
      trackingMode,
    },
  });
  return NextResponse.json(account);
}
