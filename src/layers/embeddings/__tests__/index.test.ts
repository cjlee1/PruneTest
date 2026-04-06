// src/layers/embeddings/__tests__/index.test.ts
// Unit tests for matchEmbeddings() — Layer 2 entry point.
//
// Strategy:
//   - jest.mock('../client') and jest.mock('../cache') to isolate I/O
//   - Real temp directories for test file discovery (avoids fast-glob mocking)
//   - Controlled mock return values to exercise every confidence band and
//     error path

jest.mock('../client');
jest.mock('../cache');

// Mock fs so that readFileSync is spyable (jest.spyOn needs configurable properties).
// Default implementation delegates to the real fs — all temp-dir I/O works normally.
jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actualFs,
    readFileSync: jest.fn(actualFs.readFileSync),
    mkdtempSync: actualFs.mkdtempSync,
    writeFileSync: actualFs.writeFileSync,
    rmSync: actualFs.rmSync,
  };
});

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { matchEmbeddings } from '../index';
import { embedTexts } from '../client';
import { getCachedEmbedding, setCachedEmbedding } from '../cache';
import type { EmbeddingResponse } from '../client';
import type { Layer2Result } from '../../../../shared/types';

// ---------------------------------------------------------------------------
// Typed mock handles
// ---------------------------------------------------------------------------

const mockEmbedTexts = embedTexts as jest.MockedFunction<typeof embedTexts>;
const mockGetCached = getCachedEmbedding as jest.MockedFunction<typeof getCachedEmbedding>;
const mockSetCached = setCachedEmbedding as jest.MockedFunction<typeof setCachedEmbedding>;

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Build an EmbeddingResponse with n identical unit vectors */
function makeEmbedResponse(n: number, costUsd = 0.001): EmbeddingResponse {
  const vec = [1, 0, 0]; // unit vector along x
  return {
    embeddings: Array.from({ length: n }, () => vec),
    model: 'voyage-code-3',
    total_tokens: n * 100,
    cost_usd: costUsd,
  };
}

/** A simple unit vector — cosine sim against itself is 1.0 (> 0.85 → high) */
const UNIT_VEC = [1, 0, 0];

/** A vector orthogonal to UNIT_VEC — cosine sim is 0.0 (< 0.3 → low) */
const ORTHO_VEC = [0, 1, 0];

// ---------------------------------------------------------------------------
// Temp directory management
// ---------------------------------------------------------------------------

let tempDir: string;

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'embed-test-'));
}

function writeTestFiles(dir: string, names: string[]): void {
  for (const name of names) {
    fs.writeFileSync(path.join(dir, name), `// ${name}\nexport {};`);
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  tempDir = createTempDir();

  // Restore readFileSync to real implementation between tests
  const realReadFileSync = jest.requireActual<typeof import('fs')>('fs').readFileSync;
  (fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>).mockImplementation(
    realReadFileSync as typeof fs.readFileSync,
  );

  // Default mock returns: cache miss, no-op write, one-embedding response
  mockGetCached.mockReturnValue(null);
  mockSetCached.mockReturnValue(undefined);
  mockEmbedTexts.mockResolvedValue(makeEmbedResponse(1));
});

