import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getDefaultTrackingMode } from '@/lib/account-defaults';
import { isUniqueConstraintError } from '@/lib/sync-common';

const schema = z.object({
  provider: z.enum(['teller', 'plaid']),
  enrollmentId: z.string(),
  externalAccountId: z.string(),
  name: z.string().min(1),
  type: z.string(),
  currency: z.string().default('USD'),
  subtype: z.string().optional(),
  lastFour: z.string().optional(),
});

/**
 * Turn a bank account the provider already exposes into a tracked FinanceOS account.
 * Creates the Account row and its provider connection together so a failure can't
 * leave an orphaned account with no way to sync.
 */
export async function POST(req: NextRequest) {
  try {
    const parsed = schema.parse(await req.json());

    const enrollment =
      parsed.provider === 'teller'
        ? await prisma.tellerEnrollment.findUnique({ where: { id: parsed.enrollmentId } })
        : await prisma.plaidEnrollment.findUnique({ where: { id: parsed.enrollmentId } });

    if (!enrollment) {
      return NextResponse.json({ error: 'Enrollment not found' }, { status: 404 });
    }

    const alreadyLinked =
      parsed.provider === 'teller'
        ? await prisma.tellerConnection.findFirst({
            where: { tellerEnrollmentId: enrollment.id, tellerAccountId: parsed.externalAccountId },
          })
        : await prisma.plaidConnection.findFirst({
            where: { plaidEnrollmentId: enrollment.id, plaidAccountId: parsed.externalAccountId },
          });

    if (alreadyLinked) {
      return NextResponse.json({ error: 'This bank account is already linked' }, { status: 409 });
    }

    const maxSortOrder = await prisma.account.aggregate({ _max: { sortOrder: true } });
    const nextSortOrder = (maxSortOrder._max.sortOrder ?? -1) + 1;

    const account = await prisma.$transaction(async (tx) => {
      const created = await tx.account.create({
        data: {
          name: parsed.name,
          type: parsed.type,
          institution: enrollment.institutionName,
          currency: parsed.currency,
          isActive: true,
          sortOrder: nextSortOrder,
          trackingMode: getDefaultTrackingMode(parsed.type),
        },
      });

      if (parsed.provider === 'teller') {
        await tx.tellerConnection.create({
          data: {
            accountId: created.id,
            tellerEnrollmentId: enrollment.id,
            tellerAccountId: parsed.externalAccountId,
            tellerAccountName: parsed.name,
            tellerAccountType: parsed.type,
            tellerAccountSubtype: parsed.subtype ?? null,
            tellerAccountLastFour: parsed.lastFour ?? null,
            status: 'connected',
          },
        });
      } else {
        await tx.plaidConnection.create({
          data: {
            accountId: created.id,
            plaidEnrollmentId: enrollment.id,
            plaidAccountId: parsed.externalAccountId,
            plaidAccountName: parsed.name,
            status: 'connected',
          },
        });
      }

      return created;
    });

    return NextResponse.json({ success: true, account });
  } catch (error: unknown) {
    // The findFirst check above gives a clean 409 for the common sequential case,
    // but it isn't atomic with the create. If two adopts of the same bank account
    // race, the loser's create trips the @@unique constraint on
    // (tellerEnrollmentId, tellerAccountId) / (plaidEnrollmentId, plaidAccountId)
    // instead — treat that the same way rather than surfacing a raw 500.
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ error: 'This bank account is already linked' }, { status: 409 });
    }

    console.error('[Adopt Bank Account API] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to adopt account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
