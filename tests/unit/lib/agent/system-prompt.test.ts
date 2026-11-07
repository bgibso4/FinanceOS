import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '@/lib/agent/system-prompt';
import { localDay } from '@/lib/dates';

describe('buildSystemPrompt', () => {
  it('includes base instructions', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('personal finance analyst');
    expect(prompt).toContain('Never guess or fabricate numbers');
  });

  it('includes current date', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain(`Today's date: ${localDay()}`);
  });

  it('injects category tree', () => {
    const categories = [
      { name: 'Groceries', type: 'expense', parentName: 'Food & Dining' },
      { name: 'Restaurants', type: 'expense', parentName: 'Food & Dining' },
      { name: 'Salary', type: 'income', parentName: null },
    ];
    const prompt = buildSystemPrompt(categories);
    expect(prompt).toContain('Food & Dining');
    expect(prompt).toContain('Groceries');
    expect(prompt).toContain('Restaurants');
    expect(prompt).toContain('Salary');
  });

  it('handles empty categories', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('No categories configured yet');
  });
});
