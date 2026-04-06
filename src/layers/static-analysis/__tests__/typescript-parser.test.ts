// src/layers/static-analysis/__tests__/typescript-parser.test.ts
// Unit tests for the TypeScript/JS import parser.
//
// Strategy:
//   - extractImportsFromRoot: pure function, tested against hand-crafted mock nodes
//   - parseTypeScriptImports: tested with jest.mock('web-tree-sitter') so no WASM loads
//
// web-tree-sitter mock: jest.mock is hoisted before variable declarations, so all
// mock implementation must live inside the factory function. We retrieve the fns
// from the mocked module after import to control behaviour per-test.

import { extractImportsFromRoot, TreeSitterNode } from '../parsers/import-visitor';

// ---------------------------------------------------------------------------
// web-tree-sitter mock — factory is self-contained (hoisting safe)
// ---------------------------------------------------------------------------

jest.mock('web-tree-sitter', () => {
  const mockParserInstance = {
    setLanguage: jest.fn(),
    parse: jest.fn(),
  };
  const MockParser = jest.fn(() => mockParserInstance);
  (MockParser as unknown as Record<string, unknown>).init = jest.fn().mockResolvedValue(undefined);
  return {
    __esModule: true,
    Parser: MockParser,
    Language: { load: jest.fn().mockResolvedValue({}) },
  };
});

// Import after jest.mock so the module-under-test gets the mock
import { parseTypeScriptImports } from '../parsers/typescript';
// Also import the mocked module so we can access the mock fns
import * as TreeSitterMock from 'web-tree-sitter';

// ---------------------------------------------------------------------------
// Helper: access mock fns from the mocked module
// ---------------------------------------------------------------------------

function getMocks() {
  const MockParser = TreeSitterMock.Parser as unknown as jest.MockedClass<{
    new (): { setLanguage: jest.Mock; parse: jest.Mock };
  }> & { init: jest.Mock };
  const Language = TreeSitterMock.Language as unknown as { load: jest.Mock };

  // The parser instance is always the same object returned by MockParser()
  const parserInstance = MockParser.mock.results[0]?.value as
    | { setLanguage: jest.Mock; parse: jest.Mock }
    | undefined;

  return { MockParser, Language, parserInstance };
}

// ---------------------------------------------------------------------------
// Helper: build minimal mock TreeSitterNode objects
// ---------------------------------------------------------------------------

function makeNode(
  type: string,
  text: string,
  overrides: Partial<TreeSitterNode> & {
    fields?: Record<string, TreeSitterNode | null>;
  } = {},
): TreeSitterNode {
  const { fields = {}, ...rest } = overrides;
  return {
    type,
    text,
    namedChildren: [],
    children: [],
    childForFieldName: (name: string) => fields[name] ?? null,
    ...rest,
  };
}

function makeStringNode(value: string): TreeSitterNode {
  return makeNode('string', `'${value}'`);
}

function makeRoot(...children: TreeSitterNode[]): TreeSitterNode {
  return {
    type: 'program',
    text: '',
    namedChildren: children,
    children,
    childForFieldName: () => null,
  };
}

// ---------------------------------------------------------------------------
// Pure visitor tests — no mock needed
// ---------------------------------------------------------------------------

describe('extractImportsFromRoot (pure visitor)', () => {
  it('returns ESM import paths from import_statement with source field', () => {
    const sourceNode = makeStringNode('./utils');
    const importNode = makeNode('import_statement', "import { x } from './utils'", {
      fields: { source: sourceNode },
    });
    expect(extractImportsFromRoot(makeRoot(importNode))).toEqual(['./utils']);
  });

  it('returns TS import=require() paths from import_require_clause child', () => {
    const sourceNode = makeStringNode('./legacy');
    const requireClause = makeNode('import_require_clause', "require('./legacy')", {
      fields: { source: sourceNode },
    });
    const importNode: TreeSitterNode = {
      type: 'import_statement',
      text: "import x = require('./legacy')",
      namedChildren: [requireClause],
      children: [requireClause],
      childForFieldName: () => null, // no top-level source field
    };
    expect(extractImportsFromRoot(makeRoot(importNode))).toEqual(['./legacy']);
  });

  it('returns CommonJS require paths', () => {
    const argStringNode = makeStringNode('./config');
    const argsNode = makeNode('arguments', "('./config')", {
      namedChildren: [argStringNode],
    });
    const fnNode = makeNode('identifier', 'require');
    const callNode: TreeSitterNode = {
      type: 'call_expression',
      text: "require('./config')",
      namedChildren: [fnNode, argsNode],
      children: [fnNode, argsNode],
      childForFieldName: (n) =>
        n === 'function' ? fnNode : n === 'arguments' ? argsNode : null,
    };
    expect(extractImportsFromRoot(makeRoot(callNode))).toEqual(['./config']);
  });

  it('returns dynamic string import paths', () => {
    const argStringNode = makeStringNode('./dynamic');
    const argsNode = makeNode('arguments', "('./dynamic')", {
      namedChildren: [argStringNode],
    });
    const fnNode = makeNode('import', 'import');
    const callNode: TreeSitterNode = {
      type: 'call_expression',
      text: "import('./dynamic')",
      namedChildren: [fnNode, argsNode],
      children: [fnNode, argsNode],
      childForFieldName: (n) =>
        n === 'function' ? fnNode : n === 'arguments' ? argsNode : null,
    };
    expect(extractImportsFromRoot(makeRoot(callNode))).toEqual(['./dynamic']);
  });

  it('skips dynamic variable imports (non-string arg)', () => {
    const argVarNode = makeNode('identifier', 'varName');
    const argsNode = makeNode('arguments', '(varName)', {
      namedChildren: [argVarNode],
    });
    const fnNode = makeNode('import', 'import');
    const callNode: TreeSitterNode = {
      type: 'call_expression',
      text: 'import(varName)',
      namedChildren: [fnNode, argsNode],
      children: [fnNode, argsNode],
      childForFieldName: (n) =>
        n === 'function' ? fnNode : n === 'arguments' ? argsNode : null,
    };
    expect(extractImportsFromRoot(makeRoot(callNode))).toEqual([]);
  });

  it('returns export-from paths', () => {
    const sourceNode = makeStringNode('./barrel');
    const exportNode = makeNode('export_statement', "export { x } from './barrel'", {
      fields: { source: sourceNode },
    });
    expect(extractImportsFromRoot(makeRoot(exportNode))).toEqual(['./barrel']);
  });

  it('output is sorted alphabetically', () => {
    const nodes = ['./z-module', './a-module', './m-module'].map((p) => {
      const src = makeStringNode(p);
      return makeNode('import_statement', `import x from '${p}'`, {
        fields: { source: src },
      });
    });
    expect(extractImportsFromRoot(makeRoot(...nodes))).toEqual([
      './a-module',
      './m-module',
      './z-module',
    ]);
  });

  it('deduplicates repeated import paths', () => {
    const node1 = makeNode('import_statement', "import a from './shared'", {
      fields: { source: makeStringNode('./shared') },
    });
    const node2 = makeNode('import_statement', "import b from './shared'", {
      fields: { source: makeStringNode('./shared') },
    });
    expect(extractImportsFromRoot(makeRoot(node1, node2))).toEqual(['./shared']);
  });
});

