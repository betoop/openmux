export type HelpTopic =
  | 'root'
  | 'attach'
  | 'update'
  | 'session'
  | 'session.list'
  | 'session.create'
  | 'layout'
  | 'layout.export'
  | 'layout.import'
  | 'pane'
  | 'pane.split'
  | 'pane.send'
  | 'pane.capture';

function formatHeader(topic: HelpTopic, version?: string): string {
  const base = version && version !== 'unknown' ? `openmux ${version}` : 'openmux';
  if (topic === 'root') {
    return base;
  }
  return `${base} ${topic.replace('.', ' ')}`;
}

const ROOT_HELP = (version?: string): string[] => [
  formatHeader('root', version),
  '',
  'Usage:',
  '  openmux [attach] [--session <name|id>]',
  '  openmux <command> [<args>]',
  '',
  'Commands:',
  '  attach           Steal and attach to the UI (default).',
  '  update           Check for and install new releases.',
  '  session          List/create sessions (disk-backed).',
  '  layout           Export/import declarative layout snapshots.',
  '  pane             Control panes in the active UI.',
  '',
  'Options:',
  '  -h, --help       Show help (try `openmux pane --help`).',
  '  -v, --version    Show version.',
  '  --shim           Run shim server (internal).',
  '',
  'Notes:',
  '  Pane selectors: focused | main | stack:<n> | pane:<id> | pty:<id>',
  '  Pane send escapes: \\n \\r \\t \\xNN \\uXXXX \\u{...}',
  '',
  'Exit codes:',
  '  0  success',
  '  2  usage error',
  '  3  no active UI',
  '  4  target not found',
  '  5  ambiguous target',
  '  6  internal error',
];

const ATTACH_HELP = (version?: string): string[] => [
  formatHeader('attach', version),
  '',
  'Usage:',
  '  openmux',
  '  openmux attach [--session <name|id>]',
  '',
  'Description:',
  '  Steal and attach to the UI. If the session does not exist, it is created.',
  '',
  'Options:',
  '  --session <name|id>   Start in a specific session (creates if missing).',
];

const UPDATE_HELP = (version?: string): string[] => [
  formatHeader('update', version),
  '',
  'Usage:',
  '  openmux update [--yes] [--prerelease]',
  '',
  'Description:',
  '  Checks GitHub Releases and installs a newer openmux release when available.',
  '',
  'Options:',
  '  --yes           Skip confirmation prompt.',
  '  --prerelease    Include prerelease tags when selecting latest version.',
  '',
  'Notes:',
  '  Only managed installs are supported ($XDG_DATA_HOME/openmux).',
  '  In non-interactive mode, pass --yes.',
];

const SESSION_HELP = (version?: string): string[] => [
  formatHeader('session', version),
  '',
  'Usage:',
  '  openmux session list [--json]',
  '  openmux session create [name]',
  '',
  'Description:',
  '  Session commands operate on the on-disk session index.',
  '',
  'Subcommands:',
  '  list     Print sessions (use --json for structured output).',
  '  create   Create a new session (prints its id).',
];

const SESSION_LIST_HELP = (version?: string): string[] => [
  formatHeader('session.list', version),
  '',
  'Usage:',
  '  openmux session list [--json]',
  '',
  'Options:',
  '  --json   Emit JSON array with active session flag.',
  '',
  'Output:',
  '  * name (id) marks the active session when not using --json.',
];

const SESSION_CREATE_HELP = (version?: string): string[] => [
  formatHeader('session.create', version),
  '',
  'Usage:',
  '  openmux session create [name]',
  '',
  'Description:',
  '  Creates a session and prints its id to stdout.',
];

const LAYOUT_HELP = (version?: string): string[] => [
  formatHeader('layout', version),
  '',
  'Usage:',
  '  openmux layout export [--file <path>] [--name <name>] [--json]',
  '  openmux layout import --file <path> [--json]',
  '',
  'Description:',
  '  Layout commands require a running UI (control socket).',
  '  Snapshots use the same declarative format as templates.',
  '',
  'Subcommands:',
  '  export   Export the active layout snapshot.',
  '  import   Replace the active session layout from a snapshot file.',
];

