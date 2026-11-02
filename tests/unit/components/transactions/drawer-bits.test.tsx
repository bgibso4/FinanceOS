import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DrawerNav } from '@/components/transactions/drawer-nav';
import { SaveStatus } from '@/components/transactions/save-status';
import { DeleteZone } from '@/components/transactions/delete-zone';
import { CategorySelect } from '@/components/transactions/category-select';

describe('DrawerNav', () => {
  it('shows position and disables ends', async () => {
    const onStep = vi.fn();
    render(<DrawerNav count={3} index={0} onStep={onStep} />);
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous transaction' })).toBeDisabled();
    const next = screen.getByRole('button', { name: 'Next transaction' });
    expect(next).toBeEnabled();
    await userEvent.click(next);
    expect(onStep).toHaveBeenCalledWith(1);
  });

  it('renders nothing for index -1', () => {
    const { container } = render(<DrawerNav count={3} index={-1} onStep={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('SaveStatus', () => {
  it('shows Try again on error and calls onRetry', async () => {
    const onRetry = vi.fn();
    render(<SaveStatus message={null} status="error" onRetry={onRetry} />);
    expect(screen.getByText(/Couldn't save/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows invalid message', () => {
    render(<SaveStatus message="Amount is required" status="invalid" onRetry={vi.fn()} />);
    expect(screen.getByText('Amount is required')).toBeInTheDocument();
  });
});

describe('DeleteZone', () => {
  it('asks before deleting', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<DeleteZone onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
    expect(screen.getByText('Delete this transaction for good?')).toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.getByRole('button', { name: 'Delete transaction' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete transaction' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('CategorySelect', () => {
  const categories = [
    { id: 'g1', name: 'Group', type: 'expense', parentId: null },
    { id: 'c1', name: 'Test A', type: 'expense', parentId: 'g1' },
  ];

  it('takes a placeholder and class, and reports the empty choice as null', async () => {
    const onChange = vi.fn();
    render(
      <CategorySelect
        aria-label="Bulk category"
        categories={categories}
        className="w-48"
        placeholder="Set category..."
        value="c1"
        onChange={onChange}
      />
    );
    const select = screen.getByLabelText('Bulk category');
    expect(select).toHaveClass('w-48');
    await userEvent.selectOptions(select, 'Set category...');
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('defaults to "No category"', () => {
    render(
      <CategorySelect aria-label="Category" categories={categories} value="" onChange={vi.fn()} />
    );
    expect(screen.getByRole('option', { name: 'No category' })).toBeInTheDocument();
  });
});
