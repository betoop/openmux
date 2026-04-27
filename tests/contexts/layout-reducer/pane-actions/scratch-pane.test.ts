import { describe, expect, it } from 'bun:test';
import { layoutReducer } from '../../../../src/core/operations/layout-actions';
import { createInitialState, defaultViewport, setupLayoutReducerTest } from '../fixtures';

describe('Layout Reducer', () => {
  setupLayoutReducerTest();

  describe('TOGGLE_SCRATCH_PANE action', () => {
    it('creates a focused overlay pane without changing tiled layout', () => {
      let state = layoutReducer(createInitialState(), { type: 'NEW_PANE' });
      state = layoutReducer(state, { type: 'TOGGLE_SCRATCH_PANE' });

      const workspace = state.workspaces[1]!;
      expect(workspace.mainPane!.id).toBe('pane-1');
      expect(workspace.mainPane!.rectangle).toEqual(defaultViewport);
      expect(workspace.scratchPane?.id).toBe('pane-2');
      expect(workspace.scratchPane?.title).toBe('scratch');
      expect(workspace.scratchPane?.rectangle).toBeDefined();
      expect(workspace.scratchVisible).toBe(true);
      expect(workspace.focusedPaneId).toBe('pane-2');
      expect(workspace.scratchPreviousFocusedPaneId).toBe('pane-1');
    });

    it('hides an existing scratch pane and preserves its PTY', () => {
      let state = layoutReducer(createInitialState(), { type: 'NEW_PANE' });
      state = layoutReducer(state, { type: 'TOGGLE_SCRATCH_PANE' });
      state = layoutReducer(state, {
        type: 'SET_PANE_PTY',
        paneId: 'pane-2',
        ptyId: 'pty-scratch',
      });
      state = layoutReducer(state, { type: 'TOGGLE_SCRATCH_PANE' });

      const workspace = state.workspaces[1]!;
      expect(workspace.scratchVisible).toBe(false);
      expect(workspace.scratchPane?.id).toBe('pane-2');
      expect(workspace.scratchPane?.ptyId).toBe('pty-scratch');
      expect(workspace.scratchPane?.rectangle).toBeUndefined();
      expect(workspace.focusedPaneId).toBe('pane-1');
    });

    it('removes the scratch pane when it is closed', () => {
      let state = layoutReducer(createInitialState(), { type: 'NEW_PANE' });
      state = layoutReducer(state, { type: 'TOGGLE_SCRATCH_PANE' });
      state = layoutReducer(state, { type: 'CLOSE_PANE' });

      const workspace = state.workspaces[1]!;
      expect(workspace.scratchPane).toBeNull();
      expect(workspace.scratchVisible).toBe(false);
      expect(workspace.focusedPaneId).toBe('pane-1');
    });
  });
});
