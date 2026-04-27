import { describe, expect, test, vi } from 'bun:test';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { TerminalState, Workspace } from '../../src/core/types';
import type { LayoutState } from '../../src/core/operations/layout-actions';
import { DEFAULT_CONFIG } from '../../src/core/config';
import type { ITerminalEmulator } from '../../src/terminal/emulator-interface';

const mockControlProtocol = async () => {
  const protocol = await import('../../src/control/protocol');
  vi.mock('../../src/control/protocol', () => ({
    ...protocol,
    CONTROL_SOCKET_DIR: process.env.OPENMUX_CONTROL_SOCKET_DIR,
    CONTROL_SOCKET_PATH: process.env.OPENMUX_CONTROL_SOCKET_PATH,
  }));
};

function makeState(line: string): TerminalState {
  return {
    cols: line.length,
    rows: 1,
    cells: [
      line.split('').map((char) => ({
        char,
        fg: { r: 255, g: 255, b: 255 },
        bg: { r: 0, g: 0, b: 0 },
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        inverse: false,
        blink: false,
        dim: false,
        width: 1,
      })),
    ],
    cursor: { x: 0, y: 0, visible: true },
    alternateScreen: false,
    mouseTracking: false,
  };
}

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

describe('control capture', () => {
  test('fetchTerminalState updates capture output', async () => {
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

    let currentState: TerminalState = makeState('');
    let forcedFetch = false;

    const emulator: ITerminalEmulator = {
      cols: 0,
      rows: 0,
      isDisposed: false,
      write: () => {},
      resize: () => {},
      reset: () => {},
      dispose: () => {},
      getScrollbackLength: () => 0,
      getScrollbackLine: () => null,
      getDirtyUpdate: () => {
        throw new Error('not used');
      },
      getTerminalState: () => currentState,
      getCursor: () => ({ x: 0, y: 0, visible: true }),
      getCursorKeyMode: () => 'normal',
      getKittyKeyboardFlags: () => 0,
      isMouseTrackingEnabled: () => false,
      isAlternateScreen: () => false,
      getMode: () => false,
      getColors: () => ({ foreground: 0, background: 0, palette: [] as number[] }),
      getTitle: () => '',
      onTitleChange: () => () => {},
      onUpdate: () => () => {},
      onModeChange: () => () => {},
      search: async () => ({ matches: [], hasMore: false }),
    } satisfies ITerminalEmulator;

    const server = await startControlServer({
      getLayoutState: () => layoutState,
      getActiveWorkspace: () => workspace,
      switchWorkspace: () => {},
      focusPane: () => {},
      closePaneById: () => {},
      splitPane: () => {},
      toggleScratchPane: () => {},
      setLayoutMode: () => {},
      setWorkspaceLabel: () => {},
      writeToPty: () => {},
      getEmulator: () => emulator,
      capturePty: async () => null,
      fetchTerminalState: async (_ptyId, options) => {
        forcedFetch = options?.force ?? false;
        currentState = makeState('hello');
        return currentState;
      },
      fetchScrollState: async () => ({ viewportOffset: 0, scrollbackLength: 0, isAtBottom: true }),
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

    const response = await client.request('pane.capture', {
      lines: 1,
      format: 'text',
      pane: 'focused',
    });
    const result = response.header.result as { text?: string } | undefined;

    expect(result?.text).toBe('hello');
    expect(forcedFetch).toBe(true);

    client.close();
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('capturePty short-circuits emulator capture', async () => {
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

    let captureOptions: { lines: number; format: string; raw?: boolean } | null = null;
    const server = await startControlServer({
      getLayoutState: () => layoutState,
      getActiveWorkspace: () => workspace,
      switchWorkspace: () => {},
      focusPane: () => {},
      closePaneById: () => {},
      splitPane: () => {},
      toggleScratchPane: () => {},
      setLayoutMode: () => {},
      setWorkspaceLabel: () => {},
      writeToPty: () => {},
      getEmulator: () => null,
      capturePty: async (_ptyId, options) => {
        captureOptions = { ...options };
        return 'direct-capture';
      },
      fetchTerminalState: async () => null,
      fetchScrollState: async () => null,
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

    const response = await client.request('pane.capture', {
      lines: 10,
      format: 'text',
      raw: true,
      pane: 'focused',
    });
    const result = response.header.result as { text?: string } | undefined;

    expect(result?.text).toBe('direct-capture');
    expect(captureOptions).toEqual({ lines: 10, format: 'text', raw: true });

    client.close();
    await server.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });
});
