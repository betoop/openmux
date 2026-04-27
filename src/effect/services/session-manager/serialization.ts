/**
 * Serialization helpers for SessionManager
 * Migrated from Effect to errore - uses plain functions
 */

import * as errore from 'errore';
import type { WorkspaceLayoutNode, WorkspaceState } from './types';
import type { SessionMetadata } from '../../models';
import type { SerializedSession, SerializedWorkspace, SerializedLayoutNode } from '../../models';
import { PtyCwdError } from '../../errors';
import { makeWorkspaceId } from '../../types';
import { repairLikelyTrailingPercentCwd } from '../../../core/cwd-utils';

function isSplitNode(
  node: WorkspaceLayoutNode
): node is Extract<WorkspaceLayoutNode, { type: 'split' }> {
  return (node as { type?: string }).type === 'split';
}

type WorkspacePaneNode = Exclude<WorkspaceLayoutNode, { type: 'split' }>;

function forEachPane(
  node: WorkspaceLayoutNode | null,
  visit: (pane: WorkspacePaneNode) => void
): void {
  if (!node) return;
  if (isSplitNode(node)) {
    forEachPane(node.first, visit);
    forEachPane(node.second, visit);
    return;
  }
  visit(node as WorkspacePaneNode);
}

function serializeLayoutNode(
  node: WorkspaceLayoutNode,
  cwdMap: Map<string, string>,
  fallbackCwd: string
): SerializedLayoutNode {
  if (isSplitNode(node)) {
    return {
      type: 'split',
      id: node.id,
      direction: node.direction,
      ratio: node.ratio,
      first: serializeLayoutNode(node.first, cwdMap, fallbackCwd),
      second: serializeLayoutNode(node.second, cwdMap, fallbackCwd),
    };
  }

  const pane = node as WorkspacePaneNode & { cwd?: string };
  const ptyCwd = pane.ptyId ? cwdMap.get(pane.ptyId) : undefined;
  const resolvedCwd = ptyCwd ?? pane.cwd ?? fallbackCwd;

  return {
    id: pane.id,
    title: pane.title,
    cwd: resolvedCwd,
  };
}

/**
 * Extract auto-name from path (last directory component)
 */
export function getAutoName(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'untitled';
}

/**
 * Collect all CWDs from workspaces
 * Returns a map of ptyId -> cwd
 */
export async function collectCwdMap(
  workspaces: ReadonlyMap<number, WorkspaceState>,
  getCwd: (ptyId: string) => Promise<string>
): Promise<Map<string, string>> {
  const fallbackCwd = process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();
  const ptyIds = new Set<string>();

  for (const workspace of workspaces.values()) {
    const panes: WorkspacePaneNode[] = [];
    forEachPane(workspace.mainPane, (pane) => panes.push(pane));
    for (const node of workspace.stackPanes) {
      forEachPane(node, (pane) => panes.push(pane));
    }

    for (const pane of panes) {
      if (pane.ptyId) {
        ptyIds.add(pane.ptyId);
      }
    }
  }

  const entries = await Promise.all(
    [...ptyIds].map(async (ptyId) => {
      const cwdResult = await errore.tryAsync<string, PtyCwdError>({
        try: () => getCwd(ptyId),
        catch: (e) => new PtyCwdError({ ptyId, reason: String(e), cause: e }),
      });
      const cwd = cwdResult instanceof PtyCwdError ? fallbackCwd : cwdResult;
      return [ptyId, repairLikelyTrailingPercentCwd(cwd)] as const;
    })
  );

  return new Map(entries);
}

/**
 * Serialize a single workspace to SerializedWorkspace format
 */
export function serializeWorkspace(
  id: number,
  workspace: WorkspaceState,
  cwdMap: Map<string, string>
): SerializedWorkspace | null {
  const hasLabel = Boolean(workspace.label?.trim());
  const hasPanes = Boolean(workspace.mainPane) || workspace.stackPanes.length > 0;

  // Only serialize workspaces with panes or labels
  if (!hasPanes && !hasLabel) {
    return null;
  }

  const panes: WorkspacePaneNode[] = [];
  forEachPane(workspace.mainPane, (pane) => panes.push(pane));
  for (const node of workspace.stackPanes) {
    forEachPane(node, (pane) => panes.push(pane));
  }

  const focusedPane = workspace.focusedPaneId
    ? panes.find((pane) => pane.id === workspace.focusedPaneId)
    : undefined;
  const focusedCwd = focusedPane?.ptyId ? cwdMap.get(focusedPane.ptyId) : undefined;
  let firstPaneCwd: string | undefined;
  for (const pane of panes) {
    if (!pane.ptyId) continue;
    const cwd = cwdMap.get(pane.ptyId);
    if (cwd) {
      firstPaneCwd = cwd;
      break;
    }
  }

  const fallbackCwd =
    focusedCwd ?? firstPaneCwd ?? process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd();

  const mainPane = workspace.mainPane
    ? serializeLayoutNode(workspace.mainPane, cwdMap, fallbackCwd)
    : null;
  const stackPanes = workspace.stackPanes.map((pane) =>
    serializeLayoutNode(pane, cwdMap, fallbackCwd)
  );

  return {
    id: makeWorkspaceId(id),
    label: workspace.label,
    mainPane,
    stackPanes,
    focusedPaneId: focusedPane?.id ?? null,
    activeStackIndex: workspace.activeStackIndex,
    lastFocusedPaneIds: workspace.lastFocusedPaneIds ?? [],
    layoutMode: workspace.layoutMode,
    zoomed: workspace.zoomed,
  };
}

/**
 * Serialize all workspaces to a SerializedSession
 */
export function serializeSession(
  metadata: SessionMetadata,
  workspaces: ReadonlyMap<number, WorkspaceState>,
  activeWorkspaceId: number,
  cwdMap: Map<string, string>
): SerializedSession {
  const serializedWorkspaces: SerializedWorkspace[] = [];

  for (const [id, workspace] of workspaces) {
    const serialized = serializeWorkspace(id, workspace, cwdMap);
    if (serialized) {
      serializedWorkspaces.push(serialized);
    }
  }

  const activeId = makeWorkspaceId(activeWorkspaceId);
  const resolvedActiveId = serializedWorkspaces.some((ws) => ws.id === activeId)
    ? activeId
    : (serializedWorkspaces[0]?.id ?? activeId);

  return {
    metadata,
    workspaces: serializedWorkspaces,
    activeWorkspaceId: resolvedActiveId,
  };
}
