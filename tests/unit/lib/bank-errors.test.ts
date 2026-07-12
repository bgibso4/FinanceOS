import { describe, it, expect } from 'vitest';
import { classifyPlaidError, classifyTellerError } from '@/lib/bank-errors';

describe('bank-errors', () => {
  describe('classifyPlaidError', () => {
    it('flags ITEM_LOGIN_REQUIRED as needing reconnection', () => {
      const error = {
        response: {
          data: {
            error_code: 'ITEM_LOGIN_REQUIRED',
            error_message: 'the login details of this item have changed',
          },
        },
      };
      const result = classifyPlaidError(error);
      expect(result.needsReauth).toBe(true);
      expect(result.code).toBe('ITEM_LOGIN_REQUIRED');
      expect(result.reason).toContain('ITEM_LOGIN_REQUIRED');
    });

    it('flags PENDING_EXPIRATION as needing reconnection', () => {
      const error = { response: { data: { error_code: 'PENDING_EXPIRATION' } } };
      expect(classifyPlaidError(error).needsReauth).toBe(true);
    });

    it('flags an invalid/stale access token as needing reconnection', () => {
      const error = { response: { data: { error_code: 'INVALID_ACCESS_TOKEN' } } };
      expect(classifyPlaidError(error).needsReauth).toBe(true);
    });

    it('does NOT flag transient server errors as needing reconnection', () => {
      const error = {
        response: { data: { error_code: 'INTERNAL_SERVER_ERROR', error_message: 'try again' } },
      };
      const result = classifyPlaidError(error);
      expect(result.needsReauth).toBe(false);
      // But it still surfaces the code so logs are useful.
      expect(result.code).toBe('INTERNAL_SERVER_ERROR');
      expect(result.reason).toContain('INTERNAL_SERVER_ERROR');
    });

    it('handles a plain Error with no Plaid response payload', () => {
      const result = classifyPlaidError(new Error('socket hang up'));
      expect(result.needsReauth).toBe(false);
      expect(result.code).toBeUndefined();
      expect(result.reason).toContain('socket hang up');
    });

    it('produces a concise reason, never a dump of the whole object', () => {
      const error = {
        response: { data: { error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'changed' } },
        config: { huge: 'x'.repeat(5000) },
        request: {},
      };
      const { reason } = classifyPlaidError(error);
      expect(reason.length).toBeLessThan(200);
    });
  });

  describe('classifyTellerError', () => {
    it('flags Teller\'s "Enrollment is not healthy" as needing reconnection', () => {
      const result = classifyTellerError(new Error('Enrollment is not healthy'));
      expect(result.needsReauth).toBe(true);
      expect(result.reason).toContain('not healthy');
    });

    it('flags 401 / unauthorized / authentication messages', () => {
      expect(classifyTellerError(new Error('Teller API error: 401')).needsReauth).toBe(true);
      expect(classifyTellerError(new Error('Unauthorized')).needsReauth).toBe(true);
      expect(classifyTellerError(new Error('authentication failed')).needsReauth).toBe(true);
    });

    it('does NOT flag transient server errors', () => {
      expect(classifyTellerError(new Error('Teller API error: 500')).needsReauth).toBe(false);
      expect(classifyTellerError(new Error('Teller API error: 503')).needsReauth).toBe(false);
    });

    it('handles non-Error values without throwing', () => {
      const result = classifyTellerError('Enrollment is not healthy');
      expect(result.needsReauth).toBe(true);
    });
  });
});
