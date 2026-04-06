// src/layers/embeddings/index.ts
// Public barrel export for the embeddings layer.
// Also contains matchEmbeddings() — the Layer 2 entry point.

import fs from 'fs';
import path from 'path';
import fg from 'fast-glob';
import { isTestFile } from '../static-analysis/graph/traversal';
import type { Layer1Result, Layer2Result, SelectorConfig } from '../../../shared/types';

export { embedTexts } from './client';
export type { EmbeddingResponse, EmbedOptions } from './client';
export { cosineSimilarity, routeByConfidence } from './similarity';
export { getCachedEmbedding, setCachedEmbedding, getDefaultCachePath } from './cache';

import { embedTexts } from './client';
import { cosineSimilarity, routeByConfidence } from './similarity';
import { getCachedEmbedding, setCachedEmbedding } from './cache';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMBED_CHUNK_SIZE = 64;

/** Threshold: fire tiered retrieval when testFiles.length exceeds this. */
const TIERED_THRESHOLD = 200;

/** Number of top candidates (by Hamming distance) to carry into 1024-dim re-rank. */
const TIERED_TOPK = 50;

// ---------------------------------------------------------------------------
// Exported utilities
// ---------------------------------------------------------------------------

/**
 * Compute the Hamming distance between two packed-bit uint8 arrays.
 *
 * Uses the Brian Kernighan popcount on the XOR of each byte pair.
 * Lower result = more similar (fewer differing bits).
 *
 * The two arrays must have the same length; mismatched lengths return
 * the maximum possible distance (a.length * 8) as a safe fallback.
 *
 * Voyage ubinary 256-dim output is 32 uint8 integers (256 bits packed).
 */
export function hammingDistance(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) {
    return a.length * 8; // safe worst-case fallback
  }
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    let x = (a[i] ^ b[i]) & 0xff;
    // Brian Kernighan popcount
    while (x !== 0) {
      x &= x - 1;
      dist++;
    }
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptyLayer2(): Layer2Result {
  return {
    high_confidence: [],
    medium_confidence: [],
    low_confidence: [],
    similarity_scores: {},
    cache_hits: 0,
    cache_misses: 0,
    api_cost_usd: 0,
    processing_time_ms: 0,
  };
}

// ---------------------------------------------------------------------------
// matchEmbeddings — Layer 2 entry point
// ---------------------------------------------------------------------------

/**
 * Discover all test files under projectRoot, embed the diff and each test
 * file (with cache + ≤64-file batch chunking), compute cosine similarity,
 * route results to high/medium/low confidence bands, and return a typed
 * Layer2Result.
 *
 * When testFiles.length > TIERED_THRESHOLD (200):
 *   - Tiered path: 256-dim ubinary Hamming screen → top-TIERED_TOPK → 1024-dim re-rank.
 *   - Graceful fallback: null diff binary embedding → single-pass path.
 *
 * Fail-open: any unhandled error → console.warn + return emptyLayer2().
 */
