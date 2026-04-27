import { afterEach, describe, expect, it, vi } from 'bun:test';

import { createRequestHandler } from './server-requests';
import { createShimServerState } from './server-state';
import type { ShimHandlerContext } from './handlers';

function createSocket(id: number) {
  const socket = {
    id,
    destroyed: false,
    end: vi.fn(() => {
      socket.destroyed = true;
    }),
    destroy: vi.fn(() => {
      socket.destroyed = true;
    }),
    write: vi.fn(),
  } as any;
  return socket;
}

function activateClient(
  state: ReturnType<typeof createShimServerState>,
  socket: any,
  clientId: string,
  sessionId: string
): void {
  state.clientIds.set(socket, clientId);
  state.clientSessions.set(socket, sessionId);
  state.activeClientsBySession.set(sessionId, { socket, clientId });
}

function createContext(overrides?: {
  pty?: Record<string, (...args: any[]) => any>;
  active?: boolean;
  socket?: any;
}) {
  const state = createShimServerState();
  const socket = overrides?.socket ?? createSocket(1);
  if (overrides?.active !== false) {
    activateClient(state, socket, 'client-1', 'session-1');
  }

  const responses: Array<{ requestId: number; result: unknown }> = [];
  const errors: Array<{ requestId: number; error: string }> = [];

  const pty = {
    getSession: () => ({
      id: 'pty-1',
      pid: 42,
      cols: 80,
      rows: 24,
      cwd: '/session-cwd',
      shell: '/bin/zsh',
      title: 'editor',
      lastCommand: 'git status',
    }),
    create: () => 'pty-new',
    destroy: () => {},
    destroyAll: () => {},
    getCwd: () => '/live-cwd',
    getForegroundProcess: () => 'vim',
    listAll: () => ['pty-1'],
    subscribeToLifecycle: () => () => {},
    subscribeToTitle: () => () => {},
    subscribeToAllActivity: () => () => {},
    getGitInfo: (_ptyId: string, options?: { includeDiffStats?: boolean }) => ({
      branch: 'main',
      repoKey: '/repo',
      dirty: true,
      staged: 1,
      unstaged: 2,
      untracked: 0,
      conflicted: 0,
      ahead: undefined,
      behind: undefined,
      stashCount: undefined,
      state: undefined,
      detached: false,
      ...(options?.includeDiffStats ? { diffStats: { added: 2, removed: 1, binary: 0 } } : {}),
    }),
    ...overrides?.pty,
  };

  const context: ShimHandlerContext = {
    state,
    withPty: async (fn) => fn(pty),
    sendEvent: () => {},
    sendResponse: (_socket, requestId, result) => {
      responses.push({ requestId, result });
    },
    sendError: (_socket, requestId, error) => {
      errors.push({ requestId, error });
    },
    kittyHandlers: {
      sendKittyTransmit: () => {},
      sendKittyUpdate: () => {},
      queueKittyUpdate: () => {},
      hasCachedTransmit: () => false,
    },
    applyHostColors: () => {},
  };

  return {
    socket,
    responses,
    errors,
    state,
    handleRequest: createRequestHandler(context),
  };
}

