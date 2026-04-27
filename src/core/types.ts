/**
 * Core type definitions for the master-stack layout system
 */

/** Split orientation - determines how space is divided */
export type SplitDirection = 'horizontal' | 'vertical';

/** Direction for navigation and operations */
export type Direction = 'north' | 'south' | 'east' | 'west';

/**
 * Layout mode - how panes are arranged in a workspace (Zellij-style)
 * - vertical: main pane left, stack panes split vertically on right
 * - horizontal: main pane top, stack panes split horizontally on bottom
 * - stacked: main pane left, stack panes tabbed on right
 */
export type LayoutMode = 'vertical' | 'horizontal' | 'stacked';

/** Workspace ID (1-9) */
export type WorkspaceId = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/**
 * Pane data (simplified - no tree structure needed for master-stack)
 */
export interface PaneData {
  id: NodeId;
  ptyId?: string;
  title?: string;
  cwd?: string;
  rectangle?: Rectangle;
}

/**
 * Workspace using master-stack layout (like Zellij)
 * - mainPane: the primary layout node (left for vertical, top for horizontal)
 * - stackPanes: secondary layout nodes arranged based on layout mode
 */
export interface Workspace {
  id: WorkspaceId;
  /** Optional user label for status bar display */
  label?: string;
  mainPane: LayoutNode | null;
  stackPanes: LayoutNode[];
  /** Optional overlay pane that can be hidden without changing tiled layout */
  scratchPane?: PaneData | null;
  scratchVisible?: boolean;
  scratchPreviousFocusedPaneId?: NodeId | null;
  focusedPaneId: NodeId | null;
  /** For stacked mode: which stack pane is visible */
  activeStackIndex: number;
  /** For stacked mode: last focused pane in each stack entry for focus restoration */
  lastFocusedPaneIds: (NodeId | null)[];
  layoutMode: LayoutMode;
  /** Whether the focused pane is zoomed (fullscreen) */
  zoomed: boolean;
}

/** Rectangle representing a region in terminal coordinates */
export interface Rectangle {
  x: number; // Column position (0-indexed)
  y: number; // Row position (0-indexed)
  width: number; // Width in columns
  height: number; // Height in rows
}

/** Padding/gap configuration */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Unique identifier for nodes */
export type NodeId = string;

/**
 * Split node - internal node that divides space between two children
 */
export interface SplitNode {
  type: 'split';
  id: NodeId;
  direction: SplitDirection;
  /** Split ratio from 0 to 1 (position of split from start) */
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
  /** Computed layout rectangle */
  rectangle?: Rectangle;
}

/** Layout node - either a split or a pane */
export type LayoutNode = SplitNode | PaneData;

/**
 * Terminal cell from libghostty-vt or fallback parser
 */
export interface TerminalCell {
  char: string;
  fg: { r: number; g: number; b: number };
  bg: { r: number; g: number; b: number };
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  inverse: boolean;
  blink: boolean;
  dim: boolean;
  width: 1 | 2;
  hyperlinkId?: number;
}

/**
 * Terminal cursor state
 */
export interface TerminalCursor {
  x: number;
  y: number;
  visible: boolean;
  style?: 'block' | 'underline' | 'bar';
}

/**
 * Terminal state for a pane
 */
export interface TerminalState {
  cols: number;
  rows: number;
  cells: TerminalCell[][];
  /** Version numbers for each row (for efficient React change detection) */
  rowVersions?: number[];
  cursor: TerminalCursor;
  alternateScreen: boolean;
  mouseTracking: boolean;
  /** Cursor key mode (DECCKM) - when 'application', arrow keys send \x1bOx instead of \x1b[x */
  cursorKeyMode?: 'normal' | 'application';
  /** Kitty keyboard protocol flags (bitset). */
  kittyKeyboardFlags?: number;
  title?: string;
}

/**
 * Scroll state for a terminal pane
 */
export interface TerminalScrollState {
  /** Number of lines scrolled back from bottom (0 = at bottom/live terminal) */
  viewportOffset: number;
  /** Total scrollback lines available */
  scrollbackLength: number;
  /** Whether currently at the bottom (for sticky scroll detection) */
  isAtBottom: boolean;
  /** Whether scrollback buffer is at its maximum capacity (content will shift on new lines) */
  isAtScrollbackLimit?: boolean;
}

/**
 * Dirty terminal update - delivers only changed data for efficient rendering.
 *
 * This interface optimizes terminal rendering performance by delivering only
 * the rows that have changed since the last update, rather than the full
 * terminal state. Subscribers receive minimal update data for high-frequency
 * terminal output scenarios.
 *
 * Use cases:
 * - Normal terminal output: Only dirtyRows contains changed lines
 * - Resize or alt screen switch: isFull=true with complete state in fullState
 * - Cursor movement: Cursor position included even when no text changes
 *
 * @example
 * // Check if full state refresh is needed
 * if (update.isFull && update.fullState) {
 *   renderCompleteState(update.fullState);
 * } else {
 *   renderDirtyRows(update.dirtyRows);
 * }
 */