// ---------------------------------------------------------------------------
// parseTypeScriptImports integration tests (web-tree-sitter mocked)
// ---------------------------------------------------------------------------

describe('parseTypeScriptImports', () => {
  // Reset all mocks and re-mock default resolved values before each test.
  // We cannot reset the module singleton (initPromise / tsLanguage) between
  // tests without jest.resetModules(), so we rely on the mock never throwing
  // by default — the singleton path simply no-ops after first call.
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-apply default resolved values after clearAllMocks wipes them
    const { MockParser, Language } = getMocks();
    MockParser.init.mockResolvedValue(undefined);
    Language.load.mockResolvedValue({});
  });

  function setFakeRootNode(rootNode: TreeSitterNode): void {
    // getMocks() after clearAllMocks won't have a prior instance; wire via
    // the Parser constructor mock so the next `new Parser()` returns our node.
    const { MockParser } = getMocks();
    const fakeInstance = { setLanguage: jest.fn(), parse: jest.fn().mockReturnValue({ rootNode }) };
    MockParser.mockImplementationOnce(() => fakeInstance);
  }

  it('returns ESM import paths (integration)', async () => {
    const sourceNode = makeStringNode('fs');
    const importNode = makeNode('import_statement', "import { x } from 'fs'", {
      fields: { source: sourceNode },
    });
    setFakeRootNode(makeRoot(importNode));

    const result = await parseTypeScriptImports('file.ts', "import { x } from 'fs'");
    expect(result).toEqual(['fs']);
  });

  it('returns CommonJS require paths (integration)', async () => {
    const argStr = makeStringNode('path');
    const argsNode = makeNode('arguments', "('path')", { namedChildren: [argStr] });
    const fnNode = makeNode('identifier', 'require');
    const callNode: TreeSitterNode = {
      type: 'call_expression',
      text: "require('path')",
      namedChildren: [fnNode, argsNode],
      children: [fnNode, argsNode],
      childForFieldName: (n) =>
        n === 'function' ? fnNode : n === 'arguments' ? argsNode : null,
    };
    setFakeRootNode(makeRoot(callNode));

    const result = await parseTypeScriptImports('file.ts', "const p = require('path')");
    expect(result).toEqual(['path']);
  });

  it('returns [] and does not throw on tree-sitter init error (fail-open)', async () => {
    // Override Parser.init to throw for this call
    const { MockParser } = getMocks();
    MockParser.init.mockRejectedValueOnce(new Error('WASM load failed'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await parseTypeScriptImports('src/broken.ts', 'some content');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: src/broken.ts'),
    );
    warnSpy.mockRestore();
  });

  it('returns [] and does not throw when parse() returns null', async () => {
    const { MockParser } = getMocks();
    const fakeInstance = {
      setLanguage: jest.fn(),
      parse: jest.fn().mockReturnValue(null),
    };
    MockParser.mockImplementationOnce(() => fakeInstance);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await parseTypeScriptImports('src/null.ts', '');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: src/null.ts'),
    );
    warnSpy.mockRestore();
  });

  it('output is sorted alphabetically (integration)', async () => {
    const nodes = ['./z', './a', './m'].map((p) => {
      const src = makeStringNode(p);
      return makeNode('import_statement', `import x from '${p}'`, {
        fields: { source: src },
      });
    });
    setFakeRootNode(makeRoot(...nodes));

    const result = await parseTypeScriptImports('file.ts', '');
    expect(result).toEqual(['./a', './m', './z']);
  });
});
