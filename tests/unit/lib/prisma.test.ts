import { describe, it, expect, afterEach, vi } from 'vitest';

// The production build bundles '@/lib/prisma' more than once (instrumentation and the routes each
// get a copy). Every copy must hand out the same client, or the server runs two SQLite pools.
describe('prisma client', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('is one client per process in production, however many copies of the module load', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const first = await import('@/lib/prisma');
    vi.resetModules();
    const second = await import('@/lib/prisma');
    // Compare by identity: a failing toBe would try to diff two PrismaClients and overflow.
    expect(second.prisma === first.prisma).toBe(true);
  });
});
