/**
 * Session context for managing sessions (above workspaces)
 */

import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  type ParentProps,
  type Accessor,
} from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { SessionMetadata, WorkspaceId } from '../core/types';
import type { Workspaces } from '../core/operations/layout-actions';
import { useConfig } from './ConfigContext';
import { deferNextTick } from '../core/scheduling';
import {
  createSessionLegacy as createSessionOnDisk,
  listSessionsLegacy as listSessions,
  getActiveSessionIdLegacy as getActiveSessionId,
  saveCurrentSession,
  loadSessionData,
  switchToSession,
  getSessionSummary,
  setActiveSessionIdForShim,
  listTemplates,
  saveTemplate as saveTemplateDefinition,
  deleteTemplate,
} from '../effect/bridge';
import { runStream, repeatWithInterval } from '../effect/stream-utils';
import type { TemplateSession } from '../effect/models';
import { SessionStorageError, SessionCorruptedError, SessionNotFoundError } from '../effect/errors';
import {
  type SessionState,
  type SessionAction,
  type SessionSummary,
  sessionReducer,
  createInitialState,
} from '../core/operations/session-actions';
import {
  applyTemplateToSession,
  buildTemplateFromWorkspaces,
  isLayoutEmpty as isLayoutEmptyWorkspaces,
  type LayoutSnapshot,
} from './session-templates';
import { createSessionPickerActions } from './session-picker-actions';
import { createSessionRefreshers } from './session-refresh';
import { createSessionOperations } from './session-operations';

export type { SessionState, SessionSummary };

