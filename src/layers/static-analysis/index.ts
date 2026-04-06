// src/layers/static-analysis/index.ts
// Layer 1 entry point: static dependency analysis via import tracing and
// config-change detection.

import type { Layer1Result, SelectorConfig } from '../../../shared/types';
import { scanProjectFiles } from './graph/file-scanner';
import { buildDependencyGraph } from './graph/path-resolver';
import { findBlockingCandidates, checkRunFullSuite } from './graph/traversal';
import { loadTsAliases } from './graph/tsconfig-reader';

/**
 * Layer 1 entry point: static dependency analysis.
 *
 * 1. Checks whether any changed file matches config.runAllTestsOn → run_full_suite.
 * 2. Scans and parses all project source files → rawImportMap.
 * 3. Resolves raw imports to projectRoot-relative paths → dependency_graph.
 * 4. BFS through the reverse graph from changedFiles → blocking_candidates.
 *
 * Fail-open (AGENTS.md rule 1): parse errors are collected in parsing_errors
 * and do not throw.
 *
 * @param changedFiles - Alphabetically sorted list of changed file paths (AGENTS.md rule 4).
 * @param projectRoot  - Absolute path to the repository root.
 * @param config       - Parsed SelectorConfig from .testselector.yml.
 * @param parseFile    - Optional injectable parser (mirrors scanProjectFiles signature).
 *                       When provided, replaces the real language-parser dispatch.
 *                       Intended for tests that cannot use tree-sitter WASM in Jest VMs.
 * @returns Layer1Result with dependency graph, blocking candidates, and parse errors.
 */
export async function analyzeStaticDependencies(
  changedFiles: string[],
  projectRoot: string,
  config: SelectorConfig,
  parseFile?: (filePath: string, content: string) => Promise<string[]>,
): Promise<Layer1Result> {
  const t0 = Date.now();
  const parsing_errors: string[] = [];

  // 0. Auto-discover TypeScript path aliases from projectRoot/tsconfig.json.
  const aliases = loadTsAliases(projectRoot);

  // 1. run_full_suite check — fast, synchronous, no I/O.
  const run_full_suite = checkRunFullSuite(changedFiles, config.runAllTestsOn);

  // 2. Scan + parse all files under projectRoot.
  const rawImportMap = await scanProjectFiles(projectRoot, parsing_errors, parseFile);

  // 3. Resolve raw import strings to projectRoot-relative paths.
  const dependency_graph = buildDependencyGraph(rawImportMap, projectRoot, aliases);

  // 4. BFS through the reverse graph to find test files in the transitive closure.
  const blocking_candidates = findBlockingCandidates(changedFiles, dependency_graph);

  return {
    blocking_candidates,
    run_full_suite,
    dependency_graph,
    parsing_errors,
    processing_time_ms: Date.now() - t0,
  };
}
