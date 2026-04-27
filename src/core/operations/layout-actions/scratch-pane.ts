import type { Workspace } from '../../types';
import type { LayoutState } from './types';
import { generatePaneId, getActiveWorkspace, recalculateLayout, updateWorkspace } from './helpers';
import { findPaneInWorkspace } from '../master-stack-layout';
import { getFirstPane } from '../../layout-tree';

const SCRATCH_PANE_TITLE = 'scratch';

export function isScratchPaneId(workspace: Workspace, paneId: string): boolean {
  return workspace.scratchPane?.id === paneId;
}

function getFallbackFocus(workspace: Workspace, preferredPaneId?: string | null): string | null {
  if (preferredPaneId && findPaneInWorkspace(workspace, preferredPaneId)) {
    return preferredPaneId;
  }

  const mainPane = getFirstPane(workspace.mainPane);
  if (mainPane) return mainPane.id;

  const activeStackPane = getFirstPane(workspace.stackPanes[workspace.activeStackIndex] ?? null);
  if (activeStackPane) return activeStackPane.id;

  for (const stackPane of workspace.stackPanes) {
    const pane = getFirstPane(stackPane);
    if (pane) return pane.id;
  }

  return null;
}

function finalizeScratchWorkspace(
  state: LayoutState,
  workspace: Workspace,
  options?: { removeEmpty?: boolean }
): LayoutState {
  const recalculated = recalculateLayout(workspace, state.viewport, state.config);

  if (options?.removeEmpty && !recalculated.mainPane && recalculated.stackPanes.length === 0) {
    const remainingWorkspaces = { ...state.workspaces };
    delete remainingWorkspaces[workspace.id];
    return {
      ...state,
      workspaces: remainingWorkspaces,
      layoutVersion: state.layoutVersion + 1,
      layoutGeometryVersion: state.layoutGeometryVersion + 1,
    };
  }

  return {
    ...state,
    workspaces: updateWorkspace(state, recalculated),
    layoutVersion: state.layoutVersion + 1,
    layoutGeometryVersion: state.layoutGeometryVersion + 1,
  };
}

export function handleToggleScratchPane(state: LayoutState): LayoutState {
  const workspace = getActiveWorkspace(state);
  const scratchPane = workspace.scratchPane ?? {
    id: generatePaneId(),
    title: SCRATCH_PANE_TITLE,
  };

  if (workspace.scratchVisible && workspace.scratchPane) {
    const focusedPaneId = getFallbackFocus(workspace, workspace.scratchPreviousFocusedPaneId);
    return finalizeScratchWorkspace(state, {
      ...workspace,
      scratchVisible: false,
      scratchPreviousFocusedPaneId: null,
      focusedPaneId,
    });
  }

  const previousFocusedPaneId =
    workspace.focusedPaneId && workspace.focusedPaneId !== scratchPane.id
      ? workspace.focusedPaneId
      : (workspace.scratchPreviousFocusedPaneId ?? getFallbackFocus(workspace, null));

  return finalizeScratchWorkspace(state, {
    ...workspace,
    scratchPane,
    scratchVisible: true,
    scratchPreviousFocusedPaneId: previousFocusedPaneId,
    focusedPaneId: scratchPane.id,
  });
}

export function handleCloseScratchPane(state: LayoutState, workspace: Workspace): LayoutState {
  if (!workspace.scratchPane) return state;

  const focusedPaneId =
    workspace.focusedPaneId === workspace.scratchPane.id
      ? getFallbackFocus(workspace, workspace.scratchPreviousFocusedPaneId)
      : workspace.focusedPaneId;

  return finalizeScratchWorkspace(
    state,
    {
      ...workspace,
      scratchPane: null,
      scratchVisible: false,
      scratchPreviousFocusedPaneId: null,
      focusedPaneId,
    },
    { removeEmpty: true }
  );
}
