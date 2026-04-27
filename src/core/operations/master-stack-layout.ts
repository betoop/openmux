/**
 * Master-stack layout calculation (Zellij-style)
 *
 * Layout modes:
 * - vertical: main pane left (50%), stack panes split vertically on right
 * - horizontal: main pane top (50%), stack panes split horizontally on bottom
 * - stacked: main pane left (50%), stack panes tabbed on right (only active visible)
 */

import type {
  Rectangle,
  Workspace,
  PaneData,
  LayoutMode,
  LayoutNode,
  SplitDirection,
} from '../types';
import type { LayoutConfig } from '../config';
import { collectPanes, containsPane, findPane, isSplitNode } from '../layout-tree';

/**
 * Check if two rectangles are equal (structural equality)
 * Used to avoid creating new pane objects when rectangle hasn't changed
 */
function rectanglesEqual(a: Rectangle | undefined, b: Rectangle | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

/**
 * Update pane rectangle only if it changed.
 *
 * Returning the original pane object is the first piece of the structural sharing
 * optimization: unchanged leaves keep their identity, which lets unchanged parent
 * splits and the workspace root stay referentially stable too.
 */
function updatePaneRectangle(pane: PaneData, newRect: Rectangle | undefined): PaneData {
  if (rectanglesEqual(pane.rectangle, newRect)) {
    return pane;
  }
  return { ...pane, rectangle: newRect ? { ...newRect } : undefined };
}

function calculateScratchRectangle(viewport: Rectangle): Rectangle {
  const width = Math.min(viewport.width, Math.max(24, Math.floor(viewport.width * 0.8)));
  const height = Math.min(viewport.height, Math.max(8, Math.floor(viewport.height * 0.7)));

  return {
    x: viewport.x + Math.floor((viewport.width - width) / 2),
    y: viewport.y + Math.floor((viewport.height - height) / 2),
    width,
    height,
  };
}

function updateScratchPaneRectangle(workspace: Workspace, viewport: Rectangle): Workspace {
  if (!workspace.scratchPane) return workspace;

  const rect = workspace.scratchVisible ? calculateScratchRectangle(viewport) : undefined;
  const scratchPane = updatePaneRectangle(workspace.scratchPane, rect);
  if (scratchPane === workspace.scratchPane) return workspace;

  return { ...workspace, scratchPane };
}

/**
 * Recalculate rectangles while preserving structural sharing.
 *
 * This is a hot path during focus changes, zoom toggles, and resize handling. The
 * recursive calls update children first, then return the original split node when
 * both child references and the split rectangle are unchanged. That keeps large
 * unchanged subtrees referentially stable instead of cloning the whole tree on
 * every layout pass.
 */
function updateLayoutNodeRectangles(
  node: LayoutNode,
  rect: Rectangle | undefined,
  gap: number
): LayoutNode {
  if (!isSplitNode(node)) {
    return updatePaneRectangle(node, rect);
  }

  if (!rect) {
    const updatedFirst = updateLayoutNodeRectangles(node.first, undefined, gap);
    const updatedSecond = updateLayoutNodeRectangles(node.second, undefined, gap);
    if (!node.rectangle && updatedFirst === node.first && updatedSecond === node.second) {
      return node;
    }
    return {
      ...node,
      rectangle: undefined,
      first: updatedFirst,
      second: updatedSecond,
    };
  }

  const { firstRect, secondRect } = splitRectangle(rect, node.direction, node.ratio, gap);
  const updatedFirst = updateLayoutNodeRectangles(node.first, firstRect, gap);
  const updatedSecond = updateLayoutNodeRectangles(node.second, secondRect, gap);
  const rectChanged = !rectanglesEqual(node.rectangle, rect);

  if (!rectChanged && updatedFirst === node.first && updatedSecond === node.second) {
    return node;
  }

  return {
    ...node,
    rectangle: rect ? { ...rect } : undefined,
    first: updatedFirst,
    second: updatedSecond,
  };
}

/**
 * Update layout node for zoom: give only the focused pane the full rect,
 * all other panes get undefined (hidden).
 * This ensures zoom works correctly with split panes.
 */
function updateLayoutNodeForZoom(
  node: LayoutNode,
  focusedPaneId: string,
  rect: Rectangle,
  gap: number
): LayoutNode {
  if (!isSplitNode(node)) {
    // Leaf node: give rect only to focused pane
    return updatePaneRectangle(node, node.id === focusedPaneId ? rect : undefined);
  }

  // Split node: check which branch contains the focused pane
  const focusedInFirst = containsPane(node.first, focusedPaneId);
  const focusedInSecond = containsPane(node.second, focusedPaneId);

  let updatedFirst: LayoutNode;
  let updatedSecond: LayoutNode;

  if (focusedInFirst) {
    // Focused pane is in first branch: give it the full rect, hide second
    updatedFirst = updateLayoutNodeForZoom(node.first, focusedPaneId, rect, gap);
    updatedSecond = updateLayoutNodeRectangles(node.second, undefined, gap);
  } else if (focusedInSecond) {
    // Focused pane is in second branch: hide first, give rect to second
    updatedFirst = updateLayoutNodeRectangles(node.first, undefined, gap);
    updatedSecond = updateLayoutNodeForZoom(node.second, focusedPaneId, rect, gap);
  } else {
    // Focused pane not in this subtree: hide entire subtree
    updatedFirst = updateLayoutNodeRectangles(node.first, undefined, gap);
    updatedSecond = updateLayoutNodeRectangles(node.second, undefined, gap);
  }

  if (updatedFirst === node.first && updatedSecond === node.second && !node.rectangle) {
    return node;
  }

  return {
    ...node,
    rectangle: undefined, // Split container is hidden when zoomed
    first: updatedFirst,
    second: updatedSecond,
  };
}

function splitRectangle(
  rect: Rectangle,
  direction: SplitDirection,
  ratio: number,
  gap: number
): { firstRect: Rectangle; secondRect: Rectangle } {
  if (direction === 'vertical') {
    const firstWidth = Math.max(1, Math.floor((rect.width - gap) * ratio));
    const secondWidth = Math.max(1, rect.width - firstWidth - gap);
    return {
      firstRect: { x: rect.x, y: rect.y, width: firstWidth, height: rect.height },
      secondRect: {
        x: rect.x + firstWidth + gap,
        y: rect.y,
        width: secondWidth,
        height: rect.height,
      },
    };
  }

  const firstHeight = Math.max(1, Math.floor((rect.height - gap) * ratio));
  const secondHeight = Math.max(1, rect.height - firstHeight - gap);
  return {
    firstRect: { x: rect.x, y: rect.y, width: rect.width, height: firstHeight },
    secondRect: {
      x: rect.x,
      y: rect.y + firstHeight + gap,
      width: rect.width,
      height: secondHeight,
    },
  };
}

/**
 * Calculate rectangles for all panes in a workspace
 */
export function calculateMasterStackLayout(
  workspace: Workspace,
  viewport: Rectangle,
  config: LayoutConfig
): Workspace {
  const padding = config.outerPadding;
  const paddedViewport: Rectangle = {
    x: viewport.x + padding.left,
    y: viewport.y + padding.top,
    width: Math.max(1, viewport.width - padding.left - padding.right),
    height: Math.max(1, viewport.height - padding.top - padding.bottom),
  };
  const gap = config.windowGap;
  const workspaceWithScratch = updateScratchPaneRectangle(workspace, paddedViewport);
  const { mainPane, stackPanes, layoutMode, zoomed, focusedPaneId } = workspaceWithScratch;

  // No panes - nothing to calculate
  if (!mainPane) {
    return workspaceWithScratch;
  }

  // Zoomed mode - focused pane takes full viewport
  // Use updateLayoutNodeForZoom to ensure only the focused pane gets the rect,
  // even when it's inside a split (layout tree)
  if (zoomed && focusedPaneId) {
    const focusedIsMain = containsPane(mainPane, focusedPaneId);
    const focusedStackIndex = stackPanes.findIndex((p) => containsPane(p, focusedPaneId));

    if (focusedIsMain) {
      // Give full viewport to only the focused pane within mainPane tree
      const updatedMain = updateLayoutNodeForZoom(mainPane, focusedPaneId, paddedViewport, gap);
      const updatedStack = stackPanes.map((p) => updateLayoutNodeRectangles(p, undefined, gap));
      if (updatedMain === mainPane && updatedStack.every((p, i) => p === stackPanes[i])) {
        return workspaceWithScratch;
      }
      return { ...workspaceWithScratch, mainPane: updatedMain, stackPanes: updatedStack };
    }

    if (focusedStackIndex >= 0) {
      const updatedMain = updateLayoutNodeRectangles(mainPane, undefined, gap);
      // Give full viewport to only the focused pane within the stack entry tree
      const updatedStack = stackPanes.map((p, i) =>
        i === focusedStackIndex
          ? updateLayoutNodeForZoom(p, focusedPaneId, paddedViewport, gap)
          : updateLayoutNodeRectangles(p, undefined, gap)
      );
      if (updatedMain === mainPane && updatedStack.every((p, i) => p === stackPanes[i])) {
        return workspaceWithScratch;
      }
      return { ...workspaceWithScratch, mainPane: updatedMain, stackPanes: updatedStack };
    }
  }

  // Single pane - takes full viewport
  if (stackPanes.length === 0) {
    const updatedMain = updateLayoutNodeRectangles(mainPane, paddedViewport, gap);
    if (updatedMain === mainPane) return workspaceWithScratch;
    return { ...workspaceWithScratch, mainPane: updatedMain };
  }

  // Multiple panes - split based on layout mode
  const mainRatio = config.defaultSplitRatio;

  let mainRect: Rectangle;
  let stackArea: Rectangle;

  if (layoutMode === 'vertical' || layoutMode === 'stacked') {
    // Main on left, stack on right
    const mainWidth = Math.floor((paddedViewport.width - gap) * mainRatio);
    const stackWidth = paddedViewport.width - mainWidth - gap;

    mainRect = {
      x: paddedViewport.x,
      y: paddedViewport.y,
      width: mainWidth,
      height: paddedViewport.height,
    };

    stackArea = {
      x: paddedViewport.x + mainWidth + gap,
      y: paddedViewport.y,
      width: stackWidth,
      height: paddedViewport.height,
    };
  } else {
    // Horizontal: main on top, stack on bottom
    const mainHeight = Math.floor((paddedViewport.height - gap) * mainRatio);
    const stackHeight = paddedViewport.height - mainHeight - gap;

    mainRect = {
      x: paddedViewport.x,
      y: paddedViewport.y,
      width: paddedViewport.width,
      height: mainHeight,
    };

    stackArea = {
      x: paddedViewport.x,
      y: paddedViewport.y + mainHeight + gap,
      width: paddedViewport.width,
      height: stackHeight,
    };
  }

  // Calculate stack pane rectangles with structural sharing
  const updatedStackPanes = calculateStackPaneRectangles(
    stackPanes,
    stackArea,
    layoutMode,
    workspace.activeStackIndex,
    gap
  );

  // Update main pane with structural sharing
  const updatedMain = updateLayoutNodeRectangles(mainPane, mainRect, gap);

  // Only create new workspace if something changed
  const stackChanged = updatedStackPanes.some((p, i) => p !== stackPanes[i]);
  if (updatedMain === mainPane && !stackChanged) {
    return workspaceWithScratch;
  }

  return {
    ...workspaceWithScratch,
    mainPane: updatedMain,
    stackPanes: stackChanged ? updatedStackPanes : stackPanes,
  };
}

/**
 * Calculate rectangles for stack panes (with structural sharing)
 */
function calculateStackPaneRectangles(
  stackPanes: LayoutNode[],
  stackArea: Rectangle,
  layoutMode: LayoutMode,
  activeStackIndex: number,
  gap: number
): LayoutNode[] {
  if (stackPanes.length === 0) return stackPanes;

  if (layoutMode === 'stacked') {
    // All panes take full stack area minus 1 row for tab bar (only active one is visible)
    // Tab bar occupies the first row of stackArea, pane content starts at y+1
    const stackedRect: Rectangle = {
      x: stackArea.x,
      y: stackArea.y + 1,
      width: stackArea.width,
      height: Math.max(1, stackArea.height - 1),
    };
    return stackPanes.map((pane, index) =>
      updateLayoutNodeRectangles(pane, index === activeStackIndex ? stackedRect : undefined, gap)
    );
  }

  if (layoutMode === 'vertical') {
    // Stack panes split vertically (equal height)
    const totalGaps = gap * (stackPanes.length - 1);
    const availableHeight = stackArea.height - totalGaps;
    const paneHeight = Math.floor(availableHeight / stackPanes.length);

    return stackPanes.map((pane, index) => {
      const isLast = index === stackPanes.length - 1;
      // Last pane gets remaining height to avoid rounding issues
      const height = isLast ? stackArea.height - (paneHeight + gap) * index : paneHeight;

      const rect: Rectangle = {
        x: stackArea.x,
        y: stackArea.y + (paneHeight + gap) * index,
        width: stackArea.width,
        height,
      };
      return updateLayoutNodeRectangles(pane, rect, gap);
    });
  }

  // Horizontal: stack panes split horizontally (equal width)
  const totalGaps = gap * (stackPanes.length - 1);
  const availableWidth = stackArea.width - totalGaps;
  const paneWidth = Math.floor(availableWidth / stackPanes.length);

  return stackPanes.map((pane, index) => {
    const isLast = index === stackPanes.length - 1;
    // Last pane gets remaining width to avoid rounding issues
    const width = isLast ? stackArea.width - (paneWidth + gap) * index : paneWidth;

    const rect: Rectangle = {
      x: stackArea.x + (paneWidth + gap) * index,
      y: stackArea.y,
      width,
      height: stackArea.height,
    };
    return updateLayoutNodeRectangles(pane, rect, gap);
  });
}

/**
 * Get all panes in a workspace as a flat array
 */
export function getAllWorkspacePanes(workspace: Workspace): PaneData[] {
  const panes: PaneData[] = [];
  if (workspace.mainPane) {
    collectPanes(workspace.mainPane, panes);
  }
  for (const pane of workspace.stackPanes) {
    collectPanes(pane, panes);
  }
  if (workspace.scratchVisible && workspace.scratchPane) {
    panes.push(workspace.scratchPane);
  }
  return panes;
}

/**
 * Get total pane count in a workspace
 */
export function getWorkspacePaneCount(workspace: Workspace): number {
  return getAllWorkspacePanes(workspace).length;
}

/**
 * Find a pane by ID in a workspace
 */
export function findPaneInWorkspace(workspace: Workspace, paneId: string): PaneData | null {
  if (workspace.mainPane) {
    const mainPane = findPane(workspace.mainPane, paneId);
    if (mainPane) return mainPane;
  }
  for (const pane of workspace.stackPanes) {
    const found = findPane(pane, paneId);
    if (found) return found;
  }
  return null;
}
