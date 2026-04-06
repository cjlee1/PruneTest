// src/layers/static-analysis/parsers/ts-parser-init.ts
// Singleton WASM initializer for web-tree-sitter.
// Parser.init() is called exactly once per process; Language.load() is cached.

import { Parser, Language } from 'web-tree-sitter';
import path from 'path';

let initPromise: Promise<void> | null = null;
let tsLanguage: unknown = null;

/**
 * Lazily initialize the web-tree-sitter WASM core.
 * Safe to call multiple times — runs Parser.init() only once per process.
 */
export async function initTreeSitter(): Promise<void> {
  if (initPromise === null) {
    initPromise = Parser.init();
  }
  await initPromise;
}

/**
 * Load the TypeScript grammar WASM and return the Language object.
 * Cached after first load.
 */
export async function loadTsLanguage(): Promise<unknown> {
  if (tsLanguage !== null) {
    return tsLanguage;
  }
  const pkgJson = require.resolve('tree-sitter-typescript/package.json');
  const wasmPath = path.join(path.dirname(pkgJson), 'tree-sitter-typescript.wasm');
  tsLanguage = await Language.load(wasmPath);
  return tsLanguage;
}
