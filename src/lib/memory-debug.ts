/**
 * Memory debugging utilities for development
 * Usage: import { logMemoryUsage, trackMemory } from '@/lib/memory-debug';
 */

interface MemorySnapshot {
  label: string;
  timestamp: number;
  heapUsed: number;
  heapTotal: number;
  rss: number;
  external: number;
}

const snapshots: MemorySnapshot[] = [];

/**
 * Log current memory usage to console
 */
export function logMemoryUsage(label: string): void {
  if (process.env.NODE_ENV === 'production') return;

  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  const externalMB = Math.round(used.external / 1024 / 1024);

  console.log(`\n[Memory] ${label}`);
  console.log(`  Heap Used:  ${heapUsedMB} MB`);
  console.log(`  Heap Total: ${heapTotalMB} MB`);
  console.log(`  RSS:        ${rssMB} MB`);
  console.log(`  External:   ${externalMB} MB`);
}

/**
 * Take a memory snapshot for comparison
 */
export function takeSnapshot(label: string): MemorySnapshot {
  const used = process.memoryUsage();
  const snapshot: MemorySnapshot = {
    label,
    timestamp: Date.now(),
    heapUsed: used.heapUsed,
    heapTotal: used.heapTotal,
    rss: used.rss,
    external: used.external,
  };
  snapshots.push(snapshot);
  return snapshot;
}

/**
 * Compare two snapshots and log the difference
 */
export function compareSnapshots(before: MemorySnapshot, after: MemorySnapshot): void {
  if (process.env.NODE_ENV === 'production') return;

  const heapDiff = (after.heapUsed - before.heapUsed) / 1024 / 1024;
  const rssDiff = (after.rss - before.rss) / 1024 / 1024;
  const timeDiff = after.timestamp - before.timestamp;

  console.log(`\n[Memory Delta] ${before.label} → ${after.label}`);
  console.log(`  Heap Change: ${heapDiff >= 0 ? '+' : ''}${heapDiff.toFixed(2)} MB`);
  console.log(`  RSS Change:  ${rssDiff >= 0 ? '+' : ''}${rssDiff.toFixed(2)} MB`);
  console.log(`  Time:        ${timeDiff} ms`);
}

/**
 * Higher-order function to track memory usage of an async function
 */
export function trackMemory<T extends (...args: unknown[]) => Promise<unknown>>(
  fn: T,
  label: string
): T {
  return (async (...args: Parameters<T>) => {
    const before = takeSnapshot(`${label}:start`);
    try {
      const result = await fn(...args);
      const after = takeSnapshot(`${label}:end`);
      compareSnapshots(before, after);
      return result;
    } catch (error) {
      const after = takeSnapshot(`${label}:error`);
      compareSnapshots(before, after);
      throw error;
    }
  }) as T;
}

/**
 * Get all recorded snapshots
 */
export function getSnapshots(): MemorySnapshot[] {
  return [...snapshots];
}

/**
 * Clear all recorded snapshots
 */
export function clearSnapshots(): void {
  snapshots.length = 0;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Log a summary of current memory state with recommendations
 */
export function memoryReport(): void {
  if (process.env.NODE_ENV === 'production') return;

  const used = process.memoryUsage();
  const heapUsedMB = used.heapUsed / 1024 / 1024;
  const rssMB = used.rss / 1024 / 1024;

  console.log('\n========== MEMORY REPORT ==========');
  console.log(`Heap Used:  ${formatBytes(used.heapUsed)}`);
  console.log(`Heap Total: ${formatBytes(used.heapTotal)}`);
  console.log(`RSS:        ${formatBytes(used.rss)}`);
  console.log(`External:   ${formatBytes(used.external)}`);

  // Warnings
  if (heapUsedMB > 500) {
    console.log('\n⚠️  WARNING: Heap usage exceeds 500 MB');
  }
  if (rssMB > 1000) {
    console.log('\n🚨 CRITICAL: RSS exceeds 1 GB');
  }

  // Snapshot summary if any exist
  if (snapshots.length > 0) {
    console.log(`\nSnapshots recorded: ${snapshots.length}`);
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const totalGrowth = (last.heapUsed - first.heapUsed) / 1024 / 1024;
    console.log(`Total heap growth: ${totalGrowth >= 0 ? '+' : ''}${totalGrowth.toFixed(2)} MB`);
  }

  console.log('====================================\n');
}
