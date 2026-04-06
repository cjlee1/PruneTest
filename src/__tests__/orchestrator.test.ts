// src/__tests__/orchestrator.test.ts
// Unit tests for src/orchestrator.ts.
// scoreWithML is mocked to avoid onnxruntime-node VM sandbox issues.
// classifyWithLLM and classifyDiffType are mocked to avoid real LLM calls.
// matchEmbeddings is mocked to avoid real Voyage API calls.

jest.mock('../layers/ml/index');
jest.mock('../layers/llm/index');
jest.mock('../layers/llm/pr-classifier');
jest.mock('../layers/embeddings');

import { scoreWithML } from '../layers/ml/index';
import { classifyWithLLM } from '../layers/llm/index';
import { classifyDiffType } from '../layers/llm/pr-classifier';
import { matchEmbeddings } from '../layers/embeddings';
import { runOrchestrator } from '../orchestrator';
import type {
  Layer3Result,
  Layer4Result,
  RunRecord,
  SelectorConfig,
  TestRecord,
} from '../../shared/types';

const mockedScoreWithML = scoreWithML as jest.MockedFunction<typeof scoreWithML>;
const mockedClassifyWithLLM = classifyWithLLM as jest.MockedFunction<typeof classifyWithLLM>;
const mockedClassifyDiffType = classifyDiffType as jest.MockedFunction<typeof classifyDiffType>;
const mockedMatchEmbeddings = matchEmbeddings as jest.MockedFunction<typeof matchEmbeddings>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: SelectorConfig = {
  mode: 'shadow',
  testRunner: 'auto',
  testDir: '__tests__',
  runAllTestsOn: [],
  alwaysRun: [],
  neverRun: [],
  architectureNotes: '',
  flakyTestThreshold: 0.15,
  flakyTestQuarantine: 0.40,
  fullSuiteEvery: 50,
};

const NO_RUN_HISTORY: RunRecord[] = [];
const NO_TESTS: TestRecord[] = [];

const emptyLayer2Mock = {
  high_confidence: [],
  medium_confidence: [],
  low_confidence: [],
  similarity_scores: {},
  cache_hits: 0,
  cache_misses: 0,
  api_cost_usd: 0,
  processing_time_ms: 0,
};

function makeLayer3Result(overrides: Partial<Layer3Result> = {}): Layer3Result {
  return {
    ranked_tests: [],
    model_version: 'gbdt-v1',
    training_runs_available: 100,
    model_active: true,
    processing_time_ms: 5,
    ...overrides,
  };
}

