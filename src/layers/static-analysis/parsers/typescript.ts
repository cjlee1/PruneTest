// src/layers/static-analysis/parsers/typescript.ts
// Public API: parse a TypeScript/JS file and return all import path strings.
// Fail-open: any tree-sitter error returns [] and emits a console.warn.

import { Parser, Language } from 'web-tree-sitter';
import { initTreeSitter, loadTsLanguage } from './ts-parser-init';
import { extractImportsFromRoot, TreeSitterNode } from './import-visitor';

/**
 * Parse a TypeScript or JavaScript source file and return every import path
 * found in it (ESM, CommonJS, dynamic string, re-exports).
 *
 * Fail-open (R004): on any error, logs to console.warn and returns [].
 * The caller (S04 graph builder) is responsible for recording filePath in
 * Layer1Result.parsing_errors.
 *
 * @param filePath - Source file path (used only in error reporting).
 * @param content  - Raw file content to parse.
 * @returns Alphabetically sorted, deduplicated import path strings.
 */
export async function parseTypeScriptImports(
  filePath: string,
  content: string,
): Promise<string[]> {
  try {
    await initTreeSitter();
    const lang = await loadTsLanguage();

    const parser = new Parser();
    parser.setLanguage(lang as Language);

    const tree = parser.parse(content);
    if (tree === null) {
      console.warn(`[Layer1] parse error: ${filePath}: parser returned null tree`);
      return [];
    }
    return extractImportsFromRoot(tree.rootNode as unknown as TreeSitterNode);
  } catch (error) {
    console.warn(`[Layer1] parse error: ${filePath}: ${error}`);
    return [];
  }
}
