// src/layers/static-analysis/__tests__/traversal.test.ts

import {
  isTestFile,
  checkRunFullSuite,
  findBlockingCandidates,
} from '../graph/traversal';

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

describe('isTestFile', () => {
  it('returns true for a file inside /__tests__/ directory', () => {
    expect(isTestFile('src/__tests__/foo.ts')).toBe(true);
  });

  it('returns true for Windows __tests__ path separator', () => {
    expect(isTestFile('src\\__tests__\\foo.ts')).toBe(true);
  });

  it('returns true for *.test.ts', () => {
    expect(isTestFile('src/auth.test.ts')).toBe(true);
  });

  it('returns true for *.test.tsx', () => {
    expect(isTestFile('src/button.test.tsx')).toBe(true);
  });

  it('returns true for *.test.js', () => {
    expect(isTestFile('src/utils.test.js')).toBe(true);
  });

  it('returns true for *.spec.ts', () => {
    expect(isTestFile('src/auth.spec.ts')).toBe(true);
  });

  it('returns true for *.spec.tsx', () => {
    expect(isTestFile('src/modal.spec.tsx')).toBe(true);
  });

  it('returns true for *.spec.js', () => {
    expect(isTestFile('src/helpers.spec.js')).toBe(true);
  });

  it('returns true for *_test.go', () => {
    expect(isTestFile('pkg/server/handler_test.go')).toBe(true);
  });

  it('returns true for *_spec.rb', () => {
    expect(isTestFile('spec/models/user_spec.rb')).toBe(true);
  });

  it('returns true for test_*.py', () => {
    expect(isTestFile('tests/test_auth.py')).toBe(true);
  });

  it('returns true for *_test.py', () => {
    expect(isTestFile('tests/auth_test.py')).toBe(true);
  });

  it('returns false for a plain source file', () => {
    expect(isTestFile('src/auth.ts')).toBe(false);
  });

  it('returns false for a file with test in the directory name but not __tests__', () => {
    expect(isTestFile('testutils/helper.ts')).toBe(false);
  });

  it('returns false for a .go file that is not a test', () => {
    expect(isTestFile('pkg/server/handler.go')).toBe(false);
  });

  it('returns false for a .rb file that is not a spec', () => {
    expect(isTestFile('lib/user.rb')).toBe(false);
  });

  it('returns false for a .py file that is not a test', () => {
    expect(isTestFile('app/auth.py')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkRunFullSuite
// ---------------------------------------------------------------------------

describe('checkRunFullSuite', () => {
  it('returns true when a changed file matches a glob pattern (matchBase)', () => {
    expect(
      checkRunFullSuite(['src/config/settings.ts'], ['*.json', 'package.json', '*.ts']),
    ).toBe(true);
  });

  it('returns true when path is deep but matchBase applies', () => {
    expect(
      checkRunFullSuite(['a/b/c/package.json'], ['package.json']),
    ).toBe(true);
  });

  it('returns false when no changed file matches any pattern', () => {
    expect(
      checkRunFullSuite(['src/auth.ts'], ['*.json', '*.yaml']),
    ).toBe(false);
  });

  it('returns false for empty changedFiles', () => {
    expect(checkRunFullSuite([], ['*.ts'])).toBe(false);
  });

  it('returns false for empty runAllTestsOn', () => {
    expect(checkRunFullSuite(['src/auth.ts'], [])).toBe(false);
  });

  it('returns false when both arrays are empty', () => {
    expect(checkRunFullSuite([], [])).toBe(false);
  });

  it('matches glob wildcards correctly', () => {
    expect(
      checkRunFullSuite(['src/db/migrations/001_init.sql'], ['*.sql']),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// findBlockingCandidates — canonical S04 demo scenario
// ---------------------------------------------------------------------------

describe('findBlockingCandidates — canonical demo scenario', () => {
  /**
   * b.ts imports a.ts (a.ts is a dependency of b.ts)
   * b.ts also imports utils.ts
   * test/b.test.ts imports b.ts
   * utils.ts has no imports
   *
   * Forward graph (file → its imports):
   *   a.ts    → []           (a.ts imports nothing)
   *   b.ts    → ['a.ts']     (b.ts imports a.ts)
   *   utils.ts → []
   *   test/b.test.ts → ['b.ts']
   *
   * Reverse graph:
   *   a.ts  → {b.ts}                  (b.ts imports a.ts)
   *   b.ts  → {test/b.test.ts}        (test imports b.ts)
   *
   * BFS from changedFiles=['a.ts']:
   *   a.ts → b.ts → test/b.test.ts
   *
   * Expected blocking candidates: ['test/b.test.ts']
   */
  it('finds test/b.test.ts when a.ts is changed (demo scenario)', () => {
    const graph: Record<string, string[]> = {
      'a.ts': [],
      'b.ts': ['a.ts'],
      'utils.ts': [],
      'test/b.test.ts': ['b.ts'],
    };
    const result = findBlockingCandidates(['a.ts'], graph);
    expect(result).toEqual(['test/b.test.ts']);
  });
});

// ---------------------------------------------------------------------------
// findBlockingCandidates — additional cases
// ---------------------------------------------------------------------------

describe('findBlockingCandidates', () => {
  it('returns empty array for empty changedFiles', () => {
    const graph: Record<string, string[]> = {
      'a.ts': ['b.ts'],
      'b.test.ts': ['a.ts'],
    };
    expect(findBlockingCandidates([], graph)).toEqual([]);
  });

  it('returns empty array when changed file is not in the graph', () => {
    const graph: Record<string, string[]> = {
      'a.ts': ['b.ts'],
    };
    // 'ghost.ts' doesn't exist in the graph at all
    expect(findBlockingCandidates(['ghost.ts'], graph)).toEqual([]);
  });

  it('does not infinite-loop on a direct cycle (A → B → A)', () => {
    const graph: Record<string, string[]> = {
      'a.ts': ['b.ts'],
      'b.ts': ['a.ts'],
      'b.test.ts': ['b.ts'],
    };
    // Should terminate and still find the test
    const result = findBlockingCandidates(['a.ts'], graph);
    expect(result).toEqual(['b.test.ts']);
  });

  it('handles a longer cycle (A → B → C → A) without infinite loop', () => {
    const graph: Record<string, string[]> = {
      'a.ts': ['b.ts'],
      'b.ts': ['c.ts'],
      'c.ts': ['a.ts'],
      'c.test.ts': ['c.ts'],
    };
    const result = findBlockingCandidates(['a.ts'], graph);
    expect(result).toEqual(['c.test.ts']);
  });

  it('returns the changed file itself if it is a test file', () => {
    const graph: Record<string, string[]> = {
      'a.test.ts': ['util.ts'],
    };
    const result = findBlockingCandidates(['a.test.ts'], graph);
    expect(result).toEqual(['a.test.ts']);
  });

  it('collects multiple test files from different branches', () => {
    const graph: Record<string, string[]> = {
      'shared.ts': [],
      'feature-a.ts': ['shared.ts'],
      'feature-b.ts': ['shared.ts'],
      'feature-a.test.ts': ['feature-a.ts'],
      'feature-b.test.ts': ['feature-b.ts'],
    };
    // Changing shared.ts should reach both test files
    const result = findBlockingCandidates(['shared.ts'], graph);
    expect(result).toEqual(['feature-a.test.ts', 'feature-b.test.ts']);
  });

  it('returns results sorted alphabetically', () => {
    const graph: Record<string, string[]> = {
      'lib.ts': [],
      'z.test.ts': ['lib.ts'],
      'a.test.ts': ['lib.ts'],
      'm.test.ts': ['lib.ts'],
    };
    const result = findBlockingCandidates(['lib.ts'], graph);
    expect(result).toEqual(['a.test.ts', 'm.test.ts', 'z.test.ts']);
  });

  it('returns deduplicated results even if multiple changed files reach the same test', () => {
    const graph: Record<string, string[]> = {
      'a.ts': [],
      'b.ts': [],
      'shared.test.ts': ['a.ts', 'b.ts'],
    };
    const result = findBlockingCandidates(['a.ts', 'b.ts'], graph);
    expect(result).toEqual(['shared.test.ts']);
  });

  it('does not include non-test files in the output', () => {
    const graph: Record<string, string[]> = {
      'core.ts': [],
      'service.ts': ['core.ts'],
      'service.test.ts': ['service.ts'],
    };
    const result = findBlockingCandidates(['core.ts'], graph);
    // service.ts is reachable but not a test file — should NOT be in results
    expect(result).toEqual(['service.test.ts']);
    expect(result).not.toContain('service.ts');
  });
});
