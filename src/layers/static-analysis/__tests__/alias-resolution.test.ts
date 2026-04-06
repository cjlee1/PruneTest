// src/layers/static-analysis/__tests__/alias-resolution.test.ts
// Unit tests for TypeScript path alias expansion in resolveImport() and
// buildDependencyGraph(). Uses real temp directories (fs.mkdtempSync).

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveImport, buildDependencyGraph } from '../graph/path-resolver';
import { PathAliasMap } from '../graph/tsconfig-reader';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory and return its absolute path. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'alias-resolution-test-'));
}

/** Write a file at <root>/<relPath>, creating parent dirs as needed. */
function touchFile(root: string, relPath: string, content = ''): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/**
 * Build a minimal PathAliasMap for tests.
 * baseUrl is always the tmpDir itself (mirrors "baseUrl: '.'").
 */
function makeAliases(
  tmpDir: string,
  patterns: Array<{
    pattern: string;
    targets: string[];
  }>,
): PathAliasMap {
  const aliases = patterns.map(({ pattern, targets }) => {
    const isWildcard = pattern.includes('*');
    const prefix = isWildcard ? pattern.slice(0, pattern.indexOf('*')) : '';
    return { pattern, isWildcard, prefix, targets };
  });

  // Sort: longer patterns first; exact before wildcard at equal length.
  aliases.sort((a, b) => {
    if (b.pattern.length !== a.pattern.length) {
      return b.pattern.length - a.pattern.length;
    }
    if (!a.isWildcard && b.isWildcard) return -1;
    if (a.isWildcard && !b.isWildcard) return 1;
    return 0;
  });

  return { baseUrl: tmpDir, aliases };
}

// ---------------------------------------------------------------------------
// resolveImport — alias expansion: basic wildcard
// ---------------------------------------------------------------------------

