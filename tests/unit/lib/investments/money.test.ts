import { describe, it, expect } from 'vitest';
import { roundCents } from '@/lib/investments/money';

describe('roundCents', () => {
  it('rounds to cents', () => {
    expect(roundCents(10.005)).toBe(10.01);
    expect(roundCents(0.1 + 0.2)).toBe(0.3);
    expect(roundCents(-1.234)).toBe(-1.23);
  });
});