const LAYOUT_EXPORT_HELP = (version?: string): string[] => [
  formatHeader('layout.export', version),
  '',
  'Usage:',
  '  openmux layout export [--file <path>] [--name <name>] [--json]',
  '',
  'Options:',
  '  --file <path>   Write snapshot JSON to a file instead of stdout.',
  '  --name <name>   Override the snapshot name.',
  '  --json          Also print snapshot JSON when writing to a file.',
  '',
  'Output:',
  '  Without --file, snapshot JSON is printed to stdout.',
];

const LAYOUT_IMPORT_HELP = (version?: string): string[] => [
  formatHeader('layout.import', version),
  '',
  'Usage:',
  '  openmux layout import --file <path> [--json]',
  '',
  'Options:',
  '  --file <path>   Read snapshot JSON from a file.',
  '  --json          Print the control response as JSON.',
  '',
  'Description:',
  '  Replaces the active session layout and creates PTYs from stored cwd/commands.',
];

const PANE_HELP = (version?: string): string[] => [
  formatHeader('pane', version),
  '',
  'Usage:',
  '  openmux pane split --direction <vertical|horizontal> [--workspace <1-9>] [--pane <selector>]',
  '  openmux pane send --text <text> [--workspace <1-9>] [--pane <selector>]',
  '  openmux pane capture [--lines <n>] [--format <text|ansi>] [--raw] [--workspace <1-9>] [--pane <selector>]',
  '',
  'Description:',
  '  Pane commands require a running UI (control socket).',
  '',
  'Pane selectors:',
  '  focused (default), main, stack:<n>, pane:<id>, pty:<id>',
  '',
  'Notes:',
  '  --workspace defaults to the active workspace.',
];

const PANE_SPLIT_HELP = (version?: string): string[] => [
  formatHeader('pane.split', version),
  '',
  'Usage:',
  '  openmux pane split --direction <vertical|horizontal> [--workspace <1-9>] [--pane <selector>]',
  '',
  'Options:',
  '  --direction <vertical|horizontal>   Split orientation (required).',
  '  --workspace <1-9>                   Workspace to target.',
  '  --pane <selector>                   Pane selector (defaults to focused).',
];

const PANE_SEND_HELP = (version?: string): string[] => [
  formatHeader('pane.send', version),
  '',
  'Usage:',
  '  openmux pane send --text <text> [--workspace <1-9>] [--pane <selector>]',
  '',
  'Options:',
  '  --text <text>           Text to send (C-style escapes are decoded).',
  '  --workspace <1-9>       Workspace to target.',
  '  --pane <selector>       Pane selector (defaults to focused).',
  '',
  'Pane selectors:',
  '  focused (default), main, stack:<n>, pane:<id>, pty:<id>',
  '',
  'Escapes:',
  '  \\n \\r \\t \\xNN \\uXXXX \\u{...}',
  '',
  'Example:',
  '  openmux pane send --text "npm test\\n"',
];

const PANE_CAPTURE_HELP = (version?: string): string[] => [
  formatHeader('pane.capture', version),
  '',
  'Usage:',
  '  openmux pane capture [--lines <n>] [--format <text|ansi>] [--raw] [--workspace <1-9>] [--pane <selector>]',
  '',
  'Options:',
  '  --lines <n>         Lines to capture (default: 200).',
  '  --format <text|ansi>  Output format (default: text).',
  '  --raw               Preserve trailing whitespace/blank lines.',
  '  --workspace <1-9>   Workspace to target.',
  '  --pane <selector>   Pane selector (defaults to focused).',
  '',
  'Output:',
  '  Captured text is printed to stdout.',
];

const HELP_TOPICS: Record<HelpTopic, (version?: string) => string[]> = {
  root: ROOT_HELP,
  attach: ATTACH_HELP,
  update: UPDATE_HELP,
  session: SESSION_HELP,
  'session.list': SESSION_LIST_HELP,
  'session.create': SESSION_CREATE_HELP,
  layout: LAYOUT_HELP,
  'layout.export': LAYOUT_EXPORT_HELP,
  'layout.import': LAYOUT_IMPORT_HELP,
  pane: PANE_HELP,
  'pane.split': PANE_SPLIT_HELP,
  'pane.send': PANE_SEND_HELP,
  'pane.capture': PANE_CAPTURE_HELP,
};

export function formatHelp(topic: HelpTopic, version?: string): string {
  const formatter = HELP_TOPICS[topic] ?? ROOT_HELP;
  return formatter(version).join('\n');
}
