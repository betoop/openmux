/**
 * Types for keyboard context
 */

import type { KeyboardState, ConfirmationType, SplitDirection } from '../../core/types';

export interface KeyboardContextValue {
  state: KeyboardState;
  enterPrefixMode: () => void;
  exitPrefixMode: () => void;
  enterSearchMode: () => void;
  exitSearchMode: () => void;
  enterCopyMode: () => void;
  exitCopyMode: () => void;
  enterAggregateMode: () => void;
  exitAggregateMode: () => void;
  enterMoveMode: () => void;
  exitMoveMode: () => void;
  enterConfirmMode: (confirmationType: ConfirmationType) => void;
  exitConfirmMode: () => void;
}

export interface KeyboardHandlerOptions {
  onPaste?: () => void;
  onNewPane?: () => void;
  onSplitPane?: (direction: SplitDirection) => void;
  onQuit?: () => void;
  onDetach?: () => void;
  onRequestQuit?: () => void;
  onRequestClosePane?: () => void;
  onRenamePane?: () => void;
  onLabelWorkspace?: () => void;
  onToggleSessionPicker?: () => void;
  onToggleTemplateOverlay?: () => void;
  onEnterSearch?: () => void;
  onEnterCopyMode?: () => void;
  onToggleConsole?: () => void;
  onDumpConsoleLogs?: () => void;
  onToggleAggregateView?: () => void;
  onToggleCommandPalette?: () => void;
  onToggleScratchPane?: () => void;
  onToggleVimMode?: () => void;
  onRefreshHostColors?: () => void;
  onTogglePrefixOnly?: () => void;
}
