// src/layers/static-analysis/__tests__/tsconfig-reader.test.ts
// Unit tests for tsconfig-reader.ts using real fs.mkdtempSync temp directories.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  stripJsonComments,
  loadTsAliases,
  loadTsConfig,
  mergeTsConfigs,
} from '../graph/tsconfig-reader';

// ---------------------------------------------------------------------------
// Helper: write a tsconfig.json into a temp directory
// ---------------------------------------------------------------------------
function writeTsconfig(dir: string, content: object | string, filename = 'tsconfig.json'): string {
  const filePath = path.join(dir, filename);
  const raw = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(filePath, raw, 'utf8');
  return filePath;
}

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tsconfig-reader-test-'));
}

// ---------------------------------------------------------------------------
// stripJsonComments
// ---------------------------------------------------------------------------
describe('stripJsonComments', () => {
  it('strips // line comments', () => {
    const input = `{
  // this is a comment
  "foo": "bar"
}`;
    const result = JSON.parse(stripJsonComments(input)) as Record<string, string>;
    expect(result.foo).toBe('bar');
  });

  it('strips /* */ block comments', () => {
    const input = `{
  /* block comment */
  "foo": "bar"
}`;
    const result = JSON.parse(stripJsonComments(input)) as Record<string, string>;
    expect(result.foo).toBe('bar');
  });

  it('strips trailing commas before }', () => {
    const input = `{
  "foo": "bar",
}`;
    const result = JSON.parse(stripJsonComments(input)) as Record<string, string>;
    expect(result.foo).toBe('bar');
  });

  it('strips trailing commas before ]', () => {
    const input = `{
  "arr": [1, 2, 3,]
}`;
    const result = JSON.parse(stripJsonComments(input)) as Record<string, number[]>;
    expect(result.arr).toEqual([1, 2, 3]);
  });

  it('handles multi-line block comments', () => {
    const input = `{
  /* multi
     line
     comment */
  "x": 1
}`;
    const result = JSON.parse(stripJsonComments(input)) as Record<string, number>;
    expect(result.x).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// loadTsAliases — happy path
// ---------------------------------------------------------------------------
describe('loadTsAliases', () => {
  it('returns null when tsconfig.json is missing', () => {
    const tmp = mkTmp();
    try {
      expect(loadTsAliases(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('returns null for malformed JSON', () => {
    const tmp = mkTmp();
    try {
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), '{ not valid json }', 'utf8');
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(loadTsAliases(tmp)).toBeNull();
      warnSpy.mockRestore();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('returns null when no compilerOptions.paths', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, { compilerOptions: { baseUrl: '.' } });
      expect(loadTsAliases(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('returns null for baseUrl without paths', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, {
        compilerOptions: { baseUrl: 'src' },
      });
      expect(loadTsAliases(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('returns null for empty paths object {}', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, {
        compilerOptions: { baseUrl: '.', paths: {} },
      });
      expect(loadTsAliases(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('returns correct PathAliasMap for minimal tsconfig with baseUrl + wildcard @/*', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, {
        compilerOptions: {
          baseUrl: '.',
          paths: { '@/*': ['src/*'] },
        },
      });
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      expect(result!.baseUrl).toBe(tmp);
      expect(result!.aliases).toHaveLength(1);
      const entry = result!.aliases[0];
      expect(entry.pattern).toBe('@/*');
      expect(entry.isWildcard).toBe(true);
      expect(entry.prefix).toBe('@/');
      expect(entry.targets).toEqual(['src/*']);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('includes both exact @/auth and wildcard @/* in aliases', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],
            '@/auth': ['src/auth/index.ts'],
          },
        },
      });
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      expect(result!.aliases).toHaveLength(2);
      const patterns = result!.aliases.map((a) => a.pattern);
      expect(patterns).toContain('@/*');
      expect(patterns).toContain('@/auth');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('sorts: longer patterns first, exact before wildcard at equal prefix length', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],          // length 3, wildcard
            '@/auth': ['src/auth'],    // length 6, exact
            '@/auth/*': ['src/auth/*'], // length 8, wildcard
          },
        },
      });
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      const patterns = result!.aliases.map((a) => a.pattern);
      // '@/auth/*' (length 8) must come before '@/auth' (length 6) and '@/*' (length 3)
      expect(patterns.indexOf('@/auth/*')).toBeLessThan(patterns.indexOf('@/auth'));
      expect(patterns.indexOf('@/auth')).toBeLessThan(patterns.indexOf('@/*'));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('preserves multiple targets array in order', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*', 'lib/*', 'fallback/*'],
          },
        },
      });
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      expect(result!.aliases[0].targets).toEqual(['src/*', 'lib/*', 'fallback/*']);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('resolves baseUrl relative to tsconfig location', () => {
    const tmp = mkTmp();
    try {
      writeTsconfig(tmp, {
        compilerOptions: {
          baseUrl: 'src',
          paths: { '@/*': ['*'] },
        },
      });
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      expect(result!.baseUrl).toBe(path.join(tmp, 'src'));
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('parses tsconfig with // comments correctly', () => {
    const tmp = mkTmp();
    try {
      const raw = `{
  // compiler options
  "compilerOptions": {
    "baseUrl": ".", // project root
    "paths": {
      "@/*": ["src/*"] // main alias
    }
  }
}`;
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), raw, 'utf8');
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      expect(result!.aliases[0].pattern).toBe('@/*');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('parses tsconfig with /* */ block comments correctly', () => {
    const tmp = mkTmp();
    try {
      const raw = `{
  /* TypeScript configuration */
  "compilerOptions": {
    /* paths config */
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}`;
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), raw, 'utf8');
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      expect(result!.aliases[0].pattern).toBe('@/*');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('parses tsconfig with trailing commas correctly', () => {
    const tmp = mkTmp();
    try {
      const raw = `{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*",],
    },
  },
}`;
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), raw, 'utf8');
      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      expect(result!.aliases[0].targets).toEqual(['src/*']);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('follows extends chain (2 levels) and merges aliases; current file wins on collision', () => {
    const tmp = mkTmp();
    try {
      // Base tsconfig with one alias
      writeTsconfig(tmp, {
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['base-src/*'],    // should be overridden
            '@/shared/*': ['shared/*'], // should be inherited
          },
        },
      }, 'tsconfig.base.json');

      // Root tsconfig that extends base and overrides @/*
      writeTsconfig(tmp, {
        extends: './tsconfig.base.json',
        compilerOptions: {
          baseUrl: '.',
          paths: {
            '@/*': ['src/*'],         // overrides base
          },
        },
      });

      const result = loadTsAliases(tmp);
      expect(result).not.toBeNull();
      const patternMap = Object.fromEntries(result!.aliases.map((a) => [a.pattern, a.targets]));
      // Current wins: @/* → src/*
      expect(patternMap['@/*']).toEqual(['src/*']);
      // Base contributes: @/shared/* → shared/*
      expect(patternMap['@/shared/*']).toEqual(['shared/*']);
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });

  it('stops at depth 5 and warns without throwing', () => {
    // Build a chain of 6 tsconfigs: tsconfig.json → ts1.json → ts2.json → ts3.json → ts4.json → ts5.json (depth 5 = stop)
    const tmp = mkTmp();
    try {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

      // Build the chain from deepest to shallowest
      for (let i = 5; i >= 1; i--) {
        writeTsconfig(tmp, {
          extends: `./ts${i}.json`,
          compilerOptions: { baseUrl: '.', paths: { [`@level${i}/*`]: [`level${i}/*`] } },
        }, `ts${i - 1}.json`);
      }
      // ts5.json — deepest (no extends)
      writeTsconfig(tmp, {
        compilerOptions: { baseUrl: '.', paths: { '@level5/*': ['level5/*'] } },
      }, 'ts5.json');

      // Root tsconfig.json extends ts0.json
      writeTsconfig(tmp, {
        extends: './ts0.json',
        compilerOptions: { baseUrl: '.', paths: { '@root/*': ['root/*'] } },
      });

      // Should not throw
      expect(() => loadTsAliases(tmp)).not.toThrow();

      // Should have warned about depth limit
      const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
      expect(warnCalls.some((msg) => msg.includes('depth limit'))).toBe(true);

      warnSpy.mockRestore();
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// mergeTsConfigs
// ---------------------------------------------------------------------------
describe('mergeTsConfigs', () => {
  it('current wins on compilerOptions key collision', () => {
    const current: Parameters<typeof mergeTsConfigs>[0] = {
      compilerOptions: { baseUrl: 'src' },
    };
    const base: Parameters<typeof mergeTsConfigs>[1] = {
      compilerOptions: { baseUrl: 'base-src', outDir: 'dist' },
    };
    const merged = mergeTsConfigs(current, base);
    expect(merged.compilerOptions?.baseUrl).toBe('src');
    // base property not in current is preserved
    expect(merged.compilerOptions?.outDir).toBe('dist');
  });

  it('merges paths, current wins per-key', () => {
    const current: Parameters<typeof mergeTsConfigs>[0] = {
      compilerOptions: {
        paths: { '@/*': ['src/*'] },
      },
    };
    const base: Parameters<typeof mergeTsConfigs>[1] = {
      compilerOptions: {
        paths: { '@/*': ['old-src/*'], '@/lib/*': ['lib/*'] },
      },
    };
    const merged = mergeTsConfigs(current, base);
    expect(merged.compilerOptions?.paths?.['@/*']).toEqual(['src/*']);
    expect(merged.compilerOptions?.paths?.['@/lib/*']).toEqual(['lib/*']);
  });

  it('handles missing paths gracefully', () => {
    const current: Parameters<typeof mergeTsConfigs>[0] = {
      compilerOptions: { baseUrl: '.' },
    };
    const base: Parameters<typeof mergeTsConfigs>[1] = {
      compilerOptions: { paths: { '@/*': ['src/*'] } },
    };
    const merged = mergeTsConfigs(current, base);
    expect(merged.compilerOptions?.paths?.['@/*']).toEqual(['src/*']);
  });
});

// ---------------------------------------------------------------------------
// loadTsConfig
// ---------------------------------------------------------------------------
describe('loadTsConfig', () => {
  it('returns null for non-existent file', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = loadTsConfig('/nonexistent/tsconfig.json');
    expect(result).toBeNull();
    warnSpy.mockRestore();
  });

  it('parses valid tsconfig.json', () => {
    const tmp = mkTmp();
    try {
      const filePath = writeTsconfig(tmp, { compilerOptions: { baseUrl: '.' } });
      const result = loadTsConfig(filePath);
      expect(result).not.toBeNull();
      expect(result!.compilerOptions?.baseUrl).toBe('.');
    } finally {
      fs.rmSync(tmp, { recursive: true });
    }
  });
});
