/**
 * Shim Replay Handler - Litmus Tests
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { createShimServerState } from '../server-state';
import { allowBootstrapReplay, replayPtyState, sendFullSnapshot } from './replay';
import type net from 'net';
import type { ShimHeader } from '../protocol';

describe('shim handlers/replay (litmus)', () => {
  let state: ReturnType<typeof createShimServerState>;
  let socket: net.Socket;

  beforeEach(() => {
    state = createShimServerState();
    socket = { id: 1 } as unknown as net.Socket;
    state.clientIds.set(socket, 'client-1');
    state.clientSessions.set(socket, 'session-1');
    state.activeClientsBySession.set('session-1', { socket, clientId: 'client-1' });
  });

  describe('allowBootstrapReplay', () => {
    it('should return false when not bootstrapping', () => {
      expect(allowBootstrapReplay(state, {})).toBe(false);
    });

    it('should return false when no attach context', () => {
      expect(allowBootstrapReplay(state, { bootstrap: true })).toBe(false);
    });

    it('should return true for valid bootstrap with matching context', () => {
      expect(
        allowBootstrapReplay(state, {
          bootstrap: true,
          attach: {
            socket,
            clientId: 'client-1',
            sessionId: 'session-1',
          },
        })
      ).toBe(true);
    });

    it('should return false for different socket', () => {
      const otherSocket = { id: 2 } as unknown as net.Socket;
      expect(
        allowBootstrapReplay(state, {
          bootstrap: true,
          attach: {
            socket: otherSocket,
            clientId: 'client-1',
            sessionId: 'session-1',
          },
        })
      ).toBe(false);
    });

    it('should return false for different clientId', () => {
      expect(
        allowBootstrapReplay(state, {
          bootstrap: true,
          attach: {
            socket,
            clientId: 'client-2',
            sessionId: 'session-1',
          },
        })
      ).toBe(false);
    });

    it('should return false for different sessionId', () => {
      expect(
        allowBootstrapReplay(state, {
          bootstrap: true,
          attach: {
            socket,
            clientId: 'client-1',
            sessionId: 'session-2',
          },
        })
      ).toBe(false);
    });

    it('should return false when active client is cleared', () => {
      state.activeClientsBySession.clear();

      expect(
        allowBootstrapReplay(state, {
          bootstrap: true,
          attach: {
            socket: { id: 3 } as unknown as net.Socket,
            clientId: 'client-1',
            sessionId: 'session-1',
          },
        })
      ).toBe(false);
    });
  });

  describe('sendFullSnapshot', () => {
    it('should send a full snapshot', () => {
      const sentHeaders: ShimHeader[] = [];
      const sendEvent = (header: ShimHeader, _payloads?: ArrayBuffer[]) => {
        sentHeaders.push(header);
      };

      const terminalState = {
        cells: [],
        cursor: { x: 0, y: 0, visible: true },
        cols: 80,
        rows: 24,
        alternateScreen: false,
        mouseTracking: false,
        cursorKeyMode: 'normal',
        kittyKeyboardFlags: 0,
      } as any;

      const scrollState = {
        viewportOffset: 0,
        isAtBottom: true,
        scrollbackLength: 0,
      };

      sendFullSnapshot(sendEvent, 'pty-1', terminalState, scrollState);

      expect(sentHeaders).toHaveLength(1);
      expect(sentHeaders[0].type).toBe('ptyUpdate');
      expect(sentHeaders[0].ptyId).toBe('pty-1');
      expect((sentHeaders[0] as any).packed.isFull).toBe(true);
    });
  });

  describe('replayPtyState', () => {
    it('returns a shim connection error when PTY getters fail as values', async () => {
      const result = await replayPtyState(
        state,
        async (fn) =>
          fn({
            getTerminalState: async () => new Error('missing terminal state'),
            getScrollState: async () => ({
              viewportOffset: 0,
              isAtBottom: true,
              scrollbackLength: 0,
            }),
          } as any),
        (() => {}) as any,
        {
          sendKittyTransmit: () => {},
          sendKittyUpdate: () => {},
          queueKittyUpdate: () => {},
          hasCachedTransmit: () => false,
        },
        'pty-1'
      );

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toContain('missing terminal state');
    });

    it('normalizes cached scrollback length against the live emulator snapshot', async () => {
      const sentHeaders: ShimHeader[] = [];
      const sendEvent = (header: ShimHeader, _payloads?: ArrayBuffer[]) => {
        sentHeaders.push(header);
      };

      const emulator = {
        getTerminalState: () => ({
          cells: [],
          cursor: { x: 0, y: 0, visible: true },
          cols: 80,
          rows: 24,
          alternateScreen: false,
          mouseTracking: false,
          cursorKeyMode: 'normal',
          kittyKeyboardFlags: 0,
        }),
        getScrollbackLength: () => 900,
      } as any;

      state.ptyEmulators.set('pty-1', emulator);
      state.ptyScrollStates.set('pty-1', {
        viewportOffset: 0,
        isAtBottom: true,
        scrollbackLength: 872,
      });

      await replayPtyState(
        state,
        async () => {
          throw new Error('withPty should not be called for cached replay');
        },
        sendEvent as any,
        {
          sendKittyTransmit: () => {},
          sendKittyUpdate: () => {},
          queueKittyUpdate: () => {},
          hasCachedTransmit: () => false,
        },
        'pty-1'
      );

      expect(sentHeaders).toHaveLength(1);
      expect((sentHeaders[0] as any).packed.scrollbackLength).toBe(900);
      expect(state.ptyScrollStates.get('pty-1')?.scrollbackLength).toBe(900);
    });
  });
});
