// src/layers/static-analysis/parsers/go.ts
// Public API: parse a Go file and return all import path strings.
// Fail-open: any tree-sitter error returns [] and emits a console.warn.

import { Parser, Language } from 'web-tree-sitter';
import { initTreeSitter } from './ts-parser-init';
import { TreeSitterNode } from './import-visitor';
import path from 'path';

let goLanguage: unknown = null;

/**
 * Strip surrounding double-quote characters from a Go string literal node's
 * text (e.g. `'"fmt"'` → `'fmt'`).
 */
function stripQuotes(raw: string): string {
  return raw.slice(1, -1);
}

/**
 * Lazily load the Go grammar WASM and return the Language object.
 * Cached after first load.
 */
async function loadGoLanguage(): Promise<unknown> {
  if (goLanguage !== null) {
    return goLanguage;
  }
  const pkgJson = require.resolve('tree-sitter-go/package.json');
  const wasmPath = path.join(path.dirname(pkgJson), 'tree-sitter-go.wasm');
  goLanguage = await Language.load(wasmPath);
  return goLanguage;
}

/**
 * Recursively walk a Go AST and collect all import path strings.
 *
 * Node type handled:
 *   - import_spec: Get the `path` field (a `string` node) → stripQuotes(.text).
 *     This handles all forms: single imports, grouped imports, blank-alias
 *     imports (`import _ "pkg"`), and named-alias imports (`import alias "pkg"`).
 *     Blank imports are real dependencies and are included.
 *
 * Critical: Go string literals include surrounding double quotes in .text,
 * so stripQuotes() (`.slice(1, -1)`) is required.
 * Do NOT recurse into import_spec children — the path field is sufficient.
 */
export function extractGoImports(root: TreeSitterNode): string[] {
  const results: string[] = [];

  function visit(node: TreeSitterNode): void {
    if (node.type === 'import_spec') {
      const pathNode = node.childForFieldName('path');
      if (pathNode !== null) {
        results.push(stripQuotes(pathNode.text));
      }
      // Do NOT recurse into import_spec children
      return;
    }

    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return [...new Set(results)].filter((p) => p.length > 0).sort();
}

/**
 * Parse a Go source file and return every import path found in it.
 *
 * Fail-open (R004): on any error, logs to console.warn and returns [].
 * The caller is responsible for recording filePath in Layer1Result.parsing_errors.
 *
 * @param filePath - Source file path (used only in error reporting).
 * @param content  - Raw file content to parse.
 * @returns Alphabetically sorted, deduplicated import path strings.
 */
export async function parseGoImports(
  filePath: string,
  content: string,
): Promise<string[]> {
  try {
    await initTreeSitter();
    const lang = await loadGoLanguage();

    const parser = new Parser();
    parser.setLanguage(lang as Language);

    const tree = parser.parse(content);
    if (tree === null) {
      console.warn(`[Layer1] parse error: ${filePath}: parser returned null tree`);
      return [];
    }
    return extractGoImports(tree.rootNode as unknown as TreeSitterNode);
  } catch (error) {
    console.warn(`[Layer1] parse error: ${filePath}: ${error}`);
    return [];
  }
}
