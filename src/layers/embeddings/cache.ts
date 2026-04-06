// src/layers/embeddings/cache.ts
// SHA-keyed, dim-keyed embedding cache with in-memory guard.
// All I/O is fail-open: errors produce console.warn, never throw to caller.

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CacheEntry {
  vector: number[];
  dim: number;
  model: string;
}

interface CacheFile {
  [key: string]: CacheEntry;
}

// ---------------------------------------------------------------------------
// Module-level in-memory guard
// ---------------------------------------------------------------------------

let memCache: Map<string, CacheEntry> | null = null;
let activeCachePath: string | null = null;

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Returns the default path for the embedding cache JSON file.
 * Located in the OS temp directory so it survives across runs on the same machine.
 */
export function getDefaultCachePath(): string {
  return path.join(os.tmpdir(), 'testselector-embed-cache.json');
}

/**
 * Reset in-memory state. Exported for unit tests only — do not call in production code.
 */
export function _resetMemCacheForTesting(): void {
  memCache = null;
  activeCachePath = null;
}

/**
 * Look up a cached embedding vector for the given content at the given dimension.
 * Returns the vector if found (and dim matches), otherwise null.
 * Fail-open: any error → console.warn + return null.
 */
export function getCachedEmbedding(
  content: string,
  dim: number,
  cachePath?: string,
): number[] | null {
  try {
    const resolvedPath = cachePath ?? getDefaultCachePath();
    _ensureCacheLoaded(resolvedPath);

    const key = makeCacheKey(content, dim);
    const entry = memCache!.get(key);
    if (entry === undefined) {
      return null;
    }
    // Dim check is encoded in the key, but double-check for safety
    if (entry.dim !== dim) {
      return null;
    }
    return entry.vector;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[embeddings/cache] getCachedEmbedding error: ${msg}`);
    return null;
  }
}

/**
 * Store a new embedding vector in both the in-memory cache and the on-disk JSON file.
 * Fail-open: any error → console.warn, never throws.
 */
export function setCachedEmbedding(
  content: string,
  vector: number[],
  dim: number,
  cachePath?: string,
): void {
  try {
    const resolvedPath = cachePath ?? getDefaultCachePath();
    _ensureCacheLoaded(resolvedPath);

    const key = makeCacheKey(content, dim);
    const entry: CacheEntry = { vector, dim, model: '' };

    // Update in-memory cache
    memCache!.set(key, entry);

    // Read existing disk file (or start from empty object), merge, write back
    let diskData: CacheFile = {};
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        diskData = parsed as CacheFile;
      }
    } catch (readErr: unknown) {
      const readErrObj = readErr as NodeJS.ErrnoException;
      if (readErrObj.code !== 'ENOENT') {
        // Non-ENOENT read error on write path — start from empty, keep going
        console.warn(
          `[embeddings/cache] setCachedEmbedding read error (starting fresh): ${readErrObj.message ?? String(readErr)}`,
        );
      }
      // ENOENT → diskData stays {}
    }

    diskData[key] = entry;
    fs.writeFileSync(resolvedPath, JSON.stringify(diskData), 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[embeddings/cache] setCachedEmbedding error: ${msg}`);
    // Never throw — fail-open
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a content-addressed, dim-keyed cache key.
 * Encoding dim in the key prevents Matryoshka cross-contamination.
 */
function makeCacheKey(content: string, dim: number): string {
  return 'sha256:' + crypto.createHash('sha256').update(content).digest('hex') + ':dim' + dim;
}

/**
 * Load the cache from disk into memCache if it hasn't been loaded yet,
 * or if the cachePath has changed since last load.
 */
function _ensureCacheLoaded(cachePath: string): void {
  if (memCache !== null && activeCachePath === cachePath) {
    return; // already loaded for this path
  }
  memCache = loadCache(cachePath);
  activeCachePath = cachePath;
}

/**
 * Read and parse the cache file from disk.
 * ENOENT → returns empty Map (normal cold-cache condition, no warning).
 * Other errors → console.warn + returns empty Map.
 */
function loadCache(cachePath: string): Map<string, CacheEntry> {
  try {
    const raw = fs.readFileSync(cachePath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn(`[embeddings/cache] loadCache: JSON parse error in ${cachePath}`);
      return new Map();
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn(`[embeddings/cache] loadCache: unexpected shape in ${cachePath}`);
      return new Map();
    }
    const file = parsed as CacheFile;
    const map = new Map<string, CacheEntry>();
    for (const [k, v] of Object.entries(file)) {
      if (
        v &&
        typeof v === 'object' &&
        Array.isArray(v.vector) &&
        typeof v.dim === 'number' &&
        typeof v.model === 'string'
      ) {
        map.set(k, v);
      }
    }
    return map;
  } catch (err: unknown) {
    const errObj = err as NodeJS.ErrnoException;
    if (errObj.code === 'ENOENT') {
      return new Map(); // cold cache — not an error
    }
    console.warn(
      `[embeddings/cache] loadCache: read error for ${cachePath}: ${errObj.message ?? String(err)}`,
    );
    return new Map();
  }
}
