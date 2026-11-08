import { NextRequest } from 'next/server';
import { getSplitwiseImporter } from '@/lib/splitwise/services';
import { respond } from '../../errors';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    await (await getSplitwiseImporter()).undo(id);
    return { success: true };
  });
}
