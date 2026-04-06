// src/layers/static-analysis/__tests__/fixtures/ts-imports.ts
// This file is NOT compiled — it is read as raw text by typescript-parser.test.ts.
// It is written as a TypeScript source string (not real imports) so we can
// keep it next to the tests without confusing the TypeScript compiler.

/**
 * Raw source content covering all import forms for parseTypeScriptImports tests.
 * Contains ESM, CommonJS, dynamic string import, TS import=require, and re-export.
 */
export const TS_IMPORTS_FIXTURE = `
// ESM static import (named)
import { readFileSync } from 'fs';

// ESM default import
import DefaultExport from './module-a';

// import type — type-only but included (conservative fail-open per R004/R005)
import type { Layer1Result } from './shared-types';

// CommonJS require — named binding
const path = require('path');

// CommonJS require — destructured
const { join } = require('./utils');

// TypeScript import= require() (legacy module interop)
import legacy = require('./legacy-module');

// Dynamic string import (should be extracted)
const mod = await import('./dynamic-module');

// Dynamic variable import (should NOT be extracted — variable path)
const name = 'something';
const varMod = await import(name);

// Re-export (barrel)
export { something } from './barrel';
`.trim();

/**
 * Expected sorted output from parseTypeScriptImports when parsing TS_IMPORTS_FIXTURE.
 * (import type paths included — conservative fail-open)
 */
export const TS_IMPORTS_EXPECTED_SORTED = [
  './barrel',
  './dynamic-module',
  './legacy-module',
  './module-a',
  './shared-types',
  './utils',
  'fs',
  'path',
];
