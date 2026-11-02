import { describe, expect, it } from 'vitest';
import { applyFields, validateFields } from '@/components/transactions/types';
import type { Category, Tx } from '@/components/transactions/types';

const categories: Category[] = [{ id: 'c1', name: 'Test Cat', type: 'expense' }];

const tx: Tx = {
  id: 't1',
  date: '2026-10-01T00:00:00.000Z',
  merchant: 'Test Merchant',
  amount: -12.5,
  category: { id: 'c0', name: 'Old Cat' },
  confidenceScore: 0.72,
  isTransfer: false,
  note: null,
  tags: [],
};

describe('applyFields', () => {
  it('applyFields sets category and confidence', () => {
    const next = applyFields(tx, { categoryId: 'c1' }, categories);
    expect(next.category).toEqual({ id: 'c1', name: 'Test Cat' });
    expect(next.confidenceScore).toBe(1);
  });

  it('applyFields with categoryId null clears category', () => {
    const next = applyFields(tx, { categoryId: null }, categories);
    expect(next.category).toBeNull();
    expect(next.confidenceScore).toBe(1);
  });

  it('copies scalar fields without touching category', () => {
    const next = applyFields(
      tx,
      { merchant: 'Other Merchant', amount: -3, note: 'n', tags: ['a'], isTransfer: true },
      categories
    );
    expect(next).toMatchObject({
      merchant: 'Other Merchant',
      amount: -3,
      note: 'n',
      tags: ['a'],
      isTransfer: true,
      category: { id: 'c0', name: 'Old Cat' },
      confidenceScore: 0.72,
    });
    expect(tx.merchant).toBe('Test Merchant');
  });
});

describe('validateFields', () => {
  it('rejects blank merchant and non-finite amount', () => {
    expect(validateFields({ merchant: ' ' })).toBe("Merchant can't be empty · not saved");
    expect(validateFields({ amount: Infinity })).toBe('Amount must be a number · not saved');
    expect(validateFields({ merchant: 'M', amount: 1 })).toBeNull();
    expect(validateFields({})).toBeNull();
  });
});
