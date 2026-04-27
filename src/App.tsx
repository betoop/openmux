/**
 * Main App component for openmux
 */

import { useTerminalDimensions, useRenderer } from '@opentui/solid';
import { createEffect } from 'solid-js';
import {
  useConfig,
  useLayout,
  useKeyboardHandler,
  useKeyboard,
  useOverlays,
  useTerminal,
  useCopyMode,
} from './contexts';
import { useSelection } from './contexts/SelectionContext';
import { useSearch } from './contexts/SearchContext';
import { useSession } from './contexts/SessionContext';
import { useAggregateView } from './contexts/AggregateViewContext';
import { useTitle } from './contexts/TitleContext';
import { PaneContainer } from './components';
import { getFocusedPane, getFocusedPtyId } from './core/workspace-utils';
import { type CommandPaletteCommand } from './core/command-palette';
import { resolveAggregatePreviewPtyId } from './components/aggregate/utils';
import {
  setKeyboardVimMode,
  type KeyboardVimMode,
  setKeyboardPrefixOnly,
} from './core/user-config';
import { onShimDetached } from './effect/bridge';
import { createPaneResizeHandlers, createPasteHandler } from './components/app';
import { setClipboardPasteHandler, setCopyModeExitCallback } from './terminal/focused-pty-registry';
import { readFromClipboard } from './effect/bridge';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { handleNormalModeAction } from './contexts/keyboard/handlers';
import { setupKeyboardRouting } from './components/app/keyboard-routing';
import { usePtyCreation } from './components/app/pty-creation';
import { AppOverlays } from './components/app/AppOverlays';
import {
  createKittyGraphicsBridge,
  type RendererWithNative,
} from './components/app/kitty-graphics-bridge';
import { createCellMetricsGetter, createPixelResizeTracker } from './components/app/pixel-metrics';
import { createSearchVimState } from './components/app/search-vim';
import { createCopyModeVimState } from './components/app/copy-mode-vim';
import { createCopyModeKeyHandler } from './components/app/copy-mode-keyboard';
import { setupAppLayoutEffects } from './components/app/layout-effects';
import { setupAppEffects } from './components/app/app-effects';
import { setupControlServer } from './components/app/control-server';
import { AppProviders } from './components/app/AppProviders';
import {
  getCommandPaletteRect,
  getPaneRenameRect,
  getWorkspaceLabelRect,
  getConfirmationRect,
  getCopyNotificationRect,
  getSearchOverlayRect,
  getSessionPickerRect,
  getTemplateOverlayRect,
} from './components/app/overlay-rects';

