// src/layers/static-analysis/graph/path-resolver.ts
// Pure synchronous path resolution and dependency graph construction.
// No async, no WASM. All fs failures are silently swallowed (fail-open).

import * as fs from 'fs';
import * as path from 'path';
import { PathAliasMap } from './tsconfig-reader';

/**
 * Ordered list of extensions probed when a relative JS/TS import has no
 * extension (e.g. `import foo from './foo'`).
 */
const TS_PROBE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '/index.ts',
  '/index.tsx',
  '/index.js',
];

/**
 * Resolve a single raw import string to a projectRoot-relative path.
 *
 * Returns `null` when:
 *  - the import is a bare specifier (npm package, stdlib)
 *  - the resolved path does not exist on disk
 *  - any fs operation throws
 *
 * @param rawImport         - The raw import string from the source file.
 * @param importingFilePath - projectRoot-relative path of the file that
 *                            contains the import.
 * @param projectRoot       - Absolute path to the repository root.
 * @param aliases           - Optional pre-sorted PathAliasMap from tsconfig.json.
 *                            When provided, TypeScript path aliases (e.g. @/auth)
 *                            are expanded before the standard resolution branches.
 */
export function resolveImport(
  rawImport: string,
  importingFilePath: string,
  projectRoot: string,
  aliases?: PathAliasMap | null,
): string | null {
  try {
    // -----------------------------------------------------------------------
    // TypeScript path alias expansion (must run before relative-import branch)
    // -----------------------------------------------------------------------
    if (aliases != null) {
      const expanded = tryExpandAlias(rawImport, aliases, projectRoot);
      if (expanded !== null) {
        return expanded;
      }
    }

    // -----------------------------------------------------------------------
    // JS/TS relative imports — start with './' or '../'
    // -----------------------------------------------------------------------
    if (rawImport.startsWith('./') || rawImport.startsWith('../')) {
      const importingDir = path.dirname(importingFilePath);
      const base = path.join(importingDir, rawImport);

      // If the raw import already carries an extension, check it directly.
      if (path.extname(rawImport) !== '') {
        const candidate = normaliseSlashes(base);
        if (fs.existsSync(path.join(projectRoot, candidate))) {
          return candidate;
        }
        return null;
      }

      // Otherwise probe the ordered extension list.
      for (const ext of TS_PROBE_EXTENSIONS) {
        const candidate = normaliseSlashes(base + ext);
        if (fs.existsSync(path.join(projectRoot, candidate))) {
          return candidate;
        }
      }
      return null;
    }

    // -----------------------------------------------------------------------
    // Python relative imports — start with a single '.' (but not './' which
    // is handled above). Examples: `.foo`, `..bar`, `...pkg.mod`
    // -----------------------------------------------------------------------
    if (rawImport.startsWith('.') && !rawImport.startsWith('./') && !rawImport.startsWith('../')) {
      const importingDir = path.dirname(importingFilePath);

      // Count leading dots to determine how many directory levels to climb.
      let dotCount = 0;
      while (dotCount < rawImport.length && rawImport[dotCount] === '.') {
        dotCount++;
      }

      // One dot  → same directory; two dots → parent; three → grandparent …
      const levelsUp = dotCount - 1;
      let baseDir = importingDir;
      for (let i = 0; i < levelsUp; i++) {
        baseDir = path.dirname(baseDir);
      }

      const modulePart = rawImport.slice(dotCount); // strip leading dots
      const withSlashes = modulePart.replace(/\./g, '/');
      const base = modulePart ? path.join(baseDir, withSlashes) : baseDir;

      // Try exact path first (module may already include extension).
      const ext = path.extname(base);
      if (ext !== '') {
        const candidate = normaliseSlashes(base);
        if (fs.existsSync(path.join(projectRoot, candidate))) {
          return candidate;
        }
        return null;
      }

      // Probe with .py extension.
      const candidate = normaliseSlashes(base + '.py');
      if (fs.existsSync(path.join(projectRoot, candidate))) {
        return candidate;
      }
      return null;
    }

    // -----------------------------------------------------------------------
    // Go intra-project imports — no leading './' but no npm/stdlib markers.
    // A bare string that resolves to a directory containing *.go files.
    // Check Go BEFORE Ruby: the Go check is definitive (directory + .go files
    // must actually exist), whereas Ruby is speculative (any bare path).
    // -----------------------------------------------------------------------
    if (isGoImport(rawImport, projectRoot)) {
      return rawImport;
    }

    // -----------------------------------------------------------------------
    // Ruby — bare string, no leading dot, no leading slash.
    // If no extension, try appending '.rb'.
    // -----------------------------------------------------------------------
    if (isRubyImport(rawImport)) {
      if (path.extname(rawImport) !== '') {
        const candidate = normaliseSlashes(rawImport);
        if (fs.existsSync(path.join(projectRoot, candidate))) {
          return candidate;
        }
        return null;
      }
      const candidate = normaliseSlashes(rawImport + '.rb');
      if (fs.existsSync(path.join(projectRoot, candidate))) {
        return candidate;
      }
      return null;
    }

    // Everything else (npm packages, stdlib, absolute paths, …) → null.
    return null;
  } catch {
    // Silently absorb all fs errors — fail-open by design.
    return null;
  }
}

