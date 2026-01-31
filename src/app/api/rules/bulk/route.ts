import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const bulkSchema = z.object({
  action: z.enum(['delete', 'enable', 'disable']),
  ruleIds: z.array(z.string()),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, ruleIds } = bulkSchema.parse(body);

    if (ruleIds.length === 0) {
      return NextResponse.json({ message: 'No rule IDs provided' }, { status: 400 });
    }

    let affected = 0;

    if (action === 'delete') {
      const result = await prisma.rule.deleteMany({
        where: { id: { in: ruleIds } },
      });
      affected = result.count;
    } else {
      const result = await prisma.rule.updateMany({
        where: { id: { in: ruleIds } },
        data: { isEnabled: action === 'enable' },
      });
      affected = result.count;
    }

    return NextResponse.json({ success: true, affected });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('Error in bulk rule operation:', error);
    return NextResponse.json({ error: 'Failed to perform bulk operation' }, { status: 500 });
  }
}
