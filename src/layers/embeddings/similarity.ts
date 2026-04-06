// src/layers/embeddings/similarity.ts
// Cosine similarity computation and confidence band router.

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

/**
 * Compute cosine similarity between two vectors.
 *
 * Returns a value in [-1, 1].
 * Returns 0 if:
 *   - Either vector is zero-length (empty array)
 *   - Vectors have different lengths
 *   - Either vector is the zero vector (magnitude = 0)
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  if (magnitude === 0) return 0;

  // Clamp to [-1, 1] to guard against floating-point drift
  return Math.max(-1, Math.min(1, dot / magnitude));
}

// ---------------------------------------------------------------------------
// Confidence Band Router
// ---------------------------------------------------------------------------

/**
 * Route a similarity score to a confidence band.
 *
 * Bands (per AGENTS.md spec):
 *   - 'high'   : score > 0.85
 *   - 'medium' : score >= 0.30 AND score <= 0.70
 *   - 'low'    : everything else (includes the 0.70–0.85 gap zone)
 *
 * The gap zone (score > 0.70 and score <= 0.85) intentionally maps to 'low',
 * not 'medium'. Only the strict 0.3–0.7 range qualifies for medium.
 */
export function routeByConfidence(score: number): 'high' | 'medium' | 'low' {
  if (score > 0.85) return 'high';
  if (score >= 0.3 && score <= 0.7) return 'medium';
  return 'low';
}
