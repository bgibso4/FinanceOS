import { NextRequest } from 'next/server';
import { getSplitwiseImporter } from '@/lib/splitwise/services';
import { respond } from '../errors';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return respond(async () => {
    const { id } = await params;
    return (await getSplitwiseImporter()).result(id);
  });
}
