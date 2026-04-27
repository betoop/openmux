import type { PaneData, Workspace, WorkspaceId } from '../core/types';
import type { LayoutState } from '../core/operations/layout-actions';
import { collectPanes, getFirstPane } from '../core/layout-tree';

export type PaneSelector =
  | { type: 'focused' }
  | { type: 'main' }
  | { type: 'stack'; index: number }
  | { type: 'pane'; id: string }
  | { type: 'pty'; id: string };

export type PaneSelectorParseResult =
  | { ok: true; selector: PaneSelector }
  | { ok: false; error: string };

export type ResolvePaneResult =
  | { ok: true; pane: PaneData; workspaceId: WorkspaceId }
  | { ok: false; errorCode: 'not_found' | 'ambiguous'; message: string };

export function parsePaneSelector(raw?: string | null): PaneSelectorParseResult {
  if (!raw || raw === 'focused' || raw === 'focus') {
    return { ok: true, selector: { type: 'focused' } };
  }
  if (raw === 'main') {
    return { ok: true, selector: { type: 'main' } };
  }
  if (raw.startsWith('stack:')) {
    const indexRaw = raw.slice('stack:'.length).trim();
    const index = Number(indexRaw);
    if (!Number.isFinite(index) || index <= 0 || Math.floor(index) !== index) {
      return { ok: false, error: 'Invalid stack index; expected stack:<n> (1-based).' };
    }
    return { ok: true, selector: { type: 'stack', index } };
  }
  if (raw.startsWith('pane:')) {
    const id = raw.slice('pane:'.length).trim();
    if (!id) {
      return { ok: false, error: 'Pane selector missing id.' };
    }
    return { ok: true, selector: { type: 'pane', id } };
  }
  if (raw.startsWith('pty:')) {
    const id = raw.slice('pty:'.length).trim();
    if (!id) {
      return { ok: false, error: 'PTY selector missing id.' };
    }
    return { ok: true, selector: { type: 'pty', id } };
  }

  if (raw.includes(':')) {
    return { ok: false, error: `Unknown pane selector: ${raw}` };
  }

  return { ok: true, selector: { type: 'pane', id: raw } };
}

export function resolvePaneSelector(params: {
  selector: PaneSelector;
  layoutState: LayoutState;
  activeWorkspace: Workspace;
  workspaceId?: WorkspaceId;
}): ResolvePaneResult {
  const { selector, layoutState, activeWorkspace, workspaceId } = params;
  const workspaces = layoutState.workspaces;

  const collectWorkspacePanes = (workspace: Workspace): PaneData[] => {
    const panes: PaneData[] = [];
    if (workspace.mainPane) {
      collectPanes(workspace.mainPane, panes);
    }
    for (const node of workspace.stackPanes) {
      collectPanes(node, panes);
    }
    if (workspace.scratchVisible && workspace.scratchPane) {
      panes.push(workspace.scratchPane);
    }
    return panes;
  };

  const findInWorkspace = (
    workspace: Workspace,
    predicate: (pane: PaneData) => boolean
  ): PaneData | null => {
    const panes = collectWorkspacePanes(workspace);
    return panes.find(predicate) ?? null;
  };

  const searchAcrossWorkspaces = (
    predicate: (pane: PaneData) => boolean
  ): Array<{ pane: PaneData; workspaceId: WorkspaceId }> => {
    const matches: Array<{ pane: PaneData; workspaceId: WorkspaceId }> = [];
    for (const [id, workspace] of Object.entries(workspaces)) {
      if (!workspace) continue;
      const pane = findInWorkspace(workspace, predicate);
      if (pane) {
        matches.push({ pane, workspaceId: Number(id) as WorkspaceId });
      }
    }
    return matches;
  };

  const resolveWorkspace = (id?: WorkspaceId): Workspace | null => {
    if (id !== undefined) {
      return workspaces[id] ?? null;
    }
    return activeWorkspace ?? null;
  };

  if (selector.type === 'focused') {
    const workspace = resolveWorkspace(workspaceId);
    if (!workspace) {
      return { ok: false, errorCode: 'not_found', message: 'Workspace not found.' };
    }
    const focusedId = workspace.focusedPaneId;
    if (!focusedId) {
      return { ok: false, errorCode: 'not_found', message: 'No focused pane.' };
    }
    const pane = findInWorkspace(workspace, (p) => p.id === focusedId);
    if (!pane) {
      return { ok: false, errorCode: 'not_found', message: 'Focused pane not found.' };
    }
    return { ok: true, pane, workspaceId: workspace.id };
  }

  if (selector.type === 'main') {
    const workspace = resolveWorkspace(workspaceId);
    if (!workspace) {
      return { ok: false, errorCode: 'not_found', message: 'Workspace not found.' };
    }
    const pane = getFirstPane(workspace.mainPane);
    if (!pane) {
      return { ok: false, errorCode: 'not_found', message: 'Main pane not found.' };
    }
    return { ok: true, pane, workspaceId: workspace.id };
  }

  if (selector.type === 'stack') {
    const workspace = resolveWorkspace(workspaceId);
    if (!workspace) {
      return { ok: false, errorCode: 'not_found', message: 'Workspace not found.' };
    }
    const stackIndex = selector.index - 1;
    const stackNode = workspace.stackPanes[stackIndex];
    if (!stackNode) {
      return { ok: false, errorCode: 'not_found', message: 'Stack pane not found.' };
    }
    const pane = getFirstPane(stackNode);
    if (!pane) {
      return { ok: false, errorCode: 'not_found', message: 'Stack pane is empty.' };
    }
    return { ok: true, pane, workspaceId: workspace.id };
  }

  if (selector.type === 'pane') {
    if (workspaceId !== undefined) {
      const workspace = resolveWorkspace(workspaceId);
      if (!workspace) {
        return { ok: false, errorCode: 'not_found', message: 'Workspace not found.' };
      }
      const pane = findInWorkspace(workspace, (p) => p.id === selector.id);
      if (!pane) {
        return { ok: false, errorCode: 'not_found', message: 'Pane not found.' };
      }
      return { ok: true, pane, workspaceId: workspace.id };
    }

    const matches = searchAcrossWorkspaces((p) => p.id === selector.id);
    if (matches.length === 0) {
      return { ok: false, errorCode: 'not_found', message: 'Pane not found.' };
    }
    if (matches.length > 1) {
      return { ok: false, errorCode: 'ambiguous', message: 'Pane id matches multiple workspaces.' };
    }
    return { ok: true, pane: matches[0].pane, workspaceId: matches[0].workspaceId };
  }

  if (selector.type === 'pty') {
    const predicate = (p: PaneData) => p.ptyId === selector.id;
    if (workspaceId !== undefined) {
      const workspace = resolveWorkspace(workspaceId);
      if (!workspace) {
        return { ok: false, errorCode: 'not_found', message: 'Workspace not found.' };
      }
      const pane = findInWorkspace(workspace, predicate);
      if (!pane) {
        return { ok: false, errorCode: 'not_found', message: 'PTY not found in workspace.' };
      }
      return { ok: true, pane, workspaceId: workspace.id };
    }

    const matches = searchAcrossWorkspaces(predicate);
    if (matches.length === 0) {
      return { ok: false, errorCode: 'not_found', message: 'PTY not found.' };
    }
    if (matches.length > 1) {
      return { ok: false, errorCode: 'ambiguous', message: 'PTY id matches multiple panes.' };
    }
    return { ok: true, pane: matches[0].pane, workspaceId: matches[0].workspaceId };
  }

  return { ok: false, errorCode: 'not_found', message: 'Pane not found.' };
}
