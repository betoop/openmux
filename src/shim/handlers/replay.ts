/**
 * Shim PTY State Replay
 * Handles replaying PTY state to newly attached clients
 */
import * as errore from 'errore';
import type { TerminalScrollState, TerminalState, DirtyTerminalUpdate } from '../../core/types';
import type { ITerminalEmulator } from '../../terminal/emulator-interface';
import { packDirtyUpdate } from '../../terminal/cell-serialization';
import { buildGuestKey } from '../../terminal/kitty-graphics/sequence-utils';
import { ShimConnectionError } from '../../effect/errors';
import type { KittyHandlers } from '../server/kitty';
import { isActiveClientForSession, type ShimServerState } from '../server-state';
import { asPtyId } from '../../effect/types';
import type { SendEvent, WithPty, AttachContext } from './types';

/**
 * Send a full terminal state snapshot to client
 */
export function sendFullSnapshot(
  sendEvent: SendEvent,
  ptyId: string,
  terminalState: TerminalState,
  scrollState: TerminalScrollState,
  options?: { allowWhileBootstrapping?: boolean }
): void {
  const update: DirtyTerminalUpdate = {
    dirtyRows: new Map(),
    cursor: terminalState.cursor,
    scrollState,
    cols: terminalState.cols,
    rows: terminalState.rows,
    isFull: true,
    fullState: terminalState,
    alternateScreen: terminalState.alternateScreen,
    mouseTracking: terminalState.mouseTracking,
    cursorKeyMode: terminalState.cursorKeyMode ?? 'normal',
    kittyKeyboardFlags: terminalState.kittyKeyboardFlags ?? 0,
    inBandResize: false,
  };

  const packed = packDirtyUpdate(update);
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
        viewportOffset: scrollState.viewportOffset,
        isAtBottom: scrollState.isAtBottom,
      },
      payloadLengths: payloads.map((payload) => payload.byteLength),
    },
    payloads,
    options
  );
}

/**
 * Replay cached Kitty transmits for a PTY
 */
function normalizeScrollState(
  emulator: ITerminalEmulator,
  scrollState: TerminalScrollState
): TerminalScrollState {
  const scrollbackLength = emulator.getScrollbackLength();
  const viewportOffset = Math.max(0, Math.min(scrollState.viewportOffset, scrollbackLength));
  return {
    ...scrollState,
    viewportOffset,
    scrollbackLength,
    isAtBottom: viewportOffset === 0,
  };
}

function replayKittyTransmits(
  state: ShimServerState,
  ptyId: string,
  sendKittyTransmit: KittyHandlers['sendKittyTransmit'],
  options?: { allowWhileBootstrapping?: boolean }
): void {
  const cache = state.kittyTransmitCache.get(ptyId);
  if (!cache || cache.size === 0) return;

  // Build map of which guest keys have image data
  const guestKeyHasImageData = new Map<string, boolean>();
  const cachedEmulator = state.ptyEmulators.get(ptyId);
  if (cachedEmulator) {
    const imageIds = cachedEmulator.getKittyImageIds?.() ?? [];
    for (const imageId of imageIds) {
      const info = cachedEmulator.getKittyImageInfo?.(imageId);
      if (!info) continue;
      const hasImageData = Boolean(cachedEmulator.getKittyImageData?.(imageId));

      const idKey = buildGuestKey(info.id, null);
      if (idKey) {
        guestKeyHasImageData.set(idKey, hasImageData);
      }

      if (info.number > 0) {
        const numberKey = buildGuestKey(null, info.number);
        if (numberKey && !guestKeyHasImageData.has(numberKey)) {
          guestKeyHasImageData.set(numberKey, hasImageData);
        }
      }
    }
  }

  // Replay cached transmits
  for (const [guestKey, sequences] of cache.entries()) {
    const hasSharedMemoryChunk = sequences.some((seq) => seq.includes('t=s'));
    const allowSharedMemoryReplay = hasSharedMemoryChunk && !guestKeyHasImageData.get(guestKey);

    for (const seq of sequences) {
      sendKittyTransmit(ptyId, seq, {
        fromReplay: true,
        allowSharedMemoryReplay,
        allowWhileBootstrapping: options?.allowWhileBootstrapping,
      });
    }
  }
}

/**
 * Replay PTY state to a client
 */
export async function replayPtyState(
  state: ShimServerState,
  withPty: WithPty,
  sendEvent: SendEvent,
  kittyHandlers: KittyHandlers,
  ptyId: string,
  options?: { allowWhileBootstrapping?: boolean }
): Promise<void | ShimConnectionError> {
  // Try cached state first
  const cachedEmulator = state.ptyEmulators.get(ptyId);
  const cachedScrollState = state.ptyScrollStates.get(ptyId);

  if (cachedEmulator && cachedScrollState) {
    const normalizedScrollState = normalizeScrollState(cachedEmulator, cachedScrollState);
    state.ptyScrollStates.set(ptyId, normalizedScrollState);
    sendFullSnapshot(
      sendEvent,
      ptyId,
      cachedEmulator.getTerminalState(),
      normalizedScrollState,
      options
    );
    replayKittyTransmits(state, ptyId, kittyHandlers.sendKittyTransmit, options);
    kittyHandlers.sendKittyUpdate(ptyId, cachedEmulator, true, {
      allowWhileBootstrapping: options?.allowWhileBootstrapping,
    });
    return;
  }

  // Fetch from PTY service
  const stateResult = await errore.tryAsync<
    | {
        state: TerminalState;
        scrollState: TerminalScrollState;
      }
    | Error,
    ShimConnectionError
  >({
    try: async () => {
      return await withPty(async (pty) => {
        const terminalState = await pty.getTerminalState(asPtyId(ptyId));
        if (terminalState instanceof Error) {
          return terminalState;
        }
        const scrollState = await pty.getScrollState(asPtyId(ptyId));
        if (scrollState instanceof Error) {
          return scrollState;
        }
        return { state: terminalState, scrollState };
      });
    },
    catch: (e) =>
      new ShimConnectionError({ reason: `Failed to get terminal state: ${e}`, cause: e }),
  });

  if (stateResult instanceof ShimConnectionError) return stateResult;
  if (stateResult instanceof Error) {
    return new ShimConnectionError({
      reason: `Failed to get terminal state: ${stateResult.message}`,
      cause: stateResult,
    });
  }

  state.ptyScrollStates.set(ptyId, stateResult.scrollState);
  sendFullSnapshot(sendEvent, ptyId, stateResult.state, stateResult.scrollState, options);

  const replayEmulator = state.ptyEmulators.get(ptyId);
  if (replayEmulator) {
    kittyHandlers.sendKittyUpdate(ptyId, replayEmulator, true, {
      allowWhileBootstrapping: options?.allowWhileBootstrapping,
    });
  }
}

/**
 * Check if bootstrap replay should be allowed
 */
export function allowBootstrapReplay(
  state: ShimServerState,
  options?: { bootstrap?: boolean; attach?: AttachContext }
): boolean {
  if (!options?.bootstrap || !options.attach) return false;
  const { socket, clientId, sessionId } = options.attach;
  return isActiveClientForSession(state, socket, clientId, sessionId);
}
