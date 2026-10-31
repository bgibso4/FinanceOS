import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AdoptAccountModal } from '@/components/institutions/AdoptAccountModal';

function renderModal(type: string) {
  render(
    <AdoptAccountModal
      account={{
        externalId: 'acc_1',
        name: 'Test Account',
        type,
        subtype: '',
        lastFour: '1234',
      }}
      enrollmentId="enr_1"
      institutionName="Test Institution"
      provider="plaid"
      onAdopted={vi.fn()}
      onClose={vi.fn()}
    />
  );
}

describe('AdoptAccountModal investment note', () => {
  it('explains an investment account before adding it', () => {
    renderModal('investment');
    const note = screen.getByTestId('adopt-investment-note');
    expect(note.textContent).toContain('Your institution reports this as an investment account');
    expect(note.textContent).toContain('Balance source: Synced.');
  });

  it('shows no note for a bank account', () => {
    renderModal('depository');
    expect(screen.queryByTestId('adopt-investment-note')).toBeNull();
  });
});