describe('shim/server-requests', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('allows different sessions to keep independent active clients', async () => {
    const fixture = createContext({ active: false });
    const socketA = createSocket(1);
    const socketB = createSocket(2);

    await fixture.handleRequest(
      socketA,
      {
        type: 'request',
        requestId: 1,
        method: 'hello',
        params: { clientId: 'client-a', sessionId: 'session-a' },
      },
      []
    );
    await fixture.handleRequest(
      socketB,
      {
        type: 'request',
        requestId: 2,
        method: 'hello',
        params: { clientId: 'client-b', sessionId: 'session-b' },
      },
      []
    );

    expect(fixture.state.activeClientsBySession.get('session-a')?.socket).toBe(socketA);
    expect(fixture.state.activeClientsBySession.get('session-b')?.socket).toBe(socketB);
    expect(socketA.end).not.toHaveBeenCalled();
    expect(socketB.end).not.toHaveBeenCalled();
  });

  it('detaches only the previous active client for the same session', async () => {
    const fixture = createContext({ active: false });
    const socketA = createSocket(1);
    const socketB = createSocket(2);

    await fixture.handleRequest(
      socketA,
      {
        type: 'request',
        requestId: 1,
        method: 'hello',
        params: { clientId: 'client-a', sessionId: 'session-a' },
      },
      []
    );
    await fixture.handleRequest(
      socketB,
      {
        type: 'request',
        requestId: 2,
        method: 'hello',
        params: { clientId: 'client-b', sessionId: 'session-a' },
      },
      []
    );

    expect(fixture.state.activeClientsBySession.get('session-a')?.socket).toBe(socketB);
    expect(socketA.end).toHaveBeenCalledTimes(1);
    expect(socketB.end).not.toHaveBeenCalled();
    expect(fixture.state.revokedClientIds.has('client-a')).toBe(true);
  });

  it('rejects non-hello requests from a superseded client in the same session', async () => {
    const fixture = createContext({ active: false });
    const socketA = createSocket(1);
    const socketB = createSocket(2);

    await fixture.handleRequest(
      socketA,
      {
        type: 'request',
        requestId: 1,
        method: 'hello',
        params: { clientId: 'client-a', sessionId: 'session-a' },
      },
      []
    );
    await fixture.handleRequest(
      socketB,
      {
        type: 'request',
        requestId: 2,
        method: 'hello',
        params: { clientId: 'client-b', sessionId: 'session-a' },
      },
      []
    );
    await fixture.handleRequest(
      socketA,
      {
        type: 'request',
        requestId: 3,
        method: 'listAll',
        params: {},
      },
      []
    );

    expect(fixture.errors).toContainEqual({ requestId: 3, error: 'Inactive client' });
    expect(socketA.end).toHaveBeenCalledTimes(2);
  });

  it('filters listAll results to the requesting client session', async () => {
    const fixture = createContext({
      pty: {
        listAll: () => ['pty-a', 'pty-b'],
      },
    });
    fixture.state.ptySessions.set('pty-a', 'session-1');
    fixture.state.ptySessions.set('pty-b', 'session-2');

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 1,
        method: 'listAll',
        params: {},
      },
      []
    );

    expect(fixture.responses[0]?.result).toEqual({ ptyIds: ['pty-a'] });
  });

  it('returns consolidated PTY metadata', async () => {
    const fixture = createContext();

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 1,
        method: 'getPtyMetadata',
        params: { ptyId: 'pty-1' },
      },
      []
    );

    expect(fixture.errors).toEqual([]);
    expect(fixture.responses[0]?.result).toEqual({
      metadata: {
        session: {
          id: 'pty-1',
          pid: 42,
          cols: 80,
          rows: 24,
          cwd: '/session-cwd',
          shell: '/bin/zsh',
        },
        cwd: '/live-cwd',
        foregroundProcess: 'vim',
        gitInfo: {
          branch: 'main',
          repoKey: '/repo',
          dirty: true,
          staged: 1,
          unstaged: 2,
          untracked: 0,
          conflicted: 0,
          ahead: undefined,
          behind: undefined,
          stashCount: undefined,
          state: undefined,
          detached: false,
        },
        gitDiffStats: { added: 2, removed: 1, binary: 0 },
        title: 'editor',
        lastCommand: 'git status',
      },
    });
  });

  it('uses the consolidated current PtyService metadata surface', async () => {
    const calls: Array<{ includeDiffStats?: boolean }> = [];
    const fixture = createContext({
      pty: {
        getGitInfo: (_ptyId: string, options?: { includeDiffStats?: boolean }) => {
          calls.push({ includeDiffStats: options?.includeDiffStats });
          return {
            branch: 'main',
            repoKey: '/repo',
            dirty: false,
            staged: 0,
            unstaged: 0,
            untracked: 0,
            conflicted: 0,
            ahead: undefined,
            behind: undefined,
            stashCount: undefined,
            state: undefined,
            detached: false,
            diffStats: { added: 2, removed: 1, binary: 0 },
          };
        },
      },
    });

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 2,
        method: 'getPtyMetadata',
        params: { ptyId: 'pty-1' },
      },
      []
    );

    expect(calls).toEqual([{ includeDiffStats: true }]);
  });

  it('keeps legacy getters working via metadata fallbacks', async () => {
    const fixture = createContext({
      pty: {
        getCwd: () => new Error('cwd unavailable'),
        getGitInfo: () => ({
          branch: 'feature/refactor',
          repoKey: '/repo',
          dirty: false,
          staged: 0,
          unstaged: 0,
          untracked: 0,
          conflicted: 0,
          ahead: undefined,
          behind: undefined,
          stashCount: undefined,
          state: undefined,
          detached: false,
        }),
      },
    });

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 1,
        method: 'getCwd',
        params: { ptyId: 'pty-1' },
      },
      []
    );
    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 2,
        method: 'getGitBranch',
        params: { ptyId: 'pty-1' },
      },
      []
    );

    expect(fixture.errors).toEqual([]);
    expect(fixture.responses[0]?.result).toEqual({ cwd: '/session-cwd' });
    expect(fixture.responses[1]?.result).toEqual({ branch: 'feature/refactor' });
  });

  it('serves getCwd without triggering expensive git or process lookups', async () => {
    const calls: string[] = [];
    const fixture = createContext({
      pty: {
        getSession: () => {
          calls.push('getSession');
          return {
            id: 'pty-1',
            pid: 42,
            cols: 80,
            rows: 24,
            cwd: '/session-cwd',
            shell: '/bin/zsh',
            title: 'editor',
            lastCommand: 'git status',
          };
        },
        getCwd: () => {
          calls.push('getCwd');
          return '/live-cwd';
        },
        getForegroundProcess: () => {
          calls.push('getForegroundProcess');
          return 'vim';
        },
        getGitInfo: () => {
          calls.push('getGitInfo');
          return undefined;
        },
      },
    });

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 3,
        method: 'getCwd',
        params: { ptyId: 'pty-1' },
      },
      []
    );

    expect(fixture.responses[0]?.result).toEqual({ cwd: '/live-cwd' });
    expect(calls).toContain('getCwd');
    expect(calls).not.toContain('getSession');
    expect(calls).not.toContain('getForegroundProcess');
    expect(calls).not.toContain('getGitInfo');
  });

  it('serves batched cwd lookups with per-pty session fallback only when needed', async () => {
    const calls: string[] = [];
    const fixture = createContext({
      pty: {
        getCwd: (ptyId: string) => {
          calls.push(`getCwd:${ptyId}`);
          if (ptyId === 'pty-2') {
            return new Error('cwd unavailable');
          }
          return `/live/${ptyId}`;
        },
        getSession: (ptyId: string) => {
          calls.push(`getSession:${ptyId}`);
          return {
            id: ptyId,
            pid: 42,
            cols: 80,
            rows: 24,
            cwd: `/session/${ptyId}`,
            shell: '/bin/zsh',
          };
        },
        getForegroundProcess: (ptyId: string) => {
          calls.push(`getForegroundProcess:${ptyId}`);
          return 'vim';
        },
        getGitInfo: (ptyId: string) => {
          calls.push(`getGitInfo:${ptyId}`);
          return undefined;
        },
      },
    });

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 4,
        method: 'getPtyCwds',
        params: { ptyIds: ['pty-1', 'pty-2'] },
      },
      []
    );

    expect(fixture.responses[0]?.result).toEqual({
      entries: [
        { ptyId: 'pty-1', cwd: '/live/pty-1' },
        { ptyId: 'pty-2', cwd: '/session/pty-2' },
      ],
    });
    expect(calls).toContain('getCwd:pty-1');
    expect(calls).toContain('getCwd:pty-2');
    expect(calls).not.toContain('getSession:pty-1');
    expect(calls).toContain('getSession:pty-2');
    expect(calls).not.toContain('getForegroundProcess:pty-1');
    expect(calls).not.toContain('getForegroundProcess:pty-2');
    expect(calls).not.toContain('getGitInfo:pty-1');
    expect(calls).not.toContain('getGitInfo:pty-2');
  });

  it('acknowledges shutdown before tearing PTYs down in the background', async () => {
    vi.useFakeTimers();

    let resolveDestroy!: () => void;
    const steps: string[] = [];
    const destroyPromise = new Promise<void>((resolve) => {
      resolveDestroy = () => {
        steps.push('destroy-resolved');
        resolve();
      };
    });

    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as typeof process.exit);

    const fixture = createContext({
      pty: {
        destroyAll: () => {
          steps.push('destroy-started');
          return destroyPromise;
        },
      },
    });

    await fixture.handleRequest(
      fixture.socket,
      {
        type: 'request',
        requestId: 4,
        method: 'shutdown',
        params: {},
      },
      []
    );

    expect(fixture.responses[0]?.result).toBeUndefined();
    expect(steps).toEqual([]);

    await vi.advanceTimersByTimeAsync(10);
    expect(steps).toEqual(['destroy-started']);

    resolveDestroy();
    await destroyPromise;
    await vi.runAllTimersAsync();

    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