export interface DirtyTerminalUpdate {
  /** Map of row index -> new row cells. Only includes rows that changed content or attributes. */
  dirtyRows: Map<number, TerminalCell[]>;
  /** Current cursor position and visibility state. Always included for cursor tracking. */
  cursor: TerminalCursor;
  /** Current scroll region and position. Always included for scroll synchronization. */
  scrollState: TerminalScrollState;
  /** Terminal width in columns. */
  cols: number;
  /** Terminal height in rows. */
  rows: number;
  /** If true, fullState contains complete terminal state (used after resize, alt screen switch). */
  isFull: boolean;
  /** Complete terminal state when isFull=true; undefined for incremental updates. */
  fullState?: TerminalState;
  /** Whether terminal is in alternate screen buffer (e.g., vim, less). */
  alternateScreen: boolean;
  /** Whether mouse events are sent to the application (e.g., vim mouse mode). */
  mouseTracking: boolean;
  /** Cursor key mode for application vs normal encoding. */
  cursorKeyMode: 'normal' | 'application';
  /** Kitty keyboard protocol flags (bitset) for enhanced key reporting. */
  kittyKeyboardFlags?: number;
  /** DECSET 2048 - in-band resize notifications (used by neovim). */
  inBandResize: boolean;
}

/**
 * Unified update combining terminal and scroll state.
 * Eliminates race conditions from separate subscriptions.
 */
export interface UnifiedTerminalUpdate {
  terminalUpdate: DirtyTerminalUpdate;
  scrollState: TerminalScrollState;
}

/**
 * Selection bounding box for spatial optimization.
 * Enables O(1) rejection in isCellSelected() instead of per-cell checks.
 */
export interface SelectionBounds {
  minX: number;
  maxX: number;
  /** Absolute Y coordinate (includes scrollback offset) */
  minY: number;
  /** Absolute Y coordinate (includes scrollback offset) */
  maxY: number;
}

/**
 * Keyboard mode for prefix key system
 */
export type KeyMode = 'normal' | 'prefix' | 'search' | 'copy' | 'aggregate' | 'confirm' | 'move';

/** Confirmation dialog type */
export type ConfirmationType =
  | 'close_pane'
  | 'exit'
  | 'kill_pty'
  | 'apply_template'
  | 'overwrite_template'
  | 'delete_template'
  | 'delete_session';

/**
 * Keyboard state
 */
export interface KeyboardState {
  mode: KeyMode;
  prefixActivatedAt?: number;
  /** Type of action being confirmed (when mode is 'confirm') */
  confirmationType?: ConfirmationType;
}

/**
 * Theme for pane styling
 */
export interface PaneTheme {
  borderColor: string;
  focusedBorderColor: string;
  copyModeBorderColor: string;
  urgentBorderColor: string;
  borderStyle: 'single' | 'double' | 'rounded' | 'bold';
  innerGap: number;
  outerGap: number;
  titleColor: string;
  focusedTitleColor: string;
  copyModeTitleColor: string;
}

/**
 * Theme for status bar
 */
export interface StatusBarTheme {
  backgroundColor: string;
  foregroundColor: string;
  activeTabColor: string;
  inactiveTabColor: string;
  successColor: string;
}

export interface SelectionTheme {
  foreground: string;
  background: string;
}

export interface ButtonFocusTheme {
  foreground: string;
  background: string;
}

export interface CopyNotificationTheme {
  borderColor: string;
  textColor: string;
  backgroundColor: string;
}

export interface CopyModeTheme {
  selection: SelectionTheme;
  cursor: SelectionTheme;
}

export interface AggregateSelectionTheme {
  foreground: string;
  background: string;
  dim: string;
}

export interface AggregateDiffTheme {
  added: string;
  removed: string;
  addedSelected: string;
  removedSelected: string;
  binarySelected: string;
}

export interface AggregateTheme {
  selection: AggregateSelectionTheme;
  diff: AggregateDiffTheme;
}

export interface UiTheme {
  mutedText: string;
  listSelection: SelectionTheme;
  buttonFocus: ButtonFocusTheme;
  copyNotification: CopyNotificationTheme;
  copyMode: CopyModeTheme;
  aggregate: AggregateTheme;
}

/**
 * Complete theme configuration
 */
export interface Theme {
  pane: PaneTheme;
  statusBar: StatusBarTheme;
  ui: UiTheme;
  searchAccentColor: string;
}

/** Session ID - unique identifier */
export type SessionId = string;

/** Session metadata for persistence and UI */
export interface SessionMetadata {
  id: SessionId;
  name: string;
  createdAt: number;
  lastSwitchedAt: number;
  autoNamed: boolean;
}

/** Serializable pane state for persistence */
export interface SerializedPaneData {
  id: string;
  title?: string;
  cwd: string;
}

/** Serializable split node for persistence */
export interface SerializedSplitNode {
  type: 'split';
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: SerializedLayoutNode;
  second: SerializedLayoutNode;
}

/** Serializable layout node - pane or split */
export type SerializedLayoutNode = SerializedPaneData | SerializedSplitNode;
