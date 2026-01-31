import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { isAIConfigured, parseNaturalLanguageRule } from '@/lib/ai';

const parseSchema = z.object({
  text: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    if (!isAIConfigured()) {
      return NextResponse.json(
        {
          error:
            'AI is not configured. Add OPENAI_API_KEY to your .env file to enable natural language rule parsing.',
        },
        { status: 400 }
      );
    }

    const body = await req.json();
    const { text } = parseSchema.parse(body);

    // Load categories for the AI to reference
    const categories = await prisma.category.findMany({
      include: { parent: true },
    });

    const categoryInfo = categories.map((c) => ({
      id: c.id,
      name: c.name,
      groupName: c.parent?.name ?? null,
    }));

    const parsed = await parseNaturalLanguageRule(text, categoryInfo);

    if (!parsed) {
      return NextResponse.json(
        { error: 'Could not parse the rule description. Try rephrasing.' },
        { status: 422 }
      );
    }

    // Resolve categoryName to categoryId
    let categoryId: string | null = null;
    if (parsed.categoryName) {
      const category = await prisma.category.findFirst({
        where: { name: { equals: parsed.categoryName } },
      });
      categoryId = category?.id ?? null;
    }

    return NextResponse.json({
      conditions: parsed.conditions,
      categoryId,
      categoryName: parsed.categoryName,
      renameTo: parsed.renameTo,
      description: parsed.description,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    console.error('Error parsing rule:', error);
    return NextResponse.json({ error: 'Failed to parse rule' }, { status: 500 });
  }
}
