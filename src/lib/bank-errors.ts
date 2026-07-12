/**
 * Shared classification of bank-provider errors.
 *
 * Two code paths need to answer the same question — "does this error mean the
 * bank connection is dead and the user must reconnect?" — the *sync* routes and
 * the *enrollment-listing* routes. Historically each answered it with its own
 * inline string matching, and the two drifted: the Teller sync route learned to
 * recognize "Enrollment is not healthy" but the enrollment GET route did not, so
 * a disconnected Teller bank kept showing "Connected" in Settings until a sync
 * was manually triggered. Centralizing the logic here keeps them in lockstep.
 */

export type BankReauthClassification = {
  /** True when the user must re-run Plaid Link / Teller Connect to fix this. */
  needsReauth: boolean;
  /** Provider error code when available (e.g. Plaid's ITEM_LOGIN_REQUIRED). */
  code?: string;
  /** Concise, one-line reason suitable for a log/warning — never an object dump. */
  reason: string;
};

// Plaid error codes that mean the stored access token can no longer reach the
// bank. All are resolved by re-running Link in update mode (a "reconnect").
// See https://plaid.com/docs/errors/item/ and .../invalid-input/.
const PLAID_REAUTH_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'INVALID_CREDENTIALS',
  'INVALID_ACCESS_TOKEN',
  'INVALID_MFA',
  'ITEM_LOCKED',
  'USER_PERMISSION_REVOKED',
  'USER_ACCOUNT_REVOKED',
]);

/**
 * Classify an error thrown by the Plaid SDK (an Axios error). The useful signal
 * lives in `error.response.data.error_code` / `error_message`; the surrounding
 * AxiosError is huge, so we extract just those fields for the reason string.
 */
export function classifyPlaidError(error: unknown): BankReauthClassification {
  const err = error as {
    response?: { data?: { error_code?: string; error_message?: string } };
    message?: string;
  };

  const code = err?.response?.data?.error_code;
  const message =
    err?.response?.data?.error_message ||
    (error instanceof Error ? error.message : err?.message) ||
    'Unknown Plaid error';

  const reason = code ? `${code}: ${message}` : message;

  return {
    needsReauth: code ? PLAID_REAUTH_CODES.has(code) : false,
    code,
    reason,
  };
}

/**
 * Classify an error thrown by `tellerFetch`. Teller surfaces re-auth conditions
 * as plain-text messages — most notably "Enrollment is not healthy" — rather
 * than a machine code, so we match on the message.
 */
export function classifyTellerError(error: unknown): BankReauthClassification {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const lower = message.toLowerCase();

  const needsReauth =
    message.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('authentication') ||
    lower.includes('enrollment') ||
    lower.includes('not healthy') ||
    lower.includes('disconnected');

  return {
    needsReauth,
    reason: message || 'Unknown Teller error',
  };
}
