import { onCleanup, onMount } from 'solid-js';

import type { LayoutContextValue } from '../../contexts/LayoutContext';
import type { TerminalContextValue } from '../../contexts/TerminalContext';
import type { SessionContextValue } from '../../contexts/SessionContext';
import { startControlServer, type ControlServer } from '../../control';
import { capturePty, getScrollState, getTerminalState } from '../../effect/bridge';

export function setupControlServer(params: {
  layout: LayoutContextValue;
  terminal: TerminalContextValue;
  session: SessionContextValue;
}): void {
  let server: ControlServer | null = null;

  onMount(() => {
    startControlServer({
      getLayoutState: () => params.layout.state,
      getActiveWorkspace: () => params.layout.activeWorkspace,
      switchWorkspace: params.layout.switchWorkspace,
      focusPane: params.layout.focusPane,
      closePaneById: params.layout.closePaneById,
      splitPane: params.layout.splitPane,
      setLayoutMode: params.layout.setLayoutMode,
      setWorkspaceLabel: params.layout.setWorkspaceLabel,
      writeToPty: params.terminal.writeToPTY,
      getEmulator: params.terminal.getEmulatorSync,
      fetchTerminalState: getTerminalState,
      fetchScrollState: getScrollState,
      capturePty,
      isPtyActive: params.terminal.isPtyActive,
      createSession: params.session.createSession,
      listSessions: () => params.session.state.sessions,
      switchSession: params.session.switchSession,
      getActiveSessionId: () => params.session.state.activeSessionId,
      exportLayoutSnapshot: params.session.exportLayoutSnapshot,
      importLayoutSnapshot: params.session.importLayoutSnapshot,
    })
      .then((created) => {
        server = created;
      })
      .catch((error) => {
        console.error('Failed to start control server:', error);
      });
  });

  onCleanup(() => {
    if (!server) return;
    server.close().catch((e) => {
      console.warn('[control-server] Failed to close server:', e);
    });
  });
}
