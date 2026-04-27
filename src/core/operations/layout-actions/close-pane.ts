/**
 * CLOSE_PANE and CLOSE_PANE_BY_ID action handlers.
 */

import type { LayoutNode, PaneData, Workspace } from '../../types';
import type { LayoutState } from './types';
import { getActiveWorkspace, recalculateLayout, updateWorkspace } from './helpers';
import { containsPane, findSiblingPane, getFirstPane, removePaneFromNode } from '../../layout-tree';
import { handleCloseScratchPane, isScratchPaneId } from './scratch-pane';

type CloseOptions = {
  closingFocusedPane: boolean;
};

type StackCloseResult = {
  closeIndex: number;
  siblingPane: PaneData | null;
  updatedEntry: LayoutNode | null;
  stackPanes: LayoutNode[];
};

/**
 * Handle CLOSE_PANE action.
 * Closes the currently focused pane.
 */
export function handleClosePane(state: LayoutState): LayoutState {
  const workspace = getActiveWorkspace(state);
  if (!workspace.focusedPaneId) return state;

  if (isScratchPaneId(workspace, workspace.focusedPaneId)) {
    return handleCloseScratchPane(state, workspace);
  }

  return closePaneInWorkspace(state, workspace, workspace.focusedPaneId, {
    closingFocusedPane: true,
  });
}

/**
 * Handle CLOSE_PANE_BY_ID action.
 * Closes a specific pane by ID.
 */
export function handleClosePaneById(state: LayoutState, paneId: string): LayoutState {
  const workspace = findWorkspaceContainingPane(state, paneId);
  if (!workspace) return state;

  return closePaneInWorkspace(state, workspace, paneId, {
    closingFocusedPane: paneId === workspace.focusedPaneId,
  });
}

function findWorkspaceContainingPane(state: LayoutState, paneId: string): Workspace | null {
  for (const workspace of Object.values(state.workspaces)) {
    if (!workspace) continue;
    if (
      isScratchPaneId(workspace, paneId) ||
      (workspace.mainPane && containsPane(workspace.mainPane, paneId)) ||
      workspace.stackPanes.some((pane) => containsPane(pane, paneId))
    ) {
      return workspace;
    }
  }

  return null;
}

function closePaneInWorkspace(
  state: LayoutState,
  workspace: Workspace,
  paneId: string,
  options: CloseOptions
): LayoutState {
  if (isScratchPaneId(workspace, paneId)) {
    return handleCloseScratchPane(state, workspace);
  }

  const updated =
    workspace.mainPane && containsPane(workspace.mainPane, paneId)
      ? closeMainPane(workspace, paneId, options)
      : closeStackPane(workspace, paneId, options);

  if (!updated) return state;
  return finalizeClosedWorkspace(state, workspace, updated);
}

function finalizeClosedWorkspace(
  state: LayoutState,
  workspace: Workspace,
  updated: Workspace
): LayoutState {
  if (!updated.mainPane) {
    const remainingWorkspaces = { ...state.workspaces };
    delete remainingWorkspaces[workspace.id];
    return {
      ...state,
      workspaces: remainingWorkspaces,
      layoutVersion: state.layoutVersion + 1,
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }

  const recalculated = recalculateLayout(updated, state.viewport, state.config);
  return {
    ...state,
    workspaces: updateWorkspace(state, recalculated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

function closeMainPane(workspace: Workspace, paneId: string, options: CloseOptions): Workspace {
  if (!workspace.mainPane) return workspace;

  const siblingPane = options.closingFocusedPane
    ? findSiblingPane(workspace.mainPane, paneId)
    : null;
  const updatedMain = removePaneFromNode(workspace.mainPane, paneId);

  if (!updatedMain) {
    return promoteFirstStackPane(workspace);
  }

  return {
    ...workspace,
    mainPane: updatedMain,
    focusedPaneId: options.closingFocusedPane
      ? (siblingPane?.id ?? getFirstPane(updatedMain)?.id ?? workspace.focusedPaneId)
      : workspace.focusedPaneId,
  };
}

function promoteFirstStackPane(workspace: Workspace): Workspace {
  if (workspace.stackPanes.length === 0) {
    return {
      ...workspace,
      mainPane: null,
      focusedPaneId: null,
    };
  }

  const [mainPane, ...stackPanes] = workspace.stackPanes;
  return {
    ...workspace,
    mainPane: mainPane!,
    stackPanes,
    focusedPaneId: getFirstPane(mainPane)?.id ?? null,
    activeStackIndex: Math.min(workspace.activeStackIndex, Math.max(0, stackPanes.length - 1)),
  };
}

function closeStackPane(
  workspace: Workspace,
  paneId: string,
  options: CloseOptions
): Workspace | null {
  const result = removeStackPaneEntry(workspace, paneId);
  if (!result) return null;

  if (!options.closingFocusedPane) {
    return {
      ...workspace,
      stackPanes: result.stackPanes,
      focusedPaneId: workspace.focusedPaneId,
      activeStackIndex: getActiveStackIndexAfterUnfocusedClose(workspace, result),
    };
  }

  const nextFocus = getFocusedStackCloseTarget(workspace, result);
  return {
    ...workspace,
    stackPanes: result.stackPanes,
    focusedPaneId: nextFocus.focusedPaneId,
    activeStackIndex: nextFocus.activeStackIndex,
  };
}

function removeStackPaneEntry(workspace: Workspace, paneId: string): StackCloseResult | null {
  const closeIndex = workspace.stackPanes.findIndex((pane) => containsPane(pane, paneId));
  if (closeIndex < 0) return null;

  const currentEntry = workspace.stackPanes[closeIndex]!;
  const updatedEntry = removePaneFromNode(currentEntry, paneId);

  return {
    closeIndex,
    siblingPane: findSiblingPane(currentEntry, paneId),
    updatedEntry,
    stackPanes: updatedEntry
      ? workspace.stackPanes.map((pane, index) => (index === closeIndex ? updatedEntry : pane))
      : workspace.stackPanes.filter((_, index) => index !== closeIndex),
  };
}

function getActiveStackIndexAfterUnfocusedClose(
  workspace: Workspace,
  result: StackCloseResult
): number {
  if (result.updatedEntry || result.closeIndex > workspace.activeStackIndex) {
    return workspace.activeStackIndex;
  }

  return Math.max(0, workspace.activeStackIndex - 1);
}

function getFocusedStackCloseTarget(
  workspace: Workspace,
  result: StackCloseResult
): { focusedPaneId: string | null; activeStackIndex: number } {
  const mainFallback = getFirstPane(workspace.mainPane)?.id ?? null;

  if (result.updatedEntry) {
    return {
      focusedPaneId:
        result.siblingPane?.id ?? getFirstPane(result.updatedEntry)?.id ?? mainFallback,
      activeStackIndex: result.closeIndex,
    };
  }

  if (result.stackPanes.length === 0) {
    return {
      focusedPaneId: mainFallback,
      activeStackIndex: 0,
    };
  }

  const activeStackIndex = Math.min(result.closeIndex, result.stackPanes.length - 1);
  return {
    focusedPaneId: getFirstPane(result.stackPanes[activeStackIndex]!)?.id ?? mainFallback,
    activeStackIndex,
  };
}
