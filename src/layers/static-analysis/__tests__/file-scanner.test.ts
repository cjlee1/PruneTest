// src/layers/static-analysis/__tests__/file-scanner.test.ts
// Unit tests for scanProjectFiles().
// Uses a real temp directory + injected parseFile param — no jest.mock on parsers.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { scanProjectFiles } from '../graph/file-scanner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a temp directory and return its absolute path. */
function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'file-scanner-test-'));
}

/** Write a file at <root>/<relPath>, creating parent dirs as needed. */
function touchFile(root: string, relPath: string, content = ''): void {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/** Remove a directory tree created by makeTempDir. */
function rmDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('scanProjectFiles', () => {
  // -------------------------------------------------------------------------
  // 1. Returns correct Map entries for mocked files
  // -------------------------------------------------------------------------
  it('returns correct Map entries for discovered files using injected parseFile', async () => {
    const root = makeTempDir();
    try {
      touchFile(root, 'src/a.ts', "import './b';");
      touchFile(root, 'src/b.ts', '');
      touchFile(root, 'lib/util.js', "const x = require('./helper');");

      const fakeImports: Record<string, string[]> = {
        'src/a.ts': ['./b'],
        'src/b.ts': [],
        'lib/util.js': ['./helper'],
      };

      const fakeParser = jest.fn(async (filePath: string) => {
        return fakeImports[filePath] ?? [];
      });

      const errors: string[] = [];
      const result = await scanProjectFiles(root, errors, fakeParser);

      expect(errors).toEqual([]);

      // All three files must be present
      const sortedKeys = Array.from(result.keys()).sort();
      expect(sortedKeys).toEqual(['lib/util.js', 'src/a.ts', 'src/b.ts'].sort());

      // Import lists must match injected values
      expect(result.get('src/a.ts')).toEqual(['./b']);
      expect(result.get('src/b.ts')).toEqual([]);
      expect(result.get('lib/util.js')).toEqual(['./helper']);

      // Injected parser was called for each file
      expect(fakeParser).toHaveBeenCalledTimes(3);
    } finally {
      rmDir(root);
    }
  });

  // -------------------------------------------------------------------------
  // 2. File read errors push to parsing_errors and continue (fail-open)
  // -------------------------------------------------------------------------
  it('pushes filePath to parsing_errors when readFileSync fails, and continues', async () => {
    const root = makeTempDir();
    try {
      // Write one readable file and one that will be made unreadable.
      touchFile(root, 'src/good.ts', "import './other';");
      touchFile(root, 'src/bad.ts', 'some content');

      // Make bad.ts unreadable (mode 000).
      const badPath = path.join(root, 'src/bad.ts');
      fs.chmodSync(badPath, 0o000);

      const fakeParser = jest.fn(async () => {
        return [];
      });

      const errors: string[] = [];
      const result = await scanProjectFiles(root, errors, fakeParser);

      // The unreadable file must be in errors
      expect(errors).toContain('src/bad.ts');

      // The readable file must still appear in the result (fail-open)
      expect(result.has('src/good.ts')).toBe(true);

      // The bad file must NOT appear in the result (skipped on read error)
      expect(result.has('src/bad.ts')).toBe(false);
    } finally {
      // Restore permissions so rmSync can delete.
      const badPath = path.join(root, 'src/bad.ts');
      try { fs.chmodSync(badPath, 0o644); } catch { /* ignore */ }
      rmDir(root);
    }
  });

  // -------------------------------------------------------------------------
  // 3. parseFile errors push to parsing_errors and store [] (fail-open)
  // -------------------------------------------------------------------------
  it('pushes filePath to parsing_errors when parseFile throws, stores empty array', async () => {
    const root = makeTempDir();
    try {
      touchFile(root, 'src/ok.ts', "import './dep';");
      touchFile(root, 'src/broken.ts', 'bad syntax %%%');

      const fakeParser = jest.fn(async (filePath: string) => {
        if (filePath === 'src/broken.ts') {
          throw new Error('parse failure');
        }
        return ['./dep'];
      });

      const errors: string[] = [];
      const result = await scanProjectFiles(root, errors, fakeParser);

      // broken.ts must be recorded in errors
      expect(errors).toContain('src/broken.ts');

      // broken.ts must still appear in the map with an empty array
      expect(result.has('src/broken.ts')).toBe(true);
      expect(result.get('src/broken.ts')).toEqual([]);

      // ok.ts is unaffected
      expect(result.get('src/ok.ts')).toEqual(['./dep']);
    } finally {
      rmDir(root);
    }
  });

  // -------------------------------------------------------------------------
  // 4. node_modules files are excluded by fast-glob ignore
  // -------------------------------------------------------------------------
  it('excludes files inside node_modules, .git, and dist directories', async () => {
    const root = makeTempDir();
    try {
      touchFile(root, 'src/main.ts', '');
      touchFile(root, 'node_modules/lodash/index.ts', '');
      touchFile(root, '.git/hooks/pre-commit.ts', '');
      touchFile(root, 'dist/bundle.js', '');

      const fakeParser = jest.fn(async () => []);
      const errors: string[] = [];
      const result = await scanProjectFiles(root, errors, fakeParser);

      const keys = Array.from(result.keys());

      // Only the project file should be present
      expect(keys).toContain('src/main.ts');
      expect(keys.some(k => k.startsWith('node_modules/'))).toBe(false);
      expect(keys.some(k => k.startsWith('.git/'))).toBe(false);
      expect(keys.some(k => k.startsWith('dist/'))).toBe(false);
    } finally {
      rmDir(root);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Empty project root returns empty map with no errors
  // -------------------------------------------------------------------------
  it('returns an empty map and no errors for a directory with no matching files', async () => {
    const root = makeTempDir();
    try {
      // Write a file with an extension we don't scan
      touchFile(root, 'README.md', '# Hello');
      touchFile(root, 'data.json', '{}');

      const fakeParser = jest.fn(async () => []);
      const errors: string[] = [];
      const result = await scanProjectFiles(root, errors, fakeParser);

      expect(result.size).toBe(0);
      expect(errors).toEqual([]);
      expect(fakeParser).not.toHaveBeenCalled();
    } finally {
      rmDir(root);
    }
  });

  // -------------------------------------------------------------------------
  // 6. Multiple language extensions are all discovered
  // -------------------------------------------------------------------------
  it('discovers files for all supported language extensions', async () => {
    const root = makeTempDir();
    try {
      touchFile(root, 'a.ts', '');
      touchFile(root, 'b.tsx', '');
      touchFile(root, 'c.js', '');
      touchFile(root, 'd.jsx', '');
      touchFile(root, 'e.mjs', '');
      touchFile(root, 'f.cjs', '');
      touchFile(root, 'g.py', '');
      touchFile(root, 'h.rb', '');
      touchFile(root, 'i.go', '');

      const discovered: string[] = [];
      const fakeParser = jest.fn(async (filePath: string) => {
        discovered.push(filePath);
        return [];
      });

      const errors: string[] = [];
      await scanProjectFiles(root, errors, fakeParser);

      const sortedDiscovered = discovered.sort();
      expect(sortedDiscovered).toEqual(
        ['a.ts', 'b.tsx', 'c.js', 'd.jsx', 'e.mjs', 'f.cjs', 'g.py', 'h.rb', 'i.go'].sort(),
      );
      expect(errors).toEqual([]);
    } finally {
      rmDir(root);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Multiple files with parse errors — all accumulate in parsing_errors
  // -------------------------------------------------------------------------
  it('accumulates multiple parse errors across files', async () => {
    const root = makeTempDir();
    try {
      touchFile(root, 'a.ts', '');
      touchFile(root, 'b.ts', '');
      touchFile(root, 'c.ts', '');

      const fakeParser = jest.fn(async (filePath: string) => {
        if (filePath === 'b.ts' || filePath === 'c.ts') {
          throw new Error('oops');
        }
        return [];
      });

      const errors: string[] = [];
      const result = await scanProjectFiles(root, errors, fakeParser);

      expect(errors.sort()).toEqual(['b.ts', 'c.ts'].sort());

      // All three files appear in result (b and c with empty arrays)
      expect(result.has('a.ts')).toBe(true);
      expect(result.has('b.ts')).toBe(true);
      expect(result.has('c.ts')).toBe(true);
      expect(result.get('b.ts')).toEqual([]);
      expect(result.get('c.ts')).toEqual([]);
    } finally {
      rmDir(root);
    }
  });
});
