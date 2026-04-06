// src/layers/static-analysis/__tests__/ruby-parser.test.ts
// Unit tests for the Ruby import parser.
//
// Strategy:
//   - extractRubyImports: pure function, tested against hand-crafted mock nodes
//   - parseRubyImports: tested with jest.mock('web-tree-sitter') so no WASM loads
//
// web-tree-sitter mock: jest.mock is hoisted before variable declarations, so all
// mock implementation must live inside the factory function. We retrieve the fns
// from the mocked module after import to control behaviour per-test.

import { TreeSitterNode } from '../parsers/import-visitor';
import { extractRubyImports } from '../parsers/ruby';

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
import { parseRubyImports } from '../parsers/ruby';
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
    type: 'program',
    text: '',
    namedChildren: children,
    children,
    childForFieldName: () => null,
  };
}

// ---------------------------------------------------------------------------
// Helper: build a Ruby `call` node for require/require_relative
// ---------------------------------------------------------------------------

function makeRequireCall(
  method: string,
  quotedPath: string,
  stringChildren: TreeSitterNode[] = [],
): TreeSitterNode {
  const methodNode = makeNode('identifier', method);
  const stringNode = makeNode('string', quotedPath, { children: stringChildren, namedChildren: stringChildren });
  const argsNode = makeNode('argument_list', quotedPath, { namedChildren: [stringNode] });
  return makeNode('call', `${method} ${quotedPath}`, {
    fields: { method: methodNode, arguments: argsNode },
  });
}

// ---------------------------------------------------------------------------
// Pure visitor tests — no mock needed
// ---------------------------------------------------------------------------

describe('extractRubyImports (pure visitor)', () => {
  it("require 'rails' → ['rails']", () => {
    const callNode = makeRequireCall('require', "'rails'");
    expect(extractRubyImports(makeRoot(callNode))).toEqual(['rails']);
  });

  it("require_relative './utils' → ['./utils']", () => {
    const callNode = makeRequireCall('require_relative', "'./utils'");
    expect(extractRubyImports(makeRoot(callNode))).toEqual(['./utils']);
  });

  it("require('json') (parenthesized form) → ['json']", () => {
    // Parenthesized form produces the same call node structure
    const callNode = makeRequireCall('require', "'json'");
    expect(extractRubyImports(makeRoot(callNode))).toEqual(['json']);
  });

  it("non-require call (puts 'hello') → []", () => {
    const methodNode = makeNode('identifier', 'puts');
    const stringNode = makeNode('string', "'hello'", { namedChildren: [] });
    const argsNode = makeNode('argument_list', "'hello'", { namedChildren: [stringNode] });
    const putsNode = makeNode('call', "puts 'hello'", {
      fields: { method: methodNode, arguments: argsNode },
    });
    expect(extractRubyImports(makeRoot(putsNode))).toEqual([]);
  });

  it('sorts and deduplicates results', () => {
    const call1 = makeRequireCall('require', "'rails'");
    const call2 = makeRequireCall('require_relative', "'./utils'");
    const call3 = makeRequireCall('require', "'rails'"); // duplicate
    expect(extractRubyImports(makeRoot(call1, call2, call3))).toEqual(['./utils', 'rails']);
  });

  it('skips require with interpolated string (dynamic path)', () => {
    const interpolationNode = makeNode('interpolation', '#{path}');
    const callNode = makeRequireCall('require', '"#{path}"', [interpolationNode]);
    expect(extractRubyImports(makeRoot(callNode))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// parseRubyImports integration tests (web-tree-sitter mocked)
// ---------------------------------------------------------------------------

describe('parseRubyImports', () => {
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
    const call1 = makeRequireCall('require', "'rails'");
    const call2 = makeRequireCall('require_relative', "'./utils'");
    setFakeRootNode(makeRoot(call1, call2));

    const result = await parseRubyImports('app.rb', "require 'rails'\nrequire_relative './utils'");
    expect(result).toEqual(['./utils', 'rails']);
  });

  it('returns [] and does not throw on init error (fail-open)', async () => {
    const { MockParser } = getMocks();
    MockParser.init.mockRejectedValueOnce(new Error('WASM load failed'));

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await parseRubyImports('app.rb', "require 'rails'");

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: app.rb'),
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
    const result = await parseRubyImports('app.rb', '');

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Layer1] parse error: app.rb'),
    );
    warnSpy.mockRestore();
  });
});
