// src/layers/static-analysis/__tests__/index.test.ts
// Integration tests for analyzeStaticDependencies.
// Uses real temp directories on disk with real .ts files.
// The parseFile param is injected to bypass tree-sitter WASM (which cannot use
// dynamic import in Jest VM context). The injected parser is a simple regex
// extractor that exercises the full graph/traversal pipeline with real file
// resolution on disk — the WASM constraint is a Jest VM limitation, not a
// production concern.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { SelectorConfig } from '../../../../shared/types';
import { analyzeStaticDependencies } from '../index';

// ---------------------------------------------------------------------------
// Minimal inline TypeScript import extractor — no WASM, no external deps.
// Handles:   import ... from '...'   and   require('...')
// This is enough to exercise the graph/traversal logic in integration tests.
// ---------------------------------------------------------------------------
async function simpleParseImports(
  _filePath: string,
  content: string,
): Promise<string[]> {
  const imports: string[] = [];
  let m: RegExpExecArray | null;

  // Match ES module imports with a `from` clause:
  //   import { b } from './b'
  //   import * as foo from '../foo'
  //   import foo from './foo'
  // Use a lazy match on the identifier clause so the space before `from`
  // is not consumed by the character class.
  const esFrom = /\bimport\s+(?:.+?\s+from\s+)['"]([^'"]+)['"]/g;
  while ((m = esFrom.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // Match bare side-effect imports: import './foo'
  const esBare = /\bimport\s+['"]([^'"]+)['"]/g;
  while ((m = esBare.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // Match re-export declarations: export { ... } from './foo'
  // These create a static dependency even though they use `export` not `import`.
  const esReExport = /\bexport\s+(?:.*?\s+from\s+)['"]([^'"]+)['"]/g;
  while ((m = esReExport.exec(content)) !== null) {
    imports.push(m[1]);
  }

  // Match CJS require: require('...')
  const cjsRequire = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = cjsRequire.exec(content)) !== null) {
    imports.push(m[1]);
  }

  return imports;
}

// ---------------------------------------------------------------------------
// Minimal SelectorConfig used across all tests.
// ---------------------------------------------------------------------------
const minimalConfig: SelectorConfig = {
  mode: 'shadow',
  testRunner: 'auto',
  testDir: '__tests__',
  runAllTestsOn: [],
  alwaysRun: [],
  neverRun: [],
  architectureNotes: '',
  flakyTestThreshold: 0.15,
  flakyTestQuarantine: 0.40,
  fullSuiteEvery: 50,
};

// ---------------------------------------------------------------------------
// Helper: write a file relative to a base directory, creating parent dirs.
// ---------------------------------------------------------------------------
function writeFile(base: string, relPath: string, content: string): void {
  const abs = path.join(base, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

// ---------------------------------------------------------------------------
// S04 demo scenario:
//   a.ts        → no imports (the changed file)
//   b.ts        → imports a.ts  (so changes to a.ts affect b.ts)
//   utils.ts    → no imports
//   __tests__/b.test.ts → imports b.ts  (so changes to b.ts affect b.test.ts)
//
// Changed: ['a.ts']
// Expected transitive closure: a.ts → b.ts → __tests__/b.test.ts
// Expected blocking_candidates: ['__tests__/b.test.ts']
// ---------------------------------------------------------------------------
describe('analyzeStaticDependencies — S04 demo scenario', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-analysis-demo-'));
    // a.ts: the changed file, no imports needed for the demo
    writeFile(tmpDir, 'a.ts', 'export const a = 1;\n');
    // b.ts imports a.ts → b.ts depends on a.ts
    writeFile(tmpDir, 'b.ts', "import { a } from './a';\nexport const b = a + 1;\n");
    writeFile(tmpDir, 'utils.ts', 'export const utils = 1;\n');
    // b.test.ts imports b.ts → b.test.ts depends on b.ts
    writeFile(tmpDir, '__tests__/b.test.ts', "import { b } from '../b';\ntest('b', () => { expect(b).toBe(2); });\n");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('blocking_candidates includes __tests__/b.test.ts', async () => {
    const result = await analyzeStaticDependencies(['a.ts'], tmpDir, minimalConfig, simpleParseImports);
    expect(result.blocking_candidates).toContain('__tests__/b.test.ts');
  });

  it('dependency_graph has entries for all scanned files', async () => {
    const result = await analyzeStaticDependencies(['a.ts'], tmpDir, minimalConfig, simpleParseImports);
    expect(Object.keys(result.dependency_graph)).toContain('a.ts');
    expect(Object.keys(result.dependency_graph)).toContain('b.ts');
    expect(Object.keys(result.dependency_graph)).toContain('utils.ts');
    expect(Object.keys(result.dependency_graph)).toContain('__tests__/b.test.ts');
  });

  it('parsing_errors is [] when no parse errors occur', async () => {
    const result = await analyzeStaticDependencies(['a.ts'], tmpDir, minimalConfig, simpleParseImports);
    expect(result.parsing_errors).toEqual([]);
  });

  it('processing_time_ms is >= 0', async () => {
    const result = await analyzeStaticDependencies(['a.ts'], tmpDir, minimalConfig, simpleParseImports);
    expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// run_full_suite triggers when changedFiles matches runAllTestsOn pattern
// ---------------------------------------------------------------------------
describe('analyzeStaticDependencies — run_full_suite', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-analysis-full-'));
    writeFile(tmpDir, 'package.json', '{"name":"test"}\n');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('run_full_suite is true when a changed file matches runAllTestsOn', async () => {
    const config: SelectorConfig = {
      ...minimalConfig,
      runAllTestsOn: ['package.json', '*.lock'],
    };
    const result = await analyzeStaticDependencies(['package.json'], tmpDir, config, simpleParseImports);
    expect(result.run_full_suite).toBe(true);
  });

  it('run_full_suite is false when no changed file matches runAllTestsOn', async () => {
    const config: SelectorConfig = {
      ...minimalConfig,
      runAllTestsOn: ['*.lock'],
    };
    const result = await analyzeStaticDependencies(['src/foo.ts'], tmpDir, config, simpleParseImports);
    expect(result.run_full_suite).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Empty changedFiles → empty blocking_candidates
// ---------------------------------------------------------------------------
describe('analyzeStaticDependencies — empty changedFiles', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-analysis-empty-'));
    writeFile(tmpDir, 'a.ts', "import { b } from './b';\n");
    writeFile(tmpDir, 'b.ts', 'export const b = 1;\n');
    writeFile(tmpDir, '__tests__/a.test.ts', "import { a } from '../a';\ntest('a', () => {});\n");
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty blocking_candidates when changedFiles is []', async () => {
    const result = await analyzeStaticDependencies([], tmpDir, minimalConfig, simpleParseImports);
    expect(result.blocking_candidates).toEqual([]);
  });

  it('still returns a populated dependency_graph for an empty changedFiles', async () => {
    const result = await analyzeStaticDependencies([], tmpDir, minimalConfig, simpleParseImports);
    expect(Object.keys(result.dependency_graph).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// returns a Promise
// ---------------------------------------------------------------------------
describe('analyzeStaticDependencies — Promise contract', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-analysis-promise-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns a Promise', () => {
    const p = analyzeStaticDependencies([], tmpDir, minimalConfig, simpleParseImports);
    expect(p).toBeInstanceOf(Promise);
    return p;
  });
});

// ---------------------------------------------------------------------------
// S05 alias demo scenario:
//   tsconfig.json:           "@/*" → "src/*"
//   src/auth/session.ts:     export const session = 1;
//   src/auth/index.ts:       export { session } from './session';   (barrel)
//   test/auth.test.ts:       import { session } from '@/auth';      (alias)
//
// Changed: ['src/auth/session.ts']
// Expected transitive closure:
//   src/auth/session.ts → src/auth/index.ts (barrel imports session)
//   src/auth/index.ts   → test/auth.test.ts (test imports via @/auth alias)
// Expected blocking_candidates: ['test/auth.test.ts']
// ---------------------------------------------------------------------------
describe('analyzeStaticDependencies — S05 alias demo scenario', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'static-analysis-s05-'));

    // tsconfig with @/* → src/* alias
    writeFile(
      tmpDir,
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      }),
    );

    // src/auth/session.ts — the changed file
    writeFile(tmpDir, 'src/auth/session.ts', 'export const session = 1;\n');

    // src/auth/index.ts — barrel re-exports session
    writeFile(
      tmpDir,
      'src/auth/index.ts',
      "export { session } from './session';\n",
    );

    // test/auth.test.ts — imports via @/auth alias (resolves to src/auth/index.ts)
    writeFile(
      tmpDir,
      'test/auth.test.ts',
      "import { session } from '@/auth';\ntest('session', () => { expect(session).toBe(1); });\n",
    );
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('blocking_candidates includes test/auth.test.ts via alias chain', async () => {
    const result = await analyzeStaticDependencies(
      ['src/auth/session.ts'],
      tmpDir,
      minimalConfig,
      simpleParseImports,
    );
    expect(result.blocking_candidates).toContain('test/auth.test.ts');
  });

  it('dependency_graph has edge from test/auth.test.ts to src/auth/index.ts (alias resolved)', async () => {
    const result = await analyzeStaticDependencies(
      ['src/auth/session.ts'],
      tmpDir,
      minimalConfig,
      simpleParseImports,
    );
    expect(result.dependency_graph['test/auth.test.ts']).toContain('src/auth/index.ts');
  });

  it('dependency_graph has edge from src/auth/index.ts to src/auth/session.ts (barrel)', async () => {
    const result = await analyzeStaticDependencies(
      ['src/auth/session.ts'],
      tmpDir,
      minimalConfig,
      simpleParseImports,
    );
    expect(result.dependency_graph['src/auth/index.ts']).toContain('src/auth/session.ts');
  });
});