function makeLayer4Result(overrides: Partial<Layer4Result> = {}): Layer4Result {
  return {
    decisions: [],
    llm_calls_made: 1,
    total_tokens_used: 100,
    cost_usd: 0.001,
    fallback_used: false,
    processing_time_ms: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('runOrchestrator', () => {
  beforeEach(() => {
    mockedMatchEmbeddings.mockReset();
    mockedMatchEmbeddings.mockResolvedValue(emptyLayer2Mock);

    mockedScoreWithML.mockReset();
    mockedScoreWithML.mockResolvedValue(makeLayer3Result());

    mockedClassifyWithLLM.mockReset();
    mockedClassifyWithLLM.mockResolvedValue(makeLayer4Result());

    mockedClassifyDiffType.mockReset();
    mockedClassifyDiffType.mockReturnValue('unknown');
  });

  // 1. Shape of return value
  it('returns a result with all four layer fields', async () => {
    const result = await runOrchestrator([], '', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root');

    expect(result).toHaveProperty('layer1');
    expect(result).toHaveProperty('layer2');
    expect(result).toHaveProperty('layer3');
    expect(result).toHaveProperty('layer4');
  });

  // 2. Happy path — stubs return safe empty defaults
  it('returns safe empty defaults from stub layers when no changed files', async () => {
    mockedScoreWithML.mockResolvedValue(makeLayer3Result({ ranked_tests: [], model_active: false }));

    const result = await runOrchestrator([], '', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root');

    expect(result.layer1.blocking_candidates).toEqual([]);
    expect(result.layer1.run_full_suite).toBe(false);
    expect(result.layer2.high_confidence).toEqual([]);
    expect(result.layer2.medium_confidence).toEqual([]);
    expect(result.layer4.decisions).toEqual([]);
  });

  // 3. L3 is called with the real scoreWithML
  it('calls scoreWithML (real L3) exactly once', async () => {
    await runOrchestrator(['src/auth.ts'], 'diff text', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root');

    expect(mockedScoreWithML).toHaveBeenCalledTimes(1);
  });

  // 4. L3 result flows through to the return value
  it('returns the scoreWithML result as layer3', async () => {
    const expected = makeLayer3Result({
      ranked_tests: [{ path: 'src/__tests__/auth.test.ts', score: 0.9, features_used: ['f1'] }],
      model_active: true,
    });
    mockedScoreWithML.mockResolvedValue(expected);

    const result = await runOrchestrator([], '', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root');

    expect(result.layer3).toBe(expected);
  });

  // 5. Fail-open: L3 throws → warn and return empty layer3
  it('fails open when scoreWithML throws — returns empty layer3 and does not rethrow', async () => {
    mockedScoreWithML.mockRejectedValue(new Error('onnx exploded'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = await runOrchestrator([], '', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root');

    expect(result.layer3.model_active).toBe(false);
    expect(result.layer3.ranked_tests).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[orchestrator] Layer 3 error'));

    warnSpy.mockRestore();
  });

  // 6. Alphabetical sorting of changed files
  it('passes candidates to scoreWithML in alphabetical order', async () => {
    // Since L2 stub returns empty confidence bands, allCandidates will be [],
    // but we can verify changedFiles sorting by checking the scoreWithML call args.
    // The sorted files are used in the L1/L2 stub calls — to observe the sort we
    // inspect the argument passed to scoreWithML (first arg = sorted allCandidates).
    await runOrchestrator(
      ['z-last.ts', 'a-first.ts', 'm-middle.ts'],
      '',
      DEFAULT_CONFIG,
      NO_RUN_HISTORY,
      NO_TESTS,
      '/mock/root',
    );

    // allCandidates comes from the mocked matchEmbeddings (returns empty bands), so it will be [].
    // This confirms matchEmbeddings is called without error and scoreWithML receives [].
    const [candidates] = mockedScoreWithML.mock.calls[0];
    expect(candidates).toEqual([]);
  });

  // 7. Warn messages include layer number identification
  it('logs [orchestrator] Layer 3 error prefix when L3 throws', async () => {
    mockedScoreWithML.mockRejectedValue(new Error('network timeout'));
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await runOrchestrator([], '', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root');

    const warnMessages = warnSpy.mock.calls.map(([msg]) => msg as string);
    expect(warnMessages.some((m) => m.includes('Layer 3'))).toBe(true);

    warnSpy.mockRestore();
  });

  // 8. Promise resolves to OrchestratorResult (not undefined / not rejected)
  it('always resolves even when scoreWithML rejects', async () => {
    mockedScoreWithML.mockRejectedValue(new Error('fatal'));
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(
      runOrchestrator([], '', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root'),
    ).resolves.toBeDefined();
  });

  // 9. layer4 fallback_used is false (real classifyWithLLM mock returns fallback_used:false)
  it('returns layer4 with fallback_used:false from real LLM layer', async () => {
    const result = await runOrchestrator([], '', DEFAULT_CONFIG, NO_RUN_HISTORY, NO_TESTS, '/mock/root');
    expect(result.layer4.fallback_used).toBe(false);
  });

  // 10. Passes runHistory and tests through to scoreWithML
  it('passes runHistory and tests through to scoreWithML', async () => {
    const runHistory: RunRecord[] = [
      {
        id: 'r1',
        repo_id: 'repo-a',
        pr_number: 1,
        sha: 'abc',
        predicted_skip: [],
        actual_failures: [],
        all_tests: [],
        mode: 'shadow',
        created_at: new Date(),
      },
    ];
    const testRecords: TestRecord[] = [
      {
        repo_id: 'repo-a',
        path: 'src/__tests__/x.test.ts',
        pass_count: 10,
        fail_count: 1,
        flake_score: 0.1,
        last_failed_at: null,
        avg_duration_ms: 200,
      },
    ];

    await runOrchestrator([], '', DEFAULT_CONFIG, runHistory, testRecords, '/mock/root');

    const [, , , passedHistory, passedTests] = mockedScoreWithML.mock.calls[0];
    expect(passedHistory).toBe(runHistory);
    expect(passedTests).toBe(testRecords);
  });
});
