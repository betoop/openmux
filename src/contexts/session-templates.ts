/**
 * Template-related helpers for session context.
 */

import type { Workspaces } from '../core/operations/layout-actions';
import type { LayoutMode, WorkspaceId, LayoutNode, PaneData } from '../core/types';
import { normalizeTemplateId } from '../core/template-utils';
import { isSplitNode } from '../core/layout-tree';
import { makeWorkspaceId } from '../effect/types';
import {
  type TemplateSession,
  type TemplateWorkspace,
  type TemplatePaneData,
  type TemplateLayoutNode,
  createTemplateLayoutSplit,
  createTemplateLayoutPane,
  createTemplateWorkspace,
  createTemplatePaneData,
  createTemplateDefaults,
  createTemplateSession,
  createTemplateWorkspaceLayout,
} from '../effect/models';
import { buildLayoutFromTemplate } from '../effect/bridge';

export type LayoutSnapshot = TemplateSession & {
  activeWorkspaceId?: WorkspaceId;
};

export function isLayoutEmpty(workspaces: Workspaces): boolean {
  return Object.values(workspaces).every(
    (workspace) => !workspace || (!workspace.mainPane && workspace.stackPanes.length === 0)
  );
}

function normalizeCommand(
  command: string | undefined,
  shellPath: string,
  shellName: string | null | undefined
): string | undefined {
  if (!command) return undefined;
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes('defunct')) return undefined;
  if (shellName && trimmed === shellName) return undefined;
  if (shellPath && trimmed === shellPath) return undefined;
  return trimmed;
}

const SHELL_BUILTINS = new Set([
  '.',
  'alias',
  'bg',
  'break',
  'cd',
  'clear',
  'continue',
  'disown',
  'eval',
  'exec',
  'exit',
  'export',
  'fg',
  'hash',
  'history',
  'jobs',
  'logout',
  'pwd',
  'read',
  'reset',
  'return',
  'set',
  'shift',
  'source',
  'test',
  'trap',
  'type',
  'ulimit',
  'umask',
  'unalias',
  'unset',
  '[',
  ']',
]);

