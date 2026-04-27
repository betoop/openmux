import { describe, expect, test } from 'bun:test';
import { parseCliArgs } from '../../src/cli/parse';

describe('cli parser', () => {
  test('defaults to attach when no args', () => {
    const result = parseCliArgs([]);
    expect(result).toEqual({ ok: true, command: { kind: 'attach' } });
  });

  test('parses --help at root', () => {
    const result = parseCliArgs(['--help']);
    expect(result).toEqual({ ok: true, command: { kind: 'help', topic: 'root' } });
  });

  test('parses help topic for pane capture', () => {
    const result = parseCliArgs(['pane', 'capture', '--help']);
    expect(result).toEqual({ ok: true, command: { kind: 'help', topic: 'pane.capture' } });
  });

  test('parses help topic for layout export', () => {
    const result = parseCliArgs(['layout', 'export', '--help']);
    expect(result).toEqual({ ok: true, command: { kind: 'help', topic: 'layout.export' } });
  });

  test('parses attach --session', () => {
    const result = parseCliArgs(['attach', '--session', 'dev']);
    expect(result).toEqual({ ok: true, command: { kind: 'attach', session: 'dev' } });
  });

  test('parses update', () => {
    const result = parseCliArgs(['update']);
    expect(result).toEqual({
      ok: true,
      command: { kind: 'update', yes: false, prerelease: false },
    });
  });

  test('parses update flags', () => {
    const result = parseCliArgs(['update', '--yes', '--prerelease']);
    expect(result).toEqual({
      ok: true,
      command: { kind: 'update', yes: true, prerelease: true },
    });
  });

  test('parses update help topic', () => {
    const result = parseCliArgs(['update', '--help']);
    expect(result).toEqual({ ok: true, command: { kind: 'help', topic: 'update' } });
  });

  test('parses session list --json', () => {
    const result = parseCliArgs(['session', 'list', '--json']);
    expect(result).toEqual({ ok: true, command: { kind: 'session.list', json: true } });
  });

  test('parses layout export file options', () => {
    const result = parseCliArgs([
      'layout',
      'export',
      '--file',
      'layout.json',
      '--name',
      'dev',
      '--json',
    ]);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'layout.export',
        file: 'layout.json',
        name: 'dev',
        json: true,
      },
    });
  });

  test('parses layout import file options', () => {
    const result = parseCliArgs(['layout', 'import', '--file=layout.json', '--json']);
    expect(result).toEqual({
      ok: true,
      command: { kind: 'layout.import', file: 'layout.json', json: true },
    });
  });

  test('parses pane split', () => {
    const result = parseCliArgs([
      'pane',
      'split',
      '--direction',
      'vertical',
      '--workspace',
      '2',
      '--pane',
      'stack:1',
    ]);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.split',
        direction: 'vertical',
        workspaceId: 2,
        pane: 'stack:1',
      },
    });
  });

  test('parses pane send', () => {
    const result = parseCliArgs(['pane', 'send', '--text', 'npm test\n']);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.send',
        text: 'npm test\n',
      },
    });
  });

  test('unescapes pane send text', () => {
    const result = parseCliArgs(['pane', 'send', '--text', 'echo\\nline']);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.send',
        text: 'echo\nline',
      },
    });
  });

  test('parses pane capture --raw', () => {
    const result = parseCliArgs(['pane', 'capture', '--lines', '10', '--raw']);
    expect(result).toEqual({
      ok: true,
      command: {
        kind: 'pane.capture',
        format: 'text',
        lines: 10,
        raw: true,
      },
    });
  });

  test('reports missing direction', () => {
    const result = parseCliArgs(['pane', 'split']);
    expect(result.ok).toBe(false);
  });

  test('reports unknown update argument', () => {
    const result = parseCliArgs(['update', '--force']);
    expect(result.ok).toBe(false);
  });

  test('reports missing layout import file', () => {
    const result = parseCliArgs(['layout', 'import']);
    expect(result.ok).toBe(false);
  });
});
