import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PrismaClient } from '@prisma/client';
import { setupTestDb, teardownTestDb, resetTestDb } from '../../helpers/db';
import { createSplitwiseImporter } from '@/lib/splitwise/services';
import { STAY_2, fixture, seedSplitwise, TRIP_PAIR, withLine } from '../splitwise/fixtures';

let importer: ReturnType<typeof createSplitwiseImporter>;

vi.mock('@/lib/splitwise/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/splitwise/services')>()),
  getSplitwiseImporter: async () => importer,
}));

const BASE = 'http://localhost/api/import/splitwise';
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Splitwise import routes', () => {
  let prisma: PrismaClient;
  let accountId: string;

  beforeAll(async () => {
    prisma = await setupTestDb();
    importer = createSplitwiseImporter({ prisma });
  });
  afterAll(async () => {
    await teardownTestDb();
  });
  beforeEach(async () => {
    await resetTestDb();
    ({ accountId } = await seedSplitwise(prisma));
  });

  const post = async (body: unknown) => {
    const { POST } = await import('@/app/api/import/splitwise/route');
    return POST(new NextRequest(BASE, { method: 'POST', body: JSON.stringify(body) }));
  };
  const runBody = (text = fixture(TRIP_PAIR), fileName = TRIP_PAIR) => ({
    accountId,
    person: 'Me',
    fileName,
    text,
  });
  const withoutStay2 = () => withLine(fixture(TRIP_PAIR), STAY_2, null);
  const get = async (id: string) => {
    const { GET } = await import('@/app/api/import/splitwise/[id]/route');
    return GET(new NextRequest(`${BASE}/${id}`), idParams(id));
  };

  it('postImportsAndGetReturnsSameResult', async () => {
    const res = await post(runBody());
    expect(res.status).toBe(200);
    const posted = await res.json();
    expect(posted).toMatchObject({ group: 'trip-pair', firstImport: true, canUndo: true });

    const fetched = await (await get(posted.importId)).json();
    expect(fetched).toEqual(posted);
  });

  it('badFileIs400WithMessage', async () => {
    const res = await post(runBody(fixture(TRIP_PAIR), 'renamed.csv'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("isn't named like a Splitwise export");

    const invalid = await post({ accountId });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: 'Invalid request body' });
  });

  it('nonJsonBodyIs400', async () => {
    const { POST } = await import('@/app/api/import/splitwise/route');
    const res = await POST(new NextRequest(BASE, { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request body' });
  });

  it('unexpectedFailureIs500SayingNothingWasSaved', async () => {
    vi.spyOn(importer, 'run').mockRejectedValueOnce(new Error('disk full'));
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post(runBody());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'The import failed and nothing was saved. Try again.',
    });
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('unknownImportIs404', async () => {
    const res = await get('nope');
    expect(res.status).toBe(404);
  });

  it('undoOfOlderImportIs409', async () => {
    const first = await (await post(runBody())).json();
    await post(runBody(withoutStay2()));

    const { POST } = await import('@/app/api/import/splitwise/[id]/undo/route');
    const res = await POST(
      new NextRequest(`${BASE}/${first.importId}/undo`, { method: 'POST' }),
      idParams(first.importId)
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Only the latest import');
  });

  it('undoOfLatestImportSucceeds', async () => {
    const first = await (await post(runBody())).json();
    const { POST } = await import('@/app/api/import/splitwise/[id]/undo/route');
    const res = await POST(
      new NextRequest(`${BASE}/${first.importId}/undo`, { method: 'POST' }),
      idParams(first.importId)
    );
    expect(await res.json()).toEqual({ success: true });
    expect((await get(first.importId)).status).toBe(404);
  });

  it('restoreRoundTrip', async () => {
    await post(runBody());
    const second = await (await post(runBody(withoutStay2()))).json();
    expect(second.deleted).toHaveLength(1);
    const { rowId } = second.deleted[0];

    const { POST } = await import('@/app/api/import/splitwise/[id]/rows/[rowId]/restore/route');
    const res = await POST(
      new NextRequest(`${BASE}/${second.importId}/rows/${rowId}/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id: second.importId, rowId }) }
    );
    expect(res.status).toBe(200);
    expect((await res.json()).deleted[0].restored).toBe(true);
    expect((await (await get(second.importId)).json()).deleted[0].restored).toBe(true);
    expect(await prisma.transaction.count({ where: { merchant: 'Rental stay 2' } })).toBe(1);

    const missing = await POST(
      new NextRequest(`${BASE}/${second.importId}/rows/zzz/restore`, { method: 'POST' }),
      { params: Promise.resolve({ id: second.importId, rowId: 'zzz' }) }
    );
    expect(missing.status).toBe(404);
  });

  it('defaultsComeFromLastImport', async () => {
    const { GET } = await import('@/app/api/import/splitwise/route');
    const defaults = () => GET(new NextRequest(BASE)).then((r) => r.json());

    expect(await defaults()).toEqual({ accountId, person: '', knownGroups: [] });
    await post(runBody());
    expect(await defaults()).toEqual({ accountId, person: 'Me', knownGroups: ['trip-pair'] });
  });

  it('knownGroupFlag', async () => {
    const { GET } = await import('@/app/api/import/splitwise/route');
    const known = (group: string) =>
      GET(new NextRequest(`${BASE}?accountId=${accountId}&group=${group}`)).then((r) => r.json());

    expect(await known('trip-pair')).toEqual({ known: false });
    await post(runBody());
    expect(await known('trip-pair')).toEqual({ known: true });
    expect(await known('other')).toEqual({ known: false });
  });
});