function getCommandToken(command: string): string {
  const trimmed = command.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

function isTrivialShellCommand(command: string): boolean {
  const token = getCommandToken(command);
  if (!token) return true;
  const base = token.split('/').pop() ?? token;
  return SHELL_BUILTINS.has(base);
}

function commandMatchesProcess(command: string, processName: string): boolean {
  const token = getCommandToken(command);
  if (!token) return false;
  if (token === processName) return true;
  const base = token.split('/').pop() ?? token;
  return base === processName;
}

function pickTemplateCommand(
  lastCommand: string | undefined,
  processName: string | undefined
): string | undefined {
  if (lastCommand && !isTrivialShellCommand(lastCommand)) {
    if (!processName || commandMatchesProcess(lastCommand, processName)) {
      return lastCommand;
    }
  }
  return processName;
}

export async function buildTemplateFromWorkspaces(params: {
  name: string;
  workspaces: Workspaces;
  getCwd: (ptyId: string) => Promise<string>;
  getForegroundProcess: (ptyId: string) => Promise<string | undefined>;
  getLastCommand: (ptyId: string) => Promise<string | undefined>;
  defaultLayoutMode: LayoutMode;
  fallbackCwd: string;
  now?: number;
  shellPath?: string;
}): Promise<{ template: TemplateSession; templateId: string } | null> {
  const workspaceEntries = Object.entries(params.workspaces)
    .map(([idStr, workspace]) => ({ id: Number(idStr), workspace }))
    .filter(({ workspace }) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0))
    .sort((a, b) => a.id - b.id);

  if (workspaceEntries.length === 0) {
    return null;
  }

  const now = params.now ?? Date.now();
  const normalizedId = normalizeTemplateId(params.name);
  const templateId = normalizedId ?? `template-${now}`;

  const templateWorkspaces: TemplateWorkspace[] = [];
  let maxPaneCount = 1;
  let unifiedCwd: string | null = null;
  let cwdIsUniform = true;
  const shellPath = params.shellPath ?? '';
  const shellName = shellPath ? shellPath.split('/').pop() : null;

  const resolvePaneMetadata = async (pane: PaneData) => {
    let cwd = params.fallbackCwd;
    let command: string | undefined;
    if (pane.ptyId) {
      const cwdResult = await params.getCwd(pane.ptyId).catch((cause) => {
        console.warn('[session-templates] Failed to get CWD:', cause);
        return params.fallbackCwd;
      });
      cwd = typeof cwdResult === 'string' ? cwdResult : params.fallbackCwd;

      const lastCommand = await params.getLastCommand(pane.ptyId).catch((cause) => {
        console.warn('[session-templates] Failed to get last command:', cause);
        return undefined;
      });

      const processName = await params.getForegroundProcess(pane.ptyId).catch((cause) => {
        console.warn('[session-templates] Failed to get foreground process:', cause);
        return undefined;
      });

      const normalizedLast = normalizeCommand(lastCommand, shellPath, shellName);
      const normalizedProcess = normalizeCommand(processName, shellPath, shellName);
      command = pickTemplateCommand(normalizedLast, normalizedProcess);
    }
    return {
      cwd,
      command,
    };
  };

  const buildLayoutNode = async (
    node: LayoutNode,
    leafMetadata: Array<{ cwd: string; command?: string }>
  ): Promise<TemplateLayoutNode> => {
    if (isSplitNode(node)) {
      const first = await buildLayoutNode(node.first, leafMetadata);
      const second = await buildLayoutNode(node.second, leafMetadata);
      return createTemplateLayoutSplit({
        direction: node.direction,
        ratio: node.ratio,
        first,
        second,
      });
    }

    const metadata = await resolvePaneMetadata(node);
    leafMetadata.push(metadata);
    return createTemplateLayoutPane({
      cwd: metadata.cwd,
      command: metadata.command,
    });
  };

  for (const entry of workspaceEntries) {
    const workspace = entry.workspace;
    if (!workspace) continue;
    const workspaceId = makeWorkspaceId(entry.id);
    const panes: TemplatePaneData[] = [];
    const leafMetadata: Array<{ cwd: string; command?: string }> = [];

    const mainLayout = workspace.mainPane
      ? await buildLayoutNode(workspace.mainPane, leafMetadata)
      : null;
    const stackLayout: TemplateLayoutNode[] = [];
    for (const pane of workspace.stackPanes) {
      stackLayout.push(await buildLayoutNode(pane, leafMetadata));
    }

    for (const [index, metadata] of leafMetadata.entries()) {
      panes.push(
        createTemplatePaneData({
          role: index === 0 ? 'main' : 'stack',
          cwd: metadata.cwd,
          command: metadata.command,
        })
      );
      if (!unifiedCwd) {
        unifiedCwd = metadata.cwd;
      } else if (unifiedCwd !== metadata.cwd) {
        cwdIsUniform = false;
      }
    }

    maxPaneCount = Math.max(maxPaneCount, leafMetadata.length);

    templateWorkspaces.push(
      createTemplateWorkspace({
        id: workspaceId,
        label: workspace.label,
        layoutMode: workspace.layoutMode,
        panes,
        layout: createTemplateWorkspaceLayout({
          main: mainLayout,
          stack: stackLayout,
        }),
      })
    );
  }

  const defaults = createTemplateDefaults({
    workspaceCount: Math.min(9, Math.max(1, workspaceEntries.length)),
    paneCount: maxPaneCount,
    layoutMode: params.defaultLayoutMode,
    cwd: cwdIsUniform && unifiedCwd ? unifiedCwd : undefined,
  });

  const template = createTemplateSession({
    id: templateId,
    name: params.name,
    createdAt: now,
    updatedAt: now,
    defaults,
    workspaces: templateWorkspaces,
  });

  return { template, templateId };
}

export async function applyTemplateToSession(params: {
  template: TemplateSession | LayoutSnapshot;
  activeSessionId: string | null;
  activeWorkspaceId?: WorkspaceId;
  resetLayoutForTemplate: () => Promise<void>;
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string,
    options?: { allowPrune?: boolean }
  ) => Promise<void>;
}): Promise<void> {
  if (!params.activeSessionId) return;

  await params.resetLayoutForTemplate();
  const layout = buildLayoutFromTemplate(params.template);
  const requestedActiveWorkspaceId =
    params.activeWorkspaceId ??
    ('activeWorkspaceId' in params.template ? params.template.activeWorkspaceId : undefined);
  const activeWorkspaceId =
    requestedActiveWorkspaceId && layout.workspaces[requestedActiveWorkspaceId]
      ? requestedActiveWorkspaceId
      : layout.activeWorkspaceId;
  await params.onSessionLoad(
    layout.workspaces,
    activeWorkspaceId,
    layout.cwdMap,
    layout.commandMap,
    params.activeSessionId,
    { allowPrune: false }
  );
}
