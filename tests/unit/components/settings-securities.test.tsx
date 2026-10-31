import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { makeSecurityItem } from '../../helpers/investment-overview';

// Overrides tests/setup.ts for this file: the page reads ?tab= and ?security=.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams('tab=securities&security=sec-aaa'),
}));

import SettingsPage from '@/app/(routes)/settings/page';

beforeEach(() => {
  // Every other Settings endpoint answers `{}`; the page defaults each missing list to [].
  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const body =
      String(url) === '/api/investments/securities'
        ? { securities: [makeSecurityItem()], symbolHint: 'Use test symbols.' }
        : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  }) as unknown as typeof fetch;
});

describe('Settings → Securities', () => {
  it('sits between Accounts and Categories and opens on the deep-linked security', async () => {
    render(<SettingsPage />);
    const tabs = screen.getAllByRole('link').map((l) => l.textContent);
    const at = tabs.indexOf('Accounts');
    expect(tabs.slice(at, at + 3)).toEqual(['Accounts', 'Securities', 'Categories']);
    expect(screen.getByRole('link', { name: 'Securities' })).toHaveAttribute(
      'href',
      '/settings?tab=securities'
    );
    expect(await screen.findByRole('listitem', { name: 'AAA' })).toHaveAttribute(
      'aria-current',
      'true'
    );
  });
});
