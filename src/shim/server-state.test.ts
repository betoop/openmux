import { describe, expect, it } from 'bun:test';

import {
  createShimServerState,
  rememberRevokedClientId,
  resetShimServerState,
} from './server-state';

describe('shim/server-state', () => {
  it('tracks revoked client IDs in insertion order', () => {
    const state = createShimServerState();

    rememberRevokedClientId(state, 'client-1');
    rememberRevokedClientId(state, 'client-2');

    expect([...state.revokedClientIds]).toEqual(['client-1', 'client-2']);
    expect(state.revokedClientOrder).toEqual(['client-1', 'client-2']);
  });

  it('purges oldest revoked client IDs once the cap is exceeded', () => {
    const state = createShimServerState();

    for (let i = 0; i < 40; i += 1) {
      rememberRevokedClientId(state, `client-${i}`);
    }

    expect(state.revokedClientIds.has('client-0')).toBe(false);
    expect(state.revokedClientIds.has('client-7')).toBe(false);
    expect(state.revokedClientIds.has('client-8')).toBe(true);
    expect(state.revokedClientIds.has('client-39')).toBe(true);
    expect(state.revokedClientOrder).toHaveLength(32);
  });

  it('reset clears revoked client tracking and active client state', () => {
    const state = createShimServerState();
    const socket = { id: 1 } as any;
    rememberRevokedClientId(state, 'client-1');
    state.clientIds.set(socket, 'client-2');
    state.clientSessions.set(socket, 'session-1');
    state.activeClientsBySession.set('session-1', { socket, clientId: 'client-2' });

    resetShimServerState(state);

    expect(state.revokedClientIds.size).toBe(0);
    expect(state.revokedClientOrder).toEqual([]);
    expect(state.clientIds.size).toBe(0);
    expect(state.clientSessions.size).toBe(0);
    expect(state.activeClientsBySession.size).toBe(0);
  });
});
