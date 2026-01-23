import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { findPotentialReturns, linkReturn, unlinkReturn } from '@/lib/returns';

// GET potential return matches for a transaction
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    console.log('Finding potential returns for transaction:', id);
    const matches = await findPotentialReturns(prisma, id);
    console.log('Found matches:', matches.length);
    return NextResponse.json({ matches });
  } catch (error) {
    console.error('Error finding potential returns:', error);
    return NextResponse.json(
      {
        error: 'Failed to find potential returns',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// POST to link a return to an original purchase
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { originalTransactionId } = body;

  if (!originalTransactionId) {
    return NextResponse.json({ error: 'originalTransactionId is required' }, { status: 400 });
  }

  try {
    await linkReturn(prisma, id, originalTransactionId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to link return' }, { status: 500 });
  }
}

// DELETE to unlink a return
export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await unlinkReturn(prisma, id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to unlink return' }, { status: 500 });
  }
}
