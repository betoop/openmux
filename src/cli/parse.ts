import { type HelpTopic } from './help';
import { parsePaneSelector } from '../control/targets';

type PaneCommandBase = {
  pane?: string;
  workspaceId?: number;
};

export type CliCommand =
  | { kind: 'help'; topic: HelpTopic }
  | { kind: 'attach'; session?: string }
  | { kind: 'update'; yes: boolean; prerelease: boolean }
  | { kind: 'session.list'; json: boolean }
  | { kind: 'session.create'; name?: string }
  | { kind: 'layout.export'; file?: string; name?: string; json: boolean }
  | { kind: 'layout.import'; file: string; json: boolean }
  | ({ kind: 'pane.split'; direction: 'horizontal' | 'vertical' } & PaneCommandBase)
  | ({ kind: 'pane.send'; text: string } & PaneCommandBase)
  | ({
      kind: 'pane.capture';
      format: 'text' | 'ansi';
      lines: number;
      raw: boolean;
    } & PaneCommandBase);

export type ParseResult = { ok: true; command: CliCommand } | { ok: false; error: string };

const HELP_FLAGS = new Set(['-h', '--help']);

function shouldShowHelp(args: string[]): boolean {
  if (args.length === 0) return false;
  if (args[0] === 'help') return true;
  return args.some((arg) => HELP_FLAGS.has(arg));
}

function resolveHelpTopic(args: string[]): HelpTopic {
  const tokens = args[0] === 'help' ? args.slice(1) : args;
  const stopIndex = tokens.findIndex((arg) => arg.startsWith('-'));
  const head = stopIndex === -1 ? tokens : tokens.slice(0, stopIndex);
  const [first, second] = head;

  if (!first) return 'root';
  if (first === 'attach') return 'attach';
  if (first === 'update') return 'update';
  if (first === 'session') {
    if (second === 'list') return 'session.list';
    if (second === 'create') return 'session.create';
    return 'session';
  }
  if (first === 'layout') {
    if (second === 'export') return 'layout.export';
    if (second === 'import') return 'layout.import';
    return 'layout';
  }
  if (first === 'pane') {
    if (second === 'split') return 'pane.split';
    if (second === 'send') return 'pane.send';
    if (second === 'capture') return 'pane.capture';
    return 'pane';
  }
  return 'root';
}

function readOptionValue(
  args: string[],
  index: number,
  flag: string
): { value: string; nextIndex: number } | { error: string } {
  const arg = args[index];
  const eqIndex = arg.indexOf('=');
  if (eqIndex >= 0) {
    return { value: arg.slice(eqIndex + 1), nextIndex: index };
  }
  const next = args[index + 1];
  if (!next) {
    return { error: `Missing value for ${flag}.` };
  }
  return { value: next, nextIndex: index + 1 };
}

function parseWorkspace(value: string): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const intValue = Math.floor(num);
  if (intValue < 1 || intValue > 9) return null;
  return intValue;
}

function parsePaneOption(value: string): string | null {
  const parsed = parsePaneSelector(value);
  return parsed.ok ? value : null;
}

function unescapeCliText(value: string): string {
  let output = '';

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char !== '\\') {
      output += char;
      continue;
    }

    const next = value[i + 1];
    if (!next) {
      output += '\\';
      continue;
    }

    switch (next) {
      case 'n':
        output += '\n';
        i++;
        break;
      case 'r':
        output += '\r';
        i++;
        break;
      case 't':
        output += '\t';
        i++;
        break;
      case '0':
        output += '\0';
        i++;
        break;
      case '\\':
        output += '\\';
        i++;
        break;
      case '"':
        output += '"';
        i++;
        break;
      case "'":
        output += "'";
        i++;
        break;
      case 'x': {
        const hex = value.slice(i + 2, i + 4);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          output += String.fromCharCode(Number.parseInt(hex, 16));
          i += 3;
        } else {
          output += 'x';
          i++;
        }
        break;
      }
      case 'u': {
        const nextChar = value[i + 2];
        if (nextChar === '{') {
          const end = value.indexOf('}', i + 3);
          if (end !== -1) {
            const hex = value.slice(i + 3, end);
            if (/^[0-9a-fA-F]{1,6}$/.test(hex)) {
              output += String.fromCodePoint(Number.parseInt(hex, 16));
              i = end;
              break;
            }
          }
          output += 'u';
          i++;
          break;
        }

        const hex = value.slice(i + 2, i + 6);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) {
          output += String.fromCharCode(Number.parseInt(hex, 16));
          i += 5;
        } else {
          output += 'u';
          i++;
        }
        break;
      }
      default:
        output += next;
        i++;
        break;
    }
  }

  return output;
}

