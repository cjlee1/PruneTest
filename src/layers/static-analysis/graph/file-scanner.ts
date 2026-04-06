// src/layers/static-analysis/graph/file-scanner.ts
// Discover all project source files, read them, and parse imports.
// Returns a Map<projectRoot-relative path, raw import strings[]>.
// Fail-open (AGENTS.md rule 1): read/parse failures push to parsing_errors and continue.

import * as fs from 'fs';
import * as path from 'path';
import fg from 'fast-glob';

import { parseTypeScriptImports } from '../parsers/typescript';
import { parsePythonImports } from '../parsers/python';
import { parseRubyImports } from '../parsers/ruby';
import { parseGoImports } from '../parsers/go';

/** File extensions handled by each parser. */
const TS_JS_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const PY_EXT = '.py';
const RB_EXT = '.rb';
const GO_EXT = '.go';

/** Glob patterns for all supported source languages. */
const FILE_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.py',
  '**/*.rb',
  '**/*.go',
];

const IGNORE_PATTERNS = ['node_modules/**', '.git/**', 'dist/**'];

/**
 * Dispatch to the correct language parser based on the file extension.
 *
 * @param filePath - projectRoot-relative path (used for extension dispatch and error messages).
 * @param content  - Raw file content.
 * @returns Array of raw import strings from the file.
 */
async function dispatchParser(filePath: string, content: string): Promise<string[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (TS_JS_EXTS.has(ext)) return parseTypeScriptImports(filePath, content);
  if (ext === PY_EXT) return parsePythonImports(filePath, content);
  if (ext === RB_EXT) return parseRubyImports(filePath, content);
  if (ext === GO_EXT) return parseGoImports(filePath, content);
  // Unknown extension — return empty (fail-open).
  return [];
}

/**
 * Scan all source files under projectRoot, parse their imports, and return a
 * dependency map.
 *
 * @param projectRoot    - Absolute path to the project root.
 * @param parsing_errors - Mutable array; filePaths that fail to read or parse
 *                         are pushed here so the caller can surface them in
 *                         Layer1Result.parsing_errors.
 * @param parseFile      - Optional injectable parser (for tests). When provided,
 *                         replaces the real parser dispatch entirely. Must match
 *                         the signature (filePath, content) => Promise<string[]>.
 * @returns Map from projectRoot-relative filePath → raw import strings[].
 *          Every successfully read file has an entry (empty array on parse error).
 */
export async function scanProjectFiles(
  projectRoot: string,
  parsing_errors: string[],
  parseFile?: (filePath: string, content: string) => Promise<string[]>,
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();

  // Discover files. fast-glob sync is intentional: we need the full list before
  // starting async parse work, and the glob itself is not the bottleneck.
  const filePaths = fg.sync(FILE_PATTERNS, {
    cwd: projectRoot,
    onlyFiles: true,
    ignore: IGNORE_PATTERNS,
  });

  const parser = parseFile ?? dispatchParser;

  for (const filePath of filePaths) {
    // --- Read phase ---
    let content: string;
    try {
      content = fs.readFileSync(path.join(projectRoot, filePath), 'utf-8');
    } catch (readErr) {
      // File unreadable — record error and skip (no map entry added).
      parsing_errors.push(filePath);
      continue;
    }

    // --- Parse phase ---
    let imports: string[];
    try {
      imports = await parser(filePath, content);
    } catch (_parseErr) {
      // Parser threw — record error, store empty array, keep file in map
      // so downstream graph construction knows the file exists.
      parsing_errors.push(filePath);
      result.set(filePath, []);
      continue;
    }

    result.set(filePath, imports);
  }

  return result;
}
