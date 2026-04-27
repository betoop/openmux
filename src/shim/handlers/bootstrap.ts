/**
 * Shim Client Bootstrap
 * Handles client attach/detach and bootstrap flow
 */
import * as errore from 'errore';
import type net from 'net';
import { ShimConnectionError } from '../../effect/errors';
import { ResourceStack } from '../../effect/resources';
import { setKittyTransmitForwarder, setKittyUpdateForwarder } from '../kitty-forwarder';
import { setNotificationForwarder } from '../notification-forwarder';
import {
  getClientSessionId,
  isActiveClientForSession,
  rememberRevokedClientId,
} from '../server-state';
import type { AttachContext, ShimHandlerContext, WithPty } from './types';
import type { TerminalColors } from '../../terminal/terminal-colors';
import { isCurrentAttach, sendDetached } from './events';
import { cleanupCurrentClientBindings, subscribeAllPtys } from './subscription';
import { handleActivity, handleLifecycle, handleTitles } from './lifecycle';

/**
 * Start attach bootstrap - subscribe to all PTYs and set up event handlers.
 *
 * Connection identity (`socket` + `clientId`) is the attach guard. Every async
 * stage re-checks the active pair before sending replay frames or wiring global
 * subscriptions, so superseded bootstraps become no-ops.
 */
export function startAttachBootstrap(context: ShimHandlerContext, attach: AttachContext): void {
  const { state } = context;
  const { socket, clientId, sessionId } = attach;

  void (async () => {
    const ptyIdsResult = await subscribeAllPtys(context, {
      bootstrap: true,
      attach,
    });

    if (ptyIdsResult instanceof ShimConnectionError) {
      if (isCurrentAttach(state, socket, clientId, sessionId)) {
        console.warn('Failed to subscribe to PTYs:', ptyIdsResult.message);
      }
      return;
    }

    if (!isCurrentAttach(state, socket, clientId, sessionId)) return;

    if (!state.lifecycleUnsub) {
      const lifecycleResult = await handleLifecycle(context);
      if (lifecycleResult instanceof ShimConnectionError) {
        console.warn('Failed to subscribe to lifecycle:', lifecycleResult.message);
      }
    }

    if (!isCurrentAttach(state, socket, clientId, sessionId)) return;

    if (!state.titleUnsub) {
      const titlesResult = await handleTitles(context);
      if (titlesResult instanceof ShimConnectionError) {
        console.warn('Failed to subscribe to titles:', titlesResult.message);
      }
    }

    if (!isCurrentAttach(state, socket, clientId, sessionId)) return;

    if (!state.activityUnsub) {
      const activityResult = await handleActivity(context);
      if (activityResult instanceof ShimConnectionError) {
        console.warn('Failed to subscribe to activity:', activityResult.message);
      }
    }
  })().catch((e) => {
    if (!isCurrentAttach(state, socket, clientId, sessionId)) return;
    console.warn('[shim] Attach bootstrap failed:', e);
  });
}

/**
 * Attach a client to a session, detaching only the previous owner of that session.
 */
export async function attachClient(
  context: ShimHandlerContext,
  attach: AttachContext
): Promise<void> {
  const { state, sendEvent, kittyHandlers } = context;
  const { socket, clientId, sessionId } = attach;

  await using resources = new ResourceStack();

  const previousSessionId = getClientSessionId(state, socket);
  if (
    previousSessionId &&
    previousSessionId !== sessionId &&
    isActiveClientForSession(state, socket, clientId, previousSessionId)
  ) {
    state.activeClientsBySession.delete(previousSessionId);
  }

  const previousOwner = state.activeClientsBySession.get(sessionId) ?? null;
  const previousClient = previousOwner?.socket ?? null;
  const previousClientId = previousOwner?.clientId ?? null;
  if (previousClient && !previousClient.destroyed) {
    const isSameClient = previousClient === socket && previousClientId === clientId;
    if (!isSameClient) {
      sendDetached(previousClient);
      previousClient.end();
      state.clientIds.delete(previousClient);
      state.clientSessions.delete(previousClient);
      const prevClientRef = previousClient;
      if (!prevClientRef.destroyed) {
        resources.defer(() => {
          setTimeout(() => {
            if (!prevClientRef.destroyed) {
              prevClientRef.destroy();
            }
          }, 250);
        });
      }
    }
  }

  if (previousClientId && previousClient !== socket) {
    rememberRevokedClientId(state, previousClientId);
  }

  state.clientIds.set(socket, clientId);
  state.clientSessions.set(socket, sessionId);
  state.activeClientsBySession.set(sessionId, { socket, clientId });

  setKittyTransmitForwarder(kittyHandlers.sendKittyTransmit);
  setKittyUpdateForwarder(kittyHandlers.queueKittyUpdate);
  setNotificationForwarder((event) => {
    sendEvent({
      type: 'ptyNotification',
      ptyId: event.ptyId,
      notification: event.notification,
      subtitle: event.subtitle,
    });
  });

  startAttachBootstrap(context, attach);
}

/**
 * Detach a client from its active session.
 */
export async function detachClient(context: ShimHandlerContext, socket: net.Socket): Promise<void> {
  const { state } = context;
  const sessionId = state.clientSessions.get(socket) ?? null;
  const clientId = state.clientIds.get(socket) ?? null;

  if (sessionId && clientId && isActiveClientForSession(state, socket, clientId, sessionId)) {
    state.activeClientsBySession.delete(sessionId);
  }
  state.clientIds.delete(socket);
  state.clientSessions.delete(socket);

  if (sessionId) {
    for (const [ptyId, ptySessionId] of state.ptySessions.entries()) {
      if (ptySessionId === sessionId) {
        state.bootstrappingPtyIds.delete(ptyId);
      }
    }
  }

  if (state.activeClientsBySession.size > 0) return;

  state.bootstrappingPtyIds.clear();

  // Keep the kitty transmit forwarder active so it continues caching transmits
  // while detached. Update + notification forwarders require an attached client.
  setKittyUpdateForwarder(null);
  setNotificationForwarder(null);

  await cleanupCurrentClientBindings(state, { preserveKittyState: true });
}

/**
 * Apply host colors to all emulators.
 */
export async function applyHostColors(
  withPty: WithPty,
  setHostColors: (colors: TerminalColors) => void,
  colors: TerminalColors
): Promise<void> {
  setHostColors(colors);
  const result = await errore.tryAsync<void | Error, ShimConnectionError>({
    try: () => withPty((pty) => pty.setHostColors(colors)),
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to apply host colors: ${e}`, cause: e }),
  });
  if (result instanceof ShimConnectionError) {
    console.warn('Failed to apply host colors:', result.message);
    return;
  }
  if (result instanceof Error) {
    console.warn('Failed to apply host colors:', result.message);
  }
}
