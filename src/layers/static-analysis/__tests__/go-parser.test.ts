// src/layers/static-analysis/__tests__/go-parser.test.ts
// Unit tests for the Go import parser.
//
// Strategy:
//   - extractGoImports: pure function, tested against hand-crafted mock nodes
//   - parseGoImports: tested with jest.mock('web-tree-sitter') so no WASM loads
//
// web-tree-sitter mock: jest.mock is hoisted before variable declarations, so all
// mock implementation must live inside the factory function. We retrieve the fns
// from the mocked module after import to control behaviour per-test.

import { TreeSitterNode } from '../parsers/import-visitor';
import { extractGoImports } from '../parsers/go';

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
import { parseGoImports } from '../parsers/go';
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
    type: 'source_file',
    text: '',
    namedChildren: children,
    children,
    childForFieldName: () => null,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a Go `import_spec` node
// ---------------------------------------------------------------------------

function makeImportSpec(quotedPath: string, nameText?: string): TreeSitterNode {
  const pathNode = makeNode('string', quotedPath);
  const fields: Record<string, TreeSitterNode | null> = { path: pathNode };
  if (nameText !== undefined) {
    fields['name'] = makeNode('identifier', nameText);
  }
  return makeNode('import_spec', `import ${quotedPath}`, { fields });
}

// ---------------------------------------------------------------------------
// Pure visitor tests — no mock needed
// ---------------------------------------------------------------------------

describe('extractGoImports (pure visitor)', () => {
  it('single import → correct path', () => {
    const spec = makeImportSpec('"fmt"');
    expect(extractGoImports(makeRoot(spec))).toEqual(['fmt']);
  });

  it('grouped import with two specs → both paths', () => {
    // Wrap two import_spec nodes in an import_spec_list in an import_declaration
    const spec1 = makeImportSpec('"fmt"');
    const spec2 = makeImportSpec('"os/exec"');
    const specList = makeNode('import_spec_list', '', { namedChildren: [spec1, spec2] });
    const importDecl = makeNode('import_declaration', '', { namedChildren: [specList] });
    expect(extractGoImports(makeRoot(importDecl))).toEqual(['fmt', 'os/exec']);
  });

  it('blank-alias import (_) → path is still returned', () => {
    const spec = makeImportSpec('"github.com/lib/pq"', '_');
    expect(extractGoImports(makeRoot(spec))).toEqual(['github.com/lib/pq']);
  });

  it('named-alias import → path only (not alias)', () => {
    const spec = makeImportSpec('"pkg"', 'myalias');
    expect(extractGoImports(makeRoot(spec))).toEqual(['pkg']);
  });

  it('sorts and deduplicates results', () => {
    const spec1 = makeImportSpec('"fmt"');
    const spec2 = makeImportSpec('"os/exec"');
    const spec3 = makeImportSpec('"fmt"'); // duplicate
    expect(extractGoImports(makeRoot(spec1, spec2, spec3))).toEqual(['fmt', 'os/exec']);
  });
});

// ---------------------------------------------------------------------------
// parseGoImports integration tests (web-tree-sitter mocked)
// ---------------------------------------------------------------------------

describe('parseGoImports', () => {
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
    const spec1 = makeImportSpec('"fmt"');
    const spec2 = makeImportSpec('"os/exec"');
    setFakeRootNode(makeRoot(spec1, spec2));

    const result = await parseGoImports('main.go', 'import "fmt"\nimport "os/exec"');
    expect(result).toEqual(['fmt', 'os/exec']);
  });

  it('returns [] and does not throw on init error (fail-open)', async () => {
    const { MockParser } = getMocks();
    MockParser.init.mockRejectedValueOnce(new Error('WASM load failed'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await parseGoImports('main.go', 'import "fmt"');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: main.go'),
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
    const result = await parseGoImports('main.go', '');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: main.go'),
    );
    warnSpy.mockRestore();
  });
});
