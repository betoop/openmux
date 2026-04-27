/**
 * Workspace operations action handlers
 * SET_VIEWPORT, SWITCH_WORKSPACE, LOAD_SESSION, CLEAR_ALL
 */

import type { Rectangle, WorkspaceId } from '../../types';
import type { LayoutState, Workspaces } from './types';
import {
  createWorkspace,
  updateWorkspace,
  recalculateLayout,
  syncPaneIdCounter,
  syncSplitIdCounter,
  generatePaneId,
} from './helpers';

/**
 * Handle SET_VIEWPORT action
 * Updates viewport and recalculates all layouts
 */
export function handleSetViewport(state: LayoutState, viewport: Rectangle): LayoutState {
  const newWorkspaces: Workspaces = {};
  for (const [idStr, workspace] of Object.entries(state.workspaces)) {
    if (!workspace) continue;
    const id = Number(idStr) as WorkspaceId;
    if (workspace.mainPane || workspace.scratchPane) {
      newWorkspaces[id] = recalculateLayout(workspace, viewport, state.config);
    } else {
      newWorkspaces[id] = workspace;
    }
  }
  return {
    ...state,
    workspaces: newWorkspaces,
    viewport,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle SWITCH_WORKSPACE action
 * Switches to existing workspace or creates new one
 * If autoCreatePaneOnEmptyWorkspace is enabled, creates a pane in empty workspaces
 */
export function handleSwitchWorkspace(state: LayoutState, workspaceId: WorkspaceId): LayoutState {
  if (state.workspaces[workspaceId] === undefined) {
    let newWorkspace = createWorkspace(workspaceId, state.config.defaultLayoutMode);

    // Auto-create a pane if the config is enabled
    if (state.config.autoCreatePaneOnEmptyWorkspace) {
      const newPaneId = generatePaneId();
      newWorkspace = {
        ...newWorkspace,
        mainPane: {
          id: newPaneId,
          ptyId: undefined,
          title: 'shell',
        },
        focusedPaneId: newPaneId,
      };
      newWorkspace = recalculateLayout(newWorkspace, state.viewport, state.config);
    }

    return {
      ...state,
      workspaces: updateWorkspace(state, newWorkspace),
      activeWorkspaceId: workspaceId,
      layoutVersion: state.layoutVersion + 1,
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }

  // Check if existing workspace is empty and auto-create pane if enabled
  const existingWorkspace = state.workspaces[workspaceId];
  if (
    state.config.autoCreatePaneOnEmptyWorkspace &&
    existingWorkspace &&
    !existingWorkspace.mainPane
  ) {
    const newPaneId = generatePaneId();
    const updatedWorkspace = {
      ...existingWorkspace,
      mainPane: {
        id: newPaneId,
        ptyId: undefined,
        title: 'shell',
      },
      focusedPaneId: newPaneId,
    };
    const recalculatedWorkspace = recalculateLayout(updatedWorkspace, state.viewport, state.config);

    return {
      ...state,
      workspaces: updateWorkspace(state, recalculatedWorkspace),
      activeWorkspaceId: workspaceId,
      layoutVersion: state.layoutVersion + 1,
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }

  return {
    ...state,
    activeWorkspaceId: workspaceId,
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle SET_WORKSPACE_LABEL action
 * Updates the label for a workspace (no geometry changes)
 */
export function handleSetWorkspaceLabel(
  state: LayoutState,
  workspaceId: WorkspaceId,
  label?: string
): LayoutState {
  const existing = state.workspaces[workspaceId];
  const workspace = existing ?? createWorkspace(workspaceId, state.config.defaultLayoutMode);
  const trimmed = label?.trim() ?? '';
  const nextLabel = trimmed.length > 0 ? trimmed : undefined;

  if (!existing && !nextLabel) {
    return state;
  }

  if (existing && workspace.label === nextLabel) {
    return state;
  }

  const updated = { ...workspace, label: nextLabel };
  return {
    ...state,
    workspaces: updateWorkspace(state, updated),
    layoutVersion: state.layoutVersion + 1,
  };
}

/**
 * Handle LOAD_SESSION action
 * Loads workspaces from a saved session
 */
export function handleLoadSession(
  state: LayoutState,
  workspaces: Workspaces,
  activeWorkspaceId: WorkspaceId
): LayoutState {
  const newWorkspaces: Workspaces = {};
  for (const [idStr, workspace] of Object.entries(workspaces)) {
    if (!workspace) continue;
    const id = Number(idStr) as WorkspaceId;
    if (workspace.mainPane || workspace.scratchPane) {
      newWorkspaces[id] = recalculateLayout(workspace, state.viewport, state.config);
    } else {
      newWorkspaces[id] = workspace;
    }
  }
  // Sync pane ID counter to avoid conflicts with existing pane IDs
  syncPaneIdCounter(newWorkspaces);
  syncSplitIdCounter(newWorkspaces);
  return {
    ...state,
    workspaces: newWorkspaces,
    activeWorkspaceId,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

/**
 * Handle CLEAR_ALL action
 * Clears all workspaces for session switch
 */
export function handleClearAll(state: LayoutState): LayoutState {
  return {
    ...state,
    workspaces: {},
    activeWorkspaceId: 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}
