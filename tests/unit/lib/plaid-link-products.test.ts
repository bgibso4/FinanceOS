import { describe, it, expect } from 'vitest';
import { Products } from 'plaid';
import { linkProductsFor } from '@/lib/plaid';

describe('linkProductsFor', () => {
  it('requires only Transactions for banking links', () => {
    expect(linkProductsFor('banking')).toEqual({ products: [Products.Transactions] });
  });

  it('requires Investments and treats Transactions as optional for investment links', () => {
    // Transactions in `products` would filter brokerage/IRA/401k/HSA accounts out of Link
    expect(linkProductsFor('investments')).toEqual({
      products: [Products.Investments],
      optional_products: [Products.Transactions],
    });
  });
});
