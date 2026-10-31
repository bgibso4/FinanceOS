import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from '@/components/ui/drawer';
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
});
