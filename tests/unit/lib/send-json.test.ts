import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendJson } from '@/lib/send-json';

const failWith = (body: unknown) => {
  global.fetch = vi.fn(async () => ({
    ok: false,
    json: async () => body,
  })) as unknown as typeof fetch;
};

describe('sendJson errors', () => {
  beforeEach(() => vi.restoreAllMocks());

  it("carries the API's error", async () => {
    failWith({ error: 'Test failure' });
    await expect(sendJson('/x', 'GET')).rejects.toThrow(/^Test failure$/);
  });

  it('adds a details message', async () => {
    failWith({ error: 'Test failure', details: 'Test cause' });
    await expect(sendJson('/x', 'GET')).rejects.toThrow(/^Test failure: Test cause$/);
  });

  it('adds each validation issue', async () => {
    failWith({
      error: 'Validation error',
      details: [{ message: 'Test first' }, { message: 'Test second' }],
    });
    await expect(sendJson('/x', 'GET')).rejects.toThrow(
      /^Validation error: Test first, Test second$/
    );
  });

  it('ignores details it cannot read', async () => {
    failWith({ error: 'Test failure', details: { code: 7 } });
    await expect(sendJson('/x', 'GET')).rejects.toThrow(/^Test failure$/);
  });
});
