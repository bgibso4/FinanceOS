import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const conditionSchema = z.object({
  field: z.enum(['merchant', 'merchantNormalized', 'note', 'amount', 'account']),
  operator: z.enum(['contains', 'exact', 'regex', 'gt', 'lt', 'between', 'equals']),
  value: z.string(),
  negate: z.boolean().optional(),
});

const patchSchema = z.object({
  conditions: z.array(conditionSchema).min(1).optional(),
  categoryId: z.string().nullable().optional(),
  renameTo: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  isEnabled: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.parse(body);

  const data: Record<string, unknown> = { ...parsed };
  if (parsed.conditions) {
    data.conditions = JSON.stringify(parsed.conditions);
  }

  const rule = await prisma.rule.update({ where: { id }, data });
  return NextResponse.json(rule);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  try {
    await prisma.rule.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (_error) {
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}
