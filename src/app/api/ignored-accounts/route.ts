import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  provider: z.enum(['teller', 'plaid']),
  institutionId: z.string(),
  externalAccountId: z.string(),
  lastFour: z.string().optional(),
  name: z.string().optional(),
});

export async function GET() {
  const ignored = await prisma.ignoredBankAccount.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ ignored });
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createSchema.parse(await req.json());

    // Upsert so re-ignoring an account the user already hid is a no-op rather than
    // a unique-constraint crash.
    const ignored = await prisma.ignoredBankAccount.upsert({
      where: {
        provider_externalAccountId: {
          provider: parsed.provider,
          externalAccountId: parsed.externalAccountId,
        },
      },
      create: {
        provider: parsed.provider,
        institutionId: parsed.institutionId,
        externalAccountId: parsed.externalAccountId,
        lastFour: parsed.lastFour ?? null,
        name: parsed.name ?? null,
      },
      update: {
        institutionId: parsed.institutionId,
        lastFour: parsed.lastFour ?? null,
        name: parsed.name ?? null,
      },
    });

    return NextResponse.json({ ignored });
  } catch (error: unknown) {
    console.error('[Ignored Accounts API POST] ERROR:', error);
    const message = error instanceof Error ? error.message : 'Failed to ignore account';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  // Idempotent: a second delete of the same row succeeds.
  await prisma.ignoredBankAccount.deleteMany({ where: { id } });

  return NextResponse.json({ success: true });
}
