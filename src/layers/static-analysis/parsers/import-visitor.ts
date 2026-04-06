// src/layers/static-analysis/parsers/import-visitor.ts
// Pure AST visitor — no web-tree-sitter imports.
// Accepts any object conforming to TreeSitterNode and returns all import paths.

/**
 * Minimal interface for a tree-sitter Node.
 * Defined here so this module stays free of web-tree-sitter imports and
 * can be tested with hand-crafted mock objects.
 */
export interface TreeSitterNode {
  type: string;
  text: string;
  namedChildren: TreeSitterNode[];
  children: TreeSitterNode[];
  childForFieldName(name: string): TreeSitterNode | null;
}

/**
 * Strip the surrounding single or double quote characters from a string
 * literal node's text (e.g. `"'./foo'"` → `"./foo"`).
 */
function stripQuotes(raw: string): string {
  return raw.slice(1, -1);
}

/**
 * Recursively walk a tree-sitter AST node and collect all import path strings.
 * Handles:
 *   a. import_statement  with source field  (ESM static + import type)
 *   b. import_statement  with import_require_clause child  (TS import= require())
 *   c. call_expression   where function.text === 'require'  (CommonJS)
 *   d. call_expression   where function.type === 'import'   (dynamic string import())
 *   e. export_statement  with source field  (re-exports)
 */
function visitNode(node: TreeSitterNode, results: string[]): void {
  switch (node.type) {
    case 'import_statement': {
      // Case (a): standard ESM import — source field is the string literal
      const source = node.childForFieldName('source');
      if (source !== null) {
        results.push(stripQuotes(source.text));
        break;
      }
      // Case (b): TypeScript import= require() — child is import_require_clause
      const requireClause = node.children.find(
        (c) => c.type === 'import_require_clause',
      );
      if (requireClause !== null && requireClause !== undefined) {
        const reqSource = requireClause.childForFieldName('source');
        if (reqSource !== null) {
          results.push(stripQuotes(reqSource.text));
        }
      }
      break;
    }

    case 'call_expression': {
      const fn = node.childForFieldName('function');
      if (fn === null) break;

      if (fn.text === 'require') {
        // Case (c): CommonJS require()
        const args = node.childForFieldName('arguments');
        if (args !== null) {
          const firstArg = args.namedChildren[0];
          if (firstArg !== undefined && firstArg.type === 'string') {
            results.push(stripQuotes(firstArg.text));
          }
        }
      } else if (fn.type === 'import') {
        // Case (d): dynamic import() — only extract string literal arguments
        const args = node.childForFieldName('arguments');
        if (args !== null) {
          const firstArg = args.namedChildren[0];
          if (firstArg !== undefined && firstArg.type === 'string') {
            results.push(stripQuotes(firstArg.text));
          }
          // Non-string arg (variable) → skip per AGENTS.md / design decision
        }
      }

      // Still recurse into children of call_expression so nested calls are found
      for (const child of node.namedChildren) {
        visitNode(child, results);
      }
      return; // return early — recursion already handled above
    }

    case 'export_statement': {
      // Case (e): re-export `export { x } from './barrel'`
      const source = node.childForFieldName('source');
      if (source !== null) {
        results.push(stripQuotes(source.text));
      }
      break;
    }

    default:
      break;
  }

  // Recurse into all named children for all node types
  for (const child of node.namedChildren) {
    visitNode(child, results);
  }
}

/**
 * Walk the full AST from the root node and return every import path found.
 *
 * - Pure function; accepts any TreeSitterNode-compatible object.
 * - Returns paths sorted alphabetically (AGENTS.md rule 4).
 * - Filters out empty strings.
 */
export function extractImportsFromRoot(root: TreeSitterNode): string[] {
  const results: string[] = [];
  visitNode(root, results);
  return [...new Set(results)].filter((p) => p.length > 0).sort();
}
