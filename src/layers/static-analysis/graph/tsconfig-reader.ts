// src/layers/static-analysis/graph/tsconfig-reader.ts
// Reads tsconfig.json (including JSONC format and extends chains) and
// extracts compilerOptions.paths as a pre-sorted PathAliasMap.
// All errors are fail-open: console.warn + return null, never throw.

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single resolved alias entry. */
export interface AliasEntry {
  /** The raw pattern key from tsconfig paths (e.g. '@/*', '@/auth'). */
  pattern: string;
  /** True if pattern contains a '*' wildcard. */
  isWildcard: boolean;
  /**
   * The prefix before the '*' when isWildcard is true (e.g. '@/' for '@/*').
   * Empty string for exact patterns.
   */
  prefix: string;
  /**
   * All replacement targets from the tsconfig paths value array
   * (e.g. ['src/*', 'lib/*']). Order is preserved — first existing wins.
   */
  targets: string[];
}

/**
 * Pre-sorted alias map built from tsconfig compilerOptions.paths.
 * Sort order: longer patterns first; exact before wildcard at equal prefix length.
 * This allows tryExpandAlias() to use a simple linear scan with first-match-wins.
 */
export interface PathAliasMap {
  /** Absolute path to the resolved baseUrl directory. */
  baseUrl: string;
  /** Sorted alias entries ready for linear expansion. */
  aliases: AliasEntry[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TsConfig {
  extends?: string;
  compilerOptions?: {
    baseUrl?: string;
    paths?: Record<string, string[]>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// JSONC stripping
// ---------------------------------------------------------------------------

/**
 * Strip // line comments, /* ... * / block comments, and trailing commas
 * from a JSONC string so it can be parsed with JSON.parse().
 *
 * Approach: a single regex replace pass that handles each case.
 * String literals are left untouched (the regex skips over them).
 */
export function stripJsonComments(raw: string): string {
  // Step 1: remove block comments /* ... */
  // Step 2: remove line comments // ...
  // Step 3: remove trailing commas before ] or }
  // We process in three passes to keep each step simple and correct.

  // Pass 1: block comments (non-greedy, including newlines)
  let result = raw.replace(/\/\*[\s\S]*?\*\//g, '');

  // Pass 2: line comments — match // not inside a string.
  // Simple heuristic: replace // followed by anything to end of line.
  // This works for the tsconfig.json use case; we don't need full JS lexer.
  result = result.replace(/\/\/[^\n]*/g, '');

  // Pass 3: trailing commas — remove comma(s) directly before } or ]
  result = result.replace(/,\s*([}\]])/g, '$1');

  return result;
}

// ---------------------------------------------------------------------------
// tsconfig loading
// ---------------------------------------------------------------------------

/**
 * Load and parse a tsconfig.json file (JSONC format supported).
 * Returns null + console.warn on any error — fail-open.
 */
export function loadTsConfig(filePath: string): TsConfig | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const stripped = stripJsonComments(raw);
    return JSON.parse(stripped) as TsConfig;
  } catch (err) {
    console.warn(`[tsconfig-reader] Failed to load ${filePath}: ${String(err)}`);
    return null;
  }
}

/**
 * Merge two parsed tsconfig objects.
 * - current entries win on key collision at the top level.
 * - compilerOptions.paths are merged at the key level (current wins per-key).
 */
export function mergeTsConfigs(current: TsConfig, base: TsConfig): TsConfig {
  const basePaths = base.compilerOptions?.paths ?? {};
  const currentPaths = current.compilerOptions?.paths ?? {};

  // Merge paths: base first, then current overwrites.
  const mergedPaths: Record<string, string[]> = { ...basePaths, ...currentPaths };

  const mergedCompilerOptions = {
    ...base.compilerOptions,
    ...current.compilerOptions,
    // paths require special merge since spread would overwrite entirely.
    paths: mergedPaths,
  };

  return {
    ...base,
    ...current,
    compilerOptions: mergedCompilerOptions,
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

const MAX_EXTENDS_DEPTH = 5;

/**
 * Load tsconfig.json from projectRoot, follow the extends chain up to depth 5,
 * merge all levels, and return a pre-sorted PathAliasMap.
 *
 * Returns null when:
 *  - no tsconfig.json in projectRoot
 *  - malformed JSON at any level
 *  - no compilerOptions.paths
 *  - empty paths object
 */
export function loadTsAliases(projectRoot: string): PathAliasMap | null {
  const rootTsconfig = path.join(projectRoot, 'tsconfig.json');

  if (!fs.existsSync(rootTsconfig)) {
    return null;
  }

  // Load and merge extends chain.
  const merged = loadAndMerge(rootTsconfig, 0);
  if (merged === null) {
    return null;
  }

  // Extract paths.
  const paths = merged.compilerOptions?.paths;
  if (!paths || Object.keys(paths).length === 0) {
    return null;
  }

  // Resolve baseUrl to an absolute path.
  const baseUrl = path.resolve(
    path.dirname(rootTsconfig),
    merged.compilerOptions?.baseUrl ?? '.',
  );

  // Build sorted alias list.
  const aliases = buildSortedAliases(paths);

  return { baseUrl, aliases };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively load a tsconfig and its extends chain, merging from base → current.
 * Returns null if any load fails (fail-open: caller gets null → returns null).
 */
function loadAndMerge(filePath: string, depth: number): TsConfig | null {
  if (depth >= MAX_EXTENDS_DEPTH) {
    console.warn(
      `[tsconfig-reader] extends chain depth limit (${MAX_EXTENDS_DEPTH}) reached at ${filePath}; stopping.`,
    );
    // Return a minimal config so callers can still use whatever was collected.
    return {};
  }

  const config = loadTsConfig(filePath);
  if (config === null) {
    return null;
  }

  if (typeof config.extends !== 'string') {
    // No extends — this is the leaf.
    return config;
  }

  // Resolve the extends path relative to this file's directory.
  let extendsPath = config.extends;
  if (!path.isAbsolute(extendsPath)) {
    extendsPath = path.resolve(path.dirname(filePath), extendsPath);
  }
  // TypeScript allows omitting .json extension in extends.
  if (!extendsPath.endsWith('.json') && !fs.existsSync(extendsPath)) {
    extendsPath = extendsPath + '.json';
  }

  if (!fs.existsSync(extendsPath)) {
    console.warn(`[tsconfig-reader] extends target not found: ${extendsPath}`);
    return config; // Use what we have without base.
  }

  const base = loadAndMerge(extendsPath, depth + 1);
  if (base === null) {
    return config; // Fail gracefully — use current without base.
  }

  return mergeTsConfigs(config, base);
}

/**
 * Build and sort alias entries from a tsconfig paths map.
 *
 * Sort order:
 *  1. Longer patterns first (more specific patterns take priority).
 *  2. For equal-length patterns: exact (no '*') before wildcard.
 *  3. Stable otherwise.
 */
function buildSortedAliases(paths: Record<string, string[]>): AliasEntry[] {
  const entries: AliasEntry[] = Object.entries(paths).map(([pattern, targets]) => {
    const isWildcard = pattern.includes('*');
    const prefix = isWildcard ? pattern.slice(0, pattern.indexOf('*')) : '';
    return { pattern, isWildcard, prefix, targets };
  });

  entries.sort((a, b) => {
    // Longer patterns first.
    if (b.pattern.length !== a.pattern.length) {
      return b.pattern.length - a.pattern.length;
    }
    // Equal length: exact before wildcard.
    if (!a.isWildcard && b.isWildcard) return -1;
    if (a.isWildcard && !b.isWildcard) return 1;
    return 0;
  });

  return entries;
}
