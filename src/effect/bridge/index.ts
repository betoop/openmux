/**
 * Bridge module for errore-based services (errore version).
 * Provides simple async functions backed by errore services.
 *
 * Unlike the Effect version, these functions directly accept service instances
 * rather than using Effect runtime for dependency injection.
 *
 * Use these functions to interact with services from UI components.
 */

// Re-export types that are commonly needed
export type { AppServices, TestAppServices, ServiceInitError } from '../services';

// Re-export KeyboardEvent from core
export type { KeyboardEvent } from '../../core/keyboard-event';

// Clipboard bridge
export { copyToClipboard, readFromClipboard } from './clipboard-bridge';

// PTY bridge
export {
  createPtySession,
  writeToPty,
  sendPtyFocusEvent,
  resizePty,
  getPtyCwd,
  getPtyForegroundProcess,
  getPtyLastCommand,
  destroyPty,
  destroyAllPtys,
  getTerminalState,
  onPtyExit,
  getScrollState,
  capturePty,
  getScrollbackLines,
  setScrollOffset,
  scrollToBottom,
  subscribeUnifiedToPty,
  getEmulator,
  getEmulatorSync,
  setPtyUpdateEnabled,
  refreshPty,
  applyHostColors,
  subscribeToPtyLifecycle,
  subscribeToAllTitleChanges,
  subscribeToAllPtyActivity,
  subscribeToCwdChanges,
  subscribeToMetadataChanges,
  getPtyTitle,
  type PtyLifecycleEvent,
  type PtyTitleChangeEvent,
  type PtyActivityEvent,
  type PtyCwdChangeEvent,
  type PtyMetadataChangeEvent,
} from './pty-bridge';

// Session bridge
export {
  listSessions,
  createSession,
  loadSession,
  saveSession,
  deleteSession,
  renameSession,
  getActiveSessionId,
  setActiveSessionId,
  switchToSession,
  getSessionMetadata,
  getSessionInfoResult,
  updateAutoName,
  getSessionSummary,
  getAggregateSessionOrder,
  setAggregateSessionOrder,
  createSessionLegacy,
  listSessionsLegacy,
  getActiveSessionIdLegacy,
  renameSessionLegacy,
  deleteSessionLegacy,
  saveCurrentSession,
  loadSessionData,
} from './session-bridge';

// Template bridge
export {
  listTemplates,
  loadTemplate,
  saveTemplate,
  deleteTemplate,
  buildLayoutFromTemplate,
} from './template-bridge';

// Aggregate bridge
export {
  createAggregateService,
  type AggregateService,
  type AggregateServiceDeps,
  type ListAllPtysOptions,
  type PtyMetadata,
  type SessionWithPtys,
  type VisualTreeNode,
  type LoadSessionPtysResult,
} from './aggregate-bridge';

// Color bridge
export { getHostBackgroundColor, getHostForegroundColor } from './color-bridge';

// Shim bridge
export {
  registerPtyPane,
  getSessionPtyMapping,
  type SessionPtyMapping,
  onShimDetached,
  shutdownShim,
  waitForShimClient,
} from './shim-bridge';

// Runtime cleanup
export { disposeRuntime } from './services-instance';

// Keyboard router bridge
export {
  type KeyEvent,
  type KeyHandler,
  type OverlayType,
  registerKeyboardHandler,
  routeKeyboardEvent,
  routeKeyboardEventSync,
  getActiveOverlay,
  hasKeyboardHandler,
} from './keyboard-router-bridge';

// App coordinator bridge
export {
  clearPtyTracking,
  markPtyCreated,
  isPtyCreated,
  setSessionCwdMap,
  getSessionCwd,
  clearSessionCwdMap,
  setSessionCommandMap,
  getSessionCommand,
  clearSessionCommandMap,
  setActiveSessionIdForShim,
  getActiveSessionIdForShim,
  onActiveSessionIdForShimChange,
} from './app-coordinator-bridge';
