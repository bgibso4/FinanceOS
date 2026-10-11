import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getAccountBalance } from '@/lib/balances';
import { ManualHoldingService } from '@/lib/investments/manual-holding';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { accountId, amount, note } = body;

    if (!accountId) {
      return NextResponse.json({ error: 'Account ID is required' }, { status: 400 });
    }

    if (typeof amount !== 'number' || isNaN(amount)) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }

    // Verify account exists
    const account = await prisma.account.findUnique({
      where: { id: accountId },
    });

    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    }

    // Investment accounts keep balances in AccountBalance, never in the transaction ledger.
    if (account.trackingMode === 'investment') {
      if (account.balanceSource !== 'manual') {
        const from = account.balanceSource === 'provider' ? 'Plaid' : 'its holdings';
        return NextResponse.json(
          { error: `This account's balance comes from ${from}` },
          { status: 400 }
        );
      }
      const { balance } = await getAccountBalance(prisma, accountId);
      const accountBalance = await new ManualHoldingService(prisma).record(accountId, {
        date: new Date(),
        balance: balance + amount,
      });
      return NextResponse.json({ accountBalance });
    }

    // Find or create "Balance Adjustment" category
    let adjustmentCategory = await prisma.category.findFirst({
      where: { name: 'Balance Adjustment' },
    });

    if (!adjustmentCategory) {
      adjustmentCategory = await prisma.category.create({
        data: {
          name: 'Balance Adjustment',
          type: 'transfer', // Adjustments are neither income nor expense
        },
      });
    }

    // Create the adjustment transaction
    const transaction = await prisma.transaction.create({
      data: {
        date: new Date(),
        amount,
        accountId,
        merchant: 'Balance Adjustment',
        merchantNormalized: 'balance adjustment',
        categoryId: adjustmentCategory.id,
        note: note || 'Manual balance reconciliation',
        isTransfer: true, // Mark as transfer to exclude from analytics
        confidenceScore: 1,
      },
    });

    return NextResponse.json({
      success: true,
      transaction,
      message: `Balance adjusted by ${amount >= 0 ? '+' : ''}${amount.toFixed(2)}`,
    });
  } catch (error) {
    console.error('Failed to create adjustment:', error);
    return NextResponse.json({ error: 'Failed to create adjustment' }, { status: 500 });
  }
}
