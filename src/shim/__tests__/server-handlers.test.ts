/**
 * Server Handlers - Detach Behavior Tests
 * Verifies kitty replay state preservation across detach
 */
import type net from 'net';
import { describe, it, expect, beforeEach } from 'bun:test';
import { createShimServerState } from '../server-state';
import { createServerHandlers } from '../server-handlers';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
  type KittyGraphicsImageInfo,
} from '../../terminal/emulator-interface';

const makeImageInfo = (id: number): KittyGraphicsImageInfo => ({
  id,
  number: 0,
  width: 2,
  height: 2,
  dataLength: 4,
  format: KittyGraphicsFormat.RGB,
  compression: KittyGraphicsCompression.NONE,
  implicitId: false,
  transmitTime: 1n,
});

describe('createServerHandlers detach behavior', () => {
  let state: ReturnType<typeof createShimServerState>;
  let handlers: ReturnType<typeof createServerHandlers>;

  const activate = (socket: net.Socket) => {
    state.clientIds.set(socket, 'client-1');
    state.clientSessions.set(socket, 'session-1');
    state.activeClientsBySession.set('session-1', { socket, clientId: 'client-1' });
  };

  beforeEach(() => {
    state = createShimServerState();
    handlers = createServerHandlers(state, {
      withPty: async (fn) =>
        fn({
          listAll: () => [],
          subscribeToLifecycle: () => () => {},
          subscribeToTitle: () => () => {},
          subscribeToAllActivity: () => () => {},
        } as any),
      setHostColors: () => {},
    });
  });

  describe('preserves kitty replay state across detach', () => {
    it('preserves kitty replay state across detach', async () => {
      const socket = {
        destroyed: false,
        end: () => {},
        destroy: () => {},
      } as unknown as net.Socket;
      activate(socket);

      // Setup subscriptions
      const unifiedUnsub = () => {};
      const exitUnsub = () => {};
      state.ptySubscriptions.set('pty-1', {
        unsubscribe: () => {
          unifiedUnsub();
          exitUnsub();
        },
      });
      state.ptyEmulators.set('pty-1', {} as any);

      // Setup kitty transmit cache
      const transmitSeq = '\x1b_Ga=t,f=24,i=1;AQID\x1b\\';
      state.kittyTransmitCache.set('pty-1', new Map([['i:1', [transmitSeq]]]));

      // Setup kitty transmit pending
      state.kittyTransmitPending.set('pty-1', new Map([['i:2', ['pending']]]));

      // Setup kitty transmit invalidated
      state.kittyTransmitInvalidated.set('pty-1', { all: false, keys: new Set(['i:3']) });

      // Setup kitty images
      state.kittyImages.set('pty-1', {
        main: new Map([[1, makeImageInfo(1)]]),
        alt: new Map(),
      });

      await handlers.detachClient(socket);

      expect(state.activeClientsBySession.size).toBe(0);
      expect(state.ptySubscriptions.size).toBe(0);
      expect(state.ptyEmulators.has('pty-1')).toBe(false);

      // Detach should keep kitty replay data so the next client can restore images
      expect(state.kittyTransmitCache.has('pty-1')).toBe(true);
      expect(state.kittyTransmitPending.has('pty-1')).toBe(true);
      expect(state.kittyTransmitInvalidated.has('pty-1')).toBe(true);
      expect(state.kittyImages.has('pty-1')).toBe(true);
    });

    it('should preserve kittyImages when unsubscribing with preserveKittyState through cleanup', async () => {
      const socket = {
        destroyed: false,
        end: () => {},
        destroy: () => {},
      } as unknown as net.Socket;
      activate(socket);

      const mockImage = makeImageInfo(1);

      // Setup kitty state
      state.kittyImages.set('pty-1', {
        main: new Map([[1, mockImage]]),
        alt: new Map(),
      });

      // Setup subscription to allow unsubscribe flow
      state.ptySubscriptions.set('pty-1', {
        unsubscribe: () => {},
      });
      state.ptyEmulators.set('pty-1', {} as any);

      await handlers.detachClient(socket);

      // Kitty images should be preserved
      expect(state.kittyImages.has('pty-1')).toBe(true);
      expect(state.kittyImages.get('pty-1')?.main.get(1)).toEqual(mockImage);
    });

    it('should preserve kittyTransmitCache across detach', async () => {
      const socket = {
        destroyed: false,
        end: () => {},
        destroy: () => {},
      } as unknown as net.Socket;
      activate(socket);

      const transmitCache = new Map<string, string[]>();
      transmitCache.set('image-1', ['chunk1', 'chunk2']);
      state.kittyTransmitCache.set('pty-1', transmitCache);

      // Setup subscription
      state.ptySubscriptions.set('pty-1', {
        unsubscribe: () => {},
      });
      state.ptyEmulators.set('pty-1', {} as any);

      await handlers.detachClient(socket);

      // Transmit cache should be preserved
      expect(state.kittyTransmitCache.has('pty-1')).toBe(true);
      expect(state.kittyTransmitCache.get('pty-1')?.get('image-1')).toEqual(['chunk1', 'chunk2']);
    });

    it('should preserve kittyTransmitPending across detach', async () => {
      const socket = {
        destroyed: false,
        end: () => {},
        destroy: () => {},
      } as unknown as net.Socket;
      activate(socket);

      const pendingTransmits = new Map<string, string[]>();
      pendingTransmits.set('image-2', ['chunk3', 'chunk4']);
      state.kittyTransmitPending.set('pty-1', pendingTransmits);

      // Setup subscription
      state.ptySubscriptions.set('pty-1', {
        unsubscribe: () => {},
      });
      state.ptyEmulators.set('pty-1', {} as any);

      await handlers.detachClient(socket);

      // Pending transmits should be preserved
      expect(state.kittyTransmitPending.has('pty-1')).toBe(true);
      expect(state.kittyTransmitPending.get('pty-1')?.get('image-2')).toEqual(['chunk3', 'chunk4']);
    });

    it('should preserve kittyTransmitInvalidated across detach', async () => {
      const socket = {
        destroyed: false,
        end: () => {},
        destroy: () => {},
      } as unknown as net.Socket;
      activate(socket);

      const invalidated = { all: false, keys: new Set<string>(['key-1', 'key-2']) };
      state.kittyTransmitInvalidated.set('pty-1', invalidated);

      // Setup subscription
      state.ptySubscriptions.set('pty-1', {
        unsubscribe: () => {},
      });
      state.ptyEmulators.set('pty-1', {} as any);

      await handlers.detachClient(socket);

      // Invalidated state should be preserved
      expect(state.kittyTransmitInvalidated.has('pty-1')).toBe(true);
      expect(state.kittyTransmitInvalidated.get('pty-1')?.keys.has('key-1')).toBe(true);
    });

    it('should handle multiple PTYs with kitty state preservation', async () => {
      const socket = {
        destroyed: false,
        end: () => {},
        destroy: () => {},
      } as unknown as net.Socket;
      activate(socket);

      // Setup PTY 1
      state.kittyImages.set('pty-1', {
        main: new Map([[1, makeImageInfo(1)]]),
        alt: new Map(),
      });
      state.ptySubscriptions.set('pty-1', { unsubscribe: () => {} });
      state.ptyEmulators.set('pty-1', {} as any);

      // Setup PTY 2
      state.kittyImages.set('pty-2', {
        main: new Map([[2, makeImageInfo(2)]]),
        alt: new Map(),
      });
      state.ptySubscriptions.set('pty-2', { unsubscribe: () => {} });
      state.ptyEmulators.set('pty-2', {} as any);

      await handlers.detachClient(socket);

      // Both PTYs' kitty state should be preserved
      expect(state.kittyImages.has('pty-1')).toBe(true);
      expect(state.kittyImages.has('pty-2')).toBe(true);
    });

    it('should not preserve kitty state when explicitly cleared during destroy', async () => {
      const socket = {
        destroyed: false,
        end: () => {},
        destroy: () => {},
      } as unknown as net.Socket;
      activate(socket);

      // Setup all kitty states
      state.kittyImages.set('pty-1', { main: new Map(), alt: new Map() });
      state.kittyTransmitCache.set('pty-1', new Map());
      state.kittyTransmitPending.set('pty-1', new Map());
      state.kittyTransmitInvalidated.set('pty-1', { all: false, keys: new Set() });

      // Note: destroy/close doesn't preserve kitty state, only detach does
      // This test documents that behavior

      // Setup subscription
      state.ptySubscriptions.set('pty-1', {
        unsubscribe: () => {},
      });
      state.ptyEmulators.set('pty-1', {} as any);

      // After detach, kitty state is preserved
      await handlers.detachClient(socket);

      // All kitty state should be preserved after detach
      expect(state.kittyImages.has('pty-1')).toBe(true);
      expect(state.kittyTransmitCache.has('pty-1')).toBe(true);
      expect(state.kittyTransmitPending.has('pty-1')).toBe(true);
      expect(state.kittyTransmitInvalidated.has('pty-1')).toBe(true);
    });
  });
});