export async function matchEmbeddings(
  diff: string,
  projectRoot: string,
  config: SelectorConfig,
  layer1: Layer1Result,
): Promise<Layer2Result> {
  void config;
  void layer1;
  try {
    const t0 = Date.now();

    // -----------------------------------------------------------------------
    // Step 1 — Discover test files
    // -----------------------------------------------------------------------
    const testFiles = fg
      .sync(['**/*'], {
        cwd: projectRoot,
        onlyFiles: true,
        ignore: ['node_modules/**', '.git/**', 'dist/**'],
      })
      .filter((rel) => isTestFile(rel))
      .sort();

    if (testFiles.length === 0) {
      return emptyLayer2();
    }

    // -----------------------------------------------------------------------
    // Step 2 — Tiered path: binary screen when testFiles.length > TIERED_THRESHOLD
    // -----------------------------------------------------------------------
    // Reads file contents for all test files (needed for both paths).
    // Built here so we don't re-read in Step 3.
    const fileContents = new Map<string, string>();
    for (const file of testFiles) {
      try {
        fileContents.set(file, fs.readFileSync(path.join(projectRoot, file), 'utf8'));
      } catch {
        // Unreadable file — skip (fail-open)
      }
    }

    // Candidate list: files that were readable. Starts as all readable files.
    let candidates: string[] = testFiles.filter((f) => fileContents.has(f));

    let cacheHits = 0;
    let cacheMisses = 0;
    let apiCostUsd = 0;

    if (testFiles.length > TIERED_THRESHOLD) {
      // -------------------------------------------------------------------
      // Tiered sub-path A — 256-dim ubinary Hamming screen
      // -------------------------------------------------------------------

      // Embed diff at 256-dim ubinary (cache-first, dim=256 key)
      let diffBinary: Uint8Array | null = null;
      const cachedDiffBinary = getCachedEmbedding(diff, 256);
      if (cachedDiffBinary !== null) {
        diffBinary = new Uint8Array(cachedDiffBinary);
        cacheHits++;
      } else {
        const res = await embedTexts([diff], { outputDimension: 256, outputDtype: 'ubinary' });
        if (res !== null) {
          diffBinary = new Uint8Array(res.embeddings[0]);
          setCachedEmbedding(diff, Array.from(diffBinary), 256);
          apiCostUsd += res.cost_usd;
          cacheMisses++;
        }
        // null → diffBinary stays null → fall through to single-pass path below
      }

      if (diffBinary !== null) {
        // Embed all candidate files at 256-dim ubinary (cache-first)
        const binaryVecs = new Map<string, Uint8Array>();
        const binaryMissQueue: Array<{ file: string; content: string }> = [];

        for (const file of candidates) {
          const content = fileContents.get(file)!;
          const cached = getCachedEmbedding(content, 256);
          if (cached !== null) {
            binaryVecs.set(file, new Uint8Array(cached));
            cacheHits++;
          } else {
            binaryMissQueue.push({ file, content });
            cacheMisses++;
          }
        }

        // Batch embed binary misses in chunks
        for (let i = 0; i < binaryMissQueue.length; i += EMBED_CHUNK_SIZE) {
          const chunk = binaryMissQueue.slice(i, i + EMBED_CHUNK_SIZE);
          const sortedChunk = [...chunk].sort((a, b) =>
            a.content < b.content ? -1 : a.content > b.content ? 1 : 0,
          );
          const texts = sortedChunk.map((item) => item.content);
          const res = await embedTexts(texts, { outputDimension: 256, outputDtype: 'ubinary' });
          if (res === null) {
            // Fail-open: files with no binary vec are skipped in Hamming sort
            continue;
          }
          apiCostUsd += res.cost_usd;
          for (let j = 0; j < sortedChunk.length; j++) {
            const { file, content } = sortedChunk[j];
            const vec = new Uint8Array(res.embeddings[j]);
            binaryVecs.set(file, vec);
            setCachedEmbedding(content, Array.from(vec), 256);
          }
        }

        // Compute Hamming distances; skip files with no binary vector (fail-open)
        const hammingScores: Array<{ file: string; dist: number }> = [];
        for (const file of candidates) {
          const vec = binaryVecs.get(file);
          if (vec === undefined) continue; // no binary vec → skip
          hammingScores.push({ file, dist: hammingDistance(diffBinary, vec) });
        }

        // Sort ascending by Hamming distance (lower = more similar), take top-K
        hammingScores.sort((a, b) => a.dist - b.dist);
        candidates = hammingScores.slice(0, TIERED_TOPK).map((s) => s.file).sort();
        // ^^^  .sort() at the end restores alphabetical order for consistent output
      }
      // If diffBinary is null: candidates unchanged → full single-pass follows (graceful degradation)
    }

    // -----------------------------------------------------------------------
    // Step 3 — Embed diff at 1024-dim float (cache-first)
    // -----------------------------------------------------------------------
    let diffEmbedding: number[] | null = getCachedEmbedding(diff, 1024);
    const diffFromCache = diffEmbedding !== null;

    if (diffEmbedding === null) {
      const res = await embedTexts([diff], { outputDimension: 1024 });
      if (res === null) {
        // Can't rank without a query vector — fail-open
        return emptyLayer2();
      }
      diffEmbedding = res.embeddings[0];
      setCachedEmbedding(diff, diffEmbedding, 1024);
      apiCostUsd += res.cost_usd;
    }

    if (diffFromCache) {
      cacheHits++;
    } else {
      cacheMisses++;
    }

    // -----------------------------------------------------------------------
    // Step 4 — Per-candidate cache check (1024-dim float)
    // -----------------------------------------------------------------------
    const vectors = new Map<string, number[]>(); // file → 1024-dim embedding
    const missQueue: Array<{ file: string; content: string }> = [];

    for (const file of candidates) {
      const content = fileContents.get(file);
      if (content === undefined) continue; // file was unreadable — already skipped

      const cached = getCachedEmbedding(content, 1024);
      if (cached !== null) {
        vectors.set(file, cached);
        cacheHits++;
      } else {
        missQueue.push({ file, content });
        cacheMisses++;
      }
    }

    // -----------------------------------------------------------------------
    // Step 5 — Batch embed 1024-dim cache misses in chunks of EMBED_CHUNK_SIZE
    // -----------------------------------------------------------------------
    for (let i = 0; i < missQueue.length; i += EMBED_CHUNK_SIZE) {
      const chunk = missQueue.slice(i, i + EMBED_CHUNK_SIZE);

      // Sort texts alphabetically per AGENTS.md rule 4
      const sortedChunk = [...chunk].sort((a, b) =>
        a.content < b.content ? -1 : a.content > b.content ? 1 : 0,
      );

      const texts = sortedChunk.map((item) => item.content);
      const res = await embedTexts(texts, { outputDimension: 1024 });

      if (res === null) {
        // Fail-open — skip this chunk
        continue;
      }

      apiCostUsd += res.cost_usd;

      for (let j = 0; j < sortedChunk.length; j++) {
        const { file, content } = sortedChunk[j];
        const vec = res.embeddings[j];
        vectors.set(file, vec);
        setCachedEmbedding(content, vec, 1024);
      }
    }

    // -----------------------------------------------------------------------
    // Step 6 — Compute cosine similarity and route to confidence bands
    // -----------------------------------------------------------------------
    const high: string[] = [];
    const medium: string[] = [];
    const low: string[] = [];
    const similarityScores: Record<string, number> = {};

    for (const file of candidates) {
      const vec = vectors.get(file);
      if (vec === undefined) continue;

      const score = cosineSimilarity(diffEmbedding, vec);
      const band = routeByConfidence(score);

      similarityScores[file] = score;

      if (band === 'high') high.push(file);
      else if (band === 'medium') medium.push(file);
      else low.push(file);
    }

    // Ensure all band arrays are sorted (candidates is already sorted, but be explicit)
    high.sort();
    medium.sort();
    low.sort();

    // -----------------------------------------------------------------------
    // Step 7 — Assemble and return result
    // -----------------------------------------------------------------------
    return {
      high_confidence: high,
      medium_confidence: medium,
      low_confidence: low,
      similarity_scores: similarityScores,
      cache_hits: cacheHits,
      cache_misses: cacheMisses,
      api_cost_usd: apiCostUsd,
      processing_time_ms: Date.now() - t0,
    };
  } catch (e) {
    console.warn('[embeddings] matchEmbeddings error:', e);
    return emptyLayer2();
  }
}
