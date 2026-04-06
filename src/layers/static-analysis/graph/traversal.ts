// src/layers/static-analysis/graph/traversal.ts
// Pure synchronous traversal: reverse-graph BFS, test-file detection, and
// run-full-suite check. No fs, no async, no WASM.

import * as path from 'path';
import { minimatch } from 'minimatch';

// ---------------------------------------------------------------------------
// isTestFile
// ---------------------------------------------------------------------------

/**
 * Return true if the given file path looks like a test file.
 *
 * Recognised patterns:
 *   - path contains /__tests__/ or \__tests__\
 *   - *.test.ts  *.test.tsx  *.test.js
 *   - *.spec.ts  *.spec.tsx  *.spec.js
 *   - *_test.go
 *   - *_spec.rb
 *   - test_*.py  or  *_test.py
 */
export function isTestFile(filePath: string): boolean {
  // Directory segment check (handles both separators)
  if (filePath.includes('/__tests__/') || filePath.includes('\\__tests__\\')) {
    return true;
  }

  const base = path.basename(filePath);

  // JS / TS — *.test.{ts,tsx,js} and *.spec.{ts,tsx,js}
  if (
    base.endsWith('.test.ts') ||
    base.endsWith('.test.tsx') ||
    base.endsWith('.test.js') ||
    base.endsWith('.spec.ts') ||
    base.endsWith('.spec.tsx') ||
    base.endsWith('.spec.js')
  ) {
    return true;
  }

  // Go — *_test.go
  if (base.endsWith('_test.go')) {
    return true;
  }

  // Ruby — *_spec.rb
  if (base.endsWith('_spec.rb')) {
    return true;
  }

  // Python — test_*.py  or  *_test.py
  if (
    (base.startsWith('test_') && base.endsWith('.py')) ||
    base.endsWith('_test.py')
  ) {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// checkRunFullSuite
// ---------------------------------------------------------------------------

/**
 * Return true if any file in `changedFiles` matches any glob pattern in
 * `runAllTestsOn` (using minimatch v9 with matchBase: true).
 */
export function checkRunFullSuite(
  changedFiles: string[],
  runAllTestsOn: string[],
): boolean {
  for (const file of changedFiles) {
    for (const pattern of runAllTestsOn) {
      if (minimatch(file, pattern, { matchBase: true })) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// findBlockingCandidates
// ---------------------------------------------------------------------------

/**
 * BFS through the reverse dependency graph to find all test files reachable
 * from any of the changed files.
 *
 * @param changedFiles     - projectRoot-relative paths of changed source files.
 * @param dependencyGraph  - Forward graph: file → files it imports.
 * @returns Sorted, deduplicated list of test-file paths in the transitive
 *          closure of the changed files.
 */
export function findBlockingCandidates(
  changedFiles: string[],
  dependencyGraph: Record<string, string[]>,
): string[] {
  // Build reverse graph: imported file → Set of files that import it.
  const reverseGraph = new Map<string, Set<string>>();

  for (const [file, imports] of Object.entries(dependencyGraph)) {
    // Ensure every node in the graph appears in the reverse graph even if
    // nothing imports it (so BFS can start from changedFiles safely).
    if (!reverseGraph.has(file)) {
      reverseGraph.set(file, new Set());
    }
    for (const imported of imports) {
      if (!reverseGraph.has(imported)) {
        reverseGraph.set(imported, new Set());
      }
      reverseGraph.get(imported)!.add(file);
    }
  }

  // BFS from each changed file through the reverse graph.
  const visited = new Set<string>();
  const queue: string[] = [...changedFiles];

  // Seed visited with the starting nodes so we include them in reachability
  // but avoid re-processing.
  for (const f of changedFiles) {
    visited.add(f);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const dependents = reverseGraph.get(current);
    if (!dependents) continue;
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        visited.add(dep);
        queue.push(dep);
      }
    }
  }

  // Filter to test files, sort, and deduplicate (Set already deduplicates).
  const results = Array.from(visited)
    .filter(isTestFile)
    .sort();

  return results;
}
