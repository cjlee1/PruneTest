// src/layers/embeddings/__tests__/cache.test.ts
// Unit tests for the SHA-keyed embedding cache module.
// fs is mocked at the top level (hoisted by Jest).

jest.mock('fs', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actualFs,
    readFileSync: jest.fn(actualFs.readFileSync),
    writeFileSync: jest.fn(actualFs.writeFileSync),
  };
});

import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  getCachedEmbedding,
  setCachedEmbedding,
  getDefaultCachePath,
  _resetMemCacheForTesting,
} from '../cache';

const mockReadFileSync = fs.readFileSync as jest.MockedFunction<typeof fs.readFileSync>;
const mockWriteFileSync = fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>;

/** Build the same SHA-keyed cache key that cache.ts uses internally */
function makeCacheKey(content: string, dim: number): string {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex') + ':dim' + dim;
}

const DEFAULT_PATH = getDefaultCachePath();
const TEST_CONTENT = 'function hello() {}';
const TEST_VECTOR = [0.1, 0.2, 0.3];
const TEST_DIM = 256;

beforeEach(() => {
  jest.clearAllMocks();
  _resetMemCacheForTesting();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Test 1: cache miss — file does not exist (ENOENT) → returns null, no throw
// ---------------------------------------------------------------------------
test('cache miss: file does not exist → returns null without throwing', () => {
  const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  mockReadFileSync.mockImplementation(() => { throw err; });

  const result = getCachedEmbedding(TEST_CONTENT, TEST_DIM);

  expect(result).toBeNull();
  expect(console.warn).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// Test 2: cache miss — file exists but key not present → returns null
// ---------------------------------------------------------------------------
test('cache miss: file exists but key not present → returns null', () => {
  const otherKey = makeCacheKey('other content', TEST_DIM);
  const fileData = JSON.stringify({ [otherKey]: { vector: [9, 8, 7], dim: TEST_DIM, model: '' } });
  mockReadFileSync.mockReturnValue(fileData as unknown as string);

  const result = getCachedEmbedding(TEST_CONTENT, TEST_DIM);

  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// Test 3: cache hit — SHA matches, dim matches → returns correct vector
// ---------------------------------------------------------------------------
test('cache hit: SHA and dim match → returns correct vector', () => {
  const key = makeCacheKey(TEST_CONTENT, TEST_DIM);
  const fileData = JSON.stringify({ [key]: { vector: TEST_VECTOR, dim: TEST_DIM, model: '' } });
  mockReadFileSync.mockReturnValue(fileData as unknown as string);

  const result = getCachedEmbedding(TEST_CONTENT, TEST_DIM);

  expect(result).toEqual(TEST_VECTOR);
});

// ---------------------------------------------------------------------------
// Test 4: dim mismatch — entry exists but dim differs → returns null
// ---------------------------------------------------------------------------
test('dim mismatch: entry exists at dim=256 but dim=1024 requested → returns null', () => {
  // Store with dim 256; key encodes dim so the key won't match dim 1024
  const key256 = makeCacheKey(TEST_CONTENT, 256);
  const fileData = JSON.stringify({ [key256]: { vector: TEST_VECTOR, dim: 256, model: '' } });
  mockReadFileSync.mockReturnValue(fileData as unknown as string);

  // Request with dim 1024 — different key, not found
  const result = getCachedEmbedding(TEST_CONTENT, 1024);

  expect(result).toBeNull();
});

// ---------------------------------------------------------------------------
// Test 5: write + read round-trip (in-memory) → returns same vector
// ---------------------------------------------------------------------------
test('write + read round-trip via in-memory cache → returns same vector', () => {
  // readFileSync returns ENOENT on initial load, then empty object for the write-merge read
  const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  mockReadFileSync
    .mockImplementationOnce(() => { throw enoentErr; })  // first load (cold cache)
    .mockImplementationOnce(() => { throw enoentErr; }); // read on write-merge path
  mockWriteFileSync.mockImplementation(() => undefined);

  setCachedEmbedding(TEST_CONTENT, TEST_VECTOR, TEST_DIM);

  // After set, the in-memory cache is warm — no additional readFileSync needed
  const result = getCachedEmbedding(TEST_CONTENT, TEST_DIM);

  expect(result).toEqual(TEST_VECTOR);
  // Only one readFileSync call for the initial load during getCachedEmbedding
  // (setCachedEmbedding loads first, then getCachedEmbedding reuses it)
  expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
});

// ---------------------------------------------------------------------------
// Test 6: write calls writeFileSync with the correct cache path
// ---------------------------------------------------------------------------
test('setCachedEmbedding calls writeFileSync with default cache path', () => {
  const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  mockReadFileSync.mockImplementation(() => { throw enoentErr; });
  mockWriteFileSync.mockImplementation(() => undefined);

  setCachedEmbedding(TEST_CONTENT, TEST_VECTOR, TEST_DIM);

  expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  const [calledPath] = mockWriteFileSync.mock.calls[0] as [string, ...unknown[]];
  expect(calledPath).toBe(DEFAULT_PATH);
});

// ---------------------------------------------------------------------------
// Test 7: read I/O error (non-ENOENT) → console.warn called, returns null
// ---------------------------------------------------------------------------
test('read I/O error (non-ENOENT) → console.warn called, returns null', () => {
  const err = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
  mockReadFileSync.mockImplementation(() => { throw err; });

  const result = getCachedEmbedding(TEST_CONTENT, TEST_DIM);

  expect(result).toBeNull();
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining('[embeddings/cache]'),
  );
});

// ---------------------------------------------------------------------------
// Test 8: write I/O error (writeFileSync throws) → console.warn called, does NOT throw
// ---------------------------------------------------------------------------
test('write I/O error → console.warn called, does not throw', () => {
  const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  mockReadFileSync.mockImplementation(() => { throw enoentErr; });
  mockWriteFileSync.mockImplementation(() => { throw new Error('ENOSPC: no space left'); });

  expect(() => {
    setCachedEmbedding(TEST_CONTENT, TEST_VECTOR, TEST_DIM);
  }).not.toThrow();

  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining('[embeddings/cache]'),
  );
});

// ---------------------------------------------------------------------------
// Test 9: malformed JSON in cache file → console.warn called, returns null
// ---------------------------------------------------------------------------
test('malformed JSON in cache file → console.warn called, returns null', () => {
  mockReadFileSync.mockReturnValue('{ this is not valid json }' as unknown as string);

  const result = getCachedEmbedding(TEST_CONTENT, TEST_DIM);

  expect(result).toBeNull();
  expect(console.warn).toHaveBeenCalledWith(
    expect.stringContaining('[embeddings/cache]'),
  );
});

// ---------------------------------------------------------------------------
// Test 10: custom cachePath override — writeFileSync and readFileSync receive custom path
// ---------------------------------------------------------------------------
test('custom cachePath override is used for both read and write', () => {
  const customPath = '/tmp/custom-embed-cache.json';
  const enoentErr = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  mockReadFileSync.mockImplementation(() => { throw enoentErr; });
  mockWriteFileSync.mockImplementation(() => undefined);

  setCachedEmbedding(TEST_CONTENT, TEST_VECTOR, TEST_DIM, customPath);

  // readFileSync called with custom path (for initial load)
  const readCalls = mockReadFileSync.mock.calls as [string, ...unknown[]][];
  expect(readCalls.some(([p]) => p === customPath)).toBe(true);

  // writeFileSync called with custom path
  const writeCalls = mockWriteFileSync.mock.calls as [string, ...unknown[]][];
  expect(writeCalls.some(([p]) => p === customPath)).toBe(true);
});
