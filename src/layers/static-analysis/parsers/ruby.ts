// src/layers/static-analysis/parsers/ruby.ts
// Public API: parse a Ruby file and return all import path strings.
// Fail-open: any tree-sitter error returns [] and emits a console.warn.

import { Parser, Language } from 'web-tree-sitter';
import { initTreeSitter } from './ts-parser-init';
import { TreeSitterNode } from './import-visitor';
import path from 'path';

let rubyLanguage: unknown = null;

/**
 * Strip surrounding single or double quote characters from a string literal
 * node's text (e.g. `"'rails'"` → `"rails"`).
 */
function stripQuotes(raw: string): string {
  return raw.slice(1, -1);
}

/**
 * Lazily load the Ruby grammar WASM and return the Language object.
 * Cached after first load.
 */
async function loadRubyLanguage(): Promise<unknown> {
  if (rubyLanguage !== null) {
    return rubyLanguage;
  }
  const pkgJson = require.resolve('tree-sitter-ruby/package.json');
  const wasmPath = path.join(path.dirname(pkgJson), 'tree-sitter-ruby.wasm');
  rubyLanguage = await Language.load(wasmPath);
  return rubyLanguage;
}

/**
 * Recursively walk a Ruby AST and collect all require/require_relative paths.
 *
 * Node types handled:
 *   - call node where method field text === 'require' or 'require_relative':
 *     arguments field → argument_list node → namedChildren[0] must be 'string'
 *     → skip if string node has any 'interpolation' child (dynamic path)
 *     → push stripQuotes(stringNode.text)
 *
 * All other call nodes are skipped.
 * Ruby string literals include their surrounding quotes in .text, so stripQuotes is needed.
 */
export function extractRubyImports(root: TreeSitterNode): string[] {
  const results: string[] = [];

  function visit(node: TreeSitterNode): void {
    if (node.type === 'call') {
      const methodNode = node.childForFieldName('method');
      if (
        methodNode !== null &&
        (methodNode.text === 'require' || methodNode.text === 'require_relative')
      ) {
        const argsNode = node.childForFieldName('arguments');
        if (argsNode !== null) {
          const firstArg = argsNode.namedChildren[0];
          if (firstArg !== undefined && firstArg.type === 'string') {
            // Skip dynamic strings with interpolation (e.g. require "#{path}")
            const hasDynamicInterpolation = firstArg.children.some(
              (c) => c.type === 'interpolation',
            );
            if (!hasDynamicInterpolation) {
              results.push(stripQuotes(firstArg.text));
            }
          }
        }
      }
    }

    // Recurse into named children for all nodes
    for (const child of node.namedChildren) {
      visit(child);
    }
  }

  visit(root);
  return [...new Set(results)].filter((p) => p.length > 0).sort();
}

/**
 * Parse a Ruby source file and return every require path found in it.
 *
 * Fail-open (R004): on any error, logs to console.warn and returns [].
 * The caller is responsible for recording filePath in Layer1Result.parsing_errors.
 *
 * @param filePath - Source file path (used only in error reporting).
 * @param content  - Raw file content to parse.
 * @returns Alphabetically sorted, deduplicated require path strings.
 */
export async function parseRubyImports(
  filePath: string,
  content: string,
): Promise<string[]> {
  try {
    await initTreeSitter();
    const lang = await loadRubyLanguage();

    const parser = new Parser();
    parser.setLanguage(lang as Language);

    const tree = parser.parse(content);
    if (tree === null) {
      console.warn(`[Layer1] parse error: ${filePath}: parser returned null tree`);
      return [];
    }
    return extractRubyImports(tree.rootNode as unknown as TreeSitterNode);
  } catch (error) {
    console.warn(`[Layer1] parse error: ${filePath}: ${error}`);
    return [];
  }
}
