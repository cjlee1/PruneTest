// src/layers/embeddings/__tests__/similarity.test.ts

import { cosineSimilarity, routeByConfidence } from '../similarity';

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  describe('orthogonal / identical / opposite vectors', () => {
    it('returns 0 for orthogonal unit vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
    });

    it('returns 1 for identical vectors', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 10);
    });

    it('returns -1 for opposite vectors', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 10);
    });
  });

  describe('known-value cases', () => {
    it('[1,0,0] vs [0,1,0] → 0', () => {
      expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0, 10);
    });

    it('[1,1] vs [1,1] → 1', () => {
      expect(cosineSimilarity([1, 1], [1, 1])).toBeCloseTo(1, 10);
    });

    it('[3,4] vs [3,4] → 1', () => {
      expect(cosineSimilarity([3, 4], [3, 4])).toBeCloseTo(1, 10);
    });
  });

  describe('edge cases', () => {
    it('returns 0 for empty vectors', () => {
      expect(cosineSimilarity([], [])).toBe(0);
    });

    it('returns 0 for zero vector', () => {
      expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    });

    it('returns 0 for both zero vectors', () => {
      expect(cosineSimilarity([0, 0], [0, 0])).toBe(0);
    });

    it('returns 0 for mismatched lengths', () => {
      expect(cosineSimilarity([1, 2, 3], [1, 2])).toBe(0);
    });

    it('result is clamped to [-1, 1]', () => {
      // Identical vectors should be exactly 1 (no drift beyond bounds)
      const result = cosineSimilarity([1, 1, 1], [1, 1, 1]);
      expect(result).toBeGreaterThanOrEqual(-1);
      expect(result).toBeLessThanOrEqual(1);
    });
  });
});

// ---------------------------------------------------------------------------
// routeByConfidence
// ---------------------------------------------------------------------------

describe('routeByConfidence', () => {
  describe('high confidence band (score > 0.85)', () => {
    it('0.86 → high', () => {
      expect(routeByConfidence(0.86)).toBe('high');
    });

    it('1.0 → high', () => {
      expect(routeByConfidence(1.0)).toBe('high');
    });
  });

  describe('boundary: 0.85 (not > 0.85, falls to low gap zone)', () => {
    it('0.85 → low (gap zone: > 0.70 and <= 0.85)', () => {
      expect(routeByConfidence(0.85)).toBe('low');
    });
  });

  describe('medium confidence band (0.30 <= score <= 0.70)', () => {
    it('0.70 → medium (upper inclusive boundary)', () => {
      expect(routeByConfidence(0.70)).toBe('medium');
    });

    it('0.30 → medium (lower inclusive boundary)', () => {
      expect(routeByConfidence(0.30)).toBe('medium');
    });

    it('0.50 → medium (midpoint)', () => {
      expect(routeByConfidence(0.50)).toBe('medium');
    });
  });

  describe('low confidence band', () => {
    it('0.29 → low (just below medium lower bound)', () => {
      expect(routeByConfidence(0.29)).toBe('low');
    });

    it('0.0 → low', () => {
      expect(routeByConfidence(0.0)).toBe('low');
    });

    it('0.75 → low (gap zone: > 0.70 and <= 0.85)', () => {
      expect(routeByConfidence(0.75)).toBe('low');
    });
  });
});
