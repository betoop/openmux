/**
 * Shim Session/Pane Mapping Management
 * Maps session/pane IDs to PTY IDs
 */
import type { ShimServerState } from '../server-state';

/**
 * Register a mapping between session/pane and PTY
 */
export function registerMapping(
  state: ShimServerState,
  sessionId: string,
  paneId: string,
  ptyId: string
): void {
  const map = state.sessionPanes.get(sessionId) ?? new Map<string, string>();
  map.set(paneId, ptyId);
  state.sessionPanes.set(sessionId, map);
  state.ptyToPane.set(ptyId, { sessionId, paneId });
  state.ptySessions.set(ptyId, sessionId);
}

/**
 * Remove all mappings for a given PTY ID
 */
export function removeMappingForPty(state: ShimServerState, ptyId: string): void {
  const info = state.ptyToPane.get(ptyId);
  if (!info) return;
  const map = state.sessionPanes.get(info.sessionId);
  if (map) {
    map.delete(info.paneId);
    if (map.size === 0) {
      state.sessionPanes.delete(info.sessionId);
    }
  }
  state.ptyToPane.delete(ptyId);
  state.ptySessions.delete(ptyId);
}

/**
 * Get the pane ID for a given PTY ID
 */
export function getPaneForPty(
  state: ShimServerState,
  ptyId: string
): { sessionId: string; paneId: string } | undefined {
  return state.ptyToPane.get(ptyId);
}

/**
 * Clear all session/pane mappings
 */
export function clearAllMappings(state: ShimServerState): void {
  state.sessionPanes.clear();
  state.ptyToPane.clear();
  state.ptySessions.clear();
}

/**
 * Get all PTY IDs mapped to a session
 */
export function getPtyIdsForSession(state: ShimServerState, sessionId: string): string[] {
  const ids = new Set<string>();
  for (const [ptyId, mappedSessionId] of state.ptySessions.entries()) {
    if (mappedSessionId === sessionId) {
      ids.add(ptyId);
    }
  }

  const map = state.sessionPanes.get(sessionId);
  if (map) {
    for (const ptyId of map.values()) {
      ids.add(ptyId);
    }
  }

  return Array.from(ids);
}
