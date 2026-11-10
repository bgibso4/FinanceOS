import { NextRequest } from 'next/server';
import { getSplitwiseImporter } from '@/lib/splitwise/services';
import { respond } from '../../../../errors';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  return respond(async () => {
    const { id, rowId } = await params;
    return (await getSplitwiseImporter()).restore(id, rowId);
  });
}
