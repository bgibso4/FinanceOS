import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Spec §1/§7: investment code outside the vendor gateways holds no 'plaid', 'yahoo' or 'feed'
 * string literal. Scoped to investment code so bank-connection code (spec §2) doesn't trip it.
 */
const SCOPE = [
  'src/lib/investments',
  'src/lib/prices',
  'src/components/investments',
  'src/app/api/investments',
  'src/app/(routes)/investments',
  'src/lib/balances.ts',
];
const GATEWAYS = new Set([
  'src/lib/prices/yahoo.ts',
  'src/lib/investments/plaid-mapping.ts',
  'src/lib/investments/plaid-investment-sync.ts',
]);
const VENDOR_LITERAL = /(['"`])(plaid|yahoo|feed)\1/;

const filesUnder = (p: string): string[] =>
  statSync(p).isFile() ? [p] : readdirSync(p).flatMap((name) => filesUnder(path.join(p, name)));

describe('vendor-literal guard', () => {
  it('recognises a vendor literal and ignores a path that merely contains one', () => {
    expect(VENDOR_LITERAL.test("where: { source: 'yahoo' }")).toBe(true);
    expect(VENDOR_LITERAL.test('pricing: "feed"')).toBe(true);
    expect(VENDOR_LITERAL.test("import('../prices/yahoo')")).toBe(false);
  });

  it('finds none in investment code outside the gateways', () => {
    const hits = SCOPE.flatMap(filesUnder)
      .filter((f) => /\.tsx?$/.test(f) && !GATEWAYS.has(f))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .flatMap((line, i) =>
            VENDOR_LITERAL.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : []
          )
      );
    expect(hits).toEqual([]);
  });
});
