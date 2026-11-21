/**
 * Typed errors → CLI exit codes.
 *
 *   0  ok
 *   1  failed      the command ran and the page/browser did not cooperate
 *   2  usage       bad arguments, bad path, conflicting config — fix the call
 *   3  needs_user  a human step is required (CAPTCHA, login, Keychain dialog)
 */

export type ErrorCode = 'failed' | 'usage' | 'needs_user';

export const EXIT_CODES: Record<ErrorCode, number> = { failed: 1, usage: 2, needs_user: 3 };

export class BrowseError extends Error {
  constructor(
    message: string,
    public code: ErrorCode = 'failed',
    public hint?: string,
  ) {
    super(message);
    this.name = 'BrowseError';
  }
}

export const usage = (message: string, hint?: string) => new BrowseError(message, 'usage', hint);
export const needsUser = (message: string, hint?: string) => new BrowseError(message, 'needs_user', hint);
