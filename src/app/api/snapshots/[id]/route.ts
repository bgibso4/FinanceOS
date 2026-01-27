import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const snapshot = await prisma.netWorthSnapshot.findUnique({
    where: { id },
  });

  if (!snapshot) {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  }

  return NextResponse.json({
    snapshot: {
      ...snapshot,
      accountBalances: JSON.parse(snapshot.accountBalances),
    },
  });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  try {
    await prisma.netWorthSnapshot.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const body = await req.json();

  // Only allow updating notes and period
  const { notes, period } = body;

  const snapshot = await prisma.netWorthSnapshot.update({
    where: { id },
    data: {
      ...(notes !== undefined && { notes }),
      ...(period !== undefined && { period }),
    },
  });

  return NextResponse.json({
    snapshot: {
      ...snapshot,
      accountBalances: JSON.parse(snapshot.accountBalances),
    },
  });
}
