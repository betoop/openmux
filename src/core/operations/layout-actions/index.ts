export type { LayoutState, LayoutAction, Workspaces } from './types';

export {
  generatePaneId,
  resetPaneIdCounter,
  syncPaneIdCounter,
  generateSplitId,
  resetSplitIdCounter,
  syncSplitIdCounter,
  createIdGenerator,
  createWorkspace,
  getActiveWorkspace,
  updateWorkspace,
  updatePaneProperty,
  recalculateLayout,
} from './helpers';

export { layoutReducer } from './reducer';

export { handleFocusPane } from './focus-pane';
export { handleNavigate } from './navigate';
export { handleNewPane } from './new-pane';
export { handleSplitPane } from './split-pane';
export { handleClosePane, handleClosePaneById } from './close-pane';
export {
  handleSetViewport,
  handleSwitchWorkspace,
  handleSetWorkspaceLabel,
  handleLoadSession,
  handleClearAll,
} from './workspace-ops';
export {
  handleSetLayoutMode,
  handleSetPanePty,
  handleSetPaneTitle,
  handleSwapMain,
  handleMovePane,
  handleToggleZoom,
} from './pane-ops';
export { handleToggleScratchPane, handleCloseScratchPane } from './scratch-pane';
