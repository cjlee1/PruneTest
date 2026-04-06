// src/layers/ml/__tests__/index.test.ts
// Integration tests for scoreWithML entry point.
// runInference is mocked to avoid onnxruntime-node VM sandbox realm issues.

import type { RunRecord, Layer1Result, Layer2Result, TestRecord } from '../../../../shared/types';

// Mock the inference module before importing scoreWithML
jest.mock('../inference', () => ({
  runInference: jest.fn(),
}));

import { scoreWithML } from '../index';
import { runInference } from '../inference';

const mockedRunInference = runInference as jest.MockedFunction<typeof runInference>;

// ---- Helpers ---------------------------------------------------------------

function createSyntheticRunHistory(n: number, repoId: string): RunRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `run-${i}`,
    repo_id: repoId,
    pr_number: i + 1,
    sha: `sha${i}`,
    predicted_skip: [],
    actual_failures: [],
    all_tests: [],
    mode: 'shadow',
    created_at: new Date(Date.now() - i * 86_400_000),
  }));
}

const EMPTY_LAYER1: Layer1Result = {
  blocking_candidates: [],
  run_full_suite: false,
  dependency_graph: {},
  parsing_errors: [],
  processing_time_ms: 0,
};

const EMPTY_LAYER2: Layer2Result = {
  high_confidence: [],
  medium_confidence: [],
  low_confidence: [],
  similarity_scores: {},
  cache_hits: 0,
  cache_misses: 0,
  api_cost_usd: 0,
  processing_time_ms: 0,
};

const CANDIDATES = ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'];
const TESTS: TestRecord[] = [];
const REPO_ID = 'repo-test';

// ---- Tests -----------------------------------------------------------------

describe('scoreWithML — dormancy gate', () => {
  beforeEach(() => {
    mockedRunInference.mockReset();
  });

  it('returns model_active:false with 50 RunRecords, all scores === 0.5', async () => {
    const history = createSyntheticRunHistory(50, REPO_ID);
    const result = await scoreWithML(CANDIDATES, EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(result.model_active).toBe(false);
    expect(result.model_version).toBe('dormant');
    expect(result.ranked_tests).toHaveLength(CANDIDATES.length);
    for (const t of result.ranked_tests) {
      expect(t.score).toBe(0.5);
    }
    // runInference should NOT be called when dormancy gate triggers
    expect(mockedRunInference).not.toHaveBeenCalled();
  });

  it('returns model_active:false with exactly 99 RunRecords', async () => {
    const history = createSyntheticRunHistory(99, REPO_ID);
    const result = await scoreWithML(CANDIDATES, EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(result.model_active).toBe(false);
    expect(result.training_runs_available).toBe(99);
    expect(mockedRunInference).not.toHaveBeenCalled();
  });

  it('returns model_active:false with empty runHistory', async () => {
    const result = await scoreWithML(CANDIDATES, EMPTY_LAYER1, EMPTY_LAYER2, [], TESTS);
    expect(result.model_active).toBe(false);
    expect(result.training_runs_available).toBe(0);
    expect(mockedRunInference).not.toHaveBeenCalled();
  });
});

describe('scoreWithML — with model active', () => {
  beforeEach(() => {
    mockedRunInference.mockReset();
  });

  it('returns model_active:true with 100 RunRecords and valid inference results', async () => {
    // Mock runInference to return realistic scores
    mockedRunInference.mockResolvedValueOnce(new Float32Array([0.8, 0.5, 0.3]));
    const history = createSyntheticRunHistory(100, REPO_ID);
    const result = await scoreWithML(CANDIDATES, EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(result.model_active).toBe(true);
    expect(result.model_version).toBe('gbdt-v1');
    expect(result.ranked_tests).toHaveLength(CANDIDATES.length);
    expect(result.training_runs_available).toBe(100);
    for (const t of result.ranked_tests) {
      expect(t.score).toBeGreaterThanOrEqual(0);
      expect(t.score).toBeLessThanOrEqual(1);
      expect(t.features_used).toContain('embedding_similarity');
    }
    expect(mockedRunInference).toHaveBeenCalledTimes(1);
  });

  it('returns model_active:false when inference returns all zeros (fail-open)', async () => {
    // Simulate model-file-missing or inference-error: runInference returns zeros
    mockedRunInference.mockResolvedValueOnce(new Float32Array([0, 0, 0]));
    const history = createSyntheticRunHistory(100, REPO_ID);
    const result = await scoreWithML(CANDIDATES, EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(result.model_active).toBe(false);
    for (const t of result.ranked_tests) {
      expect(t.score).toBe(0.5);
    }
  });

  it('returns ranked_tests sorted descending by score', async () => {
    mockedRunInference.mockResolvedValueOnce(new Float32Array([0.3, 0.9, 0.6]));
    const history = createSyntheticRunHistory(100, REPO_ID);
    const result = await scoreWithML(CANDIDATES, EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(result.model_active).toBe(true);
    const scores = result.ranked_tests.map((t) => t.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
    // Verify the sort order matches expected
    expect(scores[0]).toBeCloseTo(0.9, 1);
    expect(scores[1]).toBeCloseTo(0.6, 1);
    expect(scores[2]).toBeCloseTo(0.3, 1);
  });

  it('returns Layer3Result with ranked_tests:[] for empty candidates', async () => {
    const history = createSyntheticRunHistory(100, REPO_ID);
    const result = await scoreWithML([], EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(result.ranked_tests).toEqual([]);
    expect(result.model_active).toBe(true);
    // No inference needed for zero candidates
    expect(mockedRunInference).not.toHaveBeenCalled();
  });

  it('includes processing_time_ms in result', async () => {
    const history = createSyntheticRunHistory(50, REPO_ID);
    const result = await scoreWithML(CANDIDATES, EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(typeof result.processing_time_ms).toBe('number');
    expect(result.processing_time_ms).toBeGreaterThanOrEqual(0);
  });

  it('passes correct feature matrix dimensions to runInference', async () => {
    mockedRunInference.mockResolvedValueOnce(new Float32Array([0.7, 0.4]));
    const twoCandidates = ['test/x.test.ts', 'test/y.test.ts'];
    const history = createSyntheticRunHistory(100, REPO_ID);
    await scoreWithML(twoCandidates, EMPTY_LAYER1, EMPTY_LAYER2, history, TESTS);
    expect(mockedRunInference).toHaveBeenCalledTimes(1);
    const [modelPath, featureMatrix, numCandidates] = mockedRunInference.mock.calls[0];
    expect(typeof modelPath).toBe('string');
    expect(modelPath).toContain('gbdt.onnx');
    expect(featureMatrix).toBeInstanceOf(Float32Array);
    expect(featureMatrix.length).toBe(twoCandidates.length * 8);
    expect(numCandidates).toBe(twoCandidates.length);
  });
});
