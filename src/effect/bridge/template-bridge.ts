/**
 * Template bridge functions (errore version)
 *
 * Wraps TemplateStorage service for async/await usage.
 */

import type {
  TemplateSession,
  TemplateWorkspace,
  TemplatePaneData,
  TemplateLayoutNode,
  TemplateWorkspaceLayout,
} from '../models';
import type { Workspaces } from '../../core/operations/layout-actions';
import type { Workspace, PaneData, WorkspaceId, LayoutNode } from '../../core/types';
import { getFirstPane } from '../../core/layout-tree';
import { getTemplateStorage } from './services-instance';
import {
  createWorkspace,
  generatePaneId,
  generateSplitId,
  resetPaneIdCounter,
  resetSplitIdCounter,
} from '../../core/operations/layout-actions/helpers';
import type { TemplateStorageError } from '../errors';

/** List all templates */
export async function listTemplates(): Promise<TemplateSession[]> {
  const storage = getTemplateStorage();
  const result = await storage.listTemplates();
  if (result instanceof Error) return [];

  const metadata = result;
  const templates: TemplateSession[] = [];

  for (const m of metadata) {
    const template = await storage.loadTemplate(m.id);
    if (template && !(template instanceof Error)) {
      templates.push(template);
    }
  }

  return templates;
}

/** Save a template */
export async function saveTemplate(
  template: TemplateSession
): Promise<void | TemplateStorageError> {
  const storage = getTemplateStorage();
  const result = await storage.saveTemplate(template);
  if (result instanceof Error) return result as TemplateStorageError;
}

/** Delete a template */
export async function deleteTemplate(id: string): Promise<void | TemplateStorageError> {
  const storage = getTemplateStorage();
  const result = await storage.deleteTemplate(id);
  if (result instanceof Error) return result as TemplateStorageError;
}

/** Load a template */
export async function loadTemplate(id: string): Promise<TemplateSession | null> {
  const storage = getTemplateStorage();
  const result = await storage.loadTemplate(id);
  if (result instanceof Error) return null;
  return result;
}

function normalizeTemplatePanes(
  panes: TemplatePaneData[],
  defaultCwd?: string
): TemplatePaneData[] {
  if (panes.length === 0) {
    return [{ role: 'main', cwd: defaultCwd }];
  }

  const mainIndex = panes.findIndex((pane) => pane.role === 'main');
  if (mainIndex === -1) {
    return [{ role: 'main', cwd: defaultCwd }, ...panes];
  }

  const [main] = panes.splice(mainIndex, 1);
  return [main, ...panes.map((pane) => ({ ...pane, role: 'stack' as const }))];
}

function buildDefaultPanes(paneCount: number, defaultCwd?: string): TemplatePaneData[] {
  const count = Math.max(1, paneCount);
  return [
    { role: 'main', cwd: defaultCwd },
    ...Array.from({ length: count - 1 }, () => ({ role: 'stack' as const, cwd: defaultCwd })),
  ];
}

function resolveWorkspacePanes(
  workspace: TemplateWorkspace | undefined,
  paneCount: number,
  defaultCwd?: string
): TemplatePaneData[] {
  const panes = workspace?.panes ?? [];
  if (panes.length > 0) {
    return normalizeTemplatePanes([...panes], defaultCwd);
  }
  return buildDefaultPanes(paneCount, defaultCwd);
}

function buildLayoutNodeFromTemplate(
  node: TemplateLayoutNode,
  cwdMap: Map<string, string>,
  commandMap: Map<string, string>,
  defaultCwd: string
): LayoutNode {
  if (node.type === 'split') {
    return {
      type: 'split',
      id: generateSplitId(),
      direction: node.direction,
      ratio: node.ratio,
      first: buildLayoutNodeFromTemplate(node.first, cwdMap, commandMap, defaultCwd),
      second: buildLayoutNodeFromTemplate(node.second, cwdMap, commandMap, defaultCwd),
    };
  }

  const paneId = generatePaneId();
  const pane: PaneData = {
    id: paneId,
    title: 'shell',
  };
  cwdMap.set(paneId, node.cwd ?? defaultCwd);
  if (node.command) {
    commandMap.set(paneId, node.command);
  }
  return pane;
}