afterEach(() => {
  jest.restoreAllMocks();
  fs.rmSync(tempDir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Stub config + layer1 (only used to satisfy type signature)
// ---------------------------------------------------------------------------

const STUB_CONFIG = {
  mode: 'shadow' as const,
  testRunner: 'jest' as const,
  testDir: '__tests__',
  runAllTestsOn: [],
  alwaysRun: [],
  neverRun: [],
  architectureNotes: '',
  flakyTestThreshold: 0.15,
  flakyTestQuarantine: 0.4,
  fullSuiteEvery: 50,
};

const STUB_LAYER1 = {
  blocking_candidates: [],
  run_full_suite: false,
  dependency_graph: {},
  parsing_errors: [],
  processing_time_ms: 0,
};

// ---------------------------------------------------------------------------
// T1 — Empty projectRoot: no test files → emptyLayer2()
// ---------------------------------------------------------------------------

test('T1: empty projectRoot (no test files) returns emptyLayer2()', async () => {
  // tempDir has no files written to it
  const result = await matchEmbeddings('diff content', tempDir, STUB_CONFIG, STUB_LAYER1);

  expect(result.high_confidence).toEqual([]);
  expect(result.medium_confidence).toEqual([]);
  expect(result.low_confidence).toEqual([]);
  expect(result.similarity_scores).toEqual({});
  expect(result.cache_hits).toBe(0);
  expect(result.cache_misses).toBe(0);
  expect(result.api_cost_usd).toBe(0);
  expect(mockEmbedTexts).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// T2 — All cache hits: embedTexts NOT called; counters correct
// ---------------------------------------------------------------------------

test('T2: all cache hits → embedTexts not called, cache_hits === 4', async () => {
  writeTestFiles(tempDir, ['a.test.ts', 'b.test.ts', 'c.test.ts']);

  // Every call (diff + 3 files) returns a cached vector
  mockGetCached.mockReturnValue(UNIT_VEC);

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  expect(mockEmbedTexts).not.toHaveBeenCalled();
  expect(result.cache_hits).toBe(4); // diff + 3 files
  expect(result.cache_misses).toBe(0);
  expect(Object.keys(result.similarity_scores)).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// T3 — All cache misses: embedTexts called; setCachedEmbedding called per file
// ---------------------------------------------------------------------------

test('T3: all cache misses → embedTexts called, setCachedEmbedding called per file', async () => {
  writeTestFiles(tempDir, ['a.test.ts', 'b.test.ts', 'c.test.ts']);

  // Always miss
  mockGetCached.mockReturnValue(null);
  // diff embedding returns 1 vec; file chunk returns 3 vecs
  mockEmbedTexts
    .mockResolvedValueOnce(makeEmbedResponse(1)) // diff
    .mockResolvedValueOnce(makeEmbedResponse(3)); // 3 files in one chunk

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  expect(mockEmbedTexts).toHaveBeenCalledTimes(2); // diff + 1 chunk
  // setCachedEmbedding: diff + 3 files = 4 calls
  expect(mockSetCached).toHaveBeenCalledTimes(4);
  expect(result.cache_misses).toBe(4); // diff + 3 files
  expect(result.cache_hits).toBe(0);
  expect(Object.keys(result.similarity_scores)).toHaveLength(3);
});

// ---------------------------------------------------------------------------
// T4 — Mixed hits/misses: counters correct
// ---------------------------------------------------------------------------

test('T4: mixed cache hits/misses → correct counters', async () => {
  writeTestFiles(tempDir, ['a.test.ts', 'b.test.ts']);

  const fileContents: string[] = [];
  // Capture what content is being checked
  mockGetCached.mockImplementation((content: string) => {
    // diff: miss; first file: hit; second file: miss
    if (fileContents.length === 0) {
      // diff lookup (first call)
      fileContents.push(content);
      return null; // diff miss
    }
    if (fileContents.length === 1) {
      // first file
      fileContents.push(content);
      return UNIT_VEC; // cache hit
    }
    // second file
    fileContents.push(content);
    return null; // miss
  });

  // diff embedding: 1 vec; second file chunk: 1 vec
  mockEmbedTexts
    .mockResolvedValueOnce(makeEmbedResponse(1)) // diff
    .mockResolvedValueOnce(makeEmbedResponse(1)); // 1-file chunk

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  // diff: miss (1), first file: hit (1), second file: miss (1)
  expect(result.cache_hits).toBe(1);
  expect(result.cache_misses).toBe(2);
  expect(Object.keys(result.similarity_scores)).toHaveLength(2);
});

// ---------------------------------------------------------------------------
// T5 — embedTexts returns null for file chunk: fail-open, no throw
// ---------------------------------------------------------------------------

test('T5: embedTexts returns null for file chunk → fail-open, function does not throw', async () => {
  writeTestFiles(tempDir, ['a.test.ts', 'b.test.ts']);

  mockGetCached.mockReturnValue(null);
  mockEmbedTexts
    .mockResolvedValueOnce(makeEmbedResponse(1)) // diff embedding succeeds
    .mockResolvedValueOnce(null); // file chunk fails

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  // Files absent from all bands — vectors map empty → no scores
  expect(result.high_confidence).toEqual([]);
  expect(result.medium_confidence).toEqual([]);
  expect(result.low_confidence).toEqual([]);
  expect(result.similarity_scores).toEqual({});
  // Should not throw
});

// ---------------------------------------------------------------------------
// T6 — embedTexts returns null for diff: returns emptyLayer2()
// ---------------------------------------------------------------------------

test('T6: embedTexts returns null for diff embedding → returns emptyLayer2()', async () => {
  writeTestFiles(tempDir, ['a.test.ts']);

  mockGetCached.mockReturnValue(null);
  mockEmbedTexts.mockResolvedValueOnce(null); // diff fails

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  expect(result.high_confidence).toEqual([]);
  expect(result.medium_confidence).toEqual([]);
  expect(result.low_confidence).toEqual([]);
  expect(result.cache_hits).toBe(0);
  expect(result.cache_misses).toBe(0);
  // embedTexts should only have been called once (for diff; file loop not reached)
  expect(mockEmbedTexts).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// T7 — File read error: that file is skipped, others succeed
// ---------------------------------------------------------------------------

test('T7: readFileSync throws for one file → that file is skipped, others succeed', async () => {
  writeTestFiles(tempDir, ['a.test.ts', 'b.test.ts']);

  const realReadFileSync = jest.requireActual<typeof import('fs')>('fs').readFileSync;
  const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;

  // Override readFileSync: throw for a.test.ts, pass through for everything else
  mockReadFileSync.mockImplementation(
    (filePath: fs.PathOrFileDescriptor, options?: unknown) => {
      const p = String(filePath);
      if (p.endsWith('a.test.ts')) {
        throw new Error('EACCES: permission denied');
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return realReadFileSync(filePath as any, options as any) as any;
    },
  );

  // diff: miss; b.test.ts file: miss
  mockGetCached.mockReturnValue(null);
  // diff embedding + 1-file chunk for b.test.ts (a.test.ts is skipped)
  mockEmbedTexts
    .mockResolvedValueOnce(makeEmbedResponse(1))  // diff
    .mockResolvedValueOnce(makeEmbedResponse(1)); // b.test.ts chunk

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  // Restore the real readFileSync for subsequent tests
  mockReadFileSync.mockImplementation(realReadFileSync as typeof fs.readFileSync);

  // Only b.test.ts should appear; a.test.ts was skipped due to read error
  const allFiles = [
    ...result.high_confidence,
    ...result.medium_confidence,
    ...result.low_confidence,
  ];
  expect(allFiles.some((f) => f.endsWith('a.test.ts'))).toBe(false);
  expect(allFiles.some((f) => f.endsWith('b.test.ts'))).toBe(true);
});

// ---------------------------------------------------------------------------
// T8 — Alphabetical ordering of band arrays
// ---------------------------------------------------------------------------

test('T8: band arrays are in alphabetical order', async () => {
  // Write files with names that would NOT be alphabetical if unsorted
  writeTestFiles(tempDir, ['z.test.ts', 'a.test.ts', 'm.test.ts']);

  // diff: hit (UNIT_VEC). Files: use controlled vectors to land in different bands.
  // Diff vector is UNIT_VEC = [1,0,0].
  // z.test.ts → high  (score > 0.85): give it UNIT_VEC [1,0,0], cos = 1.0
  // a.test.ts → medium (0.3–0.7):     give it [1,1.5,0], cos ≈ 0.555
  // m.test.ts → low   (< 0.3):        give it ORTHO_VEC [0,1,0], cos = 0.0

  const mediumTestVec = [1, 1.5, 0];

  // Files are discovered alphabetically: a.test.ts, m.test.ts, z.test.ts
  // getCachedEmbedding call order: diff, a.test.ts, m.test.ts, z.test.ts
  let callIndex = 0;
  mockGetCached.mockImplementation(() => {
    const idx = callIndex++;
    if (idx === 0) return UNIT_VEC; // diff → cache hit
    if (idx === 1) return mediumTestVec; // a.test.ts → medium band
    if (idx === 2) return ORTHO_VEC;    // m.test.ts → low band
    if (idx === 3) return UNIT_VEC;     // z.test.ts → high band
    return null;
  });

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  expect(mockEmbedTexts).not.toHaveBeenCalled();

  // Verify band assignments
  expect(result.high_confidence).toContain('z.test.ts');
  expect(result.medium_confidence).toContain('a.test.ts');
  expect(result.low_confidence).toContain('m.test.ts');

  // Verify alphabetical order within each band
  const isSorted = (arr: string[]) =>
    arr.every((v, i) => i === 0 || arr[i - 1] <= v);

  expect(isSorted(result.high_confidence)).toBe(true);
  expect(isSorted(result.medium_confidence)).toBe(true);
  expect(isSorted(result.low_confidence)).toBe(true);
});

// ---------------------------------------------------------------------------
// T9 — R019 benchmark: 50 files, all cached, < 500 ms, cache_hits === 51
// ---------------------------------------------------------------------------

test('T9 (R019): 50 test files all cached → processing_time_ms < 500, cache_hits === 51', async () => {
  const names = Array.from({ length: 50 }, (_, i) => `test-${i.toString().padStart(3, '0')}.test.ts`);
  writeTestFiles(tempDir, names);

  // All cache hits (diff + 50 files)
  mockGetCached.mockReturnValue(UNIT_VEC);

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  expect(mockEmbedTexts).not.toHaveBeenCalled();
  expect(result.cache_hits).toBe(51); // diff + 50 files
  expect(result.cache_misses).toBe(0);
  expect(result.processing_time_ms).toBeLessThan(500);
}, 10_000);

// ---------------------------------------------------------------------------
// T10 — api_cost_usd accumulates across chunks (65 files → 2 chunks)
// ---------------------------------------------------------------------------

test('T10: 65 cache-miss files → embedTexts called twice, api_cost_usd is sum', async () => {
  const names = Array.from({ length: 65 }, (_, i) => `f${i.toString().padStart(3, '0')}.test.ts`);
  writeTestFiles(tempDir, names);

  mockGetCached.mockReturnValue(null);

  const COST_1 = 0.0056;
  const COST_2 = 0.0008;

  mockEmbedTexts
    .mockResolvedValueOnce(makeEmbedResponse(1, 0)) // diff (cost 0)
    .mockResolvedValueOnce({
      embeddings: Array.from({ length: 64 }, () => UNIT_VEC),
      model: 'voyage-code-3',
      total_tokens: 6400,
      cost_usd: COST_1,
    }) // chunk 1: 64 files
    .mockResolvedValueOnce({
      embeddings: Array.from({ length: 1 }, () => UNIT_VEC),
      model: 'voyage-code-3',
      total_tokens: 100,
      cost_usd: COST_2,
    }); // chunk 2: 1 file

  const result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  // diff call + 2 file-chunk calls = 3 total
  expect(mockEmbedTexts).toHaveBeenCalledTimes(3);
  expect(result.api_cost_usd).toBeCloseTo(COST_1 + COST_2, 6);
}, 15_000);

// ---------------------------------------------------------------------------
// T11 — Band routing correctness: explicit scores → correct bands
// ---------------------------------------------------------------------------

test('T11: band routing correctness — high > 0.85, medium 0.3–0.7, low < 0.3', async () => {
  writeTestFiles(tempDir, ['high.test.ts', 'medium.test.ts', 'low.test.ts']);

  // Diff vector: UNIT_VEC [1, 0, 0]
  // high.test.ts → cosine ≈ 1.0 (identical → high)
  // medium.test.ts → cosine ≈ 0.555 (medium)
  // low.test.ts → cosine = 0.0 (low)

  const highVec = [1, 0, 0];           // cos([1,0,0],[1,0,0]) = 1.0 → high
  const mediumVec = [1, 1.5, 0];       // cos([1,0,0],[1,1.5,0]) ≈ 0.555 → medium
  const lowVec = [0, 1, 0];            // cos([1,0,0],[0,1,0]) = 0.0 → low

  // Discovery order: high.test.ts, low.test.ts, medium.test.ts (alphabetical)
  // getCached call order: diff(0), high(1), low(2), medium(3)
  let callIndex = 0;
  mockGetCached.mockImplementation(() => {
    const idx = callIndex++;
    if (idx === 0) return UNIT_VEC;  // diff
    if (idx === 1) return highVec;   // high.test.ts
    if (idx === 2) return lowVec;    // low.test.ts
    if (idx === 3) return mediumVec; // medium.test.ts
    return null;
  });

  const result: Layer2Result = await matchEmbeddings('diff', tempDir, STUB_CONFIG, STUB_LAYER1);

  expect(result.high_confidence).toContain('high.test.ts');
  expect(result.medium_confidence).toContain('medium.test.ts');
  expect(result.low_confidence).toContain('low.test.ts');

  // Verify score entries exist
  expect(result.similarity_scores['high.test.ts']).toBeGreaterThan(0.85);
  expect(result.similarity_scores['medium.test.ts']).toBeGreaterThanOrEqual(0.3);
  expect(result.similarity_scores['medium.test.ts']).toBeLessThanOrEqual(0.7);
  expect(result.similarity_scores['low.test.ts']).toBeLessThan(0.3);
});
