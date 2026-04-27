export interface CommandPaletteCommand {
  id: string;
  title: string;
  description?: string;
  action: string;
  keywords?: string[];
}

const BASE_COMMANDS: CommandPaletteCommand[] = [
  {
    id: 'pane.new',
    title: 'New pane',
    description: 'Create a new pane',
    action: 'pane.new',
    keywords: ['split', 'new'],
  },
  {
    id: 'pane.split.vertical',
    title: 'Split pane vertical',
    description: 'Split the focused pane left/right',
    action: 'pane.split.vertical',
    keywords: ['split', 'vertical', 'pane'],
  },
  {
    id: 'pane.split.horizontal',
    title: 'Split pane horizontal',
    description: 'Split the focused pane top/bottom',
    action: 'pane.split.horizontal',
    keywords: ['split', 'horizontal', 'pane'],
  },
  {
    id: 'pane.close',
    title: 'Close pane',
    description: 'Close the focused pane',
    action: 'pane.close',
    keywords: ['close', 'kill'],
  },
  {
    id: 'pane.rename',
    title: 'Rename pane',
    description: 'Rename the focused pane',
    action: 'pane.rename',
    keywords: ['rename', 'name', 'title', 'pane'],
  },
  {
    id: 'workspace.label',
    title: 'Label workspace',
    description: 'Label the active workspace',
    action: 'workspace.label',
    keywords: ['workspace', 'label', 'name'],
  },
  {
    id: 'pane.zoom',
    title: 'Toggle zoom',
    description: 'Zoom or unzoom the focused pane',
    action: 'pane.zoom',
    keywords: ['zoom', 'pane'],
  },
  {
    id: 'pane.scratch.toggle',
    title: 'Toggle scratch pane',
    description: 'Show or hide the workspace scratch pane',
    action: 'pane.scratch.toggle',
    keywords: ['scratch', 'popup', 'overlay', 'pane'],
  },
  {
    id: 'pane.focus.west',
    title: 'Focus pane left',
    description: 'Move focus to the pane on the left',
    action: 'pane.focus.west',
    keywords: ['focus', 'left', 'west'],
  },
  {
    id: 'pane.focus.east',
    title: 'Focus pane right',
    description: 'Move focus to the pane on the right',
    action: 'pane.focus.east',
    keywords: ['focus', 'right', 'east'],
  },
  {
    id: 'pane.focus.north',
    title: 'Focus pane up',
    description: 'Move focus to the pane above',
    action: 'pane.focus.north',
    keywords: ['focus', 'up', 'north'],
  },
  {
    id: 'pane.focus.south',
    title: 'Focus pane down',
    description: 'Move focus to the pane below',
    action: 'pane.focus.south',
    keywords: ['focus', 'down', 'south'],
  },
  {
    id: 'mode.move',
    title: 'Move pane mode',
    description: 'Enter pane move mode',
    action: 'mode.move',
    keywords: ['move', 'pane'],
  },
  {
    id: 'layout.mode.vertical',
    title: 'Layout: vertical',
    description: 'Main pane left, stack on the right',
    action: 'layout.mode.vertical',
    keywords: ['layout', 'vertical'],
  },
  {
    id: 'layout.mode.horizontal',
    title: 'Layout: horizontal',
    description: 'Main pane top, stack on the bottom',
    action: 'layout.mode.horizontal',
    keywords: ['layout', 'horizontal'],
  },
  {
    id: 'layout.mode.stacked',
    title: 'Layout: stacked',
    description: 'Main pane left, stack as tabs',
    action: 'layout.mode.stacked',
    keywords: ['layout', 'stacked', 'tabs'],
  },
  {
    id: 'layout.cycle.next',
    title: 'Cycle layout next',
    description: 'Move to the next layout mode',
    action: 'layout.cycle.next',
    keywords: ['layout', 'cycle', 'next'],
  },
  {
    id: 'layout.cycle.prev',
    title: 'Cycle layout previous',
    description: 'Move to the previous layout mode',
    action: 'layout.cycle.prev',
    keywords: ['layout', 'cycle', 'previous'],
  },
  {
    id: 'search.open',
    title: 'Search scrollback',
    description: 'Search the focused pane scrollback',
    action: 'search.open',
    keywords: ['search', 'find', 'scrollback'],
  },
  {
    id: 'copy.mode',
    title: 'Copy mode',
    description: 'Enter copy mode for the focused pane',
    action: 'copy.mode',
    keywords: ['copy', 'select', 'scrollback', 'vim'],
  },
  {
    id: 'session.picker.toggle',
    title: 'Session picker',
    description: 'Open the session picker',
    action: 'session.picker.toggle',
    keywords: ['session', 'picker'],
  },
  {
    id: 'template.overlay.toggle',
    title: 'Templates',
    description: 'Open the templates overlay',
    action: 'template.overlay.toggle',
    keywords: ['template', 'layout', 'session'],
  },
  {
    id: 'aggregate.toggle',
    title: 'Aggregate view',
    description: 'Open global PTY list',
    action: 'aggregate.toggle',
    keywords: ['aggregate', 'global'],
  },
  {
    id: 'clipboard.paste',
    title: 'Paste',
    description: 'Paste from clipboard',
    action: 'clipboard.paste',
    keywords: ['paste', 'clipboard'],
  },
  {
    id: 'console.toggle',
    title: 'Toggle debug console',
    description: 'Show or hide the debug console',
    action: 'console.toggle',
    keywords: ['console', 'debug'],
  },
  {
    id: 'console.dump',
    title: 'Dump console logs to temp directory',
    description: 'Save all console logs to a file in the system temp directory',
    action: 'console.dump',
    keywords: ['console', 'logs', 'dump', 'save', 'tmp', 'temp', 'debug'],
  },
  {
    id: 'keyboard.vim.toggle',
    title: 'Toggle overlay vim mode',
    description: 'Enable or disable vim keybindings in overlays',
    action: 'keyboard.vim.toggle',
    keywords: ['vim', 'keyboard', 'overlays'],
  },
  {
    id: 'keyboard.prefix-only.toggle',
    title: 'Toggle prefix-only mode',
    description: 'Enable or disable non-prefix shortcuts (Alt+keys)',
    action: 'keyboard.prefix-only.toggle',
    keywords: ['prefix', 'keybindings', 'alt', 'shortcuts', 'keyboard'],
  },
  {
    id: 'theme.refresh',
    title: 'Refresh host theme',
    description: 'Re-query host terminal colors',
    action: 'theme.refresh',
    keywords: ['theme', 'colors', 'appearance', 'refresh'],
  },
  {
    id: 'app.detach',
    title: 'Detach',
    description: 'Detach the current client',
    action: 'app.detach',
    keywords: ['detach'],
  },
  {
    id: 'app.quit',
    title: 'Quit openmux',
    description: 'Exit and terminate all panes',
    action: 'app.quit',
    keywords: ['quit', 'exit'],
  },
];

const WORKSPACE_COMMANDS: CommandPaletteCommand[] = Array.from({ length: 9 }, (_, i) => {
  const id = `workspace.switch.${i + 1}`;
  return {
    id,
    title: `Switch to workspace ${i + 1}`,
    description: `Focus workspace ${i + 1}`,
    action: id,
    keywords: ['workspace', 'switch', String(i + 1)],
  };
});

export const DEFAULT_COMMAND_PALETTE_COMMANDS: CommandPaletteCommand[] = [
  ...BASE_COMMANDS,
  ...WORKSPACE_COMMANDS,
];