export interface SessionContextValue {
  state: SessionState;
  /** Filter sessions by search query */
  filteredSessions: SessionMetadata[];
  /** Create a new session */
  createSession: (name?: string) => Promise<SessionMetadata | SessionStorageError>;
  /** Switch to a session */
  switchSession: (
    id: string,
    options?: { preloadedData?: Awaited<ReturnType<typeof loadSessionData>> }
  ) => Promise<void>;
  /** Rename a session */
  renameSession: (id: string, name: string) => Promise<void>;
  /** Delete a session */
  deleteSession: (id: string) => Promise<void>;
  /** Save the current session */
  saveSession: () => Promise<void>;
  /** Refresh sessions list */
  refreshSessions: () => Promise<void>;
  /** Toggle session picker */
  togglePicker: () => void;
  /** Close session picker */
  closePicker: () => void;
  /** Set search query */
  setSearchQuery: (query: string) => void;
  /** Start rename mode */
  startRename: (id: string, currentName: string) => void;
  /** Cancel rename */
  cancelRename: () => void;
  /** Update rename value */
  updateRenameValue: (value: string) => void;
  /** Navigate up in picker */
  navigateUp: () => void;
  /** Navigate down in picker */
  navigateDown: () => void;
  /** Jump to a specific index in picker */
  setSelectedIndex: (index: number) => void;
  /** Show template overlay */
  showTemplateOverlay: boolean;
  /** Templates list */
  templates: TemplateSession[];
  /** Open template overlay */
  openTemplateOverlay: () => void;
  /** Toggle template overlay */
  toggleTemplateOverlay: () => void;
  /** Close template overlay */
  closeTemplateOverlay: () => void;
  /** Refresh templates list */
  refreshTemplates: () => Promise<void>;
  /** Apply a template */
  applyTemplate: (template: TemplateSession) => Promise<void>;
  /** Save current session as a template */
  saveTemplate: (name: string) => Promise<string | null>;
  /** Export current layout as a declarative snapshot */
  exportLayoutSnapshot: (name?: string) => Promise<LayoutSnapshot | null>;
  /** Apply a declarative layout snapshot to the active session */
  importLayoutSnapshot: (snapshot: LayoutSnapshot) => Promise<void>;
  /** Delete a template */
  deleteTemplate: (templateId: string) => Promise<void>;
  /** Check if current layout is empty */
  isLayoutEmpty: () => boolean;
  /** Suspend session persistence (used during shutdown) */
  suspendPersistence: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

interface SessionProviderProps extends ParentProps {
  /** Function to get CWD for a PTY ID */
  getCwd: (ptyId: string) => Promise<string>;
  /** Function to get foreground process for a PTY ID */
  getForegroundProcess: (ptyId: string) => Promise<string | undefined>;
  /** Function to get last shell command captured for a PTY ID */
  getLastCommand: (ptyId: string) => Promise<string | undefined>;
  /** Function to get current workspaces */
  getWorkspaces: () => Workspaces;
  /** Function to get active workspace ID */
  getActiveWorkspaceId: () => WorkspaceId;
  /** Callback when session is loaded */
  onSessionLoad: (
    workspaces: Workspaces,
    activeWorkspaceId: WorkspaceId,
    cwdMap: Map<string, string>,
    commandMap: Map<string, string>,
    sessionId: string,
    options?: { allowPrune?: boolean }
  ) => Promise<void>;
  /** Callback to suspend PTYs before switching (saves mapping, doesn't destroy) */
  onBeforeSwitch: (currentSessionId: string) => Promise<void>;
  /** Callback to cleanup PTYs when a session is deleted */
  onDeleteSession: (sessionId: string) => void;
  /** Reset layout and PTYs before applying a template */
  resetLayoutForTemplate: () => Promise<void>;
  /** Layout version counter - triggers save when changed */
  layoutVersion?: Accessor<number>;
}

export function SessionProvider(props: SessionProviderProps) {
  const [state, setState] = createStore<SessionState>(createInitialState());
  const [showTemplateOverlay, setShowTemplateOverlay] = createSignal(false);
  const [templates, setTemplates] = createSignal<TemplateSession[]>([]);
  const [persistenceEnabled, setPersistenceEnabled] = createSignal(true);
  const config = useConfig();

  // Helper to dispatch actions through the reducer
  const dispatch = (action: SessionAction) => {
    setState(
      produce((s) => {
        const newState = sessionReducer(s as SessionState, action);
        Object.assign(s, newState);
      })
    );
  };

  const hasAnyPanes = (workspaces: Workspaces): boolean =>
    Object.values(workspaces).some(
      (workspace) => workspace && (workspace.mainPane || workspace.stackPanes.length > 0)
    );

  const shouldPersistSession = (workspaces: Workspaces): boolean =>
    persistenceEnabled() &&
    state.initialized &&
    !state.switching &&
    !!state.activeSession &&
    hasAnyPanes(workspaces);

  // Picker actions
  const {
    togglePicker,
    closePicker,
    setSearchQuery,
    startRename,
    cancelRename,
    updateRenameValue,
    navigateUp,
    navigateDown,
    setSelectedIndex,
  } = createSessionPickerActions(dispatch);

  // Refresh helpers
  const { refreshSessions, refreshTemplates } = createSessionRefreshers({
    listSessions,
    getSessionSummary,
    dispatch,
    listTemplates,
    setTemplates,
  });

  // Session CRUD operations
  const sessionOps = createSessionOperations({
    getState: () => state,
    dispatch,
    getCwd: props.getCwd,
    getWorkspaces: props.getWorkspaces,
    getActiveWorkspaceId: props.getActiveWorkspaceId,
    shouldPersistSession,
    onSessionLoad: props.onSessionLoad,
    onBeforeSwitch: props.onBeforeSwitch,
    onDeleteSession: props.onDeleteSession,
    refreshSessions,
  });

  // Template overlay actions
  const openTemplateOverlay = () => {
    setShowTemplateOverlay(true);
    refreshTemplates();
  };

  const closeTemplateOverlay = () => {
    setShowTemplateOverlay(false);
  };

  const toggleTemplateOverlay = () => {
    if (showTemplateOverlay()) {
      closeTemplateOverlay();
    } else {
      openTemplateOverlay();
    }
  };

  const isLayoutEmpty = () => isLayoutEmptyWorkspaces(props.getWorkspaces());

  const applyTemplate = (template: TemplateSession) =>
    applyTemplateToSession({
      template,
      activeSessionId: state.activeSessionId,
      resetLayoutForTemplate: props.resetLayoutForTemplate,
      onSessionLoad: props.onSessionLoad,
    });

  const buildSnapshot = async (nameInput?: string): Promise<LayoutSnapshot | null> => {
    const name = nameInput?.trim() || state.activeSession?.name || 'layout-snapshot';
    const result = await buildTemplateFromWorkspaces({
      name,
      workspaces: props.getWorkspaces(),
      getCwd: props.getCwd,
      getForegroundProcess: props.getForegroundProcess,
      getLastCommand: props.getLastCommand,
      defaultLayoutMode: config.config().layout.defaultLayoutMode,
      fallbackCwd: process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd(),
      shellPath: process.env.SHELL,
    });

    if (!result) {
      return null;
    }

    return {
      ...result.template,
      activeWorkspaceId: props.getActiveWorkspaceId(),
    };
  };

  const importLayoutSnapshot = async (snapshot: LayoutSnapshot) =>
    applyTemplateToSession({
      template: snapshot,
      activeSessionId: state.activeSessionId,
      activeWorkspaceId: snapshot.activeWorkspaceId,
      resetLayoutForTemplate: props.resetLayoutForTemplate,
      onSessionLoad: props.onSessionLoad,
    });

  const saveTemplate = async (nameInput: string): Promise<string | null> => {
    const name = nameInput.trim();
    if (!name) return null;

    const result = await buildTemplateFromWorkspaces({
      name,
      workspaces: props.getWorkspaces(),
      getCwd: props.getCwd,
      getForegroundProcess: props.getForegroundProcess,
      getLastCommand: props.getLastCommand,
      defaultLayoutMode: config.config().layout.defaultLayoutMode,
      fallbackCwd: process.env.OPENMUX_ORIGINAL_CWD ?? process.cwd(),
      shellPath: process.env.SHELL,
    });

    if (!result) {
      return null;
    }

    await saveTemplateDefinition(result.template);
    await refreshTemplates();
    return result.templateId;
  };

  const deleteTemplateById = async (templateId: string) => {
    await deleteTemplate(templateId);
    await refreshTemplates();
  };

  // Initialize on mount
  onMount(async () => {
    // Get active session or create default
    let sessions = await listSessions();
    if (sessions.length > 0) {
      dispatch({ type: 'SET_SESSIONS', sessions });
    }

    let activeId = await getActiveSessionId();
    let activeSession = activeId ? (sessions.find((s) => s.id === activeId) ?? null) : null;

    const requestedSession = (process.env.OPENMUX_START_SESSION ?? '').trim();
    if (requestedSession) {
      const matched =
        sessions.find(
          (session) => session.id === requestedSession || session.name === requestedSession
        ) ?? null;
      if (matched) {
        activeSession = matched;
        activeId = matched.id;
      }
      if (!matched) {
        const result = await createSessionOnDisk(requestedSession);
        if (!(result instanceof SessionStorageError)) {
          const metadata = result;
          sessions = [...sessions, metadata];
          dispatch({ type: 'SET_SESSIONS', sessions });
          activeSession = metadata;
          activeId = metadata.id;
        }
        if (result instanceof SessionStorageError) {
          console.error('Failed to create session:', result.message);
          // Continue without setting active session
        }
      }
    }

    if (!activeSession && sessions.length > 0) {
      activeSession = sessions[0] ?? null;
      activeId = activeSession?.id ?? null;
    }

    let refreshTask: Promise<void> | null = null;

    if (!activeSession) {
      // First run - create default session
      const result = await createSessionOnDisk();
      if (!(result instanceof SessionStorageError)) {
        const metadata = result;
        activeId = metadata.id;
        dispatch({ type: 'SET_SESSIONS', sessions: [metadata] });
        dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
        await props.onSessionLoad({}, 1, new Map(), new Map(), metadata.id, { allowPrune: false });
      }
      if (result instanceof SessionStorageError) {
        console.error('Failed to create default session:', result.message);
        // Cannot proceed without a session, set initialized anyway
      }
    } else if (activeId) {
      // Load existing session
      dispatch({ type: 'SET_ACTIVE_SESSION', id: activeId, session: activeSession });

      // Update lastSwitchedAt so this session is properly marked as most recent
      const switchPromise = switchToSession(activeId).catch((e) => {
        console.warn('[SessionContext] Failed to switch to session:', activeId, e);
      });

      // Load session data and notify parent
      const data = await loadSessionData(activeId);
      if (data instanceof SessionNotFoundError || data instanceof SessionCorruptedError) {
        console.error('Failed to load session:', data.message);
        // Session failed to load - create a fresh session instead of overwriting
        const result = await createSessionOnDisk();
        if (!(result instanceof SessionStorageError)) {
          const metadata = result;
          dispatch({ type: 'SET_SESSIONS', sessions: [...sessions, metadata] });
          dispatch({ type: 'SET_ACTIVE_SESSION', id: metadata.id, session: metadata });
          await props.onSessionLoad({}, 1, new Map(), new Map(), metadata.id, {
            allowPrune: false,
          });
        }
        if (result instanceof SessionStorageError) {
          console.error('Failed to create replacement session:', result.message);
          // Continue without changing session state
        }
      } else {
        // IMPORTANT: Await onSessionLoad to ensure CWD map is set before initialized
        await props.onSessionLoad(
          data.workspaces,
          data.activeWorkspaceId,
          data.cwdMap,
          new Map(),
          activeId,
          { allowPrune: false }
        );
      }

      refreshTask = switchPromise
        .then(() => refreshSessions())
        .catch((e) => {
          console.warn('[SessionContext] Failed to refresh sessions:', e);
        });
    }

    dispatch({ type: 'SET_INITIALIZED' });
    deferNextTick(() => {
      void (refreshTask ?? refreshSessions());
    });
  });

  // Auto-save interval
  createEffect(() => {
    const intervalMs = config.config().session.autoSaveIntervalMs;
    if (!state.activeSession || intervalMs === 0) return;

    const autosaveStream = repeatWithInterval(async () => {
      const workspaces = props.getWorkspaces();
      const activeWorkspaceId = props.getActiveWorkspaceId();

      if (state.activeSession && shouldPersistSession(workspaces)) {
        await saveCurrentSession(state.activeSession, workspaces, activeWorkspaceId, props.getCwd);
      }
    }, intervalMs);

    const stop = runStream(autosaveStream, { label: 'session-autosave' });
    onCleanup(() => stop());
  });

  // Track previous layoutVersion to detect changes
  let prevLayoutVersion = props.layoutVersion?.();

  // Keep active session ID available for shim mapping
  createEffect(() => {
    setActiveSessionIdForShim(state.activeSessionId ?? null);
  });

  // Immediate save when layoutVersion changes (pane/workspace changes)
  createEffect(() => {
    const layoutVersion = props.layoutVersion?.();

    // Skip on initial render or if no active session
    if (prevLayoutVersion === layoutVersion || !state.activeSession) {
      prevLayoutVersion = layoutVersion;
      return;
    }

    prevLayoutVersion = layoutVersion;

    // Save immediately when layout changes
    const workspaces = props.getWorkspaces();
    const activeWorkspaceId = props.getActiveWorkspaceId();

    if (shouldPersistSession(workspaces)) {
      saveCurrentSession(state.activeSession, workspaces, activeWorkspaceId, props.getCwd);
    }
  });

  // Computed values
  const filteredSessions = createMemo(() =>
    state.sessions.filter((s) => s.name.toLowerCase().includes(state.searchQuery.toLowerCase()))
  );

  const value: SessionContextValue = {
    get state() {
      return state;
    },
    get filteredSessions() {
      return filteredSessions();
    },
    ...sessionOps,
    refreshSessions,
    togglePicker,
    closePicker,
    setSearchQuery,
    startRename,
    cancelRename,
    updateRenameValue,
    navigateUp,
    navigateDown,
    setSelectedIndex,
    get showTemplateOverlay() {
      return showTemplateOverlay();
    },
    get templates() {
      return templates();
    },
    openTemplateOverlay,
    toggleTemplateOverlay,
    closeTemplateOverlay,
    refreshTemplates,
    applyTemplate,
    saveTemplate,
    exportLayoutSnapshot: buildSnapshot,
    importLayoutSnapshot,
    deleteTemplate: deleteTemplateById,
    isLayoutEmpty,
    suspendPersistence: () => setPersistenceEnabled(false),
  };

  return <SessionContext.Provider value={value}>{props.children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}

export function useSessionState(): SessionState {
  const { state } = useSession();
  return state;
}
