import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { BASE_CURRENCIES } from '@/lib/currency';
import { INDEX_REGIONS } from '@/lib/price-index/types';

const patchSchema = z.object({
  baseCurrency: z.enum(BASE_CURRENCIES.map((c) => c.code) as [string, ...string[]]).optional(),
  inflationRegion: z.enum(INDEX_REGIONS as [string, ...string[]]).optional(),
});

export async function GET() {
  try {
    // Get or create user settings (single user app)
    let settings = await prisma.userSettings.findFirst();

    if (!settings) {
      settings = await prisma.userSettings.create({
        data: {
          baseCurrency: 'USD',
        },
      });
    }

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Failed to fetch settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    // Get or create settings
    const existing = await prisma.userSettings.findFirst();
    const settings = existing
      ? await prisma.userSettings.update({ where: { id: existing.id }, data })
      : await prisma.userSettings.create({ data });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Failed to update settings:', error);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
