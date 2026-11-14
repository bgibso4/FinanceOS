import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TagsTable, type TagWithTotals } from '@/components/settings/tags-table';
import { tagCostHref } from '@/lib/analytics-query';

const TODAY = '2026-11-13';
const greenCard: TagWithTotals = {
  id: 't1',
  name: 'Green Card',
  color: 'green',
  transactionCount: 9,
  total: 5943,
  firstDate: '2025-01-05',
  lastDate: '2026-10-20',
};
const incomeOnly: TagWithTotals = {
  id: 't2',
  name: 'Refunds',
  color: 'blue',
  transactionCount: 3,
  total: 0,
  firstDate: null,
  lastDate: null,
};

const setup = (tags: TagWithTotals[]) => {
  const onEdit = vi.fn();
  const onDelete = vi.fn();
  render(<TagsTable tags={tags} today={TODAY} onDelete={onDelete} onEdit={onEdit} />);
  return { onEdit, onDelete };
};

describe('TagsTable', () => {
  it('showsCountTotalAndLink', () => {
    setup([greenCard]);
    expect(screen.getByText('9')).toBeTruthy();
    expect(screen.getByText('$5,943')).toBeTruthy();
    expect(screen.getByRole('link', { name: /See cost/ }).getAttribute('href')).toBe(
      tagCostHref({ name: 'Green Card', firstDate: '2025-01-05', lastDate: '2026-10-20' }, TODAY)
    );
  });

  it('zeroSpendTagHasNoLink', () => {
    setup([incomeOnly]);
    expect(screen.getByText('$0')).toBeTruthy();
    expect(screen.queryByText(/-\$0|−\$0/)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('rowClickEditsLinkDoesNot', async () => {
    const { onEdit } = setup([greenCard]);
    const link = screen.getByRole('link', { name: /See cost/ });
    link.addEventListener('click', (e) => e.preventDefault());
    await userEvent.click(link);
    expect(onEdit).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText('Green Card'));
    expect(onEdit).toHaveBeenCalledWith(greenCard);
  });

  it('deleteCallsOnDelete', async () => {
    const { onEdit, onDelete } = setup([greenCard]);
    await userEvent.click(screen.getByRole('button', { name: /Delete tag/ }));
    expect(onDelete).toHaveBeenCalledWith(greenCard);
    expect(onEdit).not.toHaveBeenCalled();
  });
});
