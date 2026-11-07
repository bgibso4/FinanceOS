import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ensureSnapshot } from '@/lib/analytics';
import { localDay } from '@/lib/dates';

const schema = z.object({
  month: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.parse(body ?? {});
  const month = parsed.month ?? localDay().slice(0, 7);
  const snapshot = await ensureSnapshot(prisma, month);
  return NextResponse.json(snapshot);
}
