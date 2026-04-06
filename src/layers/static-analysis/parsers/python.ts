// src/layers/static-analysis/parsers/python.ts
// Public API: parse a Python file and return all import path strings.
// Fail-open: any tree-sitter error returns [] and emits a console.warn.

import { Parser, Language } from 'web-tree-sitter';
import { initTreeSitter } from './ts-parser-init';
import { TreeSitterNode } from './import-visitor';
import path from 'path';

let pyLanguage: unknown = null;

/**
 * Lazily load the Python grammar WASM and return the Language object.
 * Cached after first load.
 */
async function loadPyLanguage(): Promise<unknown> {
  if (pyLanguage !== null) {
    return pyLanguage;
  }
  const pkgJson = require.resolve('tree-sitter-python/package.json');
  const wasmPath = path.join(path.dirname(pkgJson), 'tree-sitter-python.wasm');
  pyLanguage = await Language.load(wasmPath);
  return pyLanguage;
}

/**
 * Recursively walk a Python AST and collect all import path strings.
 *
 * Node types handled:
 *   - import_statement:        `import os` / `import os.path` / `import os, sys`
 *                              → iterate namedChildren for dotted_name nodes → .text
 *   - import_from_statement:   `from os import path` / `from .utils import foo`
 *                              → module_name field → dotted_name | relative_import → .text
 *   - future_import_statement: SKIP entirely (no push, no recurse)
 *
 * Critical: Python paths have NO surrounding quotes — do NOT call stripQuotes().
 */
export function extractPythonImports(root: TreeSitterNode): string[] {
  const results: string[] = [];

  function visit(node: TreeSitterNode): void {
    switch (node.type) {
      case 'future_import_statement':
        // Skip __future__ entirely — do not recurse
        return;

      case 'import_statement': {
        // `import os` / `import os.path` / `import os, sys`
        // Named children are dotted_name nodes — one per imported module
        for (const child of node.namedChildren) {
          if (child.type === 'dotted_name') {
            results.push(child.text);
          }
        }
        break;
      }

      case 'import_from_statement': {
        // `from os import path` / `from .utils import foo` / `from .. import bar`
        const moduleNameNode = node.childForFieldName('module_name');
        if (moduleNameNode !== null) {
          if (
            moduleNameNode.type === 'dotted_name' ||
            moduleNameNode.type === 'relative_import'
          ) {
            results.push(moduleNameNode.text);
          }
        }
        break;
      }

      default:
        break;
    }

    // Recurse into named children for all non-future nodes
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return [...new Set(results)].filter((p) => p.length > 0).sort();
}

/**
 * Parse a Python source file and return every import path found in it.
 *
 * Fail-open (R004): on any error, logs to console.warn and returns [].
 * The caller is responsible for recording filePath in Layer1Result.parsing_errors.
 *
 * @param filePath - Source file path (used only in error reporting).
 * @param content  - Raw file content to parse.
 * @returns Alphabetically sorted, deduplicated import path strings.
 */
export async function parsePythonImports(
  filePath: string,
  content: string,
): Promise<string[]> {
  try {
    await initTreeSitter();
    const lang = await loadPyLanguage();

    const parser = new Parser();
    parser.setLanguage(lang as Language);

    const tree = parser.parse(content);
    if (tree === null) {
      console.warn(`[Layer1] parse error: ${filePath}: parser returned null tree`);
      return [];
    }
    return extractPythonImports(tree.rootNode as unknown as TreeSitterNode);
  } catch (error) {
    console.warn(`[Layer1] parse error: ${filePath}: ${error}`);
    return [];
  }
}
