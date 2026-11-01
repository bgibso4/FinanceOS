import { describe, it, expect, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer, DRAWER_DISMISS } from '@/components/ui/drawer';
import { Modal } from '@/components/ui/modal';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    render(
      <Drawer open={false} title="Manage A" onClose={vi.fn()}>
        body
      </Drawer>
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('is a non-modal dialog labelled by its title, with the subtitle', () => {
    render(
      <Drawer open subtitle="Test Bank" title="Manage Test Checking" onClose={vi.fn()}>
        body
      </Drawer>
    );
    const d = screen.getByRole('dialog', { name: 'Manage Test Checking' });
    expect(d).toHaveAttribute('aria-modal', 'false');
    expect(screen.getByText('Test Bank')).toBeInTheDocument();
  });

  it('moves focus into the drawer on open and back to the opener on close', () => {
    const { rerender } = render(
      <>
        <button type="button">Open</button>
        <Drawer open={false} title="Manage A" onClose={vi.fn()}>
          x
        </Drawer>
      </>
    );
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    rerender(
      <>
        <button type="button">Open</button>
        <Drawer open title="Manage A" onClose={vi.fn()}>
          x
        </Drawer>
      </>
    );
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    rerender(
      <>
        <button type="button">Open</button>
        <Drawer open={false} title="Manage A" onClose={vi.fn()}>
          x
        </Drawer>
      </>
    );
    expect(opener).toHaveFocus();
  });

  it('closes on Esc and on ✕', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open title="Manage A" onClose={onClose}>
        x
      </Drawer>
    );
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes on a click on empty layout space, not on content inside it', async () => {
    const onClose = vi.fn();
    render(
      <>
        <div data-testid="gap" {...DRAWER_DISMISS}>
          <button type="button">Row</button>
        </div>
        <Drawer open title="Manage A" onClose={onClose}>
          x
        </Drawer>
      </>
    );
    await userEvent.click(screen.getByRole('button', { name: 'Row' }));
    await userEvent.click(screen.getByText('x'));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('gap'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores Esc while a modal dialog is open over it', async () => {
    const onClose = vi.fn();
    render(
      <>
        <Drawer open title="Manage A" onClose={onClose}>
          x
        </Drawer>
        <Modal isOpen title="Edit" onClose={vi.fn()}>
          y
        </Modal>
      </>
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders actions before the close button and headerExtra under the subtitle', () => {
    render(
      <Drawer
        open
        actions={<button type="button">Prev</button>}
        headerExtra={<div>−$1.00</div>}
        subtitle="2026-01-02 · Test Card"
        title="Test Merchant"
        onClose={vi.fn()}
      >
        body
      </Drawer>
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label') ?? b.textContent)).toEqual([
      'Prev',
      'Close',
    ]);
    expect(screen.getByText('−$1.00')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toHaveAttribute('title', 'Close · Esc');
  });

  it('slides out showing what was open, hidden and inert, then unmounts', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(
        <Drawer open title="Manage A" onClose={vi.fn()}>
          body
        </Drawer>
      );
      expect(screen.getByRole('dialog')).toHaveClass('translate-x-0');
      rerender(
        <Drawer open={false} title="" onClose={vi.fn()}>
          {null}
        </Drawer>
      );
      expect(screen.queryByRole('dialog')).toBeNull();
      const panel = screen.getByRole('dialog', { hidden: true });
      expect(panel).toHaveClass('translate-x-full');
      expect(panel).toHaveAttribute('inert');
      expect(screen.getByText('body')).toBeInTheDocument();
      expect(screen.getByText('Manage A')).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(300));
      expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a footer outside the scrolling body', () => {
    render(
      <Drawer open footer={<button type="button">Add</button>} title="New" onClose={vi.fn()}>
        body
      </Drawer>
    );
    expect(screen.getByText('body').closest('.overflow-y-auto')).not.toContainElement(
      screen.getByRole('button', { name: 'Add' })
    );
  });
});
