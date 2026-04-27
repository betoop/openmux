/**
 * Shim Event Handling
 * Event sending utilities and bootstrapping suppression logic
 */
import type { ShimHeader } from '../protocol';
import {
  getActiveClientForSession,
  getSessionIdForPty,
  isActiveClientForSession,
  type ShimServerState,
} from '../server-state';
import { sendFrame } from '../server/frames';
import type { SendEvent } from './types';
import type net from 'net';

function isSocketWritable(socket: net.Socket): boolean {
  return !(socket as { destroyed?: boolean }).destroyed;
}

function getEventTargets(state: ShimServerState, header: ShimHeader): net.Socket[] {
  const ptyId = typeof header.ptyId === 'string' ? header.ptyId : null;
  if (ptyId) {
    const sessionId = getSessionIdForPty(state, ptyId);
    if (!sessionId) return [];
    const active = getActiveClientForSession(state, sessionId);
    return active && isSocketWritable(active.socket) ? [active.socket] : [];
  }

  const sockets: net.Socket[] = [];
  const seen = new Set<net.Socket>();
  for (const active of state.activeClientsBySession.values()) {
    if (seen.has(active.socket) || !isSocketWritable(active.socket)) continue;
    seen.add(active.socket);
    sockets.push(active.socket);
  }
  return sockets;
}

/**
 * Check if an event should be suppressed during bootstrapping
 */
export function shouldSuppressBootstrappingEvent(
  state: ShimServerState,
  header: ShimHeader,
  options?: { allowWhileBootstrapping?: boolean }
): boolean {
  const ptyId = typeof header.ptyId === 'string' ? header.ptyId : null;
  if (!ptyId || !state.bootstrappingPtyIds.has(ptyId)) return false;
  if (options?.allowWhileBootstrapping) return false;
  return (
    header.type === 'ptyUpdate' || header.type === 'ptyKitty' || header.type === 'ptyKittyTransmit'
  );
}

/**
 * Check if a socket/context is still the current active attach
 */
export function isCurrentAttach(
  state: ShimServerState,
  socket: net.Socket,
  clientId: string,
  sessionId: string
): boolean {
  return isActiveClientForSession(state, socket, clientId, sessionId);
}

/**
 * Create event sender function bound to server state
 */
export function createEventSender(state: ShimServerState): SendEvent {
  return (
    header: ShimHeader,
    payloads: ArrayBuffer[] = [],
    options?: { allowWhileBootstrapping?: boolean }
  ) => {
    if (shouldSuppressBootstrappingEvent(state, header, options)) return;
    for (const socket of getEventTargets(state, header)) {
      sendFrame(socket, header, payloads);
    }
  };
}

/**
 * Send a detached notification to a client
 */
export function sendDetached(socket: net.Socket): void {
  sendFrame(socket, { type: 'detached' });
}
