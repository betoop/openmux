import { describe, expect, test, vi } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Workspace } from '../../src/core/types';
import type { LayoutState } from '../../src/core/operations/layout-actions';
import { DEFAULT_CONFIG } from '../../src/core/config';
import type { ITerminalEmulator } from '../../src/terminal/emulator-interface';
import type { TemplateSession } from '../../src/effect/models';

const mockControlProtocol = async () => {
  const protocol = await import('../../src/control/protocol');
  vi.mock('../../src/control/protocol', () => ({
    ...protocol,
    CONTROL_SOCKET_DIR: process.env.OPENMUX_CONTROL_SOCKET_DIR,
    CONTROL_SOCKET_PATH: process.env.OPENMUX_CONTROL_SOCKET_PATH,
  }));
};

function createLayoutState(workspace: Workspace): LayoutState {
  return {
    workspaces: { [workspace.id]: workspace },
    activeWorkspaceId: workspace.id,
    viewport: { x: 0, y: 0, width: 80, height: 24 },
    config: DEFAULT_CONFIG,
    layoutVersion: 0,
    layoutGeometryVersion: 0,
  };
}

describe('control server smoke', () => {
  test('pane.send routes through control socket', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmux-control-'));
    process.env.OPENMUX_CONTROL_SOCKET_DIR = tempDir;
    process.env.OPENMUX_CONTROL_SOCKET_PATH = path.join(tempDir, 'openmux-ui.sock');

    await mockControlProtocol();

    const { startControlServer } = await import('../../src/control/server');
    const { connectControlClient } = await import('../../src/control/client');

    const workspace: Workspace = {
      id: 1,
      label: undefined,
      mainPane: { id: 'pane-1', ptyId: 'pty-1' },
      stackPanes: [],
      focusedPaneId: 'pane-1',
      activeStackIndex: 0,
      layoutMode: 'vertical',
      zoomed: false,
    };

    const layoutState = createLayoutState(workspace);
    let sent: { ptyId: string; data: string } | null = null;

    const server = await startControlServer({
      getLayoutState: () => layoutState,
      getActiveWorkspace: () => workspace,
      switchWorkspace: () => {},
      focusPane: () => {},
      closePaneById: () => {},
      splitPane: () => {},
      setLayoutMode: () => {},
      setWorkspaceLabel: () => {},
      writeToPty: (ptyId, data) => {
        sent = { ptyId, data };
      },
      getEmulator: () => null as ITerminalEmulator | null,
      fetchTerminalState: async (_ptyId, _options) => null,
      fetchScrollState: async (_ptyId, _options) => null,
      capturePty: async () => null,
      isPtyActive: () => true,
      createSession: async () => ({
        id: 'session-1',
        name: 'test',
        createdAt: Date.now(),
        lastSwitchedAt: Date.now(),
        autoNamed: false,
      }),
      listSessions: () => [
        {
          id: 'session-1',
          name: 'test',
          createdAt: 1,
          lastSwitchedAt: 2,
          autoNamed: false,
        },
      ],
      switchSession: async () => {},
      getActiveSessionId: () => 'session-1',
    });

    const client = await connectControlClient({
      socketPath: process.env.OPENMUX_CONTROL_SOCKET_PATH,
      timeoutMs: 500,
    });

    await client.request('pane.send', { text: 'echo test', pane: 'focused' });

    expect(sent).toEqual({ ptyId: 'pty-1', data: 'echo test' });

    client.close();
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('headless commands list and mutate sessions, workspaces, panes, and layout', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmux-control-'));
    process.env.OPENMUX_CONTROL_SOCKET_DIR = tempDir;
    process.env.OPENMUX_CONTROL_SOCKET_PATH = path.join(tempDir, 'openmux-ui.sock');

    await mockControlProtocol();

    const { startControlServer } = await import('../../src/control/server');
    const { connectControlClient } = await import('../../src/control/client');

    const workspace: Workspace = {
      id: 1,
      label: 'dev',
      mainPane: { id: 'pane-1', ptyId: 'pty-1', title: 'main' },
      stackPanes: [{ id: 'pane-2', ptyId: 'pty-2', title: 'logs' }],
      focusedPaneId: 'pane-1',
      activeStackIndex: 0,
      layoutMode: 'vertical',
      zoomed: false,
    };

    const layoutState = createLayoutState(workspace);
    const sessions = [
      { id: 'session-1', name: 'dev', createdAt: 1, lastSwitchedAt: 2, autoNamed: false },
      { id: 'session-2', name: 'logs', createdAt: 3, lastSwitchedAt: 4, autoNamed: false },
    ];
    let switchedWorkspace: number | null = null;
    let focusedPane: string | null = null;
    let closedPane: string | null = null;
    let nextLayoutMode: string | null = null;
    let renamedWorkspace: { id: number; label?: string } | null = null;
    let switchedSession: string | null = null;

    const server = await startControlServer({
      getLayoutState: () => layoutState,
      getActiveWorkspace: () => workspace,
      switchWorkspace: (workspaceId) => {
        switchedWorkspace = workspaceId;
      },
      focusPane: (paneId) => {
        focusedPane = paneId;
      },
      closePaneById: (paneId) => {
        closedPane = paneId;
      },
      splitPane: () => {},
      setLayoutMode: (mode) => {
        nextLayoutMode = mode;
      },
      setWorkspaceLabel: (workspaceId, label) => {
        renamedWorkspace = { id: workspaceId, label };
      },
      writeToPty: () => {},
      getEmulator: () => null as ITerminalEmulator | null,
      fetchTerminalState: async () => null,
      fetchScrollState: async () => null,
      capturePty: async () => null,
      isPtyActive: (ptyId) => ptyId === 'pty-1',
      createSession: async () => sessions[0],
      listSessions: () => sessions,
      switchSession: async (sessionId) => {
        switchedSession = sessionId;
      },
      getActiveSessionId: () => 'session-1',
    });

    const client = await connectControlClient({
      socketPath: process.env.OPENMUX_CONTROL_SOCKET_PATH,
      timeoutMs: 500,
    });

    const sessionList = await client.request('session.list');
    expect(
      (sessionList.header.result as { sessions: Array<{ active: boolean }> }).sessions
    ).toEqual([
      { ...sessions[0], active: true },
      { ...sessions[1], active: false },
    ]);

    await client.request('session.switch', { name: 'logs' });
    expect(switchedSession).toBe('session-2');

    const workspaceList = await client.request('workspace.list');
    expect(
      (workspaceList.header.result as { workspaces: Array<{ id: number; paneCount: number }> })
        .workspaces
    ).toMatchObject([{ id: 1, paneCount: 2 }]);

    await client.request('workspace.switch', { workspaceId: 2 });
    expect(switchedWorkspace).toBe(2);

    await client.request('workspace.rename', { workspaceId: 1, label: 'ops' });
    expect(renamedWorkspace).toEqual({ id: 1, label: 'ops' });

    const paneList = await client.request('pane.list', { all: true });
    expect(
      (paneList.header.result as { panes: Array<{ id: string; activePty: boolean }> }).panes
    ).toMatchObject([
      { id: 'pane-1', activePty: true },
      { id: 'pane-2', activePty: false },
    ]);

    await client.request('pane.focus', { pane: 'pane:pane-2' });
    expect(focusedPane).toBe('pane-2');

    await client.request('pane.close', { pane: 'pane:pane-2' });
    expect(closedPane).toBe('pane-2');

    await client.request('layout.setMode', { mode: 'stacked' });
    expect(nextLayoutMode).toBe('stacked');

    client.close();
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('layout snapshot commands export and import declarative templates', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'openmux-control-'));
    process.env.OPENMUX_CONTROL_SOCKET_DIR = tempDir;
    process.env.OPENMUX_CONTROL_SOCKET_PATH = path.join(tempDir, 'openmux-ui.sock');

    await mockControlProtocol();

    const { startControlServer } = await import('../../src/control/server');
    const { connectControlClient } = await import('../../src/control/client');

    const workspace: Workspace = {
      id: 1,
      label: 'dev',
      mainPane: { id: 'pane-1', ptyId: 'pty-1', title: 'main' },
      stackPanes: [],
      focusedPaneId: 'pane-1',
      activeStackIndex: 0,
      layoutMode: 'vertical',
      zoomed: false,
    };

    const layoutState = createLayoutState(workspace);
    const snapshot: TemplateSession & { activeWorkspaceId: 2 } = {
      version: 1,
      id: 'snapshot-1',
      name: 'Snapshot',
      createdAt: 1,
      updatedAt: 1,
      activeWorkspaceId: 2,
      defaults: {
        workspaceCount: 2,
        paneCount: 1,
        layoutMode: 'vertical',
        cwd: '/tmp',
      },
      workspaces: [
        {
          id: 1,
          label: 'dev',
          layoutMode: 'vertical',
          panes: [{ role: 'main', cwd: '/tmp' }],
          layout: {
            main: { type: 'pane', cwd: '/tmp' },
            stack: [],
          },
        },
        {
          id: 2,
          label: 'ops',
          layoutMode: 'stacked',
          panes: [{ role: 'main', cwd: '/var/log' }],
          layout: {
            main: { type: 'pane', cwd: '/var/log' },
            stack: [],
          },
        },
      ],
    };
    let exportName: string | undefined;
    let importedSnapshot: unknown = null;

    const server = await startControlServer({
      getLayoutState: () => layoutState,
      getActiveWorkspace: () => workspace,
      switchWorkspace: () => {},
      focusPane: () => {},
      closePaneById: () => {},
      splitPane: () => {},
      setLayoutMode: () => {},
      setWorkspaceLabel: () => {},
      writeToPty: () => {},
      getEmulator: () => null as ITerminalEmulator | null,
      fetchTerminalState: async () => null,
      fetchScrollState: async () => null,
      capturePty: async () => null,
      isPtyActive: () => true,
      createSession: async () => ({
        id: 'session-1',
        name: 'test',
        createdAt: Date.now(),
        lastSwitchedAt: Date.now(),
        autoNamed: false,
      }),
      listSessions: () => [
        {
          id: 'session-1',
          name: 'test',
          createdAt: 1,
          lastSwitchedAt: 2,
          autoNamed: false,
        },
      ],
      switchSession: async () => {},
      getActiveSessionId: () => 'session-1',
      exportLayoutSnapshot: async (name) => {
        exportName = name;
        return snapshot;
      },
      importLayoutSnapshot: async (nextSnapshot) => {
        importedSnapshot = nextSnapshot;
      },
    });

    const client = await connectControlClient({
      socketPath: process.env.OPENMUX_CONTROL_SOCKET_PATH,
      timeoutMs: 500,
    });

    const exported = await client.request('layout.export', { name: 'prod' });
    expect(exportName).toBe('prod');
    expect((exported.header.result as { snapshot: unknown }).snapshot).toEqual(snapshot);

    const imported = await client.request('layout.import', { snapshot });
    expect(importedSnapshot).toEqual(snapshot);
    expect(imported.header.result).toMatchObject({
      ok: true,
      activeWorkspaceId: 2,
      workspaceCount: 2,
    });

    client.close();
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
