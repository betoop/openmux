/**
 * Shim Events Handler - Litmus Tests
 */
import { describe, it, expect, beforeEach, vi } from 'bun:test';
import type net from 'net';
import { createShimServerState } from '../server-state';
import { shouldSuppressBootstrappingEvent, isCurrentAttach, createEventSender } from './events';
import type { ShimHeader } from '../protocol';

describe('shim handlers/events (litmus)', () => {
  let state: ReturnType<typeof createShimServerState>;

  beforeEach(() => {
    state = createShimServerState();
  });

  const setActive = (sessionId: string, socket: net.Socket, clientId: string) => {
    state.clientIds.set(socket, clientId);
    state.clientSessions.set(socket, sessionId);
    state.activeClientsBySession.set(sessionId, { socket, clientId });
  };

  describe('shouldSuppressBootstrappingEvent', () => {
    it('should not suppress when no bootstrapping PTY', () => {
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(false);
    });

    it('should suppress ptyUpdate during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(true);
    });

    it('should suppress ptyKitty during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyKitty', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(true);
    });

    it('should suppress ptyKittyTransmit during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyKittyTransmit', ptyId: 'pty-1' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(true);
    });

    it('should not suppress when allowWhileBootstrapping is true', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };
      expect(
        shouldSuppressBootstrappingEvent(state, header, { allowWhileBootstrapping: true })
      ).toBe(false);
    });

    it('should not suppress other event types during bootstrapping', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyExit', ptyId: 'pty-1', exitCode: 0 };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(false);
    });

    it('should not suppress when ptyId is missing', () => {
      state.bootstrappingPtyIds.add('pty-1');
      const header: ShimHeader = { type: 'ptyUpdate' };
      expect(shouldSuppressBootstrappingEvent(state, header)).toBe(false);
    });
  });

  describe('isCurrentAttach', () => {
    it('should return true for matching socket and clientId', () => {
      const mockSocket = { id: 1 } as unknown as net.Socket;
      setActive('session-1', mockSocket, 'client-1');

      expect(isCurrentAttach(state, mockSocket, 'client-1', 'session-1')).toBe(true);
    });

    it('should return false for different socket', () => {
      const mockSocket1 = { id: 1 } as unknown as net.Socket;
      const mockSocket2 = { id: 2 } as unknown as net.Socket;
      setActive('session-1', mockSocket1, 'client-1');

      expect(isCurrentAttach(state, mockSocket2, 'client-1', 'session-1')).toBe(false);
    });

    it('should return false for different clientId', () => {
      const mockSocket = { id: 1 } as unknown as net.Socket;
      setActive('session-1', mockSocket, 'client-1');

      expect(isCurrentAttach(state, mockSocket, 'client-2', 'session-1')).toBe(false);
    });

    it('should return false for different sessionId', () => {
      const mockSocket = { id: 1 } as unknown as net.Socket;
      setActive('session-1', mockSocket, 'client-1');

      expect(isCurrentAttach(state, mockSocket, 'client-1', 'session-2')).toBe(false);
    });

    it('should return false when there is no active client match', () => {
      const mockSocket = { id: 1 } as unknown as net.Socket;

      expect(isCurrentAttach(state, mockSocket, 'client-1', 'session-1')).toBe(false);
    });
  });

  describe('createEventSender', () => {
    it('should return a function', () => {
      const sender = createEventSender(state);
      expect(sender).toBeTypeOf('function');
    });

    it('should not send when no active client', () => {
      const sender = createEventSender(state);
      const header: ShimHeader = { type: 'ptyUpdate', ptyId: 'pty-1' };

      // Should not throw
      sender(header, []);
    });

    it('routes PTY events to the active client for that PTY session only', () => {
      const writeA = vi.fn();
      const writeB = vi.fn();
      const socketA = { write: writeA, destroyed: false } as unknown as net.Socket;
      const socketB = { write: writeB, destroyed: false } as unknown as net.Socket;
      setActive('session-a', socketA, 'client-a');
      setActive('session-b', socketB, 'client-b');
      state.ptySessions.set('pty-a', 'session-a');
      state.ptySessions.set('pty-b', 'session-b');

      const sender = createEventSender(state);
      sender({ type: 'ptyUpdate', ptyId: 'pty-a' }, []);

      expect(writeA).toHaveBeenCalledTimes(1);
      expect(writeB).not.toHaveBeenCalled();
    });
  });
});
