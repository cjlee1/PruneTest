// src/layers/static-analysis/__tests__/path-resolver.test.ts
// Unit tests for resolveImport() and buildDependencyGraph().
// Uses real temp directories (fs.mkdtempSync) for isolation — no mocking of fs.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveImport, buildDependencyGraph } from '../graph/path-resolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory and return its absolute path. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'path-resolver-test-'));
}

/** Write a file at <root>/<relPath>, creating parent dirs as needed. */
function touchFile(root: string, relPath: string, content = ''): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Create a directory tree in <root>. */
function makeDir(root: string, relPath: string): void {
  fs.mkdirSync(path.join(root, relPath), { recursive: true });
}

// ---------------------------------------------------------------------------
// resolveImport — TS/JS relative imports
// ---------------------------------------------------------------------------

describe('resolveImport — TS/JS relative imports', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('probes .ts extension for ./foo import', () => {
    touchFile(root, 'src/foo.ts');
    const result = resolveImport('./foo', 'src/bar.ts', root);
    expect(result).toBe('src/foo.ts');
  });

  it('probes .tsx extension when .ts is absent', () => {
    touchFile(root, 'src/foo.tsx');
    const result = resolveImport('./foo', 'src/bar.ts', root);
    expect(result).toBe('src/foo.tsx');
  });

  it('probes .js extension after .ts/.tsx are absent', () => {
    touchFile(root, 'src/foo.js');
    const result = resolveImport('./foo', 'src/bar.ts', root);
    expect(result).toBe('src/foo.js');
  });

  it('probes .jsx extension', () => {
    touchFile(root, 'src/foo.jsx');
    const result = resolveImport('./foo', 'src/bar.ts', root);
    expect(result).toBe('src/foo.jsx');
  });

  it('probes /index.ts fallback', () => {
    touchFile(root, 'src/foo/index.ts');
    const result = resolveImport('./foo', 'src/bar.ts', root);
    expect(result).toBe('src/foo/index.ts');
  });

  it('probes /index.tsx fallback', () => {
    touchFile(root, 'src/foo/index.tsx');
    const result = resolveImport('./foo', 'src/bar.ts', root);
    expect(result).toBe('src/foo/index.tsx');
  });

  it('probes /index.js fallback', () => {
    touchFile(root, 'src/foo/index.js');
    const result = resolveImport('./foo', 'src/bar.ts', root);
    expect(result).toBe('src/foo/index.js');
  });

  it('returns the path directly when extension is already present', () => {
    touchFile(root, 'src/utils.ts');
    const result = resolveImport('./utils.ts', 'src/main.ts', root);
    expect(result).toBe('src/utils.ts');
  });

  it('returns null when extension present but file does not exist', () => {
    const result = resolveImport('./missing.ts', 'src/main.ts', root);
    expect(result).toBeNull();
  });

  it('resolves ../ navigation correctly', () => {
    touchFile(root, 'shared/helpers.ts');
    const result = resolveImport('../shared/helpers', 'src/main.ts', root);
    expect(result).toBe('shared/helpers.ts');
  });

  it('returns null when no extension probe succeeds', () => {
    const result = resolveImport('./nonexistent', 'src/bar.ts', root);
    expect(result).toBeNull();
  });

  it('resolves nested subdirectory import', () => {
    touchFile(root, 'src/utils/format.ts');
    const result = resolveImport('./utils/format', 'src/index.ts', root);
    expect(result).toBe('src/utils/format.ts');
  });
});

// ---------------------------------------------------------------------------
// resolveImport — external / npm packages
// ---------------------------------------------------------------------------

describe('resolveImport — external and npm packages', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns null for an npm package name', () => {
    expect(resolveImport('lodash', 'src/foo.ts', root)).toBeNull();
  });

  it('returns null for a scoped npm package', () => {
    expect(resolveImport('@types/node', 'src/foo.ts', root)).toBeNull();
  });

  it('returns null for Node.js stdlib (fs)', () => {
    expect(resolveImport('fs', 'src/foo.ts', root)).toBeNull();
  });

  it('returns null for Node.js stdlib (path)', () => {
    expect(resolveImport('path', 'src/foo.ts', root)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveImport — Python relative imports
// ---------------------------------------------------------------------------

describe('resolveImport — Python relative imports', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves single-dot same-dir Python import (.sibling)', () => {
    touchFile(root, 'pkg/sibling.py');
    const result = resolveImport('.sibling', 'pkg/main.py', root);
    expect(result).toBe('pkg/sibling.py');
  });

  it('resolves double-dot parent-dir Python import (..parent_mod)', () => {
    // Two dots from pkg/sub/main.py → parent of pkg/sub → pkg/parent_mod.py
    touchFile(root, 'pkg/parent_mod.py');
    const result = resolveImport('..parent_mod', 'pkg/sub/main.py', root);
    expect(result).toBe('pkg/parent_mod.py');
  });

  it('returns null when Python relative import target does not exist', () => {
    const result = resolveImport('.missing', 'pkg/main.py', root);
    expect(result).toBeNull();
  });

  it('resolves dotted sub-package path (.sub.module)', () => {
    touchFile(root, 'pkg/sub/module.py');
    const result = resolveImport('.sub.module', 'pkg/main.py', root);
    expect(result).toBe('pkg/sub/module.py');
  });
});