function AppContent() {
  const config = useConfig();
  const dimensions = useTerminalDimensions();
  const width = () => dimensions().width;
  const height = () => dimensions().height;
  const layout = useLayout();
  const { setViewport, newPane } = layout;
  // Don't destructure isInitialized - it's a reactive getter that loses reactivity when destructured
  const terminal = useTerminal();
  const {
    resizePTY,
    writeToFocused,
    writeToPTY,
    pasteToFocused,
    getFocusedEmulator,
    isPtyActive,
    refreshHostColors,
  } = terminal;
  const session = useSession();
  const { togglePicker, toggleTemplateOverlay, state: sessionState } = session;
  const titleContext = useTitle();
  // Keep selection/search contexts to access reactive getters
  const selection = useSelection();
  const { clearAllSelections } = selection;
  const search = useSearch();
  const { enterSearchMode, exitSearchMode, setSearchQuery, nextMatch, prevMatch } = search;
  const copyMode = useCopyMode();
  const { state: aggregateState, openAggregateView, togglePreviewZoom } = useAggregateView();
  const keyboardState = useKeyboard();
  const { exitSearchMode: keyboardExitSearchMode, exitCopyMode: keyboardExitCopyMode } =
    keyboardState;
  const renderer = useRenderer();
  const overlays = useOverlays();
  const {
    toggleCommandPalette,
    setPaneRenameState,
    setWorkspaceLabelState,
    setUpdateLabel,
    confirmationState,
    confirmationHandlers,
    handleQuit,
    handleDetach,
    handleShimDetached,
  } = overlays;

  const getCellMetrics = createCellMetricsGetter(
    renderer as { resolution?: { width: number; height: number } | null },
    width,
    height
  );

  const paneResizeHandlers = createPaneResizeHandlers({
    getPanes: () => layout.panes,
    resizePTY,
    getCellMetrics,
  });

  const { ensurePixelResize, stopPixelResizePoll } = createPixelResizeTracker({
    getCellMetrics,
    isTerminalInitialized: () => terminal.isInitialized,
    getPaneCount: () => layout.panes.length,
    scheduleResizeAllPanes: paneResizeHandlers.scheduleResizeAllPanes,
  });

  const kittyRenderer = createKittyGraphicsBridge({
    renderer: renderer as unknown as RendererWithNative,
    ensurePixelResize,
    stopPixelResizePoll,
  });

  const getActivePtyId = () => {
    if (aggregateState.showAggregateView && aggregateState.previewMode) {
      return (
        resolveAggregatePreviewPtyId({
          selectedPtyId: aggregateState.selectedPtyId,
          selectedIndex: aggregateState.selectedIndex,
          flattenedTree: aggregateState.flattenedTree,
          activeSessionId: session.state.activeSessionId,
          workspaces: layout.state.workspaces,
        }) ?? undefined
      );
    }
    return getFocusedPtyId(layout.activeWorkspace);
  };

  setupControlServer({ layout, terminal, session });

  // Create paste handler for bracketed paste from host terminal
  const pasteHandler = createPasteHandler({
    getFocusedPtyId: getActivePtyId,
    exitCopyMode: () => {
      if (keyboardState.state.mode === 'copy') {
        handleExitCopyMode();
      }
    },
    writeToPTY,
  });
  setupAppEffects({
    getWidth: width,
    getHeight: height,
    sessionState,
    session,
    layout,
    search,
    selection,
    aggregateState,
    commandPaletteState: overlays.commandPaletteState,
    paneRenameState: overlays.paneRenameState,
    workspaceLabelState: overlays.workspaceLabelState,
    confirmationVisible: () => confirmationState().visible,
    kittyRenderer,
    getSessionPickerRect,
    getTemplateOverlayRect,
    getCommandPaletteRect,
    getPaneRenameRect,
    getWorkspaceLabelRect,
    getSearchOverlayRect,
    getConfirmationRect,
    getCopyNotificationRect,
    renderer,
    pasteHandler,
    setUpdateLabel,
    setClipboardPasteHandler,
    setCopyModeExitCallback,
    readFromClipboard,
    writeToPTY,
    onShimDetached,
    handleShimDetached,
    getFocusedPtyId: getActivePtyId,
    isPtyActive,
  });

  const { handleNewPane, handleSplitPane, handleToggleScratchPane } = usePtyCreation({
    layout: {
      get panes() {
        return layout.panes;
      },
      getFocusedPaneId: () => layout.activeWorkspace.focusedPaneId,
      getScratchVisible: () => layout.activeWorkspace.scratchVisible === true,
      getScratchPtyId: () => layout.activeWorkspace.scratchPane?.ptyId,
    },
    terminal,
    sessionState,
    newPane,
    splitPane: layout.splitPane,
    toggleScratchPane: layout.toggleScratchPane,
  });

  // Create paste handler for manual paste (Ctrl+V, prefix+p/])
  const handlePaste = () => {
    pasteToFocused();
  };

  const handlePaneRenameOpen = () => {
    const focusedPane = getFocusedPane(layout.activeWorkspace);
    if (!focusedPane) return;
    const currentTitle = titleContext.getTitle(focusedPane.id) ?? focusedPane.title ?? 'shell';
    setPaneRenameState({ show: true, paneId: focusedPane.id, value: currentTitle });
  };

  const handleWorkspaceLabelOpen = () => {
    const workspace = layout.activeWorkspace;
    const currentLabel = workspace.label ?? '';
    setWorkspaceLabelState({
      show: true,
      workspaceId: workspace.id,
      value: currentLabel,
    });
  };

  const hasAnyPanes = () =>
    Object.values(layout.state.workspaces).some(
      (workspace) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0)
    );

  // Toggle debug console
  const handleToggleConsole = () => {
    renderer.console.toggle();
  };

  // Dump console logs to /tmp
  const handleDumpConsoleLogs = () => {
    try {
      const logs = renderer.console.getCachedLogs();
      const timestamp = Date.now();
      const filename = `openmux-console-${timestamp}.log`;
      const filepath = path.join(os.tmpdir(), filename);
      fs.writeFileSync(filepath, logs, 'utf8');
      console.info(`Console logs dumped to: ${filepath}`);
    } catch (error) {
      console.error('Failed to dump console logs:', error);
    }
  };

  const handleToggleVimMode = () => {
    const current = config.config().keyboard.vimMode;
    const next: KeyboardVimMode = current === 'overlays' ? 'off' : 'overlays';
    setKeyboardVimMode(next);
    config.reloadConfig();
  };

  const handleTogglePrefixOnly = () => {
    const current = config.config().keyboard.prefixOnly;
    setKeyboardPrefixOnly(!current);
    config.reloadConfig();
  };

  const handleRefreshHostColors = () => {
    refreshHostColors({ forceApply: true }).catch((error) => {
      console.warn('[openmux] Failed to refresh host colors:', error);
    });
  };

  const searchVimState = createSearchVimState({ config, search });
  const copyModeVimState = createCopyModeVimState({
    config,
    isCopyModeActive: () => keyboardState.state.mode === 'copy',
  });

  // Search mode enter handler
  const handleEnterSearch = async () => {
    // Clear any existing selection so it doesn't hide search highlights
    clearAllSelections();

    // Get the focused pane's PTY ID using centralized utility
    const focusedPtyId = getFocusedPtyId(layout.activeWorkspace);
    if (focusedPtyId) {
      await enterSearchMode(focusedPtyId);
    }
  };

  const handleEnterCopyMode = () => {
    clearAllSelections();
    const focusedPtyId = getActivePtyId();
    if (!focusedPtyId) {
      keyboardExitCopyMode();
      return;
    }
    copyMode.enterCopyMode(focusedPtyId);
  };

  const handleExitCopyMode = () => {
    copyMode.exitCopyMode();
    keyboardExitCopyMode();
  };

  // Wire copy mode exit into the focused PTY registry so that
  // bracketed paste (Cmd+V via host terminal) can exit copy mode
  // before pasting clipboard content to the PTY
  createEffect(() => {
    const active = keyboardState.state.mode === 'copy';
    setCopyModeExitCallback(active ? handleExitCopyMode : null);
  });

  const handleCopyModeKey = createCopyModeKeyHandler({
    copyMode,
    exitCopyMode: handleExitCopyMode,
    pasteCallback: handlePaste,
    getVimHandler: copyModeVimState.getCopyVimHandler,
  });

  const executeCommandAction = (action: string) => {
    if (aggregateState.showAggregateView && aggregateState.previewMode && action === 'pane.zoom') {
      togglePreviewZoom();
      return;
    }

    handleNormalModeAction(action, keyboardState, layout, layout.activeWorkspace.layoutMode, {
      onPaste: handlePaste,
      onNewPane: handleNewPane,
      onSplitPane: handleSplitPane,
      onQuit: handleQuit,
      onDetach: handleDetach,
      onRequestQuit: confirmationHandlers.handleRequestQuit,
      onRequestClosePane: confirmationHandlers.handleRequestClosePane,
      onToggleSessionPicker: togglePicker,
      onToggleTemplateOverlay: toggleTemplateOverlay,
      onEnterSearch: handleEnterSearch,
      onEnterCopyMode: handleEnterCopyMode,
      onToggleConsole: handleToggleConsole,
      onDumpConsoleLogs: handleDumpConsoleLogs,
      onToggleAggregateView: openAggregateView,
      onToggleCommandPalette: toggleCommandPalette,
      onToggleScratchPane: handleToggleScratchPane,
      onToggleVimMode: handleToggleVimMode,
      onTogglePrefixOnly: handleTogglePrefixOnly,
      onRefreshHostColors: handleRefreshHostColors,
      onRenamePane: handlePaneRenameOpen,
      onLabelWorkspace: handleWorkspaceLabelOpen,
    });
  };

  const handleCommandPaletteExecute = (command: CommandPaletteCommand) => {
    executeCommandAction(command.action);
  };

  const keyboardHandler = useKeyboardHandler({
    onPaste: handlePaste,
    onNewPane: handleNewPane,
    onSplitPane: handleSplitPane,
    onQuit: handleQuit,
    onDetach: handleDetach,
    onRequestQuit: confirmationHandlers.handleRequestQuit,
    onRequestClosePane: confirmationHandlers.handleRequestClosePane,
    onToggleSessionPicker: togglePicker,
    onToggleTemplateOverlay: toggleTemplateOverlay,
    onEnterSearch: handleEnterSearch,
    onEnterCopyMode: handleEnterCopyMode,
    onToggleConsole: handleToggleConsole,
    onDumpConsoleLogs: handleDumpConsoleLogs,
    onToggleAggregateView: openAggregateView,
    onToggleCommandPalette: toggleCommandPalette,
    onToggleScratchPane: handleToggleScratchPane,
    onToggleVimMode: handleToggleVimMode,
    onTogglePrefixOnly: handleTogglePrefixOnly,
    onRefreshHostColors: handleRefreshHostColors,
    onRenamePane: handlePaneRenameOpen,
    onLabelWorkspace: handleWorkspaceLabelOpen,
  });

  setupAppLayoutEffects({
    width,
    height,
    setViewport,
    sessionState,
    hasAnyPanes,
    newPane,
    ensurePixelResize,
    layout,
    terminal,
    paneResizeHandlers,
    aggregateState,
  });

  setupKeyboardRouting({
    config,
    keyboardHandler,
    keyboardExitSearchMode,
    exitSearchMode,
    setSearchQuery,
    nextMatch,
    prevMatch,
    getSearchState: () => search.searchState,
    getVimEnabled: () => config.config().keyboard.vimMode === 'overlays',
    getSearchVimMode: searchVimState.getSearchVimMode,
    setSearchVimMode: searchVimState.setSearchVimMode,
    getSearchVimHandler: searchVimState.getSearchVimHandler,
    clearAllSelections,
    getFocusedEmulator,
    writeToFocused,
    isOverlayActive: () => sessionState.showSessionPicker || session.showTemplateOverlay,
    handleCopyModeKey,
  });

  return (
    <box
      style={{
        width: width(),
        height: height(),
        flexDirection: 'column',
      }}
    >
      {/* Main pane area */}
      <PaneContainer />

      <AppOverlays
        width={width()}
        height={height()}
        onCommandPaletteExecute={handleCommandPaletteExecute}
        onToggleConsole={handleToggleConsole}
      />
    </box>
  );
}

export function App() {
  return (
    <AppProviders>
      <AppContent />
    </AppProviders>
  );
}