/**
 * Build a forward dependency graph from a raw import map produced by the
 * language parsers.
 *
 * @param rawImportMap - Map from projectRoot-relative file path to the list
 *                       of raw import strings found in that file.
 * @param projectRoot  - Absolute path to the repository root.
 * @param aliases      - Optional pre-sorted PathAliasMap from tsconfig.json.
 *                       When provided, TypeScript path aliases are expanded
 *                       before standard resolution.
 * @returns A `Record<string, string[]>` where:
 *   - every key in `rawImportMap` is present (even if its array is empty)
 *   - values are sorted, deduplicated, projectRoot-relative paths
 */
export function buildDependencyGraph(
  rawImportMap: Map<string, string[]>,
  projectRoot: string,
  aliases?: PathAliasMap | null,
): Record<string, string[]> {
  const graph: Record<string, string[]> = {};

  for (const [filePath, rawImports] of rawImportMap) {
    const resolved = new Set<string>();

    for (const raw of rawImports) {
      const result = resolveImport(raw, filePath, projectRoot, aliases);
      if (result !== null) {
        resolved.add(result);
      }
    }

    // Sort alphabetically (AGENTS.md rule 4).
    graph[filePath] = Array.from(resolved).sort();
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Normalise backslashes to forward slashes (Windows safety). */
function normaliseSlashes(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Try to expand a raw import string using TypeScript path aliases.
 *
 * The aliases array is pre-sorted by loadTsAliases() (longer first, exact
 * before wildcard at equal length), so a linear first-match-wins scan is
 * correct and correct.
 *
 * For each matched alias, every candidate target is resolved to an absolute
 * path via aliases.baseUrl, then converted to a projectRoot-relative path.
 * Extension probing (TS_PROBE_EXTENSIONS) is applied to the base candidate,
 * matching the same 7-step list used by the JS/TS relative-import branch.
 *
 * Returns the first candidate path that exists on disk, or null if no alias
 * matches or no candidate resolves to an existing file.
 */
function tryExpandAlias(
  rawImport: string,
  aliases: PathAliasMap,
  projectRoot: string,
): string | null {
  for (const entry of aliases.aliases) {
    let captured: string | null = null;

    if (!entry.isWildcard) {
      // Exact match.
      if (rawImport === entry.pattern) {
        captured = '';
      }
    } else {
      // Wildcard match: pattern is like '@/*' so prefix is '@/'.
      if (rawImport.startsWith(entry.prefix)) {
        captured = rawImport.slice(entry.prefix.length);
      }
    }

    if (captured === null) {
      continue;
    }

    // Try each target in order; return the first one that exists on disk.
    for (const target of entry.targets) {
      // Substitute the '*' placeholder with what was captured.
      const expanded = entry.isWildcard ? target.replace('*', captured) : target;

      // Resolve the expanded target relative to baseUrl (absolute path).
      const absTarget = path.resolve(aliases.baseUrl, expanded);

      // Convert to projectRoot-relative path.
      const relTarget = normaliseSlashes(
        path.relative(projectRoot, absTarget),
      );

      // Probe extensions — same 7-step list as the JS/TS relative-import branch.
      if (path.extname(relTarget) !== '') {
        // Target already has an extension — check it directly.
        if (fs.existsSync(path.join(projectRoot, relTarget))) {
          return relTarget;
        }
        // Extension present but file doesn't exist — try next target.
        continue;
      }

      // No extension — probe the ordered list.
      for (const ext of TS_PROBE_EXTENSIONS) {
        const candidate = relTarget + ext;
        if (fs.existsSync(path.join(projectRoot, candidate))) {
          return candidate;
        }
      }
      // No probe matched — try next target.
    }
  }

  return null;
}

/**
 * Heuristic: a Ruby import is a bare string with no leading dot and no
 * path separator — it looks like `require 'lib/module'` or `require 'net/http'`.
 * We only try to resolve it if it doesn't contain '://' (URLs) and doesn't
 * look like a Go module path (which contains a '.' before the first '/').
 */
function isRubyImport(raw: string): boolean {
  if (raw.startsWith('/') || raw.startsWith('.') || raw.includes('://')) {
    return false;
  }
  // npm packages always contain no '/' or start with '@'; skip them.
  // Ruby paths typically start with a plain identifier, optionally with '/'
  // separators, and no '.' in the first segment (Go modules have dots).
  const firstSegment = raw.split('/')[0];
  // If the first segment contains a dot it's likely a Go module or npm scoped
  // package domain — not a local Ruby file.
  if (firstSegment.includes('.')) {
    return false;
  }
  return true;
}

/**
 * Check whether a raw Go import string points to an intra-project directory.
 * Returns true iff path.join(projectRoot, rawImport) exists as a directory
 * AND that directory contains at least one *.go file.
 */
function isGoImport(raw: string, projectRoot: string): boolean {
  if (raw.startsWith('/') || raw.startsWith('.') || raw.includes('://')) {
    return false;
  }
  try {
    const absDir = path.join(projectRoot, raw);
    if (!fs.existsSync(absDir)) return false;
    const stat = fs.statSync(absDir);
    if (!stat.isDirectory()) return false;
    const entries = fs.readdirSync(absDir);
    return entries.some((e) => e.endsWith('.go'));
  } catch {
    return false;
  }
}
