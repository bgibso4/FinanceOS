import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { SideNav } from '@/components/side-nav';

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
});

function stubStatus(needsAttention: boolean) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      enabled: true,
      lastFinishedAt: null,
      nextAround: null,
      failedSteps: [],
      needsAttention,
    }),
  })) as unknown as typeof fetch;
}

describe('SideNav attention dot', () => {
  it('sideNavDotWhenNeedsAttention', async () => {
    stubStatus(true);
    render(<SideNav />);
    expect(await screen.findByLabelText('Settings — needs attention')).toBeInTheDocument();
  });

  it('noDotWhenClean', async () => {
    stubStatus(false);
    render(<SideNav />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/scheduled-sync/status'));
    expect(screen.queryByLabelText('Settings — needs attention')).not.toBeInTheDocument();
  });
});
