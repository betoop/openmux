/**
 * Shim Lifecycle and Title Management
 * Handles PTY lifecycle events and title changes
 */
import * as errore from 'errore';
import type { PtyService } from '../../effect/services/Pty';
import { ShimConnectionError } from '../../effect/errors';
import type { ShimHandlerContext } from './types';
import { subscribeToPty, unsubscribeFromPty } from './subscription';
import { removeMappingForPty } from './mapping';

async function subscribeWithPty(
  context: Pick<ShimHandlerContext, 'withPty'>,
  operation: string,
  fn: (pty: PtyService) => Promise<(() => void) | Error> | (() => void) | Error
): Promise<(() => void) | ShimConnectionError> {
  const result = await errore.tryAsync<(() => void) | Error, ShimConnectionError>({
    try: () => context.withPty(fn),
    catch: (e) => new ShimConnectionError({ reason: `${operation}: ${e}`, cause: e }),
  });

  if (result instanceof ShimConnectionError) {
    return result;
  }
  if (result instanceof Error) {
    return new ShimConnectionError({ reason: `${operation}: ${result.message}`, cause: result });
  }
  return result;
}

/**
 * Subscribe to PTY lifecycle events (created/destroyed).
 */
export async function handleLifecycle(
  context: ShimHandlerContext
): Promise<void | ShimConnectionError> {
  const { state, sendEvent } = context;

  const result = await subscribeWithPty(context, 'Failed to subscribe to lifecycle events', (pty) =>
    pty.subscribeToLifecycle((event: { type: 'created' | 'destroyed'; ptyId: string }) => {
      const ptyId = String(event.ptyId);
      if (event.type === 'created') {
        subscribeToPty(context, ptyId).catch((e) => {
          console.warn(`Failed to subscribe to new PTY ${ptyId}:`, e);
        });
      } else {
        sendEvent({ type: 'ptyLifecycle', ptyId, event: event.type });
        unsubscribeFromPty(state, ptyId).catch((e) => {
          console.warn(`Failed to unsubscribe from PTY ${ptyId}:`, e);
        });
        removeMappingForPty(state, ptyId);
        return;
      }
      sendEvent({ type: 'ptyLifecycle', ptyId, event: event.type });
    })
  );

  if (result instanceof ShimConnectionError) return result;
  state.lifecycleUnsub = result;
}

/**
 * Subscribe to title changes across all PTYs.
 */
export async function handleTitles(
  context: ShimHandlerContext
): Promise<void | ShimConnectionError> {
  const { state, sendEvent } = context;

  const result = await subscribeWithPty(context, 'Failed to subscribe to title changes', (pty) =>
    pty.subscribeToTitle((event: { ptyId: string; title: string }) => {
      sendEvent({ type: 'ptyTitle', ptyId: String(event.ptyId), title: event.title });
    })
  );

  if (result instanceof ShimConnectionError) return result;
  state.titleUnsub = result;
}

/**
 * Subscribe to raw stdout activity across all PTYs.
 */
export async function handleActivity(
  context: ShimHandlerContext
): Promise<void | ShimConnectionError> {
  const { state, sendEvent } = context;

  const result = await subscribeWithPty(context, 'Failed to subscribe to activity changes', (pty) =>
    pty.subscribeToAllActivity((event: { ptyId: string }) => {
      sendEvent({ type: 'ptyActivity', ptyId: String(event.ptyId) });
    })
  );

  if (result instanceof ShimConnectionError) return result;
  state.activityUnsub = result;
}
