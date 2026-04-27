import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'buffer';
import { describe, expect, it } from 'bun:test';
import type {
  ITerminalEmulator,
  KittyGraphicsImageInfo,
} from '../../src/terminal/emulator-interface';
import {
  KittyGraphicsCompression,
  KittyGraphicsFormat,
} from '../../src/terminal/emulator-interface';
import { createKittyHandlers } from '../../src/shim/server/kitty';
import { createShimServerState } from '../../src/shim/server-state';

const makeImageInfo = (id: number, transmitTime: bigint): KittyGraphicsImageInfo => ({
  id,
  number: 0,
  width: 1,
  height: 1,
  dataLength: 3,
  format: KittyGraphicsFormat.RGB,
  compression: KittyGraphicsCompression.NONE,
  implicitId: false,
  transmitTime,
});

const attachClientForPty = (state: ReturnType<typeof createShimServerState>, ptyId: string) => {
  const socket = {} as any;
  state.ptySessions.set(ptyId, 'session-1');
  state.activeClientsBySession.set('session-1', { socket, clientId: 'client-1' });
};

describe('createKittyHandlers', () => {
  it('forces image data after delete-all invalidation', () => {
    const state = createShimServerState();
    const events: Array<{ header: any; payloads: ArrayBuffer[] }> = [];
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, (header, payloads = []) => {
      events.push({ header, payloads });
    });

    const info = makeImageInfo(1, 1n);
    const emulator: ITerminalEmulator = {
      getKittyImagesDirty: () => true,
      clearKittyImagesDirty: () => {},
      getKittyImageIds: () => [1],
      getKittyImageInfo: () => info,
      getKittyImageData: () => new Uint8Array([1, 2, 3]),
      getKittyPlacements: () => [],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    handlers.sendKittyTransmit('pty-1', '\x1b_Ga=t,f=24,i=1;QUJD\x1b\\');
    handlers.sendKittyUpdate('pty-1', emulator, true);

    events.length = 0;

    handlers.sendKittyTransmit('pty-1', '\x1b_Ga=d,d=a\x1b\\');
    handlers.sendKittyUpdate('pty-1', emulator, false);

    const update = events.find((event) => event.header.type === 'ptyKitty');
    expect(update?.header.kitty.imageDataIds).toEqual([1]);
    expect(update?.payloads.length).toBe(1);
  });

  it('caches transmits even without an attached client', () => {
    const state = createShimServerState();
    const events: Array<{ header: any; payloads: ArrayBuffer[] }> = [];

    const handlers = createKittyHandlers(state, (header, payloads = []) => {
      events.push({ header, payloads });
    });

    const seq = '\x1b_Ga=t,f=100,i=42;QUJD\x1b\\';
    handlers.sendKittyTransmit('pty-1', seq);

    expect(events.length).toBe(0);
    expect(state.kittyTransmitCache.get('pty-1')?.get('i:42')).toEqual([seq]);
  });

  it('stores file-medium transmits in cache as direct payloads for replay', () => {
    const state = createShimServerState();
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, () => {});

    const tempPath = path.join(os.tmpdir(), `openmux-kitty-cache-test-${Date.now()}.bin`);
    fs.writeFileSync(tempPath, Buffer.from([1, 2, 3, 4]));

    try {
      const encodedPath = Buffer.from(tempPath, 'utf8').toString('base64');
      handlers.sendKittyTransmit('pty-1', `\x1b_Ga=t,f=100,t=f,i=9;${encodedPath}\x1b\\`);

      const cache = state.kittyTransmitCache.get('pty-1');
      const cachedSeq = cache?.get('i:9')?.[0] ?? '';

      expect(cachedSeq).toContain('t=d');
      expect(cachedSeq).not.toContain('t=f');
      expect(cachedSeq).toContain('AQIDBA==');
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  });

  it('includes image data on snapshot when cached transmit uses shared memory', () => {
    const state = createShimServerState();
    const events: Array<{ header: any; payloads: ArrayBuffer[] }> = [];
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, (header, payloads = []) => {
      events.push({ header, payloads });
    });

    const info = makeImageInfo(1, 2n);
    const emulator: ITerminalEmulator = {
      getKittyImagesDirty: () => false,
      clearKittyImagesDirty: () => {},
      getKittyImageIds: () => [1],
      getKittyImageInfo: () => info,
      getKittyImageData: () => new Uint8Array([9, 8, 7]),
      getKittyPlacements: () => [],
      isAlternateScreen: () => false,
    } as ITerminalEmulator;

    const sharedMemoryPayload = Buffer.from('SHMKEY', 'utf8').toString('base64');
    handlers.sendKittyTransmit(
      'pty-1',
      `\x1b_Ga=T,t=s,s=10,v=12,S=120,i=1;${sharedMemoryPayload}\x1b\\`,
      {
        fromReplay: true,
      }
    );
    handlers.sendKittyUpdate('pty-1', emulator, true);

    const transmit = events.find((event) => event.header.type === 'ptyKittyTransmit');
    expect(transmit).toBeUndefined();

    const update = events.find((event) => event.header.type === 'ptyKitty');
    expect(update?.header.kitty.imageDataIds).toEqual([1]);
    expect(update?.payloads.length).toBe(1);
  });

  it('still forwards shared-memory transmits during live streaming', () => {
    const state = createShimServerState();
    const events: Array<{ header: any; payloads: ArrayBuffer[] }> = [];
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, (header, payloads = []) => {
      events.push({ header, payloads });
    });

    const sharedMemoryPayload = Buffer.from('SHMKEY', 'utf8').toString('base64');
    handlers.sendKittyTransmit(
      'pty-1',
      `\x1b_Ga=T,t=s,s=10,v=12,S=120,i=1;${sharedMemoryPayload}\x1b\\`
    );

    const transmit = events.find((event) => event.header.type === 'ptyKittyTransmit');
    expect(transmit).toBeDefined();
  });

  it('allows explicit shared-memory replay fallback forwarding', () => {
    const state = createShimServerState();
    const events: Array<{ header: any; payloads: ArrayBuffer[] }> = [];
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, (header, payloads = []) => {
      events.push({ header, payloads });
    });

    const sharedMemoryPayload = Buffer.from('SHMKEY', 'utf8').toString('base64');
    handlers.sendKittyTransmit(
      'pty-1',
      `\x1b_Ga=T,t=s,s=10,v=12,S=120,i=1;${sharedMemoryPayload}\x1b\\`,
      {
        fromReplay: true,
        allowSharedMemoryReplay: true,
      }
    );

    const transmit = events.find((event) => event.header.type === 'ptyKittyTransmit');
    expect(transmit).toBeDefined();
  });

  it('finalizes chunked transmits when continuation chunks omit control params', () => {
    const state = createShimServerState();
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, () => {});

    const first = '\x1b_Ga=t,f=100,i=7,m=1;AAAA\x1b\\';
    const second = '\x1b_G;BBBB\x1b\\';

    handlers.sendKittyTransmit('pty-1', first);
    handlers.sendKittyTransmit('pty-1', second);

    const cache = state.kittyTransmitCache.get('pty-1');
    expect(cache?.get('i:7')).toEqual([first, second]);
    expect(state.kittyTransmitPending.get('pty-1')?.has('i:7') ?? false).toBe(false);
  });

  it('tracks chunk continuations that carry m=1 without repeating ids', () => {
    const state = createShimServerState();
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, () => {});

    const first = '\x1b_Ga=t,f=100,i=8,m=1;AAAA\x1b\\';
    const second = '\x1b_Gm=1;BBBB\x1b\\';
    const third = '\x1b_G;CCCC\x1b\\';

    handlers.sendKittyTransmit('pty-1', first);
    handlers.sendKittyTransmit('pty-1', second);
    handlers.sendKittyTransmit('pty-1', third);

    const cache = state.kittyTransmitCache.get('pty-1');
    expect(cache?.get('i:8')).toEqual([first, second, third]);
    expect(state.kittyTransmitPending.get('pty-1')?.has('i:8') ?? false).toBe(false);
  });

  it('finalizes chunked transmits when relay-only continuation carries i without action', () => {
    const state = createShimServerState();
    attachClientForPty(state, 'pty-1');

    const handlers = createKittyHandlers(state, () => {});

    const first = '\x1b_Ga=t,f=100,i=11,m=1;AAAA\x1b\\';
    const second = '\x1b_Gi=11;BBBB\x1b\\';

    handlers.sendKittyTransmit('pty-1', first);
    handlers.sendKittyTransmit('pty-1', second);

    const cache = state.kittyTransmitCache.get('pty-1');
    expect(cache?.get('i:11')).toEqual([first, second]);
    expect(state.kittyTransmitPending.get('pty-1')?.has('i:11') ?? false).toBe(false);
  });
});
