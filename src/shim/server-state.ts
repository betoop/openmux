import type net from 'net';
import type { TerminalScrollState } from '../core/types';
import type {
  IKittyGraphicsEmulator,
  ITerminalEmulator,
  KittyGraphicsImageInfo,
} from '../terminal/emulator-interface';

/** Screen identifier for Kitty graphics (main or alternate screen) */
export type KittyScreenKey = 'main' | 'alt';

/** Kitty graphics images per screen */
export type KittyScreenImages = {
  main: Map<number, KittyGraphicsImageInfo>;
  alt: Map<number, KittyGraphicsImageInfo>;
};

/** Handle for unsubscribing from PTY updates */
export type PtySubscriptionHandle = {
  /** Unsubscribe function to stop receiving updates */
  unsubscribe: () => void;
};

type PtySubscriptions = Map<string, PtySubscriptionHandle>;

type ShimPtyEmulator = ITerminalEmulator & Partial<IKittyGraphicsEmulator>;

export type ActiveShimClient = {
  socket: net.Socket;
  clientId: string;
};

const MAX_REVOKED_CLIENT_IDS = 32;

/**
 * Central state container for the shim server.
 *
 * Session-scoped client lock semantics:
 * - `activeClientsBySession` identifies the one socket allowed to issue
 *   non-hello requests and receive live events for a session.
 * - A new hello for the same session steals that session's lock, detaches the
 *   previous socket, and becomes the event sink for bootstrap replay + updates.
 * - Different sessions may be owned by different sockets at the same time.
 * - Async bootstrap work re-checks the active socket/client/session triple before
 *   sending replay frames, so socket identity is the concurrency guard.
 *
 * Revoked client policy:
 * - Detached client IDs are added to `revokedClientIds` so an old UI process
 *   cannot immediately reconnect after losing the lock.
 * - The set is bounded by `MAX_REVOKED_CLIENT_IDS`; oldest IDs are purged in
 *   FIFO order to avoid unbounded growth.
 */
export type ShimServerState = {
  sessionPanes: Map<string, Map<string, string>>;
  ptyToPane: Map<string, { sessionId: string; paneId: string }>;
  ptySessions: Map<string, string>;
  clientIds: Map<net.Socket, string>;
  clientSessions: Map<net.Socket, string>;
  activeClientsBySession: Map<string, ActiveShimClient>;
  revokedClientIds: Set<string>;
  revokedClientOrder: string[];
  ptySubscriptions: PtySubscriptions;
  ptyEmulators: Map<string, ShimPtyEmulator>;
  ptyScrollStates: Map<string, TerminalScrollState>;
  kittyImages: Map<string, KittyScreenImages>;
  kittyTransmitCache: Map<string, Map<string, string[]>>;
  kittyTransmitPending: Map<string, Map<string, string[]>>;
  kittyTransmitInvalidated: Map<string, { all: boolean; keys: Set<string> }>;
  lifecycleUnsub: (() => void) | null;
  titleUnsub: (() => void) | null;
  activityUnsub: (() => void) | null;
  bootstrappingPtyIds: Set<string>;
  hostColorsSet: boolean;
};

/**
 * Creates a fresh shim server state instance.
 * @returns New initialized ShimServerState
 */
export function createShimServerState(): ShimServerState {
  return {
    sessionPanes: new Map(),
    ptyToPane: new Map(),
    ptySessions: new Map(),
    clientIds: new Map(),
    clientSessions: new Map(),
    activeClientsBySession: new Map(),
    revokedClientIds: new Set(),
    revokedClientOrder: [],
    ptySubscriptions: new Map(),
    ptyEmulators: new Map(),
    ptyScrollStates: new Map(),
    kittyImages: new Map(),
    kittyTransmitCache: new Map(),
    kittyTransmitPending: new Map(),
    kittyTransmitInvalidated: new Map(),
    lifecycleUnsub: null,
    titleUnsub: null,
    activityUnsub: null,
    bootstrappingPtyIds: new Set(),
    hostColorsSet: false,
  };
}

export function getClientSessionId(state: ShimServerState, socket: net.Socket): string | null {
  return state.clientSessions.get(socket) ?? null;
}

export function getActiveClientForSession(
  state: ShimServerState,
  sessionId: string
): ActiveShimClient | null {
  return state.activeClientsBySession.get(sessionId) ?? null;
}

export function isActiveClientForSession(
  state: ShimServerState,
  socket: net.Socket,
  clientId: string,
  sessionId: string
): boolean {
  const active = getActiveClientForSession(state, sessionId);
  return active?.socket === socket && active.clientId === clientId;
}

export function isActiveSocket(state: ShimServerState, socket: net.Socket): boolean {
  const sessionId = getClientSessionId(state, socket);
  if (!sessionId) return false;
  const clientId = state.clientIds.get(socket);
  if (!clientId) return false;
  return isActiveClientForSession(state, socket, clientId, sessionId);
}

export function getSessionIdForPty(state: ShimServerState, ptyId: string): string | null {
  return state.ptySessions.get(ptyId) ?? state.ptyToPane.get(ptyId)?.sessionId ?? null;
}

export function hasActiveClientForPty(state: ShimServerState, ptyId: string): boolean {
  const sessionId = getSessionIdForPty(state, ptyId);
  return Boolean(sessionId && getActiveClientForSession(state, sessionId));
}

/**
 * Adds a client ID to the revoked set, maintaining bounded size.
 * Removes oldest entries when limit exceeded.
 * @param state - Server state to modify
 * @param clientId - Client ID to revoke
 */
export function rememberRevokedClientId(state: ShimServerState, clientId: string): void {
  if (state.revokedClientIds.has(clientId)) {
    return;
  }

  state.revokedClientIds.add(clientId);
  state.revokedClientOrder.push(clientId);

  while (state.revokedClientOrder.length > MAX_REVOKED_CLIENT_IDS) {
    const evicted = state.revokedClientOrder.shift();
    if (!evicted) {
      break;
    }
    state.revokedClientIds.delete(evicted);
  }
}

/**
 * Resets all shim server state to initial empty values.
 * Clears all mappings, subscriptions, and client tracking.
 * @param state - Server state to reset
 */
export function resetShimServerState(state: ShimServerState): void {
  state.sessionPanes.clear();
  state.ptyToPane.clear();
  state.ptySessions.clear();
  state.clientIds.clear();
  state.clientSessions.clear();
  state.activeClientsBySession.clear();
  state.revokedClientIds.clear();
  state.revokedClientOrder.length = 0;
  state.ptySubscriptions.clear();
  state.ptyEmulators.clear();
  state.ptyScrollStates.clear();
  state.kittyImages.clear();
  state.kittyTransmitCache.clear();
  state.kittyTransmitPending.clear();
  state.kittyTransmitInvalidated.clear();
  state.lifecycleUnsub = null;
  state.titleUnsub = null;
  state.activityUnsub = null;
  state.bootstrappingPtyIds.clear();
  state.hostColorsSet = false;
}
