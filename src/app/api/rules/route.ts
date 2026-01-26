import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const ruleSchema = z
  .object({
    matchType: z.enum(['merchantContains', 'merchantRegex', 'noteContains']),
    matchValue: z.string(),
    categoryId: z.string().nullable().optional(),
    renameTo: z.string().nullable().optional(),
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

    // Use relation syntax for category to avoid Prisma type issues
    const rule = await prisma.rule.create({
      data: {
        matchType: parsed.matchType,
        matchValue: parsed.matchValue,
        renameTo: parsed.renameTo || undefined,
        priority: parsed.priority,
        isEnabled: parsed.isEnabled,
        // Only include category relation if categoryId is provided
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
