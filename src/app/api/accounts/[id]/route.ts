import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { TRACKING_MODES } from '@/lib/account-defaults';
import { BalanceSource } from '@/lib/investments/codes';
import { checkAccountUpdate, InvestmentInputError } from '@/lib/investments/account-guard';
import { getInvestmentServices } from '@/lib/investments/services';
import { investmentErrorResponse, parseJsonBody } from '@/app/api/investments/_lib/http';

const updateSchema = z.object({
  name: z.string().optional(),
  type: z.string().optional(),
  institution: z.string().optional().nullable(),
  currency: z.string().optional(),
  isActive: z.boolean().optional(),
  notes: z.string().optional().nullable(),
  trackingMode: z.enum(TRACKING_MODES).optional(),
  balanceSource: z.enum(BalanceSource).optional().nullable(),
  invertAmounts: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await parseJsonBody(req, updateSchema, 'Invalid account update');
  if ('response' in body) return body.response;
  const { balanceSource, ...fields } = body.data;
  try {
    const account = await prisma.account.findUnique({
      where: { id },
      include: { plaidConnection: true },
    });
    if (!account) throw new InvestmentInputError('Account not found', 404);
    // Only the Plaid connection syncs investment balances (Spec note 1, Plan 4b); the guard sees
    // just the neutral boolean.
    const synced = !!account.plaidConnection;
    const { switchTo } = checkAccountUpdate(account, { ...fields, balanceSource }, { synced });
    if (switchTo) {
      await (await getInvestmentServices()).refresh.switchBalanceSource(id, switchTo);
    }
    const updated = await prisma.account.update({ where: { id }, data: fields });
    return NextResponse.json(updated);
  } catch (error) {
    return investmentErrorResponse(error, 'Failed to update account');
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    // Check if account has transactions
    const transactionCount = await prisma.transaction.count({
      where: { accountId: id },
    });

    if (transactionCount > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete account with ${transactionCount} transactions. Archive it instead.`,
        },
        { status: 400 }
      );
    }

    await prisma.account.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