// ---------------------------------------------------------------------------
// resolveImport — Ruby imports
// ---------------------------------------------------------------------------

describe('resolveImport — Ruby imports', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('probes .rb extension for bare Ruby require', () => {
    touchFile(root, 'lib/helper.rb');
    const result = resolveImport('lib/helper', 'app/main.rb', root);
    expect(result).toBe('lib/helper.rb');
  });

  it('returns the path as-is when .rb extension already present', () => {
    touchFile(root, 'lib/helper.rb');
    const result = resolveImport('lib/helper.rb', 'app/main.rb', root);
    expect(result).toBe('lib/helper.rb');
  });

  it('returns null when Ruby file does not exist', () => {
    const result = resolveImport('lib/missing', 'app/main.rb', root);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveImport — Go intra-project imports
// ---------------------------------------------------------------------------

describe('resolveImport — Go intra-project imports', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns the import path when directory contains .go files', () => {
    touchFile(root, 'pkg/handlers/handler.go');
    const result = resolveImport('pkg/handlers', 'cmd/main.go', root);
    expect(result).toBe('pkg/handlers');
  });

  it('returns null when directory exists but has no .go files', () => {
    makeDir(root, 'pkg/empty');
    const result = resolveImport('pkg/empty', 'cmd/main.go', root);
    expect(result).toBeNull();
  });

  it('returns null when Go import path directory does not exist', () => {
    const result = resolveImport('pkg/missing', 'cmd/main.go', root);
    expect(result).toBeNull();
  });

  it('returns null for external Go module (has dot in first segment)', () => {
    // e.g. github.com/some/pkg — isRubyImport would reject this too
    const result = resolveImport('github.com/user/repo', 'cmd/main.go', root);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph
// ---------------------------------------------------------------------------

describe('buildDependencyGraph', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('returns a record with resolved paths', () => {
    touchFile(root, 'src/b.ts');
    const map = new Map([['src/a.ts', ['./b']]]);
    const graph = buildDependencyGraph(map, root);
    expect(graph).toEqual({ 'src/a.ts': ['src/b.ts'] });
  });

  it('includes all keys even when imports array is empty', () => {
    const map = new Map([
      ['src/a.ts', []],
      ['src/b.ts', []],
    ]);
    const graph = buildDependencyGraph(map, root);
    expect(graph).toEqual({ 'src/a.ts': [], 'src/b.ts': [] });
  });

  it('deduplicates imports that resolve to the same file', () => {
    touchFile(root, 'src/shared.ts');
    // Two different raw strings that resolve to the same file
    const map = new Map([['src/a.ts', ['./shared', './shared.ts']]]);
    const graph = buildDependencyGraph(map, root);
    expect(graph['src/a.ts']).toEqual(['src/shared.ts']);
  });

  it('drops null resolutions (external / unresolvable imports)', () => {
    touchFile(root, 'src/b.ts');
    const map = new Map([['src/a.ts', ['lodash', './b', 'react']]]);
    const graph = buildDependencyGraph(map, root);
    expect(graph['src/a.ts']).toEqual(['src/b.ts']);
  });

  it('sorts resolved paths alphabetically', () => {
    touchFile(root, 'src/z.ts');
    touchFile(root, 'src/a.ts');
    touchFile(root, 'src/m.ts');
    const map = new Map([['src/index.ts', ['./z', './a', './m']]]);
    const graph = buildDependencyGraph(map, root);
    expect(graph['src/index.ts']).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts']);
  });

  it('handles multiple files correctly', () => {
    touchFile(root, 'src/c.ts');
    touchFile(root, 'src/d.ts');
    const map = new Map([
      ['src/a.ts', ['./c']],
      ['src/b.ts', ['./d', 'lodash']],
    ]);
    const graph = buildDependencyGraph(map, root);
    expect(graph).toEqual({
      'src/a.ts': ['src/c.ts'],
      'src/b.ts': ['src/d.ts'],
    });
  });

  it('returns an empty record for an empty map', () => {
    const graph = buildDependencyGraph(new Map(), root);
    expect(graph).toEqual({});
  });
});
