import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Tailwind 3.4 silently drops an opacity modifier on an arbitrary var colour
 * (`bg-[var(--accent)]/10` generates no CSS). Use the named token (`bg-accent/10`) instead.
 */
const BROKEN_PATTERN = /\b(?:border|bg|text|ring|divide|outline)-\[var\(--[\w-]+\)\]\/\d+/;

const filesUnder = (p: string): string[] =>
  statSync(p).isFile() ? [p] : readdirSync(p).flatMap((name) => filesUnder(path.join(p, name)));

describe('tailwind var-opacity guard', () => {
  it('recognisesTheBrokenPattern', () => {
    expect(BROKEN_PATTERN.test('bg-[var(--accent)]/10')).toBe(true);
    expect(BROKEN_PATTERN.test('bg-accent/10')).toBe(false);
    expect(BROKEN_PATTERN.test('bg-[var(--accent)]')).toBe(false);
  });

  it('findsNoneInSrc', () => {
    const hits = filesUnder('src')
      .filter((f) => /\.tsx?$/.test(f))
      .flatMap((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .flatMap((line, i) =>
            BROKEN_PATTERN.test(line) ? [`${f}:${i + 1}: ${line.trim()}`] : []
          )
      );
    expect(hits).toEqual([]);
  });
});
