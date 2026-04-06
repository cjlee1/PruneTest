// src/layers/static-analysis/__tests__/python-parser.test.ts
// Unit tests for the Python import parser.
//
// Strategy:
//   - extractPythonImports: pure function, tested against hand-crafted mock nodes
//   - parsePythonImports: tested with jest.mock('web-tree-sitter') so no WASM loads
//
// web-tree-sitter mock: jest.mock is hoisted before variable declarations, so all
// mock implementation must live inside the factory function. We retrieve the fns
// from the mocked module after import to control behaviour per-test.

import { TreeSitterNode } from '../parsers/import-visitor';
import { extractPythonImports } from '../parsers/python';

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
import { parsePythonImports } from '../parsers/python';
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

function makeRoot(...children: TreeSitterNode[]): TreeSitterNode {
  return {
    type: 'module',
    text: '',
    namedChildren: children,
    children,
    childForFieldName: () => null,
  };
}

// ---------------------------------------------------------------------------
// Pure visitor tests — no mock needed
// ---------------------------------------------------------------------------

describe('extractPythonImports (pure visitor)', () => {
  it('import os → ["os"]', () => {
    const dottedName = makeNode('dotted_name', 'os');
    const importNode = makeNode('import_statement', 'import os', {
      namedChildren: [dottedName],
    });
    expect(extractPythonImports(makeRoot(importNode))).toEqual(['os']);
  });

  it('import os.path → ["os.path"]', () => {
    const dottedName = makeNode('dotted_name', 'os.path');
    const importNode = makeNode('import_statement', 'import os.path', {
      namedChildren: [dottedName],
    });
    expect(extractPythonImports(makeRoot(importNode))).toEqual(['os.path']);
  });

  it('import os, sys → ["os", "sys"] (sorted)', () => {
    const d1 = makeNode('dotted_name', 'os');
    const d2 = makeNode('dotted_name', 'sys');
    const importNode = makeNode('import_statement', 'import os, sys', {
      namedChildren: [d1, d2],
    });
    expect(extractPythonImports(makeRoot(importNode))).toEqual(['os', 'sys']);
  });

  it('from os import path → ["os"]', () => {
    const moduleNameNode = makeNode('dotted_name', 'os');
    const importNode = makeNode('import_from_statement', 'from os import path', {
      fields: { module_name: moduleNameNode },
    });
    expect(extractPythonImports(makeRoot(importNode))).toEqual(['os']);
  });

  it('from .utils import foo → [".utils"]', () => {
    const moduleNameNode = makeNode('relative_import', '.utils');
    const importNode = makeNode('import_from_statement', 'from .utils import foo', {
      fields: { module_name: moduleNameNode },
    });
    expect(extractPythonImports(makeRoot(importNode))).toEqual(['.utils']);
  });

  it('from .. import bar → [".."]', () => {
    const moduleNameNode = makeNode('relative_import', '..');
    const importNode = makeNode('import_from_statement', 'from .. import bar', {
      fields: { module_name: moduleNameNode },
    });
    expect(extractPythonImports(makeRoot(importNode))).toEqual(['..']);
  });

  it('from __future__ import annotations → [] (skipped)', () => {
    const futureNode = makeNode('future_import_statement', 'from __future__ import annotations');
    expect(extractPythonImports(makeRoot(futureNode))).toEqual([]);
  });

  it('sorts and deduplicates results', () => {
    const d1 = makeNode('dotted_name', 'sys');
    const d2 = makeNode('dotted_name', 'os');
    const d3 = makeNode('dotted_name', 'os'); // duplicate
    const importNode1 = makeNode('import_statement', 'import sys', { namedChildren: [d1] });
    const importNode2 = makeNode('import_statement', 'import os', { namedChildren: [d2] });
    const importNode3 = makeNode('import_statement', 'import os', { namedChildren: [d3] });
    expect(extractPythonImports(makeRoot(importNode1, importNode2, importNode3))).toEqual([
      'os',
      'sys',
    ]);
  });
});

// ---------------------------------------------------------------------------
// parsePythonImports integration tests (web-tree-sitter mocked)
// ---------------------------------------------------------------------------

describe('parsePythonImports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { MockParser, Language } = getMocks();
    MockParser.init.mockResolvedValue(undefined);
    Language.load.mockResolvedValue({});
  });

  function setFakeRootNode(rootNode: TreeSitterNode): void {
    const { MockParser } = getMocks();
    const fakeInstance = {
      setLanguage: jest.fn(),
      parse: jest.fn().mockReturnValue({ rootNode }),
    };
    MockParser.mockImplementationOnce(() => fakeInstance);
  }

  it('returns sorted import paths from a real AST shape (integration)', async () => {
    const d1 = makeNode('dotted_name', 'sys');
    const d2 = makeNode('dotted_name', 'os');
    const importNode1 = makeNode('import_statement', 'import sys', { namedChildren: [d1] });
    const importNode2 = makeNode('import_statement', 'import os', { namedChildren: [d2] });
    setFakeRootNode(makeRoot(importNode1, importNode2));

    const result = await parsePythonImports('src/test.py', 'import sys\nimport os');
    expect(result).toEqual(['os', 'sys']);
  });

  it('returns [] and does not throw on init error (fail-open)', async () => {
    const { MockParser } = getMocks();
    MockParser.init.mockRejectedValueOnce(new Error('WASM load failed'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await parsePythonImports('src/broken.py', 'import os');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: src/broken.py'),
    );
    warnSpy.mockRestore();
  });

  it('returns [] and does not throw when parse() returns null (fail-open)', async () => {
    const { MockParser } = getMocks();
    const fakeInstance = {
      setLanguage: jest.fn(),
      parse: jest.fn().mockReturnValue(null),
    };
    MockParser.mockImplementationOnce(() => fakeInstance);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await parsePythonImports('src/null.py', '');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: src/null.py'),
    );
    warnSpy.mockRestore();
  });
});