function parseAttach(args: string[]): ParseResult {
  let session: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--session' || arg.startsWith('--session=')) {
      const value = readOptionValue(args, i, '--session');
      if ('error' in value) return { ok: false, error: value.error };
      session = value.value;
      i = value.nextIndex;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  return { ok: true, command: { kind: 'attach', session } };
}

function parseSession(args: string[]): ParseResult {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (subcommand === 'list') {
    const json = rest.includes('--json');
    const unknown = rest.filter((arg) => arg !== '--json');
    if (unknown.length > 0) {
      return { ok: false, error: `Unknown argument: ${unknown[0]}` };
    }
    return { ok: true, command: { kind: 'session.list', json } };
  }

  if (subcommand === 'create') {
    const name = rest[0];
    if (rest.length > 1) {
      return { ok: false, error: 'Too many arguments for session create.' };
    }
    return { ok: true, command: { kind: 'session.create', name } };
  }

  return { ok: false, error: 'Unknown session command.' };
}

function parseUpdate(args: string[]): ParseResult {
  let yes = false;
  let prerelease = false;

  for (const arg of args) {
    if (arg === '--yes') {
      yes = true;
      continue;
    }
    if (arg === '--prerelease') {
      prerelease = true;
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  return { ok: true, command: { kind: 'update', yes, prerelease } };
}

function parseLayoutExport(args: string[]): ParseResult {
  let file: string | undefined;
  let name: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' || arg.startsWith('--file=')) {
      const value = readOptionValue(args, i, '--file');
      if ('error' in value) return { ok: false, error: value.error };
      file = value.value;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--name' || arg.startsWith('--name=')) {
      const value = readOptionValue(args, i, '--name');
      if ('error' in value) return { ok: false, error: value.error };
      name = value.value;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  return { ok: true, command: { kind: 'layout.export', file, name, json } };
}

function parseLayoutImport(args: string[]): ParseResult {
  let file: string | undefined;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' || arg.startsWith('--file=')) {
      const value = readOptionValue(args, i, '--file');
      if ('error' in value) return { ok: false, error: value.error };
      file = value.value;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--json') {
      json = true;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (!file) {
    return { ok: false, error: 'Missing --file.' };
  }

  return { ok: true, command: { kind: 'layout.import', file, json } };
}

function parseLayout(args: string[]): ParseResult {
  const subcommand = args[0];
  const rest = args.slice(1);

  if (subcommand === 'export') return parseLayoutExport(rest);
  if (subcommand === 'import') return parseLayoutImport(rest);
  return { ok: false, error: 'Unknown layout command.' };
}

function parsePaneSplit(args: string[]): ParseResult {
  let direction: 'horizontal' | 'vertical' | null = null;
  let workspaceId: number | undefined;
  let pane: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--direction' || arg.startsWith('--direction=')) {
      const value = readOptionValue(args, i, '--direction');
      if ('error' in value) return { ok: false, error: value.error };
      if (value.value !== 'horizontal' && value.value !== 'vertical') {
        return { ok: false, error: 'Direction must be horizontal or vertical.' };
      }
      direction = value.value;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--workspace' || arg.startsWith('--workspace=')) {
      const value = readOptionValue(args, i, '--workspace');
      if ('error' in value) return { ok: false, error: value.error };
      const parsed = parseWorkspace(value.value);
      if (parsed === null) return { ok: false, error: 'Workspace must be 1-9.' };
      workspaceId = parsed;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--pane' || arg.startsWith('--pane=')) {
      const value = readOptionValue(args, i, '--pane');
      if ('error' in value) return { ok: false, error: value.error };
      const parsed = parsePaneOption(value.value);
      if (!parsed) return { ok: false, error: 'Invalid pane selector.' };
      pane = parsed;
      i = value.nextIndex;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (!direction) {
    return { ok: false, error: 'Missing --direction.' };
  }

  return {
    ok: true,
    command: { kind: 'pane.split', direction, workspaceId, pane },
  };
}

function parsePaneSend(args: string[]): ParseResult {
  let text: string | null = null;
  let workspaceId: number | undefined;
  let pane: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--text' || arg.startsWith('--text=')) {
      const value = readOptionValue(args, i, '--text');
      if ('error' in value) return { ok: false, error: value.error };
      text = unescapeCliText(value.value);
      i = value.nextIndex;
      continue;
    }
    if (arg === '--workspace' || arg.startsWith('--workspace=')) {
      const value = readOptionValue(args, i, '--workspace');
      if ('error' in value) return { ok: false, error: value.error };
      const parsed = parseWorkspace(value.value);
      if (parsed === null) return { ok: false, error: 'Workspace must be 1-9.' };
      workspaceId = parsed;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--pane' || arg.startsWith('--pane=')) {
      const value = readOptionValue(args, i, '--pane');
      if ('error' in value) return { ok: false, error: value.error };
      const parsed = parsePaneOption(value.value);
      if (!parsed) return { ok: false, error: 'Invalid pane selector.' };
      pane = parsed;
      i = value.nextIndex;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  if (!text) {
    return { ok: false, error: 'Missing --text.' };
  }

  return { ok: true, command: { kind: 'pane.send', text, workspaceId, pane } };
}

function parsePaneCapture(args: string[]): ParseResult {
  let format: 'text' | 'ansi' = 'text';
  let lines = 200;
  let raw = false;
  let workspaceId: number | undefined;
  let pane: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' || arg.startsWith('--format=')) {
      const value = readOptionValue(args, i, '--format');
      if ('error' in value) return { ok: false, error: value.error };
      if (value.value !== 'text' && value.value !== 'ansi') {
        return { ok: false, error: 'Format must be text or ansi.' };
      }
      format = value.value;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--lines' || arg.startsWith('--lines=')) {
      const value = readOptionValue(args, i, '--lines');
      if ('error' in value) return { ok: false, error: value.error };
      const parsed = Number(value.value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, error: 'Lines must be a positive number.' };
      }
      lines = Math.floor(parsed);
      i = value.nextIndex;
      continue;
    }
    if (arg === '--raw') {
      raw = true;
      continue;
    }
    if (arg === '--workspace' || arg.startsWith('--workspace=')) {
      const value = readOptionValue(args, i, '--workspace');
      if ('error' in value) return { ok: false, error: value.error };
      const parsed = parseWorkspace(value.value);
      if (parsed === null) return { ok: false, error: 'Workspace must be 1-9.' };
      workspaceId = parsed;
      i = value.nextIndex;
      continue;
    }
    if (arg === '--pane' || arg.startsWith('--pane=')) {
      const value = readOptionValue(args, i, '--pane');
      if ('error' in value) return { ok: false, error: value.error };
      const parsed = parsePaneOption(value.value);
      if (!parsed) return { ok: false, error: 'Invalid pane selector.' };
      pane = parsed;
      i = value.nextIndex;
      continue;
    }

    return { ok: false, error: `Unknown argument: ${arg}` };
  }

  return { ok: true, command: { kind: 'pane.capture', format, lines, raw, workspaceId, pane } };
}

export function parseCliArgs(args: string[]): ParseResult {
  if (shouldShowHelp(args)) {
    return { ok: true, command: { kind: 'help', topic: resolveHelpTopic(args) } };
  }

  if (args.length === 0) {
    return { ok: true, command: { kind: 'attach' } };
  }

  const [command, ...rest] = args;
  if (command === 'attach') {
    return parseAttach(rest);
  }

  if (command === 'session') {
    return parseSession(rest);
  }

  if (command === 'update') {
    return parseUpdate(rest);
  }

  if (command === 'layout') {
    return parseLayout(rest);
  }

  if (command === 'pane') {
    const paneCommand = rest[0];
    const paneArgs = rest.slice(1);

    if (paneCommand === 'split') return parsePaneSplit(paneArgs);
    if (paneCommand === 'send') return parsePaneSend(paneArgs);
    if (paneCommand === 'capture') return parsePaneCapture(paneArgs);
    return { ok: false, error: 'Unknown pane command.' };
  }

  return { ok: false, error: `Unknown command: ${command}` };
}
