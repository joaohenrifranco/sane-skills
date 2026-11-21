/**
 * Per-request context, carried through async calls with AsyncLocalStorage so
 * command handlers don't need every value threaded through their signatures.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  /** The CLI caller's working directory; relative paths resolve here. */
  cwd: string;
  /** Session name: commands act on that session's own tab. */
  session?: string;
  /** Caller-requested timeout for long commands (wait, handoff --until). */
  timeoutMs?: number;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function currentRequest(): RequestContext {
  return requestContext.getStore() ?? { cwd: process.cwd() };
}
