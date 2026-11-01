export type Tx = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category?: { id: string; name: string } | null;
  account?: { id: string; name: string; currency?: string } | null;
  confidenceScore: number;
  isTransfer: boolean;
  note?: string | null;
  tags?: string[];
  isOffset?: boolean;
  linkedTransactionId?: string | null;
  linkedTransaction?: Tx | null;
  offsetTransactions?: Tx[];
  parentTransactionId?: string | null;
  isSplitParent?: boolean;
  parentTransaction?: {
    id: string;
    amount: number;
    merchant: string;
    splitParts?: {
      id: string;
      amount: number;
      categoryId: string | null;
      note: string | null;
      category?: { id: string; name: string } | null;
    }[];
  } | null;
};

export type Category = {
  id: string;
  name: string;
  type: string;
  parentId?: string | null;
};

export type Account = { id: string; name: string };

export type TxFields = {
  date?: string;
  amount?: number;
  merchant?: string;
  categoryId?: string | null;
  note?: string | null;
  tags?: string[];
  isTransfer?: boolean;
};

export function validateFields(f: TxFields): string | null {
  if (f.merchant !== undefined && !f.merchant.trim()) return "Merchant can't be empty · not saved";
  if (f.amount !== undefined && !Number.isFinite(f.amount)) {
    return 'Amount must be a number · not saved';
  }
  return null;
}

export function applyFields(tx: Tx, f: TxFields, categories: Category[]): Tx {
  const { categoryId, ...scalars } = f;
  const next: Tx = { ...tx, ...scalars };
  if (categoryId !== undefined) {
    const category = categories.find((c) => c.id === categoryId);
    next.category = category ? { id: category.id, name: category.name } : null;
    // Mirrors the PATCH route: a manual category choice is full confidence.
    next.confidenceScore = 1;
  }
  return next;
}