describe('resolveImport — TypeScript alias expansion', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('expands @/auth alias to src/auth/index.ts (wildcard, directory import)', () => {
    touchFile(root, 'src/auth/index.ts');
    const aliases = makeAliases(root, [{ pattern: '@/*', targets: ['src/*'] }]);
    const result = resolveImport('@/auth', 'test/auth.test.ts', root, aliases);
    expect(result).toBe('src/auth/index.ts');
  });

  it('expands @/auth/session alias to src/auth/session.ts (wildcard, file import)', () => {
    touchFile(root, 'src/auth/session.ts');
    const aliases = makeAliases(root, [{ pattern: '@/*', targets: ['src/*'] }]);
    const result = resolveImport('@/auth/session', 'test/auth.test.ts', root, aliases);
    expect(result).toBe('src/auth/session.ts');
  });

  it('returns null when aliases is null (no regression for non-TS projects)', () => {
    touchFile(root, 'src/auth/index.ts');
    const result = resolveImport('@/auth', 'test/auth.test.ts', root, null);
    expect(result).toBeNull();
  });

  it('returns null when aliases is undefined (default: no alias expansion)', () => {
    touchFile(root, 'src/auth/index.ts');
    const result = resolveImport('@/auth', 'test/auth.test.ts', root);
    expect(result).toBeNull();
  });

  it('still resolves ./relative imports when aliases is provided (no regression)', () => {
    touchFile(root, 'src/utils.ts');
    const aliases = makeAliases(root, [{ pattern: '@/*', targets: ['src/*'] }]);
    const result = resolveImport('./utils', 'src/foo.ts', root, aliases);
    expect(result).toBe('src/utils.ts');
  });

  it('exact alias @/auth takes precedence over wildcard @/* when both present', () => {
    // @/auth (exact) → ['lib/auth.ts']   (should win)
    // @/*   (wildcard) → ['src/*']        (would give src/auth/index.ts)
    touchFile(root, 'lib/auth.ts');
    touchFile(root, 'src/auth/index.ts');

    // makeAliases sorts longer-first, exact-before-wildcard automatically.
    // '@/auth' (6 chars) is shorter than '@/*' (3 chars) ... wait, @/auth = 6,
    // @/* = 3 — so @/auth is longer and already wins on length.
    // Create equal-length patterns to test exact-before-wildcard tie-break:
    // exact '@/x' (3 chars) vs wildcard '@/*' (3 chars).
    const aliases = makeAliases(root, [
      { pattern: '@/auth', targets: ['lib/auth.ts'] },
      { pattern: '@/*', targets: ['src/*'] },
    ]);
    const result = resolveImport('@/auth', 'test/auth.test.ts', root, aliases);
    // Should resolve via exact alias → lib/auth.ts
    expect(result).toBe('lib/auth.ts');
  });

  it('tries second target when first target does not exist on disk', () => {
    // First target: src/auth.ts (doesn't exist)
    // Second target: lib/auth.ts (exists)
    touchFile(root, 'lib/auth.ts');
    const aliases = makeAliases(root, [
      { pattern: '@/*', targets: ['src/*', 'lib/*'] },
    ]);
    const result = resolveImport('@/auth', 'test/auth.test.ts', root, aliases);
    expect(result).toBe('lib/auth.ts');
  });

  it('returns null when no alias pattern matches the import', () => {
    touchFile(root, 'src/auth/index.ts');
    const aliases = makeAliases(root, [{ pattern: '~/*', targets: ['src/*'] }]);
    const result = resolveImport('@/auth', 'test/auth.test.ts', root, aliases);
    // No alias matches '@/auth' with pattern '~/*' → falls through → null
    expect(result).toBeNull();
  });

  it('returns null when alias matches but no target file exists', () => {
    // No files created in root.
    const aliases = makeAliases(root, [{ pattern: '@/*', targets: ['src/*'] }]);
    const result = resolveImport('@/auth', 'test/auth.test.ts', root, aliases);
    expect(result).toBeNull();
  });

  it('handles exact alias pattern without wildcard', () => {
    // Exact alias: '@/auth' → 'src/auth/index.ts' (file with extension)
    touchFile(root, 'src/auth/index.ts');
    const aliases = makeAliases(root, [
      { pattern: '@/auth', targets: ['src/auth/index.ts'] },
    ]);
    const result = resolveImport('@/auth', 'test/auth.test.ts', root, aliases);
    expect(result).toBe('src/auth/index.ts');
  });

  it('probes .tsx extension for alias-expanded path', () => {
    touchFile(root, 'src/components/Button.tsx');
    const aliases = makeAliases(root, [{ pattern: '@/*', targets: ['src/*'] }]);
    const result = resolveImport('@/components/Button', 'test/ui.test.ts', root, aliases);
    expect(result).toBe('src/components/Button.tsx');
  });
});

// ---------------------------------------------------------------------------
// buildDependencyGraph — alias expansion
// ---------------------------------------------------------------------------

describe('buildDependencyGraph — TypeScript alias expansion', () => {
  let root: string;

  beforeEach(() => {
    root = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('graph correctly contains resolved alias path as dependency', () => {
    touchFile(root, 'src/auth/session.ts');
    const aliases = makeAliases(root, [{ pattern: '@/*', targets: ['src/*'] }]);

    const map = new Map([
      ['test/auth.test.ts', ['@/auth/session']],
    ]);
    const graph = buildDependencyGraph(map, root, aliases);

    expect(graph['test/auth.test.ts']).toEqual(['src/auth/session.ts']);
  });

  it('graph with mixed alias and relative imports resolves both correctly', () => {
    touchFile(root, 'src/auth/session.ts');
    touchFile(root, 'test/helpers.ts');
    const aliases = makeAliases(root, [{ pattern: '@/*', targets: ['src/*'] }]);

    const map = new Map([
      ['test/auth.test.ts', ['@/auth/session', './helpers']],
    ]);
    const graph = buildDependencyGraph(map, root, aliases);

    expect(graph['test/auth.test.ts']).toEqual([
      'src/auth/session.ts',
      'test/helpers.ts',
    ]);
  });

  it('graph without aliases param does not resolve @/ imports', () => {
    touchFile(root, 'src/auth/session.ts');
    const map = new Map([
      ['test/auth.test.ts', ['@/auth/session']],
    ]);
    // No aliases passed — @/auth/session should be dropped.
    const graph = buildDependencyGraph(map, root);

    expect(graph['test/auth.test.ts']).toEqual([]);
  });
});
