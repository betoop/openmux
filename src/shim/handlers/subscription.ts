/**
 * Shim PTY Subscription Management
 * Handles subscribing and unsubscribing from PTY updates.
 */
import * as errore from 'errore';
import type { UnifiedTerminalUpdate } from '../../core/types';
import type { PtyService } from '../../effect/services/Pty';
import { packDirtyUpdate } from '../../terminal/cell-serialization';
import { ShimConnectionError } from '../../effect/errors';
import { asPtyId } from '../../effect/types';
import { ResourceStack } from '../../effect/resources';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import type { ShimServerState } from '../server-state';
import type { BootstrapOptions, ShimHandlerContext } from './types';
import { allowBootstrapReplay } from './replay';
import { getPtyIdsForSession, removeMappingForPty } from './mapping';

type PtyStreamEvent =
  | { type: 'update'; update: UnifiedTerminalUpdate }
  | { type: 'exit'; exitCode: number };

async function callPty<A>(
  context: Pick<ShimHandlerContext, 'withPty'>,
  operation: string,
  fn: (pty: PtyService) => Promise<A | Error> | A | Error
): Promise<A | ShimConnectionError> {
  const result = await errore.tryAsync<A | Error, ShimConnectionError>({
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

async function subscribeToPtyStream(
  context: ShimHandlerContext,
  ptyId: string,
  callback: (event: PtyStreamEvent) => void
): Promise<(() => void) | ShimConnectionError> {
  const unifiedUnsub = await callPty<() => void>(
    context,
    `Failed to subscribe to unified updates for PTY ${ptyId}`,
    (pty) =>
      pty.subscribe(asPtyId(ptyId), (update: UnifiedTerminalUpdate) => {
        callback({ type: 'update', update });
      })
  );
  if (unifiedUnsub instanceof ShimConnectionError) {
    return unifiedUnsub;
  }

  const exitUnsub = await callPty<() => void>(
    context,
    `Failed to subscribe to exit events for PTY ${ptyId}`,
    (pty) =>
      pty.onExit(asPtyId(ptyId), (exitCode: number) => {
        callback({ type: 'exit', exitCode });
      })
  );
  if (exitUnsub instanceof ShimConnectionError) {
    unifiedUnsub();
    return exitUnsub;
  }

  return () => {
    exitUnsub();
    unifiedUnsub();
  };
}

function sendUnifiedUpdate(
  context: ShimHandlerContext,
  ptyId: string,
  update: UnifiedTerminalUpdate,
  allowWhileBootstrapping: boolean
): void {
  const { state, sendEvent, kittyHandlers } = context;
  state.ptyScrollStates.set(ptyId, update.scrollState);

  const packed = packDirtyUpdate(update.terminalUpdate);
  const payloads: ArrayBuffer[] = [
    packed.dirtyRowIndices.buffer.slice(0) as ArrayBuffer,
    packed.dirtyRowData as ArrayBuffer,
    (packed.fullStateData ?? new ArrayBuffer(0)) as ArrayBuffer,
  ];

  sendEvent(
    {
      type: 'ptyUpdate',
      ptyId,
      packed: {
        cursor: packed.cursor,
        cols: packed.cols,
        rows: packed.rows,
        scrollbackLength: packed.scrollbackLength,
        isFull: packed.isFull,
        alternateScreen: packed.alternateScreen,
        mouseTracking: packed.mouseTracking,
        cursorKeyMode: packed.cursorKeyMode,
        kittyKeyboardFlags: packed.kittyKeyboardFlags,
        inBandResize: packed.inBandResize,
      },
      scrollState: {
        viewportOffset: update.scrollState.viewportOffset,
        isAtBottom: update.scrollState.isAtBottom,
      },
      payloadLengths: payloads.map((payload) => payload.byteLength),
    },
    payloads,
    { allowWhileBootstrapping }
  );

  const emulator = state.ptyEmulators.get(ptyId);
  if (!emulator) {
    return;
  }

  kittyHandlers.sendKittyUpdate(ptyId, emulator, false, {
    allowWhileBootstrapping,
  });
}

/**
 * Subscribe to a PTY and begin receiving updates.
 */
export async function subscribeToPty(
  context: ShimHandlerContext,
  ptyId: string,
  options?: BootstrapOptions
): Promise<void | ShimConnectionError> {
  const { state } = context;
  const canBootstrapReplay = () => allowBootstrapReplay(state, options);

  if (state.ptySubscriptions.has(ptyId)) {
    if (!options?.bootstrap || !canBootstrapReplay()) {
      return;
    }

    state.bootstrappingPtyIds.add(ptyId);
    const { replayPtyState } = await import('./replay');
    const replayResult = await replayPtyState(
      state,
      context.withPty,
      context.sendEvent,
      context.kittyHandlers,
      ptyId,
      { allowWhileBootstrapping: true }
    );
    state.bootstrappingPtyIds.delete(ptyId);
    return replayResult;
  }

  const bootstrap = options?.bootstrap === true;
  if (bootstrap) {
    state.bootstrappingPtyIds.add(ptyId);
  }

  const emulator = await callPty<ITerminalEmulator>(
    context,
    `Failed to get emulator for PTY ${ptyId}`,
    (pty) => pty.getEmulator(asPtyId(ptyId)) as Promise<ITerminalEmulator | Error>
  );
  if (emulator instanceof ShimConnectionError) {
    if (bootstrap) {
      state.bootstrappingPtyIds.delete(ptyId);
    }
    return emulator;
  }

  state.ptyEmulators.set(ptyId, emulator);

  const unsubscribe = await subscribeToPtyStream(context, ptyId, (event) => {
    if (event.type === 'update') {
      sendUnifiedUpdate(context, ptyId, event.update, canBootstrapReplay());
      return;
    }

    context.sendEvent({ type: 'ptyExit', ptyId, exitCode: event.exitCode });
    removeMappingForPty(state, ptyId);
  });

  if (unsubscribe instanceof ShimConnectionError) {
    state.ptyEmulators.delete(ptyId);
    if (bootstrap) {
      state.bootstrappingPtyIds.delete(ptyId);
    }
    return unsubscribe;
  }

  state.ptySubscriptions.set(ptyId, { unsubscribe });
  if (bootstrap) {
    state.bootstrappingPtyIds.delete(ptyId);
  }
}

/**
 * Unsubscribe from a PTY and cleanup resources.
 */
export async function unsubscribeFromPty(
  state: ShimServerState,
  ptyId: string,
  options?: { preserveKittyState?: boolean }
): Promise<void> {
  const subs = state.ptySubscriptions.get(ptyId);
  if (!subs) return;

  await using resources = new ResourceStack();

  resources.registerSubscription(subs.unsubscribe);

  resources.deferSafe(() => {
    state.ptySubscriptions.delete(ptyId);
  });
  resources.deferSafe(() => {
    state.ptyEmulators.delete(ptyId);
  });
  resources.deferSafe(() => {
    state.ptyScrollStates.delete(ptyId);
  });
  resources.deferSafe(() => {
    state.bootstrappingPtyIds.delete(ptyId);
  });

  if (!options?.preserveKittyState) {
    resources.deferSafe(() => {
      state.kittyImages.delete(ptyId);
    });
    resources.deferSafe(() => {
      state.kittyTransmitCache.delete(ptyId);
    });
    resources.deferSafe(() => {
      state.kittyTransmitPending.delete(ptyId);
    });
    resources.deferSafe(() => {
      state.kittyTransmitInvalidated.delete(ptyId);
    });
  }
}

/**
 * Subscribe to all active PTYs.
 */
export async function subscribeAllPtys(
  context: ShimHandlerContext,
  options?: BootstrapOptions
): Promise<string[] | ShimConnectionError> {
  const allPtyIds = await callPty<string[]>(
    context,
    'Failed to list PTYs',
    (pty) => pty.listAll() as Promise<string[] | Error>
  );
  if (allPtyIds instanceof ShimConnectionError) {
    return allPtyIds;
  }

  const ptyIds = options?.attach
    ? getPtyIdsForSession(context.state, options.attach.sessionId).filter((id) =>
        allPtyIds.map(String).includes(id)
      )
    : allPtyIds.map(String);

  await Promise.all(
    ptyIds.map(async (id) => {
      const result = await subscribeToPty(context, String(id), options);
      if (result instanceof ShimConnectionError) {
        console.warn(`Failed to subscribe to PTY ${id}:`, result.message);
      }
    })
  );

  return ptyIds;
}

/**
 * Cleanup all current client subscriptions.
 */
export async function cleanupCurrentClientBindings(
  state: ShimServerState,
  options?: { preserveKittyState?: boolean }
): Promise<void> {
  await using resources = new ResourceStack();

  state.bootstrappingPtyIds.clear();

  for (const ptyId of [...state.ptySubscriptions.keys()]) {
    resources.defer(() =>
      unsubscribeFromPty(state, ptyId, { preserveKittyState: options?.preserveKittyState }).catch(
        (e) => {
          console.warn(`Failed to unsubscribe from PTY ${ptyId}:`, e);
        }
      )
    );
  }

  if (state.lifecycleUnsub) {
    resources.registerSubscription(state.lifecycleUnsub);
    resources.deferSafe(() => {
      state.lifecycleUnsub = null;
    });
  }
  if (state.titleUnsub) {
    resources.registerSubscription(state.titleUnsub);
    resources.deferSafe(() => {
      state.titleUnsub = null;
    });
  }
  if (state.activityUnsub) {
    resources.registerSubscription(state.activityUnsub);
    resources.deferSafe(() => {
      state.activityUnsub = null;
    });
  }
}
