import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSplitwiseImporter } from '@/lib/splitwise/services';
import { respond } from './errors';

const runSchema = z.object({
  accountId: z.string().min(1),
  person: z.string().min(1),
  fileName: z.string().min(1),
  text: z.string(),
  skipBefore: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

/** The card's defaults; with ?accountId and ?group, whether that group was imported before. */
export async function GET(req: NextRequest) {
  return respond(async () => {
    const importer = await getSplitwiseImporter();
    const { searchParams } = req.nextUrl;
    const accountId = searchParams.get('accountId');
    const group = searchParams.get('group');
    if (accountId && group) return { known: await importer.isKnown(accountId, group) };
    return importer.defaults();
  });
}

export async function POST(req: NextRequest) {
  return respond(async () => {
    const input = runSchema.parse(await req.json().catch(() => undefined));
    return (await getSplitwiseImporter()).run(input);
  });
}
