import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

const updateTagSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = updateTagSchema.parse(body);

  const currentTag = await prisma.tag.findUnique({ where: { id } });
  if (!currentTag) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  // If renaming, check uniqueness and update all transactions
  if (parsed.name && parsed.name !== currentTag.name) {
    const existing = await prisma.tag.findFirst({
      where: { name: parsed.name, NOT: { id } },
    });
    if (existing) {
      return NextResponse.json({ error: 'A tag with this name already exists' }, { status: 409 });
    }

    // Bulk update transactions: replace old name with new name in JSON arrays
    const transactions = await prisma.transaction.findMany({
      where: { tags: { not: null }, isSplitParent: false },
      select: { id: true, tags: true },
    });

    const updates = transactions
      .filter((tx) => {
        const tags: string[] = JSON.parse(tx.tags!);
        return tags.includes(currentTag.name);
      })
      .map((tx) => {
        const tags: string[] = JSON.parse(tx.tags!);
        const newTags = tags.map((t) => (t === currentTag.name ? parsed.name! : t));
        return prisma.transaction.update({
          where: { id: tx.id },
          data: { tags: JSON.stringify(newTags) },
        });
      });

    await Promise.all(updates);
  }

  const tag = await prisma.tag.update({
    where: { id },
    data: parsed,
  });

  return NextResponse.json(tag);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 });
  }

  // Remove this tag name from all transactions
  const transactions = await prisma.transaction.findMany({
    where: { tags: { not: null }, isSplitParent: false },
    select: { id: true, tags: true },
  });

  const updates = transactions
    .filter((tx) => {
      const tags: string[] = JSON.parse(tx.tags!);
      return tags.includes(tag.name);
    })
    .map((tx) => {
      const tags: string[] = JSON.parse(tx.tags!);
      const newTags = tags.filter((t) => t !== tag.name);
      return prisma.transaction.update({
        where: { id: tx.id },
        data: { tags: JSON.stringify(newTags) },
      });
    });

  await Promise.all(updates);
  await prisma.tag.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
