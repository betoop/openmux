/**
 * PaneContainer - renders master-stack layout panes
 */

import { Show, For, Index, createMemo, createEffect } from 'solid-js';
import type { PaneData, LayoutNode } from '../core/types';
import { useLayout } from '../contexts/LayoutContext';
import { useTerminal } from '../contexts/TerminalContext';
import { useSession } from '../contexts/SessionContext';
import { useAggregateView } from '../contexts/AggregateViewContext';
import { useTitle } from '../contexts/TitleContext';
import { useTheme } from '../contexts/ThemeContext';
import { useCopyMode } from '../contexts/copy-mode';
import { useKeyboard } from '../contexts/KeyboardContext';
import { getFocusedPane, isMainPaneFocused } from '../core/workspace-utils';
import { collectPanes, findPane, getFirstPane } from '../core/layout-tree';
import { Pane } from './Pane';

export function PaneContainer() {
  const layout = useLayout();
  const { focusPane } = layout;
  const { writeToPTY, isMouseTrackingEnabled } = useTerminal();
  const session = useSession();
  const { state: aggregateState } = useAggregateView();
  const theme = useTheme();
  const copyMode = useCopyMode();
  const keyboard = useKeyboard();
  const { exitCopyMode: keyboardExitCopyMode } = keyboard;

  // Memoize workspace properties to prevent cascading re-renders
  // Access layout.activeWorkspace once and derive stable values
  const workspace = () => layout.activeWorkspace;
  const mainPane = createMemo(() => workspace().mainPane);
  const stackPanes = createMemo(() => workspace().stackPanes);
  const focusedPaneId = createMemo(() => workspace().focusedPaneId);
  const layoutMode = createMemo(() => workspace().layoutMode);
  const isZoomed = createMemo(() => workspace().zoomed);
  const activeStackIndex = createMemo(() => workspace().activeStackIndex);
  const scratchPane = createMemo(() =>
    workspace().scratchVisible ? (workspace().scratchPane ?? null) : null
  );

  const mainPanes = createMemo(() => {
    const panes: PaneData[] = [];
    const root = mainPane();
    if (root) collectPanes(root, panes);
    return panes;
  });

  const visibleStackPanes = createMemo(() => {
    const panes: PaneData[] = [];
    if (layoutMode() === 'stacked') {
      const active = stackPanes()[activeStackIndex()];
      if (active) collectPanes(active, panes);
      // Filter out panes without valid rectangles to prevent race condition
      // where layout hasn't recalculated yet after activeStackIndex changes
      return panes.filter((p) => p.rectangle && p.rectangle.width > 0 && p.rectangle.height > 0);
    }
    for (const pane of stackPanes()) {
      collectPanes(pane, panes);
    }
    return panes;
  });

  const resolvePaneById = (paneId: string) => {
    return (
      findPane(mainPane(), paneId) ??
      stackPanes().reduce<PaneData | null>(
        (found, node) => found ?? findPane(node, paneId),
        null
      ) ??
      (scratchPane()?.id === paneId ? scratchPane() : null)
    );
  };

  const handlePaneClick = (paneId: string) => {
    const activeCopyPty = copyMode.getActivePtyId();
    if (activeCopyPty) {
      const targetPtyId = resolvePaneById(paneId)?.ptyId ?? null;
      if (targetPtyId !== activeCopyPty) {
        copyMode.exitCopyMode();
        keyboardExitCopyMode();
      }
    }
    focusPane(paneId);
  };

  createEffect(() => {
    const activeCopyPty = copyMode.getActivePtyId();
    if (!activeCopyPty) return;
    if (
      aggregateState.showAggregateView &&
      aggregateState.previewMode &&
      aggregateState.selectedPtyId === activeCopyPty
    ) {
      return;
    }
    const focusedId = focusedPaneId();
    const focusedPtyId = focusedId ? (resolvePaneById(focusedId)?.ptyId ?? null) : null;
    if (focusedPtyId !== activeCopyPty) {
      copyMode.exitCopyMode();
      keyboardExitCopyMode();
    }
  });

  const handleMouseInput = (ptyId: string, data: string) => {
    // Only forward mouse events if the child application has enabled mouse tracking
    // (via escape sequences like \x1b[?1000h)
    // Otherwise the shell will echo them as raw text
    if (isMouseTrackingEnabled(ptyId)) {
      writeToPTY(ptyId, data);
    }
  };

  // Don't show "No panes" message while session is switching or aggregate view is open (prevents bleed-through)
  const showNoPanesMessage = () =>
    mainPanes().length === 0 &&
    stackPanes().length === 0 &&
    !scratchPane() &&
    !session.state.switching &&
    !aggregateState.showAggregateView;

  return (
    <box style={{ flexGrow: 1, position: 'relative' }}>
      <Show
        when={mainPanes().length > 0 || stackPanes().length > 0 || scratchPane()}
        fallback={
          <Show when={showNoPanesMessage()}>
            <box
              style={{
                flexGrow: 1,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <text fg={theme.ui.mutedText}>
                No panes. Press Ctrl+b n or Alt+n to create a pane.
              </text>
            </box>
          </Show>
        }
      >
        <Show
          when={isZoomed()}
          fallback={
            <box
              style={{
                position: 'relative',
                flexGrow: 1,
              }}
            >
              {/* Render main panes */}
              <Index each={mainPanes()}>
                {(pane) => (
                  <PaneRenderer
                    pane={pane()}
                    isFocused={focusedPaneId() === pane().id}
                    isMain={true}
                    onFocus={handlePaneClick}
                    onMouseInput={handleMouseInput}
                  />
                )}
              </Index>

              {/* Render stack panes */}
              <Show
                when={layoutMode() === 'stacked'}
                fallback={
                  /* Use Index instead of For - tracks by position not reference.
                     This prevents component recreation when array reference changes
                     but individual panes stay the same (just their rectangles update) */
                  <Index each={visibleStackPanes()}>
                    {(pane) => (
                      <PaneRenderer
                        pane={pane()}
                        isFocused={focusedPaneId() === pane().id}
                        isMain={false}
                        onFocus={handlePaneClick}
                        onMouseInput={handleMouseInput}
                      />
                    )}
                  </Index>
                }
              >
                {/* Stacked mode: render tab headers and only the active stack entry */}
                <StackedPanesRenderer
                  stackPanes={stackPanes()}
                  activeStackIndex={activeStackIndex()}
                  focusedPaneId={focusedPaneId()}
                  onFocus={handlePaneClick}
                  onMouseInput={handleMouseInput}
                />
              </Show>
            </box>
          }
        >
          {/* When zoomed, only render the focused pane */}
          <ZoomedPaneRenderer
            workspace={workspace()}
            onFocus={handlePaneClick}
            onMouseInput={handleMouseInput}
          />
        </Show>
      </Show>
      <Show when={scratchPane()?.rectangle}>
        <PaneRenderer
          pane={scratchPane()!}
          isFocused={focusedPaneId() === scratchPane()?.id}
          isMain={false}
          onFocus={handlePaneClick}
          onMouseInput={handleMouseInput}
        />
      </Show>
    </box>
  );
}

// Zoomed pane helper component
interface ZoomedPaneRendererProps {
  workspace: ReturnType<typeof useLayout>['activeWorkspace'];
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function ZoomedPaneRenderer(props: ZoomedPaneRendererProps) {
  const focusedPane = () => getFocusedPane(props.workspace);

  return (
    <Show when={focusedPane()?.rectangle}>
      <box style={{ position: 'relative', flexGrow: 1 }}>
        <PaneRenderer
          pane={focusedPane()!}
          isFocused={true}
          isMain={isMainPaneFocused(props.workspace)}
          onFocus={props.onFocus}
          onMouseInput={props.onMouseInput}
        />
      </box>
    </Show>
  );
}

interface PaneRendererProps {
  pane: PaneData;
  isFocused: boolean;
  isMain: boolean;
  hideTitle?: boolean;
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function PaneRenderer(props: PaneRendererProps) {
  const rect = () => props.pane.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };

  const handleClick = () => {
    props.onFocus(props.pane.id);
  };

  const handleMouseInput = (data: string) => {
    if (props.pane.ptyId) {
      props.onMouseInput(props.pane.ptyId, data);
    }
  };

  return (
    <Pane
      id={props.pane.id}
      title={props.pane.title}
      isFocused={props.isFocused}
      x={rect().x}
      y={rect().y}
      width={rect().width}
      height={rect().height}
      ptyId={props.pane.ptyId}
      hideTitle={props.hideTitle}
      onClick={handleClick}
      onMouseInput={handleMouseInput}
    />
  );
}

interface StackedPanesRendererProps {
  stackPanes: LayoutNode[];
  activeStackIndex: number;
  focusedPaneId: string | null;
  onFocus: (paneId: string) => void;
  onMouseInput: (ptyId: string, data: string) => void;
}

function StackedPanesRenderer(props: StackedPanesRendererProps) {
  const theme = useTheme();
  const titleCtx = useTitle();
  const copyMode = useCopyMode();
  const activeEntry = () => props.stackPanes[props.activeStackIndex];
  const rect = () => activeEntry()?.rectangle ?? { x: 0, y: 0, width: 40, height: 12 };
  const activePanes = createMemo(() => {
    const entry = activeEntry();
    if (!entry) return [];
    const panes: PaneData[] = [];
    collectPanes(entry, panes);
    // Filter out panes without valid rectangles to prevent race condition
    // where layout recalculation hasn't completed after activeStackIndex changes
    return panes.filter((p) => p.rectangle && p.rectangle.width > 0 && p.rectangle.height > 0);
  });

  const handleTabClick = (paneId: string) => {
    props.onFocus(paneId);
  };

  // Calculate visible tabs based on scroll offset
  const visibleTabs = createMemo(() => {
    // SolidJS dependency tracking: read activeStackIndex before any conditional logic
    // to ensure the memo re-runs when the active tab changes. Accessing props inside
    // map() or after early returns can break reactivity.
    const currentActiveIndex = props.activeStackIndex;
    // Access titleVersion to create reactive dependency on title changes
    titleCtx.titleVersion();
    const visibleWidth = rect().width - 1; // Account for tab bar offset from pane edge

    // Build tab info with positions
    const tabItems = props.stackPanes.map((pane, index) => {
      const isActive = index === currentActiveIndex;
      const labelPane = props.focusedPaneId ? findPane(pane, props.focusedPaneId) : null;
      const fallbackPane = labelPane ?? getFirstPane(pane);
      const paneId = fallbackPane?.id ?? `stack-${index}`;
      const title = fallbackPane
        ? (titleCtx.getTitle(fallbackPane.id) ?? fallbackPane.title ?? 'pane')
        : 'pane';
      // Use consistent space padding for all tabs (background fill indicates active)
      const label = ` ${title} `;
      return { paneId, label, width: label.length, isActive, index };
    });

    let pos = 0;
    const tabsWithPos = tabItems.map((tab) => {
      const start = pos;
      pos += tab.width;
      return { ...tab, start, end: pos };
    });

    // Calculate scroll offset to keep active tab visible
    const activeTab = tabsWithPos[currentActiveIndex];
    let scrollOffset = 0;
    if (activeTab) {
      if (activeTab.end > visibleWidth) {
        scrollOffset = activeTab.end - visibleWidth;
      }
      if (activeTab.start < scrollOffset) {
        scrollOffset = activeTab.start;
      }
    }

    // Filter and trim tabs to fit visible area
    const result: Array<{ paneId: string; label: string; isActive: boolean }> = [];
    for (const tab of tabsWithPos) {
      const visibleStart = scrollOffset;
      const visibleEnd = scrollOffset + visibleWidth;

      // Skip tabs completely outside visible area
      if (tab.end <= visibleStart || tab.start >= visibleEnd) continue;

      // Calculate visible portion of this tab
      const labelStart = Math.max(0, visibleStart - tab.start);
      const labelEnd = Math.min(tab.width, visibleEnd - tab.start);
      const visibleLabel = tab.label.slice(labelStart, labelEnd);

      if (visibleLabel.length > 0) {
        result.push({ paneId: tab.paneId, label: visibleLabel, isActive: tab.isActive });
      }
    }

    // Calculate active tab's visual position for the connector
    const activeTabVisualX = activeTab ? Math.max(0, activeTab.start - scrollOffset) : 0;
    const activeTabVisualWidth = activeTab
      ? Math.min(activeTab.width, visibleWidth - activeTabVisualX)
      : 0;

    return { tabs: result, activeTabVisualX, activeTabVisualWidth };
  });

  // Extract just the tabs for rendering
  const tabs = () => visibleTabs().tabs;

  // Get active tab info for connector
  const activeTabInfo = () => {
    const { activeTabVisualX, activeTabVisualWidth } = visibleTabs();
    return activeTabVisualWidth > 0 ? { x: activeTabVisualX, width: activeTabVisualWidth } : null;
  };

  // Whether the stacked pane area is focused (vs main pane)
  const isPaneFocused = () => {
    const entry = activeEntry();
    if (!entry || !props.focusedPaneId) return false;
    return !!findPane(entry, props.focusedPaneId);
  };
  // Active tab background color based on focus state
  const activeTabBg = () => {
    if (!isPaneFocused()) return theme.pane.borderColor;
    const entry = activeEntry();
    const focusedPane = entry && props.focusedPaneId ? findPane(entry, props.focusedPaneId) : null;
    const focusedPtyId = focusedPane?.ptyId;
    if (focusedPtyId && copyMode.isActive(focusedPtyId)) {
      return theme.pane.copyModeBorderColor;
    }
    return theme.pane.focusedBorderColor;
  };

  return (
    <Show when={activeEntry()}>
      {/* Tab headers for stacked panes (positioned above the pane rectangle) */}
      <box
        style={{
          position: 'absolute',
          left: rect().x + 1,
          top: rect().y - 1,
          width: rect().width - 1,
          height: 1,
          flexDirection: 'row',
        }}
      >
        <For each={tabs()}>
          {({ paneId, label, isActive }) => (
            <text
              fg={isActive ? theme.ui.listSelection.foreground : theme.ui.mutedText}
              bg={isActive ? activeTabBg() : undefined}
              selectable={false}
              onMouseDown={(e: { preventDefault: () => void }) => {
                e.preventDefault();
                handleTabClick(paneId);
              }}
            >
              {label}
            </text>
          )}
        </For>
      </box>

      {/* Active stack entry (rectangle already accounts for tab header via layout calculation) */}
      <Index each={activePanes()}>
        {(pane) => (
          <PaneRenderer
            pane={pane()}
            isFocused={props.focusedPaneId === pane().id}
            isMain={false}
            hideTitle={true}
            onFocus={props.onFocus}
            onMouseInput={props.onMouseInput}
          />
        )}
      </Index>

      {/* Connector: fills the gap between active tab and pane border using upper half block */}
      <Show when={activeTabInfo()}>
        {(info: () => { x: number; width: number }) => (
          <text
            style={{
              position: 'absolute',
              left: rect().x + 1 + info().x,
              top: rect().y,
            }}
            fg={activeTabBg()}
          >
            {'▀'.repeat(info().width)}
          </text>
        )}
      </Show>
    </Show>
  );
}
