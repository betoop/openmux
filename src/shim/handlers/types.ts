/**
 * Shim Handlers - Shared Types
 */
import type net from 'net';
import type { PtyService } from '../../effect/services/Pty';
import type { TerminalColors } from '../../terminal/terminal-colors';
import type { ShimServerState } from '../server-state';
import type { ShimHeader } from '../protocol';
import type { KittyHandlers } from '../server/kitty';

/** PTY accessor function type */
export type WithPty = <A>(
  fn: (pty: PtyService) => Promise<A | Error> | A | Error
) => Promise<A | Error>;

/** Server handler options */
export type ShimServerOptions = {
  socketPath?: string;
  withPty?: WithPty;
  setHostColors?: (colors: TerminalColors) => void;
};

/** Event sender function type */
export type SendEvent = (
  header: ShimHeader,
  payloads?: ArrayBuffer[],
  options?: { allowWhileBootstrapping?: boolean }
) => void;

/** Response sender function type */
export type SendResponse = (
  socket: net.Socket,
  requestId: number,
  result?: unknown,
  payloads?: ArrayBuffer[]
) => void;

/** Error sender function type */
export type SendError = (socket: net.Socket, requestId: number, error: string) => void;

/** Shared shim handler context */
export interface ShimHandlerContext {
  state: ShimServerState;
  withPty: WithPty;
  sendEvent: SendEvent;
  sendResponse: SendResponse;
  sendError: SendError;
  kittyHandlers: KittyHandlers;
  applyHostColors: (colors: TerminalColors) => Promise<void> | void;
}

/** Attach context for bootstrap operations */
export interface AttachContext {
  socket: net.Socket;
  clientId: string;
  sessionId: string;
}

/** Bootstrap options for subscription operations */
export interface BootstrapOptions {
  bootstrap?: boolean;
  attach?: AttachContext;
}
