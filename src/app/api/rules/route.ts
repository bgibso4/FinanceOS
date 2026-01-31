import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const conditionSchema = z.object({
  field: z.enum(['merchant', 'merchantNormalized', 'note', 'amount', 'account']),
  operator: z.enum(['contains', 'exact', 'regex', 'gt', 'lt', 'between', 'equals']),
  value: z.string(),
  negate: z.boolean().optional(),
});

const ruleSchema = z
  .object({
    conditions: z.array(conditionSchema).min(1),
    categoryId: z.string().nullable().optional(),
    renameTo: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    priority: z.number().int().min(1).default(100),
    isEnabled: z.boolean().default(true),
  })
  .refine((data) => data.categoryId || data.renameTo, {
    message: 'Rule must have either a categoryId or renameTo (or both)',
  });

export async function GET() {
  const rules = await prisma.rule.findMany({
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json({ rules });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = ruleSchema.parse(body);

    const rule = await prisma.rule.create({
      data: {
        conditions: JSON.stringify(parsed.conditions),
        renameTo: parsed.renameTo || undefined,
        description: parsed.description || undefined,
        priority: parsed.priority,
        isEnabled: parsed.isEnabled,
        ...(parsed.categoryId && {
          category: {
            connect: { id: parsed.categoryId },
          },
        }),
      },
    });
    return NextResponse.json(rule);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { message: error.issues.map((e) => e.message).join(', ') },
        { status: 400 }
      );
    }
    console.error('Failed to create rule:', error);
    return NextResponse.json({ message: 'Failed to create rule' }, { status: 500 });
  }
}
