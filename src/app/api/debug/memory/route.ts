import { NextResponse } from 'next/server';

/**
 * Memory debugging endpoint - only available in development
 * GET /api/debug/memory - returns current memory stats
 * POST /api/debug/memory - triggers garbage collection (if --expose-gc flag is set)
 */

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const used = process.memoryUsage();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    memory: {
      heapUsed: {
        bytes: used.heapUsed,
        mb: Math.round(used.heapUsed / 1024 / 1024),
      },
      heapTotal: {
        bytes: used.heapTotal,
        mb: Math.round(used.heapTotal / 1024 / 1024),
      },
      rss: {
        bytes: used.rss,
        mb: Math.round(used.rss / 1024 / 1024),
      },
      external: {
        bytes: used.external,
        mb: Math.round(used.external / 1024 / 1024),
      },
      arrayBuffers: {
        bytes: used.arrayBuffers,
        mb: Math.round(used.arrayBuffers / 1024 / 1024),
      },
    },
    warnings: [
      used.heapUsed > 500 * 1024 * 1024 ? 'Heap usage exceeds 500 MB' : null,
      used.rss > 1000 * 1024 * 1024 ? 'RSS exceeds 1 GB' : null,
      used.rss > 2000 * 1024 * 1024 ? 'CRITICAL: RSS exceeds 2 GB' : null,
    ].filter(Boolean),
  });
}

export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 });
  }

  const before = process.memoryUsage();

  // Trigger garbage collection if available (requires --expose-gc flag)
  if (global.gc) {
    global.gc();
  }

  const after = process.memoryUsage();

  return NextResponse.json({
    gcAvailable: !!global.gc,
    before: {
      heapUsed: Math.round(before.heapUsed / 1024 / 1024),
      rss: Math.round(before.rss / 1024 / 1024),
    },
    after: {
      heapUsed: Math.round(after.heapUsed / 1024 / 1024),
      rss: Math.round(after.rss / 1024 / 1024),
    },
    freed: {
      heap: Math.round((before.heapUsed - after.heapUsed) / 1024 / 1024),
      rss: Math.round((before.rss - after.rss) / 1024 / 1024),
    },
    message: global.gc
      ? 'Garbage collection triggered'
      : 'GC not available. Run with: npm run dev:memory',
  });
}