function buildWorkspaceFromTemplateLayout(
  layout: TemplateWorkspaceLayout,
  cwdMap: Map<string, string>,
  commandMap: Map<string, string>,
  defaultCwd: string
): {
  mainPane: LayoutNode | null;
  stackPanes: LayoutNode[];
  focusedPaneId: string | null;
  activeStackIndex: number;
} {
  let mainLayout = layout.main;
  let stackLayouts = layout.stack;

  if (!mainLayout && stackLayouts.length > 0) {
    mainLayout = stackLayouts[0]!;
    stackLayouts = stackLayouts.slice(1);
  }

  const mainPane = mainLayout
    ? buildLayoutNodeFromTemplate(mainLayout, cwdMap, commandMap, defaultCwd)
    : null;
  const stackPanes = stackLayouts.map((node) =>
    buildLayoutNodeFromTemplate(node, cwdMap, commandMap, defaultCwd)
  );
  const focusedPane =
    getFirstPane(mainPane) ?? (stackPanes.length > 0 ? getFirstPane(stackPanes[0]!) : null);

  return {
    mainPane,
    stackPanes,
    focusedPaneId: focusedPane?.id ?? null,
    activeStackIndex: stackPanes.length > 0 ? 0 : 0,
  };
}

export function buildLayoutFromTemplate(template: TemplateSession): {
  workspaces: Workspaces;
  cwdMap: Map<string, string>;
  commandMap: Map<string, string>;
  activeWorkspaceId: WorkspaceId;
} {
  resetPaneIdCounter();
  resetSplitIdCounter();
  const cwdMap = new Map<string, string>();
  const commandMap = new Map<string, string>();
  const workspaces: Workspaces = {};
  const workspaceMap = new Map<number, TemplateWorkspace>();

  for (const workspace of template.workspaces) {
    workspaceMap.set(workspace.id, workspace);
  }

  const maxWorkspaceId = Math.max(
    template.defaults.workspaceCount,
    ...template.workspaces.map((ws) => ws.id),
    1
  );
  const totalWorkspaces = Math.min(9, maxWorkspaceId);

  for (let id = 1; id <= totalWorkspaces; id += 1) {
    const workspaceId = id as WorkspaceId;
    const templateWorkspace = workspaceMap.get(id);
    const layoutMode = templateWorkspace?.layoutMode ?? template.defaults.layoutMode;

    const workspace: Workspace = createWorkspace(workspaceId, layoutMode);
    workspace.label = templateWorkspace?.label;
    const paneDefaultsCwd = template.defaults.cwd ?? process.cwd();
    const templateLayout = templateWorkspace?.layout;
    if (templateLayout && (templateLayout.main !== null || templateLayout.stack.length > 0)) {
      const builtLayout = buildWorkspaceFromTemplateLayout(
        templateLayout,
        cwdMap,
        commandMap,
        paneDefaultsCwd
      );
      workspace.mainPane = builtLayout.mainPane;
      workspace.stackPanes = builtLayout.stackPanes;
      workspace.focusedPaneId = builtLayout.focusedPaneId;
      workspace.activeStackIndex = builtLayout.activeStackIndex;
      workspace.zoomed = false;
    } else {
      const panes = resolveWorkspacePanes(
        templateWorkspace,
        template.defaults.paneCount,
        template.defaults.cwd
      );
      const mainPaneData = panes[0];
      const mainPaneId = generatePaneId();
      workspace.mainPane = {
        id: mainPaneId,
        title: 'shell',
      } satisfies PaneData;
      cwdMap.set(mainPaneId, mainPaneData.cwd ?? paneDefaultsCwd);
      if (mainPaneData.command) {
        commandMap.set(mainPaneId, mainPaneData.command);
      }

      const stackPanes: PaneData[] = [];
      for (const pane of panes.slice(1)) {
        const paneId = generatePaneId();
        stackPanes.push({ id: paneId, title: 'shell' });
        cwdMap.set(paneId, pane.cwd ?? paneDefaultsCwd);
        if (pane.command) {
          commandMap.set(paneId, pane.command);
        }
      }

      workspace.stackPanes = stackPanes;
      workspace.focusedPaneId = mainPaneId;
      workspace.activeStackIndex = 0;
      workspace.zoomed = false;
    }

    workspaces[workspaceId] = workspace;
  }

  return {
    workspaces,
    cwdMap,
    commandMap,
    activeWorkspaceId: 1,
  };
}
